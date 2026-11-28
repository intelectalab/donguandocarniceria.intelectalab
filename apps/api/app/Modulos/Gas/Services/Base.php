<?php

namespace App\Modulos\Gas\Services;

use App\Models\User;
use App\Support\Access;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/** Lo común de GAS: nombres de estados y tipos, niveles de aprobación, alcance y numeración. */
final class Base
{
    public const EPS = 0.005;

    public const ESTADOS = ['DRAFT' => 'Borrador', 'SUBMITTED' => 'Enviado', 'APPROVED' => 'Aprobado', 'REJECTED' => 'Rechazado', 'PAID' => 'Pagado', 'VOIDED' => 'Anulado'];

    public const DOCUMENTOS = [
        'INVOICE' => 'Factura', 'RECEIPT' => 'Boleta', 'TICKET' => 'Ticket', 'FEES_RECEIPT' => 'Recibo por honorarios',
        'FOREIGN_INVOICE' => 'Factura del exterior', 'SIMPLE_RECEIPT' => 'Recibo simple', 'MOBILITY_SHEET' => 'Planilla de movilidad', 'NONE' => 'Sin comprobante',
    ];

    /** RN-GAS-06: sin comprobante válido (quedan para la contadora y no dan crédito fiscal). */
    public const SIN_VALIDO = ['NONE', 'SIMPLE_RECEIPT', 'MOBILITY_SHEET'];

    /** RN-GAS-02 y RN-GAS-11: exigen proveedor (RUC) y número. */
    public const CON_PROVEEDOR = ['INVOICE', 'FEES_RECEIPT'];

    public const GRUPOS = [
        'DELIVERY' => 'Reparto', 'ADVERTISING' => 'Publicidad', 'CONTENT_CREATORS' => 'Creadores de contenido', 'COMMERCIAL' => 'Comercial',
        'SUPPLIES_PACKAGING' => 'Empaques e insumos', 'PRODUCTION' => 'Producción', 'EQUIPMENT_MAINTENANCE' => 'Mantenimiento de equipos',
        'RENT' => 'Alquileres', 'SERVICES' => 'Servicios', 'ADMIN' => 'Administración', 'OTHER' => 'Otros',
    ];

    public const AREAS = ['ADMIN' => 'Administración', 'DELIVERY' => 'Reparto', 'MARKETING' => 'Marketing', 'PRODUCTION' => 'Producción', 'SALES' => 'Ventas', 'OTHER' => 'Otros'];

    /** Tipos de costo de reparto que se copian a DEL al aprobar (RN-GAS-12). */
    public const COSTOS_REPARTO = [
        'FUEL' => 'Combustible', 'TOLL' => 'Peaje', 'PARKING' => 'Estacionamiento', 'MAINTENANCE_PREVENTIVE' => 'Mantenimiento preventivo',
        'MAINTENANCE_CORRECTIVE' => 'Mantenimiento correctivo', 'SOAT' => 'SOAT', 'TECH_INSPECTION' => 'Revisión técnica', 'RENT' => 'Alquiler del vehículo',
        'FINE' => 'Multa', 'DRIVER_WAGE' => 'Sueldo o jornal', 'DRIVER_MEAL' => 'Alimentación', 'DRIVER_TRANSPORT' => 'Movilidad',
        'DELIVERY_BONUS' => 'Bono del repartidor', 'CARRIER_FEE' => 'Empresa de delivery', 'PROVINCE_FREIGHT' => 'Flete a provincia', 'PACKAGING' => 'Empaques', 'OTHER' => 'Otros',
    ];

    public const CANALES = ['WHATSAPP' => 'WhatsApp', 'INSTAGRAM' => 'Instagram', 'TIKTOK' => 'TikTok', 'FACEBOOK' => 'Facebook', 'WEB' => 'Web', 'STORE' => 'Mostrador'];

    public const BANDERAS = ['OK' => 'Válido', 'NO_VALID_RECEIPT' => 'Sin comprobante válido', 'OBSERVED' => 'Observado'];

    public const RENDICIONES = ['OPEN' => 'Abierta', 'SUBMITTED' => 'Enviada', 'APPROVED' => 'Aprobada', 'REIMBURSED' => 'Repuesta', 'REJECTED' => 'Devuelta'];

    /** RN-GAS-07: permiso de cada nivel. */
    public const NIVELES = [1 => 'gas.expense.approve_area', 2 => 'gas.expense.approve_admin', 3 => 'gas.expense.approve_management'];

    public const NOMBRE_NIVEL = [1 => 'jefe de área', 2 => 'administración', 3 => 'gerencia'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function r(mixed $n, int $d = 2): float
    {
        return round((float) $n, $d);
    }

    public static function soles(float $n): string
    {
        return 'S/ '.number_format($n, 2, '.', ',');
    }

    /** Nivel más alto que el usuario puede aprobar (0 si ninguno). */
    public static function nivel(User $u): int
    {
        foreach ([3, 2, 1] as $n) {
            if (Access::can($u, self::NIVELES[$n])) {
                return $n;
            }
        }

        return 0;
    }

    /** Ve todos los gastos (no solo los suyos): ver todo, aprobar, contadora o caja chica. */
    public static function veTodo(User $u): bool
    {
        foreach (['gas.expense.view_all', 'gas.accounting.review', 'gas.petty_cash.manage'] as $p) {
            if (Access::can($u, $p)) {
                return true;
            }
        }

        return self::nivel($u) > 0;
    }

    /** Puede anular un gasto ya aprobado (administración o gerencia, o el módulo con «aprobar»). */
    public static function anulaAprobados(User $u): bool
    {
        return self::nivel($u) >= 2 || Access::module($u, 'GAS', 'A');
    }

    /** Filtro de alcance por marca y local (vacío = todas). Lo propio se ve siempre. */
    public static function alcance(Builder $q, User $u, string $t = 'e'): Builder
    {
        $a = Access::for($u);
        if (! $a['brands'] && ! $a['establishments']) {
            return $q;
        }

        return $q->where(function ($w) use ($a, $u, $t) {
            $w->where("{$t}.created_by", $u->id)->orWhere(function ($x) use ($a, $t) {
                if ($a['brands']) {
                    $x->whereIn("{$t}.brand_id", $a['brands']);
                }
                if ($a['establishments']) {
                    $x->whereIn("{$t}.establishment_id", $a['establishments']);
                }
            });
        });
    }

    /** Número correlativo del módulo (GS-000150, RCC-L1-0004), con un candado para que dos personas no tomen el mismo. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 6): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["gas:{$tabla}:{$prefijo}:".DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $n = strlen($prefijo) + 1;
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, {$n}), '\\D', '', 'g'), '')::bigint) AS n")->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Línea del historial del gasto (jsonb). */
    public static function historia(?string $actual, User $u, string $accion, ?string $nota = null): string
    {
        $h = json_decode($actual ?? '[]', true) ?: [];
        $h[] = array_filter(['at' => CarbonImmutable::now('America/Lima')->format('Y-m-d\TH:i'), 'user' => $u->name, 'action' => $accion, 'note' => $nota]);

        return json_encode(array_slice($h, -60), JSON_UNESCAPED_UNICODE);
    }

    public static function avisar(array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'info'): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
            'tone' => $tono, 'severity' => match ($tono) {
                'bad' => 'CRITICAL', 'warn' => 'WARNING', 'ok' => 'OK', default => 'INFO'
            },
            'module' => 'GAS', 'type' => 'APPROVALS', 'at' => now(), 'in_app' => true,
        ]);
    }
}
