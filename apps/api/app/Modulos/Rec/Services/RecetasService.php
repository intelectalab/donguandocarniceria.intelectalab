<?php

namespace App\Modulos\Rec\Services;

use App\Models\User;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * REC · Recetas y formulación. Dueño de recipes, recipe_versions, recipe_ingredients, recipe_steps,
 * recipe_control_points y food_additives: nadie más escribe esas tablas.
 *
 *  RN-REC-01  una sola versión APPROVED por receta; aprobar una nueva retira la anterior.
 *  RN-REC-02  aprueba quien tiene rec.version.approve y no creó la versión.
 *  RN-REC-03  una versión APPROVED o RETIRED no cambia (también lo impide la base).
 *  RN-REC-04  un ingrediente aditivo apunta a un aditivo del catálogo con código SIN.
 *  RN-REC-05  dosis = kg del aditivo / kg totales × 1 000 000 ≤ max_ppm; sin límite, aviso registrado.
 *  RN-REC-06  SAUSAGE, BROTH, JAM, LARD y CURED necesitan un punto crítico de temperatura o tiempo.
 *  RN-REC-07  alérgenos = unión de los de sus ingredientes y aditivos, fijados al aprobar.
 *  RN-REC-08  escalado lineal a 3 decimales.
 *  RN-REC-09  costo estándar por kg = Σ (kg × costo promedio vigente) / kg base de salida.
 *  RN-REC-10  sin vida útil no se aprueba.
 *  RN-REC-11  rendimiento = kg base / Σ kg × 100, entre 1 % y rec_max_yield_pct.
 *  RN-REC-12  punto de control con mínimo ≤ máximo y acción correctiva.
 */
final class RecetasService
{
    public const TIPOS = ['SAUSAGE', 'BROTH', 'JAM', 'LARD', 'CURED', 'PRESERVE', 'CUT_PACK', 'OTHER'];

    /** RN-REC-06: tipos cocidos o curados. */
    public const COCIDAS = ['SAUSAGE', 'BROTH', 'JAM', 'LARD', 'CURED'];

    public const CONSERVACION = ['CHILLED', 'FROZEN', 'AMBIENT'];

    public const VARIABLES = ['CORE_TEMP', 'TIME', 'PH', 'BRINE_PCT', 'BRIX', 'WATER_ACTIVITY', 'OTHER'];

    public const EQUIPOS = ['POT', 'STOVE', 'STUFFER', 'SEALER', 'GRINDER', 'SAW', 'SCALE', 'SMOKER', 'COLD_ROOM', 'ROASTER', 'OTHER'];

    public const FUNCIONES = ['PRESERVATIVE', 'ANTIOXIDANT', 'COLOR', 'FLAVOR_ENHANCER', 'THICKENER', 'GELLING', 'ACIDITY_REGULATOR', 'STABILIZER', 'EMULSIFIER', 'SEQUESTRANT', 'OTHER'];

    private const ESTADO = ['DRAFT' => 'en borrador', 'IN_REVIEW' => 'en revisión', 'APPROVED' => 'aprobada', 'RETIRED' => 'retirada'];

    private const TIPO = ['SAUSAGE' => 'embutido', 'BROTH' => 'caldo', 'JAM' => 'mermelada', 'LARD' => 'manteca', 'CURED' => 'curado y ahumado',
        'PRESERVE' => 'conserva', 'CUT_PACK' => 'corte envasado', 'OTHER' => 'otro'];

    /* ================================================================ recetas y versiones */

