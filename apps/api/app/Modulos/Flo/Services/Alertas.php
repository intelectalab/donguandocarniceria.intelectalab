<?php

namespace App\Modulos\Flo\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/** FLO-14 Alertas de flota: una sola abierta por vehículo, tipo y origen; las repeticiones se suman (RN-FLO-20). */
final class Alertas
{
    /**
     * Levanta la alerta o suma una repetición a la abierta. Devuelve [fila, creada].
     * $a: type, vehicle_id, employee_id, origin, title, detail, severity, at, extra (columnas propias del tipo).
     */
    public static function levantar(array $a): array
    {
        $en = $a['at'] ?? Base::ahora();
        $sujeto = $a['vehicle_id'] ?? $a['employee_id'];
        $abierta = DB::table('fleet_alerts')->where('alert_type', $a['type'])->where('origin', $a['origin'])->where('status', '<>', 'CLOSED')
            ->whereRaw('coalesce(vehicle_id, employee_id) = ?', [$sujeto])->lockForUpdate()->first();
        $extra = $a['extra'] ?? [];
        if ($abierta) {
            // Una condición que sigue igual en el barrido (documento vencido, plan vencido, GPS callado) no es una nueva ocurrencia.
            $estado = ! empty($a['estado']);
            $igual = $estado && $abierta->title === mb_substr($a['title'], 0, 255);
            DB::table('fleet_alerts')->where('id', $abierta->id)->update($extra + [
                'occurrences' => $abierta->occurrences + ($estado ? 0 : 1), 'last_at' => $igual ? $abierta->last_at : $en, 'title' => mb_substr($a['title'], 0, 255), 'detail' => $a['detail'] ?? null,
                'severity' => $a['severity'] ?? $abierta->severity, 'updated_at' => now(),
            ]);

            return [DB::table('fleet_alerts')->where('id', $abierta->id)->first(), false];
        }
        $id = DB::table('fleet_alerts')->insertGetId($extra + [
            'number' => Base::numero('fleet_alerts', 'AF-', 5), 'alert_type' => $a['type'], 'vehicle_id' => $a['vehicle_id'] ?? null,
            'employee_id' => $a['employee_id'] ?? null, 'origin' => $a['origin'], 'title' => mb_substr($a['title'], 0, 255), 'detail' => $a['detail'] ?? null,
            'severity' => $a['severity'] ?? 'warn', 'first_at' => $en, 'last_at' => $en, 'occurrences' => 1, 'status' => 'OPEN',
        ], 'id');
        if (($a['severity'] ?? 'warn') === 'bad' && empty($a['silencio'])) {
            Base::avisar(['role' => 'COORDINADOR_DELIVERY'], (Base::ALERTAS[$a['type']] ?? $a['type']).' · '.self::sujeto($a), $a['title'], 'FLO-14', $id, 'bad');
        }

        return [DB::table('fleet_alerts')->where('id', $id)->first(), true];
    }

    private static function sujeto(array $a): string
    {
        if (! empty($a['vehicle_id'])) {
            return (string) DB::table('vehicles')->where('id', $a['vehicle_id'])->value('plate');
        }

        return (string) DB::table('employees')->where('id', $a['employee_id'] ?? null)->value('full_name');
    }

    /** Cierre automático de las alertas abiertas de ese tipo y origen (renovado, hecho, jornada cerrada…). */
    public static function cerrarPor(string $tipo, array $origenes, string $resolucion, ?User $u): int
    {
        if (! $origenes) {
            return 0;
        }

        return DB::table('fleet_alerts')->where('alert_type', $tipo)->whereIn('origin', $origenes)->where('status', '<>', 'CLOSED')
            ->update(['status' => 'CLOSED', 'closed_at' => now(), 'closed_by' => $u?->id, 'resolution' => mb_substr($resolucion, 0, 900).' (cierre automático)', 'updated_at' => now()]);
    }

