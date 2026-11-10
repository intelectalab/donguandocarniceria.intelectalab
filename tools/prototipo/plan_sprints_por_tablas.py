#!/usr/bin/env python3
"""Plan de sprints por tablas (reemplaza los dos planes anteriores a partir del sprint 2).

Criterio: un módulo depende de otro si CUALQUIER columna de sus tablas apunta a una tabla del otro,
sea obligatoria u opcional. Una pantalla se entrega con todos sus campos funcionando; no se deja
«para después» un campo porque la base lo admita vacío.

Las dependencias salen de las migraciones reales (apps/api/database/migrations), no de la spec.
Las únicas excepciones son los CORTES: enlaces que cierran un círculo (A necesita a B y B a A) y
que, de bloquear, impedirían empezar cualquiera de los dos. Cada corte se lista con su columna
exacta y quién lo completa.

Uso (desde la raíz del repo):  python -I tools/prototipo/plan_sprints_por_tablas.py
Escribe docs/plan-de-sprints-por-tablas.md (los dos planes anteriores se conservan para comparar).
"""
import collections
import glob
import json
import pathlib
import re

R = pathlib.Path(__file__).resolve().parents[2]
MIG = R / 'apps/api/database/migrations'
spec = json.loads((R / 'aycha-proto/dist/spec.json').read_text(encoding='utf-8'))
nombre = {m['code']: m['name'] for m in json.loads((R / 'apps/web/src/lib/modulos.json').read_text(encoding='utf-8'))}
pant = {k: len(v['screens']) for k, v in spec.items()}
pant['DEL'] += 6  # DEL-17..22 de la ampliación del prototipo

# La base: módulos de la fase 0 (ya hechos o de la persona A) y tablas comunes. No cuentan como dependencia.
BASE = {'PLT', 'SEG', 'MAE', 'INT', 'AUD', 'NUC'}
NO_MODULO = {'BASE', 'RELACIONES', 'EVENTOS', 'TEXTOS', 'IDS'}

# ---- 1. Dependencias desde las migraciones --------------------------------------------------
dueno = {}
for f in sorted(glob.glob(str(MIG / '2026_11_03_*.php'))):
    mod = re.search(r'2026_11_03_\d+_([a-z]+)_', f).group(1).upper()
    s = open(f, encoding='utf-8').read()
    for t in re.findall(r"Schema::create\('([a-z_]+)'", s):
        dueno.setdefault(t, mod)

nullable = {}
refs = []  # (tabla, columna, tabla destino)
for f in sorted(glob.glob(str(MIG / '2026_11_03_*.php'))):
    s = open(f, encoding='utf-8').read()
    for blk in re.finditer(r"Schema::create\('([a-z_]+)'(.*?)\n        \}\);", s, re.S):
        t = blk.group(1)
        for line in blk.group(2).split('\n'):
            m = re.search(r"uuid\('([a-z_]+)'\)", line)
            if m:
                nullable[(t, m.group(1))] = 'nullable' in line
            m = re.search(r"uuid\('([a-z_]+)'\)[^\n]*apunta a ([a-z_]+)", line)
            if m:
                refs.append((t, m.group(1), m.group(2)))
    for t, blk in re.findall(r"Schema::table\('([a-z_]+)'(.*?)\}\);", s, re.S):
        for col, dest in re.findall(r"foreign\('([a-z_]+)'\)->references\('id'\)->on\('([a-z_]+)'\)", blk):
            refs.append((t, col, dest))

# Módulos de las fases 2 a 4 que aún no tienen migración: dependencias de la spec (depends_on + uses).

enlaces = collections.defaultdict(lambda: collections.defaultdict(list))  # a -> b -> [(tabla.col, oblig)]
for t, col, dest in refs:
    a, b = dueno.get(t), dueno.get(dest)
    if not a or not b or a == b or a in NO_MODULO or b in NO_MODULO:
        continue
    enlaces[a][b].append((f'{t}.{col}', not nullable.get((t, col), True)))

