#!/usr/bin/env python3
"""Genera migraciones de Laravel a partir del modelo de datos del prototipo Aycha.

Fuentes:
  - schema-prototipo.json: perfil de cada tabla del prototipo (columnas, tipos vistos, a qué tabla apuntan
    los valores, nulos). Se extrae del HTML del prototipo con extraer_esquema.js.
  - aycha-proto/dist/tablas.md: qué tablas son de cada módulo y cuáles son de solo inserción.

Uso (desde la raíz del repo):
  python -I tools/prototipo/generar_migraciones.py --modulos PLT,SEG,... --prefijo 2026_11_03 --desde 100

Las migraciones generadas son un punto de partida: el dueño de cada módulo las revisa (tipos, únicos,
CHECK de estados) antes de construir sus pantallas. Ver docs/base-de-datos.md.
"""
import argparse, json, math, pathlib, re

R = pathlib.Path(__file__).resolve().parents[2]
SCHEMA = json.loads((R / 'tools/prototipo/schema-prototipo.json').read_text(encoding='utf-8'))['tables']
TABLAS_MD = (R / 'aycha-proto/dist/tablas.md').read_text(encoding='utf-8')

NOMBRES = {
    'PLT': 'plataforma', 'SEG': 'seguridad', 'MAE': 'maestros', 'INT': 'integraciones', 'AUD': 'auditoria',
    'NUC': 'nucleo_compartido', 'CAT': 'catalogo', 'CLI': 'clientes', 'PED': 'pedidos', 'POS': 'mostrador',
    'ALM': 'almacenes', 'PRE': 'preparacion', 'DEL': 'delivery', 'FAC': 'comprobantes', 'CAJ': 'cajas',
    'GAS': 'gastos', 'WEB': 'tienda_web', 'CRM': 'bandeja_omnicanal', 'ADS': 'anuncios', 'TEL': 'telefonia',
    'TAB': 'tablero', 'CAL': 'calidad', 'REC': 'recetas', 'EQU': 'equipos', 'PRO': 'produccion', 'DES': 'despiece',
    'ETQ': 'etiquetas', 'COM': 'compras', 'GRJ': 'granja', 'CNT': 'contabilidad', 'B2B': 'clientes_empresariales',
    'CMP': 'campanas', 'CON': 'consignacion', 'FLO': 'flota', 'PER': 'personal', 'PRS': 'presupuesto',
    'SUS': 'planes', 'ONB': 'alta_de_empresas', 'OPS': 'consola', 'API': 'api_publica', 'SEP': 'separacion_de_marcas',
}

# Tablas sin tenant (catálogos de la plataforma). El resto lleva tenant_id con RLS.
GLOBALES = {'tenants', 'platform_modules', 'parameter_definitions', 'tenant_hostnames', 'sunat_catalog_items',
            'ubigeo', 'financial_institutions'}

# Tablas que el prototipo usa en la fase 1 pero cuyo dueño llega después (o es el núcleo).
EXTRA = {'PLT': ['tenants'], 'NUC': ['suppliers', 'vehicles'], 'CRM': ['messages'],
         'TAB': ['kpi_snapshot_runs', 'dashboards', 'dashboard_widgets']}
# Nombres de tablas.md que no son tablas (funciones o tablas embebidas que se crean como hijas).
NO_TABLA = {'tel_guard', 'audit.change_log'}

# Listas embebidas en el prototipo que en la base son tablas hijas: tabla padre, columna, hija, FK.
HIJAS = [('sales_orders', 'lines', 'sales_order_lines', 'sales_order_id'),
         ('sales_documents', 'lines', 'sales_document_lines', 'sales_document_id'),
         ('payments', 'allocations', 'payment_allocations', 'payment_id')]
HIJA_DE = {h: (p, c, fk) for p, c, h, fk in HIJAS}

# Columnas del prototipo que no pasan a la base (artefactos de la demo o reemplazadas por tablas).
OMITIR = {'*': {'id', 'tenant', 'created_at', 'updated_at', 'created_from', 'console_demo'},
          'sales_orders': {'lines', 'history', 'payment_ids', 'reservations', 'stock_out', 'stock_out_done', 'stock_short'},
          'sales_documents': {'lines'}, 'payments': {'allocations'},
          'users': {'brands', 'sites', 'pwd_hash', 'platform', 'support', 'deactivate_reason'}}
