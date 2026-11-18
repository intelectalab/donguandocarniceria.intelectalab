<?php

namespace App\Modulos\Mae\Services;

use App\Models\User;
use App\Modulos\Cli\Services\Celulares;
use App\Modulos\Plt\Services\CentrosCosto;
use App\Modulos\Seg\Services\Usuarios;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * MAE-01, MAE-02 y MAE-10: trabajadores de la empresa y su vínculo con el usuario.
 *
 *  RN-MAE-01  único por tipo y número de documento; DNI de 8 dígitos, CE y pasaporte de 6 a 15 letras o dígitos.
 *  RN-MAE-02  la baja guarda la fecha de cese (hoy si no se indica) y desactiva su usuario (cierra sesiones y revoca
 *             celulares, RN-SEG-18). Un trabajador inactivo no se asigna a rutas, cajas ni tareas nuevas: activo().
 *  RN-MAE-13  a lo más un usuario vigente (activo, bloqueado o invitado) por trabajador.
 *
 * Para otros módulos: Trabajadores::activo($id) antes de asignar a alguien a una ruta, caja o tarea.
 */
final class Trabajadores
{
    public const TIPOS_DOC = ['DNI', 'CE', 'PASSPORT'];

    public const MOTIVOS_CESE = ['Renuncia voluntaria', 'Término de contrato', 'Despido', 'Abandono de trabajo', 'Jubilación', 'Fallecimiento', 'Otro'];

    /** Estados de usuario que cuentan como vigentes para RN-MAE-13. */
    public const USUARIO_VIGENTE = ['ACTIVE', 'LOCKED', 'INVITED'];

    /** RN-MAE-02: falla si el trabajador no existe o está dado de baja. */
    public static function activo(string $id): object
    {
        $e = DB::table('employees')->where('id', $id)->first() ?? RuleError::fail('RN-MAE-02', 'El trabajador no existe.');
        if ($e->status !== 'ACTIVE') {
            $desde = $e->terminated_on ? ' desde el '.date('d/m/Y', strtotime($e->terminated_on)) : '';
            RuleError::fail('RN-MAE-02', "{$e->full_name} está dado de baja{$desde}: no se le asignan rutas, cajas ni tareas nuevas.");
        }

        return $e;
    }

    /** RN-MAE-01: devuelve el número normalizado (sin espacios, en mayúsculas). */
    public static function documento(string $tipo, ?string $numero): string
    {
        if (! in_array($tipo, self::TIPOS_DOC, true)) {
            RuleError::fail('RN-MAE-01', 'Tipo de documento no válido: usa DNI, CE o pasaporte.');
        }
        $n = strtoupper(preg_replace('/\s+/', '', (string) $numero));
        if ($tipo === 'DNI' && ! preg_match('/^\d{8}$/', $n)) {
            RuleError::fail('RN-MAE-01', "El DNI tiene 8 dígitos: «{$n}» no es válido.");
        }
        if ($tipo !== 'DNI' && ! preg_match('/^[A-Z0-9]{6,15}$/', $n)) {
            RuleError::fail('RN-MAE-01', "El carné de extranjería o pasaporte tiene de 6 a 15 letras o dígitos: «{$n}» no es válido.");
        }

        return $n;
    }

    /** Valida y arma los datos comunes del alta y la edición. */
    private static function datos(array $d): array
    {
        if (! DB::table('establishments')->where('id', $d['establishment_id'])->exists()) {
            RuleError::fail('RN-MAE-01', 'El local no existe.');
        }
        CentrosCosto::activo($d['cost_center_id']);
        $celular = Celulares::normalizar($d['phone'] ?? null);
        if ($celular && ! Celulares::valido($celular)) {
            RuleError::fail('RN-MAE-01', 'El celular va con código de país, por ejemplo +51987654321.');
        }

        return [
            'full_name' => trim($d['full_name']), 'position' => trim($d['position']), 'establishment_id' => $d['establishment_id'],
            'cost_center_id' => $d['cost_center_id'], 'hire_date' => $d['hire_date'], 'phone' => $celular,
            'email' => ($e = trim((string) ($d['email'] ?? ''))) === '' ? null : mb_strtolower($e),
        ];
    }

    public static function crear(array $d, User $quien): object
    {
        $numero = self::documento($d['doc_type'], $d['doc_number']);
        if (DB::table('employees')->where(['doc_type' => $d['doc_type'], 'doc_number' => $numero])->exists()) {
            RuleError::fail('RN-MAE-01', "Ya existe un trabajador con {$d['doc_type']} {$numero}.");
        }

        return DB::transaction(function () use ($d, $numero, $quien) {
            $id = DB::table('employees')->insertGetId(array_merge(self::datos($d), [
                'doc_type' => $d['doc_type'], 'doc_number' => $numero, 'status' => 'ACTIVE',
            ]));
            Events::emit('employee.created', 'employees', $id, ['by' => $quien->id]);

            return DB::table('employees')->find($id);
        });
    }

