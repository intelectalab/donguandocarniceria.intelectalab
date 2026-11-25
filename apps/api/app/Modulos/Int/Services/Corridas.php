<?php

namespace App\Modulos\Int\Services;

use App\Models\User;
use App\Modulos\Mae\Services\TipoCambio\FuenteTipoCambio;
use App\Modulos\Mae\Services\TipoCambio\SinConector;
use App\Modulos\Mae\Services\TiposDeCambio;
use App\Support\Events;
use App\Support\Paginas;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * INT-08 Corridas programadas: importaciones y sincronizaciones con su inicio, fin, ítems correctos y fallidos.
 *
 * Cada proceso lo instala el módulo que lo usa. El del tipo de cambio ya existe (MAE: TiposDeCambio::cargarDeFuente) y
 * corre de verdad. Los demás (gasto de anuncios, catálogo y stock de WooCommerce, lotes de la granja, estado en el OSE)
 * los agregan ADS, WEB, GRJ y FAC cuando se construyan, registrándolos en $procesos. Mientras tanto:
 *  - en un conector de prueba (SANDBOX) la corrida usa el adaptador falso y no trae datos reales (RN-INT-01);
 *  - en producción no se ejecuta y lo dice, para no registrar una corrida que no pasó.
 */
final class Corridas
{
    /** Proceso => [nombre, tipo de conector]. */
    public const PROCESOS = [
        'FX_DAILY' => ['Tipo de cambio SUNAT', 'FX'], 'ADS_SPEND_IMPORT' => ['Gasto de anuncios', 'ADS'],
        'WOO_CATALOG_SYNC' => ['Catálogo a WooCommerce', 'COMMERCE'], 'WOO_STOCK_SYNC' => ['Stock a WooCommerce', 'COMMERCE'],
        'GRJ_LOTS_SYNC' => ['Lotes de la granja', 'FARM'], 'OSE_STATUS_POLL' => ['Estado de comprobantes en el OSE', 'EINVOICE'],
    ];

    public const ESTADOS = ['COMPLETED' => 'Completada', 'PARTIAL' => 'Parcial', 'FAILED' => 'Fallida'];

    /**
     * Procesos instalados por los módulos: proceso => fn (object $conector): array{ok: int, fallidos: int, detalle: string}.
     * Lanzan una excepción si la corrida falla entera.
     *
     * @var array<string, callable(object): array>
     */
    public static array $procesos = [];

    /** Los procesos que el sistema ya trae instalados. */
    private static function instalados(): array
    {
        return self::$procesos + [
            'FX_DAILY' => function () {
                if (app(FuenteTipoCambio::class) instanceof SinConector) {
                    // Falta el adaptador de SUNAT: la corrida falla, pero no es culpa del proveedor.
                    throw new \LogicException('Todavía no hay conexión con SUNAT para el tipo de cambio: regístralo a mano en Tipos de cambio.');
                }
                $r = TiposDeCambio::cargarDeFuente(TiposDeCambio::hoy());

                return ['ok' => $r['cargado'] ? 1 : 0, 'fallidos' => 0, 'detalle' => $r['mensaje']];
            },
        ];
    }

