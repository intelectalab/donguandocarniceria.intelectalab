import json, sys
spec = json.load(open('aycha-proto/dist/spec.json', encoding='utf-8'))
pant = {k: len(v['screens']) for k, v in spec.items()}
pant['DEL'] += 6  # DEL-17..22 de la ampliación DELX del prototipo
# Dependencias FUERTES (llama a un servicio del otro módulo). La base (PLT, SEG, MAE, INT, AUD
# como datos y servicios del núcleo, más todas las tablas) ya existe y no cuenta.
FUERTE = {
 'PLT': [], 'SEG': [], 'MAE': [], 'INT': [], 'AUD': [], 'SUS': [], 'TAB': [],
 'CAT': [], 'CLI': [], 'ALM': [], 'FAC': [], 'CAJ': [], 'GAS': [], 'EQU': [], 'REC': [],
 'PED': ['CAT', 'CLI', 'ALM'], 'ADS': ['CAJ', 'GAS'], 'COM': ['ALM', 'CAJ', 'GAS'], 'PRO': ['REC', 'ALM', 'EQU'],
 'CAL': ['ALM'], 'CNT': ['FAC', 'CAJ', 'GAS', 'ALM', 'TAB'], 'ONB': ['SUS', 'CAT', 'CLI', 'ALM', 'FAC'],
 'POS': ['PED', 'ALM', 'FAC', 'CAJ'], 'PRE': ['PED', 'ALM'], 'WEB': ['PED', 'CAJ', 'CAT'], 'CRM': ['PED', 'CLI', 'CAT', 'CAJ'],
 'DEL': ['PED', 'CLI', 'FAC', 'CAJ', 'GAS'], 'TEL': ['CLI', 'PED'], 'B2B': ['PED', 'FAC', 'CAJ', 'CLI', 'CNT'],
 'CMP': ['PED', 'CAJ', 'ADS'], 'CON': ['ALM', 'FAC', 'CAJ', 'CAL', 'CNT'], 'FLO': ['GAS', 'CAL', 'CNT'],
 'PER': ['PED', 'CAJ', 'CNT'], 'PRS': ['GAS', 'FAC', 'CNT', 'COM', 'ADS'], 'DES': ['PRO', 'ALM', 'CAL'],
 'ETQ': ['PRO', 'CAL', 'ALM'], 'GRJ': ['COM', 'CAL', 'ALM'], 'OPS': ['ONB', 'SUS'], 'API': ['SUS', 'PED', 'FAC', 'CAJ'],
 'SEP': ['ALM', 'FAC', 'PED', 'CAJ'],
}
assert set(FUERTE) == set(spec), set(spec) ^ set(FUERTE)
nivel = {}
def niv(m):
    if m not in nivel: nivel[m] = 1 + max([niv(d) for d in FUERTE[m]] or [0])
    return nivel[m]
for m in FUERTE: niv(m)
assert max(nivel.values()) == 3, nivel
for m, ds in FUERTE.items():  # ninguna dependencia fuerte dentro del mismo nivel
    assert all(nivel[d] < nivel[m] for d in ds), m
# Reparto por dominio (docs/revision-del-prototipo.md §8), en orden de prioridad dentro de cada persona.
COLA = {
 'A': ['PLT', 'SEG', 'GAS', 'MAE', 'INT', 'AUD', 'CNT', 'SUS', 'ONB', 'PRS', 'OPS', 'API', 'SEP'],
 'B': ['CAT', 'CLI', 'FAC', 'CAJ', 'PED', 'TAB', 'CRM', 'POS', 'WEB', 'ADS', 'B2B', 'CMP', 'TEL'],
 'C': ['ALM', 'REC', 'EQU', 'COM', 'CAL', 'PRO', 'PRE', 'DEL', 'DES', 'ETQ', 'GRJ', 'CON', 'FLO', 'PER'],
}
CAP = int(sys.argv[1]) if len(sys.argv) > 1 else 17
MIN = 5  # no se empieza un módulo con menos de esto de capacidad libre
hecho = {}            # módulo -> sprint en que termina
resta = dict(pant)
cola = {p: list(c) for p, c in COLA.items()}
plan = []
s = 0
while any(cola.values()):
    s += 1; fila = {}
    for p in 'ABC':
        cap = CAP; trabajo = []
        while cap > 0:
            # 1) se termina primero el módulo ya empezado; 2) si no, el primero de su cola cuyas
            # dependencias fuertes terminaron en sprints anteriores, y solo si quedan >= MIN pantallas
            empezado = [m for m in cola[p] if resta[m] < pant[m]]
            if empezado:
                m = empezado[0]
            else:
                lista = [m for m in cola[p] if all(hecho.get(d, 99) < s for d in FUERTE[m])]
                if not lista or (cap < MIN and cap < CAP): break
                m = lista[0]
            t = min(cap, resta[m]); resta[m] -= t; cap -= t
            trabajo.append((m, t, resta[m] == 0))
            if resta[m] == 0: cola[p].remove(m); hecho[m] = s
        fila[p] = trabajo
    plan.append(fila)
    if s > 40: break
json.dump({'nivel': nivel, 'pant': pant, 'fuerte': FUERTE, 'plan': plan, 'cola': COLA, 'cap': CAP}, open(sys.argv[2] if len(sys.argv) > 2 else 'plan.json', 'w'), ensure_ascii=False)
tot = {p: sum(pant[m] for m in c) for p, c in COLA.items()}
print('niveles:', {n: [m for m in nivel if nivel[m] == n] for n in (1, 2, 3)})
print('pantallas por nivel:', {n: sum(pant[m] for m in nivel if nivel[m] == n) for n in (1, 2, 3)}, 'por persona:', tot)
for i, f in enumerate(plan, 1):
    print(f'S{i:02d}', ' | '.join(f"{p}: " + (', '.join(f"{m}{'' if fin else '…'}({t})" for m, t, fin in f[p]) or '— (libre)') for p in 'ABC'))
