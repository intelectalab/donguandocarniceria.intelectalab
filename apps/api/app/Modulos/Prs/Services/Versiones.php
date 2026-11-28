<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** Presupuestos y versiones: PRS-01, 03, 04 y 05 (RN-PRS-01, 03, 04, 05, 11 y 13). */
final class Versiones
{
    public static function version(string $id): object
    {
        $v = DB::table('budget_versions as v')->join('budgets as b', 'b.id', '=', 'v.budget_id')->where('v.id', $id)
            ->first(['v.*', 'b.year', 'b.company_id', 'b.name as budget_name']);
        if (! $v) {
            RuleError::fail('RN-PRS-01', 'La versión no existe.');
        }

        return $v;
    }

    public static function editable(object $v): bool
    {
        return in_array($v->status, ['DRAFT', 'REJECTED'], true);
    }

    public static function etiqueta(object $v): string
    {
        return "{$v->year} · v{$v->version_no}";
    }

    private static function exigir(User $u, string $permiso, string $regla, string $mensaje): void
    {
        if (! Access::can($u, $permiso)) {
            RuleError::fail($regla, $mensaje);
        }
    }

    private static function bloqueada(object $v): never
    {
        RuleError::fail('RN-PRS-04', self::etiqueta($v).' está '.mb_strtolower(Base::ESTADOS[$v->status] ?? $v->status).': sus líneas no se modifican. Crea una revisión nueva.');
    }

    public static function aprobadaDe(string $budgetId): ?object
    {
        return DB::table('budget_versions')->where('budget_id', $budgetId)->where('status', 'APPROVED')->first();
    }

    public static function aprobadaDelAnio(int $anio, string $empresa): ?object
    {
        $b = DB::table('budgets')->where('company_id', $empresa)->where('year', $anio)->value('id');

        return $b ? self::aprobadaDe($b) : null;
    }

    /** RN-PRS-01: un presupuesto por empresa y año; nace con su versión 1 en borrador. */
    public static function crearPresupuesto(int $anio, string $empresa, User $u, ?string $nombre = null, string $inicio = 'VACIO', float $pct = 0): array
    {
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-01', 'Crear presupuestos es de Administración (prs.budget.edit).');
        if ($anio < 2020 || $anio > 2100) {
            RuleError::fail('RN-PRS-01', 'Indica un año válido.');
        }
        if (! DB::table('companies')->where('id', $empresa)->exists()) {
            RuleError::fail('RN-PRS-01', 'La empresa no existe.');
        }
        if (DB::table('budgets')->where('company_id', $empresa)->where('year', $anio)->exists()) {
            RuleError::fail('RN-PRS-01', "Ya existe el presupuesto {$anio} de la empresa: crea una nueva versión dentro de él.");
        }
        if ($inicio === 'VERSION' && ! self::aprobadaDelAnio($anio - 1, $empresa)) {
            RuleError::fail('RN-PRS-03', 'El año '.($anio - 1).' no tiene versión aprobada para copiar.');
        }

        return DB::transaction(function () use ($anio, $empresa, $u, $nombre, $inicio, $pct) {
            $bid = DB::table('budgets')->insertGetId(['company_id' => $empresa, 'year' => $anio, 'name' => mb_substr(trim($nombre ?: "Presupuesto {$anio}"), 0, 120),
                'status' => 'ACTIVE', 'created_by' => $u->id], 'id');
            $v = self::nuevaVersion($bid, $u, null, 0, 'Versión inicial');
            $res = null;
            if ($inicio === 'REAL') {
                $res = self::copiarReal($v->id, $pct, $u);
            } elseif ($inicio === 'VERSION') {
                $res = self::copiarVersion(self::aprobadaDelAnio($anio - 1, $empresa)->id, $v->id, $pct, $u);
            }

            return ['budget_id' => $bid, 'version_id' => $v->id, 'copia' => $res];
        });
    }

