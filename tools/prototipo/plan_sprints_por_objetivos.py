#!/usr/bin/env python3
"""Borrador de sprints por objetivos (alternativa a plan_sprints.py, que reparte por carga).

Cada sprint tiene un objetivo que se puede mostrar; cada persona sigue su carril; un módulo no se
parte. El script valida que ninguna dependencia fuerte termine en el mismo sprint o después, y
escribe docs/plan-de-sprints-por-objetivos.md.

Uso (desde la raíz del repo):  python -I tools/prototipo/plan_sprints_por_objetivos.py
"""
import json
import pathlib
import re

R = pathlib.Path(__file__).resolve().parents[2]
spec = json.loads((R / 'aycha-proto/dist/spec.json').read_text(encoding='utf-8'))
nombre = {m['code']: m['name'] for m in json.loads((R / 'apps/web/src/lib/modulos.json').read_text(encoding='utf-8'))}
menu = json.loads((R / 'apps/web/src/lib/menu-prototipo.json').read_text(encoding='utf-8'))

pant = {k: len(v['screens']) for k, v in spec.items()}
pant['DEL'] += 6  # DEL-17..22 de la ampliación del prototipo

# Las mismas dependencias FUERTES de plan_sprints.py (llama a un servicio del otro módulo).
ns = {}
exec((R / 'tools/prototipo/plan_sprints.py').read_text(encoding='utf-8').split('assert set(FUERTE)')[0]
     .replace('import json, sys', 'import json, sys\nsys.argv = ["x"]'), ns)
FUERTE = dict(ns['FUERTE'])
# CNT congela los indicadores de TAB al cerrar el período: es un evento (period.closed), no una llamada.
FUERTE['CNT'] = [d for d in FUERTE['CNT'] if d != 'TAB']

PERS = {'A': 'A · Plataforma, finanzas y SaaS', 'B': 'B · Comercial', 'C': 'C · Operación y producción'}
HITOS = [
    ('Empresa, catálogo y stock', 'La empresa con sus marcas, locales y series; el catálogo con precios; el stock por almacén y lote.',
     {'A': ['PLT'], 'B': ['CAT'], 'C': ['ALM']}),
    ('Usuarios, clientes y lotes liberados', 'Usuarios con rol y alcance; clientes con dirección con pin y zona; lotes que calidad libera o bloquea.',
     {'A': ['SEG'], 'B': ['CLI'], 'C': ['CAL']}),
    ('Tomar pedidos completos', 'Un pedido de cualquier canal que no se confirma sin sus datos; recetas listas para producir.',
     {'A': ['MAE'], 'B': ['PED'], 'C': ['REC']}),
    ('Pedido preparado y facturado', 'El pedido se prepara con escaneo y bolsas numeradas y sale con su boleta o factura; gastos con comprobante.',
     {'A': ['GAS'], 'B': ['FAC'], 'C': ['PRE']}),
    ('Cobrar y conciliar', 'Cobros con su referencia, aplicados al pedido y conciliados; conectores e integraciones; equipos y mantenimiento.',
     {'A': ['INT'], 'B': ['CAJ'], 'C': ['EQU']}),
    ('Mostrador, reparto y contabilidad', 'Venta en mostrador con balanza, reparto con ruta y cobro contra entrega, y cada venta con su asiento.',
     {'A': ['CNT'], 'B': ['POS'], 'C': ['DEL']}),
    ('Producir', 'Órdenes de producción con costo real; tablero de indicadores; auditoría y exportaciones.',
     {'A': ['AUD'], 'B': ['TAB'], 'C': ['PRO']}),
    ('WhatsApp y comprar', 'Bandeja omnicanal con control de vendedoras; compras y cuentas por pagar; planes del SaaS.',
     {'A': ['SUS'], 'B': ['CRM'], 'C': ['COM']}),
    ('Tienda web y producción completa', 'Pedidos de la web con Mercado Pago, anuncios atribuidos a ventas, despiece y etiquetas con trazabilidad.',
     {'A': ['ONB'], 'B': ['WEB', 'ADS'], 'C': ['DES', 'ETQ']}),
    ('Clientes empresariales y consignación', 'Portal B2B con crédito, consignación con visitas y liquidación; consola de plataforma.',
     {'A': ['OPS'], 'B': ['B2B'], 'C': ['CON']}),
    ('Campañas, granja y flota', 'Campañas y fidelización, integración con la granja, flota con costo por vehículo; API pública.',
     {'A': ['API'], 'B': ['CMP'], 'C': ['GRJ', 'FLO']}),
    ('Personal, presupuesto y llamadas', 'Personal y comisiones, presupuesto contra lo real, separación de marcas y telefonía.',
     {'A': ['PRS', 'SEP'], 'B': ['TEL'], 'C': ['PER']}),
]

