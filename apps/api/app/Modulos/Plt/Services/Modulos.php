<?php

namespace App\Modulos\Plt\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * Encender y apagar módulos de la empresa (PLT-12). El catálogo (platform_modules) es de toda la
 * plataforma: depends_on son los módulos que necesita sí o sí y uses los que aprovecha si están
 * encendidos. Un módulo apagado oculta sus pantallas, su API responde 403 y no concede permisos
 * (RN-PLT-07, en Access y en el middleware modulo).
 */
final class Modulos
{
    /** Los maneja Intelectalab (consola y suscripción): la empresa no los enciende ni apaga aquí. */
    public const DE_LA_PLATAFORMA = ['OPS', 'SUS'];

    /** Pasos de la lista de activación de TEL (RN-TEL-02). El último se marca solo al encender. */
    public const PASOS_TEL = [
        'PROVIDER_AND_NUMBERS' => ['Proveedor y números contratados', 'El proveedor de telefonía y los números de la central, por marca o generales.'],
        'CARRIER_FORWARDING' => ['Desvío del operador', 'Los celulares de la publicidad desviados a la central, con la constancia del operador.'],
        'RECORDING_NOTICE' => ['Aviso de grabación', '«Esta llamada puede ser grabada para fines de calidad»: audio cargado y probado antes de grabar (Ley 29733).'],
        'SELLER_USERS' => ['Usuarias de las vendedoras', 'Cada vendedora con usuario, extensión y permiso para llamar.'],
        'SIGNED_POLICY' => ['Política de grabación firmada', 'Política de datos personales y de grabación firmada por gerencia.'],
        'SWITCH_ON' => ['Encendido', 'Se marca solo al encender Telefonía.'],
    ];

    /** Encendidos de la empresa: [código => true]. */
    public static function encendidos(): array
    {
        return array_fill_keys(DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all(), true);
    }

    /** Catálogo con depends_on y uses ya decodificados, por código. */
    public static function catalogo(): array
    {
        return DB::table('platform_modules')->orderBy('sort_order')->get()->map(function ($m) {
            $m->depends_on = json_decode($m->depends_on ?? '[]', true) ?: [];
            $m->uses = json_decode($m->uses ?? '[]', true) ?: [];

            return $m;
        })->keyBy('code')->all();
    }

    /** Módulos que necesitan a este (lo tienen en depends_on). */
    public static function dependientes(string $code, ?array $catalogo = null): array
    {
        return array_values(array_keys(array_filter($catalogo ?? self::catalogo(), fn ($m) => in_array($code, $m->depends_on, true))));
    }