    /** Nueva versión en borrador; con $desde copia sus líneas con ajuste % (revisión). */
    public static function nuevaVersion(string $budgetId, User $u, ?string $desde = null, float $pct = 0, ?string $nombre = null): object
    {
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Crear versiones es de Administración (prs.budget.edit).');
        $b = DB::table('budgets')->where('id', $budgetId)->first();
        if (! $b) {
            RuleError::fail('RN-PRS-01', 'El presupuesto no existe.');
        }
        $origen = $desde ? self::version($desde) : null;
        if ($origen && $origen->budget_id !== $budgetId && $origen->year === $b->year) {
            RuleError::fail('RN-PRS-01', 'La versión de origen es de otro presupuesto.');
        }

        return DB::transaction(function () use ($b, $u, $origen, $pct, $nombre) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["prs:version:{$b->id}"]);
            $no = ((int) DB::table('budget_versions')->where('budget_id', $b->id)->max('version_no')) + 1;
            $accion = $origen ? 'Creada como revisión de '.self::etiqueta($origen).($pct ? ' ('.($pct > 0 ? '+' : '').$pct.' %)' : '') : 'Creada';
            $id = DB::table('budget_versions')->insertGetId([
                'budget_id' => $b->id, 'version_no' => $no, 'name' => mb_substr(trim($nombre ?: ($origen ? "Revisión de v{$origen->version_no}" : "Versión {$no}")), 0, 160),
                'status' => 'DRAFT', 'based_on_version_id' => $origen?->id, 'source' => $origen ? 'COPY_VERSION' : 'MANUAL', 'adjust_pct' => $pct,
                'created_by' => $u->id, 'history' => Base::historia(null, $u, $accion),
            ], 'id');
            if ($origen) {
                self::copiarLineas($origen, self::version($id), $pct);
            }
            Events::emit('budget.version_created', 'budget_versions', $id, ['year' => $b->year, 'version_no' => $no]);

            return self::version($id);
        });
    }

    public static function aplicarPct(float $monto, float $pct): float
    {
        return Base::r($monto * (1 + $pct / 100));
    }

    /** Copia las líneas mes a mes (el mes i del año de origen va al mes i del destino), reemplazando las del destino. */
    private static function copiarLineas(object $desde, object $hacia, float $pct): array
    {
        $mo = Base::meses((int) $desde->year);
        $md = Base::meses((int) $hacia->year);
        DB::table('budget_lines')->where('version_id', $hacia->id)->delete();
        $filas = [];
        $total = 0.0;
        foreach (DB::table('budget_lines')->where('version_id', $desde->id)->orderBy('month')->get() as $l) {
            $i = array_search($l->month, $mo, true);
            if ($i === false) {
                continue;
            }
            $monto = self::aplicarPct((float) $l->amount, $pct);
            $total += $monto;
            $filas[] = ['version_id' => $hacia->id, 'concept_id' => $l->concept_id, 'month' => $md[$i], 'brand_id' => $l->brand_id,
                'establishment_id' => $l->establishment_id, 'cost_center_id' => $l->cost_center_id, 'amount' => $monto, 'note' => $l->note];
        }
        foreach (array_chunk($filas, 400) as $lote) {
            DB::table('budget_lines')->insert($lote);
        }

        return ['lineas' => count($filas), 'total' => Base::r($total)];
    }

    /** PRS-04: copia otra versión con ajuste %. */
    public static function copiarVersion(string $desdeId, string $haciaId, float $pct, User $u): array
    {
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Copiar líneas es de Administración (prs.budget.edit).');
        $hacia = self::version($haciaId);
        if (! self::editable($hacia)) {
            self::bloqueada($hacia);
        }
        $desde = self::version($desdeId);
        if ($desde->id === $hacia->id) {
            RuleError::fail('RN-PRS-04', 'Elige otra versión como origen.');
        }

        return DB::transaction(function () use ($desde, $hacia, $pct, $u) {
            $r = self::copiarLineas($desde, $hacia, $pct);
            DB::table('budget_versions')->where('id', $hacia->id)->update(['source' => 'COPY_VERSION', 'adjust_pct' => $pct, 'based_on_version_id' => $desde->id,
                'history' => Base::historia($hacia->history, $u, "Copiadas {$r['lineas']} líneas de ".self::etiqueta($desde).' con '.($pct >= 0 ? '+' : '')."{$pct} %"), 'updated_at' => now()]);

            return $r;
        });
    }

    /**
     * Base del real del año anterior para copiar (PRS-04): meses cerrados (real congelado), vencidos (real), el mes en curso
     * (proyección) y los futuros (presupuesto aprobado). Solo lo que cae en una línea o tiene dimensión.
     */
    public static function baseDelReal(int $anio, string $empresa, ?string $al = null): array
    {
        $al ??= Base::hoy();
        $ap = self::aprobadaDelAnio($anio, $empresa);
        $meses = Base::meses($anio);
        $ex = Ejecucion::calcular($ap?->id, $meses, $al, $empresa);
        $out = [];
        foreach ($ex['slots'] as $s) {
            if (! $s['brand_id'] && ! $s['establishment_id'] && ! $s['cost_center_id']) {
                continue;
            }
            foreach ($meses as $i => $m) {
                $x = $s['months'][$m] ?? ['budget' => 0, 'actual' => 0, 'forecast' => 0];
                $estado = $ex['estados'][$m];
                $base = $estado === 'FUTURE' ? $x['budget'] : ($estado === 'CURRENT' ? $x['forecast'] : $x['actual']);
                if ($base > Base::EPS) {
                    $out[] = ['i' => $i, 'estado' => $estado, 'concept_id' => $s['concept_id'], 'brand_id' => $s['brand_id'],
                        'establishment_id' => $s['establishment_id'], 'cost_center_id' => $s['cost_center_id'], 'amount' => (float) $base];
                }
            }
        }

        return $out;
    }

    /** PRS-04: copia el real del año anterior con ajuste % (CA-PRS-05), en soles enteros. */
    public static function copiarReal(string $haciaId, float $pct, User $u, ?string $al = null): array
    {
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Copiar líneas es de Administración (prs.budget.edit).');
        $hacia = self::version($haciaId);
        if (! self::editable($hacia)) {
            self::bloqueada($hacia);
        }
        $anio = (int) $hacia->year;
        $md = Base::meses($anio);
        $agg = [];
        foreach (self::baseDelReal($anio - 1, $hacia->company_id, $al) as $b) {
            $k = Ejecucion::clave($b).'|'.$b['i'];
            $agg[$k] ??= $b + ['suma' => 0.0];
            $agg[$k]['suma'] += $b['amount'];
        }
        $nombres = ['CLOSED' => 'cerrado', 'COMPLETE' => 'real', 'CURRENT' => 'proyección', 'FUTURE' => 'presupuesto'];

        return DB::transaction(function () use ($hacia, $pct, $u, $agg, $md, $anio, $nombres) {
            DB::table('budget_lines')->where('version_id', $hacia->id)->delete();
            $filas = [];
            $total = 0.0;
            foreach ($agg as $b) {
                $monto = round(self::aplicarPct($b['suma'], $pct));
                if ($monto <= 0) {
                    continue;
                }
                $total += $monto;
                $filas[] = ['version_id' => $hacia->id, 'concept_id' => $b['concept_id'], 'month' => $md[$b['i']], 'brand_id' => $b['brand_id'],
                    'establishment_id' => $b['establishment_id'], 'cost_center_id' => $b['cost_center_id'], 'amount' => $monto,
                    'note' => 'Real '.($anio - 1).' ('.$nombres[$b['estado']].') '.($pct >= 0 ? '+' : '').$pct.' %'];
            }
            foreach (array_chunk($filas, 400) as $lote) {
                DB::table('budget_lines')->insert($lote);
            }
            $n = count($filas);
            DB::table('budget_versions')->where('id', $hacia->id)->update(['source' => 'COPY_ACTUAL', 'adjust_pct' => $pct,
                'history' => Base::historia($hacia->history, $u, 'Copiado el real '.($anio - 1).' con '.($pct >= 0 ? '+' : '')."{$pct} % ({$n} líneas, ".Base::soles($total).')'), 'updated_at' => now()]);

            return ['lineas' => $n, 'total' => Base::r($total)];
        });
    }

    /** Valida una línea (RN-PRS-01, 04, 11 y 13) y devuelve sus datos normalizados. */
    public static function validarLinea(object $v, array $d, bool $estricto = false, ?string $lineaId = null): array
    {
        $crudo = $d['amount'] ?? null;
        if ($crudo === null || $crudo === '' || ! is_numeric($crudo)) {
            RuleError::fail('RN-PRS-11', 'El importe debe ser un número en soles sin IGV.');
        }
        $monto = (float) $crudo;
        if ($monto < 0) {
            RuleError::fail('RN-PRS-11', 'El importe '.Base::soles($monto, 2).' es negativo: los importes del presupuesto son en soles, sin IGV y no negativos.');
        }
        if ($monto > 999999999999) {
            RuleError::fail('RN-PRS-11', 'El importe es demasiado grande.');
        }
        $c = ! empty($d['concept_id']) ? DB::table('budget_concepts')->where('id', $d['concept_id'])->first() : null;
        if (! $c || $c->is_group) {
            RuleError::fail('RN-PRS-01', 'Cada línea necesita un concepto de detalle.');
        }
        if ($c->status !== 'ACTIVE') {
            RuleError::fail('RN-PRS-01', "El concepto {$c->code} está inactivo.");
        }
        $mes = ! empty($d['month']) && preg_match('/^\d{4}-\d{2}/', (string) $d['month']) ? Base::mes((string) $d['month']) : null;
        if (! $mes || ! in_array($mes, Base::meses((int) $v->year), true)) {
            RuleError::fail('RN-PRS-01', "El mes debe pertenecer al año presupuestal {$v->year}.");
        }
        $dims = ['brand_id' => $d['brand_id'] ?? null ?: null, 'establishment_id' => $d['establishment_id'] ?? null ?: null, 'cost_center_id' => $d['cost_center_id'] ?? null ?: null];
        if (! $dims['brand_id'] && ! $dims['establishment_id'] && ! $dims['cost_center_id']) {
            RuleError::fail('RN-PRS-01', 'Cada línea necesita al menos una dimensión: marca, local o centro de costo.');
        }
        foreach (['brand_id' => ['brands', 'La marca'], 'establishment_id' => ['establishments', 'El local'], 'cost_center_id' => ['cost_centers', 'El centro de costo']] as $k => [$t, $n]) {
            if ($dims[$k] && (! preg_match('/^[0-9a-f-]{36}$/i', $dims[$k]) || ! DB::table($t)->where('id', $dims[$k])->exists())) {
                RuleError::fail('RN-PRS-01', "{$n} no existe.");
            }
        }
        $fila = ['version_id' => $v->id, 'concept_id' => $c->id, 'month' => $mes, 'amount' => Base::r($monto),
            'note' => isset($d['note']) && trim((string) $d['note']) !== '' ? mb_substr(trim((string) $d['note']), 0, 500) : null] + $dims;
        $igual = DB::table('budget_lines')->where('version_id', $v->id)->where('concept_id', $c->id)->where('month', $mes)
            ->where(fn ($q) => $dims['brand_id'] ? $q->where('brand_id', $dims['brand_id']) : $q->whereNull('brand_id'))
            ->where(fn ($q) => $dims['establishment_id'] ? $q->where('establishment_id', $dims['establishment_id']) : $q->whereNull('establishment_id'))
            ->where(fn ($q) => $dims['cost_center_id'] ? $q->where('cost_center_id', $dims['cost_center_id']) : $q->whereNull('cost_center_id'))
            ->value('id');
        if ($igual && $igual !== $lineaId && ($estricto || $lineaId)) {
            RuleError::fail('RN-PRS-13', "Ya hay una línea de {$c->name} en ".Base::nombreMes($mes).' con esas dimensiones: una sola línea por concepto, mes, marca, local y centro de costo.');
        }

        return ['fila' => $fila, 'igual' => $igual, 'concepto' => $c];
    }

    /** Alta o cambio de una línea. Sin id y con una línea igual: actualiza su importe (salvo $estricto). */
    public static function guardarLinea(string $versionId, array $d, User $u, bool $estricto = false, ?string $lineaId = null): object
    {
        $v = self::version($versionId);
        if (! self::editable($v)) {
            self::bloqueada($v);
        }
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Editar versiones en borrador es de Administración (prs.budget.edit).');
        $r = self::validarLinea($v, $d, $estricto, $lineaId);
        $id = $lineaId ?? $r['igual'];
        if ($id) {
            DB::table('budget_lines')->where('id', $id)->where('version_id', $v->id)->update($r['fila'] + ['updated_at' => now()]);
        } else {
            $id = DB::table('budget_lines')->insertGetId($r['fila'], 'id');
        }

        return DB::table('budget_lines')->where('id', $id)->first();
    }

    /** Cambia solo el importe de una línea (CA-PRS-02: en una versión aprobada se rechaza con RN-PRS-04). */
    public static function cambiarImporte(string $lineaId, mixed $importe, User $u): object
    {
        $l = DB::table('budget_lines')->where('id', $lineaId)->first();
        if (! $l) {
            RuleError::fail('RN-PRS-01', 'La línea no existe.');
        }

        return self::guardarLinea($l->version_id, ['amount' => $importe] + (array) $l, $u, false, $l->id);
    }

    /** Agrega o reemplaza una fila completa (concepto y dimensiones) con sus 12 importes. Un importe vacío quita ese mes. */
    public static function guardarFila(string $versionId, array $d, array $importes, User $u, ?string $claveAnterior = null): int
    {
        $v = self::version($versionId);
        if (! self::editable($v)) {
            self::bloqueada($v);
        }
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Editar versiones en borrador es de Administración (prs.budget.edit).');
        $meses = Base::meses((int) $v->year);

        return DB::transaction(function () use ($v, $d, $importes, $u, $claveAnterior, $meses) {
            if ($claveAnterior) {
                self::quitarFila($v->id, $claveAnterior, $u);
            } elseif (DB::table('budget_lines')->where('version_id', $v->id)->get()->contains(fn ($l) => Ejecucion::clave($l) === Ejecucion::clave($d))) {
                RuleError::fail('RN-PRS-13', 'Ya hay una fila de ese concepto con esas dimensiones: edítala en la matriz.');
            }
            $n = 0;
            foreach ($meses as $i => $m) {
                $x = $importes[$i] ?? null;
                if ($x === null || $x === '') {
                    continue;
                }
                self::guardarLinea($v->id, ['month' => $m, 'amount' => $x] + $d, $u, true);
                $n++;
            }
            if ($n === 0) {
                RuleError::fail('RN-PRS-01', 'Escribe el importe de al menos un mes.');
            }

            return $n;
        });
    }

    /** Quita todas las líneas de una fila (concepto + dimensiones) de una versión en borrador. */
    public static function quitarFila(string $versionId, string $clave, User $u): int
    {
        $v = self::version($versionId);
        if (! self::editable($v)) {
            self::bloqueada($v);
        }
        self::exigir($u, 'prs.budget.edit', 'RN-PRS-04', 'Editar versiones en borrador es de Administración (prs.budget.edit).');
        $ids = DB::table('budget_lines')->where('version_id', $v->id)->get()->filter(fn ($l) => Ejecucion::clave($l) === $clave)->pluck('id')->all();

        return $ids ? DB::table('budget_lines')->whereIn('id', $ids)->delete() : 0;
    }

    /** RN-PRS-02: conceptos de costo o gasto usados en la versión sin mapeo. */
    public static function sinMapeo(string $versionId): array
    {
        return DB::table('budget_concepts as c')->whereIn('c.id', DB::table('budget_lines')->where('version_id', $versionId)->select('concept_id'))
            ->where('c.concept_type', '<>', 'INCOME')->where('c.is_group', false)
            ->whereNotExists(fn ($q) => $q->from('budget_concept_mappings as m')->whereColumn('m.concept_id', 'c.id')->where('m.status', 'ACTIVE'))
            ->orderBy('c.sort_order')->get(['c.id', 'c.code', 'c.name'])->all();
    }

    public static function enviar(string $id, User $u, ?string $comentario = null): object
    {
        $v = self::version($id);
        self::exigir($u, 'prs.budget.submit', 'RN-PRS-05', 'Enviar a aprobación es de Administración (prs.budget.submit).');
        if (! self::editable($v)) {
            RuleError::fail('RN-PRS-04', self::etiqueta($v).' ya está '.mb_strtolower(Base::ESTADOS[$v->status] ?? $v->status).'.');
        }
        if (! DB::table('budget_lines')->where('version_id', $id)->exists()) {
            RuleError::fail('RN-PRS-01', self::etiqueta($v).' no tiene líneas.');
        }
        $sin = self::sinMapeo($id);
        if ($sin) {
            RuleError::fail('RN-PRS-02', 'Sin mapeo a categorías de gasto o cuentas: '.implode(', ', array_map(fn ($c) => "{$c->code} {$c->name}", $sin))
                .'. Mapéalos en Conceptos presupuestales para calcular su real; mientras tanto la versión no se envía.');
        }

        return DB::transaction(function () use ($v, $u, $comentario) {
            DB::table('budget_versions')->where('id', $v->id)->update(['status' => 'SUBMITTED', 'submitted_by' => $u->id, 'submitted_at' => now(),
                'rejected_by' => null, 'rejected_at' => null, 'decision_comment' => null,
                'history' => Base::historia($v->history, $u, 'Enviada a aprobación', $comentario ? trim($comentario) : null), 'updated_at' => now()]);
            Base::avisar(['role' => 'GERENTE'], 'Presupuesto por aprobar '.self::etiqueta($v), "{$u->name} envió ".self::etiqueta($v)." ({$v->name}).", 'PRS-05', $v->id, 'warn');
            Events::emit('budget.submitted', 'budget_versions', $v->id, ['year' => $v->year, 'version_no' => $v->version_no]);

            return self::version($v->id);
        });
    }

    /** Quien elabora o envía no decide (RN-PRS-05); solo GERENTE aprueba (D-PRS-03). */
    private static function decide(object $v, User $u, string $accion): void
    {
        if ($v->status !== 'SUBMITTED') {
            RuleError::fail('RN-PRS-03', "Solo se {$accion} una versión enviada; ".self::etiqueta($v).' está '.mb_strtolower(Base::ESTADOS[$v->status] ?? $v->status).'.');
        }
        if ($u->id === $v->submitted_by || $u->id === $v->created_by) {
            RuleError::fail('RN-PRS-05', "{$u->name} ".($u->id === $v->submitted_by ? 'envió' : 'elaboró').' '.self::etiqueta($v).': la decide otra persona.');
        }
        self::exigir($u, 'prs.budget.approve', 'RN-PRS-05', 'Aprobar o rechazar presupuestos es de Gerencia (prs.budget.approve).');
    }

    /** RN-PRS-03: al aprobar, la vigente anterior pasa a reemplazada y solo queda una aprobada. */
    public static function aprobar(string $id, User $u, ?string $comentario = null): object
    {
        $v = self::version($id);
        self::decide($v, $u, 'aprueba');

        return DB::transaction(function () use ($v, $u, $comentario) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["prs:version:{$v->budget_id}"]);
            $previa = self::aprobadaDe($v->budget_id);
            if ($previa && $previa->id !== $v->id) {
                DB::table('budget_versions')->where('id', $previa->id)->update(['status' => 'SUPERSEDED', 'superseded_at' => now(), 'superseded_by_version_id' => $v->id,
                    'history' => Base::historia($previa->history, $u, 'Reemplazada por '.self::etiqueta($v)), 'updated_at' => now()]);
            }
            DB::table('budget_versions')->where('id', $v->id)->update(['status' => 'APPROVED', 'approved_by' => $u->id, 'approved_at' => now(),
                'decision_comment' => $comentario ? trim($comentario) : null,
                'history' => Base::historia($v->history, $u, 'Aprobada · versión vigente', $comentario ? trim($comentario) : null), 'updated_at' => now()]);
            DB::table('budgets')->where('id', $v->budget_id)->update(['current_version_id' => $v->id, 'updated_at' => now()]);
            Base::avisar(['user_id' => $v->submitted_by], 'Presupuesto aprobado '.self::etiqueta($v), $comentario ?: 'Ya es la versión vigente.', 'PRS-01', $v->id, 'ok');
            Events::emit('budget.approved', 'budget_versions', $v->id, ['year' => $v->year, 'version_no' => $v->version_no, 'replaces' => $previa?->id]);

            return self::version($v->id);
        });
    }

    public static function rechazar(string $id, User $u, ?string $comentario): object
    {
        $v = self::version($id);
        self::decide($v, $u, 'rechaza');
        $comentario = trim((string) $comentario);
        if (mb_strlen($comentario) < 5) {
            RuleError::fail('RN-PRS-05', 'Escribe el motivo del rechazo para que se corrija la versión.');
        }

        return DB::transaction(function () use ($v, $u, $comentario) {
            DB::table('budget_versions')->where('id', $v->id)->update(['status' => 'REJECTED', 'rejected_by' => $u->id, 'rejected_at' => now(), 'decision_comment' => $comentario,
                'history' => Base::historia($v->history, $u, 'Rechazada', $comentario), 'updated_at' => now()]);
            Base::avisar(['user_id' => $v->submitted_by], 'Presupuesto rechazado '.self::etiqueta($v), $comentario, 'PRS-03', $v->id, 'bad');

            return self::version($v->id);
        });
    }

    /** Totales por tipo (en los meses dados, o todo el año). */
    public static function totales(string $versionId, ?array $meses = null, ?array $alcance = null): array
    {
        $o = ['INCOME' => 0.0, 'COST_OF_SALES' => 0.0, 'EXPENSE' => 0.0];
        $q = DB::table('budget_lines as l')->join('budget_concepts as c', 'c.id', '=', 'l.concept_id')->where('l.version_id', $versionId)
            ->when($meses, fn ($w) => $w->whereIn('l.month', $meses));
        foreach ($q->get(['c.concept_type', 'l.amount', 'l.brand_id', 'l.cost_center_id']) as $l) {
            if (Base::visible($alcance, $l)) {
                $o[$l->concept_type] += (float) $l->amount;
            }
        }

        return ['ingreso' => Base::r($o['INCOME']), 'costo' => Base::r($o['COST_OF_SALES']), 'gasto' => Base::r($o['EXPENSE']),
            'resultado' => Base::r($o['INCOME'] - $o['COST_OF_SALES'] - $o['EXPENSE'])];
    }

    /** PRS-05 y PRS-09: diferencias entre dos versiones por concepto y mes. */
    public static function comparar(string $aId, string $bId, ?array $alcance = null): array
    {
        $a = self::version($aId);
        $b = self::version($bId);
        $ma = Base::meses((int) $a->year);
        $mb = Base::meses((int) $b->year);
        $conceptos = Conceptos::porId();
        $filas = [];
        foreach ([[$a, $ma, 'a'], [$b, $mb, 'b']] as [$v, $meses, $lado]) {
            foreach (DB::table('budget_lines')->where('version_id', $v->id)->get() as $l) {
                if (! Base::visible($alcance, $l)) {
                    continue;
                }
                $i = array_search($l->month, $meses, true);
                if ($i === false) {
                    continue;
                }
                $filas[$l->concept_id] ??= ['concept_id' => $l->concept_id, 'a' => array_fill(0, 12, 0.0), 'b' => array_fill(0, 12, 0.0)];
                $filas[$l->concept_id][$lado][$i] += (float) $l->amount;
            }
        }
        $out = [];
        foreach ($filas as $f) {
            $c = $conceptos[$f['concept_id']] ?? [];
            $ta = array_sum($f['a']);
            $tb = array_sum($f['b']);
            $out[] = ['concept_id' => $f['concept_id'], 'code' => $c['code'] ?? '', 'name' => $c['name'] ?? '', 'type' => $c['concept_type'] ?? 'EXPENSE',
                'sort' => $c['sort_order'] ?? 999, 'a' => array_map(fn ($x) => Base::r($x), $f['a']), 'b' => array_map(fn ($x) => Base::r($x), $f['b']),
                'diff' => array_map(fn ($x, $y) => Base::r($y - $x), $f['a'], $f['b']), 'total_a' => Base::r($ta), 'total_b' => Base::r($tb),
                'total_diff' => Base::r($tb - $ta), 'pct' => Base::pct($tb - $ta, $ta)];
        }
        usort($out, fn ($x, $y) => $x['sort'] <=> $y['sort']);

        return ['a' => self::resumen($a), 'b' => self::resumen($b), 'filas' => $out,
            'totales' => ['a' => self::totales($a->id, null, $alcance), 'b' => self::totales($b->id, null, $alcance)]];
    }

    public static function resumen(object $v): array
    {
        $users = DB::table('users')->whereIn('id', array_filter([$v->created_by, $v->submitted_by, $v->approved_by, $v->rejected_by]))->pluck('name', 'id');

        return ['id' => $v->id, 'budget_id' => $v->budget_id, 'year' => (int) $v->year, 'version_no' => (int) $v->version_no, 'name' => $v->name,
            'status' => $v->status, 'estado' => Base::ESTADOS[$v->status] ?? $v->status, 'etiqueta' => self::etiqueta($v), 'source' => $v->source,
            'adjust_pct' => (float) $v->adjust_pct, 'based_on_version_id' => $v->based_on_version_id, 'editable' => self::editable($v),
            'creada_por' => $users[$v->created_by] ?? null, 'created_by' => $v->created_by, 'created_at' => $v->created_at,
            'enviada_por' => $users[$v->submitted_by] ?? null, 'submitted_by' => $v->submitted_by, 'submitted_at' => $v->submitted_at,
            'aprobada_por' => $users[$v->approved_by] ?? null, 'approved_at' => $v->approved_at,
            'rechazada_por' => $users[$v->rejected_by] ?? null, 'rejected_at' => $v->rejected_at,
            'decision_comment' => $v->decision_comment, 'history' => json_decode($v->history ?? '[]', true) ?: []];
    }
}
