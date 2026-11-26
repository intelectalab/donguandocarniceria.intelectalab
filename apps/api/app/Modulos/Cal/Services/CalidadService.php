<?php

namespace App\Modulos\Cal\Services;

use App\Models\User;
use App\Modulos\Alm\Services\InventarioService;
use App\Modulos\Alm\Services\LotesService;
use App\Modulos\Cat\Services\RegistroSanitario;
use App\Modulos\Pro\Services\Comun;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * CAL · Calidad e inocuidad. Dueño de qc_checklists, qc_checklist_items, qc_schedules, qc_schedule_tasks, qc_inspections,
 * qc_inspection_answers, temperature_points, temperature_readings, temperature_excursions, lot_quality_decisions,
 * nonconformities, corrective_actions y quality_claims. Con CAL activo amplía sanitary_registrations (CAT-10).
 * Cambia el estado de un lote solo con LotesService::cambiarEstado(..., ['decision_calidad' => true]).
 *
 *  RN-CAL-01  un lote de producción o despiece cambia de estado solo con una decisión de calidad (también en la base).
 *  RN-CAL-02  quien registró el lote o supervisó su orden no lo libera.
 *  RN-CAL-03  liberar exige una inspección PASS de proceso o empaque del lote y ninguna no conformidad abierta sobre él;
 *             con un punto crítico fuera de rango en su orden (RN-PRO-11), además una no conformidad cerrada.
 *  RN-CAL-04  lectura fuera de rango: abre o actualiza la excursión del punto y avisa; una lectura en rango marca su fin.
 *  RN-CAL-05  una excursión se cierra con la acción tomada (también en la base).
 *  RN-CAL-06  una no conformidad se cierra con causa raíz, una acción correctiva y todas las acciones terminadas o canceladas.
 *  RN-CAL-07  una no conformidad CRITICAL sobre un lote lo bloquea.
 *  RN-CAL-08  ítem crítico no conforme = FAIL; si no, PASS con puntaje ≥ cal_min_checklist_score_pct.
 *  RN-CAL-09  segundo aviso de vencimiento sanitario a CALIDAD; vencido pasa a EXPIRED (cal:diario).
 *  RN-CAL-10  producto DIGESA sin registro vigente no se libera.
 *  RN-CAL-11  reclamo SPOILED, FOREIGN_BODY o TEMPERATURE con lote crea una no conformidad MAJOR.
 *  RN-CAL-12  reclamo resuelto con tipo de resolución; nota de crédito con su comprobante (también en la base).
 *  RN-CAL-13  tareas del día desde la programación; la pendiente al cierre cuenta como incumplida (cal:diario).
 *  RN-CAL-14  punto sin lectura en su frecuencia + cal_reading_grace_min avisa (cal:diario y CAL-05).
 *  RN-CAL-15  lectura de vehículo fuera de rango: la carga necesita la aprobación de calidad (aprobarLectura).
 *  RN-CAL-16  lecturas y decisiones solo de inserción (en la base).
 *  RN-CAL-17  rechazar exige motivo y destino (también en la base).
 */
final class CalidadService
{
    public const ETAPAS = ['RECEPTION', 'PROCESS', 'PRODUCTION', 'PACKING', 'STORAGE', 'DISPATCH', 'CLEANING', 'BPM'];

    public const TIPOS_RESPUESTA = ['YES_NO', 'NUMBER', 'TEXT', 'PHOTO'];

    public const FRECUENCIAS = ['PER_SHIFT', 'DAILY', 'WEEKLY', 'MONTHLY'];

    public const TIPOS_PUNTO = ['COLD_ROOM', 'FREEZER', 'POT', 'VEHICLE', 'DISPLAY', 'PRODUCT'];

    public const DECISIONES = ['RELEASE' => 'RELEASED', 'RELEASE_WITH_NOTE' => 'RELEASED', 'HOLD' => 'BLOCKED', 'REJECT' => 'REJECTED'];

    public const ORIGENES_NC = ['RECEPTION', 'PROCESS', 'PACKING', 'TEMPERATURE', 'SUPPLIER', 'CUSTOMER_CLAIM', 'AUDIT', 'EQUIPMENT', 'CCP', 'OTHER'];

    public const TIPOS_RECLAMO = ['SPOILED', 'FOREIGN_BODY', 'TEMPERATURE', 'WRONG_WEIGHT', 'PACKAGING', 'TASTE', 'LABEL', 'OTHER'];

    public const RESOLUCIONES = ['NONE', 'REPLACEMENT', 'CREDIT_NOTE', 'REFUND', 'RETURN'];

    private const MAPA = [
        'qc_checklists_codigo' => ['RN-CAL-08', 'Ya existe esa versión del checklist.'],
        'temperature_excursions_accion' => ['RN-CAL-05', 'Una excursión solo se cierra con la acción tomada.'],
        'temperature_excursions_una_abierta' => ['RN-CAL-04', 'Ese punto ya tiene una excursión abierta.'],
        'lot_quality_decisions_rechazo' => ['RN-CAL-17', 'Rechazar un lote exige motivo y destino (merma o reproceso).'],
        'lot_quality_decisions_nota' => ['RN-CAL-03', 'Liberar con observación exige escribir la observación.'],
        'nonconformities_cierre' => ['RN-CAL-06', 'Una no conformidad solo se cierra con su causa raíz.'],
        'quality_claims_resuelto' => ['RN-CAL-12', 'Un reclamo resuelto necesita el tipo de resolución.'],
        'quality_claims_nota_credito' => ['RN-CAL-12', 'Una resolución con nota de crédito necesita el comprobante.'],
        'temperature_points_rango' => ['RN-CAL-04', 'El rango del punto no es válido.'],
        'temperature_points_codigo' => ['RN-CAL-04', 'Ya existe un punto con ese código.'],
        'sanitary_registrations_vigencia' => ['RN-CAL-09', 'El vencimiento debe ser posterior a la emisión.'],
    ];

    public static function activo(): bool
    {
        return DB::table('tenant_modules')->where('module_code', 'CAL')->where('enabled', true)->exists();
    }

    private static function exigir(User $u, string $permiso, string $regla, string $texto): void
    {
        Access::can($u, $permiso) || RuleError::fail($regla, $texto);
    }

    /* ================================================================ CAL-01 checklists */

    /** Crea o edita un checklist en borrador. $d: code, name, stage, items: [{question, answer_type, min_value, max_value, is_critical, requires_photo}]. */
    public static function guardarChecklist(array $d, ?string $id, User $quien): object
    {
        self::exigir($quien, 'cal.checklist.manage', 'RN-CAL-08', 'Editar checklists lo hace Calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('qc_checklists')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-08', 'Checklist no encontrado.')) : null;
            ($antes && $antes->status !== 'DRAFT') && RuleError::fail('RN-CAL-08', "El checklist {$antes->code} v{$antes->version} ya no está en borrador: crea una versión nueva.");
            $codigo = strtoupper((string) Comun::texto($d['code'] ?? $antes?->code, 40));
            $nombre = Comun::texto($d['name'] ?? $antes?->name, 120);
            ($codigo !== '' && $nombre) || RuleError::fail('RN-CAL-08', 'El checklist necesita código y nombre.');
            $etapa = $d['stage'] ?? $antes?->stage;
            in_array($etapa, self::ETAPAS, true) || RuleError::fail('RN-CAL-08', 'Elige la etapa del checklist.');
            $fila = ['code' => $codigo, 'name' => $nombre, 'stage' => $etapa, 'updated_at' => now()];
            if ($antes) {
                DB::table('qc_checklists')->where('id', $id)->update($fila);
            } else {
                DB::table('qc_checklists')->where('code', $codigo)->exists() && RuleError::fail('RN-CAL-08', "Ya existe el checklist {$codigo}: crea una versión nueva desde él.");
                $id = DB::table('qc_checklists')->insertGetId($fila + ['version' => 1, 'status' => 'DRAFT', 'created_by' => mb_substr($quien->name, 0, 40), 'source' => 'APP'], 'id');
            }
            if (array_key_exists('items', $d)) {
                DB::table('qc_checklist_items')->where('checklist_id', $id)->delete();
                foreach (array_values($d['items'] ?? []) as $i => $it) {
                    $tipo = in_array($it['answer_type'] ?? null, self::TIPOS_RESPUESTA, true) ? $it['answer_type'] : 'YES_NO';
                    $min = $tipo === 'NUMBER' ? Comun::num($it['min_value'] ?? null) : null;
                    $max = $tipo === 'NUMBER' ? Comun::num($it['max_value'] ?? null) : null;
                    ($min !== null && $max !== null && $min > $max) && RuleError::fail('RN-CAL-08', 'El rango de «'.($it['question'] ?? '').'» no es válido.');
                    DB::table('qc_checklist_items')->insert(['checklist_id' => $id, 'seq' => $i + 1,
                        'question' => Comun::texto($it['question'] ?? null, 255) ?? RuleError::fail('RN-CAL-08', 'Cada ítem necesita su pregunta.'),
                        'answer_type' => $tipo, 'min_value' => $min, 'max_value' => $max, 'is_critical' => (bool) ($it['is_critical'] ?? false),
                        'requires_photo' => $tipo === 'PHOTO' || (bool) ($it['requires_photo'] ?? false)]);
                }
            }

