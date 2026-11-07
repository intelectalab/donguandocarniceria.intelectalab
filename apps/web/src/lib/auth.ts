// Token de Sanctum en una cookie: el proxy la lee para redirigir y el cliente de la API la envía.
// Con "Mantener la sesión", dura lo mismo que el token largo de la API (30 días).
export const TOKEN_COOKIE = "aycha_token";
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${TOKEN_COOKIE}=`))?.split("=")[1];
  return raw ? decodeURIComponent(raw) : null;
}

export function setToken(token: string, remember: boolean) {
  const lifetime = remember ? `; Max-Age=${REMEMBER_MAX_AGE}` : "";
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/${lifetime}; SameSite=Lax${secure}`;
}

export function clearToken() {
  document.cookie = `${TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  // Sin sesión, sin los colores de la empresa anterior (lib/temaMarca).
  document.getElementById("aycha-tema-marca")?.remove();
  try {
    localStorage.removeItem("aycha-tema-marca");
  } catch {}
}