    /**
     * REC-01 Nueva receta: crea la receta y su versión 1 en borrador.
     *
     * @param  array{product_id: string, code: string, name: string, recipe_type: string, line_code?: ?string, output_variant_id?: ?string, base_output_kg: mixed}  $d
     */
    public static function crearReceta(array $d, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($d, $quien) {
            $p = DB::table('products')->where('id', $d['product_id'] ?? null)->first() ?? RuleError::fail('RN-REC-03', 'Elige el producto terminado.');
            self::marcaEnAlcance($quien, $p->brand_id);
            $codigo = strtoupper(trim((string) ($d['code'] ?? '')));
            if ($codigo === '' || trim((string) ($d['name'] ?? '')) === '') {
                RuleError::fail('RN-REC-03', 'La receta necesita código y nombre.');
            }
            if (DB::table('recipes')->where('code', $codigo)->exists()) {
                RuleError::fail('RN-REC-03', "Ya existe una receta con el código {$codigo}.");
            }
            if (! in_array($d['recipe_type'] ?? '', self::TIPOS, true)) {
                RuleError::fail('RN-REC-06', 'Elige el tipo de receta.');
            }
            $base = self::kg($d['base_output_kg'] ?? null, 3);
            if ($base <= 0) {
                RuleError::fail('RN-REC-11', 'Los kg base de salida deben ser mayores que cero.');
            }
            $salida = $d['output_variant_id'] ?? null;
            if ($salida && ! DB::table('product_variants')->where('id', $salida)->where('product_id', $p->id)->exists()) {
                RuleError::fail('RN-REC-03', 'La presentación de salida debe ser del mismo producto.');
            }
            $salida ??= DB::table('product_variants')->where('product_id', $p->id)->orderBy('sku')->value('id');
            $id = DB::table('recipes')->insertGetId([
                'product_id' => $p->id, 'code' => $codigo, 'name' => trim($d['name']), 'recipe_type' => $d['recipe_type'], 'brand_id' => $p->brand_id,
                'status' => 'ACTIVE', 'output_variant_id' => $salida, 'line_code' => ($d['line_code'] ?? null) ?: null,
            ], 'id');
            $vid = DB::table('recipe_versions')->insertGetId([
                'recipe_id' => $id, 'version' => 1, 'base_output_kg' => $base, 'shelf_life_days' => $p->shelf_life_days ?: null,
                'storage' => in_array($p->storage, self::CONSERVACION, true) ? $p->storage : 'CHILLED', 'allergens' => '[]', 'status' => 'DRAFT',
                'notes' => null, 'packaging' => '[]', 'created_by' => $quien->id, 'history' => json_encode([self::hito('Creación', $quien)]),
            ], 'id');

            return (object) ['recipe' => self::receta($id), 'version' => self::version($vid)];
        }));
    }

    /** Cambia nombre, línea, presentación de salida o estado de la receta (no su contenido: eso va por versión). */
    public static function editarReceta(string $id, array $d, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $r = self::receta($id);
            self::marcaEnAlcance($quien, $r->brand_id);
            $fila = [];
            if (isset($d['name'])) {
                trim((string) $d['name']) !== '' || RuleError::fail('RN-REC-03', 'La receta necesita nombre.');
                $fila['name'] = trim($d['name']);
            }
            if (array_key_exists('line_code', $d)) {
                $fila['line_code'] = $d['line_code'] ?: null;
            }
            if (! empty($d['output_variant_id'])) {
                DB::table('product_variants')->where('id', $d['output_variant_id'])->where('product_id', $r->product_id)->exists()
                    || RuleError::fail('RN-REC-03', 'La presentación de salida debe ser del mismo producto.');
                $fila['output_variant_id'] = $d['output_variant_id'];
            }
            if (isset($d['recipe_type'])) {
                in_array($d['recipe_type'], self::TIPOS, true) || RuleError::fail('RN-REC-06', 'Tipo de receta no válido.');
                $fila['recipe_type'] = $d['recipe_type'];
            }
            if (isset($d['status'])) {
                in_array($d['status'], ['ACTIVE', 'INACTIVE'], true) || RuleError::fail('RN-REC-03', 'Estado no válido.');
                $fila['status'] = $d['status'];
            }
            if ($fila) {
                DB::table('recipes')->where('id', $id)->update($fila + ['updated_at' => now()]);
            }

            return self::receta($id);
        }));
    }

    /**
     * Versión nueva en borrador, copiada de $desde (o de la vigente, o de la última). RN-REC-03: cambiar
     * una receta aprobada es crear una versión nueva. Solo una versión en curso por receta.
     */
    public static function nuevaVersion(string $recipeId, ?string $desde, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($recipeId, $desde, $quien) {
            $r = DB::table('recipes')->where('id', $recipeId)->lockForUpdate()->first() ?? RuleError::fail('RN-REC-03', 'Receta no encontrada.');
            self::marcaEnAlcance($quien, $r->brand_id);
            $enCurso = DB::table('recipe_versions')->where('recipe_id', $r->id)->whereIn('status', ['DRAFT', 'IN_REVIEW'])->first();
            if ($enCurso) {
                RuleError::fail('RN-REC-03', "«{$r->name}» ya tiene la versión {$enCurso->version} ".self::ESTADO[$enCurso->status].': termínala antes de crear otra.');
            }
            $src = $desde
                ? (DB::table('recipe_versions')->where('id', $desde)->where('recipe_id', $r->id)->first() ?? RuleError::fail('RN-REC-03', 'La versión de origen no es de esta receta.'))
                : (DB::table('recipe_versions')->where('recipe_id', $r->id)->where('status', 'APPROVED')->first()
                    ?? DB::table('recipe_versions')->where('recipe_id', $r->id)->orderByDesc('version')->first());
            $n = (int) DB::table('recipe_versions')->where('recipe_id', $r->id)->max('version') + 1;
            $vid = DB::table('recipe_versions')->insertGetId([
                'recipe_id' => $r->id, 'version' => $n, 'base_output_kg' => $src->base_output_kg ?? 10, 'shelf_life_days' => $src->shelf_life_days ?? null,
                'storage' => $src->storage ?? 'CHILLED', 'allergens' => '[]', 'status' => 'DRAFT', 'notes' => $src ? "Copia de la versión {$src->version}." : null,
                'packaging' => $src->packaging ?? '[]', 'created_by' => $quien->id,
                'history' => json_encode([self::hito('Creación', $quien, $src ? "Copia de la versión {$src->version}" : null)]),
            ], 'id');
            if ($src) {
                $cols = ['ingredients' => ['seq', 'variant_id', 'qty_kg', 'weighing_tolerance_pct', 'is_additive', 'additive_id', 'allergen'],
                    'steps' => ['seq', 'description', 'duration_min', 'equipment_category'],
                    'control_points' => ['step_seq', 'code', 'variable', 'min_value', 'max_value', 'unit', 'is_critical', 'corrective_action']];
                foreach ($cols as $t => $c) {
                    $lista = implode(', ', $c);
                    DB::statement("INSERT INTO recipe_{$t} (version_id, {$lista}) SELECT ?, {$lista} FROM recipe_{$t} WHERE version_id = ?", [$vid, $src->id]);
                }
            }

            return self::version($vid);
        }));
    }

    /** REC-02: kg base de salida, vida útil, conservación, notas y empaques. Solo en borrador. */
    public static function guardarVersion(string $id, array $d, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($id, $d, $quien) {
            $v = self::borrador($id, $quien);
            $fila = [];
            if (array_key_exists('base_output_kg', $d)) {
                $fila['base_output_kg'] = self::kg($d['base_output_kg'], 3);
                $fila['base_output_kg'] > 0 || RuleError::fail('RN-REC-11', 'Los kg base de salida deben ser mayores que cero.');
            }
            if (array_key_exists('shelf_life_days', $d)) {
                $dias = $d['shelf_life_days'] === null || $d['shelf_life_days'] === '' ? null : (int) $d['shelf_life_days'];
                $dias === null || $dias > 0 || RuleError::fail('RN-REC-10', 'La vida útil debe ser de 1 día o más.');
                $fila['shelf_life_days'] = $dias;
            }
            if (array_key_exists('storage', $d)) {
                in_array($d['storage'], self::CONSERVACION, true) || RuleError::fail('RN-REC-10', 'Elige la conservación.');
                $fila['storage'] = $d['storage'];
            }
            if (array_key_exists('notes', $d)) {
                $fila['notes'] = trim((string) $d['notes']) ?: null;
            }
            if (array_key_exists('packaging', $d)) {
                $fila['packaging'] = json_encode(self::empaques((array) $d['packaging']));
            }
            if ($fila) {
                DB::table('recipe_versions')->where('id', $v->id)->update($fila + ['updated_at' => now()]);
            }

            return self::version($v->id);
        }));
    }

    /** Borra una versión en borrador que nunca se aprobó (con sus filas). */
    public static function borrarBorrador(string $id, User $quien): void
    {
        self::editor($quien);
        self::base(fn () => DB::transaction(function () use ($id, $quien) {
            $v = self::borrador($id, $quien);
            foreach (['recipe_ingredients', 'recipe_steps', 'recipe_control_points'] as $t) {
                DB::table($t)->where('version_id', $v->id)->delete();
            }
            DB::table('recipe_versions')->where('id', $v->id)->delete();
        }));
    }

    /** REC-02: enviar a revisión. Avisa a Calidad. */
    public static function enviar(string $id, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($id, $quien) {
            $v = self::borrador($id, $quien);
            if (! DB::table('recipe_ingredients')->where('version_id', $v->id)->exists()) {
                RuleError::fail('RN-REC-11', 'Agrega ingredientes antes de enviar a revisión.');
            }
            DB::table('recipe_versions')->where('id', $v->id)->update([
                'status' => 'IN_REVIEW', 'submitted_at' => now(), 'submitted_by' => $quien->id, 'expected_yield_pct' => self::rendimiento($v->id),
                'history' => self::conHito($v, self::hito('Enviada a revisión', $quien)), 'updated_at' => now(),
            ]);
            $r = self::receta($v->recipe_id);
            self::avisar(['role' => 'CALIDAD'], "Receta por aprobar: {$r->name} v{$v->version}", 'Revisa aditivos, puntos de control y vida útil en Revisión y aprobación.', $v->id, 'info');
            Events::emit('recipe_version.submitted', 'recipe_versions', $v->id, ['recipe_id' => $r->id, 'version' => $v->version]);

            return self::version($v->id);
        }));
    }

    /** REC-07: devolver a borrador con comentario (quien edita o quien aprueba). */
    public static function devolver(string $id, string $comentario, User $quien): object
    {
        if (! Access::can($quien, 'rec.version.edit') && ! Access::can($quien, 'rec.version.approve')) {
            RuleError::fail('RN-REC-02', 'Devuelve una versión quien edita recetas o quien las aprueba.');
        }
        if (mb_strlen(trim($comentario)) < 5) {
            RuleError::fail('RN-REC-03', 'Escribe qué debe corregirse.');
        }

        return self::base(fn () => DB::transaction(function () use ($id, $comentario, $quien) {
            $v = self::bloquear($id);
            $v->status === 'IN_REVIEW' || RuleError::fail('RN-REC-03', 'Solo una versión en revisión vuelve a borrador.');
            DB::table('recipe_versions')->where('id', $v->id)->update([
                'status' => 'DRAFT', 'history' => self::conHito($v, self::hito('Devuelta a borrador', $quien, trim($comentario))), 'updated_at' => now(),
            ]);
            $r = self::receta($v->recipe_id);
            self::avisar(['user_id' => $v->created_by], "Receta devuelta: {$r->name} v{$v->version}", trim($comentario), $v->id, 'warn');

            return self::version($v->id);
        }));
    }

    /**
     * REC-07: aprobar. RN-REC-02 (permiso y no ser el autor), validaciones (RN-REC-04 a 06 y 10 a 12),
     * fija alérgenos (RN-REC-07), rendimiento (RN-REC-11) y costo estándar (RN-REC-09), y retira la
     * versión vigente (RN-REC-01). Las advertencias (RN-REC-05 sin límite) quedan registradas.
     */
    public static function aprobar(string $id, User $quien): object
    {
        if (! Access::can($quien, 'rec.version.approve')) {
            RuleError::fail('RN-REC-02', 'Aprueba un usuario con el permiso de aprobar recetas (Calidad o Gerencia).');
        }

        return self::base(fn () => DB::transaction(function () use ($id, $quien) {
            $v = self::bloquear($id);
            $r = DB::table('recipes')->where('id', $v->recipe_id)->lockForUpdate()->first();
            self::marcaEnAlcance($quien, $r->brand_id);
            if ($v->created_by === $quien->id) {
                $autor = DB::table('users')->where('id', $v->created_by)->value('name');
                RuleError::fail('RN-REC-02', "Quien creó la versión ({$autor}) no la aprueba: la aprueba otra persona con el permiso de aprobar recetas.");
            }
            in_array($v->status, ['DRAFT', 'IN_REVIEW'], true) || RuleError::fail('RN-REC-03', "La versión {$v->version} ya está ".self::ESTADO[$v->status].'.');
            $checks = self::validar($v->id);
            foreach ($checks as $c) {
                if ($c['level'] === 'error') {
                    RuleError::fail($c['code'], $c['msg']);
                }
            }
            $avisos = array_values(array_map(fn ($c) => "{$c['code']}: {$c['msg']}", array_filter($checks, fn ($c) => $c['level'] === 'warn')));
            $anterior = DB::table('recipe_versions')->where('recipe_id', $r->id)->where('status', 'APPROVED')->where('id', '<>', $v->id)->first();
            if ($anterior) {
                DB::table('recipe_versions')->where('id', $anterior->id)->update([
                    'status' => 'RETIRED', 'retired_at' => now(), 'retired_by' => $quien->id,
                    'history' => self::conHito($anterior, self::hito('Retirada', $quien, "Reemplazada por la versión {$v->version}")), 'updated_at' => now(),
                ]);
            }
            $costo = self::costo($v->id);
            DB::table('recipe_versions')->where('id', $v->id)->update([
                'status' => 'APPROVED', 'approved_by' => $quien->id, 'approved_at' => now(), 'allergens' => json_encode(self::alergenos($v->id), JSON_UNESCAPED_UNICODE),
                'standard_cost_per_kg' => $costo['per_kg'], 'expected_yield_pct' => self::rendimiento($v->id), 'approval_warnings' => $avisos ? implode("\n", $avisos) : null,
                'recalc_cost_per_kg' => null, 'recalc_at' => null,
                'history' => self::conHito($v, self::hito('Aprobación', $quien, $avisos ? count($avisos).' advertencia(s)' : 'Sin advertencias')), 'updated_at' => now(),
            ]);
            Events::emit('recipe_version.approved', 'recipe_versions', $v->id, ['recipe_id' => $r->id, 'version' => $v->version,
                'previous_version_id' => $anterior?->id, 'allergens' => self::alergenos($v->id)]);

            return self::version($v->id);
        }));
    }

    /* ================================================================ ingredientes, pasos y puntos de control */

    /**
     * REC-03: agrega o edita un ingrediente de una versión en borrador.
     *
     * @param  array{variant_id: string, qty_kg: mixed, weighing_tolerance_pct?: mixed, is_additive?: bool, additive_id?: ?string, allergen?: ?string, seq?: ?int}  $d
     */
    public static function guardarIngrediente(string $versionId, array $d, ?string $id, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($versionId, $d, $id, $quien) {
            $v = self::borrador($versionId, $quien);
            $actual = $id ? (DB::table('recipe_ingredients')->where('id', $id)->where('version_id', $v->id)->first() ?? RuleError::fail('RN-REC-03', 'Ingrediente no encontrado.')) : null;
            $variante = DB::table('product_variants')->where('id', $d['variant_id'] ?? $actual?->variant_id)->first() ?? RuleError::fail('RN-REC-04', 'Elige el producto o insumo.');
            $kg = self::kg($d['qty_kg'] ?? $actual?->qty_kg, 4);
            $kg > 0 || RuleError::fail('RN-REC-11', 'Los kg por lote base deben ser mayores que cero.');
            $tol = isset($d['weighing_tolerance_pct']) && $d['weighing_tolerance_pct'] !== '' ? round((float) $d['weighing_tolerance_pct'], 2) : (float) ($actual->weighing_tolerance_pct ?? 2);
            ($tol >= 0 && $tol <= 100) || RuleError::fail('RN-REC-11', 'La tolerancia de pesaje va de 0 % a 100 %.');
            $esAditivo = (bool) ($d['is_additive'] ?? false);
            $aditivo = null;
            if ($esAditivo) {
                $aditivo = ! empty($d['additive_id']) ? DB::table('food_additives')->where('id', $d['additive_id'])->first() : null;
                if (! $aditivo || trim((string) $aditivo->sin_code) === '') {
                    RuleError::fail('RN-REC-04', 'Un ingrediente marcado como aditivo exige un aditivo del catálogo con código SIN.');
                }
                $aditivo->status === 'ACTIVE' || ($actual && $actual->additive_id === $aditivo->id) || RuleError::fail('RN-REC-04', "El aditivo {$aditivo->name} está inactivo.");
            }
            $fila = ['variant_id' => $variante->id, 'qty_kg' => $kg, 'weighing_tolerance_pct' => $tol, 'is_additive' => $esAditivo,
                'additive_id' => $aditivo?->id, 'allergen' => self::texto($d['allergen'] ?? null, 20)];
            if ($actual) {
                DB::table('recipe_ingredients')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);

                return DB::table('recipe_ingredients')->find($actual->id);
            }
            $seq = ! empty($d['seq']) ? (int) $d['seq'] : (int) DB::table('recipe_ingredients')->where('version_id', $v->id)->max('seq') + 1;
            $nuevo = DB::table('recipe_ingredients')->insertGetId($fila + ['version_id' => $v->id, 'seq' => $seq], 'id');

            return DB::table('recipe_ingredients')->find($nuevo);
        }));
    }

    /** REC-05: agrega o edita un paso. */
    public static function guardarPaso(string $versionId, array $d, ?string $id, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($versionId, $d, $id, $quien) {
            $v = self::borrador($versionId, $quien);
            $actual = $id ? (DB::table('recipe_steps')->where('id', $id)->where('version_id', $v->id)->first() ?? RuleError::fail('RN-REC-03', 'Paso no encontrado.')) : null;
            $desc = trim((string) ($d['description'] ?? $actual?->description ?? ''));
            $desc !== '' || RuleError::fail('RN-REC-12', 'Describe el paso.');
            $min = array_key_exists('duration_min', $d) ? ($d['duration_min'] === null || $d['duration_min'] === '' ? null : round((float) $d['duration_min'], 2)) : $actual?->duration_min;
            $min === null || $min >= 0 || RuleError::fail('RN-REC-12', 'El tiempo no puede ser negativo.');
            $eq = $d['equipment_category'] ?? $actual?->equipment_category;
            $eq === null || $eq === '' || in_array($eq, self::EQUIPOS, true) || RuleError::fail('RN-REC-12', 'Categoría de equipo no válida.');
            $fila = ['description' => $desc, 'duration_min' => $min, 'equipment_category' => $eq ?: null];
            if ($actual) {
                DB::table('recipe_steps')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);

                return DB::table('recipe_steps')->find($actual->id);
            }
            $seq = (int) DB::table('recipe_steps')->where('version_id', $v->id)->max('seq') + 1;

            return DB::table('recipe_steps')->find(DB::table('recipe_steps')->insertGetId($fila + ['version_id' => $v->id, 'seq' => $seq], 'id'));
        }));
    }

    /** REC-05: sube (-1) o baja (+1) un paso. Los puntos de control siguen a su paso. */
    public static function moverPaso(string $id, int $dir, User $quien): void
    {
        self::editor($quien);
        self::base(fn () => DB::transaction(function () use ($id, $dir, $quien) {
            $s = DB::table('recipe_steps')->where('id', $id)->first() ?? RuleError::fail('RN-REC-03', 'Paso no encontrado.');
            $v = self::borrador($s->version_id, $quien);
            $otro = DB::table('recipe_steps')->where('version_id', $v->id)->where('seq', $dir < 0 ? '<' : '>', $s->seq)->orderBy('seq', $dir < 0 ? 'desc' : 'asc')->first();
            if (! $otro) {
                return;
            }
            DB::table('recipe_steps')->where('id', $s->id)->update(['seq' => $otro->seq, 'updated_at' => now()]);
            DB::table('recipe_steps')->where('id', $otro->id)->update(['seq' => $s->seq, 'updated_at' => now()]);
            DB::table('recipe_control_points')->where('version_id', $v->id)->whereIn('step_seq', [$s->seq, $otro->seq])
                ->update(['step_seq' => DB::raw("CASE WHEN step_seq = {$s->seq} THEN {$otro->seq} ELSE {$s->seq} END"), 'updated_at' => now()]);
        }));
    }

    /** REC-06: agrega o edita un punto de control (RN-REC-12). */
    public static function guardarPunto(string $versionId, array $d, ?string $id, User $quien): object
    {
        self::editor($quien);

        return self::base(fn () => DB::transaction(function () use ($versionId, $d, $id, $quien) {
            $v = self::borrador($versionId, $quien);
            $actual = $id ? (DB::table('recipe_control_points')->where('id', $id)->where('version_id', $v->id)->first() ?? RuleError::fail('RN-REC-03', 'Punto de control no encontrado.')) : null;
            $d += (array) ($actual ?? []);
            $codigo = strtoupper(trim((string) ($d['code'] ?? '')));
            $codigo !== '' || RuleError::fail('RN-REC-12', 'El punto de control necesita código (PC1, PC2…).');
            if (DB::table('recipe_control_points')->where('version_id', $v->id)->where('code', $codigo)->when($actual, fn ($q) => $q->where('id', '<>', $actual->id))->exists()) {
                RuleError::fail('RN-REC-12', "La versión ya tiene un punto {$codigo}.");
            }
            in_array($d['variable'] ?? '', self::VARIABLES, true) || RuleError::fail('RN-REC-12', 'Elige la variable que se controla.');
            if (! is_numeric($d['min_value'] ?? null) || ! is_numeric($d['max_value'] ?? null)) {
                RuleError::fail('RN-REC-12', 'Escribe el mínimo y el máximo del rango.');
            }
            $min = round((float) $d['min_value'], 3);
            $max = round((float) $d['max_value'], 3);
            $min <= $max || RuleError::fail('RN-REC-12', "El mínimo ({$min}) no puede ser mayor que el máximo ({$max}).");
            trim((string) ($d['unit'] ?? '')) !== '' || RuleError::fail('RN-REC-12', 'Escribe la unidad (°C, min, h, pH…).');
            $accion = trim((string) ($d['corrective_action'] ?? ''));
            $accion !== '' || RuleError::fail('RN-REC-12', 'Escribe la acción correctiva del punto de control.');
            $paso = (int) ($d['step_seq'] ?? 0);
            if ($paso && ! DB::table('recipe_steps')->where('version_id', $v->id)->where('seq', $paso)->exists()) {
                RuleError::fail('RN-REC-12', "La versión no tiene el paso {$paso}.");
            }
            $fila = ['code' => $codigo, 'variable' => $d['variable'], 'min_value' => $min, 'max_value' => $max, 'unit' => mb_substr(trim($d['unit']), 0, 20),
                'is_critical' => (bool) ($d['is_critical'] ?? false), 'corrective_action' => mb_substr($accion, 0, 255), 'step_seq' => $paso];
            if ($actual) {
                DB::table('recipe_control_points')->where('id', $actual->id)->update($fila + ['updated_at' => now()]);

                return DB::table('recipe_control_points')->find($actual->id);
            }

            return DB::table('recipe_control_points')->find(DB::table('recipe_control_points')->insertGetId($fila + ['version_id' => $v->id], 'id'));
        }));
    }

    /** Quita un ingrediente, paso o punto de control de una versión en borrador. */
    public static function quitar(string $tabla, string $id, User $quien): void
    {
        self::editor($quien);
        $t = ['ingredientes' => 'recipe_ingredients', 'pasos' => 'recipe_steps', 'puntos' => 'recipe_control_points'][$tabla] ?? RuleError::fail('RN-REC-03', 'No encontrado.');
        self::base(fn () => DB::transaction(function () use ($t, $id, $quien) {
            $fila = DB::table($t)->where('id', $id)->first() ?? RuleError::fail('RN-REC-03', 'No encontrado.');
            $v = self::borrador($fila->version_id, $quien);
            DB::table($t)->where('id', $fila->id)->delete();
            if ($t === 'recipe_steps') {
                // El paso quitado deja huérfanos a sus puntos de control: quedan sin paso (0) y se reenumeran los demás.
                DB::table('recipe_control_points')->where('version_id', $v->id)->where('step_seq', $fila->seq)->update(['step_seq' => 0]);
                DB::table('recipe_control_points')->where('version_id', $v->id)->where('step_seq', '>', $fila->seq)->update(['step_seq' => DB::raw('step_seq - 1')]);
                DB::table('recipe_steps')->where('version_id', $v->id)->where('seq', '>', $fila->seq)->update(['seq' => DB::raw('seq - 1')]);
            }
        }));
    }

    /* ================================================================ aditivos (REC-04) */

    /** Crea o edita un aditivo. Los límites los carga Calidad con su fuente (D-REC-01). */
    public static function guardarAditivo(array $d, ?string $id, User $quien): object
    {
        if (! Access::can($quien, 'rec.version.approve') && ! Access::can($quien, 'rec.version.edit')) {
            RuleError::fail('RN-REC-04', 'El catálogo de aditivos lo editan Calidad y el jefe de producción.');
        }

        return self::base(fn () => DB::transaction(function () use ($d, $id) {
            $sin = trim((string) ($d['sin_code'] ?? ''));
            preg_match('/^[0-9]{3,4}[a-z]?(\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\))?$/', $sin)
                || RuleError::fail('RN-REC-04', 'Código SIN no válido: 3 o 4 dígitos, una letra opcional y un numeral romano entre paréntesis, como 451(i).');
            if (DB::table('food_additives')->where('sin_code', $sin)->when($id, fn ($q) => $q->where('id', '<>', $id))->exists()) {
                RuleError::fail('RN-REC-04', "El código SIN {$sin} ya está en el catálogo.");
            }
            trim((string) ($d['name'] ?? '')) !== '' || RuleError::fail('RN-REC-04', 'Escribe el nombre del aditivo.');
            in_array($d['function_class'] ?? '', self::FUNCIONES, true) || RuleError::fail('RN-REC-04', 'Elige la función del aditivo.');
            $max = isset($d['max_ppm']) && $d['max_ppm'] !== '' && $d['max_ppm'] !== null ? round((float) $d['max_ppm'], 2) : null;
            $max === null || $max > 0 || RuleError::fail('RN-REC-05', 'El límite debe ser mayor que 0 o quedar vacío.');
            $fuente = self::texto($d['max_ppm_source'] ?? null, 255);
            $max === null || $fuente !== null || RuleError::fail('RN-REC-05', 'Indica la norma de la que sale el límite.');
            $variante = ($d['variant_id'] ?? null) ?: null;
            $variante === null || DB::table('product_variants')->where('id', $variante)->exists() || RuleError::fail('RN-REC-04', 'Insumo no encontrado.');
            $fila = ['sin_code' => $sin, 'name' => mb_substr(trim($d['name']), 0, 80), 'function_class' => $d['function_class'], 'max_ppm' => $max,
                'max_ppm_source' => $max === null ? null : $fuente, 'allergen' => self::texto($d['allergen'] ?? null, 20), 'variant_id' => $variante,
                'status' => in_array($d['status'] ?? 'ACTIVE', ['ACTIVE', 'INACTIVE'], true) ? ($d['status'] ?? 'ACTIVE') : 'ACTIVE'];
            if ($id) {
                DB::table('food_additives')->where('id', $id)->update($fila + ['updated_at' => now()]) ?: RuleError::fail('RN-REC-04', 'Aditivo no encontrado.');
            } else {
                $id = DB::table('food_additives')->insertGetId($fila, 'id');
            }

            return DB::table('food_additives')->find($id);
        }));
    }

    /* ================================================================ cálculos (contrato para PRO, CAL y CAT) */

    /** Versión aprobada (vigente) de una receta, o null. La usa PRO al crear una orden. */
    public static function vigente(string $recipeId): ?object
    {
        return DB::table('recipe_versions')->where('recipe_id', $recipeId)->where('status', 'APPROVED')->first();
    }

    /**
     * RN-REC-08 Escalado (REC-08, PRO-05): factor = kg deseados / kg base; cada ingrediente = kg base × factor a 3 decimales.
     *
     * @return array{version_id: string, recipe_id: string, version: int, base_output_kg: string, target_kg: string, factor: string,
     *               lines: list<array{seq: int, variant_id: string, sku: string, name: string, base_kg: string, kg: string, tolerance_pct: string, tolerance_kg: string, is_additive: bool}>,
     *               packaging: list<array{variant_id: string, per: string, qty: string}>, total_kg: string}
     */
    public static function escalar(string $versionId, mixed $kgDeseados): array
    {
        $v = DB::table('recipe_versions')->where('id', $versionId)->first() ?? RuleError::fail('RN-REC-08', 'Versión no encontrada.');
        $kg = self::kg($kgDeseados, 3);
        $kg > 0 || RuleError::fail('RN-REC-08', 'Los kg deseados deben ser mayores que cero.');
        $factor = $kg / (float) $v->base_output_kg;
        $lineas = self::ingredientes($v->id)->map(function ($i) use ($factor) {
            $esc = round((float) $i->qty_kg * $factor, 3);

            return ['seq' => (int) $i->seq, 'variant_id' => $i->variant_id, 'sku' => $i->sku, 'name' => $i->variant_name, 'base_kg' => self::t($i->qty_kg, 4),
                'kg' => self::t($esc, 3), 'tolerance_pct' => self::t($i->weighing_tolerance_pct, 2), 'tolerance_kg' => self::t($esc * (float) $i->weighing_tolerance_pct / 100, 3),
                'is_additive' => (bool) $i->is_additive];
        })->values()->all();
        $empaques = array_map(fn ($p) => ['variant_id' => $p['variant_id'], 'per' => $p['per'],
            'qty' => self::t(($p['per'] ?? 'KG') === 'KG' ? (float) $p['qty'] * $kg : (float) $p['qty'], 3)], json_decode($v->packaging ?? '[]', true) ?: []);

        return ['version_id' => $v->id, 'recipe_id' => $v->recipe_id, 'version' => (int) $v->version, 'base_output_kg' => self::t($v->base_output_kg, 3),
            'target_kg' => self::t($kg, 3), 'factor' => self::t($factor, 6), 'lines' => $lineas, 'packaging' => $empaques,
            'total_kg' => self::t(array_sum(array_map(fn ($l) => (float) $l['kg'], $lineas)), 3)];
    }

    /**
     * RN-REC-09: costo estándar con el costo promedio vigente de cada insumo (saldos de ALM con stock;
     * sin stock, el costo estándar de la variante). $costos fija el costo de algunas variantes (simulación).
     *
     * @param  array<string, mixed>  $costos
     * @return array{rows: list<array>, total: string, per_kg: ?string}
     */
    public static function costo(string $versionId, array $costos = []): array
    {
        $v = DB::table('recipe_versions')->where('id', $versionId)->first() ?? RuleError::fail('RN-REC-09', 'Versión no encontrada.');
        $ins = self::ingredientes($v->id);
        $prom = self::costoPromedio($ins->pluck('variant_id')->unique()->values()->all());
        $total = 0.0;
        $filas = [];
        foreach ($ins as $i) {
            $c = array_key_exists($i->variant_id, $costos) ? (float) $costos[$i->variant_id] : ($prom[$i->variant_id] ?? (float) $i->std_cost);
            $imp = round((float) $i->qty_kg * $c, 4);
            $total += $imp;
            $filas[] = ['id' => $i->id, 'seq' => (int) $i->seq, 'variant_id' => $i->variant_id, 'sku' => $i->sku, 'name' => $i->variant_name, 'qty_kg' => self::t($i->qty_kg, 4),
                'cost' => self::t($c, 4), 'amount' => self::t($imp, 4), 'source' => array_key_exists($i->variant_id, $costos) ? 'GIVEN' : (isset($prom[$i->variant_id]) ? 'AVERAGE' : 'STANDARD')];
        }

        return ['rows' => $filas, 'total' => self::t($total, 2), 'per_kg' => (float) $v->base_output_kg > 0 ? self::t($total / (float) $v->base_output_kg, 4) : null];
    }

    /** RN-REC-11: kg base / Σ kg × 100, a 2 decimales (null sin ingredientes). */
    public static function rendimiento(string $versionId): ?float
    {
        $total = self::totalKg($versionId);
        $base = (float) DB::table('recipe_versions')->where('id', $versionId)->value('base_output_kg');

        return $total > 0 ? round($base / $total * 100, 2) : null;
    }

    public static function totalKg(string $versionId): float
    {
        return round((float) DB::table('recipe_ingredients')->where('version_id', $versionId)->sum('qty_kg'), 4);
    }

    /** RN-REC-07: unión ordenada de los alérgenos de ingredientes y aditivos. */
    public static function alergenos(string $versionId): array
    {
        $a = DB::table('recipe_ingredients as i')->leftJoin('food_additives as f', 'f.id', '=', 'i.additive_id')->where('i.version_id', $versionId)
            ->get(['i.allergen', 'f.allergen as additive_allergen'])
            ->flatMap(fn ($x) => [$x->allergen, $x->additive_allergen])->map(fn ($x) => trim((string) $x))->filter()->unique()->sort(SORT_LOCALE_STRING)->values()->all();

        return $a;
    }

    /** Dosis de un aditivo en ppm: kg / kg totales × 1 000 000 (RN-REC-05), a 1 decimal. */
    public static function ppm(float $kg, float $total): float
    {
        return $total > 0 ? round($kg / $total * 1_000_000, 1) : 0.0;
    }

    /**
     * Validaciones de aprobación (REC-07): [{code, level: ok|warn|error, msg}].
     * Las de nivel error bloquean la aprobación; las warn quedan registradas.
     */
    public static function validar(string $versionId): array
    {
        $v = DB::table('recipe_versions')->where('id', $versionId)->first() ?? RuleError::fail('RN-REC-03', 'Versión no encontrada.');
        $r = DB::table('recipes')->where('id', $v->recipe_id)->first();
        $ins = self::ingredientes($v->id);
        $total = (float) $ins->sum(fn ($i) => (float) $i->qty_kg);
        $out = [];
        $out[] = $ins->count()
            ? ['code' => 'RN-REC-11', 'level' => 'ok', 'msg' => $ins->count().' ingredientes, '.self::n($total, 4).' kg por lote base.']
            : ['code' => 'RN-REC-11', 'level' => 'error', 'msg' => 'La versión no tiene ingredientes.'];
        $out[] = (int) $v->shelf_life_days > 0
            ? ['code' => 'RN-REC-10', 'level' => 'ok', 'msg' => "Vida útil de {$v->shelf_life_days} días."]
            : ['code' => 'RN-REC-10', 'level' => 'error', 'msg' => 'Una versión sin vida útil en días no se aprueba: escríbela en el editor de la versión.'];
        foreach ($ins->where('is_additive', true) as $i) {
            if (! $i->additive_id || trim((string) $i->sin_code) === '') {
                $out[] = ['code' => 'RN-REC-04', 'level' => 'error', 'msg' => "{$i->variant_name} está marcado como aditivo y no tiene un aditivo del catálogo con código SIN."];

                continue;
            }
            $d = self::ppm((float) $i->qty_kg, $total);
            $nombre = "{$i->additive_name} (SIN {$i->sin_code})";
            if ($i->max_ppm !== null) {
                $out[] = $d > (float) $i->max_ppm
                    ? ['code' => 'RN-REC-05', 'level' => 'error', 'msg' => "{$nombre}: ".self::n((float) $i->qty_kg, 4).' kg en '.self::n($total, 4).' kg = '.self::n($d, 0).' ppm, supera el límite de '.self::n((float) $i->max_ppm, 0).' ppm. Baja la dosis o revisa el límite cargado por Calidad.']
                    : ['code' => 'RN-REC-05', 'level' => 'ok', 'msg' => "{$nombre}: ".self::n($d, 0).' ppm, dentro del límite de '.self::n((float) $i->max_ppm, 0).' ppm.'];
            } else {
                $out[] = ['code' => 'RN-REC-05', 'level' => 'warn', 'msg' => "{$nombre}: ".self::n($d, 0).' ppm sin límite configurado (D-REC-01). La aprobación queda registrada con esta advertencia.'];
            }
        }
        $puntos = DB::table('recipe_control_points')->where('version_id', $v->id)->get();
        if (in_array($r->recipe_type, self::COCIDAS, true)) {
            $out[] = $puntos->contains(fn ($c) => $c->is_critical && in_array($c->variable, ['CORE_TEMP', 'TIME'], true))
                ? ['code' => 'RN-REC-06', 'level' => 'ok', 'msg' => 'Tiene un punto de control crítico de temperatura interna o de tiempo.']
                : ['code' => 'RN-REC-06', 'level' => 'error', 'msg' => 'Una receta de tipo '.self::TIPO[$r->recipe_type].' necesita al menos un punto de control crítico de temperatura interna o de tiempo.'];
        }
        $malos = $puntos->filter(fn ($c) => (float) $c->min_value > (float) $c->max_value || trim((string) $c->corrective_action) === '');
        foreach ($malos as $c) {
            $out[] = ['code' => 'RN-REC-12', 'level' => 'error', 'msg' => "El punto {$c->code} necesita mínimo ≤ máximo y una acción correctiva escrita."];
        }
        if ($puntos->count() && ! $malos->count()) {
            $out[] = ['code' => 'RN-REC-12', 'level' => 'ok', 'msg' => $puntos->count().' puntos de control con rango y acción correctiva.'];
        }
        if ($total > 0) {
            $y = round((float) $v->base_output_kg / $total * 100, 2);
            $maxY = (float) Params::get('rec_max_yield_pct', ['brand' => $r->brand_id]);
            $out[] = $y >= 1 && $y <= $maxY
                ? ['code' => 'RN-REC-11', 'level' => 'ok', 'msg' => 'Rendimiento esperado de '.self::n($y, 2).' % (entre 1 % y '.self::n($maxY, 0).' %).']
                : ['code' => 'RN-REC-11', 'level' => 'error', 'msg' => 'Rendimiento esperado de '.self::n($y, 2).' %, fuera del rango 1 %–'.self::n($maxY, 0).' %: revisa los kg base de salida o los ingredientes.'];
        }

        return $out;
    }

    /**
     * REC-09 «Recalcular y avisar»: guarda el costo recalculado de cada versión aprobada y avisa al jefe
     * de producción de las que varían más de rec_cost_alert_pct (KPI-REC-01). No cambia el costo al aprobar.
     */
    public static function recalcularCostos(User $quien): array
    {
        return DB::transaction(function () {
            $n = 0;
            $avisos = 0;
            foreach (DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')->where('v.status', 'APPROVED')->get(['v.*', 'r.name', 'r.brand_id']) as $v) {
                $hoy = (float) self::costo($v->id)['per_kg'];
                DB::table('recipe_versions')->where('id', $v->id)->update(['recalc_cost_per_kg' => $hoy, 'recalc_at' => now()]);
                $n++;
                $limite = (float) Params::get('rec_cost_alert_pct', ['brand' => $v->brand_id]);
                $var = (float) $v->standard_cost_per_kg > 0 ? ($hoy - (float) $v->standard_cost_per_kg) / (float) $v->standard_cost_per_kg * 100 : null;
                if ($var !== null && abs($var) > $limite) {
                    $avisos++;
                    self::avisar(['role' => 'JEFE_PRODUCCION'], "Costo de {$v->name} varió ".($var > 0 ? '+' : '').self::n($var, 1).' %',
                        'Estándar al aprobar S/ '.self::n((float) $v->standard_cost_per_kg, 3).' → hoy S/ '.self::n($hoy, 3).' por kg.', $v->id, 'warn');
                }
            }
            if ($avisos) {
                Events::emit('recipe.cost_variation', 'recipe_versions', null, ['versions' => $n, 'alerts' => $avisos]);
            }

            return ['recalculated' => $n, 'alerts' => $avisos];
        });
    }

    /* ================================================================ lectura */

    public static function receta(string $id): object
    {
        return DB::table('recipes as r')->join('products as p', 'p.id', '=', 'r.product_id')->join('brands as b', 'b.id', '=', 'r.brand_id')
            ->leftJoin('product_variants as o', 'o.id', '=', 'r.output_variant_id')->where('r.id', $id)
            ->first(['r.*', 'p.name as product_name', 'p.code as product_code', 'b.name as brand_name', 'o.name as output_variant_name', 'o.sku as output_sku'])
            ?? RuleError::fail('RN-REC-03', 'Receta no encontrada.');
    }

    public static function version(string $id): object
    {
        $v = DB::table('recipe_versions as v')->join('recipes as r', 'r.id', '=', 'v.recipe_id')
            ->leftJoin('users as c', 'c.id', '=', 'v.created_by')->leftJoin('users as a', 'a.id', '=', 'v.approved_by')
            ->leftJoin('users as s', 's.id', '=', 'v.submitted_by')->leftJoin('users as t', 't.id', '=', 'v.retired_by')->where('v.id', $id)
            ->first(['v.*', 'r.code as recipe_code', 'r.name as recipe_name', 'r.recipe_type', 'r.brand_id', 'r.product_id',
                'c.name as created_by_name', 'a.name as approved_by_name', 's.name as submitted_by_name', 't.name as retired_by_name'])
            ?? RuleError::fail('RN-REC-03', 'Versión no encontrada.');
        foreach (['allergens', 'packaging', 'history'] as $c) {
            $v->{$c} = json_decode($v->{$c} ?? '[]', true) ?: [];
        }
        $v->total_kg = self::t(self::totalKg($v->id), 4);
        $v->live_yield_pct = self::t(self::rendimiento($v->id), 2);
        $v->live_allergens = self::alergenos($v->id);
        $v->editable = $v->status === 'DRAFT';

        return $v;
    }

    /** Ingredientes con su variante y aditivo, en orden. */
    public static function ingredientes(string $versionId): Collection
    {
        return DB::table('recipe_ingredients as i')->join('product_variants as pv', 'pv.id', '=', 'i.variant_id')->leftJoin('food_additives as f', 'f.id', '=', 'i.additive_id')
            ->where('i.version_id', $versionId)->orderBy('i.seq')
            ->get(['i.*', 'pv.sku', 'pv.name as variant_name', 'pv.std_cost', 'f.sin_code', 'f.name as additive_name', 'f.max_ppm', 'f.function_class', 'f.allergen as additive_allergen']);
    }

    /** Costo promedio vigente por variante (Σ qty × avg_cost / Σ qty de los saldos con stock). Solo lectura de ALM. */
    public static function costoPromedio(array $variantes): array
    {
        if (! $variantes) {
            return [];
        }

        return DB::table('stock_balances')->whereIn('variant_id', $variantes)->where('qty', '>', 0)->groupBy('variant_id')
            ->selectRaw('variant_id, sum(qty * avg_cost) / nullif(sum(qty), 0) as c')->pluck('c', 'variant_id')
            ->filter(fn ($c) => $c !== null && (float) $c > 0)->map(fn ($c) => round((float) $c, 4))->all();
    }

    /* ================================================================ apoyo */

    private static function editor(User $quien): void
    {
        Access::can($quien, 'rec.version.edit') || RuleError::fail('RN-REC-03', 'Crear y editar recetas pide el permiso rec.version.edit (jefe de producción).');
    }

    private static function marcaEnAlcance(User $quien, ?string $brandId): void
    {
        $marcas = Access::for($quien)['brands'];
        if ($brandId && $marcas && ! in_array($brandId, $marcas, true)) {
            RuleError::fail('RN-REC-03', 'La receta es de una marca fuera de tu alcance.');
        }
    }

    private static function bloquear(string $id): object
    {
        return DB::table('recipe_versions')->where('id', $id)->lockForUpdate()->first() ?? RuleError::fail('RN-REC-03', 'Versión no encontrada.');
    }

    /** RN-REC-03: solo se cambia una versión en borrador. */
    private static function borrador(string $id, User $quien): object
    {
        $v = self::bloquear($id);
        $r = DB::table('recipes')->where('id', $v->recipe_id)->first();
        self::marcaEnAlcance($quien, $r->brand_id);
        if (in_array($v->status, ['APPROVED', 'RETIRED'], true)) {
            RuleError::fail('RN-REC-03', "La versión {$v->version} de {$r->name} está ".self::ESTADO[$v->status].': no cambia (ni ingredientes, ni pasos, ni puntos de control). Crea una versión nueva.');
        }
        if ($v->status === 'IN_REVIEW') {
            RuleError::fail('RN-REC-03', "La versión {$v->version} está en revisión: devuélvela a borrador para cambiarla.");
        }

        return $v;
    }

    private static function empaques(array $lista): array
    {
        $out = [];
        foreach ($lista as $p) {
            $p = (array) $p;
            if (empty($p['variant_id'])) {
                continue;
            }
            DB::table('product_variants')->where('id', $p['variant_id'])->exists() || RuleError::fail('RN-REC-03', 'Empaque no encontrado.');
            in_array($p['per'] ?? '', ['KG', 'UNIT'], true) || RuleError::fail('RN-REC-03', 'El empaque va por kg o por unidad producida.');
            (float) ($p['qty'] ?? 0) > 0 || RuleError::fail('RN-REC-03', 'La cantidad del empaque debe ser mayor que cero.');
            $out[] = ['variant_id' => $p['variant_id'], 'per' => $p['per'], 'qty' => round((float) $p['qty'], 4)];
        }

        return $out;
    }

    private static function hito(string $accion, User $quien, ?string $detalle = null): array
    {
        return array_filter(['at' => now('America/Lima')->format('Y-m-d\TH:i'), 'action' => $accion, 'user' => $quien->name, 'detail' => $detalle], fn ($x) => $x !== null);
    }

    private static function conHito(object $v, array $hito): string
    {
        $h = json_decode($v->history ?? '[]', true) ?: [];
        $h[] = $hito;

        return json_encode($h, JSON_UNESCAPED_UNICODE);
    }

    private static function avisar(array $para, string $titulo, string $cuerpo, string $versionId, string $tono): void
    {
        DB::table('notifications')->insert($para + [
            'title' => mb_substr($titulo, 0, 255), 'body' => $cuerpo, 'ref' => json_encode(['screen' => 'REC-07', 'id' => $versionId]),
            'tone' => $tono, 'module' => 'REC', 'at' => now(), 'type' => 'APPROVALS', 'in_app' => true,
        ]);
    }

    private static function kg(mixed $v, int $d): float
    {
        return is_numeric(is_string($v) ? str_replace(',', '.', $v) : $v) ? round((float) (is_string($v) ? str_replace(',', '.', $v) : $v), $d) : 0.0;
    }

    private static function texto(mixed $v, int $max): ?string
    {
        $s = trim((string) $v);

        return $s === '' ? null : mb_substr($s, 0, $max);
    }

    /** Texto decimal para la API: «12.500». */
    public static function t(mixed $v, int $d = 3): ?string
    {
        return $v === null ? null : number_format(round((float) $v, $d), $d, '.', '');
    }

    /** Número para un mensaje, como lo muestra la web (es-PE): 1,234.5 */
    private static function n(float $v, int $d): string
    {
        return number_format($v, $d, '.', ',');
    }

    /** El disparador de la base responde «RN-REC-03: …»: se convierte en RuleError. */
    private static function base(\Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (QueryException $e) {
            if (preg_match('/(RN-REC-\d{2}): ([^\n(]+)/', $e->getMessage(), $m)) {
                RuleError::fail($m[1], ucfirst(trim($m[2])).'.');
            }
            if (str_contains($e->getMessage(), 'recipe_versions_una_en_curso')) {
                RuleError::fail('RN-REC-03', 'La receta ya tiene una versión en curso: termínala antes de crear otra.');
            }
            if (str_contains($e->getMessage(), 'recipe_versions_una_aprobada')) {
                RuleError::fail('RN-REC-01', 'La receta ya tiene una versión aprobada.');
            }
            throw $e;
        }
    }
}
