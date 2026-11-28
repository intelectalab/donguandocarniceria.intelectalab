<?php

namespace App\Modulos\Gas\Services;

use App\Modulos\Plt\Services\CentrosCosto;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/** GAS-05 Categorías y GAS-06 Reglas de aprobación (permiso gas.category.manage). */
final class Configuracion
{
    public static function categorias(): array
    {
        $uso = DB::table('expenses')->whereNotNull('category_id')->where('status', '<>', 'VOIDED')->groupBy('category_id')->selectRaw('category_id, count(*) AS n')->pluck('n', 'category_id');

        return DB::table('expense_categories as c')->leftJoin('cost_centers as cc', 'cc.id', '=', 'c.default_cost_center_id')
            ->orderBy('c.category_group')->orderBy('c.name')->get(['c.*', 'cc.name as centro'])
            ->map(fn ($c) => (array) $c + ['grupo' => Base::GRUPOS[$c->category_group] ?? $c->category_group, 'area' => Base::AREAS[$c->default_area] ?? $c->default_area,
                'costo_reparto' => $c->delivery_cost_type ? (Base::COSTOS_REPARTO[$c->delivery_cost_type] ?? $c->delivery_cost_type) : null,
                'documento' => Base::DOCUMENTOS[$c->default_doc_type] ?? $c->default_doc_type, 'gastos' => (int) ($uso[$c->id] ?? 0)])->all();
    }

