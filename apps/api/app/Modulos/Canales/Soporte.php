<?php

namespace App\Modulos\Canales;

use App\Models\User;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Ayudas comunes de los módulos del bloque «Nuevos canales» (CON, B2B y CMP): fechas en Lima, cifras
 * como texto, numeración, avisos y la traducción de las restricciones de la base a reglas de la spec.
 */
final class Soporte
{
    /** Restricción de la base => [regla, mensaje para la persona]. */
    private const RESTRICCIONES = [
        'consignment_contracts_sin_traslape' => ['RN-CON-03', 'El punto ya tiene un contrato activo en esas fechas: las vigencias no se traslapan.'],
        'consignment_deliveries_gre' => ['RN-CON-07', 'Una entrega despachada lleva la serie y el número de su guía de remisión.'],
        'cvc_vendido' => ['RN-CON-12', 'Las cantidades del conteo no cuadran con el stock teórico.'],
        'cel_baja_con_motivo' => ['RN-CON-23', 'Dar de baja un equipo exige motivo.'],
        'cvp_equipo_con_temperatura' => ['RN-CON-14', 'La foto del equipo lleva la lectura de temperatura.'],
        'consignment_margin_tiers_contract_id_from_amount_unique' => ['RN-CON-21', 'Los tramos de un contrato no repiten su monto inicial.'],
        'consignment_visits_una_por_dia' => ['RN-CON-08', 'El punto ya tiene una visita ese día.'],
        'consignment_points_customer_id_unique' => ['RN-CON-01', 'Ese cliente ya es un punto de consignación.'],
        'consignment_points_warehouse_id_unique' => ['RN-CON-02', 'Ese almacén ya es de otro punto: un almacén no se comparte.'],
        'consignment_contracts_tenant_id_number_unique' => ['RN-CON-03', 'Ya existe un contrato con ese número.'],
        'consignment_equipment_loans_tenant_id_asset_code_unique' => ['RN-CON-23', 'Ya existe un equipo prestado con ese código.'],
        'customer_prices_sin_traslape' => ['RN-B2B-06', 'Ya hay un precio para esa presentación en esas fechas: las vigencias no se traslapan.'],
        'credit_exceptions_otra_persona' => ['RN-B2B-05', 'Quien solicita la excepción no la aprueba.'],
        'recurring_order_runs_recurring_order_id_delivery_date_unique' => ['RN-B2B-09', 'Ya hay una corrida para esa programación y fecha.'],
        'b2b_claims_evidencia' => ['RN-B2B-17', 'Un reclamo de calidad o de peso lleva al menos una foto, y uno resuelto con abono lleva su nota de crédito.'],
        'b2b_portal_accounts_user_id_unique' => ['RN-B2B-12', 'Esa persona ya tiene acceso al portal de otro cliente.'],
        'users_tenant_id_email_unique' => ['RN-B2B-12', 'Ya existe un usuario con ese correo.'],
        'coupons_codigo_unico' => ['RN-CMP-07', 'Ya existe un cupón con ese código.'],
        'coupons_valores' => ['RN-CMP-07', 'Revisa el cupón: la vigencia empieza antes de terminar y el porcentaje va de 0 a 100.'],
        'coupon_redemptions_un_cupon_por_pedido' => ['RN-CMP-10', 'Un pedido acepta un solo cupón.'],
        'campaigns_aprueba_otra_persona' => ['RN-CMP-02', 'Quien crea la campaña no la aprueba.'],
        'loyalty_ledger_un_abono_por_cobro' => ['RN-CMP-11', 'Ese cobro ya sumó sus puntos.'],
        'loyalty_ledger_un_reverso' => ['RN-CMP-13', 'Ese movimiento ya se reversó.'],
        'referrals_referred_customer_id_unique' => ['RN-CMP-14', 'Ese cliente ya fue referido.'],
        'referrals_otro_cliente' => ['RN-CMP-14', 'Un cliente no se refiere a sí mismo.'],
        'customer_segments_tenant_id_code_unique' => ['RN-CMP-01', 'Ya existe un segmento con ese código.'],
    ];

