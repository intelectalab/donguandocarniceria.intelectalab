#!/usr/bin/env python3
"""Semillas de PRO, DES y ETQ (fase 2) extraídas del prototipo.

Las tablas de producción no existían cuando se extrajo prototipo.json.gz, así que el prototipo se
vuelve a sembrar (es determinista: mismos lotes, movimientos y recetas) y se guardan aparte solo sus
16 tablas en apps/api/database/seeders/data/prototipo-produccion.json.gz. PrototipoSeeder las suma
a las demás y las inserta con los mismos ids.

1. En el navegador, con el prototipo abierto, pegar extraer_esquema.js y ejecutar
     descargar('produccion.json', semillas('production_lines,production_orders,…'))   (las 16 tablas de TABLAS)
2. python -I tools/prototipo/semillas_produccion.py produccion.json

Correcciones al guardar:
- El prototipo de PRO usa equipos propios (eq-EQ-SEL-L1…) que no son los de EQU: se pasan al equipo de EQU
  equivalente (EQUIPOS).
- Las horas que EQU registró sin orden (production_order_equipment con source = EQU) ya se sembraron en
  equipment_usage (EquDemoSeeder): no se repiten.
- El nombre de quien registró (columna `user` del prototipo) pasa a recorded_by_name.
"""
import gzip, json, pathlib, sys

R = pathlib.Path(__file__).resolve().parents[2]
SALIDA = R / 'apps/api/database/seeders/data/prototipo-produccion.json.gz'
TABLAS = ['production_lines', 'production_orders', 'production_order_consumptions', 'production_order_outputs',
          'production_order_labor', 'production_order_equipment', 'production_ccp_readings', 'cutting_templates',
          'cutting_template_lines', 'cut_reference_prices', 'label_templates', 'label_prints', 'lot_qr_tokens',
          'lot_recalls', 'lot_recall_lots', 'lot_recall_contacts']
EQUIPOS = {'eq-EQ-SEL-L1': 'eq-SEL-L1-01', 'eq-EQ-SEL-L2B': 'eq-SEL-L2-01', 'eq-EQ-MOL-L1': 'eq-MOL-L1-01',
           'eq-EQ-EMB-L1': 'eq-EMB-L2-01', 'eq-EQ-MAR-L2': 'eq-MAR-L2-01', 'eq-EQ-SIE-L1': 'eq-SIE-L1-01',
           'eq-EQ-COC-L2': 'eq-MAR-L2-02', 'eq-EQ-AHU-L1': 'eq-AHU-L2-01', 'eq-EQ-TOS-L2': 'eq-TOS-L2-01',
           'eq-EQ-MOC-L2': 'eq-MOC-L2-01', 'eq-EQ-BAL-L1': 'eq-BAL-L1-03', 'eq-EQ-BAL-L2': 'eq-BAL-L2-01'}


def main(origen):
    t = json.loads(pathlib.Path(origen).read_text(encoding='utf-8'))['tenants']
    out = {k: t[k] for k in TABLAS}
    out['production_order_equipment'] = [r for r in out['production_order_equipment'] if r.get('source') != 'EQU']
    for r in out['production_order_equipment']:
        r['equipment_id'] = EQUIPOS.get(r['equipment_id'], r['equipment_id'])
    for t in ('production_order_consumptions', 'production_order_outputs'):
        for r in out[t]:
            r['recorded_by_name'] = r.pop('user', None)
    for r in out['production_order_outputs']:
        if r.get('scale_equipment_id'):
            r['scale_equipment_id'] = EQUIPOS.get(r['scale_equipment_id'], r['scale_equipment_id'])
    texto = json.dumps({'tenants': out}, ensure_ascii=False, separators=(',', ':'))
    with gzip.open(SALIDA, 'wb', 9) as f:
        f.write(texto.encode('utf-8'))
    print(SALIDA, {k: len(v) for k, v in out.items()})


if __name__ == '__main__':
    main(sys.argv[1])
