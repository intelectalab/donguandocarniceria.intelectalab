<?php

namespace App\Console\Commands;

use App\Modulos\B2b\Services\Cobranza;
use App\Modulos\B2b\Services\Credito;
use App\Modulos\B2b\Services\Reclamos;
use App\Modulos\B2b\Services\Recurrentes;
use App\Modulos\Canales\Soporte as S;
use App\Modulos\Cmp\Services\Audiencia;
use App\Modulos\Cmp\Services\Campanas;
use App\Modulos\Cmp\Services\Puntos;
use App\Modulos\Con\Services\LiquidacionesService;
use App\Modulos\Con\Services\VisitasService;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Tareas diarias de CON, B2B y CMP, por empresa y solo si el módulo está prendido. Programadas en routes/console.php.
 * Todas son idempotentes: correrlas dos veces el mismo día no duplica visitas, avisos, recordatorios, puntos ni pedidos.
 *   canales:diario con   → plan de visitas de la semana, visitas urgentes por lotes retirados, liquidaciones por vencer.
 *   canales:diario b2b   → bloqueo y desbloqueo automático por vencido, recordatorios de cobranza, promesas, reclamos sin respuesta.
 *   canales:diario cmp   → segmentos por actualizar, puntos de cobros y reversos, vencimiento de puntos, atribución y referidos.
 *   canales:diario corrida → corrida de pedidos recurrentes de las 18:00 (RN-B2B-09).
 */
class CanalesDiario extends Command
{
    protected $signature = 'canales:diario {modulo : con, b2b, cmp o corrida} {--fecha= : Fecha (AAAA-MM-DD), por defecto hoy en Lima} {--forzar : La corrida se ejecuta aunque no sea su hora}';

    protected $description = 'Tareas diarias de consignación, clientes empresariales y campañas';

    public function handle(): int
    {
        $m = strtolower($this->argument('modulo'));
        $codigo = ['con' => 'CON', 'b2b' => 'B2B', 'cmp' => 'CMP', 'corrida' => 'B2B'][$m] ?? null;
        if (! $codigo) {
            $this->error('Módulo desconocido: usa con, b2b, cmp o corrida.');

            return self::INVALID;
        }
        $f = $this->option('fecha');
        foreach (DB::select("SELECT id FROM tenants WHERE status = 'ACTIVE' ORDER BY name") as $t) {
            $tenant = TenantContext::find($t->id);
            TenantContext::set($tenant);
            if (! DB::table('tenant_modules')->where('module_code', $codigo)->where('enabled', true)->exists()) {
                continue;
            }
            $this->info($tenant['name'].': '.match ($m) {
                'con' => $this->con($f),
                'b2b' => $this->b2b($f),
                'cmp' => $this->cmp($f),
                'corrida' => $this->corrida($f),
            });
        }
        TenantContext::set(null);

        return self::SUCCESS;
    }

    private function con(?string $f): string
    {
        $plan = VisitasService::planificar($f, 7);
        $urg = 0;
        foreach (DB::table('lots')->where('qc_status', 'RECALLED')->pluck('id') as $lot) {
            $urg += VisitasService::urgentePorRetiro($lot);
        }
        $venc = LiquidacionesService::avisarVencidas($f);

        return sprintf('%d visita(s) planificada(s), %d urgente(s) por retiro, %d liquidación(es) por vencer avisada(s)', $plan['created'] ?? 0, $urg, $venc);
    }

    private function b2b(?string $f): string
    {
        $bloq = 0;
        foreach (DB::table('customer_credit_profiles')->get(['customer_id', 'status']) as $p) {
            $n = Credito::refrescar($p->customer_id, $f);
            $n && $n->status !== $p->status && $bloq++;
        }
        $prog = Cobranza::programarTodos();
        $env = Cobranza::enviarPendientes($f);
        $prom = Cobranza::evaluarPromesas($f);
        $recl = Reclamos::avisarAtrasados();

        return sprintf('%d cambio(s) de estado de crédito, %d recordatorio(s) programado(s), %d enviado(s), %d cancelado(s) por pago, %d promesa(s) evaluada(s), %d reclamo(s) atrasado(s)',
            $bloq, $prog, $env['sent'], $env['cancelled'], $prom, $recl);
    }

    private function cmp(?string $f): string
    {
        $seg = Audiencia::refrescarVencidos();
        $pts = Puntos::sincronizar();
        $venc = Puntos::vencer($f);
        $atr = Campanas::atribuirRecientes();
        $ref = Puntos::revisarReferidos();

        return sprintf('%d segmento(s) actualizado(s), %d cobro(s) con puntos, %d reverso(s), %d vencimiento(s), %d pedido(s) atribuido(s), %d referido(s) premiado(s)',
            $seg, $pts['earned'], $pts['reversed'], $venc, $atr, $ref);
    }

    private function corrida(?string $f): string
    {
        $cuando = ($f ? S::fecha($f) : S::fecha()).' '.($this->option('forzar') ? S::texto('b2b_recurring_run_time', '18:00') : S::ahora()->format('H:i'));
        $r = Recurrentes::correr($cuando, (bool) $this->option('forzar') || (bool) $f);

        return $r['ran'] ? "{$r['ran']} pedido(s) recurrente(s) procesado(s)" : ($r['message'] ?? 'Nada que correr: las corridas de hoy ya existen.');
    }
}
