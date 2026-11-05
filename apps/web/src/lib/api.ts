import { clearToken, getToken } from "./auth";

/** Error de la API con su código (RN-PED-01, PERMISSION_DENIED, MODULE_DISABLED…) y errores por campo. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mensaje para mostrar al usuario: el de la API (con su código RN si lo trae) o uno genérico. */
export function mensajeDe(err: unknown, porDefecto = "No se pudo completar la operación."): string {
  if (err instanceof ApiError) return err.errors ? Object.values(err.errors)[0]?.[0] ?? err.message : err.message;
  return err instanceof Error ? err.message : porDefecto;
}

/** Errores de validación (422) por campo, con el primer mensaje de cada uno: { ruc: "El RUC…" }. */
export function erroresDe(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.errors) return {};
  return Object.fromEntries(Object.entries(err.errors).map(([campo, msgs]) => [campo, msgs[0]]));
}

/** Respuesta de una lista paginada (App\Support\Listado en la API). */
export type Pagina<T> = { data: T[]; current_page: number; last_page: number; per_page: number; total: number };

type Options = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * Llama a la API de Laravel (/api/v1/...). Envía el token y el dominio de la empresa
 * (X-Tenant-Host): la API resuelve la empresa por el dominio y RLS filtra los datos.
 *   const pedidos = await api<Pedido[]>("/v1/sales-orders");
 *   await api("/v1/sales-orders", { method: "POST", body: { ... } });
 */
export async function api<T = unknown>(path: string, { body, headers, ...init }: Options = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Tenant-Host": window.location.host,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // Sesión vencida o cerrada en otro lado: vuelve al ingreso.
    if (res.status === 401 && token) {
      clearToken();
      // Recarga completa a propósito: descarta el estado de la sesión anterior.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (!window.location.pathname.startsWith("/login")) window.location.href = "/login";
    }
    throw new ApiError(data.message ?? "No se pudo completar la operación.", res.status, data.code, data.errors);
  }
  return data as T;
}
