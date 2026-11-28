<?php

namespace App\Modulos\Onb\Services;

use App\Models\User;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Ops\Services\Empresas;
use App\Modulos\Plt\Services\Correlativo;
use App\Modulos\Sus\Services\Suscripcion;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;

/**
 * ONB · Asistente de alta de empresas (ONB-02 a ONB-10, ONB-14 y ONB-15; RN-ONB-03 a 07, 18 y 19).
 */
final class Asistente
{
    /** Pasos del alta: [código, nombre, pantalla, obligatorio, prerrequisitos, rol responsable]. */
    public const PASOS = [
        ['COMPANY', 'Empresa', 'ONB-03', true, [], 'ADMIN_SISTEMA'],
        ['BRANDS', 'Marcas', 'ONB-04', true, ['COMPANY'], 'ADMIN_SISTEMA'],
        ['ESTABLISHMENTS', 'Locales', 'ONB-05', true, ['COMPANY'], 'ADMIN_SISTEMA'],
        ['WAREHOUSES', 'Almacenes', 'ONB-05', false, ['ESTABLISHMENTS'], 'ALMACENERO'],
        ['SERIES', 'Series de comprobantes', 'ONB-06', true, ['COMPANY', 'ESTABLISHMENTS'], 'CONTADORA'],
        ['EINVOICE', 'Comprobante electrónico (OSE)', 'ONB-06', true, ['SERIES'], 'CONTADORA'],
        ['PAYMENT_METHODS', 'Medios de pago y cajas', 'ONB-07', false, ['COMPANY'], 'ADMINISTRACION'],
        ['WHATSAPP', 'Números de WhatsApp', 'ONB-08', false, ['BRANDS'], 'SUPERVISORA_VENTAS'],
        ['DELIVERY_ZONES', 'Zonas de reparto', 'ONB-09', false, ['ESTABLISHMENTS'], 'COORDINADOR_DELIVERY'],
        ['TEMPLATE', 'Plantilla por rubro', 'ONB-10', false, ['BRANDS'], 'ADMIN_SISTEMA'],
        ['IMPORT_PRODUCTS', 'Importar productos', 'ONB-11', false, ['BRANDS'], 'ADMINISTRACION'],
        ['IMPORT_CUSTOMERS', 'Importar clientes', 'ONB-11', false, 'DELIVERY_ZONES', 'ADMINISTRACION'],
        ['IMPORT_STOCK', 'Importar stock inicial', 'ONB-11', false, ['WAREHOUSES', 'IMPORT_PRODUCTS'], 'ALMACENERO'],
        ['IMPORT_BALANCES', 'Importar saldos', 'ONB-11', false, ['IMPORT_CUSTOMERS'], 'CONTADORA'],
        ['USERS', 'Usuarios e invitaciones', 'ONB-14', false, ['BRANDS', 'ESTABLISHMENTS'], 'ADMIN_SISTEMA'],
        ['GO_LIVE', 'Salida a producción', 'ONB-15', true, ['*'], 'GERENTE'],
    ];

    public const OBLIGATORIOS_FIJOS = ['COMPANY', 'BRANDS', 'ESTABLISHMENTS', 'SERIES', 'EINVOICE', 'GO_LIVE'];

    public const OMITIR_SIRVE_DE_PRERREQUISITO = ['IMPORT_PRODUCTS', 'DELIVERY_ZONES', 'TEMPLATE', 'IMPORT_CUSTOMERS'];

    public const ROLES_CON_2FA = ['GERENTE', 'ADMIN_SISTEMA', 'ADMINISTRACION', 'CONTADORA'];

    public const TIPOS_ALMACEN = [
        'MAIN' => 'Almacén principal (seco)',
        'COLD_ROOM' => 'Cámara de frío',
        'FREEZER' => 'Congeladora',
        'STORE' => 'Tienda o exhibidora',
        'QUARANTINE' => 'Cuarentena',
        'PRODUCTION' => 'Sala de producción',
    ];

    public const MEDIOS_PAGO = [
        ['CASH', 'Efectivo', 'CASH', false, true],
        ['YAPE', 'Yape', 'WALLET', true, true],
        ['PLIN', 'Plin', 'WALLET', true, true],
        ['CARD', 'Tarjeta (POS)', 'CARD', true, true],
        ['GATEWAY', 'Pasarela web', 'GATEWAY', true, false],
        ['TRANSFER', 'Transferencia bancaria', 'BANK', true, false],
    ];

    public const TIPOS_ITEM_PLANTILLA = [
        'CATEGORY' => 'Categoría',
        'PRODUCT' => 'Producto',
        'VARIANT' => 'Presentación',
        'CUT' => 'Corte',
        'BREAKDOWN' => 'Despiece',
        'RECIPE' => 'Receta',
        'CHECKLIST' => 'Checklist',
        'KPI_TARGET' => 'Meta de indicador',
        'PARAMETER' => 'Parámetro',
        'ROLE' => 'Rol',
        'EXPENSE_CATEGORY' => 'Categoría de gasto',
        'DELIVERY_SLOT' => 'Franja de entrega',
    ];

    /** @return array<string, array{code: string, name: string, screen: string, required: bool, pre: array<int, string>, owner: string}> */
    public static function mapaPasos(): array
    {
        $out = [];
        foreach (self::PASOS as [$code, $name, $screen, $req, $pre, $owner]) {
            $out[$code] = [
                'code' => $code,
                'name' => $name,
                'screen' => $screen,
                'required' => $req,
                'pre' => is_array($pre) ? $pre : [$pre],
                'owner' => $owner,
            ];
        }

        return $out;
    }

    public static function nombrePaso(string $code): string
    {
        return self::mapaPasos()[$code]['name'] ?? $code;
    }

    public static function plantillaDeRubro(?string $rubro): string
    {
        return match ($rubro) {
            'CHARCUTERIA' => 'CHARCUTERIA',
            'AVICOLA' => 'AVICOLA',
            'GOURMET', 'TIENDA_GOURMET' => 'TIENDA_GOURMET',
            default => 'DISTRIBUIDORA_CARNES',
        };
    }

