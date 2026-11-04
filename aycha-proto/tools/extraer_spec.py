#!/usr/bin/env python3
"""Lee las especificaciones del kit Aycha y genera src/js/01b-spec.js (G.SPEC) y dist/spec.json."""
import re, json, sys, pathlib
KIT = pathlib.Path(sys.argv[1]); R = pathlib.Path(__file__).resolve().parent.parent
def table(sec):
    rows = []
    for ln in sec.splitlines():
        if ln.startswith('|') and not re.match(r'^\|\s*-', ln):
            cells = [c.strip() for c in ln.strip().strip('|').split('|')]
            rows.append(cells)
    return rows[1:] if rows else []
spec = {}
for f in sorted(KIT.glob('docs/fase-*/modulos/*.md')):
    t = f.read_text(encoding='utf-8')
    phase = int(f.parent.parent.name.split('-')[1])
    m = re.match(r'# (\w+) · (.+)', t); code, name = m.group(1), m.group(2).strip()
    secs = {}
    for part in re.split(r'\n## ', t)[1:]:
        head, _, body = part.partition('\n'); secs[head.strip()] = body
    def tb(k): return table(secs.get(k, ''))
    clean = lambda s: s.replace('`', '')
    spec[code] = dict(code=code, name=name, phase=phase, file=str(f.relative_to(KIT)),
      deps=(re.search(r'Depende de: (.+)', t) or [None, ''])[1] if re.search(r'Depende de: (.+)', t) else '',
      objective=secs.get('Objetivo', '').strip(),
      screens=[[r[0], r[1], clean(r[2])] for r in tb('Pantallas') if re.match(r'^[A-Z][A-Z0-9]{1,3}-\d+$', r[0])],
      rules=[[r[0], clean(r[1])] for r in tb('Reglas') if r[0].startswith('RN-')],
      cas=[[r[0], clean(r[1])] for r in tb('Criterios de aceptación') if r[0].startswith('CA-')],
      kpis=[[r[0], r[1], clean(r[2]), r[3] if len(r) > 3 else ''] for r in tb('Indicadores') if r[0].startswith('KPI-')],
      perms=[[clean(r[0]), r[1], [x.strip() for x in re.split(r',| y ', clean(r[2])) if re.match(r'^[A-Z_0-9]+$', x.strip())]] for r in tb('Permisos especiales') if '.' in r[0]],
      params=[[clean(r[0]), clean(r[1]), r[2] if len(r) > 2 else ''] for r in tb('Parámetros') if r[0]],
      decisions=[[r[0], r[1], r[2] if len(r)>2 else ''] for r in tb('Decisiones abiertas') if r[0].startswith('D-')])
(R/'dist').mkdir(exist_ok=True)
(R/'dist/spec.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf-8')
slim = {k: dict(code=v['code'], name=v['name'], phase=v['phase'], screens=v['screens'], perms=v['perms'], params=v['params'], kpis=v['kpis'], rules=v['rules']) for k, v in spec.items()}
js = '/* Generado por tools/extraer_spec.py desde el kit Aycha: pantallas, permisos, parámetros, indicadores y reglas */\nG.SPEC = ' + json.dumps(slim, ensure_ascii=False) + ';\n'
(R/'src/js/01b-spec.js').write_text(js.replace('</script', '<\\/script'), encoding='utf-8')
tot = sum(len(v['screens']) for v in spec.values())
print(len(spec), 'módulos', tot, 'pantallas', sum(len(v['rules']) for v in spec.values()), 'reglas', sum(len(v['cas']) for v in spec.values()), 'CA', sum(len(v['kpis']) for v in spec.values()), 'KPI', sum(len(v['perms']) for v in spec.values()), 'permisos', sum(len(v['params']) for v in spec.values()), 'parámetros', f'{len(js)//1024} KB')