    public static function base(Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            $msg = $e->getMessage();
            foreach (self::RESTRICCIONES as $restriccion => [$regla, $texto]) {
                if (str_contains($msg, $restriccion)) {
                    RuleError::fail($regla, $texto);
                }
            }
            if (str_contains($msg, 'El vencimiento no puede ser anterior a la emisión')) {
                RuleError::fail('RN-B2B-08', 'El vencimiento no puede ser anterior a la emisión.');
            }
            throw $e;
        }
    }

    public static function hoy(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima')->startOfDay();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    /** Fecha AAAA-MM-DD en Lima (hoy si viene vacía). */
    public static function fecha(?string $f = null): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10), 'America/Lima')->toDateString() : self::hoy()->toDateString();
    }

    /** Días de $desde a $hasta (negativo si $hasta es antes). */
    public static function dias(string $desde, string $hasta): int
    {
        return (int) CarbonImmutable::parse(substr($desde, 0, 10), 'America/Lima')->diffInDays(CarbonImmutable::parse(substr($hasta, 0, 10), 'America/Lima'), false);
    }

    public static function masDias(string $fecha, int $n): string
    {
        return CarbonImmutable::parse(substr($fecha, 0, 10), 'America/Lima')->addDays($n)->toDateString();
    }

    /** Cifra como texto para la API («288.00»). */
    public static function t(mixed $v, int $d = 2): ?string
    {
        return $v === null ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    public static function r(mixed $v, int $d = 2): float
    {
        return round((float) $v, $d);
    }

    /** «S/ 1 234,50» para los mensajes. */
    public static function soles(mixed $v): string
    {
        return 'S/ '.number_format((float) $v, 2, ',', ' ');
    }

    /** «13/11/2026» para los mensajes. */
    public static function dmy(?string $f): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10))->format('d/m/Y') : '';
    }

    public static function num(string $param, mixed $porDefecto = 0): float
    {
        $v = Params::get($param);

        return is_numeric($v) ? (float) $v : (float) $porDefecto;
    }

    public static function texto(string $param, string $porDefecto = ''): string
    {
        $v = Params::get($param);
        $v = is_string($v) ? trim($v, " \"") : $v;

        return $v === null || $v === '' ? $porDefecto : (string) $v;
    }

    /** Siguiente número correlativo con prefijo («EC-00020»), con candado por empresa. */
    public static function numero(string $tabla, string $prefijo, int $digitos = 5, string $columna = 'number'): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['canales:'.$tabla.':'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table($tabla)->where($columna, 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr({$columna}, ?), '\\D', '', 'g'), '')::int) AS n", [strlen($prefijo) + 1])->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $digitos, '0', STR_PAD_LEFT);
    }

    /** Motivo obligatorio (no vacío), recortado a 255. */
    public static function motivo(?string $m, string $regla, string $mensaje): string
    {
        $m = trim((string) $m);
        $m !== '' || RuleError::fail($regla, $mensaje);

        return mb_substr($m, 0, 255);
    }

    public static function nombre(?string $userId): ?string
    {
        return $userId ? DB::table('users')->where('id', $userId)->value('name') : null;
    }

    /** Aviso en la app a una persona (user_id) o a un rol (role), sin repetir la misma clave. */
    public static function avisar(string $modulo, array $para, string $titulo, string $cuerpo, string $pantalla, ?string $id, string $tono = 'warn', ?string $clave = null): bool
    {
        if ($clave && DB::table('notifications')->where('module', $modulo)->whereRaw("ref->>'key' = ?", [$clave])
            ->when($para['user_id'] ?? null, fn ($q, $u) => $q->where('user_id', $u))
            ->when($para['role'] ?? null, fn ($q, $r) => $q->where('role', $r))->exists()) {
            return false;
        }
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id, 'key' => $clave])),
            'tone' => $tono, 'module' => $modulo, 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
        ]);

        return true;
    }

    /** Usuario de sistema para las tareas programadas: un gerente activo de la empresa. */
    public static function sistema(): User
    {
        $id = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', 'GERENTE')->where('u.status', 'ACTIVE')->orderBy('u.name')->value('u.id');

        return User::findOrFail($id);
    }

    /** El enviador de WhatsApp registrado (CRM) o, sin él, la cola de mensajes. */
    public static function whatsapp(): Mensajes\EnviadorWhatsapp
    {
        return app()->bound(Mensajes\EnviadorWhatsapp::class) ? app(Mensajes\EnviadorWhatsapp::class) : new Mensajes\MensajeEnCola;
    }

    /** Agrega una entrada al historial jsonb de una fila. */
    public static function historial(?string $actual, array $entrada): string
    {
        $h = json_decode($actual ?? '[]', true) ?: [];
        $h[] = $entrada;

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }
}