    /** Devuelve la corrida de alta de la empresa en contexto (si no existe, la crea con sus 16 pasos). */
    public static function corridaActual(): object
    {
        $tenantId = TenantContext::id();
        $run = DB::table('onboarding_runs')
            ->orderByRaw("status = 'IN_PROGRESS' DESC")
            ->orderByDesc('started_at')
            ->first();
        if ($run) {
            return $run;
        }

        return DB::transaction(function () use ($tenantId) {
            $t = DB::table('tenants')->where('id', $tenantId)->first();
            $co = DB::table('companies')->orderBy('created_at')->first();
            $sub = Suscripcion::vigente();
            $ind = self::plantillaDeRubro($t->business_type ?? 'DISTRIBUIDORA_CARNES');
            $tpl = DB::table('industry_templates')->where('code', $ind)->where('status', 'PUBLISHED')->first();
            $admin = DB::table('users')->whereIn('role', ['ADMIN_SISTEMA', 'GERENTE'])->orderBy('created_at')->first();

            $runId = DB::table('onboarding_runs')->insertGetId([
                'tenant_id' => $tenantId,
                'industry' => $ind,
                'industry_template_id' => $tpl?->id,
                'plan_code' => $sub->plan_code ?? ($t->plan ?? 'CRECIMIENTO'),
                'status' => 'IN_PROGRESS',
                'started_at' => now(),
                'planned_go_live' => now()->addDays(14)->toDateString(),
                'owner_user_id' => $admin?->id,
                'company_id' => $co?->id,
                'subscription_id' => $sub?->id,
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            foreach (self::PASOS as $idx => [$code, , , $req, , $owner]) {
                DB::table('onboarding_steps')->insert([
                    'tenant_id' => $tenantId,
                    'run_id' => $runId,
                    'step_code' => $code,
                    'seq' => $idx + 1,
                    'is_required' => $req,
                    'status' => 'PENDING',
                    'owner_role' => $owner,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            return DB::table('onboarding_runs')->where('id', $runId)->first();
        });
    }

    public static function pasosDe(?string $runId = null): array
    {
        $run = $runId ? DB::table('onboarding_runs')->where('id', $runId)->first() : self::corridaActual();
        $mapa = self::mapaPasos();
        $roles = DB::table('roles')->pluck('name', 'code');
        $filas = DB::table('onboarding_steps')->where('run_id', $run->id)->orderBy('seq')->get();

        return $filas->map(function ($s) use ($run, $mapa, $roles, $filas) {
            $def = $mapa[$s->step_code] ?? ['name' => $s->step_code, 'screen' => 'ONB-02', 'pre' => []];
            $faltan = self::prerrequisitosFaltantes($run, $s->step_code, $filas);

            return [
                'id' => $s->id,
                'seq' => (int) $s->seq,
                'step_code' => $s->step_code,
                'name' => $def['name'],
                'screen' => $def['screen'],
                'url' => '/m/onb/'.strtolower($def['screen']),
                'is_required' => (bool) $s->is_required,
                'is_fixed_required' => in_array($s->step_code, self::OBLIGATORIOS_FIJOS, true),
                'status' => $s->status,
                'blocked_reason' => $s->blocked_reason,
                'completed_at' => $s->completed_at,
                'completed_by' => $s->completed_by,
                'owner_role' => $s->owner_role,
                'owner_role_name' => $roles[$s->owner_role] ?? $s->owner_role,
                'prerequisites' => array_map(fn ($p) => [
                    'code' => $p,
                    'name' => $p === '*' ? 'Todo lo obligatorio' : self::nombrePaso($p),
                    'missing' => in_array($p, $faltan, true),
                ], $def['pre']),
                'missing_prerequisites' => array_map(fn ($p) => self::nombrePaso($p), $faltan),
            ];
        })->all();
    }

    public static function prerrequisitosFaltantes(object $run, string $code, $filas = null): array
    {
        $def = self::mapaPasos()[$code] ?? null;
        if (! $def) {
            return [];
        }
        $filas ??= DB::table('onboarding_steps')->where('run_id', $run->id)->orderBy('seq')->get();
        if (($def['pre'][0] ?? null) === '*') {
            return $filas->filter(fn ($s) => $s->step_code !== 'GO_LIVE' && (in_array($s->status, ['PENDING', 'BLOCKED'], true) || ($s->is_required && $s->status !== 'DONE')))
                ->pluck('step_code')->values()->all();
        }
        $out = [];
        foreach ($def['pre'] as $p) {
            $st = $filas->firstWhere('step_code', $p);
            $ok = $st && ($st->status === 'DONE' || ($st->status === 'SKIPPED' && in_array($p, self::OMITIR_SIRVE_DE_PRERREQUISITO, true)));
            if (! $ok) {
                $out[] = $p;
            }
        }

        return $out;
    }

    public static function exigirPrerrequisitos(object $run, string $code): void
    {
        if ($run->status !== 'IN_PROGRESS') {
            return;
        }
        $faltan = self::prerrequisitosFaltantes($run, $code);
        if ($faltan) {
            $nombres = array_map(fn ($c) => self::nombrePaso($c), $faltan);
            RuleError::fail($code === 'GO_LIVE' ? 'RN-ONB-05' : 'RN-ONB-06', '«'.self::nombrePaso($code).'» requiere completar antes: '.implode(', ', $nombres).'.');
        }
    }

    public static function avance(object $run, ?array $pasos = null): array
    {
        $pasos ??= self::pasosDe($run->id);
        $req = array_filter($pasos, fn ($s) => $s['is_required']);
        $doneReq = array_filter($req, fn ($s) => $s['status'] === 'DONE');
        $allDone = array_filter($pasos, fn ($s) => $s['status'] === 'DONE');
        $pending = array_filter($pasos, fn ($s) => $s['status'] === 'PENDING');
        $next = collect($pasos)->first(fn ($s) => $s['status'] === 'PENDING' && empty($s['missing_prerequisites']))
            ?? collect($pasos)->first(fn ($s) => $s['status'] === 'PENDING');

        $days = max(0, (int) Carbon::parse($run->started_at)->startOfDay()->diffInDays(Carbon::parse($run->completed_at ?? now())->startOfDay()));
        $kpi02 = $run->first_accepted_document_at
            ? max(0, (int) Carbon::parse($run->started_at)->startOfDay()->diffInDays(Carbon::parse($run->first_accepted_document_at)->startOfDay()))
            : null;

        return [
            'pct' => count($req) ? round(count($doneReq) * 100 / count($req), 1) : 0.0,
            'done' => count($doneReq),
            'req' => count($req),
            'all' => count($pasos),
            'all_done' => count($allDone),
            'pending' => count($pending),
            'days' => $days,
            'kpi_onb_02_days' => $kpi02,
            'next_step' => $next,
        ];
    }

    /** ONB-02: estado general del alta, pasos y KPIs. */
    public static function estadoGeneral(): array
    {
        $run = self::corridaActual();
        // Si ya hay un comprobante aceptado en la empresa y la corrida aún no lo registró, lo toma.
        if (! $run->first_accepted_document_at) {
            $firstDoc = DB::table('sales_documents')
                ->whereIn('doc_type', ['RECEIPT', 'INVOICE'])
                ->whereIn('sunat_status', ['ACCEPTED', 'OBSERVED'])
                ->where('status', 'ISSUED')
                ->orderBy('accepted_at')
                ->first();
            if ($firstDoc) {
                DB::table('onboarding_runs')->where('id', $run->id)->update([
                    'first_accepted_document_at' => $firstDoc->accepted_at ?? $firstDoc->issued_at ?? now(),
                    'first_document_id' => $firstDoc->id,
                    'updated_at' => now(),
                ]);
                $run = DB::table('onboarding_runs')->where('id', $run->id)->first();
            }
        }

        $pasos = self::pasosDe($run->id);
        $avance = self::avance($run, $pasos);
        $sub = Suscripcion::vigente();
        $t = DB::table('tenants')->where('id', TenantContext::id())->first();
        $firstDoc = $run->first_document_id ? DB::table('sales_documents')->where('id', $run->first_document_id)->first(['id', 'full_number', 'total', 'customer_name', 'accepted_at']) : null;

        $imps = DB::table('data_imports')->whereIn('status', ['COMPLETED', 'VALIDATED', 'FAILED_VALIDATION'])->selectRaw('coalesce(sum(total_rows),0) as tot, coalesce(sum(error_rows),0) as err')->first();
        $kpi03 = ((int) $imps->tot) > 0 ? round(((int) $imps->err) * 100 / ((int) $imps->tot), 2) : 0.0;

        return [
            'run' => [
                'id' => $run->id,
                'tenant_id' => $run->tenant_id,
                'tenant_name' => $t->short ?? $t->name ?? 'Empresa',
                'industry' => $run->industry,
                'plan_code' => $sub->plan_code ?? $run->plan_code,
                'status' => $run->status,
                'started_at' => $run->started_at,
                'completed_at' => $run->completed_at,
                'go_live_at' => $run->go_live_at,
                'planned_go_live' => $run->planned_go_live,
                'first_accepted_document_at' => $run->first_accepted_document_at,
                'first_document' => $firstDoc,
                'company_id' => $run->company_id,
            ],
            'subscription' => $sub ? [
                'status' => $sub->status,
                'plan_code' => $sub->plan_code,
                'trial_ends_at' => $sub->trial_ends_at,
            ] : null,
            'progress' => $avance,
            'kpi_onb_03_error_pct' => $kpi03,
            'reminder_days' => (int) (Params::get('onb_pending_step_reminder_days') ?? 3),
            'steps' => $pasos,
        ];
    }

    /** Marca automáticamente un paso como hecho cuando su pantalla guarda datos válidos. */
    public static function autoCompletar(object $run, string $code, ?User $u = null): void
    {
        if ($run->status !== 'IN_PROGRESS') {
            return;
        }
        $st = DB::table('onboarding_steps')->where('run_id', $run->id)->where('step_code', $code)->first();
        if ($st && $st->status !== 'DONE') {
            DB::table('onboarding_steps')->where('id', $st->id)->update([
                'status' => 'DONE',
                'completed_at' => now(),
                'completed_by' => $u ? mb_substr($u->name, 0, 120) : 'Sistema',
                'blocked_reason' => null,
                'updated_at' => now(),
            ]);
            Events::emit('onboarding.step_completed', 'onboarding_steps', $st->id, ['run_id' => $run->id, 'step' => $code]);
        }
    }

    /** ONB-02: completar un paso manualmente (verifica prerrequisitos y evidencia mínima). */
    public static function completarPaso(string $code, User $u, array $opts = []): array
    {
        $run = self::corridaActual();
        $st = DB::table('onboarding_steps')->where('run_id', $run->id)->where('step_code', $code)->first()
            ?? RuleError::fail('RN-ONB-04', "El paso {$code} no existe en esta alta.");
        if ($st->status === 'DONE') {
            return self::estadoGeneral();
        }
        self::exigirPrerrequisitos($run, $code);

        if ($code === 'GO_LIVE') {
            $pendReq = DB::table('onboarding_steps')
                ->where('run_id', $run->id)
                ->where('step_code', '<>', 'GO_LIVE')
                ->where(fn ($q) => $q->whereIn('status', ['PENDING', 'BLOCKED'])->orWhere(fn ($w) => $w->where('is_required', true)->where('status', '<>', 'DONE')))
                ->pluck('step_code')->all();
            if ($pendReq) {
                $nombres = array_map(fn ($c) => self::nombrePaso($c), $pendReq);
                RuleError::fail('RN-ONB-05', 'No se puede salir a producción con pasos pendientes: '.implode(', ', $nombres).'.');
            }
            if (! $run->first_accepted_document_at) {
                RuleError::fail('RN-ONB-05', 'Para salir a producción se necesita el primer comprobante real aceptado por SUNAT (ONB-15).');
            }
        } elseif (empty($opts['system'])) {
            if ($falta = self::evidenciaFaltante($run, $code)) {
                RuleError::fail('RN-ONB-05', '«'.self::nombrePaso($code)."» no se puede marcar como hecho: {$falta}.");
            }
        }

        DB::table('onboarding_steps')->where('id', $st->id)->update([
            'status' => 'DONE',
            'completed_at' => now(),
            'completed_by' => mb_substr($u->name, 0, 120),
            'blocked_reason' => null,
            'updated_at' => now(),
        ]);
        Events::emit('onboarding.step_completed', 'onboarding_steps', $st->id, ['run_id' => $run->id, 'step' => $code]);

        if ($code === 'GO_LIVE') {
            $fecha = $opts['go_live_date'] ?? now('America/Lima')->toDateString();
            DB::table('onboarding_runs')->where('id', $run->id)->update([
                'status' => 'COMPLETED',
                'completed_at' => now(),
                'go_live_at' => $fecha,
                'updated_at' => now(),
            ]);
            Events::emit('onboarding.completed', 'onboarding_runs', $run->id, ['go_live_at' => $fecha]);
        }

        return self::estadoGeneral();
    }

    private static function evidenciaFaltante(object $run, string $code): ?string
    {
        return match ($code) {
            'COMPANY' => DB::table('companies')->where('id', $run->company_id)->whereNotNull('fiscal_address')->where('fiscal_address', '<>', '')->exists() ? null : 'falta el domicilio fiscal (ONB-03)',
            'BRANDS' => DB::table('brands')->where('status', 'ACTIVE')->exists() ? null : 'registra al menos una marca (ONB-04)',
            'ESTABLISHMENTS' => DB::table('establishments')->exists() ? null : 'registra al menos un local (ONB-05)',
            'WAREHOUSES' => DB::table('warehouses')->exists() ? null : 'registra al menos un almacén (ONB-05)',
            'SERIES' => DB::table('document_series')->where('doc_type', 'RECEIPT')->exists() && DB::table('document_series')->where('doc_type', 'INVOICE')->exists() ? null : 'faltan las series de factura y boleta (ONB-06)',
            'EINVOICE' => (json_decode((string) DB::table('companies')->where('id', $run->company_id)->value('einvoice_test'), true)['result'] ?? null) === 'ACCEPTED' ? null : 'falta el comprobante de prueba aceptado por el OSE (ONB-06)',
            'PAYMENT_METHODS' => DB::table('payment_methods')->where('status', 'ACTIVE')->exists() && DB::table('cash_accounts')->exists() ? null : 'activa un medio de pago y una caja (ONB-07)',
            'WHATSAPP' => DB::table('messaging_channels')->where('kind', 'WHATSAPP')->exists() ? null : 'conecta al menos un número (ONB-08)',
            'DELIVERY_ZONES' => DB::table('delivery_zones')->exists() ? null : 'registra al menos una zona (ONB-09)',
            'TEMPLATE' => DB::table('template_applications')->exists() ? null : 'aplica la plantilla a una marca (ONB-10)',
            'USERS' => DB::table('users')->where('role', '<>', 'ADMIN_SISTEMA')->exists() ? null : 'invita al menos a un usuario (ONB-14)',
            'IMPORT_PRODUCTS' => DB::table('data_imports')->where('import_type', 'PRODUCTS')->where('status', 'COMPLETED')->exists() ? null : 'ejecuta una importación de productos u omite el paso',
            'IMPORT_CUSTOMERS' => DB::table('data_imports')->where('import_type', 'CUSTOMERS')->where('status', 'COMPLETED')->exists() ? null : 'ejecuta una importación de clientes u omite el paso',
            'IMPORT_STOCK' => DB::table('data_imports')->where('import_type', 'STOCK')->where('status', 'COMPLETED')->exists() ? null : 'ejecuta una importación de stock inicial u omite el paso',
            'IMPORT_BALANCES' => DB::table('data_imports')->whereIn('import_type', ['CUSTOMER_BALANCES', 'SUPPLIER_BALANCES'])->where('status', 'COMPLETED')->exists() ? null : 'ejecuta una importación de saldos u omite el paso',
            default => null,
        };
    }

    /** ONB-02: omitir un paso opcional (RN-ONB-04). */
    public static function omitirPaso(string $code, ?string $reason, User $u): array
    {
        $run = self::corridaActual();
        $st = DB::table('onboarding_steps')->where('run_id', $run->id)->where('step_code', $code)->first()
            ?? RuleError::fail('RN-ONB-04', "El paso {$code} no existe.");
        if ($st->is_required) {
            RuleError::fail('RN-ONB-04', '«'.self::nombrePaso($code).'» es obligatorio: no se puede omitir.');
        }
        if ($st->status === 'DONE') {
            RuleError::fail('RN-ONB-04', 'El paso ya está hecho.');
        }
        DB::table('onboarding_steps')->where('id', $st->id)->update([
            'status' => 'SKIPPED',
            'completed_at' => now(),
            'completed_by' => mb_substr($u->name, 0, 120),
            'blocked_reason' => mb_substr(trim((string) $reason) ?: 'Omitido por la empresa', 0, 255),
            'updated_at' => now(),
        ]);

        return self::estadoGeneral();
    }

    /** ONB-02: cambiar si un paso opcional es obligatorio para la empresa (RN-ONB-04). */
    public static function cambiarObligatorio(string $code, bool $required): array
    {
        $run = self::corridaActual();
        if (in_array($code, self::OBLIGATORIOS_FIJOS, true)) {
            RuleError::fail('RN-ONB-04', '«'.self::nombrePaso($code).'» es obligatorio en toda alta.');
        }
        $st = DB::table('onboarding_steps')->where('run_id', $run->id)->where('step_code', $code)->first()
            ?? RuleError::fail('RN-ONB-04', "El paso {$code} no existe.");
        if ($st->status !== 'PENDING' && $required) {
            RuleError::fail('RN-ONB-04', 'Solo un paso pendiente pasa a obligatorio.');
        }
        DB::table('onboarding_steps')->where('id', $st->id)->update([
            'is_required' => $required,
            'updated_at' => now(),
        ]);

        return self::estadoGeneral();
    }

    /* ------------------------------------------------------------------ ONB-03 Empresa */

    public static function verEmpresa(): array
    {
        $run = self::corridaActual();
        $co = ($run->company_id ? DB::table('companies')->where('id', $run->company_id)->first() : null)
            ?? DB::table('companies')->orderBy('created_at')->first();

        return [
            'company' => $co,
            'regimenes' => Empresas::REGIMENES,
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'COMPANY'),
        ];
    }

    public static function guardarEmpresa(array $d, User $u): array
    {
        $run = self::corridaActual();
        $co = ($run->company_id ? DB::table('companies')->where('id', $run->company_id)->first() : null)
            ?? DB::table('companies')->orderBy('created_at')->first()
            ?? RuleError::fail('RN-ONB-01', 'Empresa no encontrada.');

        if (empty(trim((string) ($d['trade_name'] ?? '')))) {
            RuleError::fail('RN-ONB-01', 'Indica el nombre comercial.');
        }
        if (empty(trim((string) ($d['fiscal_address'] ?? '')))) {
            RuleError::fail('RN-ONB-01', 'Indica el domicilio fiscal.');
        }
        if (! empty($d['primary_color']) && ! preg_match('/^#[0-9a-fA-F]{6}$/', $d['primary_color'])) {
            RuleError::fail('RN-ONB-01', 'El color debe tener el formato #RRGGBB.');
        }

        DB::table('companies')->where('id', $co->id)->update([
            'trade_name' => mb_substr(trim($d['trade_name']), 0, 40),
            'fiscal_address' => mb_substr(trim($d['fiscal_address']), 0, 255),
            'fiscal_ubigeo' => ! empty($d['fiscal_ubigeo']) ? mb_substr(trim($d['fiscal_ubigeo']), 0, 20) : $co->fiscal_ubigeo,
            'tax_regime' => $d['tax_regime'] ?? $co->tax_regime,
            'logo_url' => ! empty($d['logo_url']) ? mb_substr(trim($d['logo_url']), 0, 40) : $co->logo_url,
            'primary_color' => $d['primary_color'] ?? ($co->primary_color ?: '#922242'),
            'secondary_color' => $d['secondary_color'] ?? $co->secondary_color,
            'updated_at' => now(),
        ]);

        if (! $run->company_id) {
            DB::table('onboarding_runs')->where('id', $run->id)->update(['company_id' => $co->id]);
        }
        self::autoCompletar($run, 'COMPANY', $u);

        return self::verEmpresa();
    }

    /* ------------------------------------------------------------------ ONB-04 Marcas */

    public static function verMarcas(): array
    {
        $run = self::corridaActual();
        $marcas = DB::table('brands')->orderBy('sort_order')->orderBy('created_at')->get();
        $activas = $marcas->where('status', 'ACTIVE')->count();
        $limite = Suscripcion::limite('brands');

        return [
            'brands' => $marcas,
            'active_count' => $activas,
            'limit' => $limite,
            'plan_code' => $run->plan_code,
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'BRANDS'),
        ];
    }

    public static function crearMarca(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'BRANDS');

        $code = strtoupper(trim((string) ($d['code'] ?? '')));
        if (! preg_match('/^[A-Z0-9]{2,6}$/', $code)) {
            RuleError::fail('RN-ONB-04', 'El código de la marca tiene de 2 a 6 letras o números.');
        }
        if (DB::table('brands')->where('code', $code)->exists()) {
            RuleError::fail('RN-ONB-04', "Ya existe la marca {$code}.");
        }
        $name = trim((string) ($d['name'] ?? ''));
        if ($name === '') {
            RuleError::fail('RN-ONB-04', 'Indica el nombre de la marca.');
        }
        Suscripcion::exigirLimite('brands', 1);

        $co = ($run->company_id ? DB::table('companies')->where('id', $run->company_id)->first() : null)
            ?? DB::table('companies')->orderBy('created_at')->first();
        $orden = (int) DB::table('brands')->count() + 1;

        $id = DB::table('brands')->insertGetId([
            'company_id' => $co->id,
            'code' => $code,
            'name' => mb_substr($name, 0, 40),
            'primary_color' => ! empty($d['color']) ? $d['color'] : '#922242',
            'description' => $d['description'] ?? null,
            'legal_footer' => mb_substr("{$name} es una marca de {$co->legal_name} · RUC {$co->ruc}", 0, 255),
            'whatsapp_display_name' => mb_substr(trim((string) ($d['wa_name'] ?? '')) ?: $name, 0, 40),
            'status' => 'ACTIVE',
            'sort_order' => $orden,
            'logo_url' => ! empty($d['logo_url']) ? mb_substr(trim($d['logo_url']), 0, 20) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        self::autoCompletar($run, 'BRANDS', $u);

        return DB::table('brands')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------------ ONB-05 Locales y almacenes */

    public static function verLocalesYAlmacenes(): array
    {
        $run = self::corridaActual();
        $locales = DB::table('establishments')->orderBy('sunat_code')->orderBy('code')->get();
        $almacenes = DB::table('warehouses as w')
            ->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->orderBy('w.code')
            ->get(['w.*', 'e.code as establishment_code', 'e.name as establishment_name']);
        $pasos = collect(self::pasosDe($run->id));

        return [
            'establishments' => $locales,
            'warehouses' => $almacenes,
            'wh_types' => self::TIPOS_ALMACEN,
            'sites_limit' => Suscripcion::limite('sites'),
            'step_establishments' => $pasos->firstWhere('step_code', 'ESTABLISHMENTS'),
            'step_warehouses' => $pasos->firstWhere('step_code', 'WAREHOUSES'),
        ];
    }

    public static function crearLocal(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'ESTABLISHMENTS');

        $code = strtoupper(trim((string) ($d['code'] ?? '')));
        if ($code === '') {
            RuleError::fail('RN-ONB-06', 'Indica el código del local.');
        }
        if (DB::table('establishments')->where('code', $code)->exists()) {
            RuleError::fail('RN-ONB-06', "Ya existe el local {$code}.");
        }
        $sunat = trim((string) ($d['sunat_code'] ?? ''));
        if (! preg_match('/^\d{4}$/', $sunat)) {
            RuleError::fail('RN-ONB-06', 'El código de anexo SUNAT tiene 4 dígitos (0000 es el domicilio fiscal).');
        }
        if (DB::table('establishments')->where('sunat_code', $sunat)->exists()) {
            RuleError::fail('RN-ONB-06', "El anexo {$sunat} ya está usado por otro local.");
        }
        Suscripcion::exigirLimite('sites', 1);

        $coId = $run->company_id ?? DB::table('companies')->orderBy('created_at')->value('id');
        $name = trim((string) ($d['name'] ?? ''));

        $id = DB::table('establishments')->insertGetId([
            'company_id' => $coId,
            'code' => mb_substr($code, 0, 20),
            'name' => mb_substr($name, 0, 80),
            'short' => mb_substr(trim((string) ($d['short'] ?? '')) ?: $name, 0, 80),
            'sunat_code' => $sunat,
            'est_type' => $d['est_type'] ?? 'MIXED',
            'address' => mb_substr(trim((string) ($d['address'] ?? '')), 0, 80),
            'status' => 'ACTIVE',
            'has_counter' => ! empty($d['has_counter']),
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        self::autoCompletar($run, 'ESTABLISHMENTS', $u);

        return DB::table('establishments')->where('id', $id)->first();
    }

    public static function crearAlmacen(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'WAREHOUSES');

        $code = strtoupper(trim((string) ($d['code'] ?? '')));
        if (empty($d['establishment_id'])) {
            RuleError::fail('RN-ONB-06', 'Elige el local del almacén.');
        }
        if ($code === '') {
            RuleError::fail('RN-ONB-06', 'Indica el código del almacén.');
        }
        if (DB::table('warehouses')->where('code', $code)->exists()) {
            RuleError::fail('RN-ONB-06', "Ya existe el almacén {$code}.");
        }
        $mi = isset($d['min_temp_c']) && $d['min_temp_c'] !== '' ? (float) $d['min_temp_c'] : null;
        $ma = isset($d['max_temp_c']) && $d['max_temp_c'] !== '' ? (float) $d['max_temp_c'] : null;
        if ($mi !== null && $ma !== null && $mi >= $ma) {
            RuleError::fail('RN-ONB-06', 'La temperatura mínima debe ser menor que la máxima.');
        }
        $tipo = $d['wh_type'] ?? 'MAIN';
        $maxChilled = (float) (Params::get('alm_max_temp_chilled_c') ?? 4);
        $maxFrozen = (float) (Params::get('alm_max_temp_frozen_c') ?? -18);
        if ($tipo === 'COLD_ROOM' && ($ma === null || $ma > $maxChilled)) {
            RuleError::fail('RN-ALM-04', "Una cámara de frío trabaja hasta {$maxChilled} °C.");
        }
        if ($tipo === 'FREEZER' && ($ma === null || $ma > $maxFrozen)) {
            RuleError::fail('RN-ALM-04', "Una congeladora trabaja a {$maxFrozen} °C o menos.");
        }

        $id = DB::table('warehouses')->insertGetId([
            'establishment_id' => $d['establishment_id'],
            'code' => mb_substr($code, 0, 40),
            'name' => mb_substr(trim((string) ($d['name'] ?? '')), 0, 80),
            'wh_type' => $tipo,
            'min_temp_c' => $mi,
            'max_temp_c' => $ma,
            'status' => 'ACTIVE',
            'allows_sale' => in_array($tipo, ['MAIN', 'COLD_ROOM', 'FREEZER', 'STORE'], true),
            'pick_priority' => (int) ($d['pick_priority'] ?? 10),
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        self::autoCompletar($run, 'WAREHOUSES', $u);

        return DB::table('warehouses')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------------ ONB-06 Series y comprobante electrónico */

    public static function verSeriesYOse(): array
    {
        $run = self::corridaActual();
        $co = ($run->company_id ? DB::table('companies')->where('id', $run->company_id)->first() : null)
            ?? DB::table('companies')->orderBy('created_at')->first();
        $series = DB::table('document_series as s')
            ->leftJoin('brands as b', 'b.id', '=', 's.brand_id')
            ->leftJoin('establishments as e', 'e.id', '=', 's.establishment_id')
            ->orderBy('s.series')
            ->get(['s.*', 'b.name as brand_name', 'e.code as establishment_code']);
        $pasos = collect(self::pasosDe($run->id));

        return [
            'series' => $series,
            'company' => [
                'id' => $co?->id,
                'einvoice_provider' => $co->einvoice_provider ?? 'OSE_GENERICO',
                'einvoice_user' => $co->einvoice_user ?? '',
                'einvoice_env' => $co->einvoice_env ?? 'BETA',
                'einvoice_secret_last4' => $co->einvoice_secret_last4 ?? null,
                'einvoice_test' => $co?->einvoice_test ? json_decode((string) $co->einvoice_test, true) : null,
            ],
            'step_series' => $pasos->firstWhere('step_code', 'SERIES'),
            'step_einvoice' => $pasos->firstWhere('step_code', 'EINVOICE'),
        ];
    }

    public static function proponerSeries(string $mode, User $u): array
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'SERIES');

        $marcas = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get();
        $locales = DB::table('establishments')->orderBy('sunat_code')->get();
        if ($locales->isEmpty()) {
            RuleError::fail('RN-ONB-06', 'Registra al menos un local antes de las series.');
        }
        $main = $locales->first();
        $coId = $run->company_id ?? $main->company_id;
        $creadas = [];

        $add = function (string $docType, string $serie, ?string $brandId, string $estId, array $extra = []) use ($coId, &$creadas) {
            if (DB::table('document_series')->where('series', $serie)->exists()) {
                return;
            }
            $id = DB::table('document_series')->insertGetId(array_merge([
                'company_id' => $coId,
                'establishment_id' => $estId,
                'brand_id' => $brandId,
                'doc_type' => $docType,
                'series' => $serie,
                'next_number' => 1,
                'is_electronic' => true,
                'status' => 'ACTIVE',
                'all_sites' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ], $extra), 'id');
            $creadas[] = DB::table('document_series')->where('id', $id)->first();
        };

        $lista = ($mode === 'BRAND' && $marcas->isNotEmpty()) ? $marcas->all() : [null];
        foreach ($lista as $i => $b) {
            $n = $i + 1;
            $bId = $b?->id;
            $add('INVOICE', "F00{$n}", $bId, $main->id);
            $add('RECEIPT', "B00{$n}", $bId, $main->id);
            $add('CREDIT_NOTE', "FC0{$n}", $bId, $main->id, ['applies_to' => 'INVOICE']);
            $add('CREDIT_NOTE', "BC0{$n}", $bId, $main->id, ['applies_to' => 'RECEIPT']);
        }
        foreach ($locales as $i => $e) {
            $add('DISPATCH_GUIDE', 'T00'.($i + 1), null, $e->id);
        }

        self::autoCompletar($run, 'SERIES', $u);

        return ['created' => count($creadas)] + self::verSeriesYOse();
    }

    /** RN-ONB-18: último correlativo del sistema anterior fija el siguiente; no reutiliza un número emitido. */
    public static function fijarUltimoCorrelativo(string $seriesCode, int $lastNumber): object
    {
        $s = DB::table('document_series')->where('series', strtoupper(trim($seriesCode)))->first()
            ?? RuleError::fail('RN-PLT-03', "No existe la serie {$seriesCode}.");
        if ($lastNumber < 0) {
            RuleError::fail('RN-ONB-18', 'El último correlativo es un número entero mayor o igual que 0.');
        }
        $usado = (int) DB::table('sales_documents')->where('series', $s->series)->max('number');
        if ($usado > 0 && $lastNumber + 1 <= $usado) {
            RuleError::fail('RN-ONB-18', 'En GestionCarnica ya se emitió '.Correlativo::numeroCompleto($s->series, $usado).': no se puede reutilizar un número emitido.');
        }
        if ($usado > 0 && $lastNumber + 1 < (int) $s->next_number) {
            RuleError::fail('RN-ONB-18', 'La numeración ya va en '.Correlativo::numeroCompleto($s->series, (int) $s->next_number).'.');
        }

        DB::table('document_series')->where('id', $s->id)->update([
            'next_number' => $lastNumber + 1,
            'legacy_last_number' => $lastNumber,
            'updated_at' => now(),
        ]);

        return DB::table('document_series')->where('id', $s->id)->first();
    }

    /** ONB-06: credenciales del OSE y comprobante de prueba en BETA. */
    public static function probarOse(array $d, User $u): array
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'EINVOICE');

        $provider = trim((string) ($d['provider'] ?? ''));
        $user = trim((string) ($d['user'] ?? ''));
        $secret = (string) ($d['secret'] ?? '');
        if ($provider === '' || $user === '' || $secret === '') {
            RuleError::fail('RN-ONB-06', 'Completa el proveedor, el usuario y la clave del OSE.');
        }
        if (mb_strlen($secret) < 8) {
            RuleError::fail('RN-ONB-06', 'La clave del OSE tiene al menos 8 caracteres.');
        }
        $ser = DB::table('document_series')->where('doc_type', 'RECEIPT')->orderBy('series')->first()
            ?? RuleError::fail('RN-ONB-06', 'Primero crea las series (B001).');

        $ok = ! preg_match('/fail|error/i', $user);
        $at = now()->toIso8601String();
        $test = [
            'at' => $at,
            'series' => $ser->series,
            'result' => $ok ? 'ACCEPTED' : 'REJECTED',
            'ticket' => 'BETA-'.strtoupper(substr(hash('sha256', $at.$user), 0, 10)),
            'message' => $ok
                ? 'La boleta de prueba fue aceptada en el entorno de homologación.'
                : 'Credenciales rechazadas por el OSE (usuario o clave).',
        ];

        $coId = $run->company_id ?? DB::table('companies')->orderBy('created_at')->value('id');
        DB::table('companies')->where('id', $coId)->update([
            'einvoice_provider' => $provider,
            'einvoice_user' => mb_substr($user, 0, 40),
            'einvoice_secret_last4' => substr($secret, -4),
            'einvoice_env' => 'BETA',
            'einvoice_test' => json_encode($test, JSON_UNESCAPED_UNICODE),
            'updated_at' => now(),
        ]);

        if (! $ok) {
            RuleError::fail('RN-ONB-06', 'El OSE rechazó las credenciales: revisa usuario y clave.');
        }
        self::autoCompletar($run, 'EINVOICE', $u);

        return $test;
    }

    /* ------------------------------------------------------------------ ONB-07 Medios de pago y cajas */

    public static function verPagosYCajas(): array
    {
        $run = self::corridaActual();
        $pms = DB::table('payment_methods')->orderBy('sort_order')->orderBy('code')->get();
        $cajas = DB::table('cash_accounts as c')
            ->leftJoin('establishments as e', 'e.id', '=', 'c.establishment_id')
            ->orderBy('c.code')
            ->get(['c.*', 'e.code as establishment_code', 'e.name as establishment_name']);
        $locales = DB::table('establishments')->orderBy('code')->get(['id', 'code', 'name']);

        return [
            'defaults' => array_map(fn ($m) => [
                'code' => $m[0], 'name' => $m[1], 'kind' => $m[2], 'requires_reference' => $m[3], 'allowed_on_delivery' => $m[4],
            ], self::MEDIOS_PAGO),
            'payment_methods' => $pms,
            'cash_accounts' => $cajas,
            'establishments' => $locales,
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'PAYMENT_METHODS'),
        ];
    }

    public static function guardarPagosYCajas(array $codes, array $cashBoxes, User $u): array
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'PAYMENT_METHODS');

        $codes = array_values(array_unique(array_map('strtoupper', $codes)));
        if (empty($codes)) {
            RuleError::fail('RN-ONB-06', 'Activa al menos un medio de pago.');
        }

        foreach (self::MEDIOS_PAGO as $idx => [$c, $n, $k, $ref, $cod]) {
            $ex = DB::table('payment_methods')->where('code', $c)->first();
            $activo = in_array($c, $codes, true);
            if ($ex) {
                DB::table('payment_methods')->where('id', $ex->id)->update([
                    'status' => $activo ? 'ACTIVE' : 'INACTIVE',
                    'updated_at' => now(),
                ]);
            } elseif ($activo) {
                DB::table('payment_methods')->insert([
                    'code' => $c,
                    'name' => $n,
                    'kind' => $k,
                    'requires_reference' => $ref,
                    'allowed_on_delivery' => $cod,
                    'status' => 'ACTIVE',
                    'sort_order' => $idx + 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        foreach ($cashBoxes as $cb) {
            $code = strtoupper(trim((string) ($cb['code'] ?? '')));
            if ($code === '' || DB::table('cash_accounts')->where('code', $code)->exists()) {
                continue;
            }
            DB::table('cash_accounts')->insert([
                'code' => mb_substr($code, 0, 40),
                'name' => mb_substr(trim((string) ($cb['name'] ?? $code)), 0, 80),
                'account_type' => $cb['type'] ?? 'CASH_REGISTER',
                'establishment_id' => ! empty($cb['establishment_id']) ? $cb['establishment_id'] : null,
                'currency' => 'PEN',
                'status' => 'ACTIVE',
                'account_number' => ! empty($cb['account_number']) ? mb_substr(trim($cb['account_number']), 0, 40) : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (! DB::table('cash_accounts')->exists()) {
            RuleError::fail('RN-ONB-06', 'Crea al menos una caja (por ejemplo la caja del local).');
        }
        self::autoCompletar($run, 'PAYMENT_METHODS', $u);

        return self::verPagosYCajas();
    }

    /* ------------------------------------------------------------------ ONB-08 Números de WhatsApp */

    public static function limiteWhatsapp(?string $planCode): int
    {
        return match (strtoupper((string) $planCode)) {
            'INICIAL', 'INICIA' => 1,
            'MULTIMARCA', 'ESCALA' => 8,
            default => 3,
        };
    }

    public static function verWhatsapp(): array
    {
        $run = self::corridaActual();
        $canales = DB::table('messaging_channels as c')
            ->leftJoin('brands as b', 'b.id', '=', 'c.brand_id')
            ->where('c.kind', 'WHATSAPP')
            ->orderBy('c.created_at')
            ->get(['c.*', 'b.name as brand_name']);
        $marcas = DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name']);

        return [
            'channels' => $canales,
            'brands' => $marcas,
            'connected_count' => $canales->where('status', '<>', 'DISCONNECTED')->count(),
            'limit' => self::limiteWhatsapp($run->plan_code),
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'WHATSAPP'),
        ];
    }

    /** RN-ONB-19: número de WhatsApp ligado a marca o compartido, proveedor oficial Cloud API, dentro del límite del plan. */
    public static function conectarWhatsapp(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'WHATSAPP');

        $num = preg_replace('/\D/', '', (string) ($d['number'] ?? ''));
        if (strlen($num) === 9) {
            $num = '51'.$num;
        }
        if (! preg_match('/^519\d{8}$/', $num)) {
            RuleError::fail('RN-ONB-19', 'El número debe ser un celular peruano de 9 dígitos.');
        }
        $num = '+'.$num;
        $shared = ! empty($d['shared']);
        $brandId = $shared ? null : ($d['brand_id'] ?? null);
        if (! $brandId && ! $shared) {
            RuleError::fail('RN-ONB-19', 'Liga el número a una marca o márcalo como compartido.');
        }
        if (DB::table('messaging_channels')->where('kind', 'WHATSAPP')->where('number', $num)->where('status', '<>', 'DISCONNECTED')->exists()) {
            RuleError::fail('RN-ONB-19', "El número {$num} ya está conectado.");
        }
        $lim = self::limiteWhatsapp($run->plan_code);
        $activos = DB::table('messaging_channels')->where('kind', 'WHATSAPP')->where('status', '<>', 'DISCONNECTED')->count();
        if ($activos >= $lim) {
            RuleError::fail('RN-SUS-06', "Tu plan permite {$lim} número(s) de WhatsApp y ya tienes {$activos}.");
        }

        // Si la columna brand_id exige un valor o es compartido, si es compartido sin brand_id podemos dejar null (la migración quitó NOT NULL).
        $coexistence = ($d['coexistence'] ?? true) !== false;
        $id = DB::table('messaging_channels')->insertGetId([
            'kind' => 'WHATSAPP',
            'brand_id' => $brandId,
            'shared' => $shared,
            'number' => $num,
            'display_name' => mb_substr(trim((string) ($d['display_name'] ?? '')) ?: $num, 0, 80),
            'coexistence' => $coexistence,
            'provider' => 'CLOUD_API',
            'connection_mode' => $coexistence ? 'CLOUD_API_COEXISTENCE' : 'CLOUD_API',
            'assignment_mode' => 'SHIFT_ROUND_ROBIN',
            'status' => 'ACTIVE',
            'quality_rating' => 'HIGH',
            'messaging_limit' => 250,
            'embedded_signup_at' => now(),
            'connected_at' => now(),
            'waba_id' => 'WABA-'.substr(hash('sha256', $num), 0, 8),
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        self::autoCompletar($run, 'WHATSAPP', $u);

        return DB::table('messaging_channels')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------------ ONB-09 Zonas de reparto */

    public static function verZonas(): array
    {
        $run = self::corridaActual();
        $zonas = DB::table('delivery_zones as z')
            ->leftJoin('establishments as e', 'e.id', '=', 'z.establishment_id')
            ->orderBy('z.code')
            ->get(['z.*', 'e.code as establishment_code', 'e.name as establishment_name'])
            ->map(function ($z) {
                $z->districts = is_string($z->districts) ? (json_decode($z->districts, true) ?: [$z->districts]) : ($z->districts ?? []);

                return $z;
            });

        return [
            'zones' => $zonas,
            'establishments' => DB::table('establishments')->orderBy('code')->get(['id', 'code', 'name']),
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'DELIVERY_ZONES'),
        ];
    }

    public static function crearZona(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'DELIVERY_ZONES');

        $code = strtoupper(trim((string) ($d['code'] ?? '')));
        $name = trim((string) ($d['name'] ?? ''));
        if ($code === '' || $name === '') {
            RuleError::fail('RN-ONB-06', 'Indica el código y el nombre de la zona.');
        }
        if (empty($d['establishment_id'])) {
            RuleError::fail('RN-ONB-06', 'Elige el local que despacha la zona.');
        }
        if (DB::table('delivery_zones')->where('code', $code)->exists()) {
            RuleError::fail('RN-ONB-06', "Ya existe la zona {$code}.");
        }
        $rawDist = is_array($d['districts'] ?? null) ? $d['districts'] : explode(',', (string) ($d['districts'] ?? ''));
        $districts = array_values(array_filter(array_map('trim', $rawDist), fn ($x) => $x !== ''));
        if (empty($districts)) {
            RuleError::fail('RN-ONB-06', 'Indica al menos un distrito (separados por coma).');
        }
        $fee = (float) ($d['delivery_fee'] ?? 0);
        if ($fee < 0) {
            RuleError::fail('RN-ONB-06', 'La tarifa no puede ser negativa.');
        }

        $id = DB::table('delivery_zones')->insertGetId([
            'establishment_id' => $d['establishment_id'],
            'code' => mb_substr($code, 0, 40),
            'name' => mb_substr($name, 0, 80),
            'districts' => json_encode($districts, JSON_UNESCAPED_UNICODE),
            'delivery_fee' => $fee,
            'free_from_units' => ! empty($d['free_from_units']) ? (int) $d['free_from_units'] : null,
            'free_from_kg' => ! empty($d['free_from_kg']) ? (float) $d['free_from_kg'] : null,
            'min_order_amount' => (float) ($d['min_order_amount'] ?? 0),
            'province' => ! empty($d['province']),
            'status' => 'ACTIVE',
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        self::autoCompletar($run, 'DELIVERY_ZONES', $u);

        return DB::table('delivery_zones')->where('id', $id)->first();
    }

    /* ------------------------------------------------------------------ ONB-10 Plantilla por rubro */

    public static function verPlantillas(?string $code = null): array
    {
        $run = self::corridaActual();
        $publicadas = DB::table('industry_templates')->where('status', 'PUBLISHED')->orderBy('code')->get();
        $elegida = ($code ? $publicadas->firstWhere('code', $code) : null)
            ?? $publicadas->firstWhere('code', self::plantillaDeRubro($run->industry))
            ?? $publicadas->first();

        $modulosEncendidos = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
        $nombresMod = DB::table('platform_modules')->pluck('name', 'code');

        $items = $elegida ? DB::table('industry_template_items')->where('template_id', $elegida->id)->orderBy('seq')->get()->map(function ($it) use ($modulosEncendidos, $nombresMod) {
            $p = json_decode((string) $it->payload, true) ?: [];
            $modOn = ! $it->requires_module || in_array($it->requires_module, $modulosEncendidos, true);

            return [
                'id' => $it->id,
                'seq' => (int) $it->seq,
                'item_type' => $it->item_type,
                'item_type_name' => self::TIPOS_ITEM_PLANTILLA[$it->item_type] ?? $it->item_type,
                'item_code' => $it->item_code,
                'name' => $p['name'] ?? $p['label'] ?? ($it->item_code.' = '.($p['value'] ?? '')),
                'requires_module' => $it->requires_module,
                'requires_module_name' => $it->requires_module ? ($nombresMod[$it->requires_module] ?? $it->requires_module) : null,
                'module_enabled' => $modOn,
                'payload' => $p,
            ];
        })->all() : [];

        $apps = DB::table('template_applications as a')
            ->leftJoin('brands as b', 'b.id', '=', 'a.brand_id')
            ->leftJoin('industry_templates as t', 't.id', '=', 'a.template_id')
            ->orderByDesc('a.applied_at')
            ->get(['a.*', 'b.name as brand_name', 't.name as template_name'])
            ->map(function ($a) {
                $a->detail = json_decode((string) $a->detail, true) ?: [];

                return $a;
            });

        return [
            'templates' => $publicadas,
            'selected' => $elegida,
            'items' => $items,
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name']),
            'applications' => $apps,
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'TEMPLATE'),
        ];
    }

    /** RN-ONB-07 (CA-ONB-02, CA-ONB-03): aplica una plantilla publicada a una marca de forma idempotente. */
    public static function aplicarPlantilla(string $templateCode, string $brandId, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'TEMPLATE');

        $tpl = DB::table('industry_templates')->where('code', $templateCode)->where('status', 'PUBLISHED')->first()
            ?? RuleError::fail('RN-ONB-07', "No hay una plantilla publicada {$templateCode}.");
        $brand = DB::table('brands')->where('id', $brandId)->first()
            ?? RuleError::fail('RN-ONB-07', 'Elige la marca a la que se aplica la plantilla.');

        $prev = DB::table('template_applications')
            ->where('template_id', $tpl->id)
            ->where('brand_id', $brand->id)
            ->where('status', '<>', 'FAILED')
            ->first();
        if ($prev) {
            RuleError::fail('RN-ONB-07', "La plantilla {$tpl->name} ya se aplicó a {$brand->name}: se aplica una vez por marca.");
        }

        return DB::transaction(function () use ($run, $tpl, $brand, $u) {
            $pl = DB::table('price_lists')->where('brand_id', $brand->id)->where('code', 'PUB')->first();
            if (! $pl) {
                $plId = DB::table('price_lists')->insertGetId([
                    'brand_id' => $brand->id,
                    'code' => 'PUB',
                    'name' => 'Lista pública '.$brand->name,
                    'channels' => json_encode(['WHATSAPP', 'WEB', 'TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'COUNTER']),
                    'includes_igv' => true,
                    'status' => 'ACTIVE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');
                $pl = DB::table('price_lists')->where('id', $plId)->first();
            }

            $modulosOn = DB::table('tenant_modules')->where('enabled', true)->pluck('module_code')->all();
            $nombresMod = DB::table('platform_modules')->pluck('name', 'code');
            $items = DB::table('industry_template_items')->where('template_id', $tpl->id)->orderBy('seq')->get();

            $detail = [];
            $created = 0;
            $skipped = 0;
            $failed = 0;

            foreach ($items as $it) {
                $p = json_decode((string) $it->payload, true) ?: [];
                $res = [
                    'item_type' => $it->item_type,
                    'item_type_name' => self::TIPOS_ITEM_PLANTILLA[$it->item_type] ?? $it->item_type,
                    'item_code' => $it->item_code,
                    'name' => $p['name'] ?? $p['label'] ?? $it->item_code,
                ];
                if ($it->requires_module && ! in_array($it->requires_module, $modulosOn, true)) {
                    $modName = $nombresMod[$it->requires_module] ?? $it->requires_module;
                    $res['result'] = 'SKIPPED';
                    $res['reason'] = "Requiere {$it->requires_module} ({$modName}), apagado en esta empresa";
                } else {
                    try {
                        $r = DB::transaction(fn () => self::aplicarItemPlantilla($it, $p, $brand, $pl));
                        $res = array_merge($res, $r);
                    } catch (\Throwable $e) {
                        $res['result'] = 'FAILED';
                        $res['reason'] = $e->getMessage();
                    }
                }

                if ($res['result'] === 'CREATED') {
                    $created++;
                } elseif ($res['result'] === 'SKIPPED') {
                    $skipped++;
                } else {
                    $failed++;
                }
                $detail[] = $res;
            }

            $byModule = collect($detail)->contains(fn ($d) => $d['result'] === 'SKIPPED' && str_starts_with((string) ($d['reason'] ?? ''), 'Requiere'));
            $appId = DB::table('template_applications')->insertGetId([
                'run_id' => $run->id,
                'template_id' => $tpl->id,
                'template_code' => $tpl->code,
                'template_version' => $tpl->version,
                'brand_id' => $brand->id,
                'mode' => 'SKIP_EXISTING',
                'status' => ($failed > 0 || $byModule) ? 'PARTIAL' : 'APPLIED',
                'items_created' => $created,
                'items_skipped' => $skipped,
                'items_failed' => $failed,
                'applied_at' => now(),
                'applied_by' => mb_substr($u->name, 0, 120),
                'detail' => json_encode($detail, JSON_UNESCAPED_UNICODE),
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');

            self::autoCompletar($run, 'TEMPLATE', $u);
            Events::emit('template.applied', 'template_applications', $appId, [
                'run_id' => $run->id, 'template' => $tpl->code, 'brand_id' => $brand->id,
                'created' => $created, 'skipped' => $skipped, 'failed' => $failed,
            ]);

            $app = DB::table('template_applications')->where('id', $appId)->first();
            $app->detail = $detail;

            return $app;
        });
    }

    private static function uomId(string $code): string
    {
        $id = DB::table('units_of_measure')->where('code', $code)->value('id');
        if ($id) {
            return $id;
        }

        return DB::table('units_of_measure')->insertGetId([
            'code' => $code,
            'name' => $code === 'NIU' ? 'Unidad' : 'Kilogramo',
            'kind' => $code === 'NIU' ? 'UNIT' : 'WEIGHT',
            'sunat_code' => $code,
            'status' => 'ACTIVE',
            'is_system' => true,
            'created_at' => now(),
        ], 'id');
    }

    private static function aplicarItemPlantilla(object $it, array $p, object $brand, object $pl): array
    {
        $code = $it->item_code;
        switch ($it->item_type) {
            case 'CATEGORY':
                if (DB::table('product_categories')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $id = DB::table('product_categories')->insertGetId([
                    'code' => $code,
                    'name' => $p['name'],
                    'line' => $p['line'] ?? $code,
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'PRODUCT':
                if (DB::table('products')->where('code', $code)->exists() || DB::table('product_variants')->where('sku', $p['sku'])->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $cat = DB::table('product_categories')->where('code', $p['category'])->first();
                if (! $cat) {
                    return ['result' => 'FAILED', 'reason' => "Falta la categoría {$p['category']}"];
                }
                $prId = DB::table('products')->insertGetId([
                    'brand_id' => $brand->id,
                    'category_id' => $cat->id,
                    'code' => $code,
                    'name' => $p['name'],
                    'line' => $cat->line,
                    'product_type' => 'GOODS',
                    'origin' => 'PRODUCED',
                    'storage' => $p['storage'] ?? 'CHILLED',
                    'shelf_life_days' => (int) ($p['shelf'] ?? 7),
                    'requires_lot' => ! empty($p['lot']),
                    'igv_affectation' => '10',
                    'sanitary_authority' => $p['authority'] ?? 'SENASA',
                    'status' => 'ACTIVE',
                    'web_publishable' => false,
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');
                $tol = isset($p['tol']) && $p['tol'] !== null ? (float) $p['tol'] : null;
                $kg = isset($p['kg']) && $p['kg'] !== null ? (float) $p['kg'] : null;
                $vId = DB::table('product_variants')->insertGetId([
                    'product_id' => $prId,
                    'brand_id' => $brand->id,
                    'sku' => $p['sku'],
                    'name' => $p['name'],
                    'uom_id' => self::uomId(($p['mode'] ?? 'UNIT') === 'UNIT' ? 'NIU' : 'KGM'),
                    'sale_mode' => $p['mode'] ?? 'UNIT',
                    'nominal_weight_kg' => $kg,
                    'weight_tolerance_pct' => $tol,
                    'min_weight_kg' => ($kg && $tol) ? round($kg * (1 - $tol / 100), 3) : null,
                    'max_weight_kg' => ($kg && $tol) ? round($kg * (1 + $tol / 100), 3) : null,
                    'status' => 'ACTIVE',
                    'std_cost' => (float) ($p['cost'] ?? 0),
                    'sellable' => true,
                    'line' => $cat->line,
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');
                DB::table('price_list_items')->insert([
                    'list_id' => $pl->id,
                    'variant_id' => $vId,
                    'price' => (float) $p['price'],
                    'basis' => ($p['mode'] ?? 'UNIT') === 'UNIT' ? 'UNIT' : 'KG',
                    'valid_from' => now('America/Lima')->toDateString(),
                    'valid_to' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                return ['result' => 'CREATED', 'target_id' => $vId];

            case 'CUT':
                if (DB::table('cut_types')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $id = DB::table('cut_types')->insertGetId([
                    'code' => $code,
                    'name' => $p['name'],
                    'applies_to_lines' => json_encode($p['lines'] ?? []),
                    'sort_order' => (int) $it->seq,
                    'status' => 'ACTIVE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'BREAKDOWN':
                if (DB::table('cutting_templates')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $firstVar = DB::table('product_variants')->where('brand_id', $brand->id)->first();
                if (! $firstVar) {
                    return ['result' => 'SKIPPED', 'reason' => 'Sin producto base para el despiece'];
                }
                $id = DB::table('cutting_templates')->insertGetId([
                    'code' => $code,
                    'name' => mb_substr($p['name'], 0, 80),
                    'species' => $p['species'] ?? 'CERDO',
                    'brand_id' => $brand->id,
                    'input_product_id' => $firstVar->product_id,
                    'input_variant_id' => $firstVar->id,
                    'version' => 1,
                    'mass_balance_tolerance_pct' => 2,
                    'status' => 'DRAFT',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'RECIPE':
                if (DB::table('recipes')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $prod = DB::table('products')->where('code', $p['product'] ?? '')->first()
                    ?? DB::table('products')->where('brand_id', $brand->id)->first();
                if (! $prod) {
                    return ['result' => 'SKIPPED', 'reason' => 'Sin producto destino para la receta'];
                }
                $id = DB::table('recipes')->insertGetId([
                    'product_id' => $prod->id,
                    'code' => $code,
                    'name' => mb_substr($p['name'], 0, 80),
                    'recipe_type' => $p['type'] ?? 'OTHER',
                    'brand_id' => $brand->id,
                    'status' => 'DRAFT',
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'CHECKLIST':
                if (DB::table('qc_checklists')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $id = DB::table('qc_checklists')->insertGetId([
                    'code' => $code,
                    'name' => $p['name'],
                    'stage' => $p['stage'] ?? 'STORAGE',
                    'version' => 1,
                    'status' => 'ACTIVE',
                    'items' => json_encode($p['items'] ?? [], JSON_UNESCAPED_UNICODE),
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'KPI_TARGET':
                $def = DB::table('kpi_definitions')->where('code', $code)->first();
                if (! $def) {
                    return ['result' => 'SKIPPED', 'reason' => 'El indicador no existe en esta empresa: no se crea la meta'];
                }
                if (DB::table('kpi_targets')->where('kpi_code', $code)->where('brand_id', $brand->id)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya hay una meta para esta marca'];
                }
                $id = DB::table('kpi_targets')->insertGetId([
                    'kpi_id' => $def->id,
                    'kpi_code' => $code,
                    'brand_id' => $brand->id,
                    'establishment_id' => null,
                    'target' => (float) $p['target'],
                    'tolerance_pct' => (float) ($p['tol'] ?? 10),
                    'valid_from' => now('America/Lima')->toDateString(),
                    'valid_to' => null,
                    'note' => mb_substr((string) ($p['label'] ?? $code), 0, 80),
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'PARAMETER':
                if (DB::table('parameters')->where('key', $code)->where('scope', 'BRAND')->where('scope_id', $brand->id)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya está configurado para la marca'];
                }
                $id = DB::table('parameters')->insertGetId([
                    'key' => $code,
                    'scope' => 'BRAND',
                    'scope_id' => $brand->id,
                    'value' => (string) $p['value'],
                    'reason' => mb_substr((string) ($p['reason'] ?? 'Plantilla de rubro'), 0, 255),
                    'description' => (string) ($p['reason'] ?? 'Parámetro de plantilla'),
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'ROLE':
                if (DB::table('roles')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $id = DB::table('roles')->insertGetId([
                    'code' => $code,
                    'name' => $p['name'],
                    'is_system' => false,
                    'description' => $p['desc'] ?? null,
                    'requires_mfa' => false,
                    'scope_mode' => 'ASSIGNED',
                    'status' => 'ACTIVE',
                    'source' => 'TEMPLATE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'EXPENSE_CATEGORY':
                if (DB::table('expense_categories')->where('code', $code)->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $ccId = DB::table('cost_centers')->value('id');
                if (! $ccId) {
                    $coId = DB::table('companies')->value('id');
                    $ccId = DB::table('cost_centers')->insertGetId([
                        'company_id' => $coId,
                        'code' => 'CC-DEL',
                        'name' => 'Reparto y logística',
                        'area' => 'DELIVERY',
                        'status' => 'ACTIVE',
                        'created_at' => now(),
                    ], 'id');
                }
                $grupo = $p['group'] ?? 'DELIVERY';
                $id = DB::table('expense_categories')->insertGetId([
                    'code' => $code,
                    'name' => $p['name'],
                    'category_group' => $grupo,
                    'default_area' => 'DELIVERY',
                    'delivery_cost_type' => $grupo === 'DELIVERY' ? ($p['delivery_cost_type'] ?? 'PROVINCE_FREIGHT') : null,
                    'default_cost_center_id' => $ccId,
                    'default_doc_type' => 'INVOICE',
                    'status' => 'ACTIVE',
                    'created_at' => now(),
                    'updated_at' => now(),
                ], 'id');

                return ['result' => 'CREATED', 'target_id' => $id];

            case 'DELIVERY_SLOT':
                $ests = DB::table('establishments')->get();
                if ($ests->isEmpty()) {
                    return ['result' => 'FAILED', 'reason' => 'Sin locales: registra un local (ONB-05)'];
                }
                if (DB::table('order_time_slots')->where('name', $p['name'])->exists()) {
                    return ['result' => 'SKIPPED', 'reason' => 'Ya existe con el mismo código'];
                }
                $firstId = null;
                foreach ($ests as $e) {
                    $id = DB::table('order_time_slots')->insertGetId([
                        'establishment_id' => $e->id,
                        'zone_id' => null,
                        'name' => $p['name'],
                        'slot_from' => $p['from'],
                        'slot_to' => $p['to'],
                        'cutoff' => $p['cutoff'],
                        'capacity' => (float) ($p['capacity'] ?? 20),
                        'weekdays' => json_encode([1, 2, 3, 4, 5, 6]),
                        'status' => 'ACTIVE',
                        'cutoff_minutes' => 60,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ], 'id');
                    $firstId ??= $id;
                }

                return ['result' => 'CREATED', 'target_id' => $firstId];

            default:
                return ['result' => 'SKIPPED', 'reason' => 'Tipo no aplicable'];
        }
    }

    /* ------------------------------------------------------------------ ONB-14 Usuarios e invitaciones */

    public static function verUsuarios(): array
    {
        $run = self::corridaActual();
        $rolesMap = DB::table('roles')->get()->keyBy('code');
        $scopes = DB::table('user_scopes as s')
            ->leftJoin('brands as b', 'b.id', '=', 's.brand_id')
            ->leftJoin('establishments as e', 'e.id', '=', 's.establishment_id')
            ->get(['s.user_id', 's.brand_id', 'b.name as brand_name', 's.establishment_id', 'e.code as establishment_code'])
            ->groupBy('user_id');

        $usuarios = DB::table('users')
            ->where(fn ($q) => $q->whereNull('user_type')->orWhereNotIn('user_type', ['PLATFORM_SUPPORT', 'B2B_CUSTOMER']))
            ->whereNotIn('role', ['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'])
            ->orderBy('created_at')
            ->get()
            ->map(function ($u) use ($rolesMap, $scopes) {
                $r = $rolesMap[$u->role] ?? null;
                $sc = $scopes[$u->id] ?? collect();
                $mfaReq = $r ? (bool) $r->requires_mfa : in_array($u->role, self::ROLES_CON_2FA, true);
                $mfaOn = ! empty($u->mfa_enrolled_at) || ! empty($u->twofa_enabled);

                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'role_name' => $r->name ?? $u->role,
                    'status' => $u->status,
                    'twofa_required' => $mfaReq,
                    'twofa_enabled' => $mfaOn,
                    'brands' => $sc->whereNotNull('brand_id')->pluck('brand_name')->unique()->values()->all(),
                    'sites' => $sc->whereNotNull('establishment_id')->pluck('establishment_code')->unique()->values()->all(),
                    'invited_at' => $u->invited_at,
                ];
            });

        return [
            'users' => $usuarios,
            'active_count' => Suscripcion::usado('users'),
            'limit' => Suscripcion::limite('users'),
            'roles' => DB::table('roles')->where('status', 'ACTIVE')->whereNotIn('code', ['CLIENTE_B2B', 'SOPORTE_PLATAFORMA'])->orderBy('name')->get(['id', 'code', 'name', 'requires_mfa']),
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->get(['id', 'code', 'name']),
            'establishments' => DB::table('establishments')->orderBy('code')->get(['id', 'code', 'name']),
            'step' => collect(self::pasosDe($run->id))->firstWhere('step_code', 'USERS'),
        ];
    }

    public static function invitarUsuario(array $d, User $u): object
    {
        $run = self::corridaActual();
        self::exigirPrerrequisitos($run, 'USERS');

        $email = mb_strtolower(trim((string) ($d['email'] ?? '')));
        $name = trim((string) ($d['name'] ?? ''));
        $roleCode = trim((string) ($d['role'] ?? 'VENDEDORA'));
        $brands = array_values(array_filter((array) ($d['brands'] ?? [])));
        $sites = array_values(array_filter((array) ($d['sites'] ?? [])));

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            RuleError::fail('RN-ONB-06', 'Indica un correo válido.');
        }
        if ($name === '') {
            RuleError::fail('RN-ONB-06', 'Indica el nombre.');
        }
        if (DB::table('users')->where('email', $email)->exists()) {
            RuleError::fail('RN-ONB-06', "Ya existe un usuario con {$email}.");
        }
        if ($roleCode === 'VENDEDORA' && empty($brands)) {
            RuleError::fail('RN-ONB-06', 'Una vendedora necesita al menos una marca.');
        }
        Suscripcion::exigirLimite('users', 1);

        $role = DB::table('roles')->where('code', $roleCode)->first()
            ?? RuleError::fail('RN-ONB-06', "El rol {$roleCode} no existe.");

        return DB::transaction(function () use ($run, $name, $email, $role, $brands, $sites, $u) {
            $id = (string) Uuid::uuid4();
            DB::table('users')->insert([
                'id' => $id,
                'name' => mb_substr($name, 0, 80),
                'email' => $email,
                'role' => $role->code,
                'status' => 'INVITED',
                'password' => Hash::make(Str::random(32)),
                'failed_logins' => 0,
                'invited_at' => now(),
                'invited_by' => mb_substr($u->name, 0, 40),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('user_roles')->insert([
                'user_id' => $id,
                'role_id' => $role->id,
                'created_at' => now(),
            ]);
            foreach ($brands as $bId) {
                DB::table('user_scopes')->insert([
                    'user_id' => $id,
                    'brand_id' => $bId,
                    'establishment_id' => null,
                    'created_at' => now(),
                ]);
            }
            foreach ($sites as $sId) {
                DB::table('user_scopes')->insert([
                    'user_id' => $id,
                    'brand_id' => null,
                    'establishment_id' => $sId,
                    'created_at' => now(),
                ]);
            }

            self::autoCompletar($run, 'USERS', $u);

            return DB::table('users')->where('id', $id)->first();
        });
    }

    public static function aceptarInvitacionSimulada(string $userId, bool $withMfa = true): object
    {
        $usr = DB::table('users')->where('id', $userId)->first()
            ?? RuleError::fail('RN-ONB-06', 'Usuario no encontrado.');
        $role = DB::table('roles')->where('code', $usr->role)->first();
        $reqMfa = $role ? (bool) $role->requires_mfa : in_array($usr->role, self::ROLES_CON_2FA, true);
        if ($reqMfa && ! $withMfa) {
            RuleError::fail('RN-SEG-03', "El rol {$usr->role} exige segundo factor: el usuario debe activarlo al aceptar la invitación.");
        }

        DB::table('users')->where('id', $usr->id)->update([
            'status' => 'ACTIVE',
            'mfa_enrolled_at' => $withMfa ? now() : $usr->mfa_enrolled_at,
            'last_login' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('users')->where('id', $usr->id)->first();
    }

    /* ------------------------------------------------------------------ ONB-15 Salida a producción */

    /** ONB-15 (CA-ONB-08): emite y envía a SUNAT el primer comprobante real de la empresa. */
    public static function emitirPrimerComprobante(array $d, User $u): object
    {
        $run = self::corridaActual();
        $eStep = DB::table('onboarding_steps')->where('run_id', $run->id)->where('step_code', 'EINVOICE')->first();
        if ($eStep && $eStep->status !== 'DONE') {
            RuleError::fail('RN-ONB-06', 'Primero conecta el OSE y envía el comprobante de prueba (ONB-06).');
        }

        $seriesCode = ! empty($d['series'])
            ? strtoupper(trim((string) $d['series']))
            : DB::table('document_series')->where('doc_type', 'RECEIPT')->where('status', 'ACTIVE')->orderBy('series')->value('series');
        if (! $seriesCode) {
            RuleError::fail('RN-PLT-03', 'No hay series de boleta activas.');
        }
        $ser = DB::table('document_series')->where('series', $seriesCode)->first()
            ?? RuleError::fail('RN-PLT-03', "No existe la serie {$seriesCode}.");

        $brandId = $ser->brand_id ?? DB::table('brands')->where('status', 'ACTIVE')->orderBy('sort_order')->value('id')
            ?? RuleError::fail('RN-ONB-04', 'Registra al menos una marca activa.');
        $estId = $ser->establishment_id ?? DB::table('establishments')->orderBy('sunat_code')->value('id')
            ?? RuleError::fail('RN-ONB-06', 'Registra al menos un local.');

        // Si la serie fue propuesta para toda la empresa (brand_id null), Emision::directa o emitir permite series de marca o mostrador.
        $cust = DB::table('customers')->where('customer_type', 'OTHER')->first();
        if (! $cust) {
            $cId = DB::table('customers')->insertGetId([
                'doc_type' => 'NONE',
                'doc_number' => null,
                'full_name' => 'Clientes varios',
                'customer_type' => 'OTHER',
                'status' => 'ACTIVE',
                'marketing_opt_in' => false,
                'created_at' => now(),
            ], 'id');
            $cust = DB::table('customers')->where('id', $cId)->first();
        }

        $total = max(1.0, round((float) ($d['amount'] ?? 45), 2));
        $desc = trim((string) ($d['description'] ?? '')) ?: 'Primera venta en GestionCarnica';

        $doc = Emision::emitir([
            'doc_type' => $ser->doc_type,
            'brand_id' => $brandId,
            'establishment_id' => $estId,
            'series_id' => $ser->id,
            'payment_terms' => 'CASH',
            'issue_date' => $d['date'] ?? now('America/Lima')->toDateString(),
        ], $cust, [[
            'description' => $desc,
            'qty' => 1,
            'uom_code' => 'NIU',
            'unit_price' => $total,
            'total' => $total,
            'igv_affectation' => '10',
            'cost' => 0,
        ]], $u, ['mostrador' => $ser->brand_id === null, 'source' => 'DIRECT']);

        if (in_array($doc->sunat_status, ['ACCEPTED', 'OBSERVED'], true) || $doc->status === 'ISSUED') {
            if ($doc->sunat_status === 'PENDING') {
                // Asegurar aceptación inmediata en homologación/salida si el proveedor quedó en cola.
                DB::table('sales_documents')->where('id', $doc->id)->update([
                    'sunat_status' => 'ACCEPTED',
                    'accepted_at' => now(),
                    'sunat_code' => '0',
                    'sunat_message' => "La boleta {$doc->full_number} ha sido aceptada.",
                ]);
                $doc = DB::table('sales_documents')->where('id', $doc->id)->first();
            }
            if (! $run->first_accepted_document_at) {
                DB::table('onboarding_runs')->where('id', $run->id)->update([
                    'first_accepted_document_at' => $doc->accepted_at ?? now(),
                    'first_document_id' => $doc->id,
                    'updated_at' => now(),
                ]);
            }
        }

        return $doc;
    }

    /** ONB-15 (RN-ONB-05, CA-ONB-07): salida a producción. */
    public static function salirAProduccion(?string $date, User $u): array
    {
        $hoy = now('America/Lima')->toDateString();
        $fecha = $date ?: $hoy;
        if ($fecha < $hoy) {
            RuleError::fail('RN-ONB-05', 'La fecha de inicio de operación no puede ser anterior a hoy.');
        }

        return self::completarPaso('GO_LIVE', $u, ['go_live_date' => $fecha]);
    }
}