# tenant_hostnames es global (sin RLS: se lee antes de saber el tenant), pero apunta a su tenant.
RENOMBRAR = {('users', 'pwd_hash'): 'password', ('tenant_hostnames', 'tenant_ref'): 'tenant_id'}

# Únicos de negocio (además de los PK). Columnas con tenant_id delante cuando la tabla tiene tenant.
UNICOS = {'brands': [['code']], 'establishments': [['code']], 'document_series': [['series']],
          'users': [['email']], 'roles': [['code']], 'permissions': [['code']], 'sales_orders': [['number']],
          'sales_documents': [['series', 'number']], 'payments': [['number']], 'product_variants': [['sku']],
          'products': [['code']], 'warehouses': [['code']], 'tenant_hostnames': [['hostname']],
          'platform_modules': [['code']], 'parameter_definitions': [['key']], 'cost_centers': [['code']],
          'units_of_measure': [['code']], 'payment_methods': [['code']], 'delivery_zones': [['code']],
          'vehicles': [['plate']], 'kpi_definitions': [['code']]}

DECIMAL_RE = re.compile(r'(amount|price|total|fee|cost|balance|subtotal|igv|kg|weight|pct|percent|rate|qty|quantity|'
                        r'value|budget|spend|lat|lng|temp|km|cash|given|discount|salary|tolerance|capacity|limit|'
                        r'margin|score|tax|net|gross|base|min_|max_|_min|_max|target|actual|threshold)')


def tablas_por_modulo():
    mods, solo_insercion, cur = {}, set(), None
    for line in TABLAS_MD.splitlines():
        m = re.match(r'^### (\w+)', line)
        if m:
            cur = m.group(1); continue
        solo_insercion.update(re.findall(r'`([a-z_.]+)` \(solo inserción\)', line))
        if cur and re.search(r'(Propias|Núcleo|Base)', line):
            parte = re.split(r'Funciones|Vista|Agregadas|Columnas agregadas|Usa ', line)[0]
            # TAB pone «Núcleo (...): …; Agregadas …; Propias: …» en una sola línea
            parte += ' ' + ''.join(re.findall(r'Propias:([^.]*)', line))
            for t in re.findall(r'`([a-z_.]+)`', parte):
                if t not in NO_TABLA and t not in mods.setdefault(cur, []):
                    mods[cur].append(t)
    return mods, solo_insercion


def php_str(s):
    return "'" + str(s).replace('\\', '\\\\').replace("'", "\\'") + "'"


def es_hora(p):
    return isinstance(p.get('ex'), str) and re.fullmatch(r'\d{2}:\d{2}(:\d{2})?', p['ex']) is not None


FUTURAS = False  # --columnas-futuras: conservar las columnas que apuntan a módulos que aún no existen

# Columnas *_id que guardan ids de OTROS sistemas: siguen siendo texto.
EXTERNO_RE = re.compile(r'(^external|^provider_(?!supplier)|^woo_|waba|^device_id$|^session_id$|^client_event_id$|_external_)')
# Nombre de columna → tabla, cuando el prototipo no trae valores de los que deducirla.
DESTINO_POR_NOMBRE = {'credit_note': 'sales_documents', 'document': 'sales_documents', 'order_line': 'sales_order_lines',
                      'route': 'delivery_routes', 'invoice_series': 'document_series', 'transfer': 'stock_transfers',
                      'connector': 'integration_connectors', 'call': 'tel_calls', 'inspection': 'qc_inspections',
                      'production_order': 'production_orders', 'purchase_receipt': 'purchase_receipts',
                      'provider_supplier': 'suppliers', 'external_supplier': 'suppliers'}


def destino_por_nombre(nombre, tabla):
    """Tabla a la que apunta una columna *_id según su nombre (o None)."""
    stem = nombre[:-3]
    if stem == 'parent':
        return tabla
    if stem.endswith('_file') or stem == 'file':
        return 'file_attachments'
    if stem.endswith('_user') or stem == 'user' or stem.endswith('_by'):
        return 'users'
    if stem in DESTINO_POR_NOMBRE:
        return DESTINO_POR_NOMBRE[stem]
    cand = [t for t in SCHEMA if t in (stem + 's', stem + 'es') or t.endswith('_' + stem + 's')]
    return cand[0] if len(cand) == 1 else None


