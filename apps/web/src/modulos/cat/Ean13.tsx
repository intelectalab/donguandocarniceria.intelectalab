/** Barras EAN-13 en SVG (para la etiqueta de prueba de CAT-11). Usa el color del texto. */
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const R = L.map((p) => p.split("").map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => p.split("").reverse().join(""));
const PARIDAD = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

function patron(codigo: string): string {
  const d = codigo.split("").map(Number);
  const par = PARIDAD[d[0]];
  let s = "101";
  for (let i = 1; i <= 6; i++) s += par[i - 1] === "L" ? L[d[i]] : G[d[i]];
  s += "01010";
  for (let i = 7; i <= 12; i++) s += R[d[i]];
  return s + "101";
}

export function Ean13({ codigo, ancho = 220, alto = 70 }: { codigo: string; ancho?: number; alto?: number }) {
  if (!/^\d{13}$/.test(codigo)) return null;
  const bits = patron(codigo);
  const m = ancho / (bits.length + 14);
  const largas = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  return (
    <svg viewBox={`0 0 ${ancho} ${alto + 18}`} width={ancho} height={alto + 18} role="img" aria-label={`Código de barras ${codigo}`} className="text-ink">
      {bits.split("").map((b, i) => b === "1" && (
        <rect key={i} x={(i + 7) * m} y={0} width={m} height={largas.has(i) ? alto + 4 : alto} fill="currentColor" />
      ))}
      <text x={ancho / 2} y={alto + 16} textAnchor="middle" fontSize="11" fontFamily="monospace" fill="currentColor">{codigo}</text>
    </svg>
  );
}
