<?php

namespace App\Modulos\Onb\Services;

use App\Models\User;
use App\Modulos\Ops\Services\Consola;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Plt\Services\Ruc;
use App\Support\PasswordPolicy;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use App\Support\Correo;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Ramsey\Uuid\Uuid;

/**
 * ONB-01 Registro desde la página pública y ONB-16 Registros y altas (consola).
 *  1. registrar(): RUC con dígito verificador (RN-ONB-01) que no sea ya cliente ni tenga otro registro vivo (RN-ONB-02),
 *     contraseña según la política de SEG; envía un código de 6 caracteres al correo.
 *  2. verificar(): con el código correcto crea la empresa en prueba en una sola operación (RN-ONB-17): la empresa, su
 *     razón social, roles y permisos, los módulos del plan, la administradora con la contraseña que eligió y la
 *     suscripción TRIAL. Desde ahí entra al sistema con su correo y su contraseña.
 *  El código vence (onb_signup_code_hours) y tiene 5 intentos; un registro sin verificar vence (onb_signup_expire_days).
 */
final class Registro
{
    private const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    private const INTENTOS = 5;

    public const ESTADOS = ['PENDING' => 'Por verificar', 'PROVISIONED' => 'Empresa creada', 'EXPIRED' => 'Vencido', 'REJECTED' => 'Rechazado'];

    /** Solo para las pruebas y para revisar en local: el último código enviado. */
    public static ?string $ultimoCodigo = null;

    /** @return array{id: string, email: string} */
    public static function registrar(array $d, ?string $ip, ?string $agente): array
    {
        $ruc = trim($d['ruc']);
        if ($problema = Ruc::problema($ruc)) {
            throw ValidationException::withMessages(['ruc' => [$problema]]);
        }
        if (DB::selectOne('SELECT platform_ruc_in_use(?) AS si', [$ruc])->si) {
            throw ValidationException::withMessages(['ruc' => ['Ese RUC ya tiene una cuenta en GestionCarnica. Si trabajas en esa empresa, pide tu acceso a su administrador o escríbenos por WhatsApp.']]);
        }
        $plan = DB::table('saas_plans')->where('code', $d['plan_code'])->where('status', 'ACTIVE')->first();
        if (! $plan) {
            throw ValidationException::withMessages(['plan_code' => ['Elige uno de los planes.']]);
        }
        $email = mb_strtolower(trim($d['email']));
        $problema = PasswordPolicy::problem(new User(['email' => $email, 'name' => $d['contact_name']]), $d['password']);
        if ($problema) {
            throw ValidationException::withMessages(['password' => [$problema]]);
        }
        self::vencerViejos();

        return DB::transaction(function () use ($d, $ruc, $plan, $email, $ip, $agente) {
            $vivo = DB::table('tenant_signups')->where('ruc', $ruc)->where('status', 'PENDING')->lockForUpdate()->first();
            if ($vivo && $vivo->email !== $email) {
                throw ValidationException::withMessages(['ruc' => ['Ya hay un registro en curso para ese RUC con otro correo. Revisa ese correo o escríbenos por WhatsApp.']]);
            }
            $codigo = self::codigo();
            $datos = [
                'ruc' => $ruc, 'legal_name' => mb_strtoupper(trim($d['legal_name'])), 'trade_name' => trim($d['trade_name']),
                'business_type' => $d['business_type'], 'tax_regime' => $d['tax_regime'], 'fiscal_address' => trim($d['fiscal_address']), 'plan_code' => $plan->code, 'contact_name' => trim($d['contact_name']), 'email' => $email,
                'phone' => $d['phone'] ?? null, 'password_hash' => Hash::make($d['password']), 'code_hash' => Hash::make($codigo),
                'code_expires_at' => now()->addHours((int) Consola::param('onb_signup_code_hours', 48)), 'code_attempts' => 0,
                'source' => isset($d['source']) ? mb_substr($d['source'], 0, 200) : null, 'ip' => $ip ? mb_substr($ip, 0, 45) : null,
                'user_agent' => $agente ? mb_substr($agente, 0, 200) : null, 'updated_at' => now(),
            ];
            // Mismo RUC y mismo correo: se actualiza el registro y se manda un código nuevo (lo pidió otra vez).
            if ($vivo) {
                DB::table('tenant_signups')->where('id', $vivo->id)->update($datos);
                $id = $vivo->id;
            } else {
                $id = DB::table('tenant_signups')->insertGetId($datos + ['status' => 'PENDING', 'created_at' => now()], 'id');
            }
            self::enviarCodigo($email, trim($d['contact_name']), $codigo);

            return ['id' => $id, 'email' => $email];
        });
    }

