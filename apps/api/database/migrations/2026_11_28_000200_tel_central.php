<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

// TEL-03 Números y desvíos, TEL-04 Menú de voz y horario y TEL-05 Grupos de llamada (RN-TEL-04 y 06).
//  - Números: uno por empresa y número (E.164), con tipo y estado válidos; uno activo atiende con un menú o un grupo.
//  - Menú: lo que pasa fuera de horario es una de tres opciones. Las opciones de la demostración guardaban los códigos
//    del prototipo («br-DG», «trg-DG», «us-pleon»): se cambian por los identificadores reales.
//  - Grupos: uno por marca, estrategia y tiempo de timbre válidos; una vendedora una vez por grupo, con prioridad.
//  - Números, menús y grupos no se borran (se desactivan); una vendedora se pausa.
return new class extends Migration
{
    private const NS = 'b7a1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d';   // el de PrototipoSeeder

    public function up(): void
    {
        $this->corregirOpcionesDelMenu();

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_numbers_numero ON tel_numbers (tenant_id, e164)');
        DB::statement("ALTER TABLE tel_numbers ADD CONSTRAINT tel_numbers_formato CHECK (e164 ~ '^\\+[0-9]{8,15}$')");
        DB::statement("ALTER TABLE tel_numbers ADD CONSTRAINT tel_numbers_tipo CHECK (number_kind IN ('LANDLINE_LIMA','VIRTUAL_MOBILE','TOLL_FREE'))");
        DB::statement("ALTER TABLE tel_numbers ADD CONSTRAINT tel_numbers_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement("ALTER TABLE tel_numbers ADD CONSTRAINT tel_numbers_destino CHECK (status <> 'ACTIVE' OR menu_id IS NOT NULL OR ring_group_id IS NOT NULL)");
        DB::statement("ALTER TABLE tel_numbers ADD CONSTRAINT tel_numbers_desvios CHECK (jsonb_typeof(forwarded_from) = 'array')");

        DB::statement("ALTER TABLE tel_menus ADD CONSTRAINT tel_menus_fuera_de_horario CHECK (after_hours_action IN ('CALLBACK_TASK','VOICEMAIL','FORWARD'))");
        DB::statement("ALTER TABLE tel_menus ADD CONSTRAINT tel_menus_estado CHECK (status IN ('ACTIVE','INACTIVE'))");
        DB::statement("ALTER TABLE tel_menus ADD CONSTRAINT tel_menus_opciones CHECK (jsonb_typeof(options) = 'array')");

        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_ring_groups_marca ON tel_ring_groups (tenant_id, brand_id)');
        DB::statement("ALTER TABLE tel_ring_groups ADD CONSTRAINT tel_ring_groups_estrategia CHECK (strategy IN ('ROUND_ROBIN','SIMULTANEOUS'))");
        DB::statement('ALTER TABLE tel_ring_groups ADD CONSTRAINT tel_ring_groups_timbre CHECK (ring_timeout_s BETWEEN 5 AND 120)');
        DB::statement('CREATE UNIQUE INDEX IF NOT EXISTS tel_ring_members_persona ON tel_ring_members (group_id, user_id)');
        DB::statement('ALTER TABLE tel_ring_members ADD CONSTRAINT tel_ring_members_prioridad CHECK (priority BETWEEN 1 AND 99)');

        foreach (['tel_numbers', 'tel_menus', 'tel_ring_groups', 'tel_ring_members'] as $t) {
            DB::statement("REVOKE DELETE, TRUNCATE ON {$t} FROM aycha_app");
        }
    }

    /** Opción del menú con un código del prototipo → su identificador real, si existe en esa empresa (si no, vacío). */
    private function corregirOpcionesDelMenu(): void
    {
        $codigos = [];
        foreach (DB::table('tenants')->pluck('id') as $t) {
            foreach (['DG', 'CS'] as $c) {
                if ((string) Uuid::uuid5(self::NS, ':'.$c) === $t) {
                    $codigos[$t] = $c;
                }
            }
        }
        $real = function (?string $v, string $tabla, string $empresa) use ($codigos): ?string {
            if (! $v || preg_match('/^[0-9a-f-]{36}$/', $v)) {
                return $v;
            }
            $id = isset($codigos[$empresa]) ? (string) Uuid::uuid5(self::NS, $codigos[$empresa].':'.$v) : null;

            return $id && DB::table($tabla)->where('id', $id)->exists() ? $id : null;
        };
        foreach (DB::table('tel_menus')->get(['id', 'tenant_id', 'options']) as $m) {
            $ops = json_decode((string) $m->options, true) ?: [];
            foreach ($ops as &$o) {
                $o['brand_id'] = $real($o['brand_id'] ?? null, 'brands', $m->tenant_id);
                $o['ring_group_id'] = $real($o['ring_group_id'] ?? null, 'tel_ring_groups', $m->tenant_id);
                if (array_key_exists('direct_user_id', $o)) {
                    $o['direct_user_id'] = $real($o['direct_user_id'], 'users', $m->tenant_id);
                }
            }
            unset($o);
            DB::table('tel_menus')->where('id', $m->id)->update(['options' => json_encode($ops, JSON_UNESCAPED_UNICODE)]);
        }
    }

    public function down(): void
    {
        foreach (['tel_numbers', 'tel_menus', 'tel_ring_groups', 'tel_ring_members'] as $t) {
            DB::statement("GRANT DELETE ON {$t} TO aycha_app");
        }
        DB::statement('ALTER TABLE tel_ring_members DROP CONSTRAINT IF EXISTS tel_ring_members_prioridad');
        DB::statement('DROP INDEX IF EXISTS tel_ring_members_persona');
        DB::statement('ALTER TABLE tel_ring_groups DROP CONSTRAINT IF EXISTS tel_ring_groups_timbre');
        DB::statement('ALTER TABLE tel_ring_groups DROP CONSTRAINT IF EXISTS tel_ring_groups_estrategia');
        DB::statement('DROP INDEX IF EXISTS tel_ring_groups_marca');
        foreach (['opciones', 'estado', 'fuera_de_horario'] as $c) {
            DB::statement("ALTER TABLE tel_menus DROP CONSTRAINT IF EXISTS tel_menus_{$c}");
        }
        foreach (['desvios', 'destino', 'estado', 'tipo', 'formato'] as $c) {
            DB::statement("ALTER TABLE tel_numbers DROP CONSTRAINT IF EXISTS tel_numbers_{$c}");
        }
        DB::statement('DROP INDEX IF EXISTS tel_numbers_numero');
        // Las opciones del menú quedan con sus identificadores reales.
    }
};
