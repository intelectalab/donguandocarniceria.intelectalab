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
  // Un FormData (archivos) va tal cual: el navegador pone su Content-Type con el separador.
  const archivo = body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-Tenant-Host": window.location.host,
      ...(body !== undefined && !archivo ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: archivo ? body : body !== undefined ? JSON.stringify(body) : undefined,
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

/**
 * Imagen protegida de la API (el logo de una marca…) como URL local para <img>. Devuelve null si no
 * existe. Quien la usa la libera con URL.revokeObjectURL al dejar de mostrarla.
 */
export async function apiImagen(path: string): Promise<string | null> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: { "X-Tenant-Host": window.location.host, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return res.ok ? URL.createObjectURL(await res.blob()) : null;
}

/**
 * Descarga un archivo de la API (una exportación en Excel…) con la sesión del usuario. El nombre
 * sale del encabezado Content-Disposition de la API; si no viene, el de respaldo.
 *   await apiDescargar("/v1/seg/matriz/exportar", "matriz.xlsx");
 */
export async function apiDescargar(path: string, respaldo = "exportacion.xlsx"): Promise<void> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    headers: { Accept: "application/json, application/octet-stream", "X-Tenant-Host": window.location.host, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message ?? "No se pudo descargar el archivo.", res.status, data.code, data.errors);
  }
  const disposicion = res.headers.get("Content-Disposition") ?? "";
  const nombre = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposicion)?.[1];
  const url = URL.createObjectURL(await res.blob());
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombre ? decodeURIComponent(nombre) : respaldo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