def tipo_columna(nombre, p, permitidas, tabla=''):
    """Devuelve (método Blueprint, argumentos, destino FK o None, nota)."""
    t = {k: v for k, v in p['t'].items()}
    # *_id interno sin valores que lo delaten (o que no coinciden con ningún id): se deduce por el nombre.
    if nombre.endswith('_id') and not EXTERNO_RE.search(nombre) and not (p.get('refs') or {}) and             set(t) <= {'string'}:
        destino = destino_por_nombre(nombre, tabla)
        if destino and destino in permitidas:
            return 'uuid', [], destino, None
        if destino and FUTURAS:
            return 'uuid', [], None, f'apunta a {destino} (módulo posterior): la FK la agrega su dueño'
        return 'uuid', [], None, None
    refs = p.get('refs') or {}
    no_nulos = p['n'] - p['nul']
    total_refs = sum(refs.values())
    principal = max(t, key=t.get) if t else 'string'

    if principal in ('string', 'arr') and refs and total_refs >= 0.5 * max(no_nulos, 1):
        destinos = [d for d in refs if d in permitidas]
        if principal == 'arr':
            return 'jsonb', [], None, 'lista de ids'
        if len(refs) == 1 and destinos:
            return 'uuid', [], destinos[0], None
        if len(refs) > 1:
            return 'uuid', [], None, 'referencia polimórfica: ' + ', '.join(sorted(refs))
        if FUTURAS:
            # Módulo que todavía no existe: columna opcional sin FK; su dueño agrega la FK al crearlo.
            return 'uuid', [], None, 'apunta a ' + ', '.join(refs) + ' (módulo posterior): la FK la agrega su dueño'
        return None, None, None, 'apunta a ' + ', '.join(refs)  # tabla de una fase posterior: se omite
    if principal == 'boolean':
        return 'boolean', [], None, None
    if principal == 'number':
        if DECIMAL_RE.search(nombre) or not p.get('intOnly', True):
            if re.search(r'(^|_)(lat|lng)$', nombre):
                return 'decimal', [10, 7], None, None
            if re.search(r'(pct|percent|rate)', nombre):
                return 'decimal', [9, 4], None, None
            if re.search(r'(kg|weight|qty|quantity|km|capacity)', nombre):
                return 'decimal', [14, 3], None, None
            return 'decimal', [14, 2] if p.get('maxDec', 0) <= 2 else [18, 4], None, None
        return ('bigInteger' if p.get('max', 0) > 2_000_000_000 else 'integer'), [], None, None
    if principal == 'date':
        return 'date', [], None, None
    if principal == 'datetime':
        return 'timestampTz', [], None, None
    if principal in ('obj', 'arr', 'arrobj'):
        return 'jsonb', [], None, None
    if es_hora(p):
        return 'time', [], None, None
    largo = p.get('max', 0)
    # Los hashes y tokens del prototipo son de demo (8-14 caracteres): los reales son más largos.
    if re.search(r'(hash|token|secret)', nombre):
        return 'string', [255], None, None
    if largo > 255 or re.search(r'(notes|description|body|text|message|comment|detail|content|payload|transcript|summary)$', nombre):
        return 'text', [], None, None
    # Siempre 255: el largo de los datos de demo no dice cuánto miden los reales (y en PostgreSQL no cuesta más).
    return 'string', [255], None, None


def columnas(tabla, perfil, filas, permitidas):
    omitir = OMITIR['*'] | OMITIR.get(tabla, set())
    out = []
    for nombre, p in perfil.items():
        if nombre in omitir and (tabla, nombre) not in RENOMBRAR:
            continue
        nombre_db = RENOMBRAR.get((tabla, nombre), nombre)
        if nombre_db == 'password':
            out.append(dict(nombre='password', metodo='string', args=[255], fk=None, nulo=False,
                            nota='hash de Laravel (el prototipo guarda un hash de demo)'))
            continue
        if nombre_db == 'tenant_id':
            out.append(dict(nombre='tenant_id', metodo='uuid', args=[], fk='tenants', nulo=False, nota=None))
            continue
        metodo, args, fk, nota = tipo_columna(nombre, p, permitidas, tabla)
        if metodo is None:
            continue
        nulo = not (p['n'] == filas and p['nul'] == 0 and filas >= 3) or (metodo == 'uuid' and fk is None and 'posterior' in (nota or ''))             or (metodo == 'uuid' and not (p.get('refs') or {}))
        valores = p.get('vals')
        if metodo == 'string' and valores and len(valores) <= 12 and p.get('max', 0) <= 30 and \
                all(re.fullmatch(r'[A-Z0-9_]+', v or '') for v in valores):
            nota = 'valores en el prototipo: ' + ', '.join(sorted(valores))
        out.append(dict(nombre=nombre_db, metodo=metodo, args=args, fk=fk, nulo=nulo, nota=nota,
                        default_falso=metodo == 'boolean' and not nulo))
    return out


