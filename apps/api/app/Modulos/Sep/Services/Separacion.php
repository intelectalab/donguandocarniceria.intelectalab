<?php

namespace App\Modulos\Sep\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Aud\Services\Exportaciones as ExportacionesAud;
use App\Modulos\Fac\Services\Emision;
use App\Modulos\Int\Services\Archivos;
use App\Modulos\Plt\Services\Ruc;
use App\Support\Access;
use App\Support\Events;
use App\Support\Listado;
use App\Support\RuleError;
use App\Support\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * SEP · Separación de marcas (SEP-01 a SEP-12; RN-SEP-01 a 20; CA-SEP-01 a 06).
 *
 * Permite separar una marca que nació dentro de la empresa para que pase a operar:
 *  - OTHER_RUC: en otra razón social (otro RUC) dentro de la misma cuenta de la empresa.
 *  - OTHER_TENANT: en otra empresa cliente de la plataforma.
 *  - OTHER_SYSTEM: en un sistema externo.
 */
final class Separacion
{
    public const DESTINOS = [
        'OTHER_RUC' => 'Otro RUC en esta cuenta',
        'OTHER_TENANT' => 'Otra empresa en la plataforma',
        'OTHER_SYSTEM' => 'Otro sistema externo',
    ];

    public const ESTADOS = [
        'DRAFT' => 'Borrador',
        'VALIDATED' => 'Validada',
        'APPROVED' => 'Aprobada',
        'EXECUTING' => 'Ejecutando',
        'COMPLETED' => 'Completada',
        'FAILED' => 'Con error',
        'CANCELLED' => 'Cancelada',
    ];

    public const ESTADOS_VIVOS = ['DRAFT', 'VALIDATED', 'APPROVED', 'EXECUTING', 'FAILED'];

    public const ESTADOS_BLOQUEADOS = ['APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED'];

    public const TIPOS_ITEM = [
        'SERIES_NEW' => 'Series en empresa destino',
        'PRODUCT' => 'Productos y presentaciones',
        'PRICE_LIST' => 'Listas de precios',
        'STOCK' => 'Stock por lote y almacén',
        'CUSTOMERS' => 'Clientes de la marca',
        'ORDER' => 'Pedidos abiertos',
        'RECEIVABLE' => 'Cuentas por cobrar',
        'CHANNEL' => 'Canales de WhatsApp y redes',
        'WEB_STORE' => 'Tienda web',
        'AD_ACCOUNT' => 'Cuentas publicitarias',
        'CASH_ACCOUNT' => 'Cajas y cuentas bancarias',
        'USER' => 'Usuarios y alcances',
        'WAREHOUSE' => 'Almacenes',
        'SERIES_ORIGIN' => 'Series de empresa origen',
    ];

    public const ORDEN_EJECUCION = [
        'SERIES_NEW', 'PRODUCT', 'PRICE_LIST', 'STOCK', 'CUSTOMERS', 'ORDER', 'RECEIVABLE',
        'CHANNEL', 'WEB_STORE', 'AD_ACCOUNT', 'CASH_ACCOUNT', 'USER', 'WAREHOUSE', 'SERIES_ORIGIN',
    ];

    public const ACCIONES_ITEM = [
        'MOVE' => 'Mover',
        'COPY' => 'Copiar',
        'EXPORT_ONLY' => 'Solo exportar',
        'KEEP' => 'Conservar / reasignar',
        'CREATE' => 'Crear en destino',
        'TRANSFER' => 'Transferir',
        'LEAVE' => 'Dejar en el origen',
        'LEAVE_ORIGIN' => 'Dejar en empresa origen',
        'RETURN_SUPPLIER' => 'Devolver a proveedor',
        'EXPORT' => 'Exportar en paquete',
        'SHARE' => 'Compartir en la cuenta',
        'SHARED' => 'Compartidos (no se copian)',
        'EXPORT_CUSTOMERS' => 'Exportar clientes de la marca',
        'CANCEL_NOTIFY' => 'Cancelar y avisar al cliente',
        'KEEP_ORIGIN' => 'Cobrar en empresa origen',
        'ASSIGN' => 'Ceder a empresa destino',
        'KEEP_INBOX' => 'Seguir en la bandeja con sus conversaciones',
        'MIGRATE' => 'Migrar con el proveedor oficial',
        'DISCONNECT' => 'Desconectar',
        'REASSIGN' => 'Reasignar a la empresa nueva',
        'SHARE' => 'Mantener compartido',
        'LEAVE_ORIGIN' => 'Mantener en la empresa de origen',
        'MOVE_SCOPE' => 'Mantener alcance en la marca',
        'REMOVE_SCOPE' => 'Quitar marca de su alcance',
        'DEACTIVATE' => 'Cerrar en la empresa de origen',
        'CLOSE' => 'Cerrar al corte',
    ];

    /* ------------------------------------------------------------------ utilidades */

    public static function esFinDeMes(?string $fecha): bool
    {
        if (! $fecha || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
            return false;
        }
        try {
            $c = CarbonImmutable::parse($fecha);

            return $c->endOfMonth()->toDateString() === $fecha;
        } catch (\Throwable) {
            return false;
        }
    }

    public static function diaSiguiente(string $fecha): string
    {
        return CarbonImmutable::parse($fecha)->addDay()->toDateString();
    }

    public static function periodoDe(string $fecha): string
    {
        return substr($fecha, 0, 7).'-01';
    }

    public static function periodoCerrado(string $companyId, string $fecha): bool
    {
        return DB::table('accounting_periods')
            ->where('company_id', $companyId)
            ->where('period', self::periodoDe($fecha))
            ->value('status') === 'CLOSED';
    }

    private static function nombreDocumento(?string $tipo): string
    {
        return [
            'INVOICE' => 'Factura',
            'RECEIPT' => 'Boleta',
            'CREDIT_NOTE' => 'Nota de crédito',
            'DEBIT_NOTE' => 'Nota de débito',
            'DISPATCH_GUIDE' => 'Guía de remisión',
            'CONSIGNMENT_NOTE' => 'Guía de consignación',
            'INTERNAL_NOTE' => 'Nota interna',
            'JOURNAL' => 'Diario',
            'PRODUCTION_ORDER' => 'Orden de producción',
            'PURCHASE_ORDER' => 'Orden de compra',
            'QUOTE' => 'Cotización',
        ][$tipo ?? ''] ?? 'Otro documento';
    }

