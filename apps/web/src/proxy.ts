import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/auth";

// Solo decide a dónde llevar a cada quien según tenga o no sesión: los permisos reales
// los valida la API en cada petición.
//  - «/» es la página pública de Aycha (landing): se ve con o sin sesión, como en erp-saas.
//  - El inicio del sistema es «/inicio».
const PUBLICAS = ["/login", "/forgot-password", "/reset-password"];
// Páginas públicas de Aycha (landing): se ven con o sin sesión; con dos dominios, en el de la página.
const PAGINAS = ["/", "/precios"];
const INICIO = "/inicio";

// Dos dominios, como «aycha.pe» (página pública) y «app.aycha.pe» (el sistema), igual que erp-saas.
// Se activa al definir SITE_URL y APP_URL; sin ellas todo vive en un solo dominio.
const SITE_URL = process.env.SITE_URL?.replace(/\/+$/, "");
const APP_URL = process.env.APP_URL?.replace(/\/+$/, "");
const hostOf = (url?: string) => (url ? new URL(url).host.toLowerCase() : null);
const SITE_HOST = hostOf(SITE_URL);
const APP_HOST = hostOf(APP_URL);
const DOS_DOMINIOS = Boolean(SITE_HOST && APP_HOST && SITE_HOST !== APP_HOST);

const coincide = (pathname: string, rutas: string[]) => rutas.some((r) => pathname === r || pathname.startsWith(`${r}/`));

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = DOS_DOMINIOS ? request.headers.get("host")?.toLowerCase() : null;
  const conSesion = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);

  // En el dominio público solo vive la página: lo demás se abre en el del sistema.
  if (DOS_DOMINIOS && host === SITE_HOST && !PAGINAS.includes(pathname)) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, APP_URL));
  }
  // En el dominio del sistema no hay páginas públicas: la raíz lleva al ingreso o al inicio, y las
  // demás páginas públicas se abren en el dominio de la página.
  if (DOS_DOMINIOS && host === APP_HOST && pathname === "/") {
    return NextResponse.redirect(new URL(conSesion ? INICIO : "/login", APP_URL));
  }
  if (DOS_DOMINIOS && host === APP_HOST && PAGINAS.includes(pathname)) {
    return NextResponse.redirect(new URL(`${pathname}${search}`, SITE_URL));
  }
  // Las páginas públicas, con o sin sesión.
  if (PAGINAS.includes(pathname)) return NextResponse.next();

  const publica = coincide(pathname, PUBLICAS);
  if (!conSesion && !publica) {
    const url = new URL("/login", request.url);
    if (pathname !== INICIO) url.searchParams.set("volver", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (conSesion && publica) {
    return NextResponse.redirect(new URL(INICIO, request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Todo menos la API (va a Laravel), los archivos de Next y los estáticos.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