def bloque_tabla(tabla, modulo, cols, con_tenant, padre=None):
    L = [f"        // {modulo} · {tabla}",
         f"        Schema::create({php_str(tabla)}, function (Blueprint $table) {{",
         "            $table->uuid('id')->default(DB::raw('gen_random_uuid()'))->primary();"]
    if con_tenant:
        L.append("            $table->uuid('tenant_id')->default(DB::raw('app_tenant_id()'));")
    if padre:
        L.append(f"            $table->uuid({php_str(padre[1])});")
        L.append("            $table->integer('line_no')->default(1);")
    for c in cols:
        args = ''.join(', ' + str(a) for a in c['args'])
        s = f"            $table->{c['metodo']}({php_str(c['nombre'])}{args})"
        if c['nulo']:
            s += '->nullable()'
        elif c.get('default_falso'):
            s += '->default(false)'
        if c.get('nota'):
            s += f"->comment({php_str(c['nota'])})"
        L.append(s + ';')
    L.append("            $table->timestampTz('created_at')->useCurrent();")
    L.append("            $table->timestampTz('updated_at')->nullable();")
    if con_tenant:
        L.append("            $table->index('tenant_id');")
    L.append("        });")
    return L


def tablas_de(modulos, mods):
    out = []
    for m in modulos:
        for t in EXTRA.get(m, []) + mods.get(m, []):
            if t in SCHEMA and t not in out:
                out.append(t)
                out += [h for p, c, h, fk in HIJAS if p == t]
    return out


def generar(modulos, prefijo, desde, salida, ya=()):
    mods, solo_insercion = tablas_por_modulo()
    # Tablas de módulos ya migrados: no se vuelven a crear, pero las FK hacia ellas sí.
    existentes = set(tablas_de(ya, mods))
    vistas, plan = set(existentes), []
    for m in modulos:
        lista = EXTRA.get(m, [])[:] + [t for t in mods.get(m, [])]
        propias = []
        for t in lista:
            if t in vistas or t not in SCHEMA:
                continue
            vistas.add(t); propias.append(t)
            for p, c, h, fk in HIJAS:
                if p == t:
                    vistas.add(h); propias.append(h)
        plan.append((m, propias))
    permitidas = set(vistas)

    creadas, pendientes, archivos, n = set(existentes), [], [], desde
    for m, tablas in plan:
        cuerpo, fks_aqui = [], []
        for t in tablas:
            if t in HIJA_DE:
                p, c, fk_col = HIJA_DE[t]
                perfil = SCHEMA[p]['cols'][c]['sub']
                filas = max(v['n'] for v in perfil.values())
                cols = columnas(t, perfil, filas, permitidas)
                cuerpo += bloque_tabla(t, m, cols, True, padre=(p, fk_col))
                fks = [(t, fk_col, p, 'cascade')]
            else:
                perfil, filas = SCHEMA[t]['cols'], SCHEMA[t]['rows']
                cols = columnas(t, perfil, filas, permitidas)
                cuerpo += bloque_tabla(t, m, cols, t not in GLOBALES)
                fks = [(t, c['nombre'], c['fk'], None) for c in cols if c['fk']]
            if t not in GLOBALES:
                fks.append((t, 'tenant_id', 'tenants', None))
            creadas.add(t)
            fks_aqui += fks
        # Las FK cuyo destino aún no existe pasan a la migración final de relaciones.
        ahora = [f for f in fks_aqui if f[2] in creadas]
        pendientes += [f for f in fks_aqui if f[2] not in creadas]
        extra = []
        for t in tablas:
            for cols_u in UNICOS.get(t, []):
                cols_u = (['tenant_id'] if t not in GLOBALES else []) + cols_u
                extra.append(f"        Schema::table({php_str(t)}, fn (Blueprint $table) => $table->unique([{', '.join(php_str(c) for c in cols_u)}]));")
            if t not in GLOBALES:
                extra.append(f"        DB::statement(\"SELECT enable_tenant_rls('{t}')\");")
                if ya and t not in solo_insercion:
                    extra.append(f"        DB::statement(\"SELECT audit.track('{t}')\");")
            if t in solo_insercion:
                extra.append(f"        DB::statement('REVOKE UPDATE, DELETE, TRUNCATE ON {t} FROM aycha_app');  // solo inserción")
            if t in GLOBALES:
                extra.append(f"        DB::statement(\"COMMENT ON TABLE {t} IS 'global: catálogo de la plataforma, sin RLS'\");")
            if t in GLOBALES and t != 'tenant_hostnames':
                extra.append(f"        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {t} FROM aycha_app');  // catálogo de plataforma")
        nombre = f"{prefijo}_{n:06d}_{m.lower()}_{NOMBRES.get(m, m.lower())}.php"
        archivos.append((nombre, migracion(m, tablas, cuerpo, ahora, extra)))
        n += 100

    nombre_rel = 'relaciones_' + '_'.join(m.lower() for m in modulos) if ya else 'relaciones_entre_modulos'
    archivos.append((f"{prefijo}_{n:06d}_{nombre_rel}.php", migracion_fks(pendientes)))
    for nombre, texto in archivos:
        (salida / nombre).write_text(texto, encoding='utf-8', newline='\n')
    return archivos, plan


