<?php

namespace App\Modulos\Crm\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CRM-09 Plantillas y su envío desde la conversación (RN-CRM-07 y 08).
 *
 *  - Solo se envía una plantilla aprobada por Meta, de la marca del número, y solo por WhatsApp (TikTok no admite
 *    plantillas; Messenger e Instagram tampoco).
 *  - Por pedido, como máximo crm_utility_templates_per_order (2) de utilidad; una más exige crm.template.send_extra.
 *  - Una de marketing solo si el último consentimiento de marketing del cliente o contacto es «otorgado»; lleva la opción
 *    de baja y la envía quien tiene crm.template.send_marketing.
 *  - Se crean en borrador, se envían a revisión de Meta y se registra su respuesta. La aprobada no cambia de texto.
 */
class Plantillas
{
    public const ESTADOS = ['DRAFT' => 'Borrador', 'PENDING' => 'En revisión de Meta', 'APPROVED' => 'Aprobada', 'REJECTED' => 'Rechazada', 'PAUSED' => 'Pausada', 'DISABLED' => 'Desactivada'];

    public const CATEGORIAS = ['UTILITY' => 'Utilidad', 'MARKETING' => 'Marketing', 'AUTHENTICATION' => 'Autenticación'];

    public const PROPOSITOS = [
        'ORDER_CONFIRMATION' => 'Confirmación de pedido', 'ORDER_DISPATCHED' => 'Pedido en camino', 'WEIGHT_DIFFERENCE' => 'Diferencia de peso',
        'PAYMENT_REQUEST' => 'Recordatorio de pago', 'POST_DELIVERY_SURVEY' => 'Encuesta posentrega', 'REBUY' => 'Recompra', 'RECORDING_NOTICE' => 'Aviso de registro',
        'REENGAGE' => 'Reactivación', 'PROMOTION' => 'Promoción', 'OTHER' => 'Otro',
    ];

    public const BAJA = "\n\nSi no deseas recibir promociones, responde BAJA.";

    public static function tope(): int
    {
        return max(1, (int) (Params::get('crm_utility_templates_per_order') ?? 2));
    }