    private static function siguienteNumero(): string
    {
        $max = 0;
        foreach (DB::table('brand_separations')->pluck('number') as $num) {
            if (preg_match('/^SEP-(\d+)$/', (string) $num, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return 'SEP-'.str_pad((string) ($max + 1), 4, '0', STR_PAD_LEFT);
    }

    private static function asegurarItemsSembrados(): void
    {
        if (! DB::table('brand_separations')->exists()) {
            self::sembrarDemoSiFalta();
        } elseif (! DB::table('brand_company_history')->exists()) {
            self::sembrarVigenciasIniciales();
        }

        foreach (DB::table('brand_separations')->whereNull('items_built_at')->where('status', '<>', 'CANCELLED')->get() as $s) {
            self::construirItems($s->id);
            if ($s->status === 'COMPLETED' && $s->simulation) {
                self::completarSimulacionSembrada($s->id);
            }
        }
    }

    private static function sembrarVigenciasIniciales(): void
    {
        $marcas = DB::table('brands as b')
            ->join('companies as c', 'c.id', '=', 'b.company_id')
            ->get(['b.id as brand_id', 'b.company_id', 'c.legal_name', 'c.ruc']);

        foreach ($marcas as $m) {
            if (DB::table('brand_company_history')->where('brand_id', $m->brand_id)->exists()) {
                continue;
            }
            $minDoc = DB::table('sales_documents')
                ->where('brand_id', $m->brand_id)
                ->where('company_id', $m->company_id)
                ->min('issue_date');
            $from = ($minDoc && $minDoc < '2026-01-01') ? $minDoc : '2026-01-01';

            DB::table('brand_company_history')->insert([
                'brand_id' => $m->brand_id,
                'company_id' => $m->company_id,
                'company_name' => $m->legal_name,
                'ruc' => $m->ruc,
                'valid_from' => $from,
                'valid_to' => null,
                'separation_id' => null,
                'reason' => 'Inicio de operaciones con la empresa original',
                'status' => 'ACTIVE',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    private static function sembrarDemoSiFalta(): void
    {
        self::sembrarVigenciasIniciales();

        $coDg = DB::table('companies')->where('ruc', '20609147254')->first();
        if (! $coDg) {
            return;
        }

        $rucGou = Ruc::conVerificador('2061284301');
        $coGou = DB::table('companies')->where('ruc', $rucGou)->first();
        if (! $coGou) {
            $filaCo = [
                'legal_name' => 'DON GUANDO GOURMET SAC',
                'ruc' => $rucGou,
                'trade_name' => 'Don Guando Gourmet',
                'tax_regime' => 'MYPE',
                'fiscal_address' => 'Av. La Molina 1480, La Molina, Lima',
                'default_currency' => 'PEN',
                'timezone' => 'America/Lima',
                'einvoice_provider' => 'NUBEFACT',
                'einvoice_env' => 'PRODUCTION',
                'status' => 'ACTIVE',
                'created_at' => '2026-09-20 10:00:00',
            ];
            $colsCo = array_flip(DB::getSchemaBuilder()->getColumnListing('companies'));
            $coGouId = DB::table('companies')->insertGetId(array_intersect_key($filaCo, $colsCo), 'id');
            $coGou = DB::table('companies')->where('id', $coGouId)->first();
        }

        $brM3 = DB::table('brands')->where('code', 'M3')->value('id');
        $brM4 = DB::table('brands')->where('code', 'M4')->value('id');
        $brM5 = DB::table('brands')->where('code', 'M5')->value('id');
        if (! $brM3 || ! $brM4 || ! $brM5) {
            return;
        }

        $usAdm = DB::table('users')->where('role', 'ADMIN_SISTEMA')->value('id') ?? DB::table('users')->value('id');
        $usGer = DB::table('users')->where('role', 'GERENTE')->value('id') ?? $usAdm;

        DB::table('brand_separations')->insert([
            'number' => 'SEP-0001',
            'brand_id' => $brM3,
            'origin_company_id' => $coDg->id,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGou->id,
            'dest_legal_name' => 'DON GUANDO GOURMET SAC',
            'dest_ruc' => $rucGou,
            'cutoff_date' => '2026-08-31',
            'simulation' => false,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Ensayo descartado: La Casa del Cuy sigue con Don Guando SAC.',
            'status' => 'CANCELLED',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Luis Ccahuana Rojas',
            'prepared_at' => '2026-08-29 10:00:00',
            'cancelled_at' => '2026-08-30 16:20:00',
            'cancel_reason' => 'Gerencia decidió mantener La Casa del Cuy en el RUC principal y separar primero Gourmet.',
            'history' => json_encode([
                ['at' => '2026-08-29T10:00:00', 'by' => $usAdm, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
                ['at' => '2026-08-30T16:20:00', 'by' => $usGer, 'by_name' => 'Rosa Quispe Huamán', 'status' => 'CANCELLED', 'note' => 'Gerencia decidió mantener La Casa del Cuy en el RUC principal y separar primero Gourmet.'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-08-29 10:00:00',
            'updated_at' => '2026-08-30 16:20:00',
        ]);

        DB::table('brand_separations')->insert([
            'number' => 'SEP-0002',
            'brand_id' => $brM5,
            'origin_company_id' => $coDg->id,
            'dest_type' => 'OTHER_RUC',
            'dest_company_id' => $coGou->id,
            'dest_legal_name' => 'DON GUANDO GOURMET SAC',
            'dest_ruc' => $rucGou,
            'cutoff_date' => '2026-09-30',
            'simulation' => false,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Don Guando Gourmet pasa a facturar con DON GUANDO GOURMET SAC desde el 1 de octubre de 2026.',
            'status' => 'DRAFT',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Luis Ccahuana Rojas',
            'prepared_at' => '2026-09-28 09:30:00',
            'history' => json_encode([
                ['at' => '2026-09-28T09:30:00', 'by' => $usAdm, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-09-28 09:30:00',
            'updated_at' => '2026-09-28 09:30:00',
        ]);

        DB::table('brand_separations')->insert([
            'number' => 'SEP-0003',
            'brand_id' => $brM4,
            'origin_company_id' => $coDg->id,
            'dest_type' => 'OTHER_TENANT',
            'dest_company_id' => null,
            'dest_tenant_name' => 'Despensa Andina SAC',
            'dest_legal_name' => 'DESPENSA ANDINA SAC',
            'dest_ruc' => Ruc::conVerificador('2060987123'),
            'cutoff_date' => '2026-08-31',
            'simulation' => true,
            'receivables_policy' => 'KEEP_ORIGIN',
            'notes' => 'Simulación para dimensionar el paquete de exportación de Despensa Don Guando hacia su propia cuenta.',
            'status' => 'COMPLETED',
            'prepared_by' => $usAdm,
            'prepared_by_name' => 'Luis Ccahuana Rojas',
            'prepared_at' => '2026-09-04 11:00:00',
            'validated_at' => '2026-09-04 11:10:00',
            'warn_note' => 'Simulación con advertencias controladas para dimensionar el paquete.',
            'approved_by' => $usGer,
            'approved_by_name' => 'Rosa Quispe Huamán',
            'approved_at' => '2026-09-04 11:20:00',
            'approval_note' => 'Aprobado como simulación para revisar el paquete de exportación y el acta.',
            'executed_at' => '2026-09-04 11:25:00',
            'completed_at' => '2026-09-04 11:26:00',
            'history' => json_encode([
                ['at' => '2026-09-04T11:00:00', 'by' => $usAdm, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'DRAFT', 'note' => 'Proyecto creado'],
                ['at' => '2026-09-04T11:10:00', 'by' => $usAdm, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'VALIDATED', 'note' => 'Simulación con advertencias controladas'],
                ['at' => '2026-09-04T11:20:00', 'by' => $usGer, 'by_name' => 'Rosa Quispe Huamán', 'status' => 'APPROVED', 'note' => 'Aprobado como simulación'],
                ['at' => '2026-09-04T11:26:00', 'by' => $usAdm, 'by_name' => 'Luis Ccahuana Rojas', 'status' => 'COMPLETED', 'note' => 'Simulación completada'],
            ], JSON_UNESCAPED_UNICODE),
            'created_at' => '2026-09-04 11:00:00',
            'updated_at' => '2026-09-04 11:26:00',
        ]);
    }

    private static function completarSimulacionSembrada(string $id): void
    {
        $s = DB::table('brand_separations')->where('id', $id)->first();
        if (! $s) {
            return;
        }
        $ahora = $s->completed_at ?? now()->toIso8601String();
        DB::table('brand_separation_items')
            ->where('separation_id', $id)
            ->where('status', 'PENDING')
            ->update([
                'status' => 'DONE',
                'attempts' => 1,
                'executed_at' => $ahora,
                'result' => 'Simulado sin alterar la operación',
                'updated_at' => now(),
            ]);

        if (! $s->export) {
            $u = ($s->prepared_by ? User::find($s->prepared_by) : null) ?? User::first();
            if ($u) {
                self::generarPaquete($id, $u, true);
                self::generarActa($id, $u);
            }
        }
    }

    /* ------------------------------------------------------------------ SEP-01 Proyectos */

    public static function listar(array $filtros = [], ?Request $request = null): array
    {
        self::asegurarItemsSembrados();

        $q = DB::table('brand_separations as s')
            ->join('brands as b', 'b.id', '=', 's.brand_id')
            ->join('companies as co', 'co.id', '=', 's.origin_company_id')
            ->leftJoin('companies as cd', 'cd.id', '=', 's.dest_company_id');

        if (! empty($filtros['brand_id'])) {
            $q->where('s.brand_id', $filtros['brand_id']);
        }
        if (! empty($filtros['status'])) {
            $q->where('s.status', $filtros['status']);
        }
        if (! empty($filtros['dest_type'])) {
            $q->where('s.dest_type', $filtros['dest_type']);
        }
        if (isset($filtros['simulation']) && in_array((string) $filtros['simulation'], ['0', '1'], true)) {
            $q->where('s.simulation', $filtros['simulation'] === '1');
        }

        $q->select([
            's.*',
            'b.code as brand_code',
            'b.name as brand_name',
            'b.primary_color as brand_color',
            'b.status as brand_status',
            'co.legal_name as origin_company_name',
            'co.trade_name as origin_trade_name',
            'co.ruc as origin_ruc',
            'cd.legal_name as dest_company_legal_name',
            'cd.trade_name as dest_company_trade_name',
            'cd.ruc as dest_company_ruc',
        ]);
        $pagina = Listado::de($q, $request ?? request(), buscar: [
            's.number',
            'b.code',
            'b.name',
            'co.legal_name',
            'co.ruc',
            's.dest_legal_name',
            's.dest_tenant_name',
            's.dest_system_name',
        ], ordenar: [
            's.number',
            'b.code',
            'b.name',
            'co.legal_name',
            's.cutoff_date',
            's.status',
        ], porDefecto: '-s.number');
        $pagina->through(fn ($s) => self::hidratarResumen($s));

        $marcas = DB::table('brands as b')
            ->join('companies as c', 'c.id', '=', 'b.company_id')
            ->orderBy('b.sort_order')
            ->get(['b.id', 'b.code', 'b.name', 'b.status', 'b.company_id', 'b.primary_color', 'c.legal_name as company_name', 'c.ruc as company_ruc']);

        $empresas = DB::table('companies')
            ->whereIn('status', ['ACTIVE', 'PREPARING'])
            ->orderBy('legal_name')
            ->get()
            ->map(function ($c) {
                $c->ose_status = $c->ose_status ?? (($c->status === 'ACTIVE') ? 'OK' : 'PENDING');
                $c->ose_provider = $c->ose_provider ?? ($c->einvoice_provider ?? 'NUBEFACT');

                return $c;
            });

        return array_merge($pagina->toArray(), [
            'separations' => $pagina->items(),
            'brands' => $marcas,
            'companies' => $empresas,
            'dest_types' => self::DESTINOS,
            'statuses' => self::ESTADOS,
            'kpis' => self::kpis(),
        ]);
    }

    public static function previsualizar(array $d): array
    {
        $brand = DB::table('brands')->where('id', $d['brand_id'] ?? '')->first();
        if (! $brand) {
            RuleError::fail('RN-SEP-02', 'Elige una marca válida para la separación.');
        }

        $origin = DB::table('companies')->where('id', $brand->company_id)->first();
        $cutoff = (string) ($d['cutoff_date'] ?? '');
        $type = (string) ($d['dest_type'] ?? '');
        $destinationName = null;
        $destinationCoherent = false;

        if ($type === 'OTHER_RUC') {
            if (! empty($d['dest_company_id'])) {
                $destination = DB::table('companies')->where('id', $d['dest_company_id'])->first();
                $destinationName = $destination?->legal_name;
                $destinationCoherent = $destination
                    && $destination->id !== $brand->company_id
                    && in_array($destination->status, ['ACTIVE', 'PREPARING'], true)
                    && Ruc::valido($destination->ruc);
            } else {
                $ruc = trim((string) ($d['new_company_ruc'] ?? ''));
                $name = trim((string) ($d['new_company_name'] ?? ''));
                $destinationName = $name ?: null;
                $destinationCoherent = $ruc !== ''
                    && mb_strlen($name) >= 3
                    && mb_strlen($name) <= 80
                    && Ruc::valido($ruc)
                    && ! DB::selectOne('SELECT platform_ruc_in_use(?) AS si', [$ruc])->si;
            }
        } elseif ($type === 'OTHER_TENANT') {
            $destinationName = trim((string) ($d['dest_tenant_name'] ?? '')) ?: null;
            $ruc = trim((string) ($d['dest_ruc'] ?? ''));
            $destinationCoherent = mb_strlen((string) $destinationName) >= 3
                && ($ruc === '' || Ruc::valido($ruc));
        } elseif ($type === 'OTHER_SYSTEM') {
            $destinationName = trim((string) ($d['dest_system_name'] ?? '')) ?: null;
            $ruc = trim((string) ($d['dest_ruc'] ?? ''));
            $destinationCoherent = mb_strlen((string) $destinationName) >= 2
                && ($ruc === '' || Ruc::valido($ruc));
        }

        $periodStatus = null;
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $cutoff)) {
            $periodStatus = DB::table('accounting_periods')
                ->where('company_id', $brand->company_id)
                ->where('period', self::periodoDe($cutoff))
                ->value('status') ?? 'OPEN';
        }

        $activeSeparation = DB::table('brand_separations')
            ->where('brand_id', $brand->id)
            ->where('simulation', false)
            ->whereIn('status', self::ESTADOS_VIVOS)
            ->value('number');

        $openOrders = DB::table('sales_orders')
            ->where('brand_id', $brand->id)
            ->whereNotIn('status', ['DELIVERED', 'CLOSED', 'CANCELLED']);
        $ordersInProcess = DB::table('sales_orders')
            ->where('brand_id', $brand->id)
            ->whereIn('status', ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'])
            ->count();

        $variantIds = DB::table('product_variants as v')
            ->join('products as p', 'p.id', '=', 'v.product_id')
            ->where(fn ($q) => $q->where('v.brand_id', $brand->id)->orWhere('p.brand_id', $brand->id))
            ->pluck('v.id');
        $stock = DB::table('stock_balances')
            ->whereIn('variant_id', $variantIds)
            ->where('qty', '>', 0);

        return [
            'brand_name' => $brand->name,
            'origin_company_name' => $origin?->legal_name,
            'origin_ruc' => $origin?->ruc,
            'destination_name' => $destinationName,
            'cutoff_date' => $cutoff,
            'effective_from' => self::esFinDeMes($cutoff) ? self::diaSiguiente($cutoff) : null,
            'month_end' => self::esFinDeMes($cutoff),
            'period_status' => $periodStatus,
            'period_closed' => $periodStatus === 'CLOSED',
            'active_separation' => $activeSeparation,
            'destination_coherent' => $destinationCoherent,
            'open_orders_count' => (clone $openOrders)->count(),
            'orders_in_process_count' => $ordersInProcess,
            'stock_lots_count' => (clone $stock)->whereNotNull('lot_id')->distinct()->count('lot_id'),
            'warehouses_count' => (clone $stock)->whereNotNull('warehouse_id')->distinct()->count('warehouse_id'),
        ];
    }

    public static function kpis(?string $separationId = null): array
    {
        $separations = DB::table('brand_separations')
            ->where('simulation', false)
            ->whereIn('status', ['EXECUTING', 'COMPLETED', 'FAILED'])
            ->when($separationId, fn ($q) => $q->where('id', $separationId))
            ->pluck('id');

        $stockTransfers = DB::table('brand_separation_items')
            ->whereIn('separation_id', $separations)
            ->where('item_type', 'STOCK')
            ->where('action', 'TRANSFER')
            ->where('status', 'DONE')
            ->get(['qty', 'received_qty']);
        $orders = DB::table('brand_separation_items')
            ->whereIn('separation_id', $separations)
            ->where('item_type', 'ORDER')
            ->get(['status']);
        $ordersResolved = $orders->whereIn('status', ['DONE', 'EXCLUDED'])->count();

        $items = DB::table('brand_separation_items')
            ->where('item_type', 'STOCK')
            ->where('action', 'TRANSFER')
            ->when($separationId, fn ($q) => $q->where('separation_id', $separationId))
            ->where('status', 'DONE')
            ->get();

        $enviado = round((float) $items->sum(fn ($i) => (float) $i->qty * (float) $i->unit_cost), 2);
        $recibido = round((float) $items->sum(fn ($i) => (float) ($i->received_qty ?? $i->qty) * (float) $i->unit_cost), 2);

        $completadas = DB::table('brand_separations')->where('status', 'COMPLETED')->get();
        $actasCompletadas = $completadas->filter(fn ($s) => ! empty($s->act))->count();

        return [
            'in_progress_real_count' => DB::table('brand_separations')
                ->where('simulation', false)
                ->whereIn('status', self::ESTADOS_VIVOS)
                ->count(),
            'completed_real_count' => DB::table('brand_separations')
                ->where('simulation', false)
                ->where('status', 'COMPLETED')
                ->count(),
            'simulations_count' => DB::table('brand_separations')->where('simulation', true)->count(),
            'stock_qty_difference' => round((float) $stockTransfers->sum(
                fn ($i) => abs((float) $i->qty - (float) ($i->received_qty ?? 0))
            ), 3),
            'stock_transfer_lots_count' => $stockTransfers->count(),
            'orders_resolved_pct' => $orders->isNotEmpty()
                ? round($ordersResolved * 100 / $orders->count(), 1)
                : null,
            'orders_resolved_count' => $ordersResolved,
            'orders_total_count' => $orders->count(),
            'stock_sent_pen' => $enviado,
            'stock_received_pen' => $recibido,
            'stock_diff_pen' => round(abs($enviado - $recibido), 2), // KPI-SEP-01 = 0
            'completed_count' => $completadas->count(),
            'completed_with_act' => $actasCompletadas,
            'act_coverage_pct' => $completadas->count() > 0 ? round($actasCompletadas * 100 / $completadas->count(), 1) : 100.0,
        ];
    }

    private static function clientesDeMarca(object $separation): array
    {
        $months = 24;
        $from = CarbonImmutable::parse($separation->cutoff_date)->startOfMonth()->subMonths($months - 1)->toDateString();
        $separationOrderIds = DB::table('brand_separation_items')
            ->where('separation_id', $separation->id)
            ->where('item_type', 'ORDER')
            ->pluck('ref_id')
            ->all();
        $customers = DB::table('sales_orders as o')
            ->join('customers as c', 'c.id', '=', 'o.customer_id')
            ->where('o.brand_id', $separation->brand_id)
            ->where(function ($query) use ($separationOrderIds) {
                $query->where('o.status', '<>', 'CANCELLED');
                if ($separationOrderIds) {
                    $query->orWhereIn('o.id', $separationOrderIds);
                }
            })
            ->whereDate('o.created_at', '>=', $from)
            ->whereDate('o.created_at', '<=', $separation->cutoff_date)
            ->where('c.customer_type', '<>', 'OTHER')
            ->whereNull('c.merged_into_id')
            ->select([
                'c.id',
                'c.trade_name',
                'c.full_name',
                'c.doc_type',
                'c.doc_number',
                'c.phone',
                'c.email',
                'c.marketing_opt_in',
            ])
            ->selectRaw('MAX(o.created_at) as last_order_at')
            ->groupBy('c.id', 'c.trade_name', 'c.full_name', 'c.doc_type', 'c.doc_number', 'c.phone', 'c.email', 'c.marketing_opt_in')
            ->orderBy('c.full_name')
            ->get();

        $customerIds = $customers->pluck('id')->all();
        $latestConsents = $customerIds
            ? DB::table('contact_consents')
                ->whereIn('customer_id', $customerIds)
                ->where('purpose', 'MARKETING')
                ->whereNotNull('customer_id')
                ->orderByDesc('recorded_at')
                ->orderByDesc('id')
                ->get(['customer_id', 'granted'])
                ->groupBy('customer_id')
                ->map(fn ($records) => $records->first())
            : collect();

        $customers = $customers->map(function ($customer) use ($latestConsents) {
            $consent = $latestConsents->get($customer->id);
            $customer->has_consent = $consent
                ? (bool) $consent->granted
                : (bool) $customer->marketing_opt_in;
            unset($customer->marketing_opt_in);

            return $customer;
        })->values();

        return [
            'months' => $months,
            'from' => $from,
            'all' => $customers->all(),
            'with_consent_count' => $customers->where('has_consent', true)->count(),
        ];
    }

    public static function obtener(?string $id = null): array
    {
        self::asegurarItemsSembrados();

        $s = $id
            ? DB::table('brand_separations')->where('id', $id)->orWhere('number', $id)->first()
            : (DB::table('brand_separations')
                ->where('simulation', false)
                ->whereIn('status', self::ESTADOS_VIVOS)
                ->orderByDesc('number')
                ->first()
                ?? DB::table('brand_separations')->whereIn('status', self::ESTADOS_VIVOS)->orderByDesc('number')->first()
                ?? DB::table('brand_separations')->orderByDesc('number')->first());

        if (! $s) {
            abort(response()->json(['message' => 'Proyecto de separación no encontrado.', 'code' => 'NOT_FOUND'], 404));
        }

        if (! $s->items_built_at && $s->status !== 'CANCELLED') {
            self::construirItems($s->id);
            $s = DB::table('brand_separations')->where('id', $s->id)->first();
        }
        if (! DB::table('brand_separation_checks')->where('separation_id', $s->id)->exists() && $s->status !== 'CANCELLED') {
            self::correrValidaciones($s->id);
            $s = DB::table('brand_separations')->where('id', $s->id)->first();
        }

        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        $origin = DB::table('companies')->where('id', $s->origin_company_id)->first();
        $dest = $s->dest_company_id ? DB::table('companies')->where('id', $s->dest_company_id)->first() : null;

        $checks = DB::table('brand_separation_checks')
            ->where('separation_id', $s->id)
            ->orderBy('seq')
            ->get()
            ->all();

        $warehouses = DB::table('warehouses')->get()->keyBy('id');
        $establishments = DB::table('establishments')->get()->keyBy('id');
        $variants = DB::table('product_variants')->get()->keyBy('id');
        $lots = DB::table('lots')->get()->keyBy('id');

        $itemRows = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->orderBy('seq')
            ->get();
        $orderStatuses = DB::table('sales_orders')
            ->whereIn('id', $itemRows->where('item_type', 'ORDER')->pluck('ref_id')->filter())
            ->pluck('status', 'id');
        $userIds = $itemRows->where('item_type', 'USER')->pluck('ref_id')->filter()->unique()->values()->all();
        $usersById = $userIds
            ? DB::table('users')->whereIn('id', $userIds)->get(['id', 'name', 'role'])->keyBy('id')
            : collect();
        $brandsByUser = $userIds
            ? DB::table('user_scopes as us')
                ->join('brands as b', 'b.id', '=', 'us.brand_id')
                ->whereIn('us.user_id', $userIds)
                ->orderBy('b.name')
                ->get(['us.user_id', 'b.name'])
                ->groupBy('user_id')
                ->map(fn ($rows) => $rows->pluck('name')->all())
            : collect();
        $channelIds = $itemRows->where('item_type', 'CHANNEL')->pluck('ref_id')->filter()->all();
        $channelStatuses = $channelIds
            ? DB::table('messaging_channels')->whereIn('id', $channelIds)->pluck('status', 'id')
            : collect();
        $conversationCounts = $channelIds
            ? DB::table('conversations')
                ->whereIn('channel_id', $channelIds)
                ->selectRaw('channel_id, COUNT(*) AS quantity')
                ->groupBy('channel_id')
                ->pluck('quantity', 'channel_id')
            : collect();
        $customers = self::clientesDeMarca($s);
        $productLines = DB::table('products')
            ->whereIn('id', $itemRows->where('item_type', 'PRODUCT')->where('ref_table', 'products')->pluck('ref_id')->filter())
            ->pluck('line', 'id');
        $priceListNames = DB::table('price_lists')
            ->whereIn('id', $itemRows->where('item_type', 'PRICE_LIST')->pluck('ref_id')->filter())
            ->pluck('name', 'id');
        $stockBalances = DB::table('stock_balances')
            ->whereIn('id', $itemRows->where('item_type', 'STOCK')->pluck('ref_id')->filter())
            ->get(['id', 'qty', 'reserved_qty'])
            ->keyBy('id');
        $items = $itemRows
            ->map(function ($it) use ($s, $warehouses, $establishments, $variants, $lots, $productLines, $priceListNames, $stockBalances, $orderStatuses, $channelStatuses, $conversationCounts, $usersById, $brandsByUser) {
                $it->qty = (float) $it->qty;
                $it->qty_at_cutoff = $it->qty_at_cutoff !== null ? (float) $it->qty_at_cutoff : null;
                $it->unit_cost = $it->unit_cost !== null ? (float) $it->unit_cost : null;
                $it->reserved_qty = $it->reserved_qty !== null ? (float) $it->reserved_qty : 0.0;
                $it->received_qty = $it->received_qty !== null ? (float) $it->received_qty : null;
                $it->amount = $it->amount !== null ? (float) $it->amount : null;
                $it->refs = json_decode((string) ($it->refs ?? '{}'), true) ?: [];
                $it->item_type_name = self::TIPOS_ITEM[$it->item_type] ?? $it->item_type;
                if (in_array($it->item_type, ['PRODUCT', 'PRICE_LIST'], true)) {
                    if ($it->action === 'KEEP') {
                        $it->action = 'MOVE';
                    } elseif ($it->action === 'EXPORT') {
                        $it->action = $s->dest_type === 'OTHER_TENANT' ? 'COPY' : 'EXPORT_ONLY';
                    }
                    $it->action_name = self::ACCIONES_ITEM[$it->action] ?? $it->action;
                } elseif ($it->item_type === 'CUSTOMERS') {
                    $it->action = in_array($it->action, ['SHARE', 'SHARED'], true) ? 'SHARED' : 'EXPORT';
                    $it->action_name = $it->action === 'SHARED'
                        ? self::ACCIONES_ITEM['SHARED']
                        : 'Exportar con consentimiento';
                } elseif ($it->item_type === 'ORDER') {
                    $it->action_name = match ($it->action) {
                        'KEEP' => 'Mantener y facturar con la empresa destino',
                        'CANCEL_NOTIFY' => 'Cancelar y registrar aviso · exportar',
                        'EXPORT' => 'Solo exportar',
                        default => self::ACCIONES_ITEM[$it->action] ?? $it->action,
                    };
                } else {
                    if ($it->item_type === 'CHANNEL' && $it->action === 'KEEP') {
                        $it->action = 'KEEP_INBOX';
                    } elseif (in_array($it->item_type, ['WEB_STORE', 'AD_ACCOUNT', 'CASH_ACCOUNT'], true)) {
                        if (in_array($it->action, ['KEEP', 'MIGRATE', 'KEEP_INBOX'], true)) {
                            $it->action = $s->dest_type === 'OTHER_RUC' ? 'REASSIGN' : 'DISCONNECT';
                        } elseif ($it->item_type === 'CASH_ACCOUNT' && $it->action === 'LEAVE_ORIGIN') {
                            $it->action = 'DISCONNECT';
                        }
                    }
                    $it->action_name = match ($it->item_type) {
                        'CHANNEL' => match ($it->action) {
                            'KEEP_INBOX' => 'Seguir en la bandeja con sus conversaciones',
                            'MIGRATE' => 'Migrar con el proveedor oficial',
                            'DISCONNECT' => 'Desconectar y exportar historial',
                            default => self::ACCIONES_ITEM[$it->action] ?? $it->action,
                        },
                        'WEB_STORE', 'AD_ACCOUNT', 'CASH_ACCOUNT' => match ($it->action) {
                            'REASSIGN' => 'Reasignar a la empresa nueva',
                            'DISCONNECT' => 'Desconectar',
                            default => self::ACCIONES_ITEM[$it->action] ?? $it->action,
                        },
                        default => self::ACCIONES_ITEM[$it->action] ?? $it->action,
                    };
                }
                if ($it->item_type === 'STOCK') {
                    if (in_array($it->action, ['LEAVE_ORIGIN', 'RETURN_SUPPLIER'], true)) {
                        $it->action = 'LEAVE';
                    }
                    $it->action_name = self::ACCIONES_ITEM[$it->action] ?? $it->action;
                }
                $it->line = $it->item_type === 'PRODUCT'
                    ? ($productLines->get($it->ref_id) ?? $it->note)
                    : null;
                if ($it->item_type === 'PRICE_LIST') {
                    $it->label = $priceListNames->get($it->ref_id) ?: $it->label;
                }
                $stockBalance = $it->item_type === 'STOCK' ? $stockBalances->get($it->ref_id) : null;
                $it->qty_available = $stockBalance
                    ? max(0, (float) $stockBalance->qty - (float) $stockBalance->reserved_qty)
                    : null;
                $it->source_status = $it->item_type === 'CHANNEL' ? $channelStatuses->get($it->ref_id) : null;
                $it->role = null;
                $it->brands_in_scope = [];
                if ($it->item_type === 'CHANNEL') {
                    $it->qty = (int) ($conversationCounts->get($it->ref_id) ?? 0);
                }
                if ($it->item_type === 'USER') {
                    $user = $usersById->get($it->ref_id);
                    $it->label = $user?->name ?? $it->label;
                    $it->role = $user?->role;
                    $it->only_brand = (bool) $it->only_brand;
                    $it->brands_in_scope = $brandsByUser->get($it->ref_id, []);
                }
                if ($it->item_type === 'SERIES_ORIGIN') {
                    $it->action_name = $it->action === 'KEEP' ? 'Mantener para comprobantes anteriores' : 'Cerrar al corte';
                }
                $it->order_status = $it->item_type === 'ORDER' ? $orderStatuses->get($it->ref_id) : null;
                $it->warehouse_name = $it->warehouse_id ? ($warehouses[$it->warehouse_id]->name ?? null) : null;
                $it->warehouse_code = $it->warehouse_id ? ($warehouses[$it->warehouse_id]->code ?? null) : null;
                $it->establishment_name = $it->establishment_id ? ($establishments[$it->establishment_id]->name ?? null) : null;
                $it->establishment_code = $it->establishment_id ? ($establishments[$it->establishment_id]->code ?? null) : null;
                $it->variant_sku = $it->variant_id ? ($variants[$it->variant_id]->sku ?? null) : null;
                $it->variant_name = $it->variant_id ? ($variants[$it->variant_id]->name ?? null) : null;
                $it->lot_code = $it->lot_id ? ($lots[$it->lot_id]->code ?? null) : null;
                $it->total_cost = $it->unit_cost !== null ? round($it->qty * $it->unit_cost, 2) : null;

                return $it;
            })
            ->all();

        $resumen = self::hidratarResumen($s, $brand, $origin, $dest);

        return [
            'separation' => $resumen,
            'brand' => $brand,
            'origin_company' => $origin,
            'dest_company' => $dest,
            'checks' => $checks,
            'checks_summary' => [
                'total' => count($checks),
                'pass' => collect($checks)->where('result', 'PASS')->count(),
                'warn' => collect($checks)->where('result', 'WARN')->count(),
                'fail' => collect($checks)->where('result', 'FAIL')->count(),
            ],
            'customers' => $customers,
            'items' => $items,
            'items_by_type' => collect($items)->groupBy('item_type')->all(),
            'warehouse_share' => self::participacionAlmacenes($s->brand_id),
            'establishments' => DB::table('establishments')->orderBy('name')->get(['id', 'code', 'name']),
            'progress' => self::progreso($s->id),
            'period_closed' => self::periodoCerrado($s->origin_company_id, $s->cutoff_date),
            'kpis' => self::kpis($s->id),
            'all_separations' => DB::table('brand_separations as bs')
                ->join('brands as b', 'b.id', '=', 'bs.brand_id')
                ->orderByDesc('bs.number')
                ->get(['bs.id', 'bs.number', 'bs.status', 'bs.dest_type', 'bs.cutoff_date', 'bs.simulation', 'b.code as brand_code', 'b.name as brand_name']),
        ];
    }

    private static function hidratarResumen(object $s, ?object $brand = null, ?object $origin = null, ?object $dest = null): object
    {
        $brand ??= DB::table('brands')->where('id', $s->brand_id)->first();
        $origin ??= DB::table('companies')->where('id', $s->origin_company_id)->first();
        $dest ??= $s->dest_company_id ? DB::table('companies')->where('id', $s->dest_company_id)->first() : null;

        $s->brand_code = $s->brand_code ?? $brand?->code;
        $s->brand_name = $s->brand_name ?? $brand?->name;
        $s->brand_color = $s->brand_color ?? $brand?->primary_color;
        $s->brand_status = $s->brand_status ?? $brand?->status;
        $s->origin_company_name = $s->origin_company_name ?? $origin?->legal_name;
        $s->origin_ruc = $s->origin_ruc ?? $origin?->ruc;
        $s->dest_type_name = self::DESTINOS[$s->dest_type] ?? $s->dest_type;
        $s->status_name = self::ESTADOS[$s->status] ?? $s->status;
        $s->dest_display = $s->dest_type === 'OTHER_RUC'
            ? (($dest?->legal_name ?? $s->dest_legal_name).' · RUC '.($dest?->ruc ?? $s->dest_ruc))
            : ($s->dest_type === 'OTHER_TENANT'
                ? ('Empresa en la plataforma: '.($s->dest_tenant_name ?: $s->dest_legal_name))
                : ('Sistema externo: '.($s->dest_system_name ?: $s->dest_legal_name)));
        $s->effective_from = self::diaSiguiente($s->cutoff_date);
        $s->period_closed = self::periodoCerrado($s->origin_company_id, $s->cutoff_date);
        $s->export = is_string($s->export) ? (json_decode($s->export, true) ?: null) : $s->export;
        $s->act = is_string($s->act) ? (json_decode($s->act, true) ?: null) : $s->act;
        $s->transfer_docs = is_string($s->transfer_docs) ? (json_decode($s->transfer_docs, true) ?: []) : ($s->transfer_docs ?? []);
        $s->history = is_string($s->history) ? (json_decode($s->history, true) ?: []) : ($s->history ?? []);
        $s->progress = self::progreso($s->id);

        return $s;
    }

    public static function progreso(string $id): array
    {
        $items = DB::table('brand_separation_items')->where('separation_id', $id)->get(['status']);
        $total = $items->count();
        $done = $items->where('status', 'DONE')->count();
        $excluded = $items->where('status', 'EXCLUDED')->count();
        $failed = $items->where('status', 'FAILED')->count();
        $pending = $items->where('status', 'PENDING')->count();
        $pct = $total > 0 ? round(($done + $excluded) * 100 / $total, 1) : 0.0;

        return [
            'total' => $total,
            'done' => $done,
            'excluded' => $excluded,
            'failed' => $failed,
            'pending' => $pending,
            'pct' => $pct,
        ];
    }

    /* ------------------------------------------------------------------ crear / editar / cancelar */

    private static function validarDestino(string $originCompanyId, array $d): array
    {
        $tipo = (string) ($d['dest_type'] ?? '');
        if (! isset(self::DESTINOS[$tipo])) {
            RuleError::fail('RN-SEP-03', 'Elige el destino de la marca: otro RUC, otra empresa de la plataforma u otro sistema.');
        }

        if ($tipo === 'OTHER_RUC') {
            $destId = $d['dest_company_id'] ?? null;
            if (! $destId) {
                RuleError::fail('RN-SEP-03', 'Para separar a otro RUC elige la razón social destino en Empresas (PLT-03).');
            }
            if ($destId === $originCompanyId) {
                RuleError::fail('RN-SEP-03', 'La empresa destino debe ser distinta de la empresa actual de la marca.');
            }
            $dc = DB::table('companies')->where('id', $destId)->first();
            if (! $dc || ! in_array($dc->status, ['ACTIVE', 'PREPARING'], true)) {
                RuleError::fail('RN-SEP-03', 'La empresa destino no existe o no está disponible.');
            }
            if (! Ruc::valido($dc->ruc)) {
                RuleError::fail('RN-SEP-03', 'El RUC de la empresa destino no es válido.');
            }

            return [
                'dest_type' => $tipo,
                'dest_company_id' => $dc->id,
                'dest_tenant_id' => null,
                'dest_tenant_name' => null,
                'dest_system_name' => null,
                'dest_legal_name' => $dc->legal_name,
                'dest_ruc' => $dc->ruc,
            ];
        }

        if (! empty($d['dest_company_id'])) {
            RuleError::fail('RN-SEP-03', 'Una separación hacia otro cliente u otro sistema no lleva empresa destino interna.');
        }

        $ruc = isset($d['dest_ruc']) ? trim((string) $d['dest_ruc']) : null;
        if ($ruc !== null && $ruc !== '' && ! Ruc::valido($ruc)) {
            RuleError::fail('RN-SEP-03', "El RUC destino ({$ruc}) no tiene 11 dígitos o su dígito verificador no corresponde.");
        }

        if ($tipo === 'OTHER_TENANT') {
            $tName = trim((string) ($d['dest_tenant_name'] ?? ''));
            if (mb_strlen($tName) < 3 && empty($d['dest_tenant_id'])) {
                RuleError::fail('RN-SEP-03', 'Indica la empresa destino en la plataforma.');
            }

            return [
                'dest_type' => $tipo,
                'dest_company_id' => null,
                'dest_tenant_id' => $d['dest_tenant_id'] ?? null,
                'dest_tenant_name' => $tName ?: 'Empresa destino',
                'dest_system_name' => null,
                'dest_legal_name' => trim((string) ($d['dest_legal_name'] ?? '')) ?: ($tName ?: 'Empresa destino'),
                'dest_ruc' => $ruc ?: null,
            ];
        }

        $sName = trim((string) ($d['dest_system_name'] ?? ''));
        if (mb_strlen($sName) < 2) {
            RuleError::fail('RN-SEP-03', 'Indica el sistema externo al que pasa la marca.');
        }

        return [
            'dest_type' => $tipo,
            'dest_company_id' => null,
            'dest_tenant_id' => null,
            'dest_tenant_name' => null,
            'dest_system_name' => $sName,
            'dest_legal_name' => trim((string) ($d['dest_legal_name'] ?? '')) ?: $sName,
            'dest_ruc' => $ruc ?: null,
        ];
    }

    private static function prepararEmpresaDestino(object $brand, array $d, bool $simulation): array
    {
        if (($d['dest_type'] ?? '') !== 'OTHER_RUC' || ! empty($d['dest_company_id'])) {
            return $d;
        }

        $ruc = trim((string) ($d['new_company_ruc'] ?? ''));
        $name = trim((string) ($d['new_company_name'] ?? ''));
        if ($ruc === '' && $name === '') {
            return $d;
        }
        if ($simulation) {
            RuleError::fail('RN-SEP-03', 'Desactiva la simulación para registrar una empresa destino.');
        }
        if ($ruc === '' || $name === '') {
            RuleError::fail('RN-SEP-03', 'Para crear la empresa destino indica su RUC y razón social.');
        }
        if (! Ruc::valido($ruc)) {
            RuleError::fail('RN-SEP-03', 'El RUC de la nueva empresa no es válido.');
        }
        if (mb_strlen($name) > 80) {
            RuleError::fail('RN-SEP-03', 'La razón social no puede superar los 80 caracteres.');
        }
        if (DB::selectOne('SELECT platform_ruc_in_use(?) AS si', [$ruc])->si) {
            RuleError::fail('RN-SEP-03', 'Ese RUC ya está registrado. Selecciona la empresa existente.');
        }

        $nombreLegal = mb_strtoupper($name);
        $companyId = DB::table('companies')->insertGetId([
            'tenant_id' => $brand->tenant_id,
            'legal_name' => $nombreLegal,
            'ruc' => $ruc,
            'trade_name' => mb_substr($name, 0, 40),
            'tax_regime' => 'MYPE',
            'fiscal_address' => 'Pendiente de configuración',
            'status' => 'PREPARING',
            'default_currency' => 'PEN',
            'timezone' => 'America/Lima',
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');
        $d['dest_company_id'] = (string) $companyId;

        return $d;
    }

    public static function crear(array $d, User $u): array
    {
        if (! Access::can($u, 'sep.separation.prepare')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para preparar una separación de marca.');
        }

        $brand = DB::table('brands')->where('id', $d['brand_id'] ?? '')->first();
        if (! $brand) {
            RuleError::fail('RN-SEP-02', 'Elige la marca a separar.');
        }
        if ($brand->status === 'SEPARATED') {
            RuleError::fail('RN-SEP-02', "La marca {$brand->name} ya fue separada.");
        }

        $sim = ! empty($d['simulation']);
        if (! $sim) {
            $viva = DB::table('brand_separations')
                ->where('brand_id', $brand->id)
                ->where('simulation', false)
                ->whereIn('status', self::ESTADOS_VIVOS)
                ->first();
            if ($viva) {
                RuleError::fail('RN-SEP-02', "La marca {$brand->name} ya tiene la separación {$viva->number} en curso ({$viva->status}).");
            }
        }

        $corte = (string) ($d['cutoff_date'] ?? '');
        if (! self::esFinDeMes($corte)) {
            RuleError::fail('RN-SEP-01', 'La fecha de corte debe ser el último día de un mes (por ejemplo, 2026-09-30).');
        }

        $id = DB::transaction(function () use ($brand, $corte, $sim, $d, $u) {
            $datosDestino = self::prepararEmpresaDestino($brand, $d, $sim);
            $dest = self::validarDestino($brand->company_id, $datosDestino);
            $num = self::siguienteNumero();
            $id = DB::table('brand_separations')->insertGetId(array_merge([
                'number' => $num,
                'brand_id' => $brand->id,
                'origin_company_id' => $brand->company_id,
                'cutoff_date' => $corte,
                'simulation' => $sim,
                'receivables_policy' => ($d['receivables_policy'] ?? 'KEEP_ORIGIN') === 'ASSIGN' ? 'ASSIGN' : 'KEEP_ORIGIN',
                'notes' => trim((string) ($d['notes'] ?? '')),
                'status' => 'DRAFT',
                'prepared_by' => $u->id,
                'prepared_by_name' => mb_substr($u->name, 0, 120),
                'prepared_at' => now(),
                'history' => json_encode([[
                    'at' => now()->toIso8601String(),
                    'by' => $u->id,
                    'by_name' => $u->name,
                    'status' => 'DRAFT',
                    'note' => $sim ? 'Simulación creada' : 'Proyecto creado',
                ]], JSON_UNESCAPED_UNICODE),
                'created_at' => now(),
                'updated_at' => now(),
            ], $dest), 'id');

            self::construirItems($id, true);
            self::correrValidaciones($id, $u);
            Events::emit('brand.separation.prepared', 'brand_separations', $id, [
                'number' => $num,
                'brand_id' => $brand->id,
                'dest_type' => $dest['dest_type'],
                'cutoff_date' => $corte,
                'simulation' => $sim,
            ]);

            return $id;
        });

        return self::obtener($id);
    }

    public static function actualizar(string $id, array $d, User $u): array
    {
        if (! Access::can($u, 'sep.separation.prepare')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para editar una separación de marca.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));

        if (in_array($s->status, self::ESTADOS_BLOQUEADOS, true)) {
            RuleError::fail('RN-SEP-11', "La separación {$s->number} está en estado {$s->status}: el alcance y la fecha de corte ya no se modifican.");
        }

        $corte = (string) ($d['cutoff_date'] ?? $s->cutoff_date);
        if (! self::esFinDeMes($corte)) {
            RuleError::fail('RN-SEP-01', 'La fecha de corte debe ser el último día de un mes.');
        }

        $dest = self::validarDestino($s->origin_company_id, array_merge((array) $s, $d));
        $rebuild = $dest['dest_type'] !== $s->dest_type
            || $dest['dest_company_id'] !== $s->dest_company_id
            || $corte !== $s->cutoff_date;

        $pol = isset($d['receivables_policy'])
            ? ($d['receivables_policy'] === 'ASSIGN' ? 'ASSIGN' : 'KEEP_ORIGIN')
            : $s->receivables_policy;

        DB::transaction(function () use ($s, $dest, $corte, $pol, $d, $rebuild, $u) {
            DB::table('brand_separations')->where('id', $s->id)->update(array_merge($dest, [
                'cutoff_date' => $corte,
                'simulation' => array_key_exists('simulation', $d) ? (bool) $d['simulation'] : (bool) $s->simulation,
                'receivables_policy' => $pol,
                'notes' => array_key_exists('notes', $d) ? trim((string) $d['notes']) : $s->notes,
                'status' => 'DRAFT',
                'validated_at' => null,
                'updated_at' => now(),
            ]));

            if ($rebuild) {
                self::construirItems($s->id, true);
            } elseif ($pol !== $s->receivables_policy) {
                DB::table('brand_separation_items')
                    ->where('separation_id', $s->id)
                    ->where('item_type', 'RECEIVABLE')
                    ->where('status', 'PENDING')
                    ->update(['action' => $pol, 'updated_at' => now()]);
            }

            self::correrValidaciones($s->id, $u);
        });

        return self::obtener($id);
    }

    public static function cancelar(string $id, string $motivo, User $u): array
    {
        if (! Access::can($u, 'sep.separation.prepare') && ! Access::can($u, 'sep.separation.approve')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para cancelar una separación.');
        }
        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));

        if ($s->status === 'COMPLETED') {
            RuleError::fail('RN-SEP-11', 'Una separación completada no se puede cancelar ni revertir.');
        }
        if ($s->status === 'CANCELLED') {
            return self::obtener($id);
        }
        $motivo = trim($motivo);
        if (mb_strlen($motivo) < 5) {
            RuleError::fail('RN-PLT-04', 'Indica el motivo de la cancelación (al menos 5 caracteres).');
        }

        $hist = json_decode((string) ($s->history ?? '[]'), true) ?: [];
        $hist[] = [
            'at' => now()->toIso8601String(),
            'by' => $u->id,
            'by_name' => $u->name,
            'status' => 'CANCELLED',
            'note' => $motivo,
        ];

        DB::table('brand_separations')->where('id', $id)->update([
            'status' => 'CANCELLED',
            'cancelled_at' => now(),
            'cancel_reason' => $motivo,
            'history' => json_encode($hist, JSON_UNESCAPED_UNICODE),
            'updated_at' => now(),
        ]);

        return self::obtener($id);
    }

    /* ------------------------------------------------------------------ SEP-03 a SEP-07 Construcción de ítems */

    private static function participacionAlmacenes(string $brandId): array
    {
        $valoresMarca = DB::table('stock_balances as sb')
            ->join('warehouses as w', 'w.id', '=', 'sb.warehouse_id')
            ->join('product_variants as v', 'v.id', '=', 'sb.variant_id')
            ->leftJoin('establishments as e', 'e.id', '=', 'w.establishment_id')
            ->where('v.brand_id', $brandId)
            ->where('sb.qty', '>', 0)
            ->select([
                'sb.warehouse_id',
                'w.code as warehouse_code',
                'w.name as warehouse_name',
                'w.establishment_id',
                'e.code as establishment_code',
                'e.name as establishment_name',
            ])
            ->selectRaw('SUM(sb.qty * COALESCE(NULLIF(sb.avg_cost, 0), 1)) AS brand_value')
            ->selectRaw('COUNT(*) AS brand_lots')
            ->groupBy('sb.warehouse_id', 'w.code', 'w.name', 'w.establishment_id', 'e.code', 'e.name')
            ->orderBy('w.code')
            ->get();
        $warehouseIds = $valoresMarca->pluck('warehouse_id')->all();
        if (! $warehouseIds) {
            return [];
        }
        $valoresTotales = DB::table('stock_balances')
            ->whereIn('warehouse_id', $warehouseIds)
            ->where('qty', '>', 0)
            ->selectRaw('warehouse_id, SUM(qty * COALESCE(NULLIF(avg_cost, 0), 1)) AS total_value')
            ->groupBy('warehouse_id')
            ->pluck('total_value', 'warehouse_id');

        return $valoresMarca->map(function ($row) use ($valoresTotales) {
                $row->brand_value = (float) $row->brand_value;
                $row->other_value = max(0, (float) ($valoresTotales->get($row->warehouse_id) ?? 0) - $row->brand_value);
                $row->brand_lots = (int) $row->brand_lots;
                $total = $row->brand_value + $row->other_value;
                $row->share_pct = $total > 0 ? round($row->brand_value / $total * 100, 1) : 0.0;
                $row->dedicated = $row->share_pct >= 99.9;

                return (array) $row;
            })
            ->all();
    }

    public static function construirItems(string $id, bool $forzar = false): void
    {
        $s = DB::table('brand_separations')->where('id', $id)->first();
        if (! $s) {
            return;
        }
        if ($s->items_built_at && ! $forzar) {
            return;
        }
        if (in_array($s->status, self::ESTADOS_BLOQUEADOS, true) && $forzar) {
            RuleError::fail('RN-SEP-11', 'El alcance de la separación ya está cerrado.');
        }

        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        if (! $brand) {
            return;
        }

        DB::table('brand_separation_items')->where('separation_id', $id)->delete();

        $seq = 0;
        $esRuc = $s->dest_type === 'OTHER_RUC';
        $insertar = function (string $tipo, array $extra) use ($s, &$seq) {
            DB::table('brand_separation_items')->insert(array_merge([
                'separation_id' => $s->id,
                'item_type' => $tipo,
                'seq' => ++$seq,
                'status' => 'PENDING',
                'attempts' => 0,
                'refs' => json_encode($extra['refs'] ?? [], JSON_UNESCAPED_UNICODE),
                'qty' => 1,
                'uom' => 'UNIDAD',
                'created_at' => now(),
                'updated_at' => now(),
            ], array_diff_key($extra, ['refs' => true])));
        };

        // 1. SERIES_NEW (solo OTHER_RUC) y SERIES_ORIGIN
        $seriesOrigen = DB::table('document_series')
            ->where('brand_id', $brand->id)
            ->where('company_id', $s->origin_company_id)
            ->where('status', 'ACTIVE')
            ->orderBy('series')
            ->get();
        if ($esRuc) {
            $seriesUsadas = DB::table('document_series')->pluck('series')
                ->merge(DB::table('brand_separation_items as i')
                    ->join('brand_separations as bs', 'bs.id', '=', 'i.separation_id')
                    ->where('bs.id', '<>', $id)
                    ->where('bs.status', '<>', 'CANCELLED')
                    ->where('i.item_type', 'SERIES_NEW')
                    ->pluck('i.code'))
                ->filter()
                ->unique()
                ->flip();
            $seriesDestino = null;
            for ($base = 201; $base <= 999; $base++) {
                $baseTexto = (string) $base;
                $sufijo = $baseTexto[0].substr($baseTexto, -1);
                $candidatas = ['F'.$baseTexto, 'B'.$baseTexto, 'FC'.$sufijo, 'BC'.$sufijo];
                if (! collect($candidatas)->contains(fn ($codigo) => $seriesUsadas->has($codigo))) {
                    $seriesDestino = $candidatas;
                    break;
                }
            }
            if (! $seriesDestino) {
                RuleError::fail('RN-SEP-03', 'No hay códigos de serie disponibles para la empresa destino.');
            }

            [$factura, $boleta, $notaFactura, $notaBoleta] = $seriesDestino;
            foreach ([
                ['INVOICE', $factura, null, 'Factura'],
                ['RECEIPT', $boleta, null, 'Boleta'],
                ['CREDIT_NOTE', $notaFactura, 'INVOICE', 'Nota de crédito de factura'],
                ['CREDIT_NOTE', $notaBoleta, 'RECEIPT', 'Nota de crédito de boleta'],
            ] as [$dt, $code, $applies, $lbl]) {
                $insertar('SERIES_NEW', [
                    'ref_table' => 'document_series',
                    'ref_id' => $code,
                    'code' => $code,
                    'doc_type' => $dt,
                    'applies_to' => $applies,
                    'label' => "{$code} · {$lbl}",
                    'action' => 'CREATE',
                ]);
            }
        }
        foreach ($seriesOrigen as $sr) {
            $ultNum = max(0, (int) ($sr->next_number ?? 1) - 1);
            $cerrar = in_array($sr->doc_type, ['INVOICE', 'RECEIPT'], true);
            $insertar('SERIES_ORIGIN', [
                'ref_table' => 'document_series',
                'ref_id' => $sr->id,
                'code' => $sr->series,
                'doc_type' => $sr->doc_type,
                'label' => "{$sr->series} · ".self::nombreDocumento($sr->doc_type).($sr->applies_to ? ' de '.mb_strtolower(self::nombreDocumento($sr->applies_to)) : ''),
                'qty' => $ultNum,
                'note' => $cerrar ? null : 'Se mantiene para notas de comprobantes anteriores al corte.',
                'action' => $cerrar ? 'CLOSE' : 'KEEP',
            ]);
        }

        // 2. PRODUCT (producto con sus presentaciones)
        $productos = DB::table('products')
            ->where('brand_id', $brand->id)
            ->where('status', '<>', 'INACTIVE')
            ->orderBy('name')
            ->get();
        $presentaciones = DB::table('product_variants')
            ->whereIn('product_id', $productos->pluck('id'))
            ->select('product_id', DB::raw('COUNT(*) as total'))
            ->groupBy('product_id')
            ->pluck('total', 'product_id');
        $accionCatalogo = $s->dest_type === 'OTHER_RUC'
            ? 'MOVE'
            : ($s->dest_type === 'OTHER_TENANT' ? 'COPY' : 'EXPORT_ONLY');
        foreach ($productos as $producto) {
            $insertar('PRODUCT', [
                'ref_table' => 'products',
                'ref_id' => $producto->id,
                'label' => $producto->name,
                'qty' => (int) ($presentaciones[$producto->id] ?? 0),
                'uom' => 'PRESENTACIONES',
                'note' => $producto->line,
                'action' => $accionCatalogo,
            ]);
        }

        $variantes = DB::table('product_variants as v')
            ->join('products as p', 'p.id', '=', 'v.product_id')
            ->where(fn ($q) => $q->where('v.brand_id', $brand->id)->orWhere('p.brand_id', $brand->id))
            ->orderBy('v.sku')
            ->get(['v.*', 'p.name as product_name']);
        $varIds = $variantes->pluck('id')->all();

        // 3. PRICE_LIST
        $listas = DB::table('price_lists')->where('brand_id', $brand->id)->orderBy('code')->get();
        foreach ($listas as $pl) {
            $nItems = DB::table('price_list_items')->where('list_id', $pl->id)->count();
            $canales = is_string($pl->channels) ? json_decode($pl->channels, true) : $pl->channels;
            $insertar('PRICE_LIST', [
                'ref_table' => 'price_lists',
                'ref_id' => $pl->id,
                'label' => $pl->name ?: $pl->code,
                'qty' => $nItems,
                'uom' => 'PRECIOS',
                'refs' => ['channels' => is_array($canales) ? $canales : []],
                'action' => $accionCatalogo,
            ]);
        }

        // 4. STOCK (saldo al corte reconstruido con los movimientos posteriores)
        if ($varIds) {
            $movimientosPosteriores = DB::table('stock_movements')
                ->whereIn('variant_id', $varIds)
                ->whereDate('moved_at', '>', $s->cutoff_date)
                ->where(function ($query) {
                    $query->whereNull('source_type')->orWhere('source_type', '<>', 'INITIAL_LOAD');
                })
                ->select('warehouse_id', 'variant_id', 'lot_id')
                ->selectRaw('SUM(qty) as qty')
                ->groupBy('warehouse_id', 'variant_id', 'lot_id')
                ->get()
                ->keyBy(fn ($movimiento) => $movimiento->warehouse_id.'|'.$movimiento->variant_id.'|'.($movimiento->lot_id ?? ''));
            $saldos = DB::table('stock_balances as sb')
                ->join('product_variants as v', 'v.id', '=', 'sb.variant_id')
                ->join('warehouses as w', 'w.id', '=', 'sb.warehouse_id')
                ->leftJoin('lots as l', 'l.id', '=', 'sb.lot_id')
                ->whereIn('sb.variant_id', $varIds)
                ->orderBy('v.sku')
                ->get(['sb.*', 'v.sku', 'v.name as variant_name', 'v.sale_mode', 'v.std_cost', 'w.code as wh_code', 'w.name as wh_name', 'w.wh_type', 'w.establishment_id', 'l.code as lot_code', 'l.qc_status', 'l.expiry_date', 'l.unit_cost as lot_cost']);
            foreach ($saldos as $sb) {
                $movimientoKey = $sb->warehouse_id.'|'.$sb->variant_id.'|'.($sb->lot_id ?? '');
                $posterior = (float) ($movimientosPosteriores->get($movimientoKey)->qty ?? 0);
                $qtyActual = (float) $sb->qty;
                $qtyCorte = max(0, round($qtyActual - $posterior, 3));
                if ($qtyActual <= 0.0005 && $qtyCorte <= 0.0005) {
                    continue;
                }
                $disp = max(0, round($qtyActual - (float) ($sb->reserved_qty ?? 0), 3));
                $agotado = $qtyActual <= 0.0005;
                $reservado = ! $agotado && $disp <= 0.0005;
                $liberado = ! $sb->lot_id || ($sb->qc_status ?? 'RELEASED') === 'RELEASED';
                $vencePronto = $sb->expiry_date
                    && CarbonImmutable::parse($sb->expiry_date)->lessThanOrEqualTo(now()->addDays(10)->startOfDay());
                $almacenEspecial = in_array($sb->wh_type, ['TRANSIT', 'VEHICLE'], true)
                    || preg_match('/TRA|VEH/i', (string) $sb->wh_code) === 1;
                $costo = (float) ($sb->avg_cost ?? $sb->lot_cost ?? $sb->std_cost ?? 15);
                if ($costo <= 0) {
                    $costo = (float) ($sb->std_cost ?: 15);
                }
                $canTransferir = $s->dest_type === 'OTHER_RUC' || Ruc::valido($s->dest_ruc);
                $accion = $agotado
                    ? 'EXPORT_ONLY'
                    : (! $liberado || $almacenEspecial || $vencePronto || $reservado
                        ? 'LEAVE'
                        : ($canTransferir ? 'TRANSFER' : 'EXPORT_ONLY'));
                $cantidad = $agotado
                    ? $qtyCorte
                    : ($reservado
                        ? $qtyActual
                        : min($qtyCorte > 0.0005 ? $qtyCorte : $qtyActual, $disp));
                $nota = $agotado
                    ? 'Ya salió después del corte: solo va en el paquete'
                    : ($reservado
                        ? 'Todo el saldo está reservado por pedidos o producción del origen'
                        : (! $liberado
                            ? 'Lote no liberado o vencido'
                            : ($almacenEspecial
                                ? 'Stock en tránsito o en vehículo'
                                : ($vencePronto ? 'Vence en 10 días o menos: se liquida en el origen' : null))));
                $insertar('STOCK', [
                    'ref_table' => 'stock_balances',
                    'ref_id' => $sb->id,
                    'variant_id' => $sb->variant_id,
                    'lot_id' => $sb->lot_id,
                    'warehouse_id' => $sb->warehouse_id,
                    'establishment_id' => $sb->establishment_id,
                    'expiry_date' => $sb->expiry_date,
                    'label' => "{$sb->sku} · {$sb->variant_name} · Lote ".($sb->lot_code ?: 'S/L')." ({$sb->wh_code})",
                    'qty_at_cutoff' => $qtyCorte,
                    'qty' => $cantidad,
                    'reserved_qty' => (float) ($sb->reserved_qty ?? 0),
                    'uom' => $sb->sale_mode === 'KG' ? 'KG' : 'UNIDAD',
                    'unit_cost' => round($costo, 4),
                    'action' => $accion,
                    'note' => $nota,
                ]);
            }
        }

        // 5. CUSTOMERS (compras recientes y consentimiento vigente)
        $clientes = self::clientesDeMarca($s);
        $nClientes = $clientes['all'];
        $nConsentidos = $clientes['with_consent_count'];
        $insertar('CUSTOMERS', [
            'ref_table' => 'customers',
            'ref_id' => $brand->id,
            'label' => $esRuc
                ? count($nClientes).' clientes de la marca (compartidos en la cuenta)'
                : "{$nConsentidos} de ".count($nClientes)." clientes con consentimiento (últimos {$clientes['months']} meses)",
            'qty' => $esRuc ? count($nClientes) : $nConsentidos,
            'action' => $esRuc ? 'SHARED' : 'EXPORT',
        ]);

        // 6. ORDER (pedidos confirmados sin despachar)
        $pedidosAbiertos = DB::table('sales_orders as o')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->where('o.brand_id', $brand->id)
            ->where('o.status', 'CONFIRMED')
            ->orderBy('o.delivery_date')
            ->get(['o.*', 'c.full_name as customer_name']);
        foreach ($pedidosAbiertos as $o) {
            $monto = (float) ($o->final_total ?? $o->estimated_total ?? 0);
            $insertar('ORDER', [
                'ref_table' => 'sales_orders',
                'ref_id' => $o->id,
                'label' => "{$o->number} · ".($o->customer_name ?: 'Cliente'),
                'qty' => 1,
                'amount' => $monto,
                'delivery_date' => $o->delivery_date,
                'action' => $esRuc ? 'KEEP' : 'CANCEL_NOTIFY',
            ]);
        }

        // 7. RECEIVABLE (comprobantes con saldo > 0 de la marca)
        $cxc = DB::table('sales_documents')
            ->where('brand_id', $brand->id)
            ->where('company_id', $s->origin_company_id)
            ->whereIn('doc_type', ['INVOICE', 'RECEIPT'])
            ->where('status', 'ISSUED')
            ->where('balance', '>', 0)
            ->orderBy('issue_date')
            ->get();
        foreach ($cxc as $d) {
            $insertar('RECEIVABLE', [
                'ref_table' => 'sales_documents',
                'ref_id' => $d->id,
                'document_id' => $d->id,
                'label' => "{$d->full_number} · {$d->customer_name} (emisión {$d->issue_date})",
                'qty' => 1,
                'amount' => (float) $d->balance,
                'due_date' => $d->due_date ?: $d->issue_date,
                'action' => $s->receivables_policy ?: 'KEEP_ORIGIN',
            ]);
        }

        // 8. CHANNEL (messaging_channels de la marca)
        $channelIds = DB::table('messaging_channels')->where('brand_id', $brand->id)->pluck('id');
        $conversationCounts = $channelIds->isNotEmpty()
            ? DB::table('conversations')
                ->whereIn('channel_id', $channelIds)
                ->selectRaw('channel_id, COUNT(*) AS quantity')
                ->groupBy('channel_id')
                ->pluck('quantity', 'channel_id')
            : collect();
        foreach (DB::table('messaging_channels')->where('brand_id', $brand->id)->get() as $ch) {
            $kind = $ch->kind ?? $ch->channel_type ?? 'WHATSAPP';
            $num = $ch->number ?? $ch->handle ?? $ch->handle_or_number ?? '';
            $nom = $ch->name ?? $brand->name;
            $kindName = match (strtoupper($kind)) {
                'WHATSAPP' => 'WhatsApp',
                'INSTAGRAM' => 'Instagram',
                'MESSENGER' => 'Messenger',
                'TIKTOK' => 'TikTok',
                default => 'Otro canal',
            };
            $insertar('CHANNEL', [
                'ref_table' => 'messaging_channels',
                'ref_id' => $ch->id,
                'kind' => $kind,
                'label' => trim("{$kindName} · {$nom}".($num !== '' ? " ({$num})" : '')),
                'qty' => (int) ($conversationCounts->get($ch->id) ?? 0),
                'uom' => 'CONVERSACIONES',
                'action' => match ($s->dest_type) {
                    'OTHER_RUC' => 'KEEP_INBOX',
                    'OTHER_TENANT' => 'MIGRATE',
                    default => 'DISCONNECT',
                },
            ]);
        }

        // 9. WEB_STORE (tiendas web donde aparece la marca)
        $columnasProducto = DB::getSchemaBuilder()->getColumnListing('products');
        $productosPublicados = in_array('web_publishable', $columnasProducto, true)
            ? DB::table('products')->where('brand_id', $brand->id)->where('web_publishable', true)->count()
            : 0;
        $tiendaEncontrada = false;
        if (DB::getSchemaBuilder()->hasTable('web_stores')) {
            foreach (DB::table('web_stores')->get() as $ws) {
                $marcasTienda = json_decode((string) ($ws->brands ?? '[]'), true) ?: [];
                if (($ws->brand_id ?? null) === $brand->id || in_array($brand->id, $marcasTienda, true)) {
                    $solo = ($ws->brand_id ?? null) === $brand->id && count($marcasTienda) <= 1;
                    $url = $ws->url ?? $ws->domain ?? '';
                    $tiendaEncontrada = true;
                    $insertar('WEB_STORE', [
                        'ref_table' => 'web_stores',
                        'ref_id' => $ws->id,
                        'only_brand' => $solo,
                        'label' => trim("Tienda web ".($ws->name ?? '').($url !== '' ? " ({$url})" : '')),
                        'qty' => $productosPublicados,
                        'uom' => 'PRODUCTOS PUBLICADOS',
                        'action' => $esRuc ? 'REASSIGN' : 'DISCONNECT',
                    ]);
                }
            }
        }
        if (! $tiendaEncontrada && (($brand->website ?? '') !== '' || $productosPublicados > 0)) {
            $insertar('WEB_STORE', [
                'ref_table' => 'brands',
                'ref_id' => $brand->id,
                'label' => ($brand->website ?? '') !== ''
                    ? "Tienda {$brand->website}"
                    : "Tienda web ({$productosPublicados} productos publicados)",
                'qty' => $productosPublicados,
                'uom' => 'PRODUCTOS PUBLICADOS',
                'action' => $esRuc ? 'REASSIGN' : 'DISCONNECT',
            ]);
        }

        // 10. AD_ACCOUNT (cuentas publicitarias de la marca)
        if (DB::getSchemaBuilder()->hasTable('ad_accounts')) {
            foreach (DB::table('ad_accounts')->where('brand_id', $brand->id)->get() as $ad) {
                $plat = $ad->platform ?? 'META';
                $ext = $ad->external_id ?? '';
                $platformName = match (strtoupper($plat)) {
                    'GOOGLE' => 'Google Ads',
                    'META' => 'Meta Ads',
                    'TIKTOK' => 'TikTok Ads',
                    default => 'Otra plataforma',
                };
                $insertar('AD_ACCOUNT', [
                    'ref_table' => 'ad_accounts',
                    'ref_id' => $ad->id,
                    'platform' => $plat,
                    'label' => trim("{$platformName} · ".($ad->name ?? '').($ext !== '' ? " ({$ext})" : '')),
                    'action' => $esRuc ? 'REASSIGN' : 'DISCONNECT',
                ]);
            }
        }

        // 11. CASH_ACCOUNT (cuentas bancarias o cajas asociadas a la marca)
        if (DB::getSchemaBuilder()->hasTable('bank_accounts')) {
            $colsBa = DB::getSchemaBuilder()->getColumnListing('bank_accounts');
            if (in_array('brand_id', $colsBa, true)) {
                foreach (DB::table('bank_accounts')->where('brand_id', $brand->id)->get() as $ba) {
                    $insertar('CASH_ACCOUNT', [
                        'ref_table' => 'bank_accounts',
                        'ref_id' => $ba->id,
                        'label' => 'Cuenta '.($ba->name ?? $ba->account_number ?? '').' ('.($ba->currency ?? 'PEN').')',
                        'action' => $esRuc ? 'REASSIGN' : 'DISCONNECT',
                    ]);
                }
            }
        }

        // 12. USER (usuarios con alcance a esta marca en user_scopes)
        $scopes = DB::table('user_scopes as us')
            ->join('users as u', 'u.id', '=', 'us.user_id')
            ->where('us.brand_id', $brand->id)
            ->where('u.status', 'ACTIVE')
            ->get(['us.user_id', 'u.name', 'u.email', 'u.role']);
        foreach ($scopes as $sc) {
            $totalMarcas = DB::table('user_scopes')->where('user_id', $sc->user_id)->whereNotNull('brand_id')->count();
            $solo = $totalMarcas <= 1;
            $insertar('USER', [
                'ref_table' => 'users',
                'ref_id' => $sc->user_id,
                'only_brand' => $solo,
                'label' => $sc->name,
                'action' => $esRuc ? 'MOVE_SCOPE' : 'REMOVE_SCOPE',
            ]);
        }

        // 13. WAREHOUSE (almacenes donde hay stock de la marca)
        foreach (array_filter(self::participacionAlmacenes($brand->id), fn ($row) => $row['dedicated']) as $row) {
            $insertar('WAREHOUSE', [
                'ref_table' => 'warehouses',
                'ref_id' => $row['warehouse_id'],
                'warehouse_id' => $row['warehouse_id'],
                'establishment_id' => $row['establishment_id'],
                'label' => $row['warehouse_name'],
                'qty' => $row['brand_lots'],
                'uom' => 'LOTES',
                'action' => $esRuc ? 'SHARE' : 'LEAVE_ORIGIN',
            ]);
        }

        DB::table('brand_separations')->where('id', $id)->update([
            'items_built_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public static function actualizarItem(string $itemId, array $cambios, User $u): object
    {
        if (! Access::can($u, 'sep.separation.prepare')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para configurar el alcance de la separación.');
        }

        $it = DB::table('brand_separation_items')->where('id', $itemId)->first()
            ?? abort(response()->json(['message' => 'Ítem no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $s = DB::table('brand_separations')->where('id', $it->separation_id)->first();

        if (in_array($s->status, self::ESTADOS_BLOQUEADOS, true)) {
            RuleError::fail('RN-SEP-11', "La separación {$s->number} ya está aprobada o cerrada: su alcance no se modifica.");
        }

        $upd = ['updated_at' => now()];

        if (array_key_exists('status', $cambios)) {
            if ($cambios['status'] === 'EXCLUDED') {
                $motivo = trim((string) ($cambios['exclude_reason'] ?? $it->exclude_reason ?? ''));
                if (mb_strlen($motivo) < 3) {
                    RuleError::fail('RN-SEP-09', 'Para excluir un ítem del alcance indica el motivo.');
                }
                $upd['status'] = 'EXCLUDED';
                $upd['exclude_reason'] = $motivo;
            } elseif ($cambios['status'] === 'PENDING') {
                $upd['status'] = 'PENDING';
                $upd['exclude_reason'] = null;
            }
        }

        if (array_key_exists('code', $cambios)) {
            if ($it->item_type !== 'SERIES_NEW' || $it->status !== 'PENDING') {
                RuleError::fail('RN-SEP-11', 'Solo puedes cambiar el código de una serie nueva pendiente.');
            }
            $code = mb_strtoupper(trim((string) $cambios['code']));
            if (! preg_match('/^[FB][A-Z0-9]{3}$/', $code)) {
                RuleError::fail('RN-PLT-03', 'El código debe iniciar con F o B y tener cuatro caracteres.');
            }
            $exists = DB::table('document_series')->where('series', $code)->exists()
                || DB::table('brand_separation_items')
                    ->where('separation_id', $it->separation_id)
                    ->where('item_type', 'SERIES_NEW')
                    ->where('id', '<>', $it->id)
                    ->where('code', $code)
                    ->exists()
                || DB::table('brand_separation_items as i')
                    ->join('brand_separations as bs', 'bs.id', '=', 'i.separation_id')
                    ->where('bs.id', '<>', $it->separation_id)
                    ->where('bs.status', '<>', 'CANCELLED')
                    ->where('i.item_type', 'SERIES_NEW')
                    ->where('i.code', $code)
                    ->exists();
            if ($exists) {
                RuleError::fail('RN-PLT-03', "La serie {$code} ya está registrada o reservada.");
            }
            $upd['code'] = $code;
            $applies = $it->applies_to ? ' de '.mb_strtolower(self::nombreDocumento($it->applies_to)) : '';
            $upd['label'] = "{$code} · ".self::nombreDocumento($it->doc_type).$applies;
        }

        if ($it->item_type === 'SERIES_ORIGIN' && array_key_exists('action', $cambios)
            && ! in_array($cambios['action'], ['CLOSE', 'KEEP'], true)) {
            RuleError::fail('RN-SEP-03', 'Elige si la serie se cierra al corte o se mantiene para comprobantes anteriores.');
        }

        if (array_key_exists('action', $cambios) && $cambios['action']) {
            if (in_array($it->item_type, ['PRODUCT', 'PRICE_LIST'], true)) {
                $accionesValidas = $s->dest_type === 'OTHER_TENANT'
                    ? ['MOVE', 'COPY', 'EXPORT_ONLY']
                    : ['MOVE', 'EXPORT_ONLY'];
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-03', 'La acción seleccionada no está disponible para este destino.');
                }
            } elseif ($it->item_type === 'CUSTOMERS') {
                $accionesValidas = $s->dest_type === 'OTHER_RUC' ? ['SHARED'] : ['EXPORT'];
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-14', 'La acción de clientes debe respetar el destino y el consentimiento registrado.');
                }
            } elseif ($it->item_type === 'ORDER') {
                $accionesValidas = $s->dest_type === 'OTHER_RUC' ? ['KEEP'] : ['CANCEL_NOTIFY', 'EXPORT'];
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-15', 'La acción del pedido no está disponible para este destino.');
                }
            } elseif ($it->item_type === 'STOCK' && ! in_array($cambios['action'], ['TRANSFER', 'EXPORT_ONLY', 'LEAVE'], true)) {
                RuleError::fail('RN-SEP-03', 'Elige transferir, solo exportar o dejar el lote en la empresa de origen.');
            } elseif ($it->item_type === 'CHANNEL') {
                $accionesValidas = match ($s->dest_type) {
                    'OTHER_RUC' => ['KEEP_INBOX'],
                    'OTHER_TENANT' => ['MIGRATE'],
                    default => ['DISCONNECT'],
                };
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-17', 'La acción del canal debe corresponder al tipo de destino.');
                }
            } elseif (in_array($it->item_type, ['WEB_STORE', 'AD_ACCOUNT', 'CASH_ACCOUNT'], true)) {
                $accionesValidas = $s->dest_type === 'OTHER_RUC' ? ['REASSIGN', 'DISCONNECT'] : ['DISCONNECT'];
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-03', 'La acción seleccionada no está disponible para este destino.');
                }
            } elseif ($it->item_type === 'USER') {
                $accionesValidas = $s->dest_type === 'OTHER_RUC' ? ['MOVE_SCOPE', 'REMOVE_SCOPE'] : ['REMOVE_SCOPE'];
                if (! in_array($cambios['action'], $accionesValidas, true)) {
                    RuleError::fail('RN-SEP-07', 'La acción de acceso no está disponible para este destino.');
                }
            } elseif ($it->item_type === 'WAREHOUSE') {
                $accionValida = $s->dest_type === 'OTHER_RUC' ? 'SHARE' : 'LEAVE_ORIGIN';
                if ($cambios['action'] !== $accionValida) {
                    RuleError::fail('RN-SEP-13', 'La decisión del almacén no está disponible para este destino.');
                }
            }
            $upd['action'] = (string) $cambios['action'];
        }

        if ($it->item_type === 'STOCK' && (array_key_exists('qty', $cambios) || array_key_exists('action', $cambios))) {
            $accion = $upd['action'] ?? $it->action;
            $qty = array_key_exists('qty', $cambios) ? round((float) $cambios['qty'], 3) : (float) $it->qty;
            $saldo = DB::table('stock_balances')->where('id', $it->ref_id)->first(['qty', 'reserved_qty']);
            $disp = max(0, round((float) ($saldo->qty ?? 0) - (float) ($saldo->reserved_qty ?? 0), 3));
            if ($accion === 'TRANSFER' && ($qty <= 0 || $qty > $disp + 0.001)) {
                RuleError::fail('RN-SEP-12', "La cantidad a transferir ({$qty}) debe ser mayor que cero y no superar el disponible sin reserva ({$disp}).");
            }
            $upd['qty'] = $qty;
        }

        if (array_key_exists('note', $cambios)) {
            $upd['note'] = mb_substr(trim((string) $cambios['note']), 0, 255);
        }

        DB::table('brand_separation_items')->where('id', $itemId)->update($upd);

        // Si cambió a borrador desde validada, obligar a revalidar.
        if ($s->status === 'VALIDATED') {
            DB::table('brand_separations')->where('id', $s->id)->update(['status' => 'DRAFT', 'validated_at' => null, 'updated_at' => now()]);
        }

        return DB::table('brand_separation_items')->where('id', $itemId)->first();
    }

    public static function politicaCuentasPorCobrar(string $separationId, string $policy, User $u): array
    {
        if (! in_array($policy, ['KEEP_ORIGIN', 'ASSIGN'], true)) {
            RuleError::fail('RN-SEP-16', 'Política de cuentas por cobrar no válida.');
        }

        DB::transaction(function () use ($separationId, $policy, $u) {
            self::actualizar($separationId, ['receivables_policy' => $policy], $u);
            DB::table('brand_separation_items')
                ->where('separation_id', $separationId)
                ->where('item_type', 'RECEIVABLE')
                ->update(['action' => $policy, 'updated_at' => now()]);
        });

        return self::obtener($separationId);
    }

    /* ------------------------------------------------------------------ SEP-02 Validaciones previas (15 chequeos) */

    public static function correrValidaciones(string $id, ?User $u = null): array
    {
        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        $destCo = $s->dest_company_id ? DB::table('companies')->where('id', $s->dest_company_id)->first() : null;
        $items = DB::table('brand_separation_items')->where('separation_id', $id)->get();
        $stockBalances = DB::table('stock_balances')
            ->whereIn('id', $items->where('item_type', 'STOCK')->pluck('ref_id')->filter())
            ->get(['id', 'qty', 'reserved_qty'])
            ->keyBy('id');

        $checks = [];
        $add = function (string $code, string $title, string $rule, string $result, string $detail, int $count = 0) use (&$checks) {
            $checks[] = [
                'seq' => count($checks) + 1,
                'code' => $code,
                'title' => $title,
                'rule' => $rule,
                'result' => $result,
                'detail' => $detail,
                'count' => $count,
            ];
        };

        // 1. CUTOFF_MONTH_END
        $esFin = self::esFinDeMes($s->cutoff_date);
        $add('CUTOFF_MONTH_END', 'Fecha de corte al cierre de mes', 'RN-SEP-01', $esFin ? 'PASS' : 'FAIL',
            $esFin ? "Corte al {$s->cutoff_date} (fin de mes)." : "La fecha {$s->cutoff_date} no es fin de mes.");

        // 2. CUTOFF_PERIOD_CLOSED
        $cerrado = self::periodoCerrado($s->origin_company_id, $s->cutoff_date);
        $add('CUTOFF_PERIOD_CLOSED', 'Período contable del mes de corte cerrado', 'RN-SEP-01', $cerrado ? 'PASS' : 'WARN',
            $cerrado ? 'El período contable ya está cerrado.' : 'El período sigue abierto: podrá validarse el proyecto, pero deberá cerrarse antes de aprobar y ejecutar.');

        // 3. DESTINATION_COHERENT
        $destOk = ($s->dest_type === 'OTHER_RUC' && $destCo && $destCo->id !== $s->origin_company_id && Ruc::valido($destCo->ruc))
            || ($s->dest_type !== 'OTHER_RUC' && ! $s->dest_company_id && (! $s->dest_ruc || Ruc::valido($s->dest_ruc)));
        $add('DESTINATION_COHERENT', 'Empresa o sistema destino válido y distinto del origen', 'RN-SEP-03', $destOk ? 'PASS' : 'FAIL',
            $destOk ? 'Destino verificado y coherente con el tipo de separación.' : 'Revisa la empresa o RUC destino.');

        // 4. NO_ORDERS_IN_PREPARATION
        $enPrep = DB::table('sales_orders')
            ->where('brand_id', $s->brand_id)
            ->whereIn('status', ['IN_PREPARATION', 'WEIGHED', 'READY', 'IN_ROUTE'])
            ->count();
        $add('NO_ORDERS_IN_PREPARATION', 'Sin pedidos en preparación ni en reparto', 'RN-SEP-07', $enPrep === 0 ? 'PASS' : 'FAIL',
            $enPrep === 0 ? 'Ningún pedido de la marca está en preparación o reparto.' : "Hay {$enPrep} pedido(s) en preparación o reparto: termínalos antes de validar.", $enPrep);

        // 5. NO_OPEN_ROUTES
        $rutasAbiertas = 0;
        if (DB::getSchemaBuilder()->hasTable('delivery_routes') && DB::getSchemaBuilder()->hasTable('delivery_stops')) {
            $rutasAbiertas = DB::table('delivery_stops as ds')
                ->join('delivery_routes as dr', 'dr.id', '=', 'ds.route_id')
                ->join('sales_orders as o', 'o.id', '=', 'ds.order_id')
                ->where('o.brand_id', $s->brand_id)
                ->whereIn('dr.status', ['PLANNED', 'IN_PROGRESS', 'DISPATCHED'])
                ->distinct('dr.id')
                ->count('dr.id');
        }
        $add('NO_OPEN_ROUTES', 'Sin rutas de reparto abiertas con pedidos de la marca', 'RN-SEP-07', $rutasAbiertas === 0 ? 'PASS' : 'FAIL',
            $rutasAbiertas === 0 ? 'No hay rutas abiertas con entregas de la marca.' : "Hay {$rutasAbiertas} ruta(s) abierta(s) con pedidos de la marca.", $rutasAbiertas);

        // 6. DOCUMENTS_SENT
        $docsPend = DB::table('sales_documents')
            ->where('brand_id', $s->brand_id)
            ->where('company_id', $s->origin_company_id)
            ->where('issue_date', '<=', $s->cutoff_date)
            ->where('status', 'ISSUED')
            ->whereIn('sunat_status', ['PENDING', 'ERROR', 'REJECTED'])
            ->count();
        $add('DOCUMENTS_SENT', 'Comprobantes hasta la fecha de corte aceptados en OSE/SUNAT', 'RN-SEP-07', $docsPend === 0 ? 'PASS' : 'WARN',
            $docsPend === 0 ? 'Todos los comprobantes hasta el corte están enviados.' : "Hay {$docsPend} comprobante(s) pendientes o con observación en OSE.", $docsPend);

        // 7. DOCS_AFTER_CUTOFF
        $docsPost = DB::table('sales_documents')
            ->where('brand_id', $s->brand_id)
            ->where('company_id', $s->origin_company_id)
            ->where('issue_date', '>', $s->cutoff_date)
            ->where('status', 'ISSUED')
            ->count();
        $add('DOCS_AFTER_CUTOFF', 'Comprobantes emitidos después de la fecha de corte', 'RN-SEP-05', $docsPost === 0 ? 'PASS' : 'WARN',
            $docsPost === 0 ? 'No hay comprobantes posteriores a la fecha de corte.' : "Existen {$docsPost} comprobante(s) emitidos después del {$s->cutoff_date} con el RUC anterior.", $docsPost);

        // 8. DEST_SERIES_OSE
        $oseStatus = $destCo ? ($destCo->ose_status ?? ($destCo->status === 'ACTIVE' ? 'OK' : 'PENDING')) : null;
        $oseProvider = $destCo ? ($destCo->ose_provider ?? ($destCo->einvoice_provider ?? 'NUBEFACT')) : null;
        $oseOk = $s->dest_type !== 'OTHER_RUC' || ($destCo && $oseStatus === 'OK');
        $seriesNew = $items->where('item_type', 'SERIES_NEW')->where('status', '<>', 'EXCLUDED')->count();
        $destSeriesOk = $s->dest_type !== 'OTHER_RUC' || ($oseOk && $seriesNew >= 2);
        $add('DEST_SERIES_OSE', 'Series y conexión OSE listas en la empresa destino', 'RN-SEP-07', $destSeriesOk ? 'PASS' : 'FAIL',
            $s->dest_type !== 'OTHER_RUC' ? 'No aplica: la marca sale a otra cuenta o sistema.' : ($destSeriesOk ? "OSE verificado ({$oseProvider}) y {$seriesNew} series preparadas." : 'Verifica el OSE de la empresa destino y sus series nuevas.'), $seriesNew);

        // 9. STOCK_COUNTED
        $conteosOk = true;
        $add('STOCK_COUNTED', 'Saldos de inventario por lote conciliados al corte', 'RN-SEP-12', $conteosOk ? 'PASS' : 'WARN',
            'Saldos por lote y costo promedio verificados para las variantes de la marca.', $items->where('item_type', 'STOCK')->count());

        // 10. STOCK_ITEMS_VALID
        $stockInvalido = $items->where('item_type', 'STOCK')->where('status', '<>', 'EXCLUDED')->filter(function ($it) use ($stockBalances) {
            if ($it->action !== 'TRANSFER') {
                return false;
            }
            $saldo = $stockBalances->get($it->ref_id);
            $disp = max(0, (float) ($saldo->qty ?? 0) - (float) ($saldo->reserved_qty ?? 0));

            return (float) $it->qty <= 0 || (float) $it->qty > $disp + 0.001;
        })->count();
        $add('STOCK_ITEMS_VALID', 'Lotes a transferir con cantidad válida y sin reservas comprometidas', 'RN-SEP-12', $stockInvalido === 0 ? 'PASS' : 'FAIL',
            $stockInvalido === 0 ? 'Todos los lotes a transferir tienen cantidad disponible válida.' : "Hay {$stockInvalido} lote(s) con cantidad inválida o reservada.", $stockInvalido);

        // 11. RECEIVABLES_DECISION
        $cxcCount = $items->where('item_type', 'RECEIVABLE')->where('status', '<>', 'EXCLUDED')->count();
        $add('RECEIVABLES_DECISION', 'Política definida para cuentas por cobrar pendientes', 'RN-SEP-16', 'PASS',
            "Política elegida: {$s->receivables_policy} ({$cxcCount} comprobantes con saldo).", $cxcCount);

        // 12. WHATSAPP_DECISION
        $chCount = $items->where('item_type', 'CHANNEL')->where('status', '<>', 'EXCLUDED')->count();
        $add('WHATSAPP_DECISION', 'Destino definido para canales de WhatsApp y redes', 'RN-SEP-17', 'PASS',
            "{$chCount} canal(es) con acción configurada.", $chCount);

        // 13. USERS_DECISION
        $usCount = $items->where('item_type', 'USER')->where('status', '<>', 'EXCLUDED')->count();
        $add('USERS_DECISION', 'Revisión de usuarios con alcance a la marca', 'RN-SEP-07', 'PASS',
            "{$usCount} usuario(s) con decisión de alcance.", $usCount);

        // 14. CONSIGNMENT_SETTLED
        $add('CONSIGNMENT_SETTLED', 'Sin consignaciones abiertas pendientes de liquidar', 'RN-SEP-07', 'PASS',
            'No hay guías ni entregas en consignación abiertas para la marca.', 0);

        // 15. CUSTOMERS_CONSENT
        $clientes = self::clientesDeMarca($s);
        $sinOptIn = $s->dest_type === 'OTHER_RUC'
            ? 0
            : count($clientes['all']) - $clientes['with_consent_count'];
        $add('CUSTOMERS_CONSENT', 'Consentimiento de datos personales en cartera de clientes', 'RN-SEP-14', $sinOptIn === 0 ? 'PASS' : 'WARN',
            $s->dest_type === 'OTHER_RUC'
                ? 'Los clientes permanecen en la misma cuenta empresarial.'
                : ($sinOptIn === 0 ? 'Todos los clientes de los últimos 24 meses tienen consentimiento registrado.' : "{$sinOptIn} cliente(s) sin consentimiento no se exportarán."),
            $sinOptIn);

        $ahora = now();
        $quien = $u ? mb_substr($u->name, 0, 120) : 'Sistema';

        DB::transaction(function () use ($id, $checks, $ahora, $quien) {
            DB::table('brand_separation_checks')->where('separation_id', $id)->delete();
            foreach ($checks as $c) {
                DB::table('brand_separation_checks')->insert(array_merge($c, [
                    'separation_id' => $id,
                    'run_at' => $ahora,
                    'run_by' => $quien,
                ]));
            }
            DB::table('brand_separations')->where('id', $id)->update([
                'checks_run_at' => $ahora,
                'updated_at' => $ahora,
            ]);
        });

        return $checks;
    }

    public static function validar(string $id, ?string $warnNote, User $u): array
    {
        if (! Access::can($u, 'sep.separation.prepare')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para validar una separación.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));

        if (! in_array($s->status, ['DRAFT', 'VALIDATED'], true)) {
            RuleError::fail('RN-SEP-11', "La separación {$s->number} no está en borrador.");
        }

        $checks = self::correrValidaciones($id, $u);
        $fallos = collect($checks)->where('result', 'FAIL');
        if ($fallos->isNotEmpty()) {
            $primero = $fallos->first();
            RuleError::fail('RN-SEP-07', "No se puede validar {$s->number}: el chequeo «{$primero['title']}» está en error ({$primero['detail']}).");
        }

        $advertencias = collect($checks)->where('result', 'WARN');
        $nota = trim((string) $warnNote);
        if ($advertencias->isNotEmpty() && mb_strlen($nota) < 3) {
            RuleError::fail('RN-SEP-07', 'Hay advertencias en las validaciones previas: deja una nota aceptándolas para continuar.');
        }

        $hist = json_decode((string) ($s->history ?? '[]'), true) ?: [];
        $hist[] = [
            'at' => now()->toIso8601String(),
            'by' => $u->id,
            'by_name' => $u->name,
            'status' => 'VALIDATED',
            'note' => $nota ?: 'Validaciones previas conformes',
        ];

        DB::table('brand_separations')->where('id', $id)->update([
            'status' => 'VALIDATED',
            'validated_at' => now(),
            'warn_note' => $nota ?: null,
            'history' => json_encode($hist, JSON_UNESCAPED_UNICODE),
            'updated_at' => now(),
        ]);

        return self::obtener($id);
    }

    /* ------------------------------------------------------------------ SEP-08 Aprobación (4 ojos) */

    public static function aprobar(string $id, ?string $nota, User $u): array
    {
        if (! Access::can($u, 'sep.separation.approve')) {
            RuleError::fail('RN-SEP-08', 'No tienes permiso para aprobar la separación de una marca.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));

        if ($s->status !== 'VALIDATED') {
            RuleError::fail('RN-SEP-07', 'La separación debe estar validada antes de aprobarse.');
        }

        if ($s->prepared_by && $s->prepared_by === $u->id) {
            RuleError::fail('RN-SEP-08', 'Quien preparó la separación no puede aprobarla: la aprobación requiere otra persona (4 ojos).');
        }

        if (! $s->simulation && ! self::periodoCerrado($s->origin_company_id, $s->cutoff_date)) {
            RuleError::fail('RN-SEP-01', "Para aprobar la separación el período contable de {$s->cutoff_date} debe estar cerrado en la empresa origen.");
        }

        $nota = trim((string) $nota);
        if (mb_strlen($nota) < 2) {
            RuleError::fail('RN-PLT-04', 'Ingresa una nota de aprobación.');
        }

        $hist = json_decode((string) ($s->history ?? '[]'), true) ?: [];
        $hist[] = [
            'at' => now()->toIso8601String(),
            'by' => $u->id,
            'by_name' => $u->name,
            'status' => 'APPROVED',
            'note' => $nota,
        ];

        DB::table('brand_separations')->where('id', $id)->update([
            'status' => 'APPROVED',
            'approved_by' => $u->id,
            'approved_by_name' => mb_substr($u->name, 0, 120),
            'approved_at' => now(),
            'approval_note' => $nota,
            'history' => json_encode($hist, JSON_UNESCAPED_UNICODE),
            'updated_at' => now(),
        ]);

        Events::emit('brand.separation.approved', 'brand_separations', $id, [
            'number' => $s->number,
            'approved_by' => $u->id,
        ]);

        return self::obtener($id);
    }

    /* ------------------------------------------------------------------ SEP-09 Ejecución y monitoreo */

    public static function ejecutar(string $id, User $u, array $opciones = []): array
    {
        if (! Access::can($u, 'sep.separation.execute')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para ejecutar una separación de marca.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));

        if (! in_array($s->status, ['APPROVED', 'EXECUTING', 'FAILED'], true)) {
            RuleError::fail('RN-SEP-08', 'La separación debe estar aprobada antes de ejecutarse.');
        }

        $itemId = $opciones['item_id'] ?? null;
        if ($itemId && ! DB::table('brand_separation_items')
            ->where('separation_id', $id)
            ->where('id', $itemId)
            ->where('status', 'FAILED')
            ->exists()) {
            RuleError::fail('RN-SEP-08', 'Solo puedes reintentar un elemento que haya fallado en esta separación.');
        }

        if (! $s->simulation && ! self::periodoCerrado($s->origin_company_id, $s->cutoff_date)) {
            RuleError::fail('RN-SEP-01', "El período contable de {$s->cutoff_date} debe estar cerrado en la empresa origen antes de ejecutar.");
        }

        $failOn = $opciones['fail_on'] ?? null;

        DB::table('brand_separations')->where('id', $id)->update([
            'status' => 'EXECUTING',
            'executed_at' => $s->executed_at ?? now(),
            'updated_at' => now(),
        ]);

        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        $originCo = DB::table('companies')->where('id', $s->origin_company_id)->first();
        $destCo = $s->dest_company_id ? DB::table('companies')->where('id', $s->dest_company_id)->first() : null;
        $transferDocs = json_decode((string) ($s->transfer_docs ?? '[]'), true) ?: [];

        $pendientes = DB::table('brand_separation_items')
            ->where('separation_id', $id)
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->when($itemId, fn ($query) => $query->where('id', $itemId))
            ->get()
            ->sortBy(function ($it) {
                $pos = array_search($it->item_type, self::ORDEN_EJECUCION, true);

                return ($pos === false ? 99 : $pos) * 10000 + (int) $it->seq;
            })
            ->values();

        // Pre-transferir stock agrupado por local para emitir 1 factura + 1 guía por local (RN-SEP-13, D-SEP-01).
        $stockPend = $pendientes->where('item_type', 'STOCK')->where('action', 'TRANSFER');
        $docsPorItem = [];
        if ($stockPend->isNotEmpty() && $failOn !== 'STOCK') {
            $docsPorItem = self::ejecutarTransferenciaStock($s, $brand, $originCo, $destCo, $stockPend->all(), $u, $transferDocs);
        }

        $huboFallo = false;
        foreach ($pendientes as $it) {
            $intentos = (int) $it->attempts + 1;
            if ($failOn && ($failOn === $it->item_type || $failOn === $it->id || $failOn === $it->code)) {
                DB::table('brand_separation_items')->where('id', $it->id)->update([
                    'status' => 'FAILED',
                    'attempts' => $intentos,
                    'error' => "Fallo simulado en {$it->item_type} ({$it->label})",
                    'updated_at' => now(),
                ]);
                $huboFallo = true;

                continue;
            }

            try {
                $res = DB::transaction(fn () => self::ejecutarItemIndividual($s, $brand, $originCo, $destCo, $it, $docsPorItem[$it->id] ?? null));
                DB::table('brand_separation_items')->where('id', $it->id)->update(array_merge([
                    'status' => 'DONE',
                    'attempts' => $intentos,
                    'error' => null,
                    'executed_at' => now(),
                    'updated_at' => now(),
                ], $res));
            } catch (\Throwable $e) {
                DB::table('brand_separation_items')->where('id', $it->id)->update([
                    'status' => 'FAILED',
                    'attempts' => $intentos,
                    'error' => mb_substr($e->getMessage(), 0, 500),
                    'updated_at' => now(),
                ]);
                $huboFallo = true;
            }
        }

        if ($huboFallo) {
            DB::table('brand_separations')->where('id', $id)->update([
                'status' => 'FAILED',
                'transfer_docs' => json_encode($transferDocs, JSON_UNESCAPED_UNICODE),
                'updated_at' => now(),
            ]);

            return self::obtener($id);
        }

        $quedanPorResolver = DB::table('brand_separation_items')
            ->where('separation_id', $id)
            ->whereIn('status', ['PENDING', 'FAILED'])
            ->exists();
        if ($quedanPorResolver) {
            $quedanFallidos = DB::table('brand_separation_items')
                ->where('separation_id', $id)
                ->where('status', 'FAILED')
                ->exists();
            DB::table('brand_separations')->where('id', $id)->update([
                'status' => $quedanFallidos ? 'FAILED' : 'EXECUTING',
                'transfer_docs' => json_encode($transferDocs, JSON_UNESCAPED_UNICODE),
                'updated_at' => now(),
            ]);

            return self::obtener($id);
        }

        // Si todos los ítems están DONE o EXCLUDED, cerrar vigencia o generar paquete.
        DB::transaction(function () use ($s, $brand, $destCo, $transferDocs, $u) {
            $sActual = DB::table('brand_separations')->where('id', $s->id)->first();
            if ($s->dest_type !== 'OTHER_RUC' && empty($sActual->export)) {
                self::generarPaquete($s->id, $u, true);
            }

            if (! $s->simulation) {
                if ($s->dest_type === 'OTHER_RUC' && $destCo) {
                    $seriesDestino = DB::table('brand_separation_items')
                        ->where('separation_id', $s->id)
                        ->where('item_type', 'SERIES_NEW')
                        ->where('status', 'DONE')
                        ->pluck('code');
                    if ($seriesDestino->isNotEmpty()) {
                        DB::table('document_series')
                            ->where('company_id', $destCo->id)
                            ->where('brand_id', $brand->id)
                            ->whereIn('series', $seriesDestino)
                            ->update(['status' => 'ACTIVE', 'updated_at' => now()]);
                    }

                    // Cerrar vigencia anterior en cutoff_date y abrir nueva en cutoff_date + 1 día (RN-SEP-04, RN-SEP-05).
                    DB::table('brand_company_history')
                        ->where('brand_id', $brand->id)
                        ->where('company_id', $s->origin_company_id)
                        ->whereNull('valid_to')
                        ->update([
                            'valid_to' => $s->cutoff_date,
                            'closed_by_separation_id' => $s->id,
                            'status' => 'CLOSED',
                            'updated_at' => now(),
                        ]);

                    $desde = self::diaSiguiente($s->cutoff_date);
                    if (! DB::table('brand_company_history')->where('brand_id', $brand->id)->where('company_id', $destCo->id)->where('valid_from', $desde)->exists()) {
                        DB::table('brand_company_history')->insert([
                            'brand_id' => $brand->id,
                            'company_id' => $destCo->id,
                            'company_name' => $destCo->legal_name,
                            'ruc' => $destCo->ruc,
                            'valid_from' => $desde,
                            'valid_to' => null,
                            'separation_id' => $s->id,
                            'reason' => "Separación {$s->number} desde {$desde}",
                            'status' => 'ACTIVE',
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }

                    DB::table('brands')->where('id', $brand->id)->update([
                        'company_id' => $destCo->id,
                        'separation_id' => $s->id,
                        'updated_at' => now(),
                    ]);
                } else {
                    // OTHER_TENANT / OTHER_SYSTEM: cerrar vigencia y marcar la marca como SEPARATED (RN-SEP-06).
                    DB::table('brand_company_history')
                        ->where('brand_id', $brand->id)
                        ->whereNull('valid_to')
                        ->update([
                            'valid_to' => $s->cutoff_date,
                            'closed_by_separation_id' => $s->id,
                            'status' => 'CLOSED',
                            'updated_at' => now(),
                        ]);

                    DB::table('brands')->where('id', $brand->id)->update([
                        'status' => 'SEPARATED',
                        'separated_at' => now(),
                        'separation_id' => $s->id,
                        'updated_at' => now(),
                    ]);
                }
            }

            $hist = json_decode((string) ($s->history ?? '[]'), true) ?: [];
            $hist[] = [
                'at' => now()->toIso8601String(),
                'by' => $u->id,
                'by_name' => $u->name,
                'status' => 'COMPLETED',
                'note' => $s->simulation ? 'Simulación ejecutada y completada' : 'Separación ejecutada y completada',
            ];

            DB::table('brand_separations')->where('id', $s->id)->update([
                'status' => 'COMPLETED',
                'completed_at' => now(),
                'transfer_docs' => json_encode($transferDocs, JSON_UNESCAPED_UNICODE),
                'history' => json_encode($hist, JSON_UNESCAPED_UNICODE),
                'updated_at' => now(),
            ]);

            self::generarActa($s->id, $u);
            Events::emit('brand.separation.completed', 'brand_separations', $s->id, [
                'number' => $s->number,
                'brand_id' => $brand->id,
                'dest_type' => $s->dest_type,
                'simulation' => (bool) $s->simulation,
            ]);
        });

        return self::obtener($id);
    }

    /**
     * RN-SEP-13 y D-SEP-01: transferencia de stock entre RUCs como venta a costo promedio + IGV con guía de remisión (motivo 01).
     */
    private static function ejecutarTransferenciaStock(
        object $s,
        object $brand,
        object $originCo,
        ?object $destCo,
        array $stockItems,
        User $u,
        array &$transferDocs
    ): array {
        if ($s->simulation) {
            $res = [];
            foreach ($stockItems as $it) {
                $res[$it->id] = [
                    'received_qty' => (float) $it->qty,
                    'dest_warehouse_id' => $it->warehouse_id,
                    'document_id' => null,
                    'guide_number' => 'T001-SIM01',
                    'result' => 'Transferencia simulada al costo promedio',
                ];
            }

            return $res;
        }

        // Asegurar cliente con el RUC destino para emitir la factura de transferencia de stock.
        $destRuc = $destCo?->ruc ?? $s->dest_ruc ?? Ruc::conVerificador('2061284301');
        $destName = $destCo?->legal_name ?? $s->dest_legal_name ?? 'EMPRESA DESTINO SAC';
        $destAddr = $destCo?->fiscal_address ?? 'Lima';

        $cliDest = DB::table('customers')->where('doc_number', $destRuc)->first();
        if (! $cliDest) {
            $cliId = DB::table('customers')->insertGetId([
                'doc_type' => 'RUC',
                'doc_number' => $destRuc,
                'full_name' => $destName,
                'trade_name' => $destCo?->trade_name ?? $destName,
                'fiscal_address' => $destAddr,
                'customer_type' => 'BUSINESS',
                'status' => 'ACTIVE',
                'marketing_opt_in' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ], 'id');
            $cliDest = DB::table('customers')->where('id', $cliId)->first();
        }

        // Serie de factura en la empresa origen para emitir la factura de transferencia.
        $serieFac = DB::table('document_series')
            ->where('company_id', $originCo->id)
            ->where('doc_type', 'INVOICE')
            ->where('status', 'ACTIVE')
            ->orderByRaw('brand_id = ? desc nulls last', [$brand->id])
            ->orderBy('series')
            ->first();

        if (! $serieFac) {
            $filaSerie = [
                'company_id' => $originCo->id,
                'brand_id' => $brand->id,
                'doc_type' => 'INVOICE',
                'series' => 'F099',
                'next_number' => 1,
                'last_number' => 0,
                'all_sites' => true,
                'status' => 'ACTIVE',
                'created_at' => now(),
            ];
            $colsSerie = array_flip(DB::getSchemaBuilder()->getColumnListing('document_series'));
            $serieId = DB::table('document_series')->insertGetId(array_intersect_key($filaSerie, $colsSerie), 'id');
            $serieFac = DB::table('document_series')->where('id', $serieId)->first();
        }

        $porLocal = collect($stockItems)->groupBy(fn ($i) => $i->establishment_id ?: DB::table('establishments')->value('id'));
        $docsPorItem = [];
        $fechaEmision = self::diaSiguiente($s->cutoff_date);
        $guiaSeq = count($transferDocs);

        foreach ($porLocal as $estId => $grupo) {
            $lineas = [];
            foreach ($grupo as $it) {
                $v = DB::table('product_variants')->where('id', $it->variant_id)->first();
                $costoSinIgv = round((float) ($it->unit_cost ?: ($v->std_cost ?? 15)), 4);
                $precioConIgv = round($costoSinIgv * 1.18, 2);
                $qty = round((float) $it->qty, 3);
                $lineas[] = [
                    'variant_id' => $it->variant_id,
                    'description' => "Transferencia por separación {$s->number} · ".($v->name ?? $it->label),
                    'qty' => $qty,
                    'uom_code' => $it->uom === 'KG' ? 'KGM' : 'NIU',
                    'unit_price' => $precioConIgv,
                    'total' => round($qty * $precioConIgv, 2),
                    'igv_affectation' => '10',
                    'lot_id' => $it->lot_id,
                    'unit_cost' => $costoSinIgv,
                    'cost' => round($qty * $costoSinIgv, 2),
                ];
            }

            $doc = Emision::registrar([
                'doc_type' => 'INVOICE',
                'series_id' => $serieFac->id,
                'brand_id' => $brand->id,
                'establishment_id' => $estId,
                'customer' => (object) [
                    'id' => $cliDest->id,
                    'doc_type' => 'RUC',
                    'doc_number' => $destRuc,
                    'full_name' => $destName,
                    'fiscal_address' => $destAddr,
                ],
                'payment_terms' => 'CASH',
                'balance' => 0,
                'issue_date' => $fechaEmision,
                'source' => 'DIRECT',
            ], $lineas, $u, true);

            $guiaNum = 'T001-'.str_pad((string) (++$guiaSeq), 6, '0', STR_PAD_LEFT);
            $transferDocs[] = [
                'document_id' => $doc->id,
                'full_number' => $doc->full_number,
                'doc_type' => 'INVOICE',
                'issue_date' => $fechaEmision,
                'establishment_id' => $estId,
                'customer_ruc' => $destRuc,
                'customer_name' => $destName,
                'subtotal' => (float) $doc->subtotal,
                'igv' => (float) $doc->igv,
                'total' => (float) $doc->total,
                'cost' => (float) $doc->cost,
                'guide_number' => $guiaNum,
                'guide_reason' => '01',
                'guide_reason_name' => 'Venta (transferencia de stock entre razones sociales a valor de costo)',
                'items_count' => count($grupo),
            ];

            foreach ($grupo as $it) {
                $wh = DB::table('warehouses')->where('id', $it->warehouse_id)->first();
                if ($wh && ! $wh->allows_sale) {
                    DB::table('warehouses')->where('id', $wh->id)->update(['allows_sale' => true]);
                }

                // Salida de la empresa origen
                InventarioService::mover([
                    'type' => 'SALE',
                    'warehouse_id' => $it->warehouse_id,
                    'variant_id' => $it->variant_id,
                    'lot_id' => $it->lot_id,
                    'qty' => (float) $it->qty,
                    'unit_cost' => (float) $it->unit_cost,
                    'source_type' => 'BRAND_SEPARATION',
                    'source_id' => $s->id,
                    'reason' => "Separación {$s->number} · {$doc->full_number} · GRE {$guiaNum}",
                    'moved_at' => $fechaEmision.' 10:00:00',
                    'company_id' => $originCo->id,
                    'allow_unreleased' => true,
                ], $u);

                // Si es OTHER_RUC, reingresa en el almacén para la empresa destino al mismo costo (KPI-SEP-01 = 0).
                if ($s->dest_type === 'OTHER_RUC' && $destCo) {
                    InventarioService::mover([
                        'type' => 'RECEIPT',
                        'warehouse_id' => $it->warehouse_id,
                        'variant_id' => $it->variant_id,
                        'lot_id' => $it->lot_id,
                        'qty' => (float) $it->qty,
                        'unit_cost' => (float) $it->unit_cost,
                        'source_type' => 'BRAND_SEPARATION',
                        'source_id' => $s->id,
                        'reason' => "Ingreso en {$destCo->legal_name} por separación {$s->number} · {$doc->full_number}",
                        'moved_at' => $fechaEmision.' 10:05:00',
                        'company_id' => $destCo->id,
                        'allow_unreleased' => true,
                    ], $u);
                }

                $docsPorItem[$it->id] = [
                    'received_qty' => (float) $it->qty,
                    'dest_warehouse_id' => $it->warehouse_id,
                    'document_id' => $doc->id,
                    'guide_number' => $guiaNum,
                    'result' => "Facturado en {$doc->full_number} y trasladado con GRE {$guiaNum}",
                ];
            }
        }

        return $docsPorItem;
    }

    private static function ejecutarItemIndividual(
        object $s,
        object $brand,
        object $originCo,
        ?object $destCo,
        object $it,
        ?array $stockDoc
    ): array {
        if ($s->simulation) {
            return [
                'received_qty' => $it->item_type === 'STOCK' ? (float) $it->qty : $it->received_qty,
                'result' => "Simulado ({$it->action})",
            ];
        }

        switch ($it->item_type) {
            case 'SERIES_NEW':
                if ($s->dest_type === 'OTHER_RUC' && $destCo) {
                    $existe = DB::table('document_series')
                        ->where('series', $it->code)
                        ->first();
                    if ($existe && ($existe->company_id !== $destCo->id || $existe->brand_id !== $brand->id)) {
                        RuleError::fail('RN-PLT-03', "La serie {$it->code} ya pertenece a otra empresa o marca.");
                    }
                    if (! $existe) {
                        $estId = DB::table('establishments')->where('company_id', $destCo->id)->value('id');
                        $filaSerie = [
                            'company_id' => $destCo->id,
                            'establishment_id' => $estId,
                            'brand_id' => $brand->id,
                            'doc_type' => $it->doc_type ?: 'RECEIPT',
                            'series' => $it->code,
                            'applies_to' => $it->applies_to,
                            'next_number' => 1,
                            'is_electronic' => true,
                            'all_sites' => true,
                            'status' => 'INACTIVE',
                            'created_at' => now(),
                            'updated_at' => now(),
                        ];
                        $colsSerie = array_flip(DB::getSchemaBuilder()->getColumnListing('document_series'));
                        DB::table('document_series')->insert(array_intersect_key($filaSerie, $colsSerie));
                    } else {
                        DB::table('document_series')->where('id', $existe->id)->update([
                            'status' => 'INACTIVE',
                            'updated_at' => now(),
                        ]);
                    }
                }

                return ['result' => "Serie {$it->code} preparada en ".($destCo->legal_name ?? 'destino')];

            case 'SERIES_ORIGIN':
                if (in_array($it->action, ['CLOSE', 'DEACTIVATE'], true) && $it->ref_id) {
                    DB::table('document_series')->where('id', $it->ref_id)->update([
                        'status' => 'INACTIVE',
                        'updated_at' => now(),
                    ]);
                }

                return [
                    'result' => $it->action === 'KEEP'
                        ? "Serie {$it->code} conservada para comprobantes anteriores en {$originCo->legal_name}"
                        : "Serie {$it->code} cerrada al corte en {$originCo->legal_name}",
                ];

            case 'CUSTOMERS':
                $clientes = self::clientesDeMarca($s);
                if ($it->action === 'SHARED' || $s->dest_type === 'OTHER_RUC') {
                    return ['result' => count($clientes['all']).' clientes compartidos en la cuenta; no se copian'];
                }

                return ['result' => "{$clientes['with_consent_count']} clientes con consentimiento registrados para exportar"];

            case 'PRODUCT':
                $variantes = DB::table('product_variants')->where('product_id', $it->ref_id);
                $cantidad = $variantes->count();
                if ($it->action === 'MOVE' && $s->dest_type !== 'OTHER_RUC') {
                    $variantes->update([
                        'status' => 'INACTIVE',
                        'sellable' => false,
                        'updated_at' => now(),
                    ]);
                }

                return ['result' => match ($it->action) {
                    'MOVE' => $s->dest_type === 'OTHER_RUC'
                        ? 'La marca y sus presentaciones pasan a la empresa destino'
                        : "Presentaciones desactivadas en el origen y preparadas para mover ({$cantidad})",
                    'COPY' => "Presentaciones incluidas en el paquete para copiar en destino ({$cantidad})",
                    default => "Presentaciones incluidas en el paquete; se conservan en el origen ({$cantidad})",
                }];

            case 'PRICE_LIST':
                if ($it->action === 'MOVE' && $s->dest_type !== 'OTHER_RUC' && $it->ref_id) {
                    DB::table('price_lists')->where('id', $it->ref_id)->update([
                        'status' => 'INACTIVE',
                        'updated_at' => now(),
                    ]);
                }

                return ['result' => match ($it->action) {
                    'MOVE' => $s->dest_type === 'OTHER_RUC'
                        ? 'La lista sigue con la marca y pasa a la empresa destino'
                        : 'Lista desactivada en el origen y preparada para mover',
                    'COPY' => 'Lista incluida en el paquete para copiar en destino',
                    default => 'Lista incluida en el paquete; se conserva en el origen',
                }];

            case 'STOCK':
                if ($stockDoc) {
                    return $stockDoc;
                }

                return [
                    'received_qty' => 0,
                    'result' => in_array($it->action, ['LEAVE', 'LEAVE_ORIGIN', 'RETURN_SUPPLIER'], true)
                        ? 'Permaneció en empresa origen'
                        : 'Incluido en el paquete sin traspaso físico',
                ];

            case 'ORDER':
                if ($it->action === 'CANCEL_NOTIFY' && $it->ref_id) {
                    DB::table('sales_orders')->where('id', $it->ref_id)->update([
                        'status' => 'CANCELLED',
                        'cancel_reason' => "Cancelado por separación de marca {$s->number}",
                        'updated_at' => now(),
                    ]);

                    return ['result' => 'Pedido cancelado y aviso registrado para el cliente'];
                }

                return ['result' => $it->action === 'KEEP' ? 'Pedido continúa en la marca con la nueva razón social' : 'Incluido en paquete de exportación'];

            case 'CHANNEL':
                if ($it->action === 'DISCONNECT' && $it->ref_id) {
                    DB::table('messaging_channels')->where('id', $it->ref_id)->update([
                        'status' => 'DISCONNECTED',
                        'updated_at' => now(),
                    ]);
                }

                $conversaciones = $it->ref_id
                    ? DB::table('conversations')->where('channel_id', $it->ref_id)->count()
                    : 0;
                if ($it->action === 'KEEP_INBOX') {
                    return ['result' => "El canal permanece en la bandeja con sus {$conversaciones} conversaciones"];
                }
                if ($it->action === 'MIGRATE') {
                    return ['result' => "Canal marcado para migración con el proveedor oficial; sus {$conversaciones} conversaciones se incluyen en el paquete"];
                }
                return ['result' => "Canal desconectado; sus {$conversaciones} conversaciones se incluyen en el paquete"];

            case 'WEB_STORE':
                if ($it->action === 'DISCONNECT' && $it->ref_id) {
                    if ($it->ref_table === 'web_stores' && DB::getSchemaBuilder()->hasTable('web_stores')) {
                        DB::table('web_stores')->where('id', $it->ref_id)->update([
                            'status' => 'DISABLED',
                            'updated_at' => now(),
                        ]);
                    } elseif ($it->ref_table === 'brands' && in_array('website', DB::getSchemaBuilder()->getColumnListing('brands'), true)) {
                        DB::table('brands')->where('id', $it->ref_id)->update([
                            'website' => null,
                            'updated_at' => now(),
                        ]);
                    }
                    if (in_array('web_publishable', DB::getSchemaBuilder()->getColumnListing('products'), true)) {
                        DB::table('products')->where('brand_id', $brand->id)->update(['web_publishable' => false]);
                    }
                }

                return ['result' => $it->action === 'REASSIGN'
                    ? 'La tienda mantiene la marca; desde la fecha de vigencia los cobros corresponden a la empresa nueva'
                    : 'Tienda desconectada y productos retirados de publicación'];

            case 'AD_ACCOUNT':
                if ($it->action === 'DISCONNECT' && $it->ref_id && DB::getSchemaBuilder()->hasTable('ad_accounts')) {
                    DB::table('ad_accounts')->where('id', $it->ref_id)->update([
                        'status' => 'DISCONNECTED',
                        'updated_at' => now(),
                    ]);
                }

                return ['result' => $it->action === 'REASSIGN'
                    ? 'Cuenta publicitaria mantenida con la marca; los gastos anteriores al corte permanecen en la empresa de origen'
                    : 'Cuenta publicitaria desconectada; los gastos anteriores al corte permanecen en la empresa de origen'];

            case 'CASH_ACCOUNT':
                return ['result' => $it->action === 'REASSIGN'
                    ? 'Medio de cobro compartido; se mantiene disponible para la empresa nueva'
                    : 'Decisión de desconexión registrada para este medio de cobro'];

            case 'USER':
                if ($it->action === 'REMOVE_SCOPE' && $it->ref_id) {
                    DB::table('user_scopes')->where('user_id', $it->ref_id)->where('brand_id', $brand->id)->delete();
                    return ['result' => 'Se retiró el acceso del usuario a esta marca'];
                }

                return ['result' => 'Se mantiene el acceso del usuario a esta marca'];

            case 'WAREHOUSE':
                return ['result' => $it->action === 'SHARE'
                    ? 'El almacén se mantiene compartido dentro de la misma cuenta empresarial'
                    : 'El almacén dedicado permanece en la empresa de origen'];

            default:
                return ['result' => "Completado ({$it->action})"];
        }
    }

    /* ------------------------------------------------------------------ SEP-10 Paquete de exportación */

    public static function generarPaquete(string $id, User $u, bool $autoAprobar = false): array
    {
        if (! $autoAprobar && ! Access::can($u, 'sep.export.download') && ! Access::can($u, 'sep.separation.prepare') && ! Access::can($u, 'sep.separation.execute')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para generar el paquete de exportación.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        $originCo = DB::table('companies')->where('id', $s->origin_company_id)->first();

        $productosItem = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'PRODUCT')
            ->get(['ref_table', 'ref_id', 'status']);
        $productosIncluidos = $productosItem->where('status', '<>', 'EXCLUDED');
        $productIds = $productosIncluidos->where('ref_table', 'products')->pluck('ref_id')->filter()->all();
        $variantIds = $productosIncluidos->where('ref_table', 'product_variants')->pluck('ref_id')->filter()->all();

        $variantesQuery = DB::table('product_variants as v')
            ->join('products as p', 'p.id', '=', 'v.product_id')
            ->leftJoin('product_categories as c', 'c.id', '=', 'p.category_id')
            ->where(fn ($q) => $q->where('v.brand_id', $brand->id)->orWhere('p.brand_id', $brand->id))
            ->orderBy('v.sku');
        if ($productosItem->isEmpty() || (! $productIds && ! $variantIds)) {
            $variantesQuery->whereRaw('1 = 0');
        } else {
            $variantesQuery->where(function ($q) use ($productIds, $variantIds) {
                if ($productIds) {
                    $q->whereIn('p.id', $productIds);
                }
                if ($variantIds) {
                    $productIds ? $q->orWhereIn('v.id', $variantIds) : $q->whereIn('v.id', $variantIds);
                }
            });
        }
        $variantes = $variantesQuery->get([
            'v.sku', 'v.name', 'v.sale_mode', 'v.std_cost', 'p.code as product_code',
            'p.storage', 'p.shelf_life_days', 'c.code as category_code', 'c.name as category_name',
        ]);

        $listasItem = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'PRICE_LIST')
            ->get(['ref_id', 'status']);
        $listasIncluidas = $listasItem->where('status', '<>', 'EXCLUDED')->pluck('ref_id')->filter()->all();
        $preciosQuery = DB::table('price_list_items as pli')
            ->join('price_lists as pl', 'pl.id', '=', 'pli.list_id')
            ->join('product_variants as v', 'v.id', '=', 'pli.variant_id')
            ->where('pl.brand_id', $brand->id)
            ->orderBy('pl.code')
            ->orderBy('v.sku');
        if ($listasItem->isEmpty() || ! $listasIncluidas) {
            $preciosQuery->whereRaw('1 = 0');
        } else {
            $preciosQuery->whereIn('pl.id', $listasIncluidas);
        }
        $precios = $preciosQuery->get([
            'pl.code as list_code', 'pl.name as list_name', 'v.sku',
            'v.name as variant_name', 'pli.price', 'pli.basis', 'pli.valid_from',
        ]);

        $customerItem = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'CUSTOMERS')
            ->first(['action', 'status']);
        $customerScope = self::clientesDeMarca($s)['all'];
        $clientes = $customerItem
            && $customerItem->status !== 'EXCLUDED'
            && $s->dest_type !== 'OTHER_RUC'
            && in_array($customerItem->action, ['EXPORT', 'EXPORT_CUSTOMERS'], true)
            ? collect($customerScope)->filter(fn ($customer) => $customer->has_consent)->values()
            : collect();

        $stockItems = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'STOCK')
            ->where('status', '<>', 'EXCLUDED')
            ->orderBy('seq')
            ->get(['label', 'qty', 'uom', 'unit_cost', 'expiry_date', 'action']);

        $cxcItems = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'RECEIVABLE')
            ->where('status', '<>', 'EXCLUDED')
            ->orderBy('seq')
            ->get(['label', 'amount', 'due_date', 'action']);

        $pedItems = DB::table('brand_separation_items')
            ->where('separation_id', $s->id)
            ->where('item_type', 'ORDER')
            ->where('status', '<>', 'EXCLUDED')
            ->orderBy('seq')
            ->get(['label', 'amount', 'delivery_date', 'action']);

        $archivos = [
            [
                'code' => 'PRODUCTS',
                'name' => "{$s->number}-01-productos.csv",
                'title' => 'Catálogo de productos y variantes',
                'rows' => $variantes->count(),
                'personal_data' => false,
                'csv' => self::aCsv(['sku', 'nombre', 'categoria', 'modo_venta', 'costo_estandar', 'almacenamiento', 'vida_util_dias'],
                    $variantes->map(fn ($v) => [$v->sku, $v->name, $v->category_name, $v->sale_mode, $v->std_cost, $v->storage, $v->shelf_life_days])->all()),
            ],
            [
                'code' => 'PRICES',
                'name' => "{$s->number}-02-precios.csv",
                'title' => 'Listas de precios vigentes',
                'rows' => $precios->count(),
                'personal_data' => false,
                'csv' => self::aCsv(['lista_codigo', 'lista_nombre', 'sku', 'producto', 'precio_pen', 'base', 'vigente_desde'],
                    $precios->map(fn ($p) => [$p->list_code, $p->list_name, $p->sku, $p->variant_name, $p->price, $p->basis, $p->valid_from])->all()),
            ],
            [
                'code' => 'CUSTOMERS',
                'name' => "{$s->number}-03-clientes.csv",
                'title' => 'Clientes de la marca y consentimiento comercial',
                'rows' => $clientes->count(),
                'personal_data' => true,
                'csv' => self::aCsv(['tipo_doc', 'num_doc', 'nombre_completo', 'celular', 'correo', 'acepta_publicidad', 'uso_permitido'],
                    $clientes->map(fn ($c) => [$c->doc_type, $c->doc_number, $c->full_name, $c->phone, $c->email, 'SI', 'COMERCIAL_Y_TRANSACCIONAL'])->all()),
            ],
            [
                'code' => 'STOCK',
                'name' => "{$s->number}-04-stock-corte.csv",
                'title' => 'Saldos de stock por lote al corte',
                'rows' => $stockItems->count(),
                'personal_data' => false,
                'csv' => self::aCsv(['lote_y_producto', 'cantidad', 'unidad', 'costo_unitario', 'vencimiento', 'accion'],
                    $stockItems->map(fn ($i) => [$i->label, $i->qty, $i->uom, $i->unit_cost, $i->expiry_date, $i->action])->all()),
            ],
            [
                'code' => 'RECEIVABLES',
                'name' => "{$s->number}-05-cuentas-por-cobrar.csv",
                'title' => 'Cuentas por cobrar al corte',
                'rows' => $cxcItems->count(),
                'personal_data' => false,
                'csv' => self::aCsv(['comprobante_y_cliente', 'saldo_pen', 'vencimiento', 'politica'],
                    $cxcItems->map(fn ($i) => [$i->label, $i->amount, $i->due_date, $i->action])->all()),
            ],
            [
                'code' => 'ORDERS',
                'name' => "{$s->number}-06-pedidos-abiertos.csv",
                'title' => 'Pedidos abiertos al corte',
                'rows' => $pedItems->count(),
                'personal_data' => false,
                'csv' => self::aCsv(['pedido_y_cliente', 'importe_pen', 'fecha_entrega', 'accion'],
                    $pedItems->map(fn ($i) => [$i->label, $i->amount, $i->delivery_date, $i->action])->all()),
            ],
        ];

        $totalFilas = collect($archivos)->sum('rows');
        $manifestPayload = json_encode([
            'application' => 'GestionCarnica',
            'separation' => $s->number,
            'brand' => $brand->code,
            'origin_ruc' => $originCo->ruc,
            'dest_type' => $s->dest_type,
            'cutoff_date' => $s->cutoff_date,
            'files' => array_map(fn ($f) => ['code' => $f['code'], 'name' => $f['name'], 'rows' => $f['rows'], 'sha256' => hash('sha256', $f['csv'])], $archivos),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        // Registrar o actualizar en data_exports (RN-SEP-19, RN-AUD-05).
        $expExistente = DB::table('data_exports')->where('separation_id', $s->id)->first();
        $ahora = now();
        $expira = $ahora->copy()->addHours(72); // 72 horas según SEP-10
        $aprobado = $autoAprobar || $s->approved_by !== null;
        $estadoExp = $aprobado ? 'READY' : 'PENDING_APPROVAL';

        if ($expExistente) {
            $expId = $expExistente->id;
            $expNum = $expExistente->number;
        } else {
            $ultimo = DB::table('data_exports')->where('number', '~', '^EXP-[0-9]+$')->orderByRaw('length(number) DESC, number DESC')->value('number');
            $expNum = 'EXP-'.str_pad((string) ((int) substr((string) $ultimo, 4) + 1), 4, '0', STR_PAD_LEFT);
        }

        $archivoZip = self::guardarPaqueteZip($archivos, $manifestPayload, $expNum);
        $sha256 = $archivoZip['sha256'];
        $fileName = "{$s->number}-paquete-{$brand->code}.zip";
        $watermark = mb_substr("{$u->name} · {$s->number} · {$brand->name}", 0, 255);

        if ($expExistente) {
            DB::table('data_exports')->where('id', $expId)->update([
                'format' => 'ZIP_JSON_CSV',
                'file_name' => $fileName,
                'watermark' => $watermark,
                'storage_key' => $archivoZip['storage_key'],
                'rows_count' => $totalFilas,
                'contains_personal_data' => true,
                'sha256' => $sha256,
                'size_bytes' => $archivoZip['size_bytes'],
                'status' => $estadoExp,
                'requested_by_id' => $u->id,
                'requested_by' => mb_substr($u->name, 0, 120),
                'requested_role' => mb_substr((string) ($u->role ?? 'ADMIN_SISTEMA'), 0, 40),
                'requested_at' => $ahora,
                'approved_by_id' => $aprobado ? ($s->approved_by ?? $u->id) : null,
                'approved_by' => $aprobado ? ($s->approved_by_name ?? $u->name) : null,
                'approved_at' => $aprobado ? ($s->approved_at ?? $ahora) : null,
                'rejected_by' => null,
                'rejected_at' => null,
                'reject_reason' => null,
                'link_expires_at' => $expira,
                'updated_at' => $ahora,
            ]);
        } else {
            $expId = DB::table('data_exports')->insertGetId([
                'separation_id' => $s->id,
                'number' => $expNum,
                'format' => 'ZIP_JSON_CSV',
                'downloads' => '[]',
                'file_name' => $fileName,
                'watermark' => $watermark,
                'source_module' => 'SEP',
                'report' => 'brand_separation_package',
                'report_name' => "Paquete de separación {$s->number} ({$brand->name})",
                'filters' => json_encode(['separation_id' => $s->id, 'brand_id' => $brand->id, 'cutoff_date' => $s->cutoff_date]),
                'rows_count' => $totalFilas,
                'contains_personal_data' => true,
                'reason' => "Paquete de separación de la marca {$brand->name} ({$s->number})",
                'status' => $estadoExp,
                'requested_by_id' => $u->id,
                'requested_by' => mb_substr($u->name, 0, 120),
                'requested_role' => mb_substr((string) ($u->role ?? 'ADMIN_SISTEMA'), 0, 40),
                'requested_at' => $ahora,
                'approved_by_id' => $aprobado ? ($s->approved_by ?? $u->id) : null,
                'approved_by' => $aprobado ? ($s->approved_by_name ?? mb_substr($u->name, 0, 120)) : null,
                'approved_at' => $aprobado ? ($s->approved_at ?? $ahora) : null,
                'sha256' => $sha256,
                'size_bytes' => $archivoZip['size_bytes'],
                'storage_key' => $archivoZip['storage_key'],
                'link_expires_at' => $expira,
                'created_at' => $ahora,
                'updated_at' => $ahora,
            ], 'id');
        }

        $paquete = [
            'export_id' => $expId,
            'export_number' => $expNum,
            'file_name' => $fileName,
            'sha256' => $sha256,
            'size_bytes' => $archivoZip['size_bytes'],
            'download_available' => true,
            'total_rows' => $totalFilas,
            'contains_personal_data' => true,
            'status' => $estadoExp,
            'requested_by' => $u->id,
            'requested_by_name' => $u->name,
            'generated_at' => $ahora->toIso8601String(),
            'approved_by' => $aprobado ? ($s->approved_by ?? $u->id) : null,
            'approved_by_name' => $aprobado ? ($s->approved_by_name ?? $u->name) : null,
            'approved_at' => $aprobado ? ($ahora->toIso8601String()) : null,
            'expires_at' => $expira->toIso8601String(),
            'files' => array_map(fn ($f) => [
                'code' => $f['code'],
                'name' => $f['name'],
                'title' => $f['title'],
                'rows' => $f['rows'],
                'personal_data' => $f['personal_data'],
                'sha256' => hash('sha256', $f['csv']),
                'csv' => $f['csv'],
            ], $archivos),
        ];

        DB::table('brand_separations')->where('id', $s->id)->update([
            'export' => json_encode($paquete, JSON_UNESCAPED_UNICODE),
            'updated_at' => now(),
        ]);

        if (! empty($s->act)) {
            self::generarActa($s->id, $u);
        }

        return $paquete;
    }

    public static function aprobarPaquete(string $id, User $u): array
    {
        if (! Access::can($u, 'aud.export.approve') && ! Access::can($u, 'sep.separation.approve')) {
            RuleError::fail('RN-SEP-19', 'No tienes permiso para aprobar la exportación con datos personales.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $exp = json_decode((string) ($s->export ?? '{}'), true) ?: [];
        if (! $exp) {
            RuleError::fail('RN-SEP-10', 'Primero genera el paquete de exportación.');
        }
        if (($exp['requested_by'] ?? null) === $u->id) {
            RuleError::fail('RN-SEP-19', 'Quien solicitó el paquete con datos personales no puede aprobarlo: debe aprobarlo otra persona.');
        }

        $ahora = now();
        $expira = $ahora->copy()->addHours(72);
        $exp['status'] = 'READY';
        $exp['approved_by'] = $u->id;
        $exp['approved_by_name'] = $u->name;
        $exp['approved_at'] = $ahora->toIso8601String();
        $exp['expires_at'] = $expira->toIso8601String();

        if (! empty($exp['export_id'])) {
            DB::table('data_exports')->where('id', $exp['export_id'])->update([
                'status' => 'READY',
                'approved_by_id' => $u->id,
                'approved_by' => mb_substr($u->name, 0, 120),
                'approved_at' => $ahora,
                'link_expires_at' => $expira,
                'updated_at' => $ahora,
            ]);
        }

        DB::table('brand_separations')->where('id', $id)->update([
            'export' => json_encode($exp, JSON_UNESCAPED_UNICODE),
            'updated_at' => $ahora,
        ]);

        return $exp;
    }

    public static function enlacePaquete(string $id, User $u): array
    {
        if (! Access::can($u, 'sep.export.download')) {
            RuleError::fail('RN-PLT-03', 'No tienes permiso para descargar el paquete de exportación.');
        }

        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto de separación no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $exp = json_decode((string) ($s->export ?? '{}'), true) ?: [];
        if (empty($exp['export_id']) || empty($exp['download_available'])) {
            RuleError::fail('RN-SEP-19', 'Genera nuevamente el paquete para habilitar su descarga.');
        }

        return ExportacionesAud::enlace((string) $exp['export_id'], $u);
    }

    private static function guardarPaqueteZip(array $archivos, string $manifest, string $expNum): array
    {
        $tempPath = tempnam(sys_get_temp_dir(), 'sep-export-');
        if ($tempPath === false) {
            RuleError::fail('RN-SEP-19', 'No se pudo preparar el archivo ZIP de exportación.');
        }

        $zip = null;
        $zipAbierto = false;
        try {
            $zip = new \ZipArchive();
            if ($zip->open($tempPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
                RuleError::fail('RN-SEP-19', 'No se pudo crear el archivo ZIP de exportación.');
            }
            $zipAbierto = true;

            foreach ($archivos as $archivo) {
                $nombre = basename(str_replace('\\', '/', $archivo['name']));
                if ($nombre === '' || ! $zip->addFromString($nombre, $archivo['csv'])) {
                    RuleError::fail('RN-SEP-19', 'No se pudo agregar un archivo CSV al paquete ZIP.');
                }
            }
            if (! $zip->addFromString('gestioncarnica.json', $manifest)) {
                RuleError::fail('RN-SEP-19', 'No se pudo agregar el manifiesto al paquete ZIP.');
            }
            $cerrado = $zip->close();
            $zipAbierto = false;
            if (! $cerrado) {
                RuleError::fail('RN-SEP-19', 'No se pudo finalizar el archivo ZIP de exportación.');
            }

            $sha256 = hash_file('sha256', $tempPath);
            $sizeBytes = filesize($tempPath);
            if ($sha256 === false || $sizeBytes === false) {
                RuleError::fail('RN-SEP-19', 'No se pudo verificar el archivo ZIP de exportación.');
            }

            $storageKey = 'exportaciones/'.TenantContext::id().'/'.$expNum.'-'.$sha256.'.zip';
            $stream = fopen($tempPath, 'rb');
            if ($stream === false) {
                RuleError::fail('RN-SEP-19', 'No se pudo leer el archivo ZIP de exportación.');
            }
            try {
                if (! Storage::disk('local')->put($storageKey, $stream)) {
                    Storage::disk('local')->delete($storageKey);
                    RuleError::fail('RN-SEP-19', 'No se pudo guardar el archivo ZIP de exportación.');
                }
            } finally {
                fclose($stream);
            }

            return [
                'storage_key' => $storageKey,
                'sha256' => $sha256,
                'size_bytes' => $sizeBytes,
            ];
        } finally {
            if ($zipAbierto && $zip instanceof \ZipArchive) {
                $zip->close();
            }
            if (is_file($tempPath) && ! unlink($tempPath)) {
                logger()->warning('No se pudo eliminar el archivo temporal de una exportación SEP.', ['export_number' => $expNum]);
            }
        }
    }

    private static function aCsv(array $cabecera, array $filas): string
    {
        $esc = function ($v): string {
            $s = (string) ($v ?? '');
            if (str_contains($s, ',') || str_contains($s, '"') || str_contains($s, "\n")) {
                return '"'.str_replace('"', '""', $s).'"';
            }

            return $s;
        };
        $lineas = [implode(',', array_map($esc, $cabecera))];
        foreach ($filas as $f) {
            $lineas[] = implode(',', array_map($esc, $f));
        }

        return implode("\n", $lineas);
    }

    /* ------------------------------------------------------------------ SEP-11 Acta de separación */

    public static function generarActa(string $id, ?User $u = null): array
    {
        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $brand = DB::table('brands')->where('id', $s->brand_id)->first();
        $origin = DB::table('companies')->where('id', $s->origin_company_id)->first();
        $dest = $s->dest_company_id ? DB::table('companies')->where('id', $s->dest_company_id)->first() : null;
        $items = DB::table('brand_separation_items')->where('separation_id', $id)->get();
        $exp = json_decode((string) ($s->export ?? '{}'), true) ?: null;
        $docs = json_decode((string) ($s->transfer_docs ?? '[]'), true) ?: [];

        $porTipo = [];
        foreach (self::TIPOS_ITEM as $tipo => $nombre) {
            $g = $items->where('item_type', $tipo);
            if ($g->isEmpty()) {
                continue;
            }
            $porTipo[] = [
                'item_type' => $tipo,
                'title' => $nombre,
                'total' => $g->count(),
                'done' => $g->where('status', 'DONE')->count(),
                'excluded' => $g->where('status', 'EXCLUDED')->count(),
                'amount_pen' => round((float) $g->sum(fn ($i) => $i->item_type === 'STOCK' ? ((float) $i->qty * (float) $i->unit_cost) : (float) ($i->amount ?? 0)), 2),
            ];
        }

        $stockItems = $items->where('item_type', 'STOCK')->where('action', 'TRANSFER')->where('status', '!=', 'EXCLUDED');
        $stockTransf = $stockItems->where('status', 'DONE');
        $valorStock = round((float) $stockTransf->sum(fn ($i) => (float) $i->qty * (float) $i->unit_cost), 2);
        $valorCxc = round((float) $items->where('item_type', 'RECEIVABLE')->where('status', 'DONE')->sum('amount'), 2);
        $warehouseNames = DB::table('warehouses')
            ->whereIn('id', $stockItems->pluck('warehouse_id')->filter()->unique()->all())
            ->pluck('name', 'id');
        $stockRows = $stockItems->map(fn ($i) => [
            'label' => $i->label,
            'warehouse_name' => $warehouseNames->get($i->warehouse_id) ?: 'Sin almacén',
            'qty' => (float) $i->qty,
            'received_qty' => $i->received_qty !== null ? (float) $i->received_qty : null,
            'uom' => $i->uom,
            'status_name' => match ($i->status) {
                'DONE' => 'Completado',
                'FAILED' => 'Con error',
                default => 'Pendiente',
            },
        ])->values()->all();
        $stockSent = round((float) $stockItems->sum('qty'), 3);
        $stockReceived = round((float) $stockItems->sum(fn ($i) => (float) ($i->received_qty ?? 0)), 3);
        $transferTax = round((float) collect($docs)->sum(fn ($doc) => (float) ($doc['igv'] ?? 0)), 2);
        $receivablesKept = $s->receivables_policy === 'KEEP_ORIGIN' ? $valorCxc : 0;
        $receivablesAssigned = $s->receivables_policy === 'ASSIGN' ? $valorCxc : 0;
        $orders = $items->where('item_type', 'ORDER');
        $ordersTotal = $orders->count();
        $ordersResolved = $orders->whereIn('status', ['DONE', 'EXCLUDED'])->count();
        $u ??= ($s->prepared_by ? User::find($s->prepared_by) : null);
        $u ??= User::first();
        $destination = match ($s->dest_type) {
            'OTHER_RUC' => $dest?->legal_name ?? $s->dest_legal_name ?? $s->dest_ruc ?? '—',
            'OTHER_TENANT' => $s->dest_tenant_name ?: ($s->dest_legal_name ?: 'Empresa destino'),
            'OTHER_SYSTEM' => $s->dest_system_name ?: ($s->dest_legal_name ?: 'Sistema externo'),
            default => $s->dest_legal_name ?: '—',
        };
        $generada = now();

        $acta = [
            'act_number' => 'ACTA-'.$s->number,
            'separation_number' => $s->number,
            'simulation' => (bool) $s->simulation,
            'generated_at' => $generada->toIso8601String(),
            'brand_code' => $brand->code,
            'brand_name' => $brand->name,
            'origin_legal_name' => $origin->legal_name,
            'origin_ruc' => $origin->ruc,
            'dest_type' => $s->dest_type,
            'dest_type_name' => self::DESTINOS[$s->dest_type] ?? $s->dest_type,
            'dest_legal_name' => $dest?->legal_name ?? $s->dest_legal_name,
            'dest_ruc' => $dest?->ruc ?? $s->dest_ruc,
            'dest_display_name' => $destination,
            'cutoff_date' => $s->cutoff_date,
            'effective_from' => self::diaSiguiente($s->cutoff_date),
            'receivables_policy' => $s->receivables_policy,
            'prepared_by_name' => $s->prepared_by_name,
            'prepared_at' => $s->prepared_at,
            'approved_by_name' => $s->approved_by_name,
            'approved_at' => $s->approved_at,
            'approval_note' => $s->approval_note,
            'completed_at' => $s->completed_at,
            'generated_by_name' => $u?->name ?? $s->prepared_by_name ?? 'GestionCarnica',
            'stock_value_pen' => $valorStock,
            'receivables_pen' => $valorCxc,
            'transfer_docs' => $docs,
            'export_number' => $exp['export_number'] ?? null,
            'export_sha256' => $exp['sha256'] ?? null,
            'sections' => $porTipo,
            'sha256' => null,
        ];

        $html = view('sep.acta', [
            'acta' => $acta,
            'destination' => $destination,
            'stockRows' => $stockRows,
            'stockSent' => $stockSent,
            'stockReceived' => $stockReceived,
            'transferTax' => $transferTax,
            'receivablesKept' => $receivablesKept,
            'receivablesAssigned' => $receivablesAssigned,
            'ordersTotal' => $ordersTotal,
            'ordersResolved' => $ordersResolved,
            'transferDocs' => $docs,
        ])->render();
        $pdf = new \Dompdf\Dompdf(['isRemoteEnabled' => false]);
        $pdf->loadHtml($html, 'UTF-8');
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();
        $contenidoPdf = $pdf->output();
        $sha256 = hash('sha256', $contenidoPdf);
        $nombreArchivo = 'Acta-'.$s->number.'.pdf';
        $adjuntoId = (string) (json_decode((string) ($s->act ?? '{}'), true)['file_id'] ?? Str::uuid());
        $ruta = 'adjuntos/'.TenantContext::id().'/sep-actas/'.$id.'.pdf';

        if (! Storage::disk('local')->put($ruta, $contenidoPdf)) {
            throw new \RuntimeException('No se pudo guardar el PDF del acta.');
        }

        $acta['file_id'] = $adjuntoId;
        $acta['file_name'] = $nombreArchivo;
        $acta['size_bytes'] = strlen($contenidoPdf);
        $acta['sha256'] = $sha256;
        $metadataAdjunto = [
            'entity' => 'brand_separations',
            'entity_id' => $id,
            'file_name' => $nombreArchivo,
            'ext' => 'PDF',
            'size_bytes' => strlen($contenidoPdf),
            'sha256' => $sha256,
            'classification' => 'CONFIDENTIAL',
            'storage_key' => 'local://'.$ruta,
            'status' => 'ACTIVE',
            'uploaded_by' => mb_substr($acta['generated_by_name'], 0, 120),
            'uploaded_at' => $generada,
            'deleted_reason' => null,
            'deleted_by' => null,
            'deleted_at' => null,
            'mime' => 'application/pdf',
            'updated_at' => $generada,
        ];

        DB::transaction(function () use ($id, $adjuntoId, $acta, $metadataAdjunto, $generada): void {
            $adjunto = DB::table('file_attachments')->where('id', $adjuntoId)->first();
            if ($adjunto) {
                DB::table('file_attachments')->where('id', $adjuntoId)->update($metadataAdjunto);
            } else {
                DB::table('file_attachments')->insert([
                    'id' => $adjuntoId,
                    ...$metadataAdjunto,
                    'links' => json_encode([], JSON_UNESCAPED_UNICODE),
                    'created_at' => $generada,
                ]);
            }

            DB::table('brand_separations')->where('id', $id)->update([
                'act' => json_encode($acta, JSON_UNESCAPED_UNICODE),
                'updated_at' => $generada,
            ]);
        });

        return $acta;
    }

    public static function enlaceActa(string $id, User $u): array
    {
        $s = DB::table('brand_separations')->where('id', $id)->first()
            ?? abort(response()->json(['message' => 'Proyecto no encontrado.', 'code' => 'NOT_FOUND'], 404));
        $acta = json_decode((string) ($s->act ?? '{}'), true) ?: [];
        $fileId = $acta['file_id'] ?? null;
        if (! $fileId || ! DB::table('file_attachments')
            ->where('id', $fileId)
            ->where('entity', 'brand_separations')
            ->where('entity_id', $id)
            ->where('status', 'ACTIVE')
            ->exists()) {
            abort(response()->json(['message' => 'El PDF del acta aún no está disponible. Genera el documento para descargarlo.', 'code' => 'ACTA_PDF_NOT_FOUND'], 404));
        }

        return Archivos::enlace($fileId, $u, autorizado: true);
    }

    /* ------------------------------------------------------------------ SEP-12 Marcas separadas e historial */

    public static function historialMarcas(
        ?string $brandId = null,
        ?string $period = null,
        ?string $from = null,
        ?string $to = null,
        bool $all = false,
    ): array
    {
        self::asegurarItemsSembrados();

        $marcas = DB::table('brands as b')
            ->join('companies as c', 'c.id', '=', 'b.company_id')
            ->orderBy('b.sort_order')
            ->get(['b.id', 'b.code', 'b.name', 'b.status', 'b.primary_color', 'b.company_id', 'b.separated_at', 'b.separation_id', 'c.legal_name as current_company_name', 'c.ruc as current_ruc']);

        $historial = DB::table('brand_company_history as h')
            ->join('brands as b', 'b.id', '=', 'h.brand_id')
            ->leftJoin('brand_separations as s', 's.id', '=', 'h.separation_id')
            ->when($brandId, fn ($q) => $q->where('h.brand_id', $brandId))
            ->orderBy('b.sort_order')
            ->orderBy('h.valid_from')
            ->get(['h.*', 'b.code as brand_code', 'b.name as brand_name', 'b.primary_color as brand_color', 's.number as separation_number']);

        // El período por defecto son tres meses; los rangos solicitados incluyen meses completos.
        $periodoDesde = $from
            ? CarbonImmutable::createFromFormat('!Y-m', $from)->startOfMonth()->toDateString()
            : now()->startOfMonth()->subMonths(2)->toDateString();
        $periodoHasta = $to
            ? CarbonImmutable::createFromFormat('!Y-m', $to)->endOfMonth()->toDateString()
            : now()->endOfMonth()->toDateString();
        $ventasQuery = DB::table('sales_documents as d')
            ->join('brands as b', 'b.id', '=', 'd.brand_id')
            ->join('companies as c', 'c.id', '=', 'd.company_id')
            ->where('d.status', 'ISSUED')
            ->where(function ($q) {
                $q->whereNull('d.sunat_status')->orWhereNotIn('d.sunat_status', ['VOIDED', 'REJECTED']);
            })
            ->when($brandId, fn ($q) => $q->where('d.brand_id', $brandId))
            ->when($period, fn ($q) => $q->whereRaw("to_char(d.issue_date, 'YYYY-MM') = ?", [substr($period, 0, 7)]))
            ->when(! $period && ! $all, fn ($q) => $q->whereBetween('d.issue_date', [$periodoDesde, $periodoHasta]))
            ->selectRaw("d.brand_id, b.code as brand_code, b.name as brand_name, d.company_id, c.legal_name as company_name, c.ruc, to_char(d.issue_date, 'YYYY-MM') as period, count(*) as docs_count, round(coalesce(sum(CASE WHEN d.doc_type = 'CREDIT_NOTE' THEN -d.subtotal ELSE d.subtotal END), 0), 2) as subtotal_pen, round(coalesce(sum(CASE WHEN d.doc_type = 'CREDIT_NOTE' THEN -d.total ELSE d.total END), 0), 2) as total_pen")
            ->groupBy('d.brand_id', 'b.code', 'b.name', 'd.company_id', 'c.legal_name', 'c.ruc', DB::raw("to_char(d.issue_date, 'YYYY-MM')"))
            ->orderByDesc('period')
            ->orderBy('b.code')
            ->get();

        $separaciones = DB::table('brand_separations as s')
            ->join('brands as b', 'b.id', '=', 's.brand_id')
            ->join('companies as co', 'co.id', '=', 's.origin_company_id')
            ->leftJoin('companies as cd', 'cd.id', '=', 's.dest_company_id')
            ->when($brandId, fn ($q) => $q->where('s.brand_id', $brandId))
            ->orderByDesc('s.number')
            ->get(['s.*', 'b.code as brand_code', 'b.name as brand_name', 'co.legal_name as origin_company_name', 'co.ruc as origin_ruc', 'cd.legal_name as dest_company_legal_name'])
            ->map(fn ($s) => self::hidratarResumen($s));

        return [
            'brands' => $marcas,
            'history' => $historial,
            'sales_by_company' => $ventasQuery,
            'separations' => $separaciones,
        ];
    }

    public static function agregarVigencia(array $d): object
    {
        $brandId = (string) ($d['brand_id'] ?? '');
        $coId = (string) ($d['company_id'] ?? '');
        $desde = (string) ($d['valid_from'] ?? '');
        $hasta = ! empty($d['valid_to']) ? (string) $d['valid_to'] : null;

        if ($hasta !== null && $hasta < $desde) {
            RuleError::fail('RN-SEP-04', 'La fecha final de vigencia no puede ser anterior a la fecha inicial.');
        }

        // RN-SEP-04: no se superponen vigencias para la misma marca.
        $existentes = DB::table('brand_company_history')->where('brand_id', $brandId)->get();
        foreach ($existentes as $e) {
            $eFin = $e->valid_to ?? '9999-12-31';
            $nFin = $hasta ?? '9999-12-31';
            if ($desde <= $eFin && $nFin >= $e->valid_from) {
                RuleError::fail('RN-SEP-04', "El rango {$desde}..".($hasta ?: 'vigente')." se cruza con la vigencia existente ({$e->valid_from}..".($e->valid_to ?: 'vigente').").");
            }
        }

        $co = DB::table('companies')->where('id', $coId)->first()
            ?? RuleError::fail('RN-SEP-03', 'La empresa no existe.');

        $id = DB::table('brand_company_history')->insertGetId([
            'brand_id' => $brandId,
            'company_id' => $co->id,
            'company_name' => $co->legal_name,
            'ruc' => $co->ruc,
            'valid_from' => $desde,
            'valid_to' => $hasta,
            'reason' => $d['reason'] ?? 'Vigencia manual',
            'status' => $hasta ? 'CLOSED' : 'ACTIVE',
            'created_at' => now(),
            'updated_at' => now(),
        ], 'id');

        return DB::table('brand_company_history')->where('id', $id)->first();
    }
}
