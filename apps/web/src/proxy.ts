import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { TOKEN_COOKIE } from "@/lib/auth";

// Solo decide a dónde llevar a cada quien según tenga o no sesión: los permisos reales
// los valida la API en cada petición.
const PUBLICAS = ["/login", "/forgot-password", "/reset-password"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const conSesion = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);
  const publica = PUBLICAS.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (!conSesion && !publica) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("volver", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (conSesion && publica) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Todo menos la API (va a Laravel), los archivos de Next y los estáticos.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico|webp)$).*)"],
};
