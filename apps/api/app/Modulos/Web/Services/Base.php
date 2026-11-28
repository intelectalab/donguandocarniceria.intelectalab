<?php

namespace App\Modulos\Web\Services;

use App\Models\User;
use App\Modulos\Cat\Services\Precios;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Lo común de WEB: textos, tiendas, precio web, avisos, historiales y el usuario «Sistema» de los procesos automáticos. */
final class Base
{
    public const EPS = 0.005;

    public const ESTADOS_TIENDA = ['ACTIVE' => 'Activa', 'TESTING' => 'En prueba', 'PENDING' => 'Por configurar', 'DISABLED' => 'Desactivada'];

    public const ESTADOS_BANDEJA = ['RECEIVED' => 'Recibido', 'PROCESSED' => 'Procesado', 'ERROR' => 'Error', 'IGNORED' => 'Ignorado'];

    public const ESTADOS_MAPEO = ['LINKED' => 'Vinculado', 'UNLINKED' => 'Sin vínculo', 'ERROR' => 'Error'];

    public const ESTADOS_PAGO = ['approved' => 'Aprobada', 'pending' => 'Pendiente', 'in_process' => 'En revisión', 'authorized' => 'Autorizada', 'rejected' => 'Rechazada',
        'cancelled' => 'Cancelada', 'expired' => 'Vencida', 'refunded' => 'Reembolsada', 'charged_back' => 'Contracargo', 'in_mediation' => 'En disputa'];

    public const TIPOS = ['CATALOG' => 'Catálogo', 'PRICES' => 'Precios', 'STOCK' => 'Stock', 'ORDERS' => 'Pedidos'];

    public const ORIGENES = ['SCHEDULE' => 'Programada', 'MANUAL' => 'Manual', 'SALE' => 'Tras una venta'];

    public const ERRORES = ['SKU_NOT_MAPPED' => 'SKU sin mapeo', 'VARIANT_INACTIVE' => 'Producto inactivo', 'PHONE_INVALID' => 'Celular inválido',
        'ADDRESS_NO_PIN' => 'Dirección sin pin', 'PRICE_MISSING' => 'Sin precio web', 'INVALID_PAYLOAD' => 'Datos incompletos', 'PROCESSING_ERROR' => 'Error al crear el pedido'];

    public const MP_DETALLE = ['accredited' => 'acreditado', 'pending_waiting_payment' => 'esperando el pago en PagoEfectivo', 'pending_contingency' => 'en revisión por Mercado Pago',
        'pending_review_manual' => 'en revisión manual de Mercado Pago', 'cc_rejected_insufficient_amount' => 'fondos insuficientes',
        'cc_rejected_bad_filled_security_code' => 'código de seguridad incorrecto', 'cc_rejected_call_for_authorize' => 'el banco pide autorizar la compra',
        'cc_rejected_other_reason' => 'rechazado por el banco', 'cardholder_dispute' => 'desconocimiento del tarjetahabiente', 'refunded_by_seller' => 'reembolso hecho por la tienda',
        'expired_by_system' => 'venció sin aprobación', 'expired_by_aycha' => 'venció sin aprobación', 'by_collector' => 'reembolso hecho por la tienda'];

    /** Forma de pago de WooCommerce => código del medio de pago de la empresa. */
    public const MEDIOS_WOO = ['woo-mercado-pago-basic' => 'MP', 'woo-mercado-pago-custom' => 'MP', 'woo-mercado-pago-pse' => 'MP', 'woo-mercado-pago-pix' => 'MP',
        'yape_manual' => 'YAPE', 'bacs' => 'TRANSFER', 'cod' => 'CASH'];

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function soles(float $n): string
    {
        return ($n < 0 ? '−' : '').'S/ '.number_format(abs($n), 2, '.', ',');
    }

    public static function json(mixed $v, mixed $defecto = []): mixed
    {
        if (is_array($v)) {
            return $v;
        }
        $d = is_string($v) ? json_decode($v, true) : null;

        return $d ?? $defecto;
    }

