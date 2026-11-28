"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Button, FiltroSelect, StatusBadge, type Tone } from "@/components/ui";
import { api, apiImagen, mensajeDe } from "@/lib/api";
import { Paperclip } from "lucide-react";
import type { Opciones } from "./tipos";

/** Tarjeta con título para agrupar datos en las pantallas de FLO. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      {(titulo || acciones) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-[14.5px] font-semibold text-ink">{titulo}</h2>}
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

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
  const recargar = useCallback(() => setVersion((v) => v + 1), []);
  const actual = estado && estado.url === url ? estado : null;
  return { datos: actual?.datos ?? null, error: actual?.error ?? "", cargando: Boolean(url) && !actual, recargar };
}

export function useOpciones() {
  return useDatos<Opciones>("/v1/flo/opciones");
}

/** Aviso cuando el rol entra a una pantalla que no le toca. */
export function SinPermiso({ que }: { que: string }) {
  return <Alert tone="info" title="Esta pantalla no es de tu rol">{que} Si lo necesitas, pídelo a quien administra los roles.</Alert>;
}

/** Error de carga: si es de permisos, el aviso amable; si no, el mensaje. */
export function ErrorCarga({ error, que }: { error: string; que: string }) {
  return /permiso|rol|corresponde|es del|es de|no tiene acceso/i.test(error) ? <SinPermiso que={que} /> : <Alert tone="bad">{error}</Alert>;
}

export const Estado = ({ s, labels }: { s: string | null | undefined; labels: Record<string, [string, Tone]> }) => <StatusBadge status={s} labels={labels} />;

/** Filtro de vehículo con todas las unidades de la flota. */
export function FiltroVehiculo({ op, value, onChange, vacio, soloRefrigerados }: {
  op: Opciones | null; value: string; onChange: (v: string) => void; vacio?: string; soloRefrigerados?: boolean;
}) {
  const vs = (op?.vehiculos ?? []).filter((v) => !soloRefrigerados || v.refrigerated);
  return <FiltroSelect etiqueta="Vehículo" value={value} onChange={onChange} ancho={190} vacio={vacio} options={vs.map((v) => ({ value: v.id, label: v.etiqueta }))} />;
}

export const AlVehiculo = ({ id, children }: { id: string; children: ReactNode }) => (
  <Link href={`/m/flo/flo-04?id=${id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{children}</Link>
);

/** Abre un archivo guardado por FLO (foto del tablero, vale, acta, documento) con un enlace temporal. */
export function VerArchivo({ id, texto = "Ver archivo" }: { id: string | null | undefined; texto?: string }) {
  const [abriendo, setAbriendo] = useState(false);
  if (!id) return null;
  return (
    <Button size="sm" variant="ghost" icon={Paperclip} loading={abriendo} onClick={async (e) => {
      e.stopPropagation();
      setAbriendo(true);
      try {
        const r = await api<{ url: string }>(`/v1/flo/archivos/${id}/enlace`, { method: "POST" });
        window.open(r.url, "_blank", "noopener");
      } catch (x) {
        const { toast } = await import("@/components/ui");
        toast.error(mensajeDe(x));
      } finally {
        setAbriendo(false);
      }
    }}>{texto}</Button>
  );
}

/** Miniatura de una imagen protegida de la API (si el navegador la puede pedir). */
export function Miniatura({ url, alt }: { url: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    if (url) apiImagen(url).then((s) => vivo && setSrc(s));
    return () => { vivo = false; };
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className="h-16 w-16 rounded-lg border border-line object-cover" /> : null;
}

/** Barra de un valor frente a un tope (tanque, rango…). */
export function Barra({ valor, tope, tono = "ok" }: { valor: number; tope: number; tono?: "ok" | "warn" | "bad" }) {
  const pct = Math.max(0, Math.min(100, tope > 0 ? (valor / tope) * 100 : 0));
  const color = tono === "bad" ? "bg-bad" : tono === "warn" ? "bg-warn" : "bg-ok";
  return <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><span className={`block h-full ${color}`} style={{ width: `${pct}%` }} /></span>;
}

/** Bloqueos de un vehículo (RN-FLO-11): documentos vencidos, taller o mantenimiento vencido. */
export function Bloqueos({ lista }: { lista: string[] }) {
  if (!lista.length) return null;
  return <Alert tone="bad" title="No sale a ruta ni abre jornada (RN-FLO-11)">{lista.map((b) => <span key={b} className="block">{b}</span>)}</Alert>;
}
