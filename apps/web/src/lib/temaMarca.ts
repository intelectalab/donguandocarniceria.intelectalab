// Colores de la marca (PLT-06) aplicados a todo el sistema: se reescriben las variables de
// globals.css (--primary, --bg, --ink, --side-bg…) en modo claro y oscuro. Una marca sin colores
// propios usa los de la empresa (RN-PLT-23); sin tema, rige la paleta fija de globals.css.

export type Colores = Record<string, string>;
export type TemaMarca = { light: Colores; dark: Colores };

const CLAVES = ["primary", "primary_dark", "accent", "background", "surface", "text", "on_primary"] as const;
export const CLAVE_CSS = "aycha-tema-marca";

/** Solo colores #RRGGBB: nada más llega a la hoja de estilos (evita inyectar CSS). */
const esHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c);
const valido = (t: Colores | null | undefined) => Boolean(t) && CLAVES.every((k) => esHex(t?.[k]));

function variables(t: Colores, oscuro: boolean): string {
  const mezcla = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  const v: Record<string, string> = {
    "--primary": t.primary,
    "--primary-ink": t.on_primary,
    "--primary-soft": mezcla(t.primary, oscuro ? 22 : 12, t.surface),
    "--accent": t.accent,
    "--accent-soft": mezcla(t.accent, oscuro ? 20 : 18, t.surface),
    "--bg": t.background,
    "--surface": t.surface,
    "--surface-2": oscuro ? mezcla(t.text, 6, t.surface) : mezcla(t.accent, 10, t.background),
    "--ink": t.text,
    "--muted": mezcla(t.text, 62, t.background),
    "--line": mezcla(t.text, oscuro ? 16 : 13, t.background),
    // Menú lateral: el primario oscureciéndose hacia abajo (en oscuro, sobre el fondo).
    "--side": t.primary_dark,
    "--side-bg": oscuro
      ? `linear-gradient(180deg, ${mezcla(t.primary_dark, 55, t.background)} 0%, ${mezcla(t.primary_dark, 35, t.background)} 24%, ${mezcla(t.primary_dark, 15, t.background)} 100%)`
      : `linear-gradient(180deg, ${t.primary} 0%, ${mezcla(t.primary, 60, t.primary_dark)} 24%, ${mezcla(t.primary_dark, 75, "#000000")} 100%)`,
    "--side-flyout": oscuro
      ? `linear-gradient(180deg, ${mezcla(t.primary_dark, 35, t.background)} 0%, ${mezcla(t.primary_dark, 15, t.background)} 100%)`
      : `linear-gradient(180deg, ${mezcla(t.primary, 60, t.primary_dark)} 0%, ${mezcla(t.primary_dark, 75, "#000000")} 100%)`,
    "--side-ring": oscuro ? mezcla(t.primary_dark, 35, t.background) : mezcla(t.primary, 60, t.primary_dark),
  };
  return Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");
}

/** Hoja de estilos con los colores del tema, o null si el tema no es válido. */
export function cssDeTema(tema: TemaMarca | null | undefined): string | null {
  if (!tema || !valido(tema.light) || !valido(tema.dark)) return null;
  const claro = variables(tema.light, false);
  const oscuro = variables(tema.dark, true);
  // Mismos selectores que globals.css: al ir después, ganan.
  return `:root{${claro};--brand-gold:${tema.dark.accent}}`
    + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${oscuro}}}`
    + `:root[data-theme="dark"]{${oscuro}}`;
}

/** Pone (o quita) la hoja de la marca y la guarda para aplicarla antes de pintar la próxima vez. */
export function aplicarTema(css: string | null) {
  let estilo = document.getElementById(CLAVE_CSS) as HTMLStyleElement | null;
  if (!css) {
    estilo?.remove();
  } else {
    if (!estilo) {
      estilo = document.createElement("style");
      estilo.id = CLAVE_CSS;
      document.head.appendChild(estilo);
    }
    if (estilo.textContent !== css) estilo.textContent = css;
  }
  try {
    if (css) localStorage.setItem(CLAVE_CSS, css);
    else localStorage.removeItem(CLAVE_CSS);
  } catch {
    // sin almacenamiento: se aplica al cargar /me
  }
}

/**
 * Script del <head>: pone la hoja guardada antes de pintar, para que no se vea un instante la
 * paleta fija. Solo acepta texto con los caracteres que genera cssDeTema y sin url( ni @import.
 */
export const SCRIPT_TEMA = `try{var c=localStorage.getItem('${CLAVE_CSS}');if(c&&c.length<6000&&/^[\\w\\s#:;{}()\\[\\]="%,.\\-@]*$/.test(c)&&!/url|import|expression/i.test(c)){var s=document.createElement('style');s.id='${CLAVE_CSS}';s.textContent=c;document.head.appendChild(s)}}catch(e){}`;
