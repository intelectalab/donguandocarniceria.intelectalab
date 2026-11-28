"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, Button, FiltroFecha, StatusBadge } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { fecha } from "@/lib/formato";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { R, TAREA, hoyLima, type Tarea, type TareaFila } from "./tipos";

export { Seccion, Vacio };

/** GET a la API con recarga. Sin url (null) no pide nada. */
export function useDatos<T>(url: string | null) {
  const [estado, setEstado] = useState<{ url: string; datos?: T; error?: string } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!url) return;
    let vigente = true;
    api<T>(url).then((d) => vigente && setEstado({ url, datos: d })).catch((e) => vigente && setEstado({ url, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [url, version]);

  const recargar = useCallback(() => setVersion((n) => n + 1), []);
  const poner = useCallback((d: T) => url && setEstado({ url, datos: d }), [url]);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar, poner };
}

const sinSuscripcion = () => () => {};

/** Barra de avance 0–100. */
export function Avance({ valor, tono }: { valor: number; tono?: "ok" | "warn" | "bad" }) {
  const v = Math.max(0, Math.min(100, Math.round(valor)));
  const color = tono === "bad" ? "bg-bad" : tono === "warn" ? "bg-warn" : v >= 100 ? "bg-ok" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

/**
 * Lo que va adentro se imprime solo (etiquetas, lista consolidada, ticket): se monta en el body y en pantalla no se ve.
 * Al imprimir se oculta el resto de la aplicación.
 */
export function Imprimible({ children }: { children: ReactNode }) {
  // En el servidor no hay document: se monta solo en el navegador.
  const montado = useSyncExternalStore(sinSuscripcion, () => true, () => false);
  if (!montado) return null;
  return createPortal(
    <div className="pre-imprimir hidden print:block">
      <style>{"@media print { body > *:not(.pre-imprimir) { display: none !important; } body { background: #fff; } @page { margin: 8mm; } }"}</style>
      {children}
    </div>,
    document.body,
  );
}

/** Pedido, estado y datos de entrega de la tarea, con «Volver» y los pasos del pedido (PRE-03 a PRE-07). */
export function CabeceraTarea({ t, volver, children }: { t: Tarea; volver: string; children?: ReactNode }) {
  const router = useRouter();
  const { can } = useSesion();
  const o = t.pedido;
  // Los pasos (armar, embolsar, verificar) solo para quien prepara; la vendedora solo ve el ticket.
  const prepara = can("pre.task.pick") || can("pre.task.verify");
  const pasos = [
    { ruta: R.ticket, texto: "Ticket" }, { ruta: R.armado, texto: "Armar" }, { ruta: R.bolsas, texto: "Bolsas" }, { ruta: R.verificacion, texto: "Verificar" },
  ];
  const aqui = usePathname();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(volver)}>Volver</Button>
        {prepara && <nav className="flex flex-wrap gap-1" aria-label="Pasos del pedido">
          {pasos.map((p) => (
            <Link key={p.ruta} href={`${p.ruta}?id=${t.id}`} aria-current={aqui === p.ruta ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-[12.5px] ${aqui === p.ruta ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
              {p.texto}
            </Link>
          ))}
        </nav>}
      </div>
      <Seccion>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[17px] font-bold text-ink">{o.number}</span>
              <StatusBadge status={t.estado} labels={TAREA} />
              {o.status === "CANCELLED" && <StatusBadge status="CANCELLED" labels={{ CANCELLED: ["Pedido cancelado", "bad"] }} />}
            </div>
            <p className="text-[13px] text-ink">{o.cliente}</p>
            <p className="text-[12.5px] text-muted">
              {o.marca} · {fecha(o.delivery_date)} {o.slot_from ? `${o.slot_from.slice(0, 5)}–${(o.slot_to ?? "").slice(0, 5)}` : ""}{o.zona ? ` · ${o.zona}` : ""}
            </p>
          </div>
          <div className="text-[12.5px] text-muted sm:text-right">
            <p>{t.wave.number}</p>
            {t.ruta && <p className="font-semibold text-ink">Ruta {t.ruta}{t.parada ? ` · parada ${t.parada}` : ""}</p>}
          </div>
        </div>
        {children}
      </Seccion>
      {t.estado === "CANCELLED" && <Alert tone="bad" title="Tarea anulada">{t.cancel_note ?? "El pedido se canceló."}</Alert>}
      {t.estado !== "CANCELLED" && o.status === "CANCELLED" && (
        <Alert tone="bad" title="El pedido se canceló">No sigas armando. La supervisora anula la tarea en el ticket y el stock vuelve al almacén.</Alert>
      )}
    </div>
  );
}

/** Carga una tarea (?id) y muestra la pantalla; sin id, la lista para elegir. */
export function ConTarea({ id, ruta, estados, titulo, vacio, children }: {
  id: string; ruta: string; estados?: string[]; titulo: string; vacio: string; children: (t: Tarea, poner: (t: Tarea) => void, recargar: () => void) => ReactNode;
}) {
  if (!id) return <ElegirTarea ruta={ruta} estados={estados} titulo={titulo} vacio={vacio} />;
  return <TareaCargada id={id}>{children}</TareaCargada>;
}

function TareaCargada({ id, children }: { id: string; children: (t: Tarea, poner: (t: Tarea) => void, recargar: () => void) => ReactNode }) {
  const { datos, error, cargando, poner, recargar } = useDatos<Tarea>(`/v1/pre/tareas/${id}`);
  if (cargando) return <Vacio>Cargando el pedido…</Vacio>;
  if (error || !datos) return <Alert tone="bad">{error || "No se encontró la tarea."}</Alert>;
  return <>{children(datos, poner, recargar)}</>;
}

/** Lista de pedidos de la fecha para elegir uno (por estados de la tarea). */
export function ElegirTarea({ ruta, estados, titulo, vacio }: { ruta: string; estados?: string[]; titulo: string; vacio: string }) {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const [q, setQ] = useState("");
  const { datos, error, cargando } = useDatos<TareaFila[]>(`/v1/pre/tareas?fecha=${dia}${estados ? `&estados=${estados.join(",")}` : ""}`);
  const filas = (datos ?? []).filter((t) => !q || `${t.pedido} ${t.cliente ?? ""} ${t.ruta ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Seccion titulo={titulo}>
      <div className="mb-3 flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => setDia(v || hoyLima())} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pedido, cliente o ruta…" aria-label="Buscar pedido"
          className="h-9 min-w-0 flex-1 rounded-[9px] border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-primary sm:max-w-[260px]" />
      </div>
      {cargando ? <Vacio>Cargando…</Vacio> : error ? <Alert tone="bad">{error}</Alert> : filas.length === 0 ? <Vacio>{vacio}</Vacio> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {filas.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => router.push(`${ruta}?id=${t.id}`)}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">{t.pedido} <span className="font-normal text-muted">· {t.cliente}</span></span>
                  <span className="block text-[12px] text-muted">{t.ola} · {t.franja ?? "sin franja"}{t.ruta ? ` · ruta ${t.ruta}` : ""}{t.parada ? ` · parada ${t.parada}` : ""}</span>
                </span>
                <span className="flex w-24 shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={t.estado} labels={TAREA} />
                  <Avance valor={t.avance} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}
