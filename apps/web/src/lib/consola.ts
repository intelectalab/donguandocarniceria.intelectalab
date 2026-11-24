import { ApiError } from "./api";
import { CONSOLA_COOKIE } from "./auth";

// Consola de Intelectalab (OPS): sesión propia, separada de la de las empresas. Su token («gcc_…») va en otra
// cookie, que dura solo mientras el navegador está abierto; la API la cierra además por inactividad (RN-OPS-16).

export type UsuarioConsola = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  role_name: string;
  status: string;
  puede: Record<string, boolean>;
};

export function getTokenConsola(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${CONSOLA_COOKIE}=`))?.split("=")[1];
  return raw ? decodeURIComponent(raw) : null;
}

export function setTokenConsola(token: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSOLA_COOKIE}=${encodeURIComponent(token)}; Path=/consola; SameSite=Strict${secure}`;
}

export function clearTokenConsola() {
  document.cookie = `${CONSOLA_COOKIE}=; Path=/consola; Max-Age=0; SameSite=Strict`;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

/** Llama a la API de la consola (/api/v1/consola/...). Sin sesión válida, vuelve al ingreso de la consola. */
export async function apiConsola<T = unknown>(path: string, { body, headers, ...init }: Options = {}): Promise<T> {
  const token = getTokenConsola();
  const res = await fetch(`/api/v1/consola${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) {
      clearTokenConsola();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/consola/ingreso?vencida=1";
    }
    throw new ApiError(data.message ?? "No se pudo completar la operación.", res.status, data.code, data.errors);
  }
  return data as T;
}
