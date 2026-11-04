<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Ramsey\Uuid\Uuid;

/**
 * Siembra la base con los datos del prototipo (database/seeders/data/prototipo.json.gz, extraído con
 * tools/prototipo/extraer_esquema.js): catálogos globales y dos empresas de demo, Don Guando (DG) y
 * Carnes Selectas del Sur (CS), con TODAS las tablas que existen en la base y que el prototipo llena:
 * empresa y seguridad, catálogo y precios, clientes y zonas, almacenes, lotes y stock, pedidos,
 * preparación, reparto, comprobantes, cobros, gastos, bandeja omnicanal, anuncios, telefonía,
 * tablero, calidad, recetas y equipos.
 *
 * Los ids del prototipo ('br-DG') pasan a uuid deterministas (uuid5 de empresa + id): cada corrida da
 * los mismos ids y las relaciones se conservan. Se hace en dos pasadas: primero se calculan los ids de
 * todas las filas y luego se inserta cada tabla sabiendo qué referencias existen (el orden entre
 * tablas no importa y los ciclos —pedido ↔ bandeja web— se conservan). Una referencia a algo que no
 * se siembra queda en null; si la columna es obligatoria, la fila se omite.
 *
 * Corre con el dueño de las tablas: php artisan db:seed --database=pgsql_owner
 * Contraseña de todos los usuarios: SEED_PASSWORD del .env.
 */
class PrototipoSeeder extends Seeder
{
    private const NS = 'b7a1c2d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

    private const GLOBALES = ['platform_modules', 'parameter_definitions', 'sunat_catalog_items', 'ubigeo', 'financial_institutions'];

    // Secretos de la demo (hashes falsos del prototipo): no sirven fuera de él y no se siembran.
    private const SECRETOS = ['password_history', 'password_reset_tokens', 'mfa_recovery_codes', 'user_sessions'];

    // Dominios para trabajar en local (además de los del prototipo).
    private const DOMINIOS_LOCALES = ['DG' => 'donguando.localhost', 'CS' => 'cs.localhost'];

    // Listas embebidas en el prototipo que en la base son tablas hijas: padre => [lista, hija, FK].
    private const HIJAS = [
        'sales_orders' => ['lines', 'sales_order_lines', 'sales_order_id'],
        'sales_documents' => ['lines', 'sales_document_lines', 'sales_document_id'],
        'payments' => ['allocations', 'payment_allocations', 'payment_id'],
    ];

    private array $data;
    private array $ids = [];        // tabla => [uuid => true] de lo que se va a sembrar
    private array $columnas = [];
    private array $fks = [];
    private string $hash;
    private int $horasCorregidas = 0;

