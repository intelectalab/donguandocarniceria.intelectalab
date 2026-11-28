// Código de barras Code 128 (juego B) en SVG, para las etiquetas de bolsa (BOL-001045-2) que se escanean al cargar (PRE-08).
// Anchos de barra y espacio de cada símbolo 0–106 (106 = parada, con su barra final de 2 módulos).
const PATRONES = (
  "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 " +
  "223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 " +
  "112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 " +
  "311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 " +
  "122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 " +
  "214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");

const INICIO_B = 104;
const PARADA = 106;

/** Símbolos del texto en Code 128 B con su dígito de control. Solo ASCII visible (32 a 126). */
export function simbolos(texto: string): number[] {
  const valores = [...texto].map((c) => {
    const n = c.charCodeAt(0);
    if (n < 32 || n > 126) throw new Error(`Carácter no válido para Code 128: ${c}`);
    return n - 32;
  });
  const control = (INICIO_B + valores.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [INICIO_B, ...valores, control, PARADA];
}

/** Código de barras del texto. alto en px; el ancho se ajusta al contenedor. */
export function Code128({ valor, alto = 56, className = "" }: { valor: string; alto?: number; className?: string }) {
  let x = 10; // zona en blanco a la izquierda (10 módulos)
  const barras: { x: number; w: number }[] = [];
  for (const s of simbolos(valor)) {
    [...PATRONES[s]].forEach((a, i) => {
      const w = Number(a);
      if (i % 2 === 0) barras.push({ x, w });
      x += w;
    });
  }
  const ancho = x + 10;
  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none" role="img" aria-label={`Código de barras ${valor}`} className={className}
      style={{ width: "100%", height: alto, background: "#fff" }}>
      {barras.map((b) => <rect key={b.x} x={b.x} y={0} width={b.w} height={alto} fill="#000" />)}
    </svg>
  );
}