# Validación: todos los módulos una vez, y ninguna dependencia fuerte en el mismo sprint o después.
todos = [m for _, _, f in HITOS for ms in f.values() for m in ms]
assert sorted(todos) == sorted(spec), set(spec) ^ set(todos)
fin = {m: i for i, (_, _, f) in enumerate(HITOS, 1) for ms in f.values() for m in ms}
dueno = {m: p for _, _, f in HITOS for p, ms in f.items() for m in ms}
bloqueos = [f'{m} necesita {d}' for m in fin for d in FUERTE[m] if fin[d] >= fin[m]]
assert not bloqueos, bloqueos
nivel = {}


def niv(m):
    if m not in nivel:
        nivel[m] = 1 + max([niv(d) for d in FUERTE[m]] or [0])
    return nivel[m]


for m in FUERTE:
    niv(m)
BASE = {'PLT', 'SEG', 'MAE', 'INT', 'AUD'}


def debiles(m):
    txt = spec[m]['deps'].split('Lo usan')[0].split('La usan')[0]
    txt = re.sub(r'y emite eventos para.*', '', txt)
    return [c for c in dict.fromkeys(re.findall(r'\b([A-Z]{3})\b', txt))
            if c in spec and c != m and c not in BASE and c not in FUERTE[m]]


deb = {m: debiles(m) for m in spec}
tarde = sorted((fin[d], m, d) for m in spec for d in deb[m] if fin[d] > fin[m])

L = []
w = L.append
w('# Plan de sprints por objetivos · 3 personas (BORRADOR)\n')
w('> Copia para analizar. **No reemplaza** a `docs/plan-de-sprints.md` (que reparte por carga) hasta que el equipo '
  'lo decida. Se genera con `python -I tools/prototipo/plan_sprints_por_objetivos.py`.\n')
w('## 1. En qué se diferencia del plan por carga\n')
w('| | Plan por carga (`plan-de-sprints.md`) | Este plan por objetivos |\n|---|---|---|')
w('| Criterio | Llenar ~17 pantallas por persona y sprint | Cada sprint tiene un objetivo que se puede mostrar al cerrarlo |')
w('| Cada persona | Salta de tema cuando un hueco lo pide | Sigue su carril (A plataforma → finanzas → SaaS; B vender → cobrar → canales; C stock → preparar → repartir → producir) |')
w('| Módulos | Se parten entre sprints para rellenar | Un módulo, un sprint (salvo dos módulos chicos juntos) |')
w('| Sprints | 11 | 12 |')
w('| Carga | Pareja | Desigual: algunos sprints de 22 pantallas y otros de 8 a 10 |')
w('| Bloqueos | Ninguno | Ninguno (verificado por el script) |\n')
w('Las dependencias y los niveles son los mismos de `plan-de-sprints.md` (sección 1): **fuerte** = llama a un '
  'servicio de otro módulo y bloquea; **débil** = solo usa sus tablas y no bloquea. Única diferencia: CNT ya no '
  'espera a TAB, porque el congelamiento de indicadores al cerrar un período lo dispara un evento.\n')