# ---- 2. Cortes de círculos: el único «para después» del plan --------------------------------
# (quien corta, de quién, columnas, quién lo completa y cómo)
CORTES = [
    ('ALM', 'PED', 'La reserva de stock por pedido (stock_reservations) es un concepto de Pedidos: PED crea esa tabla al confirmar pedidos. ALM entrega el stock, los lotes y los movimientos sin reservas.'),
    ('ALM', 'CLI', 'warehouses.customer_id es el almacén en consignación de un cliente (CON, fase 3). ALM lo deja vacío; CON lo usa.'),
    ('PED', 'CRM', 'El canal de origen del pedido: hoy se vende por WhatsApp y mostrador y el pedido nace sin conversación enlazada. CRM enlaza al llegar.'),
    ('PED', 'WEB', 'Pedidos de la tienda web: WEB los crea y enlaza cuando exista.'),
    ('PED', 'POS', 'Turno y terminal de mostrador: POS los enlaza cuando exista.'),
    ('FAC', 'POS', 'Turno y terminal de mostrador en el comprobante: POS los enlaza.'),
    ('FAC', 'PED', 'Un comprobante puede emitirse sin pedido (FAC-03 Emisión directa). FAC-02 Emitir desde el pedido se termina cuando PED exista; si PED va antes, no hay corte.'),
    ('CAJ', 'DEL', 'Liquidación del repartidor (driver_settlements.route_ref): DEL la enlaza.'),
    ('CAJ', 'POS', 'Cobro en turno de mostrador: POS lo enlaza.'),
    ('CRM', 'ADS', 'Anuncio que originó la conversación: ADS lo enlaza.'),
    ('GAS', 'ADS', 'Campaña publicitaria de un gasto: ADS la enlaza.'),
    # Fases 2 a 4 (dependencias de la spec, sin migración todavía).
    ('CNT', 'COM', 'Contabilidad arranca con ventas, cobros y gastos (FAC, CAJ, GAS). Los asientos de compras los suma COM al llegar.'),
    ('CNT', 'GRJ', 'Los asientos de la granja los suma GRJ al llegar.'),
    ('COM', 'GRJ', 'Las compras a la granja propia las enlaza GRJ.'),
    ('PRO', 'DES', 'Producción produce con recetas; el despiece (DES) toma la orden de producción después.'),
    ('ETQ', 'GRJ', 'Las etiquetas salen de producción y almacén; el origen de granja se agrega con GRJ.'),
    ('FLO', 'PER', 'La flota arranca con vehículos y rutas; el enlace con choferes y planilla lo pone PER.'),
    ('PER', 'TEL', 'Telefonía está aplazada por gerencia; Personal se hace sin el enlace a llamadas.'),
    ('SUS', 'ONB', 'Planes y suscripciones es la base de la consola; el alta de empresas (ONB) la usa después.'),
    ('SUS', 'OPS', 'Ídem: la consola de soporte (OPS) se apoya en SUS.'),
    # Tableros propios: cada módulo registra sus indicadores en el catálogo de TAB. El módulo no espera
    # a TAB; su pantalla de tablero (CNT-16, PRO-12, CAL-13…) se completa cuando TAB exista.
    ('CNT', 'TAB', 'CNT-16 Tablero contable y el congelamiento al cerrar el mes se completan cuando TAB exista; el resto de CNT no los necesita.'),
    ('PRO', 'TAB', 'PRO-12 Tablero de producción se completa cuando TAB exista.'),
    ('PER', 'FLO', 'Solo la línea «multas» de PER-12 Pagos al personal viene de Flota: se suma cuando FLO exista. (El otro lado, FLO→PER, también está cortado: los dos se hacen sin esperarse.)'),
    ('PRS', 'PER', 'Solo la bajada a planillas de PRS-07 Detalle del real: se suma cuando PER exista.'),
]
corte = {(a, b): why for a, b, why in CORTES}

