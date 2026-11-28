<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

/** PRS-08 Proyección de cierre (RN-PRS-08) y PRS-10 Alertas de desviación (RN-PRS-10). */
final class Alertas
{
    /**
     * Evalúa una línea de un mes: proyección, %, semáforo y si pasa el umbral de alerta. Con $crear genera o actualiza su alerta.
     * $o: version_id, period, concept_id, brand_id, establishment_id, cost_center_id, budget, actual, [forecast], [type], [fixed], al.
     */
    public static function evaluar(array $o, bool $crear = true, ?string $cuando = null): array
    {
        $mes = Base::mes($o['period']);
        $al = $o['al'] ?? Base::hoy();
        $dias = Base::diasDelMes($mes);
        $trans = Base::transcurridos($mes, $al);
        $c = Conceptos::porId()[$o['concept_id']] ?? [];
        $fijo = $o['fixed'] ?? (($c['behavior'] ?? null) === 'FIXED');
        $tipo = $o['type'] ?? ($c['concept_type'] ?? 'EXPENSE');
        $proy = $o['forecast'] ?? Base::proyeccion((float) $o['actual'], (float) $o['budget'], $trans, $dias, $fijo);
        $pct = Base::pct($proy, (float) $o['budget']);
        $luz = Base::semaforoDe((float) $o['budget'], $proy, $tipo);
        $excede = $tipo !== 'INCOME' && $o['budget'] > 0 && $proy > $o['budget'] * (1 + Base::umbralAlerta() / 100) + Base::EPS;
        $alerta = $excede && $crear ? self::levantar($o + ['forecast' => $proy, 'pct' => $pct, 'light' => $luz, 'elapsed' => $trans, 'al' => $al], $cuando) : null;

        return ['forecast' => $proy, 'pct' => $pct, 'light' => $luz, 'exceeds' => $excede, 'elapsed' => $trans, 'days' => $dias, 'alert' => $alerta];
    }

    /** Una alerta abierta por línea y mes: si ya está, se actualizan sus cifras; si no, se crea y se avisa al responsable y a GERENTE. */
    private static function levantar(array $o, ?string $cuando = null): object
    {
        $clave = Ejecucion::clave($o);
        $mes = Base::mes($o['period']);
        $datos = ['budget' => Base::r($o['budget']), 'actual' => Base::r($o['actual']), 'forecast' => Base::r($o['forecast']), 'pct' => $o['pct'],
            'level' => $o['light'] === 'AMBER' ? 'AMBER' : 'RED', 'as_of' => $o['al'], 'days_elapsed' => $o['elapsed']];
        $abierta = DB::table('budget_alerts')->where('version_id', $o['version_id'])->where('period', $mes)->where('slot_key', $clave)->whereIn('status', ['OPEN', 'ACK'])->first();
        if ($abierta) {
            DB::table('budget_alerts')->where('id', $abierta->id)->update($datos + ['updated_at' => now()]);

            return DB::table('budget_alerts')->where('id', $abierta->id)->first();
        }
        $dueno = Base::responsable($o['cost_center_id'] ?? null);
        $gerentes = DB::table('users as u')->join('user_roles as ur', 'ur.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ur.role_id')
            ->where('r.code', 'GERENTE')->where('u.status', 'ACTIVE')->pluck('u.id')->all();
        $avisados = array_values(array_unique(array_filter([$dueno, ...$gerentes])));
        $cuando ??= now()->toIso8601String();
        $id = DB::table('budget_alerts')->insertGetId($datos + ['version_id' => $o['version_id'], 'period' => $mes, 'slot_key' => $clave, 'concept_id' => $o['concept_id'],
            'brand_id' => $o['brand_id'] ?? null, 'establishment_id' => $o['establishment_id'] ?? null, 'cost_center_id' => $o['cost_center_id'] ?? null,
            'kind' => 'FORECAST', 'status' => 'OPEN', 'owner_user_id' => $dueno, 'notified' => json_encode($avisados), 'comments' => '[]',
            'raised_at' => $cuando, 'created_at' => $cuando], 'id');
        $nombre = DB::table('budget_concepts')->where('id', $o['concept_id'])->value('name');
        $titulo = "Presupuesto: {$nombre} se proyecta en ".number_format((float) $o['pct'], 1, ',', ' ').' %';
        $cuerpo = self::dimTexto($o).' · '.Base::nombreMes($mes).': presupuesto '.Base::soles($o['budget']).', real '.Base::soles($o['actual'])
            ." al día {$o['elapsed']}, proyección ".Base::soles($o['forecast']).'.';
        foreach ($avisados as $uid) {
            Base::avisar(['user_id' => $uid], $titulo, $cuerpo, 'PRS-10', $id, 'bad', null);
        }
        Events::emit('control_alert.raised', 'budget_alerts', $id, ['module' => 'PRS', 'pct' => $o['pct']]);

        return DB::table('budget_alerts')->where('id', $id)->first();
    }

