"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Checkbox, DetailList, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";

export type Diferencia = { campo: string; antes: string | null; despues: string | null };
export type Cambio = {
  id: number; changed_at: string; usuario: string; rol: string | null; accion: "I" | "U" | "D"; accion_nombre: string; tabla: string; tabla_nombre: string;
  row_id: string | null; registro: string | null; cambios: Diferencia[]; mas_campos: number;
};
type ItemHistoria = (Cambio & { tipo: "cambio"; at: string })
  | { tipo: "acceso"; at: string; evento: string; evento_nombre: string; usuario: string; detalle: string | null; resultado: string };
export type Historia = {
  tabla: string; tabla_nombre: string; id: string; registro: string | null; items: ItemHistoria[]; revelado: boolean; puede_revelar: boolean;
  actual: { campo: string; valor: string | null }[] | null;
};

export const TONO_ACCION: Record<string, Tone> = { I: "ok", U: "info", D: "bad" };

/** Fecha y hora de Lima con segundos: «24/11/2026, 17:03:16». */
export function fechaHoraSeg(v: string) {
  return new Date(v).toLocaleString("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function Accion({ c }: { c: Pick<Cambio, "accion" | "accion_nombre"> }) {
  return <Badge tone={TONO_ACCION[c.accion] ?? "neutral"}>{c.accion_nombre}</Badge>;
}

/** Campo por campo: en un cambio, el valor anterior tachado y el nuevo; en un alta o un borrado, el valor. */
export function Diferencias({ c, max }: { c: Pick<Cambio, "accion" | "cambios" | "mas_campos">; max?: number }) {
  const filas = max ? c.cambios.slice(0, max) : c.cambios;
  const resto = (max ? Math.max(0, c.cambios.length - max) : 0) + (c.mas_campos ?? 0);
  if (!filas.length) return <span className="text-[12.5px] text-muted">Sin valores registrados.</span>;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(90px,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
      {filas.map((d) => (
        <div key={d.campo} className="contents">
          <span className="font-mono text-[11.5px] text-muted">{d.campo}</span>
          <span className="min-w-0 break-words">
            {c.accion === "U" ? (
              <><span className="text-muted line-through">{d.antes ?? "—"}</span> <span aria-hidden="true">→</span> <b className="font-semibold text-ink">{d.despues ?? "—"}</b></>
            ) : <span className="text-ink">{(c.accion === "D" ? d.antes : d.despues) ?? "—"}</span>}
          </span>
        </div>
      ))}
      {resto > 0 && <span className="col-span-2 text-[12px] text-muted">y {resto} {resto === 1 ? "campo más" : "campos más"}</span>}
    </div>
  );
}

/**
 * AUD-02: la historia de un registro (cambios y accesos en orden, y cómo está ahora). Va en la pestaña «Historia» de
 * cualquier ficha:  <HistoriaRegistro tabla="sales_orders" id={pedido.id} />
 */
export function HistoriaRegistro({ tabla, id }: { tabla: string; id: string }) {
  const [h, setH] = useState<Historia | null>(null);
  const [error, setError] = useState("");
  const [revelar, setRevelar] = useState(false);

  useEffect(() => {
    let vivo = true;
    api<Historia>(`/v1/aud/historia?tabla=${tabla}&id=${id}${revelar ? "&revelar=1" : ""}`)
      .then((r) => { if (vivo) { setH(r); setError(""); } }).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [tabla, id, revelar]);

  if (error) return <Alert tone="info">{error}</Alert>;
  if (!h) return <p className="text-[13px] text-muted">Cargando…</p>;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-ink">Historia · {h.registro ?? h.tabla_nombre}</h2>
          {h.puede_revelar && <Checkbox checked={revelar} onChange={setRevelar} label="Mostrar datos personales" />}
        </div>
        {h.items.length === 0 ? <p className="text-[13px] text-muted">Sin cambios registrados.</p> : (
          <ol className="grid gap-3 border-l border-line pl-4">
            {h.items.map((it, i) => (
              <li key={i} className="relative grid gap-1 text-[13px]">
                <span aria-hidden="true" className={`absolute top-1.5 -left-[21px] size-2.5 rounded-full ${it.tipo === "acceso" ? "bg-warn" : it.accion === "D" ? "bg-bad" : it.accion === "I" ? "bg-ok" : "bg-primary"}`} />
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-muted tabular-nums">{fechaHoraSeg(it.at)}</span>
                  {it.tipo === "cambio" ? <Accion c={it} /> : <Badge tone="warn">{it.evento_nombre}</Badge>}
                  <b className="text-ink">{it.usuario}</b>
                  {it.tipo === "cambio" && it.rol && <span className="text-[12px] text-muted">{it.rol}</span>}
                </p>
                {it.tipo === "cambio" ? <Diferencias c={it} /> : it.detalle && <p className="text-[12.5px] text-muted">{it.detalle}</p>}
              </li>
            ))}
          </ol>
        )}
        <p className="text-[12px] text-muted">Hora de Lima. Los secretos se ven siempre como «***»{h.puede_revelar ? "; los datos personales, enmascarados salvo que los muestres." : "."}</p>
      </section>
      <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-[14px] font-semibold text-ink">Registro actual</h2>
        {h.actual ? <DetailList items={h.actual.map((x) => ({ label: x.campo, value: x.valor ?? "—" }))} />
          : <p className="text-[13px] text-muted">El registro ya no existe (fue borrado).</p>}
      </section>
    </div>
  );
}
