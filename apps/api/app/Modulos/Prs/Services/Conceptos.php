<?php

namespace App\Modulos\Prs\Services;

use App\Models\User;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** PRS-02 Conceptos presupuestales y su mapeo a las fuentes del real (RN-PRS-02 y RN-PRS-06). */
final class Conceptos
{
    /** Todos los conceptos en su orden, con sus mapeos activos. */
    public static function arbol(): array
    {
        $cats = DB::table('expense_categories')->pluck('name', 'id');
        $maps = DB::table('budget_concept_mappings')->where('status', 'ACTIVE')->orderBy('created_at')->get()->groupBy('concept_id');
        $centros = DB::table('cost_centers')->pluck('name', 'id');

        return DB::table('budget_concepts')->orderBy('sort_order')->orderBy('code')->get()->map(function ($c) use ($maps, $cats, $centros) {
            $m = ($maps[$c->id] ?? collect())->map(fn ($x) => ['id' => $x->id, 'source' => $x->source, 'ref' => $x->ref, 'note' => $x->note,
                'etiqueta' => self::etiqueta($x->source, $x->ref, $cats)])->values()->all();

            return ['id' => $c->id, 'code' => $c->code, 'name' => $c->name, 'parent_id' => $c->parent_id, 'is_group' => (bool) $c->is_group,
                'concept_type' => $c->concept_type, 'behavior' => $c->behavior, 'status' => $c->status, 'sort_order' => (int) $c->sort_order,
                'default_cost_center_id' => $c->default_cost_center_id, 'centro' => $c->default_cost_center_id ? ($centros[$c->default_cost_center_id] ?? null) : null,
                'mapeos' => $m, 'necesita_mapeo' => self::necesitaMapeo($c), 'mapeado' => count($m) > 0];
        })->all();
    }

    public static function etiqueta(string $fuente, ?string $ref, $cats = null): string
    {
        return match ($fuente) {
            'EXPENSE_CATEGORY' => 'GAS · '.(($cats ? ($cats[$ref] ?? null) : DB::table('expense_categories')->where('id', $ref)->value('name')) ?? 'categoría'),
            'PAYROLL' => 'PER · '.(Base::PERSONAL[$ref] ?? $ref),
            'ACCOUNT' => 'CNT · cuenta '.$ref,
            default => Base::FUENTES[$fuente] ?? $fuente,
        };
    }

    public static function necesitaMapeo(object $c): bool
    {
        return ! $c->is_group && $c->concept_type !== 'INCOME';
    }

    private static function puede(User $u): void
    {
        if (! \App\Support\Access::can($u, 'prs.concept.manage')) {
            RuleError::fail('RN-PRS-02', 'Los conceptos y su mapeo los manejan Administración y la Contadora (prs.concept.manage).');
        }
    }