    /** «Ejecutar ahora» (o el programador de tareas, con $quien = null). */
    public static function ejecutar(string $proceso, string $conectorId, ?User $quien): array
    {
        if (! isset(self::PROCESOS[$proceso])) {
            RuleError::fail('RN-INT-01', 'Ese proceso no existe.');
        }
        $c = Conectores::fila($conectorId);
        if ($c->kind !== self::PROCESOS[$proceso][1]) {
            RuleError::fail('RN-INT-01', "{$c->name} no sirve para «".self::PROCESOS[$proceso][0].'».');
        }
        if ($c->status === 'DISABLED') {
            RuleError::fail('RN-INT-14', "{$c->name} está desactivado: actívalo antes de ejecutar la corrida.");
        }
        if (! Conectores::moduloEncendido($c->owner_module)) {
            RuleError::fail('RN-INT-14', 'El módulo '.Webhooks::nombreModulo($c->owner_module).' está apagado: enciéndelo antes de ejecutar la corrida.');
        }
        $prueba = $c->environment === 'SANDBOX' || $c->adapter === 'FAKE';
        $fn = self::instalados()[$proceso] ?? null;
        if (! $fn && ! $prueba) {
            RuleError::fail('RN-INT-01', '«'.self::PROCESOS[$proceso][0].'» todavía no está instalado: lo incorpora el módulo '
                .Webhooks::nombreModulo($c->owner_module).' cuando se construya. Mientras tanto se puede probar con un conector de prueba.');
        }

        $inicio = now();
        try {
            if ($c->simulate_down) {
                throw new \RuntimeException('El proveedor no respondió (HTTP 503)');
            }
            $r = $fn ? $fn($c) : ['ok' => 0, 'fallidos' => 0, 'detalle' => 'Corrida de prueba con el adaptador falso: respondió bien y no trajo datos reales.'];
            $estado = $r['fallidos'] > 0 ? ($r['ok'] > 0 ? 'PARTIAL' : 'FAILED') : 'COMPLETED';
            Conectores::reportar($c->id, true);
        } catch (\Throwable $e) {
            $r = ['ok' => 0, 'fallidos' => 1, 'detalle' => mb_substr($e->getMessage() ?: 'Error del proveedor', 0, 500)];
            $estado = 'FAILED';
            if (! $e instanceof \LogicException) {
                Conectores::reportar($c->id, false, mb_substr($r['detalle'], 0, 255));
            }
        }
        $id = DB::table('integration_runs')->insertGetId([
            'connector_id' => $c->id, 'job' => $proceso, 'started_at' => $inicio, 'finished_at' => now(), 'status' => $estado,
            'items_ok' => (int) $r['ok'], 'items_failed' => (int) $r['fallidos'], 'detail' => $r['detalle'],
            'triggered_by' => mb_substr($quien?->name ?? 'Programador de tareas', 0, 80), 'created_at' => now(), 'updated_at' => now(),
        ], 'id');
        Events::emit('integration_run.finished', 'integration_runs', $id, ['job' => $proceso, 'status' => $estado, 'by' => $quien?->id]);
        if ($proceso === 'FX_DAILY' && $estado === 'FAILED') {
            self::avisarTipoDeCambio();
        }

        return self::presentar(self::consulta()->where('r.id', $id)->first());
    }

    public static function lista(array $f): array
    {
        $q = self::consulta();
        foreach (['job' => 'r.job', 'status' => 'r.status', 'connector' => 'r.connector_id'] as $k => $col) {
            if (! empty($f[$k])) {
                $q->where($col, $f[$k]);
            }
        }
        if (! empty($f['dia'])) {
            $q->whereRaw("(r.started_at AT TIME ZONE 'America/Lima')::date = ?", [$f['dia']]);
        }
        $q->orderByDesc('r.started_at')->orderBy('r.id');
        Paginas::ordenar($q, ['started_at' => 'r.started_at', 'finished_at' => 'r.finished_at', 'job' => 'r.job', 'connector' => 'c.name',
            'items_ok' => 'r.items_ok', 'items_failed' => 'r.items_failed', 'status' => 'r.status', 'triggered_by' => 'r.triggered_by'], 'r.id', $f);

        $r = DB::selectOne(<<<'SQL'
            WITH u AS (SELECT max(started_at) AS hasta FROM integration_runs)
            SELECT count(*) FILTER (WHERE r.started_at >= u.hasta - interval '7 days') AS semana,
                   count(*) FILTER (WHERE r.status = 'FAILED' AND r.started_at >= u.hasta - interval '7 days') AS fallidas,
                   count(*) FILTER (WHERE r.status = 'PARTIAL' AND r.started_at >= u.hasta - interval '7 days') AS parciales,
                   max(r.started_at) AS ultima
            FROM integration_runs r, u
            SQL);

        return Paginas::de($q, fn ($x) => self::presentar($x), $f) + [
            'cifras' => ['semana' => (int) ($r->semana ?? 0), 'fallidas' => (int) ($r->fallidas ?? 0), 'parciales' => (int) ($r->parciales ?? 0), 'ultima' => $r->ultima ?? null],
            'procesos' => collect(self::PROCESOS)->map(fn ($p, $k) => ['code' => $k, 'name' => $p[0]])->values(),
            'estados' => self::ESTADOS,
            'ejecutables' => self::ejecutables(),
        ];
    }