    public function run(): void
    {
        $this->data = json_decode(gzdecode(file_get_contents(__DIR__.'/data/prototipo.json.gz')), true);
        $this->hash = Hash::make(env('SEED_PASSWORD', 'DonGuando2026'));
        $this->leerEsquema();

        $filas = $this->data['tenants'];
        $filas['tenant_hostnames'] = array_merge($filas['tenant_hostnames'], array_map(
            fn ($t, $h) => ['id' => 'th-local-'.$t, 'tenant_ref' => $t, 'hostname' => $h, 'is_primary' => false, 'status' => 'ACTIVE'],
            array_keys(self::DOMINIOS_LOCALES), self::DOMINIOS_LOCALES
        ));
        $filas = $this->hijas($this->completarEmpresas($filas));

        // Tablas a sembrar: las que existen en la base y que el prototipo trae.
        $tablas = [];
        foreach (self::GLOBALES as $t) {
            $tablas[$t] = ['filas' => $this->data['globales'][$t], 'empresa' => fn () => null];
        }
        foreach ($filas as $t => $rows) {
            if (isset($this->columnas[$t]) && ! in_array($t, self::SECRETOS, true)) {
                $tablas[$t] = ['filas' => $rows, 'empresa' => fn ($r) => match ($t) {
                    'tenants' => null,
                    'tenant_hostnames' => $r['tenant_ref'],
                    default => $r['tenant'],
                }];
            }
        }

        // Ids repetidos dentro de una tabla (el prototipo trae algunos): la primera fila conserva el
        // id (a ella apuntan las referencias) y las siguientes reciben uno propio.
        foreach ($tablas as $t => &$info) {
            $vistos = [];
            $repetidos = 0;
            foreach ($info['filas'] as $i => $r) {
                if (! isset($r['id'])) {
                    continue;
                }
                $k = ($r['tenant'] ?? '').':'.$r['id'];
                if (isset($vistos[$k])) {
                    $info['filas'][$i]['id'] = $r['id'].'~'.(++$vistos[$k]);
                    $repetidos++;
                } else {
                    $vistos[$k] = 1;
                }
            }
            if ($repetidos) {
                $this->command?->warn("Ids repetidos en el prototipo ({$t}): {$repetidos} filas con id propio");
            }
        }
        unset($info);

        // Pasada 1: los ids de todo lo que se va a sembrar.
        foreach ($tablas as $t => $info) {
            foreach ($info['filas'] as $r) {
                $this->ids[$t][$this->idDe($t, $r, $info['empresa']($r))] = true;
            }
        }

        // Pasada 2: convertir. Si una fila se omite (FK obligatoria sin destino), su id deja de existir
        // y se vuelve a convertir lo que la referenciaba, hasta que nada cambie.
        do {
            $convertidas = [];
            $omitidas = 0;
            $this->horasCorregidas = 0;  // se cuenta en la última vuelta
            foreach ($tablas as $t => $info) {
                foreach ($info['filas'] as $r) {
                    $empresa = $info['empresa']($r);
                    $fila = $this->convertir($t, $r, $empresa);
                    if ($fila === null) {
                        $id = $this->idDe($t, $r, $empresa);
                        if (isset($this->ids[$t][$id])) {
                            unset($this->ids[$t][$id]);
                            $omitidas++;
                        }
                        continue;
                    }
                    $convertidas[$t][] = $fila;
                }
            }
        } while ($omitidas > 0);

        // Sin triggers ni FK mientras se inserta (las referencias ya se validaron arriba): así el
        // orden entre tablas no importa y la bitácora no se llena con la carga de demo.
        DB::statement("SET session_replication_role = 'replica'");
        try {
            foreach ($convertidas as $t => $rows) {
                $this->insertar($t, $rows);
            }
        } finally {
            DB::statement("SET session_replication_role = 'origin'");
        }
        $this->accesoPorModulo();

        if ($this->horasCorregidas) {
            $this->command?->warn("Fechas mal formadas en el prototipo (10:08:00:00, 09:110, NaN): {$this->horasCorregidas} normalizadas");
        }
        $total = array_sum(array_map('count', $convertidas));
        $this->command?->info(sprintf('%d tablas · %d filas sembradas', count($convertidas), $total));
    }

    /** Roles, permisos y usuarios-rol: el prototipo los trae completos solo para DG. */
    private function completarEmpresas(array $f): array
    {
        $empresas = array_column($f['tenants'], 'id');
        foreach (['roles', 'permissions', 'role_permissions'] as $t) {
            $dg = array_filter($f[$t], fn ($r) => $r['tenant'] === 'DG');
            foreach ($empresas as $emp) {
                if ($emp !== 'DG' && ! array_filter($f[$t], fn ($r) => $r['tenant'] === $emp)) {
                    foreach ($dg as $r) {
                        $f[$t][] = ['tenant' => $emp] + $r;
                    }
                }
            }
        }
        // El prototipo repite id y correo (us-dflores: Diana Flores, VENDEDORA, y Diego Flores, COMPRAS).
        // El segundo recibe id y correo propios para no romper el único de correo.
        $vistos = [];
        foreach ($f['users'] as $i => $u) {
            $k = $u['tenant'].':'.$u['id'];
            if (isset($vistos[$k])) {
                $nuevo = $u['id'].'-'.strtolower($u['role']);
                [$local, $dominio] = explode('@', $u['email']);
                $f['users'][$i]['id'] = $nuevo;
                $f['users'][$i]['email'] = $local.'.'.strtolower($u['role']).'@'.$dominio;
                $this->command?->warn("Usuario repetido en el prototipo: {$u['id']} ({$u['name']}) → {$nuevo}, {$f['users'][$i]['email']}");
            }
            $vistos[$k] = true;
        }

        // Cada usuario con su rol de users.role (además de los user_roles del prototipo).
        $ya = [];
        foreach ($f['user_roles'] as $r) {
            $ya[$r['tenant'].$r['user_id'].$r['role_id']] = true;
        }
        foreach ($f['users'] as $u) {
            $rol = 'ro-'.$u['role'];
            if (! isset($ya[$u['tenant'].$u['id'].$rol])) {
                $f['user_roles'][] = ['id' => 'ur-'.$u['id'], 'tenant' => $u['tenant'], 'user_id' => $u['id'], 'role_id' => $rol];
            }
        }

        return $f;
    }