    /** CRM-09: plantillas de las marcas de la persona, con su costo, envíos y cifras. */
    public static function lista(array $f, User $u): array
    {
        $a = Access::for($u);
        $q = DB::table('message_templates as t')->leftJoin('brands as b', 'b.id', '=', 't.brand_id')->when($a['brands'], fn ($w) => $w->whereIn('t.brand_id', $a['brands']));
        $cifras = (clone $q)->selectRaw("count(*) FILTER (WHERE t.provider_status = 'APPROVED') AS aprobadas, count(*) FILTER (WHERE t.provider_status = 'PENDING') AS revision,
            count(*) FILTER (WHERE t.provider_status = 'REJECTED') AS rechazadas, count(*) FILTER (WHERE t.provider_status = 'DRAFT') AS borradores")->first();
        foreach (['categoria' => 't.category', 'estado' => 't.provider_status', 'marca' => 't.brand_id', 'proposito' => 't.purpose'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        $t = trim((string) ($f['buscar'] ?? ''));
        if (mb_strlen($t) >= 2) {
            $p = '%'.addcslashes($t, '%_\\').'%';
            $q->where(fn ($w) => $w->where('t.name', 'ilike', $p)->orWhere('t.body', 'ilike', $p));
        }
        $envios = DB::table('conversation_messages')->whereNotNull('template_id')->selectRaw('template_id, count(*) AS n')->groupBy('template_id')->pluck('n', 'template_id');
        $filas = $q->orderBy('b.name')->orderBy('t.name')->get(['t.*', 'b.name as brand_name'])->map(fn ($x) => self::presentar($x, (int) ($envios[$x->id] ?? 0)))->all();
        $filas = \App\Support\Paginas::ordenarLista($filas, ['brand_name', 'name', 'category_name', 'purpose_name', 'status_name', 'costo_fuera', 'costo_dentro', 'envios']);

        return \App\Support\Paginas::deLista($filas) + [
            'cifras' => ['aprobadas' => (int) $cifras->aprobadas, 'revision' => (int) $cifras->revision, 'rechazadas' => (int) $cifras->rechazadas, 'borradores' => (int) $cifras->borradores, 'tope' => self::tope()],
            'opciones' => [
                'categorias' => self::opciones(self::CATEGORIAS), 'estados' => self::opciones(self::ESTADOS), 'propositos' => self::opciones(self::PROPOSITOS),
                'marcas' => DB::table('brands')->when($a['brands'], fn ($w) => $w->whereIn('id', $a['brands']))->orderBy('name')->get(['id as value', 'name as label'])->all(),
            ],
            'tarifas' => Costos::tarifas(),
            'puede' => Access::can($u, 'crm.template.manage'),
        ];
    }

    /** Nueva o editada: queda en borrador. Solo borradores y rechazadas se editan. */
    public static function guardar(?string $id, array $d, User $u): array
    {
        $antes = $id ? (DB::table('message_templates')->where('id', $id)->first() ?? abort(404)) : null;
        if ($antes && ! in_array($antes->provider_status, ['DRAFT', 'REJECTED'], true)) {
            RuleError::fail('RN-CRM-07', 'Solo se editan borradores y rechazadas: una plantilla aprobada o en revisión no cambia. Crea otra.');
        }
        self::marcaPermitida($d['brand_id'], $u);
        if (! preg_match('/^[a-z0-9_]{1,250}$/', $d['name'])) {
            RuleError::fail('RN-CRM-07', 'El nombre va en minúsculas, números y guion bajo (como lo pide Meta).');
        }
        if (DB::table('message_templates')->where('brand_id', $d['brand_id'])->where('name', $d['name'])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-CRM-07', 'Ya hay una plantilla con ese nombre en la marca.');
        }
        $cuerpo = trim($d['body']);
        if (str_contains(mb_strtolower($cuerpo), 'responde baja') && $d['category'] === 'MARKETING') {
            $cuerpo = trim(str_replace(trim(self::BAJA), '', $cuerpo));   // la opción de baja se agrega sola al enviar
        }
        preg_match_all('/\{\{(\w+)\}\}/', $cuerpo, $m);
        $fila = ['brand_id' => $d['brand_id'], 'name' => $d['name'], 'category' => $d['category'], 'purpose' => $d['purpose'], 'body' => mb_substr($cuerpo, 0, 1024),
            'variables' => json_encode(array_values(array_unique($m[1]))), 'language' => 'es', 'provider_status' => 'DRAFT', 'rejection_reason' => null, 'updated_at' => now()];
        if ($antes) {
            DB::table('message_templates')->where('id', $id)->update($fila);
        } else {
            $id = DB::table('message_templates')->insertGetId($fila + ['created_at' => now()], 'id');
        }
        Events::emit('template.saved', 'message_templates', $id, ['by' => $u->id]);

        return self::ver($id, $u);
    }

    /** Envía a revisión de Meta. Con el proveedor real esto lo manda por su API (D-CRM-01). */
    public static function enviarARevision(string $id, User $u): array
    {
        $t = self::fila($id, $u);
        if (! in_array($t->provider_status, ['DRAFT', 'REJECTED'], true)) {
            RuleError::fail('RN-CRM-07', 'Solo se envían a revisión los borradores y las rechazadas.');
        }
        DB::table('message_templates')->where('id', $id)->update(['provider_status' => 'PENDING', 'submitted_at' => now(), 'rejection_reason' => null, 'updated_at' => now()]);
        Events::emit('template.submitted', 'message_templates', $id, ['by' => $u->id]);

        return self::ver($id, $u);
    }

    /** Registra la respuesta de Meta (aprobada o rechazada con motivo). */
    public static function respuestaDeMeta(string $id, bool $aprobada, ?string $motivo, User $u): array
    {
        $t = self::fila($id, $u);
        if ($t->provider_status !== 'PENDING') {
            RuleError::fail('RN-CRM-07', 'La plantilla no está en revisión de Meta.');
        }
        if (! $aprobada && mb_strlen(trim((string) $motivo)) < 5) {
            RuleError::fail('RN-CRM-07', 'Indica el motivo del rechazo que dio Meta.');
        }
        DB::table('message_templates')->where('id', $id)->update($aprobada
            ? ['provider_status' => 'APPROVED', 'provider_template_id' => $t->provider_template_id ?: 'HX'.substr(str_replace('-', '', $id), -10), 'updated_at' => now()]
            : ['provider_status' => 'REJECTED', 'rejection_reason' => mb_substr(trim((string) $motivo), 0, 255), 'updated_at' => now()]);
        Events::emit($aprobada ? 'template.approved' : 'template.rejected', 'message_templates', $id, ['by' => $u->id]);

        return self::ver($id, $u);
    }

    public static function ver(string $id, User $u): array
    {
        $t = self::fila($id, $u);
        $x = DB::table('message_templates as t')->leftJoin('brands as b', 'b.id', '=', 't.brand_id')->where('t.id', $id)->first(['t.*', 'b.name as brand_name']);

        return self::presentar($x, DB::table('conversation_messages')->where('template_id', $id)->count())
            + ['ejemplo' => self::rellenar($t->body, self::ejemplo())['texto'].($t->category === 'MARKETING' ? self::BAJA : '')];
    }

    /** Las plantillas que se pueden usar en una conversación, con sus pedidos para llenar las variables. */
    public static function paraConversacion(string $conversacion, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();
        $plantillas = $ch->kind !== 'WHATSAPP' ? [] : DB::table('message_templates')->where('brand_id', $cv->brand_id)->orderByRaw("CASE provider_status WHEN 'APPROVED' THEN 0 ELSE 1 END")
            ->orderBy('name')->get()->map(fn ($t) => [
                'id' => $t->id, 'name' => $t->name, 'category' => $t->category, 'category_name' => self::CATEGORIAS[$t->category] ?? $t->category, 'purpose_name' => self::PROPOSITOS[$t->purpose] ?? $t->purpose,
                'status' => $t->provider_status, 'status_name' => self::ESTADOS[$t->provider_status] ?? $t->provider_status, 'body' => $t->body,
                'costo' => (fn ($x) => ['amount' => $x['amount'], 'reason' => Mensajes::MOTIVOS_COSTO[$x['reason']] ?? $x['reason']])(Mensajes::tarifa($t->category, $cv, $ch, 'API')),
            ])->all();
        $pedidos = DB::table('sales_orders')->where(fn ($q) => $q->where('conversation_id', $cv->id)->when($cv->customer_id, fn ($w) => $w->orWhere(fn ($x) => $x->where('customer_id', $cv->customer_id)->where('brand_id', $cv->brand_id))))
            ->whereNotIn('status', ['CANCELLED'])->orderByDesc('created_at')->limit(8)->get(['id', 'number', 'status'])
            ->map(fn ($o) => ['value' => $o->id, 'label' => "{$o->number} · ".self::utilidadDelPedido($o->id).' de '.self::tope().' plantillas de utilidad', 'usadas' => self::utilidadDelPedido($o->id)])->all();

        return ['plantillas' => $plantillas, 'pedidos' => $pedidos, 'tope' => self::tope(), 'marketing' => Consentimientos::marketing($cv->customer_id, $cv->contact_id),
            'puede' => ['marketing' => Access::can($u, 'crm.template.send_marketing'), 'extra' => Access::can($u, 'crm.template.send_extra')],
            'vistas' => collect($plantillas)->mapWithKeys(fn ($t) => [$t['id'] => self::rellenar($t['body'], self::variables($cv, null))['texto'].($t['category'] === 'MARKETING' ? self::BAJA : '')])->all()];
    }

    /** RN-CRM-07 y 08: envía una plantilla en la conversación (también fuera de la ventana y con la conversación cerrada). */
    public static function enviar(string $conversacion, string $plantilla, ?string $pedido, bool $extra, User $u): array
    {
        $cv = Conversaciones::visible($conversacion, $u);
        if (! Conversaciones::puedeResponder($cv, $u)) {
            RuleError::fail('RN-CRM-03', 'Solo quien atiende el chat o la supervisora envían en esta conversación.');
        }
        $ch = DB::table('messaging_channels')->where('id', $cv->channel_id)->first();
        if ($ch->kind === 'TIKTOK') {
            RuleError::fail('RN-CRM-06', 'TikTok no admite plantillas ni envíos masivos.');
        }
        if ($ch->kind !== 'WHATSAPP') {
            RuleError::fail('RN-CRM-05', Canales::REDES[$ch->kind].' no admite plantillas: solo se responde dentro de '.Mensajes::horasVentana($ch->kind).' h desde el último mensaje del cliente.');
        }
        $t = DB::table('message_templates')->where('id', $plantilla)->first() ?? abort(404);
        if ($t->provider_status !== 'APPROVED') {
            RuleError::fail('RN-CRM-07', "La plantilla {$t->name} está «".(self::ESTADOS[$t->provider_status] ?? $t->provider_status).'»: solo se envían plantillas aprobadas por Meta.');
        }
        if ($t->brand_id && $t->brand_id !== $cv->brand_id) {
            RuleError::fail('RN-CRM-07', "La plantilla {$t->name} es de otra marca que el número.");
        }
        $o = $pedido ? DB::table('sales_orders')->where('id', $pedido)->first() : null;
        if ($pedido && (! $o || ($o->customer_id !== $cv->customer_id && $o->conversation_id !== $cv->id))) {
            RuleError::fail('RN-CRM-07', 'Ese pedido no es de este cliente.');
        }
        if ($t->category === 'MARKETING') {
            if (! Access::can($u, 'crm.template.send_marketing')) {
                RuleError::fail('RN-CRM-08', 'Tu rol no envía plantillas de marketing.');
            }
            $mk = Consentimientos::marketing($cv->customer_id, $cv->contact_id);
            if ($mk !== true) {
                RuleError::fail('RN-CRM-08', 'El cliente no tiene consentimiento de marketing vigente (último registro: '.($mk === false ? 'dio de baja' : 'ninguno').'). Registra su «sí» con evidencia antes de enviar.');
            }
        }
        if ($t->category === 'UTILITY' && $o) {
            $n = self::utilidadDelPedido($o->id);
            if ($n >= self::tope() && ! ($extra && Access::can($u, 'crm.template.send_extra'))) {
                RuleError::fail('RN-CRM-07', "El pedido {$o->number} ya recibió {$n} plantillas de utilidad (máximo ".self::tope().'). Una más la envía la supervisora como adicional.');
            }
        }
        $r = self::rellenar($t->body, self::variables($cv, $o));
        if ($r['faltan']) {
            RuleError::fail('RN-CRM-07', 'Faltan datos para la plantilla: '.implode(', ', $r['faltan']).($o ? '.' : '. Elige el pedido.'));
        }
        $texto = $r['texto'].($t->category === 'MARKETING' ? self::BAJA : '');
        $salida = Mensajes::salir($cv, $ch, ['body' => $texto, 'msg_type' => 'TEMPLATE', 'category' => $t->category, 'template_id' => $t->id, 'order_id' => $o?->id, 'user' => $u]);

        return ['mensaje' => $salida, 'conversacion' => Conversaciones::ver($conversacion, $u)];
    }

    /** Plantillas de utilidad ya enviadas para un pedido. */
    public static function utilidadDelPedido(string $pedido): int
    {
        return DB::table('conversation_messages')->where('order_id', $pedido)->where('category', 'UTILITY')->where('msg_type', 'TEMPLATE')->count();
    }

    /** Las variables de una conversación y, si hay, de su pedido. */
    public static function variables(object $cv, ?object $o): array
    {
        $nombre = DB::table('customers')->where('id', $cv->customer_id)->value('full_name') ?? DB::table('leads')->where('id', $cv->lead_id)->value('full_name')
            ?? DB::table('channel_contacts')->where('id', $cv->contact_id)->value('display_name') ?? '';
        $v = ['cliente' => trim(explode(' ', trim((string) $nombre))[0] ?? ''), 'marca' => (string) DB::table('brands')->where('id', $cv->brand_id)->value('name'),
            'yape' => (string) DB::table('official_identifiers')->where('identifier_type', 'YAPE')->where('status', 'ACTIVE')->value('value')];
        if ($o) {
            $lineas = DB::table('sales_order_lines as l')->join('product_variants as p', 'p.id', '=', 'l.variant_id')->where('l.sales_order_id', $o->id)->orderBy('l.line_no')
                ->get(['p.name', 'l.qty', 'l.est_weight_kg']);
            $dir = $o->address_id ? DB::table('customer_addresses')->where('id', $o->address_id)->value('address_line') : null;
            $v += [
                'pedido' => $o->number, 'total' => 'S/ '.number_format((float) ($o->final_total ?? $o->estimated_total), 2, '.', ','),
                'productos' => $lineas->map(fn ($l) => '• '.rtrim(rtrim(number_format((float) $l->qty, 2, '.', ''), '0'), '.').' × '.$l->name)->implode("\n"),
                'peso' => $o->est_kg ? rtrim(rtrim(number_format((float) $o->est_kg, 2, '.', ''), '0'), '.').' kg' : '',
                'direccion' => (string) ($dir ?? ($o->fulfillment === 'PICKUP' ? 'Recojo en tienda' : '')),
                'fecha' => $o->delivery_date ? Carbon::parse($o->delivery_date)->format('d/m/Y') : '',
                'franja' => $o->slot_from ? substr($o->slot_from, 0, 5).' a '.substr((string) $o->slot_to, 0, 5) : '',
                // El enlace de pago lo genera Caja (CAJ) cuando esté; mientras tanto, el Yape oficial de la empresa (RN-CRM-22).
                'enlace_pago' => 'Yape '.$v['yape'],
                'peso_real' => $o->est_kg ? rtrim(rtrim(number_format((float) $o->est_kg, 2, '.', ''), '0'), '.').' kg' : '',
            ];
        }

        return $v;
    }

    /** Reemplaza {{variable}}; devuelve el texto y las variables sin dato. */
    public static function rellenar(string $cuerpo, array $vars): array
    {
        $faltan = [];
        $texto = preg_replace_callback('/\{\{(\w+)\}\}/', function ($m) use ($vars, &$faltan) {
            $v = $vars[$m[1]] ?? '';
            if ($v === '') {
                $faltan[] = $m[1];

                return $m[0];
            }

            return $v;
        }, $cuerpo);

        return ['texto' => $texto, 'faltan' => array_values(array_unique($faltan))];
    }

    private static function ejemplo(): array
    {
        return ['cliente' => 'María', 'marca' => 'Don Guando', 'pedido' => 'P-001234', 'total' => 'S/ 186.50', 'productos' => "• 2 × Lomo fino\n• 1 × Cuy entero", 'peso' => '3.2 kg',
            'direccion' => 'Av. Los Próceres 1240, Surco', 'fecha' => '12/10/2026', 'franja' => '10:00 a 13:00', 'enlace_pago' => 'Yape +51987650001', 'yape' => '+51987650001',
            'repartidor' => 'Jorge', 'enlace_seguimiento' => 'donguando.pe/seguimiento', 'peso_real' => '3.4 kg'];
    }

    private static function fila(string $id, User $u): object
    {
        $t = DB::table('message_templates')->where('id', $id)->first() ?? abort(404);
        $marcas = Access::for($u)['brands'];
        abort_if($marcas && ! in_array($t->brand_id, $marcas, true), 404);

        return $t;
    }

    private static function marcaPermitida(string $marca, User $u): void
    {
        $marcas = Access::for($u)['brands'];
        if (($marcas && ! in_array($marca, $marcas, true)) || ! DB::table('brands')->where('id', $marca)->exists()) {
            RuleError::fail('RN-CRM-07', 'Elige una marca de tu alcance.');
        }
    }

    private static function opciones(array $a): array
    {
        return collect($a)->map(fn ($l, $k) => ['value' => $k, 'label' => $l])->values()->all();
    }

    private static function presentar(object $t, int $envios): array
    {
        $t2 = Costos::tarifas();
        $fuera = match ($t->category) { 'MARKETING' => $t2['marketing'], 'AUTHENTICATION' => $t2['autenticacion'], default => $t2['utilidad'] };

        return [
            'id' => $t->id, 'brand_id' => $t->brand_id, 'brand_name' => $t->brand_name ?? '—', 'name' => $t->name, 'category' => $t->category, 'category_name' => self::CATEGORIAS[$t->category] ?? $t->category,
            'purpose' => $t->purpose, 'purpose_name' => self::PROPOSITOS[$t->purpose] ?? $t->purpose, 'status' => $t->provider_status, 'status_name' => self::ESTADOS[$t->provider_status] ?? $t->provider_status,
            'body' => $t->body, 'variables' => array_values((array) json_decode((string) ($t->variables ?? '[]'), true)), 'provider_template_id' => $t->provider_template_id,
            'rejection_reason' => $t->rejection_reason ?? $t->reject_reason, 'submitted_at' => $t->submitted_at, 'envios' => $envios,
            // Fuera de la ventana de servicio; dentro, la utilidad es gratis (en la ventana de anuncio de 72 h, todo).
            'costo_fuera' => $fuera, 'costo_dentro' => $t->category === 'UTILITY' ? 0.0 : $fuera,
        ];
    }
}