    /** Con el código correcto crea la empresa en prueba. @return array{tenant_id: string, email: string, trade_name: string, dias: int} */
    public static function verificar(string $email, string $codigo): array
    {
        $email = mb_strtolower(trim($email));
        $s = DB::table('tenant_signups')->where('email', $email)->where('status', 'PENDING')->orderByDesc('updated_at')->first();
        $falla = fn (string $msg) => throw ValidationException::withMessages(['codigo' => [$msg]]);
        if (! $s) {
            $falla('No hay un registro por verificar con ese correo. Regístrate de nuevo.');
        }
        if (! $s->code_expires_at || Carbon::parse($s->code_expires_at)->isPast()) {
            $falla('El código venció. Vuelve a registrarte para recibir uno nuevo.');
        }
        if (! Hash::check(strtoupper(trim($codigo)), (string) $s->code_hash)) {
            $intentos = $s->code_attempts + 1;
            DB::table('tenant_signups')->where('id', $s->id)->update($intentos >= self::INTENTOS
                ? ['code_attempts' => $intentos, 'status' => 'EXPIRED', 'code_hash' => null, 'password_hash' => null, 'updated_at' => now()]
                : ['code_attempts' => $intentos, 'updated_at' => now()]);
            $falla($intentos >= self::INTENTOS ? 'Demasiados intentos: vuelve a registrarte para recibir un código nuevo.'
                : 'El código no es correcto. Te quedan '.(self::INTENTOS - $intentos).' intento(s).');
        }
        // Puede haberse vuelto cliente mientras tanto (por la consola).
        if (DB::selectOne('SELECT platform_ruc_in_use(?) AS si', [$s->ruc])->si) {
            DB::table('tenant_signups')->where('id', $s->id)->update(['status' => 'EXPIRED', 'password_hash' => null, 'code_hash' => null, 'updated_at' => now()]);
            $falla('Ese RUC ya tiene una cuenta en GestionCarnica. Escríbenos por WhatsApp.');
        }
        $plan = DB::table('saas_plans')->where('code', $s->plan_code)->where('status', 'ACTIVE')->first()
            ?? DB::table('saas_plans')->where('status', 'ACTIVE')->orderBy('sort_order')->first();
        $dias = (int) Consola::param('sus_trial_days_default', 14);

        $db = DB::connection();
        try {
            $id = $db->transaction(function () use ($db, $s, $plan, $dias) {
                $id = (string) Uuid::uuid4();
                $db->table('tenant_signups')->where('id', $s->id)->update(['verified_at' => now()]);
                $db->select('SELECT platform_create_tenant_from_signup(?, ?, ?)', [$s->id, $id, Str::slug($s->trade_name).'-'.substr($id, 0, 6).'.gestioncarnica']);
                Empresas::poblar($db, $id, [
                    'legal_name' => $s->legal_name, 'ruc' => $s->ruc, 'trade_name' => $s->trade_name, 'tax_regime' => $s->tax_regime,
                    'fiscal_address' => $s->fiscal_address, 'dominio' => null, 'plan' => $plan, 'dias' => $dias,
                    'admin_name' => $s->contact_name, 'email' => $s->email, 'codigo' => null, 'password_hash' => $s->password_hash,
                    'actor' => 'Registro desde la página', 'actor_type' => 'TENANT_USER', 'actor_id' => null, 'actor_name' => $s->contact_name,
                    'created_by' => null, 'motivo' => "Registro desde la página con el plan {$plan->name} y {$dias} días de prueba",
                ]);
                $db->table('tenant_signups')->where('id', $s->id)->update(['status' => 'PROVISIONED', 'tenant_id' => $id, 'password_hash' => null,
                    'code_hash' => null, 'updated_at' => now()]);

                return $id;
            });
        } finally {
            TenantContext::set(null);
        }
        Consola::bitacora('TENANT_SIGNUP', null, ['actor' => "Registro desde la página: {$s->contact_name}", 'tenant' => $id, 'entity' => 'tenant_signups',
            'entity_id' => $s->id, 'reason' => 'Empresa creada por registro público', 'detail' => ['ruc' => $s->ruc, 'plan' => $plan->code, 'email' => $s->email]]);
        Correo::enviar($s->email, 'Tu cuenta de GestionCarnica está lista', [
            'titulo' => 'Tu cuenta está lista',
            'saludo' => "Hola {$s->contact_name}:",
            'parrafos' => ["{$s->trade_name} ya tiene su cuenta en GestionCarnica, con {$dias} días de prueba del plan {$plan->name}."],
            'pasos' => ["Ingresa con tu correo {$s->email} y la contraseña que elegiste.", 'El asistente te guía para registrar tus marcas y locales.'],
            'boton' => ['texto' => 'Ingresar a GestionCarnica', 'ruta' => '/login'],
        ]);

        return ['tenant_id' => $id, 'email' => $s->email, 'trade_name' => $s->trade_name, 'dias' => $dias];
    }