    /** Líneas de pedido, de comprobante y aplicaciones de cobro: en el prototipo van dentro del padre. */
    private function hijas(array $f): array
    {
        foreach (self::HIJAS as $padre => [$lista, $hija, $fk]) {
            foreach ($f[$padre] ?? [] as $p) {
                foreach (array_values($p[$lista] ?? []) as $i => $linea) {
                    $f[$hija][] = ['id' => $linea['id'] ?? "{$p['id']}-{$hija}-{$i}", 'tenant' => $p['tenant'],
                        $fk => $p['id'], 'line_no' => $i + 1] + $linea;
                }
            }
        }

        return $f;
    }

    private function accesoPorModulo(): void
    {
        $filas = [];
        foreach (DB::table('roles')->get(['id', 'tenant_id', 'code']) as $rol) {
            $matriz = $this->data['access'][$rol->code] ?? null;
            if ($matriz === null) {
                continue;
            }
            foreach ($matriz === '*' ? ['*' => 'CLEA'] : $matriz as $modulo => $acciones) {
                $filas[] = ['id' => (string) Uuid::uuid4(), 'tenant_id' => $rol->tenant_id, 'role_id' => $rol->id,
                    'module_code' => $modulo, 'actions' => $acciones];
            }
        }
        foreach (array_chunk($filas, 500) as $lote) {
            DB::table('role_module_access')->insert($lote);
        }
    }

    private function insertar(string $tabla, array $filas): void
    {
        // Un lote necesita las mismas columnas en cada fila (las que faltan toman su DEFAULT).
        $grupos = [];
        foreach ($filas as $fila) {
            ksort($fila);
            $grupos[implode(',', array_keys($fila))][] = $fila;
        }
        foreach ($grupos as $grupo) {
            foreach (array_chunk($grupo, 200) as $lote) {
                DB::table($tabla)->insert($lote);
            }
        }
    }

    private function idDe(string $tabla, array $r, ?string $empresa): string
    {
        if ($tabla === 'tenants') {
            return $this->uid('', $r['id']);
        }
        $clave = in_array($tabla, self::GLOBALES, true) ? '' : (string) $empresa;

        return $this->uid($clave, $r['id'] ?? json_encode($r));
    }

    private function convertir(string $tabla, array $r, ?string $empresa): ?array
    {
        $global = in_array($tabla, self::GLOBALES, true) || $tabla === 'tenants';
        $clave = $global ? '' : $empresa;
        $fila = ['id' => $this->idDe($tabla, $r, $empresa)];

        foreach ($this->columnas[$tabla] as $col => $info) {
            if ($col === 'id') {
                continue;
            }
            if ($col === 'tenant_id') {
                $fila[$col] = $this->uid('', $empresa);
                continue;
            }
            $v = $tabla === 'users' && $col === 'password' ? $this->hash : ($r[$col] ?? null);
            // Algunas tablas del prototipo guardan el código del rol («VENDEDORA») en vez de su id («ro-VENDEDORA»).
            if (($this->fks[$tabla][$col] ?? null) === 'roles' && is_string($v) && ! str_starts_with($v, 'ro-')) {
                $v = 'ro-'.$v;
            }
            $v = $this->tipo($v, $info['type'], $clave);

            // Referencia a una fila que no se siembra: null si se puede; si no, la fila se omite.
            if ($v !== null && isset($this->fks[$tabla][$col]) && ! isset($this->ids[$this->fks[$tabla][$col]][$v])) {
                if (! $info['nullable']) {
                    return null;
                }
                $v = null;
            }
            if ($v === null && ! $info['nullable'] && ! $info['default']) {
                $v = $this->relleno($info['type']);
                if ($v === null) {
                    return null;
                }
            }
            if ($v !== null || ! $info['default']) {
                $fila[$col] = $v;
            }
        }

        return $fila;
    }

