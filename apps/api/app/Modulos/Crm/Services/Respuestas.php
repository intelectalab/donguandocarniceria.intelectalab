<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * CRM-10 Respuestas rápidas y catálogo de WhatsApp.
 *
 *  - Atajos personales (de cada quien) o de la marca (los crea la supervisión o el administrador): /delivery, /pago, /peso.
 *  - El catálogo del número es lo activo y vendible en CAT con precio vigente en la lista de WhatsApp; lo inactivo o sin
 *    precio queda fuera. Se envía un producto del catálogo dentro de la ventana, como cualquier respuesta.
 */
class Respuestas
{
    public static function lista(array $f, User $u): array
    {
        $a = Access::for($u);
        $q = DB::table('quick_replies as q')->leftJoin('brands as b', 'b.id', '=', 'q.brand_id')->leftJoin('users as x', 'x.id', '=', 'q.owner_user_id')
            ->where(fn ($w) => $w->where('q.owner_user_id', $u->id)->orWhere(fn ($x) => $x->whereNull('q.owner_user_id')->when($a['brands'], fn ($y) => $y->whereIn('q.brand_id', $a['brands']))));
        if (! empty($f['marca'])) {
            $q->where('q.brand_id', $f['marca']);
        }
        if (($f['alcance'] ?? '') === 'ME') {
            $q->where('q.owner_user_id', $u->id);
        } elseif (($f['alcance'] ?? '') === 'MARCA') {
            $q->whereNull('q.owner_user_id');
        }
        if (! empty($f['estado'])) {
            $q->where('q.status', $f['estado']);
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('q.shortcut', 'ilike', $p)->orWhere('q.body', 'ilike', $p));
        }
        $q->orderBy('q.shortcut')->orderBy('b.name');
        Paginas::ordenar($q, ['shortcut' => 'q.shortcut', 'alcance' => "coalesce(b.name, x.name)", 'status' => 'q.status'], 'q.id', $f);