    public static function dimTexto(array|object $s): string
    {
        $s = (array) $s;
        $p = [];
        if (! empty($s['brand_id'])) {
            $p[] = DB::table('brands')->where('id', $s['brand_id'])->value('name');
        }
        if (! empty($s['establishment_id'])) {
            $p[] = DB::table('establishments')->where('id', $s['establishment_id'])->value('name');
        }
        if (! empty($s['cost_center_id'])) {
            $p[] = DB::table('cost_centers')->where('id', $s['cost_center_id'])->value('code');
        }

        return implode(' · ', array_filter($p)) ?: 'Sin dimensión';
    }

    private static function puede(User $u): void
    {
        if (! Base::veTodo($u)) {
            RuleError::fail('RN-PRS-10', 'Generar alertas y guardar proyecciones lo hacen Gerencia, Administración y la Contadora (prs.report.view_all).');
        }
    }

    /** Evalúa todas las líneas de gasto del mes; las abiertas que ya no exceden quedan resueltas. */
    public static function generar(string $versionId, string $mes, string $al, User $u, ?string $cuando = null): array
    {
        self::puede($u);
        $v = Versiones::version($versionId);
        $m = Base::mes($mes);
        if (! in_array($m, Base::meses((int) $v->year), true)) {
            RuleError::fail('RN-PRS-10', 'El mes no es del año de la versión.');
        }

        return DB::transaction(function () use ($v, $m, $al, $cuando) {
            $ex = Ejecucion::calcular($v->id, [$m], $al, $v->company_id, false, false);
            $activas = [];
            foreach ($ex['slots'] as $s) {
                if ($s['type'] === 'INCOME' || $s['budget'] <= 0) {
                    continue;
                }
                $r = self::evaluar(['version_id' => $v->id, 'period' => $m, 'concept_id' => $s['concept_id'], 'brand_id' => $s['brand_id'],
                    'establishment_id' => $s['establishment_id'], 'cost_center_id' => $s['cost_center_id'], 'budget' => $s['budget'], 'actual' => $s['actual'],
                    'forecast' => $s['forecast'], 'type' => $s['type'], 'fixed' => $s['fixed'], 'al' => $al], true, $cuando);
                if ($r['alert']) {
                    $activas[$r['alert']->slot_key] = $r['alert']->id;
                }
            }
            $resueltas = 0;
            foreach (DB::table('budget_alerts')->where('version_id', $v->id)->where('period', $m)->where('status', 'OPEN')->get() as $a) {
                if (! isset($activas[$a->slot_key])) {
                    $c = json_decode($a->comments, true) ?: [];
                    $c[] = ['at' => Base::ahora(), 'user' => 'Sistema', 'text' => 'La proyección volvió a estar dentro del '.Base::umbralAlerta().' %.'];
                    DB::table('budget_alerts')->where('id', $a->id)->update(['status' => 'RESOLVED', 'comments' => json_encode($c, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);
                    $resueltas++;
                }
            }

            return ['activas' => count($activas), 'resueltas' => $resueltas];
        });
    }

    /** Comentario o acción tomada; puede cambiar el estado (en seguimiento o cerrada). */
    public static function comentar(string $id, ?string $texto, ?string $estado, User $u, ?string $cuando = null): object
    {
        $a = DB::table('budget_alerts')->where('id', $id)->first();
        if (! $a) {
            RuleError::fail('RN-PRS-10', 'La alerta no existe.');
        }
        $permitido = Base::veTodo($u) || $a->owner_user_id === $u->id || in_array($u->id, json_decode($a->notified, true) ?: [], true);
        if (! $permitido) {
            RuleError::fail('RN-PRS-10', 'Comentan la alerta el responsable del centro de costo, Gerencia, Administración y la Contadora.');
        }
        $texto = trim((string) $texto);
        if (mb_strlen($texto) < 5) {
            RuleError::fail('RN-PRS-10', 'Escribe el comentario o la acción tomada.');
        }
        if ($estado !== null && ! in_array($estado, ['OPEN', 'ACK', 'CLOSED'], true)) {
            RuleError::fail('RN-PRS-10', 'Estado no válido.');
        }
        if (in_array($a->status, ['CLOSED', 'RESOLVED'], true) && $estado !== 'OPEN' && $estado !== null) {
            RuleError::fail('RN-PRS-10', 'La alerta ya está cerrada.');
        }
        $c = json_decode($a->comments, true) ?: [];
        $c[] = ['at' => $cuando ? substr($cuando, 0, 16) : Base::ahora(), 'user' => $u->name, 'text' => mb_substr($texto, 0, 1000)];
        $nuevo = $estado ?? $a->status;
        DB::table('budget_alerts')->where('id', $id)->update(['comments' => json_encode($c, JSON_UNESCAPED_UNICODE), 'status' => $nuevo,
            'closed_at' => $nuevo === 'CLOSED' ? ($cuando ?? now()) : null, 'updated_at' => now()]);

        return DB::table('budget_alerts')->where('id', $id)->first();
    }

    /** Guarda la proyección de cierre del mes (una corrida nueva cada vez). */
    public static function guardarProyeccion(string $versionId, string $mes, string $al, User $u, ?string $cuando = null): array
    {
        self::puede($u);
        $v = Versiones::version($versionId);
        $m = Base::mes($mes);
        $ex = Ejecucion::calcular($v->id, [$m], $al, $v->company_id, false, false);
        $run = (string) Uuid::uuid4();
        $cuando ??= now()->toIso8601String();
        $dias = Base::diasDelMes($m);
        $trans = Base::transcurridos($m, $al);
        $filas = [];
        foreach ($ex['slots'] as $s) {
            $x = $s['months'][$m];
            $filas[] = ['version_id' => $v->id, 'period' => $m, 'run_id' => $run, 'as_of' => $al, 'method' => Base::metodo(), 'concept_id' => $s['concept_id'],
                'brand_id' => $s['brand_id'], 'establishment_id' => $s['establishment_id'], 'cost_center_id' => $s['cost_center_id'],
                'budget' => $x['budget'], 'actual' => $x['actual'], 'forecast' => $x['forecast'], 'forecast_pct' => Base::pct($x['forecast'], $x['budget']),
                'light' => Base::semaforoDe($x['budget'], $x['forecast'], $s['type']), 'days_elapsed' => $trans, 'days_in_month' => $dias,
                'created_by' => $u->id, 'created_at' => $cuando];
        }
        DB::transaction(function () use ($filas) {
            foreach (array_chunk($filas, 300) as $lote) {
                DB::table('budget_forecasts')->insert($lote);
            }
        });

        return ['run_id' => $run, 'lineas' => count($filas)];
    }

    public static function puedeVerAlertas(User $u): bool
    {
        return Base::veTodo($u) || Access::module($u, 'PRS');
    }
}