dep = {}
con_migracion = set(dueno.values())
for a in set(list(enlaces) + list(pant)):
    if a in BASE or a in NO_MODULO:
        continue
    d = {b for b in enlaces.get(a, {}) if b not in BASE and (a, b) not in corte}
    if a not in con_migracion:
        # Sin migración propia (fases 2 a 4): se suma lo que nombra la spec en «deps», todas las que nombra.
        d |= {x for x in re.findall(r'\b([A-Z]{3})\b', spec.get(a, {}).get('deps', ''))
              if x not in BASE and x != a and x in pant and (a, x) not in corte}
    dep[a] = d

# TAB no apunta a otras tablas: los indicadores llegan por catálogo (kpi_definitions). La spec dice
# que depende «de todos los módulos que registran indicadores», y sus seis tableros nombran su fuente.
dep['TAB'] = {'PED', 'CAJ', 'DEL', 'PRE', 'CRM', 'ADS', 'GAS', 'ALM', 'FAC'} - BASE

# ---- 3. Sprints ------------------------------------------------------------------------------
HECHO = {'PLT': 1, 'CAT': 1}  # sprint 1, ya entregados
PERS = {'A': 'A · Plataforma, finanzas y SaaS', 'B': 'B · Comercial', 'C': 'C · Operación y producción'}
CARRIL = {
    # AUD va después de SUS para que A no quede sin nada en S05 (GAS espera a CAJ).
    'A': ['SEG', 'MAE', 'INT', 'SUS', 'AUD', 'GAS', 'CNT', 'API', 'ONB', 'OPS', 'SEP', 'PRS'],
    'B': ['CLI', 'PED', 'FAC', 'CAJ', 'POS', 'TAB', 'CRM', 'WEB', 'ADS', 'B2B', 'CMP', 'TEL'],
    'C': ['ALM', 'REC', 'EQU', 'PRE', 'DEL', 'CAL', 'PRO', 'COM', 'DES', 'ETQ', 'CON', 'GRJ', 'FLO', 'PER'],
}
MAX = 22  # pantallas por persona y sprint (tope; se junta un módulo chico con otro si cabe)
MIN = 8   # nadie termina un sprint con menos de esto si hay algún módulo libre en otro carril

sprint = dict(HECHO)
plan = collections.defaultdict(lambda: collections.defaultdict(list))
pend = {p: list(ms) for p, ms in CARRIL.items()}
libre = lambda m, n: all(sprint.get(d, 99) < n for d in dep.get(m, set()))
compartido = {}  # módulo -> (persona dueña, persona que ayuda): un módulo hecho entre dos
n = 2
while any(pend.values()) and n < 20:
    carga = {p: 0 for p in PERS}
    # 1) Cada persona toma, en el orden de su carril, lo que está libre y le cabe.
    for p, ms in pend.items():
        for m in list(ms):
            if libre(m, n) and carga[p] + pant[m] <= MAX:
                sprint[m] = n; plan[n][p].append(m); ms.remove(m); carga[p] += pant[m]
    # 2) Nadie se queda sin trabajo: quien quedó por debajo de MIN toma el módulo libre más chico
    #    de la persona más cargada (siempre que a ella le quede algo libre para el siguiente sprint).
    cambio = True
    while cambio:
        cambio = False
        for p in sorted(PERS, key=lambda q: carga[q]):
            if carga[p] >= MIN or not any(pend.values()):
                continue
            for q in sorted(PERS, key=lambda r: -carga[r]):
                if q == p:
                    continue
                candidatos = [m for m in pend[q] if libre(m, n) and carga[p] + pant[m] <= MAX]
                if candidatos:
                    m = min(candidatos, key=lambda x: pant[x])
                    sprint[m] = n; plan[n][p].append(m); pend[q].remove(m); carga[p] += pant[m]
                    cambio = True
                    break
    # 3) Si alguien sigue sin nada y otro tiene un módulo de 12 pantallas o más, lo hacen entre los dos.
    #    Es lo que pasa al final: a una persona se le acabó el carril y queda un módulo de 15 para otra.
    for p in PERS:
        if carga[p] > 0:
            continue
        for q in sorted(PERS, key=lambda r: -carga[r]):
            solos = [m for m in plan[n][q] if pant[m] >= 12 and m not in compartido]
            if q != p and solos:
                m = solos[0]
                plan[n][p].append(m); compartido[m] = (q, p); carga[p] += pant[m] // 2; carga[q] -= pant[m] // 2
                break
    n += 1