    /* ------------------------------------------------------------------ ONB-16 (consola) */

    public static function lista(): array
    {
        self::vencerViejos();

        return DB::table('tenant_signups as s')->leftJoin('tenants as t', 't.id', '=', 's.tenant_id')->leftJoin('saas_plans as p', 'p.code', '=', 's.plan_code')
            ->orderByRaw("s.status = 'PENDING' DESC")->orderByDesc('s.created_at')
            ->get(['s.id', 's.ruc', 's.legal_name', 's.trade_name', 's.business_type', 's.plan_code', 'p.name as plan_name', 's.contact_name', 's.email',
                's.phone', 's.status', 's.code_attempts', 's.verified_at', 's.tenant_id', 't.short as tenant_short', 's.rejected_reason', 's.source',
                's.created_at', 's.updated_at'])
            ->map(fn ($r) => array_merge((array) $r, ['status_name' => self::ESTADOS[$r->status], 'business_type_name' => Empresas::RUBROS[$r->business_type] ?? $r->business_type]))
            ->all();
    }

    public static function rechazar(string $id, string $motivo, array $quien): void
    {
        Consola::exigir($quien, 'tenant.create');
        $s = DB::table('tenant_signups')->where('id', $id)->first();
        if (! $s) {
            abort(response()->json(['message' => 'No encontrado.', 'code' => 'NOT_FOUND'], 404));
        }
        if ($s->status !== 'PENDING') {
            RuleError::fail('RN-ONB-02', 'Solo se rechaza un registro por verificar.');
        }
        DB::table('tenant_signups')->where('id', $id)->update(['status' => 'REJECTED', 'rejected_reason' => $motivo, 'rejected_by' => $quien['id'],
            'code_hash' => null, 'password_hash' => null, 'updated_at' => now()]);
        Consola::bitacora('SIGNUP_REJECTED', $quien, ['entity' => 'tenant_signups', 'entity_id' => $id, 'reason' => $motivo, 'detail' => ['ruc' => $s->ruc]]);
    }

    public static function pedidosDemo(): array
    {
        return collect(DB::select('SELECT * FROM platform_demo_requests()'))
            ->map(fn ($r) => array_merge((array) $r, ['interests' => json_decode($r->interests ?? '[]', true) ?: []]))->all();
    }

    public static function atenderDemo(string $id, bool $atendido, ?string $nota, array $quien): void
    {
        DB::select('SELECT platform_attend_demo_request(?, ?, ?, ?)', [$id, $quien['id'], $atendido, $nota]);
        Consola::bitacora($atendido ? 'DEMO_ATTENDED' : 'DEMO_REOPENED', $quien, ['entity' => 'demo_requests', 'entity_id' => $id, 'reason' => $nota]);
    }

    /* ------------------------------------------------------------------ internos */

    /** Registros sin verificar más viejos que onb_signup_expire_days pasan a vencidos (liberan el RUC). */
    private static function vencerViejos(): void
    {
        DB::table('tenant_signups')->where('status', 'PENDING')
            ->where('created_at', '<', now()->subDays((int) Consola::param('onb_signup_expire_days', 7)))
            ->update(['status' => 'EXPIRED', 'code_hash' => null, 'password_hash' => null, 'updated_at' => now()]);
    }

    private static function enviarCodigo(string $email, string $nombre, string $codigo): void
    {
        $horas = (int) Consola::param('onb_signup_code_hours', 48);
        Correo::enviar($email, 'Tu código para activar GestionCarnica', [
            'titulo' => 'Activa tu cuenta',
            'saludo' => "Hola {$nombre}:",
            'parrafos' => ['Gracias por registrarte en GestionCarnica. Escribe este código en la página del registro para activar tu cuenta:'],
            'codigo' => $codigo,
            'vence' => "Vence en {$horas} horas.",
            'nota' => 'Si no te registraste, ignora este correo.',
        ]);
        self::$ultimoCodigo = $codigo;
    }

    private static function codigo(): string
    {
        $c = '';
        for ($i = 0; $i < 6; $i++) {
            $c .= self::ALFABETO[random_int(0, strlen(self::ALFABETO) - 1)];
        }

        return $c;
    }
}
