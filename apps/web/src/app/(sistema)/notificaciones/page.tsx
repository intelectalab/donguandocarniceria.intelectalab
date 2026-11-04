"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { api } from "@/lib/api";
import { haceCuanto, marcarLeida, marcarTodas, type Notificacion } from "@/lib/notificaciones";

type Pagina = { data: Notificacion[]; current_page: number; last_page: number; total: number };

/** Todas las notificaciones de la persona, paginadas; un clic abre lo que la originó. */
export default function Notificaciones() {
  const router = useRouter();
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<Pagina | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(() => {
    api<Pagina>(`/v1/me/notifications?page=${pagina}&per_page=20`).then(setDatos).catch((e) => setError(e.message));
  }, [pagina]);

  // La carga actualiza el estado al responder la API.
  useEffect(() => cargar(), [cargar]);

  async function abrir(n: Notificacion) {
    if (!n.read) await marcarLeida(n.id).catch(() => undefined);
    if (n.link) router.push(n.link);
    else cargar();
  }

  return (
    <section className="max-w-3xl overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{datos ? `${datos.total} notificaciones` : "Notificaciones"}</h2>
        <button onClick={() => marcarTodas().then(cargar)} className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-primary hover:bg-surface-2">
          <CheckCheck size={14} /> Marcar todas como leídas
        </button>
      </div>
      {error && <p className="p-4 text-sm text-bad">{error}</p>}
      {!datos && !error && <p className="p-8 text-center text-sm text-muted">Cargando…</p>}
      {datos?.data.length === 0 && <p className="p-8 text-center text-sm text-muted">No tienes notificaciones.</p>}
      <ul>
        {datos?.data.map((n) => (
          <li key={n.id}>
            <button onClick={() => abrir(n)} className={`flex w-full cursor-pointer gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-surface-2 ${n.read ? "" : "bg-primary-soft/50"}`}>
              <span className={`mt-[7px] size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-primary"}`} />
              <span className="min-w-0 flex-1">
                <strong className={`block text-[13.5px] ${n.read ? "font-medium" : "font-semibold"}`}>{n.title}</strong>
                <span className="block text-[13px] text-muted">{n.body}</span>
                <small className="text-[11.5px] text-muted">{haceCuanto(n.created_at)}{n.module ? ` · ${n.module}` : ""}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {datos && datos.last_page > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[13px]">
          <button disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className="cursor-pointer rounded-md px-2 py-1 hover:bg-surface-2 disabled:opacity-40">Anterior</button>
          <span className="text-muted">Página {datos.current_page} de {datos.last_page}</span>
          <button disabled={pagina >= datos.last_page} onClick={() => setPagina((p) => p + 1)} className="cursor-pointer rounded-md px-2 py-1 hover:bg-surface-2 disabled:opacity-40">Siguiente</button>
        </div>
      )}
    </section>
  );
}
