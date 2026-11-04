#!/usr/bin/env python3
"""Une CSS y JS en un solo HTML: dist/aycha-don-guando.html
Orden JS: src/js/00..04, src/modules/*.js (alfabético), src/js/99-boot.js"""
import pathlib, sys, argparse
R = pathlib.Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument('--only', help='módulos a incluir, separados por coma . Sin esto: todos')
ap.add_argument('--out', default='dist/aycha-don-guando.html')
args = ap.parse_args()
tpl = (R/'src/template.html').read_text(encoding='utf-8')
css = (R/'src/css/app.css').read_text(encoding='utf-8')
extra_css = sorted((R/'src/modules').glob('*.css'))
if args.only:
    keep0 = set(args.only.split(','))
    extra_css = [c for c in extra_css if c.stem in keep0]
css += '\n'.join(p.read_text(encoding='utf-8') for p in extra_css)
core = sorted(p for p in (R/'src/js').glob('*.js') if not p.name.startswith('99'))
mods = sorted((R/'src/modules').glob('*.js'))
if args.only:
    keep = set(args.only.split(','))
    mods = [m for m in mods if m.stem in keep]
boot = [R/'src/js/99-boot.js']
parts = []
for p in core + mods + boot:
    parts.append(f'/* ===== {p.relative_to(R)} ===== */\n' + p.read_text(encoding='utf-8'))
js = '\n;\n'.join(parts)
if '</script' in js.lower():
    sys.exit('ERROR: el JS contiene "</script"; escápalo como "<\\/script"')
out = tpl.replace('/*__CSS__*/', css).replace('/*__JS__*/', js)
(R/'dist').mkdir(exist_ok=True)
outp = R/args.out
outp.parent.mkdir(parents=True, exist_ok=True)
outp.write_text(out, encoding='utf-8')
print(f'{args.out} · {len(out)/1024:.0f} KB · {len(mods)} módulos: ' + ', '.join(m.stem for m in mods))