    /**
     * Enciende o apaga un módulo, con motivo. Encender exige lo que necesita (RN-PLT-10) y, en TEL, la
     * lista de activación completa (RN-TEL-02); apagar exige que nadie encendido dependa de él, y
     * los módulos núcleo no se apagan (RN-PLT-09).
     */
    public static function cambiar(string $code, bool $encender, string $motivo, User $quien): object
    {
        $min = (int) (Params::get('plt_parameter_reason_min_length') ?? 10);
        if (mb_strlen(trim($motivo)) < $min) {
            RuleError::fail('RN-PLT-06', "Escribe el motivo del cambio (mínimo {$min} caracteres).");
        }
        $catalogo = self::catalogo();
        $m = $catalogo[$code] ?? RuleError::fail('RN-PLT-08', "{$code} no está en el catálogo de módulos.");
        if (in_array($code, self::DE_LA_PLATAFORMA, true)) {
            RuleError::fail('RN-PLT-08', "{$code} lo maneja Intelectalab: no se enciende ni se apaga desde aquí.");
        }

        return DB::transaction(function () use ($code, $m, $encender, $motivo, $quien, $catalogo) {
            $fila = DB::table('tenant_modules')->where('module_code', $code)->lockForUpdate()->first();
            $on = self::encendidos();
            if ($encender === (bool) $fila?->enabled) {
                RuleError::fail('RN-PLT-10', "{$code} ya está ".($encender ? 'encendido.' : 'apagado.'));
            }

            if ($encender) {
                $faltan = array_values(array_filter($m->depends_on, fn ($c) => empty($on[$c])));
                if ($faltan) {
                    $nombres = array_map(fn ($c) => $c.' ('.self::corto($catalogo[$c]->name ?? $c).')', $faltan);
                    RuleError::fail('RN-PLT-10', "Para encender {$code} primero enciende ".implode(', ', $nombres).'.');
                }
                if ($code === 'TEL') {
                    $pendientes = array_filter(self::pasosTel(), fn ($p) => $p['code'] !== 'SWITCH_ON' && ! $p['done']);
                    if ($pendientes) {
                        RuleError::fail('RN-TEL-02', 'La lista de activación de Telefonía está incompleta: falta '
                            .implode('; ', array_map(fn ($p) => $p['no'].'. '.mb_strtolower($p['nombre']), $pendientes)).'.');
                    }
                }
            } else {
                if ($m->is_core) {
                    RuleError::fail('RN-PLT-09', "{$code} es un módulo núcleo y siempre está encendido.");
                }
                $dependen = array_values(array_filter(self::dependientes($code, $catalogo), fn ($c) => ! empty($on[$c])));
                if ($dependen) {
                    RuleError::fail('RN-PLT-10', "No se puede apagar {$code}: ".implode(', ', $dependen).(count($dependen) > 1 ? ' dependen' : ' depende').' de él. Apágalos primero.');
                }
            }

            $ahora = now();
            $datos = ['enabled' => $encender, 'changed_at' => $ahora, 'changed_by' => mb_substr($quien->name, 0, 255),
                'reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => $ahora]
                + ($encender ? ['enabled_at' => $ahora] : ['disabled_at' => $ahora]);
            if ($fila) {
                DB::table('tenant_modules')->where('id', $fila->id)->update($datos);
            } else {
                DB::table('tenant_modules')->insert($datos + ['module_code' => $code, 'phase' => $m->phase]);
            }
            if ($code === 'TEL' && $encender) {
                self::marcarPaso('SWITCH_ON', $quien, trim($motivo));
            }
            Events::emit($encender ? 'module.enabled' : 'module.disabled', 'tenant_modules', $fila?->id, ['module' => $code, 'reason' => trim($motivo)]);
            Access::forget();

            return DB::table('tenant_modules')->where('module_code', $code)->first();
        });
    }

    /** Lista de activación de TEL con lo que hay en la base; un paso sin fila cuenta como pendiente. */
    public static function pasosTel(): array
    {
        $filas = DB::table('tel_activation_steps as s')->leftJoin('users as u', 'u.id', '=', 's.done_by')
            ->select('s.*', 'u.name as done_by_name')->get()->keyBy('step_code');
        $pasos = [];
        $n = 0;
        foreach (self::PASOS_TEL as $code => [$nombre, $descripcion]) {
            $f = $filas->get($code);
            $pasos[] = ['no' => ++$n, 'code' => $code, 'nombre' => $nombre, 'descripcion' => $descripcion, 'done' => (bool) $f?->done,
                'done_at' => $f?->done_at, 'done_by_name' => $f?->done_by_name, 'notes' => $f?->notes];
        }

        return $pasos;
    }

    /** Marca un paso de la lista de TEL con su evidencia (RN-TEL-02). */
    public static function marcarPaso(string $code, User $quien, string $evidencia, ?string $responsableId = null): void
    {
        if (! isset(self::PASOS_TEL[$code])) {
            RuleError::fail('RN-TEL-02', 'Paso no encontrado.');
        }
        if (trim($evidencia) === '') {
            RuleError::fail('RN-TEL-02', 'Cada paso exige responsable, fecha y evidencia: escribe la evidencia.');
        }
        $no = array_search($code, array_keys(self::PASOS_TEL), true) + 1;
        $datos = ['done' => true, 'done_by' => $responsableId ?: $quien->id, 'done_at' => now(), 'notes' => trim($evidencia), 'updated_at' => now()];
        $fila = DB::table('tel_activation_steps')->where('step_code', $code)->first();
        if ($fila) {
            DB::table('tel_activation_steps')->where('id', $fila->id)->update($datos);
        } else {
            DB::table('tel_activation_steps')->insert($datos + ['step_code' => $code, 'step_no' => $no]);
        }
    }

    /** Reabre un paso; con TEL encendido la lista no se deshace. */
    public static function deshacerPaso(string $code): void
    {
        if (! empty(self::encendidos()['TEL'])) {
            RuleError::fail('RN-TEL-02', 'Con Telefonía encendida la lista no se deshace: apágala primero.');
        }
        DB::table('tel_activation_steps')->where('step_code', $code)->update(['done' => false, 'done_at' => null, 'done_by' => null, 'updated_at' => now()]);
    }

    /** «Telefonía» de «Telefonía: central, grabación…». */
    public static function corto(string $nombre): string
    {
        return trim(explode(':', $nombre)[0]);
    }
}