        return Paginas::de($q->select(['q.*', 'b.name as brand_name', 'x.name as owner_name']), fn ($r) => [
            'id' => $r->id, 'shortcut' => $r->shortcut, 'body' => $r->body, 'status' => $r->status, 'brand_id' => $r->brand_id, 'owner_user_id' => $r->owner_user_id,
            'alcance' => $r->owner_user_id ? 'Personal · '.$r->owner_name : $r->brand_name, 'mia' => $r->owner_user_id === $u->id,
            'puede_editar' => $r->owner_user_id === $u->id || ($r->owner_user_id === null && self::gestionaMarca($u)),
        ], $f) + [
            'marcas' => DB::table('brands')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('name')->get(['id as value', 'name as label'])->all(),
            'puede_marca' => self::gestionaMarca($u),
        ];
    }

    public static function guardar(?string $id, array $d, User $u): array
    {
        $antes = $id ? (DB::table('quick_replies')->where('id', $id)->first() ?? abort(404)) : null;
        if ($antes && ! ($antes->owner_user_id === $u->id || ($antes->owner_user_id === null && self::gestionaMarca($u)))) {
            RuleError::fail('RN-CRM-03', 'Solo editas tus respuestas personales; las de la marca las cambia la supervisión.');
        }
        $atajo = mb_strtolower(trim($d['shortcut']));
        if (! preg_match('/^\/[a-z0-9_]{2,30}$/', $atajo)) {
            RuleError::fail('RN-CRM-10', 'El atajo empieza con / y usa minúsculas, números o guion bajo (de 2 a 30).');
        }
        $marca = $d['alcance'] === 'ME' ? null : $d['alcance'];
        if ($marca) {
            if (! self::gestionaMarca($u)) {
                RuleError::fail('RN-CRM-03', 'Las respuestas de la marca las crea la supervisión o el administrador; tú puedes crear las personales.');
            }
            $ok = Access::for($u)['brands'];
            if (($ok && ! in_array($marca, $ok, true)) || ! DB::table('brands')->where('id', $marca)->exists()) {
                RuleError::fail('RN-CRM-10', 'Elige una marca de tu alcance.');
            }
        }
        $duenio = $marca ? null : ($antes?->owner_user_id ?? $u->id);
        if (DB::table('quick_replies')->where('shortcut', $atajo)->where(fn ($q) => $marca ? $q->where('brand_id', $marca) : $q->where('owner_user_id', $duenio))
            ->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-CRM-10', "Ya existe el atajo {$atajo} en ese alcance.");
        }
        $fila = ['shortcut' => $atajo, 'body' => mb_substr(trim($d['body']), 0, 2000), 'status' => $d['status'], 'brand_id' => $marca, 'owner_user_id' => $duenio, 'updated_at' => now()];
        if ($antes) {
            DB::table('quick_replies')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('quick_replies')->insertGetId($fila + ['created_at' => now()], 'id');
        }
        Events::emit('quick_reply.saved', 'quick_replies', $id, ['by' => $u->id]);

        return ['id' => $id];
    }

    /** El catálogo de WhatsApp: variantes vendibles con su precio de WhatsApp vigente (CAT). */
    public static function catalogo(array $f, User $u): array
    {
        $a = Access::for($u);
        $q = DB::table('product_variants as v')->leftJoin('brands as b', 'b.id', '=', 'v.brand_id')->where('v.sellable', true)
            ->when($a['brands'], fn ($w) => $w->whereIn('v.brand_id', $a['brands']))->when(! empty($f['marca']), fn ($w) => $w->where('v.brand_id', $f['marca']));
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('v.name', 'ilike', $p)->orWhere('v.sku', 'ilike', $p));
        }
        $vs = $q->orderBy('b.name')->orderBy('v.name')->get(['v.id', 'v.sku', 'v.name', 'v.status', 'v.brand_id', 'b.name as brand_name']);
        $precios = [];
        foreach ($vs->groupBy('brand_id') as $marca => $grupo) {
            $precios += Precios::vigentes($grupo->pluck('id')->all(), ['canal' => 'WHATSAPP', 'marca' => $marca]);
        }
        $filas = $vs->map(function ($v) use ($precios) {
            $p = $precios[$v->id] ?? null;

            return ['id' => $v->id, 'sku' => $v->sku, 'name' => $v->name, 'brand_id' => $v->brand_id, 'brand_name' => $v->brand_name, 'status' => $v->status,
                'precio' => $p ? (float) $p['price'] : null, 'base' => $p['basis'] ?? null, 'publicado' => $v->status === 'ACTIVE' && $p !== null];
        })->filter(fn ($x) => ($f['estado'] ?? '') === '' || ($f['estado'] === 'PUBLICADO') === $x['publicado'])->values()->all();
        $filas = Paginas::ordenarLista($filas, ['brand_name', 'sku', 'name', 'precio']);
        $sinc = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->when($a['brands'], fn ($w) => $w->whereIn('brand_id', $a['brands']))->max('catalog_synced_at');

        return Paginas::deLista($filas, $f) + [
            'cifras' => ['publicados' => collect($filas)->where('publicado', true)->count(), 'fuera' => collect($filas)->where('publicado', false)->count()],
            'sincronizado' => $sinc, 'puede_sincronizar' => Access::can($u, 'crm.channel.manage') || Access::can($u, 'crm.template.manage'),
        ];
    }

    /** «Sincronizar con CAT»: deja la fecha en los números de WhatsApp (con el proveedor real, publica el catálogo; D-CRM-01). */
    public static function sincronizar(User $u): array
    {
        $a = Access::for($u);
        $n = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->when($a['brands'], fn ($w) => $w->whereIn('brand_id', $a['brands']))
            ->update(['catalog_synced_at' => now(), 'updated_at' => now()]);
        Events::emit('catalog.synced', 'messaging_channels', null, ['channels' => $n, 'by' => $u->id]);

        return ['numeros' => $n, 'at' => now()->toIso8601String()];
    }

    /** Envía un producto del catálogo en la conversación (dentro de la ventana, como una respuesta). */
    public static function enviarProducto(string $conversacion, string $variante, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        $v = DB::table('product_variants')->where('id', $variante)->first(['id', 'name', 'status', 'sellable', 'brand_id']) ?? abort(404);
        if ($v->brand_id !== $cv->brand_id) {
            RuleError::fail('RN-CRM-10', 'Ese producto es de otra marca que el número.');
        }
        $p = Precios::vigente($v->id, ['canal' => 'WHATSAPP', 'marca' => $v->brand_id]);
        if ($v->status !== 'ACTIVE' || ! $v->sellable || ! $p) {
            RuleError::fail('RN-CRM-10', 'Ese producto no está en el catálogo: está inactivo o no tiene precio de WhatsApp vigente.');
        }
        $marca = DB::table('brands')->where('id', $v->brand_id)->value('name');
        $texto = "{$v->name} · S/ ".number_format((float) $p['price'], 2, '.', ',').($p['basis'] === 'KG' ? ' el kg' : ' c/u')." · {$marca}";

        return Mensajes::responderComo($conversacion, $texto, 'PRODUCT', $u);
    }

    /** Productos del catálogo para elegir en la conversación. */
    public static function catalogoDeConversacion(string $conversacion, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);

        return collect(self::catalogo(['marca' => $cv->brand_id, 'estado' => 'PUBLICADO', 'per_page' => 200], $u)['data'])
            ->map(fn ($x) => ['id' => $x['id'], 'name' => $x['name'], 'precio' => $x['precio'], 'base' => $x['base']])->values()->all();
    }

    private static function gestionaMarca(User $u): bool
    {
        return Access::can($u, 'crm.channel.manage') || Access::can($u, 'crm.conversation.reassign');
    }
}