    public static function guardarCategoria(array $d, ?string $id = null): object
    {
        return DB::transaction(function () use ($d, $id) {
            $codigo = mb_strtoupper(trim((string) ($d['code'] ?? '')));
            $nombre = trim((string) ($d['name'] ?? ''));
            if ($codigo === '' || $nombre === '') {
                RuleError::fail('RN-GAS-03', 'La categoría lleva código y nombre.');
            }
            if (! preg_match('/^[A-Z0-9][A-Z0-9_-]{0,39}$/', $codigo)) {
                RuleError::fail('RN-GAS-03', 'El código va en mayúsculas, sin espacios (letras, números, guion).');
            }
            if (DB::table('expense_categories')->whereRaw('upper(code) = ?', [$codigo])->when($id, fn ($w) => $w->where('id', '<>', $id))->exists()) {
                RuleError::fail('RN-GAS-03', "Ya existe una categoría con el código {$codigo}.");
            }
            $grupo = (string) ($d['category_group'] ?? '');
            $area = (string) ($d['default_area'] ?? '');
            $doc = (string) ($d['default_doc_type'] ?? '');
            if (! isset(Base::GRUPOS[$grupo]) || ! isset(Base::AREAS[$area]) || ! isset(Base::DOCUMENTOS[$doc])) {
                RuleError::fail('RN-GAS-03', 'Elige el grupo, el área y el comprobante habitual.');
            }
            $costo = ($d['delivery_cost_type'] ?? null) ?: null;
            if ($grupo === 'DELIVERY' && ! $costo) {
                RuleError::fail('RN-GAS-12', 'Una categoría de reparto lleva el tipo de costo de reparto que alimenta Delivery.');
            }
            if ($costo && ! isset(Base::COSTOS_REPARTO[$costo])) {
                RuleError::fail('RN-GAS-12', 'El tipo de costo de reparto no es válido.');
            }
            if ($grupo !== 'DELIVERY') {
                $costo = null;
            }
            if (empty($d['default_cost_center_id'])) {
                RuleError::fail('RN-GAS-03', 'Elige el centro de costo por defecto.');
            }
            CentrosCosto::activo($d['default_cost_center_id']);
            $galones = ! empty($d['requires_gallons']);
            $fila = ['code' => $codigo, 'name' => mb_substr($nombre, 0, 80), 'category_group' => $grupo, 'default_area' => $area, 'delivery_cost_type' => $costo,
                'default_cost_center_id' => $d['default_cost_center_id'], 'default_doc_type' => $doc,
                'requires_vehicle' => ! empty($d['requires_vehicle']) || $galones || $costo === 'FUEL', 'requires_gallons' => $galones || $costo === 'FUEL',
                'requires_employee' => ! empty($d['requires_employee']), 'requires_supplier' => ! empty($d['requires_supplier']), 'requires_campaign' => ! empty($d['requires_campaign']),
                'status' => ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE', 'updated_at' => now()];
            if ($id) {
                if (! DB::table('expense_categories')->where('id', $id)->exists()) {
                    abort(404, 'No se encontró la categoría.');
                }
                DB::table('expense_categories')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('expense_categories')->insertGetId($fila, 'id');
            }

            return DB::table('expense_categories')->where('id', $id)->first();
        });
    }

    public static function reglas(): array
    {
        return DB::table('expense_approval_rules as r')->leftJoin('expense_categories as c', 'c.id', '=', 'r.category_id')
            ->leftJoin('establishments as l', 'l.id', '=', 'r.establishment_id')
            ->orderByRaw('r.category_id IS NOT NULL, r.establishment_id IS NOT NULL')->orderBy('r.min_amount')->orderBy('r.level')
            ->get(['r.*', 'c.name as categoria', 'l.name as local'])
            ->map(fn ($r) => ['id' => $r->id, 'min_amount' => (float) $r->min_amount, 'max_amount' => $r->max_amount !== null ? (float) $r->max_amount : null,
                'level' => (int) $r->level, 'nivel' => Base::NOMBRE_NIVEL[(int) $r->level] ?? '', 'permission_code' => $r->permission_code,
                'category_id' => $r->category_id, 'categoria' => $r->categoria, 'establishment_id' => $r->establishment_id, 'local' => $r->local,
                'status' => $r->status, 'note' => $r->note])->all();
    }

    public static function guardarRegla(array $d, ?string $id = null): object
    {
        return DB::transaction(function () use ($d, $id) {
            $nivel = (int) ($d['level'] ?? 0);
            if (! isset(Base::NIVELES[$nivel])) {
                RuleError::fail('RN-GAS-07', 'Elige el nivel (1, 2 o 3).');
            }
            if (! isset($d['min_amount']) || ! is_numeric($d['min_amount']) || (float) $d['min_amount'] < 0) {
                RuleError::fail('RN-GAS-07', 'El monto desde debe ser cero o más.');
            }
            $min = Base::r($d['min_amount']);
            $max = isset($d['max_amount']) && $d['max_amount'] !== '' && $d['max_amount'] !== null ? Base::r($d['max_amount']) : null;
            if ($max !== null && $max < $min) {
                RuleError::fail('RN-GAS-07', 'El monto hasta no puede ser menor que el monto desde.');
            }
            $cat = ($d['category_id'] ?? null) ?: null;
            $local = ($d['establishment_id'] ?? null) ?: null;
            if ($cat && ! DB::table('expense_categories')->where('id', $cat)->exists()) {
                RuleError::fail('RN-GAS-07', 'La categoría elegida no existe.');
            }
            if ($local && ! DB::table('establishments')->where('id', $local)->exists()) {
                RuleError::fail('RN-GAS-07', 'El local elegido no existe.');
            }
            $estado = ($d['status'] ?? 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
            if ($estado === 'ACTIVE') {
                // Dos reglas activas del mismo alcance no se cruzan en montos.
                $cruce = DB::table('expense_approval_rules')->where('status', 'ACTIVE')->when($id, fn ($w) => $w->where('id', '<>', $id))
                    ->where(fn ($w) => $cat ? $w->where('category_id', $cat) : $w->whereNull('category_id'))
                    ->where(fn ($w) => $local ? $w->where('establishment_id', $local) : $w->whereNull('establishment_id'))
                    ->where(fn ($w) => $w->whereNull('max_amount')->orWhere('max_amount', '>=', $min))
                    ->when($max !== null, fn ($w) => $w->where('min_amount', '<=', $max))->first(['min_amount', 'max_amount', 'level']);
                if ($cruce) {
                    RuleError::fail('RN-GAS-07', 'Se cruza con la regla de nivel '.$cruce->level.' ('.Base::soles((float) $cruce->min_amount).' a '
                        .($cruce->max_amount !== null ? Base::soles((float) $cruce->max_amount) : 'más').'). Ajusta los montos o desactiva esa regla.');
                }
            }
            $fila = ['min_amount' => $min, 'max_amount' => $max, 'level' => $nivel, 'permission_code' => Base::NIVELES[$nivel], 'category_id' => $cat,
                'establishment_id' => $local, 'status' => $estado, 'note' => trim((string) ($d['note'] ?? '')) !== '' ? mb_substr(trim((string) $d['note']), 0, 255) : null, 'updated_at' => now()];
            if ($id) {
                if (! DB::table('expense_approval_rules')->where('id', $id)->exists()) {
                    abort(404, 'No se encontró la regla.');
                }
                DB::table('expense_approval_rules')->where('id', $id)->update($fila);
            } else {
                $id = DB::table('expense_approval_rules')->insertGetId($fila, 'id');
            }

            return DB::table('expense_approval_rules')->where('id', $id)->first();
        });
    }
}