    public static function guardar(array $d, User $u, ?string $id = null): object
    {
        self::puede($u);
        $code = strtoupper(trim((string) ($d['code'] ?? '')));
        $name = trim((string) ($d['name'] ?? ''));
        if ($code === '' || $name === '') {
            RuleError::fail('RN-PRS-01', 'El concepto necesita código y nombre.');
        }
        if (! preg_match('/^[A-Z0-9][A-Z0-9\-_.]{0,19}$/', $code)) {
            RuleError::fail('RN-PRS-01', 'El código usa letras, números y guiones (hasta 20).');
        }
        if (DB::table('budget_concepts')->whereRaw('upper(code) = ?', [$code])->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
            RuleError::fail('RN-PRS-01', "Ya existe el concepto {$code}.");
        }
        $actual = $id ? DB::table('budget_concepts')->where('id', $id)->first() : null;
        if ($id && ! $actual) {
            RuleError::fail('RN-PRS-01', 'El concepto no existe.');
        }
        $padre = ! empty($d['parent_id']) ? DB::table('budget_concepts')->where('id', $d['parent_id'])->first() : null;
        if (! empty($d['parent_id']) && (! $padre || ! $padre->is_group)) {
            RuleError::fail('RN-PRS-01', 'El grupo elegido no existe.');
        }
        $esGrupo = ! $padre && (bool) ($d['is_group'] ?? false);
        if ($actual && (bool) $actual->is_group !== $esGrupo) {
            RuleError::fail('RN-PRS-01', 'Un grupo no se vuelve concepto de detalle (ni al revés): crea uno nuevo.');
        }
        $tipo = $padre ? $padre->concept_type : ($d['concept_type'] ?? 'EXPENSE');
        if (! isset(Base::TIPOS[$tipo])) {
            RuleError::fail('RN-PRS-01', 'Elige el tipo: ingreso, costo de ventas o gasto.');
        }
        if ($actual && $actual->concept_type !== $tipo && DB::table('budget_lines')->where('concept_id', $id)->exists()) {
            RuleError::fail('RN-PRS-01', 'El concepto ya tiene líneas en un presupuesto: no cambia de tipo.');
        }
        if (! $esGrupo && ! $padre) {
            RuleError::fail('RN-PRS-01', 'Un concepto de detalle va dentro de un grupo.');
        }
        $comp = $esGrupo ? null : (($d['behavior'] ?? 'VARIABLE') === 'FIXED' ? 'FIXED' : 'VARIABLE');
        $centro = ! empty($d['default_cost_center_id']) ? $d['default_cost_center_id'] : null;
        if ($centro && ! DB::table('cost_centers')->where('id', $centro)->exists()) {
            RuleError::fail('RN-PRS-01', 'El centro de costo no existe.');
        }
        $estado = ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
        $fila = ['code' => $code, 'name' => mb_substr($name, 0, 120), 'parent_id' => $padre?->id, 'is_group' => $esGrupo, 'concept_type' => $tipo,
            'behavior' => $comp, 'default_cost_center_id' => $centro, 'status' => $estado];

        return DB::transaction(function () use ($id, $fila, $padre, $actual) {
            if ($id) {
                DB::table('budget_concepts')->where('id', $id)->update($fila + ['updated_at' => now()]);
                if ($actual->is_group && $actual->concept_type !== $fila['concept_type']) {
                    DB::table('budget_concepts')->where('parent_id', $id)->update(['concept_type' => $fila['concept_type'], 'updated_at' => now()]);
                }

                return DB::table('budget_concepts')->where('id', $id)->first();
            }
            $orden = $padre
                ? ((int) (DB::table('budget_concepts')->where('parent_id', $padre->id)->max('sort_order') ?? $padre->sort_order)) + 1
                : ((int) DB::table('budget_concepts')->max('sort_order')) + 10;
            $nuevo = DB::table('budget_concepts')->insertGetId($fila + ['sort_order' => $orden], 'id');

            return DB::table('budget_concepts')->where('id', $nuevo)->first();
        });
    }

