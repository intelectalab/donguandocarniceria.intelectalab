// Modo de color de la persona (SEG-06): claro, oscuro o el del sistema. Se guarda en su cuenta y,
// para pintar sin parpadeo, también en el navegador («aycha-tema», que lee el script de layout.tsx).

export type ModoColor = "LIGHT" | "DARK" | "SYSTEM";

const CLAVE = "aycha-tema";

/** Aplica el modo en la página y lo recuerda en este navegador. */
export function aplicarModo(modo: ModoColor | string | null | undefined) {
  const valor = modo === "LIGHT" ? "light" : modo === "DARK" ? "dark" : null;
  if (valor) document.documentElement.dataset.theme = valor;
  else delete document.documentElement.dataset.theme;
  try {
    if (valor) localStorage.setItem(CLAVE, valor);
    else localStorage.removeItem(CLAVE);
  } catch {
    // sin almacenamiento: vale mientras la página esté abierta
  }
}