            return self::checklist($id);
        }), self::MAPA);
    }

    public static function activarChecklist(string $id, User $quien): object
    {
        self::exigir($quien, 'cal.checklist.manage', 'RN-CAL-08', 'Activar checklists lo hace Calidad.');

        return DB::transaction(function () use ($id) {
            $c = DB::table('qc_checklists')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-08', 'Checklist no encontrado.');
            $c->status === 'DRAFT' || RuleError::fail('RN-CAL-08', 'Solo se activa un borrador.');
            DB::table('qc_checklist_items')->where('checklist_id', $id)->exists() || RuleError::fail('RN-CAL-08', 'El checklist necesita al menos una pregunta.');
            $anterior = DB::table('qc_checklists')->where('code', $c->code)->where('status', 'ACTIVE')->first();
            if ($anterior) {
                DB::table('qc_checklists')->where('id', $anterior->id)->update(['status' => 'RETIRED', 'updated_at' => now()]);
                // La programación pasa a la versión nueva.
                DB::table('qc_schedules')->where('checklist_id', $anterior->id)->update(['checklist_id' => $id, 'updated_at' => now()]);
            }
            DB::table('qc_checklists')->where('id', $id)->update(['status' => 'ACTIVE', 'activated_at' => Comun::hoy(), 'updated_at' => now()]);

            return self::checklist($id);
        });
    }

    public static function versionChecklist(string $id, User $quien): object
    {
        self::exigir($quien, 'cal.checklist.manage', 'RN-CAL-08', 'Editar checklists lo hace Calidad.');

        return DB::transaction(function () use ($id, $quien) {
            $c = DB::table('qc_checklists')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-08', 'Checklist no encontrado.');
            DB::table('qc_checklists')->where('code', $c->code)->where('status', 'DRAFT')->exists() && RuleError::fail('RN-CAL-08', "El checklist {$c->code} ya tiene un borrador.");
            $v = (int) DB::table('qc_checklists')->where('code', $c->code)->max('version') + 1;
            $nuevo = DB::table('qc_checklists')->insertGetId(['code' => $c->code, 'name' => $c->name, 'stage' => $c->stage, 'version' => $v, 'status' => 'DRAFT',
                'created_by' => mb_substr($quien->name, 0, 40), 'source' => 'APP'], 'id');
            foreach (DB::table('qc_checklist_items')->where('checklist_id', $id)->orderBy('seq')->get() as $it) {
                DB::table('qc_checklist_items')->insert(['checklist_id' => $nuevo, 'seq' => $it->seq, 'question' => $it->question, 'answer_type' => $it->answer_type,
                    'min_value' => $it->min_value, 'max_value' => $it->max_value, 'is_critical' => $it->is_critical, 'requires_photo' => $it->requires_photo]);
            }

            return self::checklist($nuevo);
        });
    }

    public static function checklist(string $id): object
    {
        $c = DB::table('qc_checklists')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-08', 'Checklist no encontrado.');
        $c->items = DB::table('qc_checklist_items')->where('checklist_id', $id)->orderBy('seq')->get();
        $c->versions = DB::table('qc_checklists')->where('code', $c->code)->orderByDesc('version')->get(['id', 'version', 'status', 'activated_at']);
        $c->schedules = DB::table('qc_schedules')->where('checklist_id', $id)->count();

        return $c;
    }

    /* ================================================================ CAL-02 programación */

    public static function guardarProgramacion(array $d, ?string $id, User $quien): object
    {
        self::exigir($quien, 'cal.checklist.manage', 'RN-CAL-13', 'La programación la edita Calidad.');

        return DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('qc_schedules')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-13', 'Programación no encontrada.')) : null;
            $chk = DB::table('qc_checklists')->where('id', $d['checklist_id'] ?? $antes?->checklist_id)->first() ?? RuleError::fail('RN-CAL-13', 'Elige el checklist.');
            $chk->status === 'ACTIVE' || RuleError::fail('RN-CAL-13', 'Se programa un checklist activo.');
            $local = $d['establishment_id'] ?? $antes?->establishment_id;
            DB::table('establishments')->where('id', $local)->exists() || RuleError::fail('RN-CAL-13', 'Elige el local.');
            Comun::exigirLocal($quien, $local, 'RN-CAL-13', 'La programación');
            $frec = $d['frequency'] ?? $antes?->frequency;
            in_array($frec, self::FRECUENCIAS, true) || RuleError::fail('RN-CAL-13', 'Elige la frecuencia.');
            $rol = $d['responsible_role'] ?? $antes?->responsible_role;
            DB::table('roles')->where('code', $rol)->exists() || RuleError::fail('RN-CAL-13', 'Elige el rol que lo hace.');
            $fila = ['checklist_id' => $chk->id, 'establishment_id' => $local, 'area' => Comun::texto($d['area'] ?? $antes?->area, 120) ?? RuleError::fail('RN-CAL-13', 'Indica el área.'),
                'frequency' => $frec, 'responsible_role' => $rol, 'weekday' => $frec === 'WEEKLY' ? (int) ($d['weekday'] ?? $antes?->weekday ?? 1) : null,
                'status' => in_array($d['status'] ?? null, ['ACTIVE', 'INACTIVE'], true) ? $d['status'] : ($antes?->status ?? 'ACTIVE'),
                'active_from' => Comun::fecha($d['active_from'] ?? $antes?->active_from), 'updated_at' => now()];
            if ($antes) {
                DB::table('qc_schedules')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('qc_schedules')->insertGetId($fila, 'id');
            }

            return DB::table('qc_schedules')->where('id', $id)->first();
        });
    }

    /**
     * RN-CAL-13: crea las tareas del día de cada programación activa (una por turno M y T si es por turno; una al día
     * si es diaria; el día de la semana si es semanal; el día 1 si es mensual). Una inspección del mismo día y turno ya
     * hecha la marca como hecha. Correrla otra vez no duplica.
     */
    public static function generarTareas(string $fecha): int
    {
        $d = CarbonImmutable::parse($fecha);
        $n = 0;
        foreach (DB::table('qc_schedules')->where('status', 'ACTIVE')->where('active_from', '<=', $fecha)->get() as $s) {
            $turnos = match ($s->frequency) {
                'PER_SHIFT' => ['M', 'T'],
                'DAILY' => ['D'],
                'WEEKLY' => $d->dayOfWeek === (int) ($s->weekday ?? 1) ? ['D'] : [],
                'MONTHLY' => $d->day === 1 ? ['D'] : [],
                default => [],
            };
            foreach ($turnos as $t) {
                if (DB::table('qc_schedule_tasks')->where('schedule_id', $s->id)->where('task_date', $fecha)->where('shift', $t)->exists()) {
                    continue;
                }
                $ins = DB::table('qc_inspections')->where('schedule_id', $s->id)->whereRaw("(inspected_at AT TIME ZONE 'America/Lima')::date = ?", [$fecha])
                    ->when($t !== 'D', fn ($q) => $q->where('shift', $t))->where('status', 'DONE')->orderBy('inspected_at')->first();
                DB::table('qc_schedule_tasks')->insert(['schedule_id' => $s->id, 'task_date' => $fecha, 'shift' => $t, 'status' => $ins ? 'DONE' : 'PENDING',
                    'inspection_id' => $ins?->id, 'done_at' => $ins?->inspected_at, 'done_by' => $ins?->inspector_user_id]);
                $n++;
            }
        }

        return $n;
    }

    /** RN-CAL-13: las tareas pendientes de días anteriores quedan incumplidas. */
    public static function marcarIncumplidas(string $fecha): int
    {
        return DB::table('qc_schedule_tasks')->where('status', 'PENDING')->where('task_date', '<', $fecha)->update(['status' => 'MISSED', 'updated_at' => now()]);
    }

    /** CAL-12: marcar una tarea hecha con su evidencia (para limpieza y BPM sin checklist completo). */
    public static function completarTarea(string $id, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-13', 'No tienes permiso para registrar tareas de calidad.');

        return DB::transaction(function () use ($id, $d, $quien) {
            $t = DB::table('qc_schedule_tasks as t')->join('qc_schedules as s', 's.id', '=', 't.schedule_id')->where('t.id', $id)->lockForUpdate()->first(['t.*', 's.establishment_id'])
                ?? RuleError::fail('RN-CAL-13', 'Tarea no encontrada.');
            Comun::exigirLocal($quien, $t->establishment_id, 'RN-CAL-13', 'La tarea');
            $t->status === 'PENDING' || RuleError::fail('RN-CAL-13', $t->status === 'DONE' ? 'La tarea ya está hecha.' : 'La tarea quedó incumplida: su día ya cerró.');
            $evidencia = Comun::texto($d['evidence_url'] ?? null, 255);
            DB::table('qc_schedule_tasks')->where('id', $id)->update(['status' => 'DONE', 'done_at' => now(), 'done_by' => $quien->id, 'evidence_url' => $evidencia,
                'notes' => Comun::texto($d['notes'] ?? null, 1000), 'inspection_id' => $d['inspection_id'] ?? null, 'updated_at' => now()]);

            return DB::table('qc_schedule_tasks')->where('id', $id)->first();
        });
    }

    /* ================================================================ CAL-03 inspecciones */

    /**
     * Registra una inspección completa. $d: checklist_id, establishment_id, area, schedule_id, lot_id, production_order_id, purchase_receipt_id,
     * sales_order_id, vehicle_id, notes, answers: [{item_id, answer_bool, answer_num, answer_text, photo_url}], finish (true por defecto).
     */
    public static function inspeccionar(array $d, User $quien): object
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-08', 'No tienes permiso para llenar checklists.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $c = DB::table('qc_checklists')->where('id', $d['checklist_id'] ?? null)->first() ?? RuleError::fail('RN-CAL-08', 'Elige el checklist.');
            $c->status === 'ACTIVE' || RuleError::fail('RN-CAL-08', "El checklist {$c->code} v{$c->version} no está activo.");
            $prog = ! empty($d['schedule_id']) ? DB::table('qc_schedules')->where('id', $d['schedule_id'])->first() : null;
            $lote = ! empty($d['lot_id']) ? (DB::table('lots')->where('id', $d['lot_id'])->first() ?? RuleError::fail('RN-CAL-08', 'Lote no encontrado.')) : null;
            $orden = ! empty($d['production_order_id']) ? DB::table('production_orders')->where('id', $d['production_order_id'])->first() : null;
            if (! $orden && $lote?->production_order_ref) {
                $orden = DB::table('production_orders')->where('number', $lote->production_order_ref)->first();
            }
            $local = $d['establishment_id'] ?? $prog?->establishment_id ?? $orden?->establishment_id ?? null;
            DB::table('establishments')->where('id', $local)->exists() || RuleError::fail('RN-CAL-08', 'Elige el local de la inspección.');
            Comun::exigirLocal($quien, $local, 'RN-CAL-08', 'La inspección');
            $items = DB::table('qc_checklist_items')->where('checklist_id', $c->id)->orderBy('seq')->get()->keyBy('id');
            $resp = collect($d['answers'] ?? [])->keyBy('item_id');
            $terminar = (bool) ($d['finish'] ?? true);
            $filas = [];
            $conformes = 0;
            $respondidas = 0;
            $criticos = [];
            foreach ($items as $it) {
                $r = $resp[$it->id] ?? null;
                $f = ['item_id' => $it->id, 'answer_bool' => null, 'answer_num' => null, 'answer_text' => null, 'photo_url' => Comun::texto($r['photo_url'] ?? null, 255), 'is_conforming' => null];
                if ($r !== null) {
                    switch ($it->answer_type) {
                        case 'YES_NO':
                            if (array_key_exists('answer_bool', $r) && $r['answer_bool'] !== null) {
                                $f['answer_bool'] = filter_var($r['answer_bool'], FILTER_VALIDATE_BOOLEAN);
                                $f['is_conforming'] = $f['answer_bool'];
                            }
                            break;
                        case 'NUMBER':
                            $v = Comun::num($r['answer_num'] ?? null);
                            if ($v !== null) {
                                $f['answer_num'] = $v;
                                $f['is_conforming'] = ($it->min_value === null || $v >= (float) $it->min_value) && ($it->max_value === null || $v <= (float) $it->max_value);
                            }
                            break;
                        case 'PHOTO':
                            $f['is_conforming'] = $f['photo_url'] ? true : null;
                            $f['answer_text'] = Comun::texto($r['answer_text'] ?? null, 1000);
                            break;
                        default:
                            $f['answer_text'] = Comun::texto($r['answer_text'] ?? null, 1000);
                            $f['is_conforming'] = $f['answer_text'] !== null ? (array_key_exists('is_conforming', $r) ? (bool) $r['is_conforming'] : true) : null;
                    }
                    if (array_key_exists('is_conforming', $r) && $r['is_conforming'] !== null && $it->answer_type !== 'NUMBER') {
                        $f['is_conforming'] = (bool) $r['is_conforming'];
                    }
                }
                if ($it->requires_photo && $f['is_conforming'] !== null && ! $f['photo_url'] && $terminar) {
                    RuleError::fail('RN-CAL-08', "«{$it->question}» necesita su foto.");
                }
                if ($terminar && $f['is_conforming'] === null) {
                    RuleError::fail('RN-CAL-08', "Falta responder «{$it->question}».");
                }
                if ($f['is_conforming'] !== null) {
                    $respondidas++;
                    $f['is_conforming'] && $conformes++;
                    if (! $f['is_conforming'] && $it->is_critical) {
                        $criticos[] = ['item_id' => $it->id, 'question' => $it->question];
                    }
                }
                $filas[] = $f;
            }
            $puntaje = $respondidas ? round($conformes / $respondidas * 100, 2) : 0;
            $minimo = (float) (Params::get('cal_min_checklist_score_pct') ?? 90);
            // RN-CAL-08
            $resultado = ! $terminar ? 'PENDING' : ($criticos ? 'FAIL' : ($puntaje + 0.00001 >= $minimo ? 'PASS' : 'FAIL'));
            $ahora = Comun::ahora();
            $turno = $d['shift'] ?? ($ahora->hour < 14 ? 'M' : ($ahora->hour < 22 ? 'T' : 'N'));
            $id = DB::table('qc_inspections')->insertGetId([
                'number' => Comun::numero('qc_inspections', 'INS-', 5), 'checklist_id' => $c->id, 'checklist_version' => $c->version, 'stage' => $c->stage,
                'establishment_id' => $local, 'schedule_id' => $prog?->id, 'shift' => in_array($turno, ['M', 'T', 'N'], true) ? $turno : 'M',
                'lot_id' => $lote?->id, 'production_order_id' => $orden?->id, 'production_order_ref' => $orden?->number ?? $lote?->production_order_ref,
                'purchase_receipt_id' => $d['purchase_receipt_id'] ?? null, 'sales_order_id' => $d['sales_order_id'] ?? null, 'vehicle_id' => $d['vehicle_id'] ?? null,
                'area' => Comun::texto($d['area'] ?? $prog?->area ?? $c->name, 120), 'inspector_user_id' => $quien->id, 'inspected_at' => $ahora,
                'status' => $terminar ? 'DONE' : 'IN_PROGRESS', 'result' => $resultado, 'score_pct' => $puntaje,
                'critical_failed' => json_encode($criticos, JSON_UNESCAPED_UNICODE), 'notes' => Comun::texto($d['notes'] ?? null, 2000),
            ], 'id');
            foreach ($filas as $f) {
                DB::table('qc_inspection_answers')->insert($f + ['inspection_id' => $id]);
            }
            if ($terminar && $prog) {
                $hoy = $ahora->toDateString();
                DB::table('qc_schedule_tasks')->where('schedule_id', $prog->id)->where('task_date', $hoy)->where('status', 'PENDING')
                    ->whereIn('shift', $prog->frequency === 'PER_SHIFT' ? [$turno] : ['D'])->limit(1)
                    ->update(['status' => 'DONE', 'inspection_id' => $id, 'done_at' => $ahora, 'done_by' => $quien->id, 'updated_at' => now()]);
            }
            if ($resultado === 'FAIL') {
                Comun::avisar('CAL', ['CALIDAD'], "Inspección no conforme: {$c->name}", ($criticos ? 'Ítem crítico no conforme: '.implode('; ', array_column($criticos, 'question')).'. ' : '')
                    .'Puntaje '.Comun::n($puntaje).' %'.($lote ? " · lote {$lote->code}" : '').'.', 'CAL-03', $id, 'bad', null, $local);
            }
            Events::emit('qc_inspection.done', 'qc_inspections', $id, ['result' => $resultado, 'score_pct' => $puntaje, 'lot_id' => $lote?->id]);

            return self::inspeccion($id);
        }), self::MAPA);
    }

    public static function inspeccion(string $id): object
    {
        $i = DB::table('qc_inspections as i')->join('qc_checklists as c', 'c.id', '=', 'i.checklist_id')->leftJoin('users as u', 'u.id', '=', 'i.inspector_user_id')
            ->leftJoin('lots as l', 'l.id', '=', 'i.lot_id')->leftJoin('establishments as s', 's.id', '=', 'i.establishment_id')->where('i.id', $id)
            ->first(['i.*', 'c.code as checklist_code', 'c.name as checklist_name', 'u.name as inspector_name', 'l.code as lot_code', DB::raw('coalesce(s.short, s.name) as establishment_name')])
            ?? RuleError::fail('RN-CAL-08', 'Inspección no encontrada.');
        $i->critical_failed = json_decode($i->critical_failed ?? '[]', true) ?: [];
        $i->answers = DB::table('qc_inspection_answers as a')->join('qc_checklist_items as it', 'it.id', '=', 'a.item_id')->where('a.inspection_id', $id)->orderBy('it.seq')
            ->get(['a.*', 'it.question', 'it.answer_type', 'it.min_value', 'it.max_value', 'it.is_critical', 'it.seq']);

        return $i;
    }

    /* ================================================================ CAL-04 a CAL-06 temperaturas */

    public static function guardarPunto(array $d, ?string $id, User $quien): object
    {
        self::exigir($quien, 'cal.checklist.manage', 'RN-CAL-04', 'Los puntos de temperatura los edita Calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $id, $quien) {
            $antes = $id ? (DB::table('temperature_points')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-04', 'Punto no encontrado.')) : null;
            $local = $d['establishment_id'] ?? $antes?->establishment_id;
            DB::table('establishments')->where('id', $local)->exists() || RuleError::fail('RN-CAL-04', 'Elige el local.');
            Comun::exigirLocal($quien, $local, 'RN-CAL-04', 'El punto');
            $tipo = $d['point_type'] ?? $antes?->point_type;
            in_array($tipo, self::TIPOS_PUNTO, true) || RuleError::fail('RN-CAL-04', 'Elige el tipo de punto.');
            $min = Comun::num($d['min_c'] ?? $antes?->min_c, 2);
            $max = Comun::num($d['max_c'] ?? $antes?->max_c, 2);
            ($min !== null && $max !== null && $min <= $max) || RuleError::fail('RN-CAL-04', 'Indica el rango de temperatura (mínimo ≤ máximo).');
            $frec = Comun::num($d['reading_frequency_min'] ?? $antes?->reading_frequency_min, 0);
            ($frec !== null && $frec > 0) || RuleError::fail('RN-CAL-04', 'Indica cada cuántos minutos se lee.');
            $fila = ['code' => strtoupper((string) Comun::texto($d['code'] ?? $antes?->code, 40)), 'name' => Comun::texto($d['name'] ?? $antes?->name, 120),
                'point_type' => $tipo, 'establishment_id' => $local, 'equipment_id' => $d['equipment_id'] ?? $antes?->equipment_id, 'warehouse_id' => $d['warehouse_id'] ?? $antes?->warehouse_id,
                'vehicle_id' => $d['vehicle_id'] ?? $antes?->vehicle_id, 'min_c' => $min, 'max_c' => $max, 'reading_frequency_min' => $frec,
                'status' => in_array($d['status'] ?? null, ['ACTIVE', 'INACTIVE'], true) ? $d['status'] : ($antes?->status ?? 'ACTIVE'),
                'sensor' => (bool) ($d['sensor'] ?? $antes?->sensor ?? false), 'updated_at' => now()];
            ($fila['code'] !== '' && $fila['name']) || RuleError::fail('RN-CAL-04', 'El punto necesita código y nombre.');
            if ($antes) {
                DB::table('temperature_points')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('temperature_points')->insertGetId($fila, 'id');
            }

            return DB::table('temperature_points')->where('id', $id)->first();
        }), self::MAPA);
    }

    /**
     * CAL-05 Lectura (RN-CAL-04, RN-CAL-15, RN-CAL-16). $d: point_id, value_c, source (MANUAL|SENSOR), context, photo_url, read_at.
     *
     * @return array{reading: object, excursion: ?object, opened: bool, ended: bool}
     */
    public static function leer(array $d, User $quien): array
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-04', 'No tienes permiso para registrar temperaturas.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $p = DB::table('temperature_points')->where('id', $d['point_id'] ?? null)->first() ?? RuleError::fail('RN-CAL-04', 'Elige el punto.');
            $p->status === 'ACTIVE' || RuleError::fail('RN-CAL-04', "{$p->name} está inactivo.");
            Comun::exigirLocal($quien, $p->establishment_id, 'RN-CAL-04', 'El punto');
            $v = Comun::num($d['value_c'] ?? null, 2);
            $v !== null || RuleError::fail('RN-CAL-04', 'Indica la temperatura leída.');
            ($v < -60 || $v > 150) && RuleError::fail('RN-CAL-04', 'La temperatura no es válida.');
            $cuando = ! empty($d['read_at']) ? CarbonImmutable::parse($d['read_at']) : now();
            $enRango = $v >= (float) $p->min_c && $v <= (float) $p->max_c;
            $rid = DB::table('temperature_readings')->insertGetId([
                'point_id' => $p->id, 'establishment_id' => $p->establishment_id, 'read_at' => $cuando, 'value_c' => $v,
                'source' => ($d['source'] ?? 'MANUAL') === 'SENSOR' ? 'SENSOR' : 'MANUAL', 'context' => Comun::texto($d['context'] ?? null, 255) ?? ($p->point_type === 'VEHICLE' ? 'Carga' : 'Ronda'),
                'read_by' => $quien->id, 'photo_url' => Comun::texto($d['photo_url'] ?? null, 255), 'in_range' => $enRango,
            ], 'id');
            $exc = DB::table('temperature_excursions')->where('point_id', $p->id)->where('status', 'OPEN')->lockForUpdate()->first();
            $abierta = false;
            $fin = false;
            if (! $enRango) {
                $desv = $v > (float) $p->max_c ? $v - (float) $p->max_c : (float) $p->min_c - $v;
                $lotes = self::lotesExpuestos($p);
                if ($exc) {
                    DB::table('temperature_excursions')->where('id', $exc->id)->update([
                        'ended_at' => null, 'readings_count' => $exc->readings_count + 1, 'last_value_c' => $v,
                        'max_deviation_c' => max((float) $exc->max_deviation_c, round($desv, 2)), 'max_value_c' => abs($desv) >= (float) $exc->max_deviation_c ? $v : $exc->max_value_c,
                        'lots_exposed' => json_encode(array_values(array_unique(array_merge(json_decode($exc->lots_exposed ?? '[]', true) ?: [], $lotes))), JSON_UNESCAPED_UNICODE), 'updated_at' => now(),
                    ]);
                    $eid = $exc->id;
                } else {
                    $eid = DB::table('temperature_excursions')->insertGetId([
                        'point_id' => $p->id, 'establishment_id' => $p->establishment_id, 'started_at' => $cuando, 'first_value_c' => $v, 'last_value_c' => $v,
                        'max_deviation_c' => round($desv, 2), 'max_value_c' => $v, 'readings_count' => 1, 'status' => 'OPEN', 'lots_exposed' => json_encode($lotes, JSON_UNESCAPED_UNICODE),
                    ], 'id');
                    $abierta = true;
                    Comun::avisar('CAL', ['CALIDAD', 'JEFE_PRODUCCION', 'ALMACENERO'], "Temperatura fuera de rango: {$p->name}",
                        Comun::n($v, 1).' °C (rango '.Comun::n($p->min_c, 1).' a '.Comun::n($p->max_c, 1).' °C, desviación '.Comun::n($desv, 1).' °C). '.($lotes ? count($lotes).' lote(s) expuesto(s).' : ''),
                        'CAL-06', $eid, 'bad', null, $p->establishment_id);
                }
                DB::table('temperature_readings')->where('id', $rid)->update(['excursion_id' => $eid, 'updated_at' => now()]);
                $exc = DB::table('temperature_excursions')->where('id', $eid)->first();
            } elseif ($exc && ! $exc->ended_at) {
                // RN-CAL-04: la lectura en rango marca el fin; la cierra Calidad con la acción tomada.
                DB::table('temperature_excursions')->where('id', $exc->id)->update(['ended_at' => $cuando, 'updated_at' => now()]);
                DB::table('temperature_readings')->where('id', $rid)->update(['excursion_id' => $exc->id, 'updated_at' => now()]);
                $exc = DB::table('temperature_excursions')->where('id', $exc->id)->first();
                $fin = true;
            }

            return ['reading' => DB::table('temperature_readings')->where('id', $rid)->first(), 'excursion' => $exc, 'opened' => $abierta, 'ended' => $fin,
                'needs_approval' => ! $enRango && $p->point_type === 'VEHICLE'];
        }), self::MAPA);
    }

    /** Lotes con stock en el almacén del punto (para la excursión). */
    private static function lotesExpuestos(object $p): array
    {
        if (! $p->warehouse_id) {
            return [];
        }

        return DB::table('stock_balances as b')->join('lots as l', 'l.id', '=', 'b.lot_id')->where('b.warehouse_id', $p->warehouse_id)->where('b.qty', '>', 0.0005)
            ->orderBy('l.code')->limit(50)->pluck('l.code')->all();
    }

    /** RN-CAL-15: Calidad aprueba la carga de un vehículo con lectura fuera de rango. */
    public static function aprobarLectura(string $id, User $quien): object
    {
        self::exigir($quien, 'cal.lot.release', 'RN-CAL-15', 'La carga fuera de rango la aprueba Calidad.');
        $r = DB::table('temperature_readings')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-15', 'Lectura no encontrada.');
        $r->in_range && RuleError::fail('RN-CAL-15', 'La lectura está en rango: no necesita aprobación.');
        $r->approved_by && RuleError::fail('RN-CAL-15', 'La lectura ya está aprobada.');
        DB::table('temperature_readings')->where('id', $id)->update(['approved_by' => $quien->id, 'approved_at' => now(), 'updated_at' => now()]);

        return DB::table('temperature_readings')->where('id', $id)->first();
    }

    /** RN-CAL-15: lo consulta PRE al verificar la carga del vehículo. */
    public static function cargaPermitida(string $vehicleId, ?string $desde = null): array
    {
        $p = DB::table('temperature_points')->where('vehicle_id', $vehicleId)->where('status', 'ACTIVE')->first();
        if (! $p) {
            return ['ok' => true, 'reason' => null];
        }
        $r = DB::table('temperature_readings')->where('point_id', $p->id)->when($desde, fn ($q) => $q->where('read_at', '>=', $desde))->orderByDesc('read_at')->first();
        if (! $r) {
            return ['ok' => false, 'reason' => "Registra la temperatura de {$p->name} antes de cargar."];
        }

        return $r->in_range || $r->approved_by ? ['ok' => true, 'reason' => null]
            : ['ok' => false, 'reason' => "{$p->name} está a ".Comun::n($r->value_c, 1).' °C, fuera de rango: la carga necesita la aprobación de Calidad.'];
    }

    /** CAL-06 · RN-CAL-05. $d: action_taken, create_nc (bool), severity. */
    public static function cerrarExcursion(string $id, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.nonconformity.close', 'RN-CAL-05', 'Cerrar excursiones lo hace Calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $e = DB::table('temperature_excursions as e')->join('temperature_points as p', 'p.id', '=', 'e.point_id')->where('e.id', $id)->lockForUpdate()
                ->first(['e.*', 'p.name as point_name', 'p.min_c', 'p.max_c']) ?? RuleError::fail('RN-CAL-05', 'Excursión no encontrada.');
            Comun::exigirLocal($quien, $e->establishment_id, 'RN-CAL-05', 'La excursión');
            $e->status === 'OPEN' || RuleError::fail('RN-CAL-05', 'La excursión ya está cerrada.');
            $accion = Comun::texto($d['action_taken'] ?? null, 255);
            $accion || RuleError::fail('RN-CAL-05', 'Escribe la acción tomada para cerrar la excursión.');
            $nc = null;
            if (! empty($d['create_nc'])) {
                $nc = self::crearNC(['source' => 'TEMPERATURE', 'severity' => $d['severity'] ?? 'MAJOR', 'establishment_id' => $e->establishment_id,
                    'description' => "Excursión de temperatura en {$e->point_name}: hasta ".Comun::n($e->max_value_c, 1).' °C (desviación '.Comun::n($e->max_deviation_c, 1).' °C). Acción: '.$accion,
                    'excursion_id' => $e->id], $quien);
            }
            DB::table('temperature_excursions')->where('id', $id)->update(['status' => 'CLOSED', 'action_taken' => $accion, 'closed_by' => $quien->id, 'closed_at' => now(),
                'ended_at' => $e->ended_at ?? now(), 'nonconformity_id' => $nc?->id, 'updated_at' => now()]);

            return DB::table('temperature_excursions')->where('id', $id)->first();
        }), self::MAPA);
    }

    /** RN-CAL-14: puntos activos sin lectura en su frecuencia + gracia, a la hora dada. */
    public static function puntosAtrasados(?CarbonImmutable $ahora = null, array $locales = []): array
    {
        $ahora ??= Comun::ahora();
        $gracia = (float) (Params::get('cal_reading_grace_min') ?? 30);

        return DB::table('temperature_points as p')->where('p.status', 'ACTIVE')->when($locales, fn ($q) => $q->whereIn('p.establishment_id', $locales))
            ->leftJoinSub(DB::table('temperature_readings')->groupBy('point_id')->selectRaw('point_id, max(read_at) as last'), 'r', 'r.point_id', '=', 'p.id')
            ->get(['p.id', 'p.code', 'p.name', 'p.establishment_id', 'p.reading_frequency_min', 'r.last'])
            ->filter(fn ($p) => ! $p->last || CarbonImmutable::parse($p->last)->addMinutes((int) round((float) $p->reading_frequency_min + $gracia))->lessThan($ahora))
            ->values()->all();
    }

    /* ================================================================ CAL-07 decisión sobre el lote */

    /**
     * Lo que falta para liberar el lote (RN-CAL-02, 03, 10 y RN-PRO-11). Lista vacía = se puede liberar.
     *
     * @return list<array{code: string, msg: string}>
     */
    public static function bloqueos(object $lot, User $quien): array
    {
        $out = [];
        if ($lot->created_by_user_id === $quien->id || $lot->supervisor_user_id === $quien->id) {
            $out[] = ['code' => 'RN-CAL-02', 'msg' => "Registraste el lote {$lot->code} o supervisaste su orden: lo libera otra persona de Calidad."];
        }
        $pass = DB::table('qc_inspections')->where('lot_id', $lot->id)->whereIn('stage', ['PROCESS', 'PACKING', 'PRODUCTION'])->where('status', 'DONE')->where('result', 'PASS')->exists();
        $pass || $out[] = ['code' => 'RN-CAL-03', 'msg' => "El lote {$lot->code} no tiene una inspección conforme de proceso o empaque."];
        $abiertas = DB::table('nonconformities')->where('lot_id', $lot->id)->where('status', '<>', 'CLOSED')->pluck('number')->all();
        $abiertas && $out[] = ['code' => 'RN-CAL-03', 'msg' => 'El lote tiene no conformidades abiertas ('.implode(', ', $abiertas).').'];
        $orden = $lot->production_order_ref ? DB::table('production_orders')->where('number', $lot->production_order_ref)->first() : null;
        if ($lot->ccp_deviation || $orden?->critical_deviation) {
            $cerrada = DB::table('nonconformities')->where('status', 'CLOSED')
                ->where(fn ($q) => $q->where('lot_id', $lot->id)->when($orden, fn ($x) => $x->orWhere('production_order_id', $orden->id)))->exists();
            $cerrada || $out[] = ['code' => 'RN-CAL-03', 'msg' => 'Su orden tuvo un punto crítico fuera de rango: se libera con una no conformidad cerrada.'];
        }
        $p = DB::table('products')->where('id', $lot->product_id)->first();
        if ($p && $p->sanitary_authority === 'DIGESA') {
            $e = RegistroSanitario::estado($p, Comun::hoy());
            in_array($e['code'], ['EXPIRED', 'MISSING'], true) && $out[] = ['code' => 'RN-CAL-10', 'msg' => "{$p->name} no tiene registro sanitario DIGESA vigente"
                .($p->sanitary_registry_expires ? ' (venció el '.Comun::dmy($p->sanitary_registry_expires).')' : '').': el lote no se libera. Renueva el registro en Registros sanitarios.'];
        }
        $vida = $lot->expiry_date ? CarbonImmutable::parse($lot->expiry_date)->startOfDay()->diffInDays(Comun::ahora()->startOfDay(), false) : null;
        ($vida !== null && $vida > 0) && $out[] = ['code' => 'RN-ALM-04', 'msg' => "El lote venció el ".Comun::dmy($lot->expiry_date).'.'];

        return $out;
    }

    /**
     * CAL-07: RELEASE, RELEASE_WITH_NOTE, HOLD o REJECT. $d: decision, reason, reject_destination (WASTE|REPROCESS), inspection_id, move_to (almacén al liberar).
     */
    public static function decidir(string $lotId, array $d, User $quien): object
    {
        return Comun::base(fn () => DB::transaction(function () use ($lotId, $d, $quien) {
            $lot = DB::table('lots')->where('id', $lotId)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-01', 'Lote no encontrado.');
            $decision = $d['decision'] ?? null;
            isset(self::DECISIONES[$decision]) || RuleError::fail('RN-CAL-01', 'Elige la decisión: liberar, liberar con observación, retener o rechazar.');
            $nuevo = self::DECISIONES[$decision];
            // RN-CAL-02 primero: quien produjo el lote no lo libera, tenga o no el permiso.
            if ($nuevo === 'RELEASED' && ($lot->created_by_user_id === $quien->id || $lot->supervisor_user_id === $quien->id)) {
                RuleError::fail('RN-CAL-02', "Registraste el lote {$lot->code} o supervisaste su orden: lo libera otra persona de Calidad.");
            }
            self::exigir($quien, 'cal.lot.release', 'RN-CAL-01', 'Liberar, retener o rechazar lotes lo hace Calidad.');
            $motivo = Comun::texto($d['reason'] ?? null, 255);
            // RN-CAL-02 vale para toda decisión de liberación; el resto de los bloqueos, solo al liberar.
            if ($nuevo === 'RELEASED') {
                foreach (self::bloqueos($lot, $quien) as $b) {
                    RuleError::fail($b['code'], $b['msg']);
                }
                ($decision === 'RELEASE_WITH_NOTE' && ! $motivo) && RuleError::fail('RN-CAL-03', 'Liberar con observación exige escribir la observación.');
            }
            if ($decision === 'REJECT') {
                ($motivo && in_array($d['reject_destination'] ?? null, ['WASTE', 'REPROCESS'], true))
                    || RuleError::fail('RN-CAL-17', 'Rechazar un lote exige motivo y destino: merma o reproceso.');
            }
            ($decision === 'HOLD' && ! $motivo) && RuleError::fail('RN-CAL-01', 'Retener un lote exige motivo.');
            $lot->qc_status === $nuevo && RuleError::fail('RN-CAL-01', "El lote {$lot->code} ya está ".InventarioService::estado($nuevo).'.');
            $inspeccion = $d['inspection_id'] ?? DB::table('qc_inspections')->where('lot_id', $lot->id)->where('status', 'DONE')->orderByDesc('inspected_at')->value('id');
            LotesService::cambiarEstado($lot->id, $nuevo, $motivo ?? ($decision === 'RELEASE' ? 'Liberado por Calidad' : null), $quien,
                ['decision_calidad' => true, 'mover_a' => $nuevo === 'RELEASED' ? ($d['move_to'] ?? null) : null]);
            $did = DB::table('lot_quality_decisions')->insertGetId([
                'lot_id' => $lot->id, 'decision' => $decision, 'decided_by' => $quien->id, 'decided_at' => now(), 'inspection_id' => $inspeccion,
                'reason' => $motivo, 'reject_destination' => $decision === 'REJECT' ? $d['reject_destination'] : null, 'previous_status' => $lot->qc_status, 'new_status' => $nuevo,
            ], 'id');
            Events::emit('lot.quality_decided', 'lots', $lot->id, ['code' => $lot->code, 'decision' => $decision, 'from' => $lot->qc_status, 'to' => $nuevo,
                'reject_destination' => $d['reject_destination'] ?? null]);

            return DB::table('lot_quality_decisions')->where('id', $did)->first();
        }), self::MAPA);
    }

    /* ================================================================ CAL-08 y CAL-09 no conformidades */

    /** $d: source, severity, description, establishment_id, lot_id, supplier_id, equipment_id, production_order_id, responsible_user_id, due_date, claim_id, excursion_id. */
    public static function crearNC(array $d, User $quien): object
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-06', 'No tienes permiso para registrar no conformidades.');

        return DB::transaction(function () use ($d, $quien) {
            $origen = in_array($d['source'] ?? null, self::ORIGENES_NC, true) ? $d['source'] : 'OTHER';
            $sev = in_array($d['severity'] ?? null, ['MINOR', 'MAJOR', 'CRITICAL'], true) ? $d['severity'] : RuleError::fail('RN-CAL-06', 'Elige la severidad.');
            $desc = Comun::texto($d['description'] ?? null, 4000) ?? RuleError::fail('RN-CAL-06', 'Describe la no conformidad.');
            $lot = ! empty($d['lot_id']) ? (DB::table('lots')->where('id', $d['lot_id'])->first() ?? RuleError::fail('RN-CAL-06', 'Lote no encontrado.')) : null;
            $orden = ! empty($d['production_order_id']) ? DB::table('production_orders')->where('id', $d['production_order_id'])->first()
                : ($lot?->production_order_ref ? DB::table('production_orders')->where('number', $lot->production_order_ref)->first() : null);
            $local = $d['establishment_id'] ?? $orden?->establishment_id ?? DB::table('establishments')->orderBy('name')->value('id');
            Comun::exigirLocal($quien, $local, 'RN-CAL-06', 'La no conformidad');
            $resp = $d['responsible_user_id'] ?? (Comun::usuariosDeRol(['CALIDAD'], $local)[0] ?? $quien->id);
            $plazo = ! empty($d['due_date']) ? Comun::fecha($d['due_date']) : Comun::ahora()->addDays($sev === 'CRITICAL' ? 2 : ($sev === 'MAJOR' ? 7 : 15))->toDateString();
            $anio = Comun::ahora()->format('Y');
            $id = DB::table('nonconformities')->insertGetId([
                'number' => Comun::numero('nonconformities', "NC-{$anio}-", 3), 'source' => $origen, 'severity' => $sev, 'description' => $desc, 'establishment_id' => $local,
                'lot_id' => $lot?->id, 'supplier_id' => $d['supplier_id'] ?? $lot?->supplier_id, 'equipment_id' => $d['equipment_id'] ?? null, 'production_order_id' => $orden?->id,
                'detected_at' => now(), 'detected_by' => $quien->id, 'responsible_user_id' => $resp, 'due_date' => $plazo, 'status' => 'OPEN',
                'claim_id' => $d['claim_id'] ?? null, 'excursion_id' => $d['excursion_id'] ?? null, 'lot_previous_status' => $lot?->qc_status,
            ], 'id');
            // RN-CAL-07: una no conformidad crítica bloquea el lote.
            if ($sev === 'CRITICAL' && $lot && in_array($lot->qc_status, ['QUARANTINE', 'RELEASED'], true)) {
                LotesService::cambiarEstado($lot->id, 'BLOCKED', 'No conformidad crítica '.DB::table('nonconformities')->where('id', $id)->value('number'), $quien, ['decision_calidad' => true]);
            }
            Comun::avisar('CAL', ['CALIDAD'], 'No conformidad '.($sev === 'CRITICAL' ? 'crítica' : ($sev === 'MAJOR' ? 'mayor' : 'menor')).($lot ? " · lote {$lot->code}" : ''),
                mb_substr($desc, 0, 240), 'CAL-08', $id, $sev === 'MINOR' ? 'warn' : 'bad', null, $local);
            Events::emit('nonconformity.opened', 'nonconformities', $id, ['severity' => $sev, 'source' => $origen, 'lot_id' => $lot?->id]);

            return self::nc($id);
        });
    }

    public static function actualizarNC(string $id, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.nonconformity.close', 'RN-CAL-06', 'Editar no conformidades lo hace Calidad.');
        $n = DB::table('nonconformities')->where('id', $id)->first() ?? RuleError::fail('RN-CAL-06', 'No conformidad no encontrada.');
        $n->status === 'CLOSED' && RuleError::fail('RN-CAL-06', 'La no conformidad está cerrada.');
        $cambios = array_filter(['root_cause' => array_key_exists('root_cause', $d) ? Comun::texto($d['root_cause'], 255) : null,
            'responsible_user_id' => $d['responsible_user_id'] ?? null, 'due_date' => ! empty($d['due_date']) ? Comun::fecha($d['due_date']) : null,
            'status' => in_array($d['status'] ?? null, ['OPEN', 'IN_PROGRESS', 'VERIFICATION'], true) ? $d['status'] : null], fn ($v) => $v !== null);
        DB::table('nonconformities')->where('id', $id)->update($cambios + ['updated_at' => now()]);

        return self::nc($id);
    }

    /** CAL-09. $d: action_type, description, responsible_user_id, due_date. */
    public static function agregarAccion(string $ncId, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-06', 'No tienes permiso para registrar acciones.');
        $n = DB::table('nonconformities')->where('id', $ncId)->first() ?? RuleError::fail('RN-CAL-06', 'No conformidad no encontrada.');
        $n->status === 'CLOSED' && RuleError::fail('RN-CAL-06', 'La no conformidad está cerrada.');
        $tipo = in_array($d['action_type'] ?? null, ['CORRECTION', 'CORRECTIVE', 'PREVENTIVE'], true) ? $d['action_type'] : RuleError::fail('RN-CAL-06', 'Elige el tipo de acción.');
        $id = DB::table('corrective_actions')->insertGetId([
            'nonconformity_id' => $ncId, 'action_type' => $tipo, 'description' => Comun::texto($d['description'] ?? null, 2000) ?? RuleError::fail('RN-CAL-06', 'Describe la acción.'),
            'responsible_user_id' => $d['responsible_user_id'] ?? $n->responsible_user_id, 'due_date' => ! empty($d['due_date']) ? Comun::fecha($d['due_date']) : $n->due_date, 'status' => 'PENDING',
        ], 'id');
        $n->status === 'OPEN' && DB::table('nonconformities')->where('id', $ncId)->update(['status' => 'IN_PROGRESS', 'updated_at' => now()]);

        return DB::table('corrective_actions')->where('id', $id)->first();
    }

    /** DONE (con evidencia), VERIFIED (lo verifica Calidad, otra persona que quien la hizo) o CANCELLED (con nota). */
    public static function avanzarAccion(string $id, string $estado, array $d, User $quien): object
    {
        $a = DB::table('corrective_actions')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-06', 'Acción no encontrada.');
        $nota = Comun::texto($d['notes'] ?? null, 1000);
        if ($estado === 'DONE') {
            self::exigir($quien, 'cal.inspection.record', 'RN-CAL-06', 'No tienes permiso para registrar acciones.');
            $a->status === 'PENDING' || RuleError::fail('RN-CAL-06', 'La acción ya no está pendiente.');
            DB::table('corrective_actions')->where('id', $id)->update(['status' => 'DONE', 'done_at' => now(), 'evidence_url' => Comun::texto($d['evidence_url'] ?? null, 255), 'notes' => $nota, 'updated_at' => now()]);
        } elseif ($estado === 'VERIFIED') {
            self::exigir($quien, 'cal.nonconformity.close', 'RN-CAL-06', 'Verificar la eficacia lo hace Calidad.');
            $a->status === 'DONE' || RuleError::fail('RN-CAL-06', 'Se verifica una acción terminada.');
            DB::table('corrective_actions')->where('id', $id)->update(['status' => 'VERIFIED', 'verified_by' => $quien->id, 'verified_at' => now(), 'notes' => $nota ?? $a->notes, 'updated_at' => now()]);
        } elseif ($estado === 'CANCELLED') {
            self::exigir($quien, 'cal.nonconformity.close', 'RN-CAL-06', 'Cancelar acciones lo hace Calidad.');
            in_array($a->status, ['PENDING', 'DONE'], true) || RuleError::fail('RN-CAL-06', 'La acción ya está cerrada.');
            $nota || RuleError::fail('RN-CAL-06', 'Cancelar una acción exige el motivo.');
            DB::table('corrective_actions')->where('id', $id)->update(['status' => 'CANCELLED', 'notes' => $nota, 'updated_at' => now()]);
        } else {
            RuleError::fail('RN-CAL-06', 'Estado no válido.');
        }

        return DB::table('corrective_actions')->where('id', $id)->first();
    }

    /** RN-CAL-06. $d: root_cause, closing_notes, effectiveness_verified. */
    public static function cerrarNC(string $id, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.nonconformity.close', 'RN-CAL-06', 'Cerrar no conformidades lo hace Calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $n = DB::table('nonconformities')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-06', 'No conformidad no encontrada.');
            Comun::exigirLocal($quien, $n->establishment_id, 'RN-CAL-06', 'La no conformidad');
            $n->status === 'CLOSED' && RuleError::fail('RN-CAL-06', 'La no conformidad ya está cerrada.');
            $causa = Comun::texto($d['root_cause'] ?? $n->root_cause, 255);
            $causa || RuleError::fail('RN-CAL-06', 'Escribe la causa raíz para cerrar.');
            $acc = DB::table('corrective_actions')->where('nonconformity_id', $id)->get();
            $acc->where('action_type', 'CORRECTIVE')->where('status', '<>', 'CANCELLED')->count() >= 1
                || RuleError::fail('RN-CAL-06', 'Registra al menos una acción correctiva antes de cerrar.');
            $pend = $acc->whereIn('status', ['PENDING'])->count();
            $pend && RuleError::fail('RN-CAL-06', $pend === 1 ? 'Hay 1 acción pendiente: termínala o cancélala antes de cerrar.' : "Hay {$pend} acciones pendientes: termínalas o cancélalas antes de cerrar.");
            DB::table('nonconformities')->where('id', $id)->update(['status' => 'CLOSED', 'root_cause' => $causa, 'closed_at' => now(), 'closed_by' => $quien->id,
                'effectiveness_verified' => (bool) ($d['effectiveness_verified'] ?? $acc->where('status', 'VERIFIED')->isNotEmpty()),
                'closing_notes' => Comun::texto($d['closing_notes'] ?? null, 2000), 'updated_at' => now()]);
            Events::emit('nonconformity.closed', 'nonconformities', $id, ['number' => $n->number, 'lot_id' => $n->lot_id]);

            return self::nc($id);
        }), self::MAPA);
    }

    public static function nc(string $id): object
    {
        $n = DB::table('nonconformities as n')->leftJoin('lots as l', 'l.id', '=', 'n.lot_id')->leftJoin('suppliers as s', 's.id', '=', 'n.supplier_id')
            ->leftJoin('equipment as e', 'e.id', '=', 'n.equipment_id')->leftJoin('users as r', 'r.id', '=', 'n.responsible_user_id')->leftJoin('users as d', 'd.id', '=', 'n.detected_by')
            ->leftJoin('production_orders as o', 'o.id', '=', 'n.production_order_id')->leftJoin('quality_claims as q', 'q.id', '=', 'n.claim_id')
            ->leftJoin('establishments as st', 'st.id', '=', 'n.establishment_id')->where('n.id', $id)
            ->first(['n.*', 'l.code as lot_code', 'l.qc_status as lot_status', DB::raw('coalesce(s.trade_name, s.legal_name) as supplier_name'), 'e.code as equipment_code',
                'r.name as responsible_name', 'd.name as detected_by_name', 'o.number as order_number', 'q.number as claim_number', DB::raw('coalesce(st.short, st.name) as establishment_name')])
            ?? RuleError::fail('RN-CAL-06', 'No conformidad no encontrada.');
        $n->actions = DB::table('corrective_actions as a')->leftJoin('users as u', 'u.id', '=', 'a.responsible_user_id')->leftJoin('users as v', 'v.id', '=', 'a.verified_by')
            ->where('a.nonconformity_id', $id)->orderBy('a.created_at')->get(['a.*', 'u.name as responsible_name', 'v.name as verified_by_name']);

        return $n;
    }

    /* ================================================================ CAL-10 registros sanitarios */

    /**
     * Nuevo registro o renovación: el anterior ACTIVE del producto y la autoridad queda REPLACED y el vigente se copia al producto.
     * $d: product_id, authority, registration_type, number, issued_on, expires_on, file_url, establishment_id, notes.
     */
    public static function registrarSanitario(array $d, User $quien): object
    {
        self::exigir($quien, 'cal.sanitary.manage', 'RN-CAL-09', 'Registrar registros sanitarios lo hace Calidad o Gerencia.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $p = DB::table('products')->where('id', $d['product_id'] ?? null)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-09', 'Elige el producto.');
            $aut = in_array($d['authority'] ?? null, ['DIGESA', 'SENASA'], true) ? $d['authority'] : RuleError::fail('RN-CAL-09', 'Elige la autoridad: DIGESA o SENASA.');
            $tipo = in_array($d['registration_type'] ?? null, ['SANITARY_REGISTRY', 'SANITARY_AUTHORIZATION', 'HEALTH_CERTIFICATE'], true) ? $d['registration_type'] : 'SANITARY_REGISTRY';
            $num = Comun::texto($d['number'] ?? null, 60) ?? RuleError::fail('RN-CAL-09', 'Escribe el número del registro.');
            $emision = Comun::fecha($d['issued_on'] ?? null);
            $vence = ! empty($d['expires_on']) ? Comun::fecha($d['expires_on']) : RuleError::fail('RN-CAL-09', 'Indica el vencimiento.');
            $vence > $emision || RuleError::fail('RN-CAL-09', 'El vencimiento debe ser posterior a la emisión.');
            $archivo = Comun::texto($d['file_url'] ?? null, 255) ?? RuleError::fail('RN-CAL-09', 'Adjunta el archivo del registro.');
            DB::table('sanitary_registrations')->where('product_id', $p->id)->where('authority', $aut)->where('status', 'ACTIVE')
                ->update(['status' => 'REPLACED', 'updated_at' => now()]);
            $id = DB::table('sanitary_registrations')->insertGetId(['product_id' => $p->id, 'authority' => $aut, 'registration_type' => $tipo, 'number' => $num,
                'issued_on' => $emision, 'expires_on' => $vence, 'establishment_id' => $d['establishment_id'] ?? null, 'file_url' => $archivo,
                'status' => $vence > Comun::hoy() ? 'ACTIVE' : 'EXPIRED', 'notes' => Comun::texto($d['notes'] ?? null, 1000)], 'id');
            if ($vence > Comun::hoy()) {
                DB::table('products')->where('id', $p->id)->update(['sanitary_authority' => $aut, 'sanitary_registry' => $num, 'sanitary_registry_expires' => $vence,
                    'sanitary_certificate' => $archivo, 'updated_at' => now()]);
            }
            Events::emit('sanitary_registration.registered', 'sanitary_registrations', $id, ['product_id' => $p->id, 'number' => $num, 'expires_on' => $vence]);

            return DB::table('sanitary_registrations')->where('id', $id)->first();
        }), self::MAPA);
    }

    /**
     * RN-CAL-09: registros ACTIVE vencidos pasan a EXPIRED; los que vencen en cal_sanitary_second_alert_days avisan a CALIDAD (una vez).
     *
     * @return array{expired: int, alerted: int}
     */
    public static function revisarSanitarios(string $hoy): array
    {
        $exp = DB::table('sanitary_registrations')->where('status', 'ACTIVE')->where('expires_on', '<=', $hoy)->update(['status' => 'EXPIRED', 'updated_at' => now()]);
        $dias = (int) (Params::get('cal_sanitary_second_alert_days') ?? 30);
        $limite = CarbonImmutable::parse($hoy)->addDays($dias)->toDateString();
        $n = 0;
        foreach (DB::table('sanitary_registrations as r')->join('products as p', 'p.id', '=', 'r.product_id')->where('r.status', 'ACTIVE')
            ->whereBetween('r.expires_on', [$hoy, $limite])->get(['r.id', 'r.number', 'r.expires_on', 'r.authority', 'p.name']) as $r) {
            $n += Comun::avisar('CAL', ['CALIDAD'], "Registro sanitario por vencer: {$r->name}", "{$r->authority} {$r->number} vence el ".Comun::dmy($r->expires_on).'. Inicia la renovación.',
                'CAL-10', $r->id, 'warn', 'sanit2:'.$r->id) > 0 ? 1 : 0;
        }

        return ['expired' => $exp, 'alerted' => $n];
    }

    /* ================================================================ CAL-11 reclamos */

    /** $d: customer_id, sales_order_id, sales_document_id, lot_id, product_id, claim_type, description, photo_url, channel, received_at, brand_id, establishment_id. */
    public static function registrarReclamo(array $d, User $quien): object
    {
        self::exigir($quien, 'cal.inspection.record', 'RN-CAL-11', 'No tienes permiso para registrar reclamos de calidad.');

        return Comun::base(fn () => DB::transaction(function () use ($d, $quien) {
            $tipo = in_array($d['claim_type'] ?? null, self::TIPOS_RECLAMO, true) ? $d['claim_type'] : RuleError::fail('RN-CAL-11', 'Elige el tipo de reclamo.');
            $pedido = ! empty($d['sales_order_id']) ? DB::table('sales_orders')->where('id', $d['sales_order_id'])->first() : null;
            $cliente = $d['customer_id'] ?? $pedido?->customer_id;
            DB::table('customers')->where('id', $cliente)->exists() || RuleError::fail('RN-CAL-11', 'Elige el cliente.');
            $lot = ! empty($d['lot_id']) ? DB::table('lots')->where('id', $d['lot_id'])->first() : null;
            $producto = $d['product_id'] ?? $lot?->product_id;
            $prod = DB::table('products')->where('id', $producto)->first() ?? RuleError::fail('RN-CAL-11', 'Elige el producto.');
            $local = $d['establishment_id'] ?? $pedido?->establishment_id ?? DB::table('establishments')->orderBy('name')->value('id');
            $desc = Comun::texto($d['description'] ?? null, 4000) ?? RuleError::fail('RN-CAL-11', 'Describe el reclamo.');
            $anio = Comun::ahora()->format('Y');
            $id = DB::table('quality_claims')->insertGetId([
                'number' => Comun::numero('quality_claims', "QR-{$anio}-", 3), 'customer_id' => $cliente, 'sales_order_id' => $pedido?->id, 'sales_document_id' => $d['sales_document_id'] ?? null,
                'lot_id' => $lot?->id, 'product_id' => $prod->id, 'claim_type' => $tipo, 'description' => $desc, 'photo_url' => Comun::texto($d['photo_url'] ?? null, 255),
                'received_at' => ! empty($d['received_at']) ? CarbonImmutable::parse($d['received_at']) : now(), 'channel' => Comun::texto($d['channel'] ?? 'WHATSAPP', 20),
                'status' => 'OPEN', 'brand_id' => $d['brand_id'] ?? $pedido?->brand_id ?? $prod->brand_id, 'establishment_id' => $local, 'registered_by' => $quien->id,
            ], 'id');
            // RN-CAL-11
            $tipos = json_decode((string) (Params::get('cal_claim_nc_types') ?? '["SPOILED","FOREIGN_BODY","TEMPERATURE"]'), true) ?: ['SPOILED', 'FOREIGN_BODY', 'TEMPERATURE'];
            if ($lot && in_array($tipo, $tipos, true)) {
                $num = DB::table('quality_claims')->where('id', $id)->value('number');
                $nc = self::crearNC(['source' => 'CUSTOMER_CLAIM', 'severity' => 'MAJOR', 'description' => "Reclamo {$num}: {$desc}", 'lot_id' => $lot->id,
                    'establishment_id' => $local, 'claim_id' => $id], $quien);
                DB::table('quality_claims')->where('id', $id)->update(['nonconformity_id' => $nc->id, 'status' => 'INVESTIGATING', 'updated_at' => now()]);
            }
            Comun::avisar('CAL', ['CALIDAD', 'SUPERVISORA_VENTAS'], 'Reclamo de calidad', mb_substr($desc, 0, 200), 'CAL-11', $id, 'warn', null, $local);

            return self::reclamo($id);
        }), self::MAPA);
    }

    /** RN-CAL-12. $d: status (RESOLVED|REJECTED|INVESTIGATING), resolution, credit_note_id, resolution_notes. */
    public static function resolverReclamo(string $id, array $d, User $quien): object
    {
        self::exigir($quien, 'cal.claim.resolve', 'RN-CAL-12', 'Resolver reclamos lo hace Calidad o la supervisora de ventas.');

        return Comun::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $c = DB::table('quality_claims')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-CAL-12', 'Reclamo no encontrado.');
            in_array($c->status, ['RESOLVED', 'REJECTED'], true) && RuleError::fail('RN-CAL-12', 'El reclamo ya está cerrado.');
            $estado = in_array($d['status'] ?? null, ['RESOLVED', 'REJECTED', 'INVESTIGATING'], true) ? $d['status'] : 'RESOLVED';
            $res = $d['resolution'] ?? null;
            if ($estado === 'RESOLVED') {
                in_array($res, self::RESOLUCIONES, true) || RuleError::fail('RN-CAL-12', 'Elige la resolución: reposición, nota de crédito, devolución, reembolso o ninguna.');
                ($res === 'CREDIT_NOTE' && empty($d['credit_note_id'])) && RuleError::fail('RN-CAL-12', 'Una resolución con nota de crédito necesita el comprobante emitido en Facturación.');
            }
            $notas = Comun::texto($d['resolution_notes'] ?? null, 2000);
            ($estado === 'REJECTED' && ! $notas) && RuleError::fail('RN-CAL-12', 'Rechazar un reclamo exige explicar por qué.');
            DB::table('quality_claims')->where('id', $id)->update(['status' => $estado, 'resolution' => $estado === 'RESOLVED' ? $res : null,
                'credit_note_id' => $res === 'CREDIT_NOTE' ? $d['credit_note_id'] : null, 'resolution_notes' => $notas,
                'resolved_at' => $estado === 'INVESTIGATING' ? null : now(), 'resolved_by' => $estado === 'INVESTIGATING' ? null : $quien->id, 'updated_at' => now()]);

            return self::reclamo($id);
        }), self::MAPA);
    }

    public static function reclamo(string $id): object
    {
        return DB::table('quality_claims as q')->join('customers as c', 'c.id', '=', 'q.customer_id')->join('products as p', 'p.id', '=', 'q.product_id')
            ->leftJoin('lots as l', 'l.id', '=', 'q.lot_id')->leftJoin('sales_orders as o', 'o.id', '=', 'q.sales_order_id')->leftJoin('sales_documents as d', 'd.id', '=', 'q.sales_document_id')
            ->leftJoin('sales_documents as nc', 'nc.id', '=', 'q.credit_note_id')->leftJoin('nonconformities as n', 'n.id', '=', 'q.nonconformity_id')->leftJoin('users as u', 'u.id', '=', 'q.resolved_by')
            ->where('q.id', $id)
            ->first(['q.*', DB::raw("coalesce(c.trade_name, c.full_name) as customer_name"), 'p.name as product_name', 'l.code as lot_code', 'o.number as order_number',
                DB::raw("d.series || '-' || d.number as document_number"), DB::raw("nc.series || '-' || nc.number as credit_note_number"), 'n.number as nc_number', 'n.status as nc_status',
                'u.name as resolved_by_name'])
            ?? RuleError::fail('RN-CAL-11', 'Reclamo no encontrado.');
    }

    /* ================================================================ CAL-13 tablero */

    public static function kpis(string $desde, string $hasta, array $locales = []): array
    {
        $enLocal = fn ($q, string $col) => $q->when($locales, fn ($x) => $x->whereIn($col, $locales));
        $fin = $hasta.' 23:59:59';
        // KPI-CAL-01 y 02: lotes con decisión en el mes; la primera decisión de cada lote.
        $dec = DB::table('lot_quality_decisions as d')->whereBetween('d.decided_at', [$desde, $fin])->get(['d.lot_id', 'd.decision', 'd.decided_at']);
        $lotes = $dec->groupBy('lot_id');
        $primera = DB::table('lot_quality_decisions')->whereIn('lot_id', $lotes->keys())->orderBy('decided_at')->get(['lot_id', 'decision'])->groupBy('lot_id')->map(fn ($g) => $g->first()->decision);
        $aLaPrimera = $primera->filter(fn ($x) => in_array($x, ['RELEASE', 'RELEASE_WITH_NOTE'], true))->count();
        $retenidos = $lotes->filter(fn ($g) => $g->whereIn('decision', ['REJECT', 'HOLD'])->isNotEmpty())->count();
        // KPI-CAL-03
        $lec = $enLocal(DB::table('temperature_readings')->whereBetween('read_at', [$desde, $fin]), 'establishment_id')->selectRaw('count(*) as n, sum(CASE WHEN in_range THEN 0 ELSE 1 END) as fuera')->first();
        $porPunto = $enLocal(DB::table('temperature_readings as r')->join('temperature_points as p', 'p.id', '=', 'r.point_id')->whereBetween('r.read_at', [$desde, $fin]), 'r.establishment_id')
            ->groupBy('p.id', 'p.code', 'p.name')->selectRaw('p.id, p.code, p.name, count(*) as readings, sum(CASE WHEN r.in_range THEN 0 ELSE 1 END) as out_of_range')->orderBy('p.code')->get()
            ->map(fn ($x) => tap($x, fn () => $x->out_of_range_pct = $x->readings ? Comun::t($x->out_of_range / $x->readings * 100, 2) : null));
        // KPI-CAL-04 al cierre del período
        $abiertas = $enLocal(DB::table('nonconformities')->where('detected_at', '<=', $fin)->where(fn ($q) => $q->where('status', '<>', 'CLOSED')->orWhere('closed_at', '>', $fin)), 'establishment_id')
            ->get(['detected_at']);
        $antig = $abiertas->count() ? round($abiertas->avg(fn ($n) => CarbonImmutable::parse($n->detected_at)->diffInDays(CarbonImmutable::parse($hasta)->endOfDay())), 1) : null;
        // KPI-CAL-05 y 06
        $tareas = DB::table('qc_schedule_tasks as t')->join('qc_schedules as s', 's.id', '=', 't.schedule_id')->join('qc_checklists as c', 'c.id', '=', 's.checklist_id')
            ->whereBetween('t.task_date', [$desde, $hasta])->when($locales, fn ($x) => $x->whereIn('s.establishment_id', $locales))->get(['t.status', 'c.stage']);
        $chk = $tareas->whereNotIn('stage', ['CLEANING', 'BPM']);
        $lim = $tareas->whereIn('stage', ['CLEANING', 'BPM']);
        // KPI-CAL-07
        $reclamos = $enLocal(DB::table('quality_claims')->whereBetween('received_at', [$desde, $fin]), 'establishment_id')->count();
        $pedidos = $enLocal(DB::table('sales_orders')->whereIn('status', ['DELIVERED', 'CLOSED'])->whereBetween('delivery_date', [$desde, $hasta]), 'establishment_id')->count();
        // KPI-CAL-08
        $hoy = min($hasta, Comun::hoy());
        $sinRegistro = DB::table('products')->where('status', 'ACTIVE')->where('sanitary_authority', 'DIGESA')->get(['id', 'code', 'name', 'sanitary_authority', 'sanitary_registry', 'sanitary_registry_expires', 'sanitary_alert_days'])
            ->filter(fn ($p) => in_array(RegistroSanitario::estado($p, $hoy)['code'], ['EXPIRED', 'MISSING'], true))->values();

        return [
            'period' => ['from' => $desde, 'to' => $hasta],
            'first_pass_release_pct' => $lotes->count() ? Comun::t($aLaPrimera / $lotes->count() * 100, 1) : null, 'lots_decided' => $lotes->count(),
            'rejected_or_held_pct' => $lotes->count() ? Comun::t($retenidos / $lotes->count() * 100, 1) : null, 'lots_rejected_or_held' => $retenidos,
            'out_of_range_pct' => (int) $lec->n ? Comun::t($lec->fuera / $lec->n * 100, 2) : null, 'readings' => (int) $lec->n, 'readings_out' => (int) $lec->fuera,
            'open_nc' => $abiertas->count(), 'open_nc_avg_age_days' => $antig,
            'checklist_compliance_pct' => $chk->count() ? Comun::t($chk->where('status', 'DONE')->count() / $chk->count() * 100, 1) : null, 'checklist_tasks' => $chk->count(),
            'cleaning_compliance_pct' => $lim->count() ? Comun::t($lim->where('status', 'DONE')->count() / $lim->count() * 100, 1) : null, 'cleaning_tasks' => $lim->count(),
            'claims' => $reclamos, 'delivered_orders' => $pedidos, 'claims_per_1000' => $pedidos ? Comun::t($reclamos / $pedidos * 1000, 1) : null,
            'digesa_without_registry' => $sinRegistro->count(), 'digesa_products' => $sinRegistro->map(fn ($p) => ['id' => $p->id, 'code' => $p->code, 'name' => $p->name, 'expires' => $p->sanitary_registry_expires]),
            'by_point' => $porPunto,
        ];
    }
}