    /** Agrega un mapeo. Una fuente cuenta una sola vez (RN-PRS-06). */
    public static function mapear(string $conceptoId, array $d, User $u): object
    {
        self::puede($u);
        $c = DB::table('budget_concepts')->where('id', $conceptoId)->first();
        if (! $c || $c->is_group) {
            RuleError::fail('RN-PRS-02', 'Elige un concepto de detalle (no un grupo).');
        }
        $fuente = $d['source'] ?? '';
        if (! isset(Base::FUENTES[$fuente])) {
            RuleError::fail('RN-PRS-02', 'Elige la fuente del mapeo.');
        }
        $ref = isset($d['ref']) && $d['ref'] !== '' ? trim((string) $d['ref']) : null;
        if (in_array($fuente, ['SALES', 'COST_OF_SALES'], true)) {
            $ref = null;
        } elseif ($ref === null) {
            RuleError::fail('RN-PRS-02', 'Indica la categoría de gasto, el tipo de costo de personal o la cuenta contable.');
        }
        if ($fuente === 'ACCOUNT' && ! preg_match('/^\d{2,8}$/', $ref)) {
            RuleError::fail('RN-PRS-02', "La cuenta contable «{$ref}» debe ser numérica (PCGE, de 2 a 8 dígitos).");
        }
        if ($fuente === 'PAYROLL' && ! isset(Base::PERSONAL[$ref])) {
            RuleError::fail('RN-PRS-02', 'Elige planilla, comisiones o bonos.');
        }
        if ($c->concept_type === 'INCOME' && ! in_array($fuente, ['SALES', 'ACCOUNT'], true)) {
            RuleError::fail('RN-PRS-06', 'Un concepto de ingreso solo se mapea a ventas (FAC) o a cuentas de ingreso.');
        }
        if ($c->concept_type !== 'INCOME' && $fuente === 'SALES') {
            RuleError::fail('RN-PRS-06', 'Las ventas solo se mapean a conceptos de ingreso.');
        }
        if ($c->concept_type !== 'COST_OF_SALES' && $fuente === 'COST_OF_SALES') {
            RuleError::fail('RN-PRS-06', 'El costo de ventas de los comprobantes va a un concepto de costo de ventas.');
        }
        if ($fuente === 'EXPENSE_CATEGORY') {
            $cat = DB::table('expense_categories')->where('id', $ref)->first();
            if (! $cat) {
                RuleError::fail('RN-PRS-02', 'La categoría de gasto no existe.');
            }
            if ($cat->category_group === 'PERSONNEL' && DB::table('budget_concept_mappings')->where('status', 'ACTIVE')->where('source', 'PAYROLL')->exists()) {
                RuleError::fail('RN-PRS-06', "«{$cat->name}» es una categoría de personal de GAS: el personal se toma de PER y no se cuenta dos veces.");
            }
        }
        if ($fuente === 'PAYROLL' && DB::table('budget_concept_mappings as m')->join('expense_categories as e', DB::raw('e.id::text'), '=', 'm.ref')
            ->where('m.status', 'ACTIVE')->where('m.source', 'EXPENSE_CATEGORY')->where('e.category_group', 'PERSONNEL')->exists()) {
            RuleError::fail('RN-PRS-06', 'Hay categorías de personal de GAS mapeadas: quítalas antes de mapear PER (un mismo costo cuenta una sola vez).');
        }
        $dup = DB::table('budget_concept_mappings')->where('status', 'ACTIVE')->where('source', $fuente)
            ->where(fn ($q) => $ref === null ? $q->whereNull('ref') : $q->where('ref', $ref))->first();
        if ($dup) {
            $otro = DB::table('budget_concepts')->where('id', $dup->concept_id)->value('name');
            RuleError::fail('RN-PRS-06', self::etiqueta($fuente, $ref)." ya está mapeada a «{$otro}»: un mismo documento cuenta una sola vez.");
        }
        $nota = isset($d['note']) ? mb_substr(trim((string) $d['note']), 0, 500) : null;
        $id = DB::table('budget_concept_mappings')->insertGetId(['concept_id' => $conceptoId, 'source' => $fuente, 'ref' => $ref, 'note' => $nota ?: null,
            'status' => 'ACTIVE', 'created_by' => $u->id], 'id');

        return DB::table('budget_concept_mappings')->where('id', $id)->first();
    }

    public static function quitarMapeo(string $id, User $u): void
    {
        self::puede($u);
        $n = DB::table('budget_concept_mappings')->where('id', $id)->where('status', 'ACTIVE')
            ->update(['status' => 'INACTIVE', 'removed_by' => $u->id, 'removed_at' => now(), 'updated_at' => now()]);
        if (! $n) {
            RuleError::fail('RN-PRS-02', 'El mapeo no existe o ya se quitó.');
        }
    }

    /**
     * Índice fuente → concepto para calcular el real (cada documento cuenta una sola vez). Solo conceptos activos.
     *
     * @return array{SALES: ?string, COST_OF_SALES: ?string, EXPENSE_CATEGORY: array<string,string>, PAYROLL: array<string,string>, ACCOUNT: array<string,string>}
     */
    public static function indice(): array
    {
        $idx = ['SALES' => null, 'COST_OF_SALES' => null, 'EXPENSE_CATEGORY' => [], 'PAYROLL' => [], 'ACCOUNT' => []];
        $filas = DB::table('budget_concept_mappings as m')->join('budget_concepts as c', 'c.id', '=', 'm.concept_id')
            ->where('m.status', 'ACTIVE')->where('c.status', 'ACTIVE')->where('c.is_group', false)->orderBy('m.created_at')->get(['m.concept_id', 'm.source', 'm.ref']);
        foreach ($filas as $m) {
            if (in_array($m->source, ['SALES', 'COST_OF_SALES'], true)) {
                $idx[$m->source] ??= $m->concept_id;
            } else {
                $idx[$m->source][$m->ref] ??= $m->concept_id;
            }
        }

        return $idx;
    }

    /** Datos de cada concepto (tipo, fijo, nombre, código, orden) por id. */
    public static function porId(): array
    {
        return DB::table('budget_concepts')->get(['id', 'code', 'name', 'concept_type', 'behavior', 'sort_order', 'is_group', 'parent_id', 'status'])
            ->keyBy('id')->map(fn ($c) => (array) $c)->all();
    }
}
