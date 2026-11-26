<?php

namespace App\Modulos\Com\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** Ayudas comunes de COM: fechas en Lima, redondeo, números de documento, IGV, nombres y alcance. */
final class Soporte
{
    public const TIPOS_PROVEEDOR = ['PRODUCER', 'SLAUGHTERHOUSE', 'RELATED_FARM', 'PACKAGING', 'INPUTS', 'SERVICES', 'ADVERTISING', 'CONTENT_CREATOR', 'DELIVERY_COMPANY', 'VEHICLE_RENTAL', 'OTHER'];

    /** Tipos de comprobante del proveedor: [nombre, código SUNAT]. */
    public const TIPOS_DOC = [
        'INVOICE' => ['Factura', '01'], 'RECEIPT' => ['Boleta de venta', '03'], 'FEE_RECEIPT' => ['Recibo por honorarios', '02'],
        'CREDIT_NOTE' => ['Nota de crédito', '07'], 'DEBIT_NOTE' => ['Nota de débito', '08'], 'PURCHASE_SETTLEMENT' => ['Liquidación de compra', '04'],
        'INTERNAL_TRANSFER' => ['Nota de transferencia interna (NTI)', '00'], 'OTHER' => ['Otro (no domiciliado)', '91'],
    ];

    /** Comprobantes que llevan IGV y los que dan crédito fiscal (RN-COM-15). */
    public const CON_IGV = ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_SETTLEMENT'];

    public const CON_CREDITO = ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_SETTLEMENT'];

    public const METODOS = ['TRANSFER', 'CASH', 'CHECK', 'YAPE', 'PLIN', 'INTERNAL_SETTLEMENT', 'OTHER'];

    /** Estado SUNAT con el que un proveedor no recibe OC (RN-COM-11). */
    public const SUNAT_BLOQUEA = ['NOT_LOCATED', 'LOW', 'SUSPENDED'];

    public static function hoy(): string
    {
        return CarbonImmutable::now('America/Lima')->toDateString();
    }

    public static function ahora(): CarbonImmutable
    {
        return CarbonImmutable::now('America/Lima');
    }

    public static function fecha(?string $f): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10), 'America/Lima')->toDateString() : self::hoy();
    }

    public static function dmy(?string $f): string
    {
        return $f ? CarbonImmutable::parse(substr($f, 0, 10))->format('d/m/Y') : '—';
    }

    public static function r(mixed $v, int $d = 2): float
    {
        return round((float) $v, $d);
    }

    /** Texto decimal para la API: «12.50». */
    public static function t(mixed $v, int $d = 2): ?string
    {
        return $v === null ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    public static function soles(mixed $v): string
    {
        return 'S/ '.number_format((float) $v, 2, ',', ' ');
    }

    public static function kg(mixed $v): string
    {
        return number_format((float) $v, 1, ',', ' ').' kg';
    }

    public static function pct(mixed $v, int $d = 1): string
    {
        return number_format((float) $v, $d, ',', '').' %';
    }

    public static function igv(): float
    {
        return (float) (Params::get('fac_igv_rate') ?: 0.18);
    }

    public static function param(string $k): float
    {
        return (float) Params::get($k);
    }

    /** Siguiente número correlativo de COM («OC01-000038», «RC-00059»), con candado de la transacción. */
    public static function numero(string $tabla, string $prefijo, int $largo = 5): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['com:'.$tabla.':'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table($tabla)->where('number', 'like', $prefijo.'%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, ?), '\\D', '', 'g'), '')::int) AS n", [strlen($prefijo) + 1])->value('n');

        return $prefijo.str_pad((string) (((int) $max) + 1), $largo, '0', STR_PAD_LEFT);
    }

    public static function proveedor(?string $id): object
    {
        return ($id ? DB::table('suppliers')->where('id', $id)->first() : null) ?? RuleError::fail('RN-COM-11', 'Elige el proveedor.');
    }

    public static function nombreProveedor(object $s): string
    {
        return $s->trade_name ?: $s->legal_name;
    }

    public static function usuario(?string $id): ?string
    {
        return $id ? DB::table('users')->where('id', $id)->value('name') : null;
    }

    /** Empresa de un local (la de la primera empresa si no hay local). */
    public static function empresaDe(?string $establishmentId): string
    {
        return ($establishmentId ? DB::table('establishments')->where('id', $establishmentId)->value('company_id') : null)
            ?? DB::table('companies')->orderBy('legal_name')->value('id');
    }

    /** El local está dentro del alcance del usuario (sin locales asignados = todos). */
    public static function enAlcance(User $u, ?string $establishmentId): void
    {
        $locales = Access::for($u)['establishments'];
        if ($establishmentId && $locales && ! in_array($establishmentId, $locales, true)) {
            RuleError::fail('SCOPE', 'Ese local no está dentro de tu alcance.');
        }
    }

    public static function permiso(User $u, string $p, string $accion): void
    {
        if (! Access::can($u, $p)) {
            abort(response()->json(['message' => "No tienes permiso para esta acción: {$accion}.", 'code' => 'PERMISSION_DENIED', 'permission' => $p], 403));
        }
    }

    /** «Factura F001-4581». */
    public static function etiquetaDoc(object $d): string
    {
        return (self::TIPOS_DOC[$d->doc_type][0] ?? $d->doc_type).' '.$d->series.'-'.$d->number;
    }

    /** Historial (jsonb) con una entrada más. */
    public static function historial(?string $json, string $accion, ?User $quien): string
    {
        $h = json_decode($json ?? '[]', true) ?: [];
        $h[] = ['at' => self::ahora()->format('Y-m-d\TH:i'), 'user' => $quien?->name, 'action' => $accion];

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }

    /** RUC con su dígito verificador (módulo 11 de la SUNAT). */
    public static function rucValido(string $ruc): bool
    {
        if (! preg_match('/^(10|15|17|20)\d{9}$/', $ruc)) {
            return false;
        }
        $f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
        $s = 0;
        for ($i = 0; $i < 10; $i++) {
            $s += (int) $ruc[$i] * $f[$i];
        }
        $d = 11 - ($s % 11);
        $d = $d === 10 ? 0 : ($d === 11 ? 1 : $d);

        return $d === (int) $ruc[10];
    }

    /** Aviso en la campana para cada rol (lo ven todos sus usuarios). */
    public static function avisar(array $roles, string $titulo, string $cuerpo, string $modulo, string $pantalla, ?string $id, string $tono = 'warn'): void
    {
        foreach ($roles as $rol) {
            DB::table('notifications')->insert([
                'role' => $rol, 'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(array_filter(['screen' => $pantalla, 'id' => $id])),
                'tone' => $tono, 'module' => $modulo, 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
            ]);
        }
    }
}