def fk_lineas(fks):
    L = []
    for t, col, destino, borrar in fks:
        s = f"        Schema::table({php_str(t)}, function (Blueprint $table) {{ $table->foreign({php_str(col)})->references('id')->on({php_str(destino)})"
        s += '->cascadeOnDelete()' if borrar == 'cascade' else '->restrictOnDelete()'
        s += '; '
        if col != 'tenant_id':
            s += f"$table->index({php_str(col)}); "
        L.append(s + '});')
    return L


def migracion(m, tablas, cuerpo, fks, extra):
    # CASCADE: otras tablas pueden apuntar a estas desde migraciones posteriores
    abajo = '\n'.join(f"        DB::statement('DROP TABLE IF EXISTS {t} CASCADE');" for t in reversed(tablas))
    return f"""<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\DB;
use Illuminate\\Support\\Facades\\Schema;

// {m} · generada desde el modelo del prototipo (tools/prototipo/generar_migraciones.py).
// Tablas: {', '.join(tablas)}.
// El dueño del módulo revisa tipos, únicos y estados antes de construir sus pantallas;
// los cambios se hacen con migraciones nuevas, no editando esta.
return new class extends Migration
{{
    public function up(): void
    {{
{chr(10).join(cuerpo)}

{chr(10).join(fk_lineas(fks))}

{chr(10).join(extra)}
    }}

    public function down(): void
    {{
{abajo}
    }}
}};
"""


def migracion_fks(fks):
    return f"""<?php

use Illuminate\\Database\\Migrations\\Migration;
use Illuminate\\Database\\Schema\\Blueprint;
use Illuminate\\Support\\Facades\\Schema;

// Relaciones entre módulos cuyo destino se crea en una migración posterior a la de su tabla.
return new class extends Migration
{{
    public function up(): void
    {{
{chr(10).join(fk_lineas(fks))}
    }}

    public function down(): void
    {{
{chr(10).join(f"        Schema::table({php_str(t)}, fn (Blueprint $table) => $table->dropForeign([{php_str(c)}]));" for t, c, d, b in fks)}
    }}
}};
"""


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--modulos', required=True)
    ap.add_argument('--prefijo', required=True)
    ap.add_argument('--desde', type=int, default=100)
    ap.add_argument('--salida', default=str(R / 'apps/api/database/migrations'))
    ap.add_argument('--ya', default='', help='módulos ya migrados (sus tablas no se crean; las FK hacia ellas sí)')
    ap.add_argument('--columnas-futuras', action='store_true',
                    help='conservar como columna opcional sin FK lo que apunta a módulos que aún no existen')
    a = ap.parse_args()
    FUTURAS = a.columnas_futuras
    archivos, plan = generar(a.modulos.split(','), a.prefijo, a.desde, pathlib.Path(a.salida),
                             ya=[m for m in a.ya.split(',') if m])
    for m, ts in plan:
        print(f'{m}: {len(ts)} tablas')
    print(f'{len(archivos)} archivos · {sum(len(ts) for _, ts in plan)} tablas')