w('## 2. Sprints\n')
w('| Sprint | Objetivo | ' + ' | '.join(PERS[p] for p in 'ABC') + ' |\n|---|---|---|---|---|')
for i, (obj, _, f) in enumerate(HITOS, 1):
    celdas = [' + '.join(f'{m} ({pant[m]})' for m in f[p]) for p in 'ABC']
    w(f'| **S{i:02d}** | {obj} | ' + ' | '.join(celdas) + ' |')
w('')

w('## 3. Qué se puede mostrar al cerrar cada sprint\n')
for i, (obj, demo, f) in enumerate(HITOS, 1):
    w(f'- **S{i:02d} · {obj}:** {demo}')
w('')

w('## 4. Carga por persona y sprint (pantallas)\n')
w('| Sprint | A | B | C |\n|---|---:|---:|---:|')
for i, (_, _, f) in enumerate(HITOS, 1):
    w(f'| S{i:02d} | ' + ' | '.join(str(sum(pant[m] for m in f[p])) for p in 'ABC') + ' |')
w('| **Total** | ' + ' | '.join(str(sum(pant[m] for m in todos if dueno[m] == p)) for p in 'ABC') + ' |')
w('\n**Sprints pesados:** C en S06 (Delivery, 22 pantallas, incluida su app del repartidor) y en S11 (GRJ + FLO, 22), y '
  'A en S12 (PRS + SEP, 22). Hay que vigilarlos: si no alcanzan, se pasa la parte que sobra al sprint siguiente de '
  'esa persona. **Sprints livianos:** A en S07 (8) y C en S05 (9); ese tiempo se usa para conectar integraciones '
  'pendientes y para la prueba del objetivo del sprint.\n')
w('**Por qué C alterna un poco** (REC en S03 y EQU en S05, entre preparación y reparto): Preparación necesita '
  'Pedidos (B, S03) y Delivery necesita Comprobantes y Caja (B, S04 y S05). Mientras tanto, C adelanta la base de '
  'producción en lugar de esperar.\n')

w('## 5. Detalle por módulo (en el orden del menú)\n')
w('| Módulo | Nivel | Dueño | Pantallas | Sprint | Depende (fuerte) | Lee de (débil) |\n|---|:---:|:---:|---:|---|---|---|')
for m in [m for g in menu['groups'] for m in g['mods']]:
    fu = ', '.join(f'{d} (S{fin[d]:02d})' for d in FUERTE[m]) or 'solo la base'
    w(f"| **{m}** {nombre[m]} | {nivel[m]} | {dueno[m]} | {pant[m]} | S{fin[m]:02d} | {fu} | {', '.join(deb[m]) or '—'} |")
w('\nEntre paréntesis, el sprint en que termina cada dependencia fuerte; siempre es anterior.\n')

w('## 6. Integraciones débiles que se conectan después\n')
w('La conecta el dueño del módulo que termina segundo, en su sprint:\n')
w('| Se conecta en | Módulo | Con | Quién |\n|---|---|---|---|')
for s, m, d in tarde:
    w(f'| S{s:02d} | {m} {nombre[m]} | {d} {nombre[d]} | {dueno[d]} |')
w(f'\nSon {len(tarde)}.\n')
w('## 7. Lo que sigue igual que en el plan por carga\n')
w('- El reparto por dominio y las reglas para no bloquearse (contrato antes que código, nadie escribe en tablas '
  'ajenas, pruebas por cada criterio CA).')
w('- Las integraciones externas deben estar listas antes del sprint de su módulo: mapas (CLI, S02), SUNAT (FAC, S04), '
  'WhatsApp (CRM, S08), WooCommerce y Mercado Pago (WEB, S09), anuncios (ADS, S09), granja (GRJ, S11), Ayni HR (PER, '
  'S12) y telefonía (TEL, S12).')
w('- El segundo factor sigue pendiente por decisión del equipo.')

(R / 'docs/plan-de-sprints-por-objetivos.md').write_text('\n'.join(L) + '\n', encoding='utf-8', newline='\n')
print(f'docs/plan-de-sprints-por-objetivos.md · {len(HITOS)} sprints · {len(tarde)} integraciones a conectar · sin bloqueos')
