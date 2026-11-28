"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Scale } from "lucide-react";
import { Alert, Button, Cifra, FiltroFecha, FiltroSelect, PageHeader, StatusBadge } from "@/components/ui";
import { kg, numero, porcentaje } from "@/lib/formato";
import { PESO } from "@/modulos/ped/tipos";
import { Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { R, TAREA, hoyLima, type OlaOpcion } from "@/modulos/pre/tipos";

type LineaPeso = {
  id: string; sku: string; name: string; sale_mode: string; qty: number; estimado_kg: number | null; real_kg: number | null; paquetes: number;
  complete: boolean; diferencia_pct: number | null; tolerancia_pct: number; excede: boolean; cobra_por_kg: boolean;
};
type Fila = { id: string; order_id: string; pedido: string; cliente: string | null; estado: string; estado_pedido: string; aviso: string; lineas: LineaPeso[] };
type Pesado = { filas: Fila[]; cifras: { pedidos: number; aviso_requerido: number; lineas: number; pesadas: number } };

/** PRE-05 Pesado: peso de la etiqueta de balanza o digitado; diferencia frente al estimado y aviso cuando supera la tolerancia (PED-07). */
export default function Pesado() {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const [ola, setOla] = useState("");
  const olas = useDatos<OlaOpcion[]>(`/v1/pre/olas?fecha=${dia}`);
  const { datos: d, error, cargando } = useDatos<Pesado>(`/v1/pre/pesado?${ola ? `wave_id=${ola}` : `fecha=${dia}`}`);
  const c = d?.cifras;

  return (
    <div className="space-y-5">
      <PageHeader description="El peso real de cada paquete define el precio final. Si la diferencia con lo estimado supera la tolerancia, se avisa al cliente antes de despachar." />
      <div className="flex flex-wrap gap-2">
        <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => { setDia(v || hoyLima()); setOla(""); }} />
        <FiltroSelect etiqueta="Ola" todos="todas" value={ola} onChange={setOla} ancho={260} options={(olas.datos ?? []).map((w) => ({ value: w.id, label: w.etiqueta }))} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Pedidos con peso" icono={Scale} destacada valor={c ? numero(c.pedidos) : undefined} detalle={c ? `${c.pesadas} de ${c.lineas} líneas pesadas` : ""} />
        <Cifra titulo="Aviso de peso requerido" icono={AlertTriangle} valor={c ? numero(c.aviso_requerido) : undefined} tono={c ? (c.aviso_requerido ? "bad" : "ok") : undefined} detalle="Avisar desde Diferencia de peso" />
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {cargando && !d ? <Vacio>Cargando…</Vacio> : !d?.filas.length ? <Vacio>No hay pedidos con productos por peso.</Vacio> : (
        <div className="space-y-3">
          {d.filas.map((f) => (
            <Seccion key={f.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" onClick={() => router.push(`${R.ticket}?id=${f.id}`)} className="min-w-0 cursor-pointer text-left">
                  <span className="block text-[14px] font-semibold text-ink">{f.pedido} <span className="font-normal text-muted">· {f.cliente}</span></span>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={f.estado} labels={TAREA} />
                  <StatusBadge status={f.aviso} labels={PESO} />
                  {["PENDING", "PICKING"].includes(f.estado) && <Button size="sm" variant="ghost" onClick={() => router.push(`${R.armado}?id=${f.id}`)}>Pesar en el armado</Button>}
                </div>
              </div>
              <ul className="mt-2 divide-y divide-line">
                {f.lineas.map((l) => (
                  <li key={l.id} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 py-2 text-[13px]">
                    <span className="min-w-0 text-ink">{l.name} <span className="text-[11.5px] text-muted">· {l.paquetes} paquete(s)</span></span>
                    <span className="text-right font-semibold text-ink">{l.real_kg != null ? kg(l.real_kg) : "—"}</span>
                    <span className="text-[12px] text-muted">Estimado {kg(l.estimado_kg)} · tolerancia ±{porcentaje(l.tolerancia_pct)}{l.cobra_por_kg ? "" : " · precio fijo"}</span>
                    <span className={`text-right text-[12px] font-semibold ${l.excede ? "text-bad" : l.complete ? "text-ok" : "text-muted"}`}>
                      {l.diferencia_pct != null ? `${l.diferencia_pct > 0 ? "+" : ""}${porcentaje(l.diferencia_pct, 1)}` : "—"}{!l.complete ? " (en curso)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {f.aviso === "NOTICE_REQUIRED" && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-bad-soft px-3 py-2">
                  <span className="text-[12.5px] text-bad">Supera la tolerancia: no se verifica hasta avisar al cliente.</span>
                  <Button size="sm" icon={ExternalLink} onClick={() => router.push(`/m/ped/ped-07?id=${f.order_id}`)}>Avisar al cliente</Button>
                </div>
              )}
            </Seccion>
          ))}
        </div>
      )}
    </div>
  );
}