    /** El documento no se cambia (identifica al trabajador); el resto sí, solo si está activo. */
    public static function actualizar(object $e, array $d): object
    {
        if ($e->status !== 'ACTIVE') {
            RuleError::fail('RN-MAE-02', "{$e->full_name} está dado de baja: su ficha ya no se edita.");
        }
        DB::table('employees')->where('id', $e->id)->update(array_merge(self::datos($d), ['updated_at' => now()]));

        return DB::table('employees')->find($e->id);
    }

    /**
     * RN-MAE-02: baja con fecha (hoy si no se indica) y motivo. Desactiva su usuario vigente con el servicio de
     * Seguridad, que cierra sus sesiones y revoca sus celulares.
     *
     * @return array{trabajador: object, usuarios: int, sesiones: int}
     */
    public static function darDeBaja(object $e, ?string $fecha, string $motivo, User $quien): array
    {
        if ($e->status !== 'ACTIVE') {
            RuleError::fail('RN-MAE-02', "{$e->full_name} ya está dado de baja.");
        }
        $fecha = $fecha ?: now('America/Lima')->toDateString();
        if ($fecha < $e->hire_date) {
            RuleError::fail('RN-MAE-02', 'La fecha de cese no puede ser anterior a la fecha de ingreso.');
        }

        return DB::transaction(function () use ($e, $fecha, $motivo, $quien) {
            DB::table('employees')->where('id', $e->id)->update([
                'status' => 'INACTIVE', 'terminated_on' => $fecha, 'termination_reason' => mb_substr(trim($motivo), 0, 255), 'updated_at' => now(),
            ]);
            $usuarios = 0;
            $sesiones = 0;
            foreach (User::where('employee_id', $e->id)->whereIn('status', ['ACTIVE', 'LOCKED', 'INVITED'])->get() as $u) {
                $antes = DB::table('personal_access_tokens')->where('tokenable_type', User::class)->where('tokenable_id', $u->id)->count();
                Usuarios::desactivar($u, "Cese del trabajador: {$motivo}", $quien);
                $sesiones += $antes;
                $usuarios++;
            }
            Events::emit('employee.terminated', 'employees', $e->id, ['date' => $fecha, 'reason' => trim($motivo), 'users' => $usuarios, 'by' => $quien->id]);

            return ['trabajador' => DB::table('employees')->find($e->id), 'usuarios' => $usuarios, 'sesiones' => $sesiones];
        });
    }

    /** RN-MAE-13: vincula un usuario libre al trabajador activo. */
    public static function vincularUsuario(object $e, string $userId): User
    {
        if ($e->status !== 'ACTIVE') {
            RuleError::fail('RN-MAE-02', "{$e->full_name} está dado de baja: no se le vincula un usuario.");
        }
        $u = User::whereNull('customer_id')->find($userId) ?? RuleError::fail('RN-MAE-13', 'El usuario no existe.');
        if (in_array($u->role, Usuarios::NO_ASIGNABLES, true)) {
            RuleError::fail('RN-MAE-13', "El usuario {$u->email} no es de un trabajador de la empresa: no se vincula.");
        }
        if (! in_array($u->status, self::USUARIO_VIGENTE, true)) {
            RuleError::fail('RN-MAE-13', "El usuario {$u->email} está inactivo: reactívalo en Seguridad antes de vincularlo.");
        }
        $otro = User::where('employee_id', $e->id)->where('id', '<>', $u->id)->whereIn('status', self::USUARIO_VIGENTE)->first();
        if ($otro) {
            RuleError::fail('RN-MAE-13', "{$e->full_name} ya tiene el usuario vigente {$otro->email}: desactívalo antes de vincular otro.");
        }
        if ($u->employee_id && $u->employee_id !== $e->id && DB::table('employees')->where(['id' => $u->employee_id, 'status' => 'ACTIVE'])->exists()) {
            RuleError::fail('RN-MAE-13', "El usuario {$u->email} ya está vinculado a otro trabajador activo.");
        }
        $u->forceFill(['employee_id' => $e->id, 'updated_at' => now()])->save();
        Events::emit('employee.user_linked', 'employees', $e->id, ['user_id' => $u->id]);

        return $u;
    }
}