    private function tipo(mixed $v, string $tipo, ?string $clave): mixed
    {
        if ($v === null || $v === '') {
            return $tipo === 'varchar' || $tipo === 'text' ? ($v === '' ? '' : null) : null;
        }

        return match ($tipo) {
            'uuid' => is_string($v) && ! Uuid::isValid($v) ? $this->uid($clave ?? '', $v) : (is_string($v) ? $v : null),
            'jsonb', 'json' => json_encode($v, JSON_UNESCAPED_UNICODE),
            'bool' => (bool) $v,
            'varchar', 'text' => is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : (is_bool($v) ? ($v ? 'true' : 'false') : (string) $v),
            'int4', 'int8' => is_numeric($v) ? (int) round($v) : null,
            'numeric' => is_numeric($v) ? $v : null,
            'date' => is_string($v) ? substr($v, 0, 10) : null,
            'timestamptz', 'timestamp' => is_string($v) ? $this->fechaHora($v) : null,
            'time' => is_string($v) && preg_match('/^\d{1,2}:\d{2}/', $v) ? $v : null,
            default => is_array($v) ? json_encode($v) : $v,
        };
    }

    /**
     * El prototipo trae unas 3 900 fechas mal formadas: con los segundos repetidos («10:08:00:00»),
     * con minutos desbordados («09:110:00») o con hora «NaN». Se reconstruyen desde sus partes,
     * sumando el exceso (09:110 → 10:50); la hora «NaN» queda vacía. Se cuentan para avisar.
     */
    private function fechaHora(string $v): ?string
    {
        // Hora «NaN» (un cálculo fallido en el prototipo): sin hora válida, queda vacía.
        if (str_contains($v, 'NaN')) {
            $this->horasCorregidas++;

            return null;
        }
        if (! preg_match('/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{1,3})(?::(\d{1,2}))?)?/', $v, $m)) {
            return null;
        }
        [$h, $min, $seg] = [(int) ($m[2] ?? 0), (int) ($m[3] ?? 0), (int) ($m[4] ?? 0)];
        $iso = '/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/';
        if ($h < 24 && $min < 60 && $seg < 60 && preg_match($iso, $v)) {
            return $v;
        }
        $this->horasCorregidas++;

        return now()->parse($m[1])->addHours($h)->addMinutes($min)->addSeconds($seg)->format('Y-m-d\TH:i:s');
    }

    private function relleno(string $tipo): mixed
    {
        return match ($tipo) {
            'varchar', 'text' => '',
            'int4', 'int8', 'numeric' => 0,
            'bool' => false,
            'jsonb', 'json' => '[]',
            'date' => now()->toDateString(),
            'timestamptz', 'timestamp' => now(),
            default => null,
        };
    }

    private function uid(string $empresa, string $id): string
    {
        return (string) Uuid::uuid5(self::NS, $empresa.':'.$id);
    }

    private function leerEsquema(): void
    {
        foreach (DB::select("SELECT table_name, column_name, udt_name, is_nullable, column_default
                               FROM information_schema.columns WHERE table_schema = 'public'") as $c) {
            $this->columnas[$c->table_name][$c->column_name] = [
                'type' => $c->udt_name, 'nullable' => $c->is_nullable === 'YES', 'default' => $c->column_default !== null,
            ];
        }
        foreach (DB::select("SELECT cl.relname AS tabla, a.attname AS col, ct.relname AS destino
                               FROM pg_constraint k
                               JOIN pg_class cl ON cl.oid = k.conrelid
                               JOIN pg_class ct ON ct.oid = k.confrelid
                               JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
                               JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
                              WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1") as $f) {
            $this->fks[$f->tabla][$f->col] = $f->destino;
        }
    }
}