    /** Botones de «Ejecutar ahora»: cada proceso con los conectores de su tipo, y si se puede ejecutar o por qué no. */
    private static function ejecutables(): array
    {
        $instalados = self::instalados();
        $out = [];
        $conectores = DB::table('integration_connectors')->whereIn('kind', array_unique(array_column(self::PROCESOS, 1)))->orderBy('environment')->orderBy('name')->get();
        foreach (self::PROCESOS as $k => [$nombre, $tipo]) {
            foreach ($conectores->where('kind', $tipo) as $c) {
                $prueba = $c->environment === 'SANDBOX' || $c->adapter === 'FAKE';
                // Por qué no se puede ejecutar (la pantalla lo dice con el nombre corto del módulo).
                $motivo = match (true) {
                    $c->status === 'DISABLED' => 'DESACTIVADO',
                    ! Conectores::moduloEncendido($c->owner_module) => 'MODULO_APAGADO',
                    ! isset($instalados[$k]) && ! $prueba => 'NO_INSTALADO',
                    default => null,
                };
                $out[] = ['job' => $k, 'job_name' => $nombre, 'connector_id' => $c->id, 'connector_name' => $c->name, 'owner_module' => $c->owner_module,
                    'prueba' => $prueba, 'motivo' => $motivo];
            }
        }

        return $out;
    }

    /** RN-MAE-14: tras 3 fallas del día en la carga automática, se pide cargarlo a mano (un aviso por día). */
    private static function avisarTipoDeCambio(): void
    {
        $hoy = TiposDeCambio::hoy();
        $fallas = DB::table('integration_runs')->where('job', 'FX_DAILY')->where('status', 'FAILED')
            ->whereRaw("(started_at AT TIME ZONE 'America/Lima')::date = ?", [$hoy])->count();
        $titulo = 'Carga el tipo de cambio a mano';
        if ($fallas >= 3 && ! DB::table('notifications')->where('module', 'MAE')->where('title', $titulo)->whereRaw("(at AT TIME ZONE 'America/Lima')::date = ?", [$hoy])->exists()) {
            DB::table('notifications')->insert(['role' => 'ADMINISTRACION', 'module' => 'MAE', 'tone' => 'warn', 'severity' => 'WARNING', 'type' => 'INTEGRATIONS', 'at' => now(),
                'title' => $titulo, 'body' => "La carga automática desde SUNAT falló {$fallas} veces hoy.", 'ref' => json_encode(['href' => '/m/mae/mae-05'])]);
        }
    }

    private static function consulta()
    {
        return DB::table('integration_runs as r')->leftJoin('integration_connectors as c', 'c.id', '=', 'r.connector_id')
            ->select('r.*', 'c.name as connector_name', 'c.environment');
    }

    private static function presentar(object $r): array
    {
        return [
            'id' => $r->id, 'job' => $r->job, 'job_name' => self::PROCESOS[$r->job][0] ?? $r->job, 'connector_id' => $r->connector_id, 'connector_name' => $r->connector_name,
            'environment' => $r->environment, 'started_at' => $r->started_at, 'finished_at' => $r->finished_at, 'status' => $r->status,
            'status_name' => self::ESTADOS[$r->status] ?? $r->status, 'items_ok' => (int) $r->items_ok, 'items_failed' => (int) $r->items_failed,
            'detail' => $r->detail, 'triggered_by' => $r->triggered_by,
        ];
    }
}