    public static function enc(mixed $v): string
    {
        return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** Agrega una línea al historial jsonb de una fila. */
    public static function anotar(string $tabla, string $id, array $linea): void
    {
        DB::table($tabla)->where('id', $id)->update([
            'history' => DB::raw("coalesce(history, '[]'::jsonb) || ".DB::getPdo()->quote(self::enc([$linea + ['at' => now()->toIso8601String()]])).'::jsonb'),
            'updated_at' => now(),
        ]);
    }

    public static function param(string $clave, int $defecto): int
    {
        $v = Params::get($clave);

        return is_numeric($v) ? (int) $v : $defecto;
    }

    /** Quien hace los procesos automáticos (webhooks, programador): sin rol, sin alcance limitado y sin id. */
    public static function sistema(string $nombre = 'Sistema'): User
    {
        $u = new User(['name' => mb_substr($nombre, 0, 80)]);
        $u->role = 'SYSTEM';

        return $u;
    }

    public static function exigir(User $u, string $permiso, string $regla, string $texto): void
    {
        if (! Access::can($u, $permiso)) {
            RuleError::fail($regla, $texto);
        }
    }

    /* ------------------------------------------------------------------ tiendas */

    public static function tienda(?string $id): object
    {
        $s = $id ? DB::table('web_stores')->where('id', $id)->first() : null;
        if (! $s) {
            abort(response()->json(['message' => 'Tienda no encontrada.', 'code' => 'NOT_FOUND'], 404));
        }

        return self::decodificar($s);
    }

    public static function decodificar(object $s): object
    {
        $s->brands = self::json($s->brands);
        $s->price_lists = self::json($s->price_lists, (object) []);
        $s->warehouse_ids = self::json($s->warehouse_ids);

        return $s;
    }

    /** Las tiendas que el usuario ve: las de sus marcas (vacío = todas). */
    public static function tiendasDe(?User $u): array
    {
        $marcas = $u ? Access::for($u)['brands'] : [];

        return DB::table('web_stores')->orderByRaw("CASE status WHEN 'ACTIVE' THEN 0 WHEN 'TESTING' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END")->orderBy('name')->get()
            ->map(fn ($s) => self::decodificar($s))
            ->filter(fn ($s) => ! $marcas || array_intersect($marcas, (array) $s->brands) || in_array($s->brand_id, $marcas, true))->values()->all();
    }

    public static function idsTiendasDe(User $u): array
    {
        return array_map(fn ($s) => $s->id, self::tiendasDe($u));
    }

    /** La tienda pedida si está en el alcance del usuario (404 si no). */
    /** La tienda pedida o, sin id, la primera que el usuario ve (las activas primero). */
    public static function tiendaOPrimera(User $u, ?string $id): object
    {
        if (! $id) {
            $id = self::tiendasDe($u)[0]->id ?? null;
        }

        return self::tiendaDe($u, $id);
    }

    public static function tiendaDe(User $u, ?string $id): object
    {
        $s = self::tienda($id);
        if (! in_array($s->id, self::idsTiendasDe($u), true)) {
            abort(response()->json(['message' => 'Tienda no encontrada.', 'code' => 'NOT_FOUND'], 404));
        }

        return $s;
    }

    /* ------------------------------------------------------------------ catálogo */

    public static function variante(?string $id): ?object
    {
        return $id ? DB::table('product_variants as v')->leftJoin('products as p', 'p.id', '=', 'v.product_id')->where('v.id', $id)
            ->first(['v.id', 'v.sku', 'v.name', 'v.brand_id', 'v.status', 'v.sellable', 'v.sale_mode', 'v.nominal_weight_kg', 'v.web_publishable',
                'v.product_id', 'p.web_publishable as producto_web', 'p.status as producto_estado', 'p.product_type']) : null;
    }

    /** Activa y a la venta (RN-WEB-03). */
    public static function varianteActiva(?object $v): bool
    {
        return (bool) $v && $v->status === 'ACTIVE' && (bool) $v->sellable;
    }

    /** Publicable en la web según CAT-09: el producto y la variante marcados, el producto activo. */
    public static function publicable(?object $v): bool
    {
        return (bool) $v && $v->web_publishable !== false && (bool) $v->producto_web && $v->producto_estado !== 'INACTIVE';
    }

    /** Lista de precios de la tienda para una marca (RN-WEB-08 / RN-CAT-05). */
    public static function listaDe(object $s, string $marca): ?string
    {
        $listas = (array) $s->price_lists;

        return $listas[$marca] ?? ($marca === $s->brand_id ? $s->price_list_id : null);
    }

    /**
     * Precio que va a la web (RN-WEB-08): el vigente de la lista de la tienda para la marca de la variante; si la tienda no
     * tiene lista para esa marca, el de RN-CAT-05 para el canal WEB. En WooCommerce una unidad de peso variable se vende
     * por unidad: su precio es el del kg por el peso nominal.
     *
     * @return array{price: float, basis: string, list_id: string, list_code: ?string, woo: float}|null
     */
    public static function precioWeb(object $s, object $v): ?array
    {
        $lista = self::listaDe($s, $v->brand_id);
        $hoy = self::hoy();
        $p = null;
        if ($lista) {
            $it = DB::table('price_list_items')->where('list_id', $lista)->where('variant_id', $v->id)->where('valid_from', '<=', $hoy)
                ->where(fn ($q) => $q->whereNull('valid_to')->orWhere('valid_to', '>=', $hoy))
                ->where(fn ($q) => $q->whereNull('min_qty')->orWhere('min_qty', '<=', 1))
                ->orderByDesc('valid_from')->first(['price', 'basis']);
            if ($it && DB::table('price_lists')->where('id', $lista)->where('status', 'ACTIVE')->exists()) {
                $p = ['price' => (float) $it->price, 'basis' => $it->basis ?: ($v->sale_mode === 'UNIT' ? 'UNIT' : 'KG'), 'list_id' => $lista];
            }
        }
        if (! $p) {
            $x = Precios::vigente($v->id, ['canal' => 'WEB', 'marca' => $v->brand_id, 'cantidad' => 1]);
            if (! $x) {
                return null;
            }
            $p = ['price' => $x['price'], 'basis' => $x['basis'], 'list_id' => $x['list_id']];
        }
        $woo = $v->sale_mode === 'UNIT_VARIABLE_WEIGHT' && $p['basis'] === 'KG' ? self::r($p['price'] * (float) ($v->nominal_weight_kg ?: 1)) : self::r($p['price']);

        return $p + ['list_code' => DB::table('price_lists')->where('id', $p['list_id'])->value('code'), 'woo' => $woo];
    }

    public static function unidadWeb(object $v): string
    {
        return match ($v->sale_mode) {
            'UNIT_VARIABLE_WEIGHT' => 'unidad de ~'.number_format((float) $v->nominal_weight_kg, 2).' kg',
            'KG' => 'kg',
            default => 'unidad',
        };
    }

    /* ------------------------------------------------------------------ avisos */

    /** Aviso en el centro de notificaciones (INT-09). $para: ['role' => …] o ['user_id' => …]. */
    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn', string $tipo = 'ORDERS'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo,
            'ref' => self::enc(['href' => '/m/web/'.strtolower($pantalla).($id ? '?id='.$id : '')]),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'WEB', 'type' => $tipo, 'at' => now(), 'in_app' => true,
        ]);
    }

    public static function nombreUsuario(?string $id): ?string
    {
        return $id ? DB::table('users')->where('id', $id)->value('name') : null;
    }
}