assert not any(pend.values()), f'módulos sin ubicar: {pend}'

# ---- 4. Documento ----------------------------------------------------------------------------
def lista(ms):
    return ', '.join(f'{m} ({pant[m]})' + (' *entre dos*' if m in compartido else '') for m in ms) or '—'

out = ['# Plan de sprints · 3 personas', '',
       'Generado con `python -I tools/prototipo/plan_sprints_por_tablas.py` desde las migraciones reales. Los dos planes anteriores (`plan-de-sprints.md` por carga y `plan-de-sprints-por-objetivos.md`) se conservan para comparar; el equipo decide cuál rige.', '',
       '## 1. Criterio', '',
       '- **Un módulo depende de otro si cualquier columna de sus tablas apunta a una tabla del otro, sea obligatoria u opcional.** Una pantalla se entrega con todos sus campos funcionando: no se deja un campo «para después» porque la base lo admita vacío.',
       '- La base (PLT, SEG, MAE, INT, AUD y las tablas comunes `vehicles` y `suppliers`) no cuenta como dependencia: existe desde el inicio.',
       '- **Cortes:** la spec tiene círculos (ALM necesita a PED y PED a ALM…). Si todos bloquearan, nadie podría empezar. Los únicos enlaces que se dejan para después son los de la sección 3, listados con su columna exacta y quién los completa. Son 11 en todo el plan.',
       '- Módulos de las fases 2 a 4 sin migración todavía: dependencias según la spec del prototipo (campo «deps», todas las que nombra).',
       '', '## 2. Sprints', '',
       'El sprint 1 ya se entregó: **PLT** (14, A) y **CAT** (12, B). **ALM** era del sprint 1 y no se hizo: pasa al sprint 2 y es lo más urgente, porque PED, FAC, PRE, CAL, EQU y COM lo necesitan.', '',
       '| Sprint | ' + ' | '.join(PERS.values()) + ' |', '|---|---|---|---|',
       '| **S01** (hecho) | PLT (14) | CAT (12) | — (ALM pendiente) |']
for s in sorted(plan):
    out.append(f'| **S{s:02d}** | ' + ' | '.join(lista(plan[s][p]) for p in PERS) + ' |')