    public static function atender(string $id, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($id, $nota, $u) {
            $a = self::visible($id, $u, true);
            if ($a->status !== 'OPEN') {
                RuleError::fail('RN-FLO-20', 'Solo se atiende una alerta abierta.');
            }
            $n = Base::texto($nota, 'RN-FLO-20', 'Indica qué acción se tomó.', 3, 1000);
            DB::table('fleet_alerts')->where('id', $id)->update(['status' => 'ACK', 'ack_by' => $u->id, 'ack_at' => now(), 'ack_note' => $n, 'updated_at' => now()]);

            return DB::table('fleet_alerts')->where('id', $id)->first();
        });
    }

    public static function cerrar(string $id, ?string $resolucion, User $u): object
    {
        return DB::transaction(function () use ($id, $resolucion, $u) {
            $a = self::visible($id, $u, true);
            if ($a->status === 'CLOSED') {
                RuleError::fail('RN-FLO-20', 'La alerta ya está cerrada.');
            }
            $r = Base::texto($resolucion, 'RN-FLO-20', 'Cerrar la alerta exige la resolución.', 3, 1000);
            $pend = collect(json_decode($a->order_reviews ?: '[]', true))->where('status', 'PENDING')->count();
            if ($a->alert_type === 'TEMPERATURE' && $pend) {
                RuleError::fail('RN-FLO-14', "Quedan {$pend} pedido(s) por revisar: libéralos o recházalos antes de cerrar.");
            }
            DB::table('fleet_alerts')->where('id', $id)->update(['status' => 'CLOSED', 'closed_by' => $u->id, 'closed_at' => now(), 'resolution' => $r, 'updated_at' => now()]);

            return DB::table('fleet_alerts')->where('id', $id)->first();
        });
    }

    /** RN-FLO-14: calidad o el coordinador liberan o rechazan cada pedido de la ruta afectada. */
    public static function revisarPedido(string $alertaId, string $pedidoId, string $decision, ?string $nota, User $u): object
    {
        if (! Access::can($u, 'flo.live.view') && ! Access::module($u, 'FLO', 'A') && ! in_array('CALIDAD', $u->roles()->pluck('code')->all(), true)) {
            abort(403, 'Revisar pedidos por temperatura corresponde a calidad o al coordinador.');
        }

        return DB::transaction(function () use ($alertaId, $pedidoId, $decision, $nota, $u) {
            $a = self::visible($alertaId, $u, true);
            if (! in_array($decision, ['RELEASED', 'REJECTED'], true)) {
                RuleError::fail('RN-FLO-14', 'Elige liberar o rechazar.');
            }
            $n = trim((string) $nota);
            if ($decision === 'REJECTED' && mb_strlen($n) < 5) {
                RuleError::fail('RN-FLO-14', 'Rechazar un pedido exige el motivo (reclamo o reposición).');
            }
            $lista = json_decode($a->order_reviews ?: '[]', true);
            $hay = false;
            foreach ($lista as &$x) {
                if ($x['order_id'] === $pedidoId) {
                    if ($x['status'] !== 'PENDING') {
                        RuleError::fail('RN-FLO-14', "El pedido {$x['number']} ya fue revisado.");
                    }
                    $x = array_merge($x, ['status' => $decision, 'decided_by' => $u->name, 'decided_at' => now()->toIso8601String(), 'note' => $n ?: null]);
                    $hay = true;
                }
            }
            unset($x);
            if (! $hay) {
                RuleError::fail('RN-FLO-14', 'Ese pedido no está en la revisión de esta alerta.');
            }
            DB::table('fleet_alerts')->where('id', $a->id)->update(['order_reviews' => json_encode($lista, JSON_UNESCAPED_UNICODE), 'updated_at' => now()]);

            return DB::table('fleet_alerts')->where('id', $a->id)->first();
        });
    }

    /** La bandeja de alertas es del coordinador, de quienes gestionan la flota y de calidad (pedidos en revisión), no del repartidor. */
    public static function puedeVer(User $u): bool
    {
        foreach (['flo.live.view', 'flo.maintenance.manage', 'flo.document.manage', 'flo.fuel.manage'] as $p) {
            if (Access::can($u, $p)) {
                return true;
            }
        }

        return Access::module($u, 'FLO', 'A') || in_array('CALIDAD', $u->roles()->pluck('code')->all(), true);
    }

    public static function visible(string $id, User $u, bool $bloquear = false): object
    {
        if (! self::puedeVer($u)) {
            abort(403, 'Las alertas de flota las ve el coordinador, quien gestiona la flota o calidad.');
        }
        $q = DB::table('fleet_alerts')->where('id', $id);
        $a = $bloquear ? $q->lockForUpdate()->first() : $q->first();
        if (! $a) {
            abort(404, 'No se encontró la alerta.');
        }
        if ($a->vehicle_id) {
            Base::vehiculo($a->vehicle_id, $u, 'RN-FLO-20');
        }

        return $a;
    }

    /**
     * Barrido de lo que vence con el tiempo (lo corren FLO-01 y FLO-14 al abrir y el botón «Revisar ahora»):
     * documentos (RN-FLO-13), mantenimiento (RN-FLO-09) y GPS silencioso (RN-FLO-18). Devuelve cuántas quedaron abiertas.
     */
    public static function barrido(?User $u = null): int
    {
        return DB::transaction(function () use ($u) {
            $hoy = Base::hoy();
            $dias = Base::diasAviso();
            $tope = $dias[0] ?? 30;
            $vehiculos = Base::flota()->where('v.status', '<>', 'INACTIVE')->get(['v.*'])->keyBy('id');

            // Documentos de vehículos activos y licencias de conductores activos.
            $docs = DB::table('vehicle_documents as d')->leftJoin('employees as e', 'e.id', '=', 'd.employee_id')->where('d.status', 'ACTIVE')->whereNotNull('d.expires_on')
                ->where('d.expires_on', '<=', CarbonImmutable::parse($hoy)->addDays($tope)->toDateString())
                ->where(fn ($w) => $w->whereIn('d.vehicle_id', $vehiculos->keys()->all() ?: ['00000000-0000-0000-0000-000000000000'])
                    ->orWhere(fn ($x) => $x->whereNotNull('d.employee_id')->where('e.status', 'ACTIVE')))
                ->get(['d.*', 'e.full_name']);
            foreach ($docs as $d) {
                $st = Documentos::estado($d->expires_on, $hoy);
                $nombre = Base::DOCUMENTOS[$d->doc_type][0] ?? $d->doc_type;
                $de = $d->vehicle_id ? ($vehiculos[$d->vehicle_id]->plate ?? '') : $d->full_name;
                $diasF = (int) CarbonImmutable::parse($hoy)->diffInDays(CarbonImmutable::parse($d->expires_on), false);
                $bloquea = in_array($d->doc_type, ['SOAT', 'TECH_INSPECTION', 'DRIVER_LICENSE'], true);
                self::levantar([
                    'type' => 'DOCUMENT', 'estado' => true, 'vehicle_id' => $d->vehicle_id, 'employee_id' => $d->employee_id, 'origin' => 'doc:'.$d->id,
                    'severity' => $st === 'EXPIRED' || ($st === 'D7' && $bloquea) ? 'bad' : 'warn',
                    'title' => $st === 'EXPIRED' ? "{$nombre} vencido · {$de}" : "{$nombre} vence en {$diasF} día".($diasF === 1 ? '' : 's')." · {$de}",
                    'detail' => "RN-FLO-13: {$nombre} {$d->number} ".($st === 'EXPIRED' ? 'venció' : 'vence').' el '.Base::fecha($d->expires_on).'.'
                        .($st === 'EXPIRED' && $bloquea ? ($d->doc_type === 'DRIVER_LICENSE' ? ' El conductor no inicia jornada (RN-FLO-12).' : ' El vehículo no sale (RN-FLO-11).') : ' Renuévalo en Documentos.'),
                    'silencio' => true,
                ]);
            }

            // Mantenimiento por km o por fecha.
            foreach (DB::table('vehicle_maintenance_plans')->where('status', 'ACTIVE')->whereIn('vehicle_id', $vehiculos->keys()->all() ?: ['00000000-0000-0000-0000-000000000000'])->get() as $p) {
                $v = $vehiculos[$p->vehicle_id];
                $e = Mantenimiento::estado($p, Odometro::actual($v), $hoy);
                if ($e['estado'] === 'OK') {
                    Alertas::cerrarPor('MAINTENANCE', ['plan:'.$p->id], 'Al día', $u);

                    continue;
                }
                $partes = [];
                if ($e['km_restante'] !== null) {
                    $partes[] = $e['km_restante'] < 0 ? 'pasado por '.Base::km(-$e['km_restante']).' km' : 'faltan '.Base::km($e['km_restante']).' km';
                }
                if ($e['dias_restantes'] !== null) {
                    $partes[] = $e['dias_restantes'] < 0 ? 'vencido hace '.(-$e['dias_restantes']).' días' : 'faltan '.$e['dias_restantes'].' días';
                }
                self::levantar([
                    'type' => 'MAINTENANCE', 'estado' => true, 'vehicle_id' => $v->id, 'origin' => 'plan:'.$p->id,
                    'severity' => in_array($e['estado'], ['OVERDUE', 'OVERDUE_BLOCK'], true) ? 'bad' : 'warn',
                    'title' => "«{$p->task}» ".($e['estado'] === 'DUE_SOON' ? 'próximo' : 'vencido')." · {$v->plate}",
                    'detail' => 'RN-FLO-09: '.implode(' y ', $partes).'.'.($e['estado'] === 'OVERDUE_BLOCK' ? ' Vencido por más de '.Base::km(Base::num('flo_maint_overdue_block_km', 1000)).' km: el vehículo no sale (RN-FLO-11).' : ''),
                    'silencio' => true,
                ]);
            }

            // GPS silencioso: jornada abierta sin posición por más de flo_gps_silent_minutes.
            $lim = Base::num('flo_gps_silent_minutes', 10);
            foreach (DB::table('vehicle_trips')->where('status', 'OPEN')->get() as $t) {
                $ultima = DB::table('vehicle_positions')->where('trip_id', $t->id)->max('recorded_at') ?? $t->started_at;
                $min = (int) floor(CarbonImmutable::parse($ultima)->diffInMinutes(Base::ahora(), false));
                if ($min > $lim) {
                    $v = DB::table('vehicles')->where('id', $t->vehicle_id)->first();
                    self::levantar([
                        'type' => 'GPS_SILENT', 'estado' => true, 'vehicle_id' => $t->vehicle_id, 'employee_id' => $t->driver_employee_id, 'origin' => 'trip:'.$t->id, 'severity' => 'warn',
                        'title' => "Sin posición hace {$min} min · {$v->plate} ({$t->number})",
                        'detail' => "RN-FLO-18: la última posición llegó a las ".Base::hora($ultima)." y el límite es {$lim} min. Llama al conductor o revisa la app.",
                        'silencio' => true,
                    ]);
                }
            }

            return DB::table('fleet_alerts')->where('status', '<>', 'CLOSED')->count();
        });
    }

    /** FLO-14: la bandeja con filtros. */
    public static function lista(User $u, array $f): array
    {
        if (! self::puedeVer($u)) {
            abort(403, 'Las alertas de flota las ve el coordinador, quien gestiona la flota o calidad.');
        }
        $vehiculos = Base::flota($u)->pluck('v.id')->all();
        $q = DB::table('fleet_alerts as a')->leftJoin('vehicles as v', 'v.id', '=', 'a.vehicle_id')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'a.vehicle_id')
            ->leftJoin('employees as e', 'e.id', '=', 'a.employee_id')->leftJoin('users as ua', 'ua.id', '=', 'a.ack_by')->leftJoin('users as uc', 'uc.id', '=', 'a.closed_by')
            ->where(fn ($w) => $w->whereIn('a.vehicle_id', $vehiculos ?: ['00000000-0000-0000-0000-000000000000'])->orWhereNull('a.vehicle_id'))
            ->when(($f['estado'] ?? 'ABIERTAS') === 'ABIERTAS', fn ($w) => $w->where('a.status', '<>', 'CLOSED'))
            ->when(in_array($f['estado'] ?? '', ['OPEN', 'ACK', 'CLOSED'], true), fn ($w) => $w->where('a.status', $f['estado']))
            ->when($f['tipo'] ?? null, fn ($w) => $w->where('a.alert_type', $f['tipo']))
            ->when($f['vehiculo'] ?? null, fn ($w) => $w->where('a.vehicle_id', $f['vehiculo']))
            ->orderByRaw("CASE a.status WHEN 'OPEN' THEN 0 WHEN 'ACK' THEN 1 ELSE 2 END")->orderByRaw("CASE a.severity WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END")
            ->orderByDesc('a.last_at')->limit(300)
            ->get(['a.*', 'v.plate', 'p.internal_code', 'e.full_name as conductor', 'ua.name as atendio', 'uc.name as cerro']);
        $filas = $q->map(fn ($a) => self::aFila($a))->all();
        $todas = DB::table('fleet_alerts')->where('status', '<>', 'CLOSED')
            ->where(fn ($w) => $w->whereIn('vehicle_id', $vehiculos ?: ['00000000-0000-0000-0000-000000000000'])->orWhereNull('vehicle_id'))
            ->selectRaw('alert_type, count(*) AS n, sum(CASE WHEN severity = \'bad\' THEN 1 ELSE 0 END) AS graves')->groupBy('alert_type')->get();

        return ['data' => $filas, 'por_tipo' => $todas->mapWithKeys(fn ($x) => [$x->alert_type => ['n' => (int) $x->n, 'graves' => (int) $x->graves]])->all()];
    }

    public static function aFila(object $a): array
    {
        $rev = json_decode($a->order_reviews ?? '[]', true) ?: [];
        if (! property_exists($a, 'plate')) {
            // Fila sin los nombres (respuesta de atender, cerrar o revisar): se completan aquí.
            $v = $a->vehicle_id ? DB::table('vehicles as v')->leftJoin('vehicle_profiles as p', 'p.vehicle_id', '=', 'v.id')->where('v.id', $a->vehicle_id)->first(['v.plate', 'p.internal_code']) : null;
            $a = (object) array_replace((array) $a, [
                'plate' => $v?->plate, 'internal_code' => $v?->internal_code,
                'conductor' => $a->employee_id ? DB::table('employees')->where('id', $a->employee_id)->value('full_name') : null,
                'atendio' => $a->ack_by ? DB::table('users')->where('id', $a->ack_by)->value('name') : null,
                'cerro' => $a->closed_by ? DB::table('users')->where('id', $a->closed_by)->value('name') : null,
            ]);
        }

        return [
            'id' => $a->id, 'number' => $a->number, 'alert_type' => $a->alert_type, 'tipo' => Base::ALERTAS[$a->alert_type] ?? $a->alert_type,
            'vehicle_id' => $a->vehicle_id, 'employee_id' => $a->employee_id, 'origin' => $a->origin, 'title' => $a->title, 'detail' => $a->detail,
            'severity' => $a->severity, 'first_at' => $a->first_at, 'last_at' => $a->last_at, 'occurrences' => (int) $a->occurrences, 'status' => $a->status,
            'ack_note' => $a->ack_note, 'ack_at' => $a->ack_at, 'resolution' => $a->resolution, 'closed_at' => $a->closed_at,
            'vehiculo' => ! empty($a->plate) ? (($a->internal_code ?? null) && $a->internal_code !== $a->plate ? "{$a->internal_code} · {$a->plate}" : $a->plate) : null,
            'conductor' => $a->conductor ?? null, 'atendio' => $a->atendio ?? null, 'cerro' => $a->cerro ?? null,
            'order_reviews' => $rev, 'pendientes' => count(array_filter($rev, fn ($x) => $x['status'] === 'PENDING')),
            'excursion_start' => $a->excursion_start, 'excursion_minutes' => $a->excursion_minutes !== null ? (float) $a->excursion_minutes : null,
            'episode_start' => $a->episode_start, 'max_value' => $a->max_value !== null ? (float) $a->max_value : null,
        ];
    }
}