carga_total = {p: sum(pant[m] for s in plan for m in plan[s][p]) + (14 if p == 'A' else 12 if p == 'B' else 0) for p in PERS}
for p in PERS:  # un módulo compartido entre dos cuenta la mitad para cada uno
    carga_total[p] -= sum(pant[m] // 2 for s in plan for m in plan[s][p] if m in compartido)
out.append('| **Pantallas** | ' + ' | '.join(str(carga_total[p]) for p in PERS) + ' |')
out += ['', '## 3. Cortes de círculos (lo único que se completa después)', '',
        '| Módulo | Deja para después | Columnas | Quién lo completa |', '|---|---|---|---|']
for a, b, why in CORTES:
    cols = ', '.join(f'`{c}`' + (' **(obligatoria)**' if o else '') for c, o in enlaces.get(a, {}).get(b, []))
    # Sin migración todavía (fases 2 a 4): la dependencia viene de la spec, no hay columna que mostrar.
    out.append(f'| {a} | {b} | {cols or "(según la spec; sin migración aún)"} | {why} |')
out += ['', '## 4. Cada módulo', '',
        '| Módulo | Persona | Pantallas | Sprint | Bloqueado por (todas las tablas que usa) | Se completa después |',
        '|---|---|---|---|---|---|']
persona = {m: p for p, ms in CARRIL.items() for m in ms}
persona.update({'PLT': 'A', 'CAT': 'B'})
for m in sorted(sprint, key=lambda x: (sprint[x], persona.get(x, 'Z'), x)):
    bloq = ', '.join(f'{d} (S{sprint[d]:02d})' for d in sorted(dep.get(m, set()), key=lambda d: sprint[d])) or 'solo la base'
    desp = ', '.join(b for a, b, _ in CORTES if a == m) or '—'
    out.append(f'| **{m}** {nombre.get(m, m)} | {persona.get(m, "?")} | {pant[m]} | S{sprint[m]:02d}{" (hecho)" if m in HECHO else ""} | {bloq} | {desp} |')
out += ['', '## 5. Reglas', '',
        '1. **Nada se entrega con un campo colgado.** Si una pantalla tiene un selector de lote, vehículo o cliente, ese selector funciona el día que se entrega. Por eso el módulo espera a quien le da el dato.',
        '2. **Los cortes de la sección 3 son los únicos huecos permitidos.** Quien completa el enlace lo hace en su propio sprint y lo anota en `docs/cambios/`.',
        '3. **Contrato antes que código.** Al empezar un módulo que otros usan, su dueño publica primero en `docs/contratos.md` la firma de sus servicios. Los de PLT ya están en `docs/como-construir-un-modulo.md`: `Correlativo::emitir`, `Periodos::abierto`, `Marcas::activa`, `CentrosCosto::activo`, `Params::get`, `Busqueda::publicar`.',
        '4. **Las tablas ya existen** para las fases 0 y 1 (más CAL, REC y EQU): el dueño revisa tipos, únicos y estados antes de hacer sus pantallas y cambia con migraciones nuevas, nunca editando las existentes.',
        '5. Se regenera con el script cuando cambie una migración o un corte; no se edita a mano.',
        '', '## 6. Huecos del plan y por qué están', '',
        '- **ALM es lo más urgente:** era del sprint 1 y no está. PED (S03), FAC (S04), PRE, CAL, EQU y COM lo necesitan. Si no entra en S02, todo lo de C se corre un sprint.',
        '- **TAB va al final de la fase 1** (no al principio): sus seis tableros muestran números de PED, CAJ, DEL, PRE, CRM y ADS. Sin ellos es una cáscara. Como TAB no apunta a otras tablas (los indicadores llegan por catálogo), el script lo sabe por una regla explícita, no por la base.',
        '- **A tiene sprints sin módulo:** GAS espera a CAJ (`expenses.paid_from_account_id`, la cuenta de caja desde la que se paga un gasto), y lo demás de A depende de módulos de B y C. Esos sprints A los usa para lo que no es pantalla: la conexión con el proveedor de facturación electrónica (OSE/PSE) que FAC necesita, los respaldos y el despliegue, y los cortes de la sección 3 que le tocan.',
        '- **DEL en S07 con 22 pantallas** es el sprint más pesado: DEL necesita GAS y GAS necesita CAJ. No se adelanta sin cortar un enlace real.',
        '- **C se queda sin módulos libres en varios sprints:** todo lo de producción (PRO, DES, COM, ETQ, GRJ) espera a CAL, que espera a FAC. Es el costo de no dejar campos colgados; esos sprints C puede apoyar a B, que es quien más carga lleva.',
        '- **Los sprints finales son de una sola persona** (PRS depende de casi todo). Es normal: los últimos módulos son los que consolidan al resto.', '']
(R / 'docs/plan-de-sprints-por-tablas.md').write_text('\n'.join(out), encoding='utf-8', newline='\n')
print('\n'.join(out[12:14 + len(plan)]))
