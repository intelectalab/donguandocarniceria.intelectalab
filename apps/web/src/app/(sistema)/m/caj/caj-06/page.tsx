"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote, Clock, Smartphone, Truck } from "lucide-react";
import { Alert, Cifra, FiltroFecha, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { fechaHora, numero, soles } from "@/lib/formato";
import { ESTADO_LIQUIDACION, Seccion, Vacio, hoy, useDatos } from "@/modulos/caj/comunes";

type Cobro = { id: string; number: string; amount: string; reference: string | null; medio: string; medio_nombre: string; paid_at: string; seq: number | null; pedido: string | null; cliente: string | null };
type Ruta = {
  id: string; code: string; status: string; ruta: string; efectivo: number; digital: number; entregas: number; no_entregadas: number; pendiente: number; pendientes: number;
  liquidacion: { number: string; status: string; delivered_cash: string; difference: string } | null; cobros: Cobro[]; por_cobrar: { seq: number; pedido: string; cliente: string; monto: number }[];
};
type Repartidor = { driver_user_id: string | null; repartidor: string; rutas: Ruta[]; efectivo: number; digital: number; pendiente: number };
type Respuesta = { fecha: string; repartidores: Repartidor[]; totales: { efectivo: number; digital: number; pendiente: number; entregas: number; pendientes: number } };

/** CAJ-06 Caja del repartidor: por repartidor, lo cobrado contra entrega en el día, lo que falta cobrar y si ya liquidó. */
export default function CajaRepartidor() {
  const [dia, setDia] = useState(hoy());
  const { datos, error, cargando } = useDatos<Respuesta>(`/v1/caj/repartidores?fecha=${dia}`);
  const t = datos?.totales;

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que cada repartidor cobró contra entrega en el día, en efectivo y en digital, lo que aún le falta cobrar y si ya liquidó. El efectivo se entrega en Liquidación del repartidor."
        actions={<FiltroFecha etiqueta="Día" visible value={dia} max={hoy()} onChange={(v) => v && setDia(v)} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Efectivo cobrado" icono={Banknote} destacada valor={t ? soles(t.efectivo) : undefined} detalle="Lo deben entregar en caja" />
        <Cifra titulo="Digital cobrado" icono={Smartphone} valor={t ? soles(t.digital) : undefined} detalle="Yape, Plin y tarjeta en la puerta" />
        <Cifra titulo="Falta cobrar" icono={Clock} tono={t && t.pendiente > 0 ? "warn" : undefined} valor={t ? soles(t.pendiente) : undefined} detalle={t ? `${numero(t.pendientes)} paradas` : ""} />
        <Cifra titulo="Entregas" icono={Truck} valor={t ? numero(t.entregas) : undefined} detalle="Pedidos entregados" />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando && !datos ? <Vacio>Cargando…</Vacio> : !datos?.repartidores.length ? (
        <Seccion><Vacio>No hay rutas propias ni alquiladas ese día.</Vacio></Seccion>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {datos.repartidores.map((r) => (
            <Seccion key={r.driver_user_id ?? "sin"} titulo={r.repartidor}
              acciones={<span className="text-[13px] text-muted">Efectivo <b className="text-ink tabular-nums">{soles(r.efectivo)}</b> · Digital <b className="text-ink tabular-nums">{soles(r.digital)}</b></span>}>
              <div className="space-y-3">
                {r.rutas.map((ru) => (
                  <div key={ru.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-medium">Ruta {ru.code} <span className="font-normal text-muted">· {ru.ruta}</span></div>
                        <div className="text-[12px] text-muted">{ru.entregas} entregadas{ru.no_entregadas ? ` · ${ru.no_entregadas} sin entregar` : ""}{ru.pendientes ? ` · ${ru.pendientes} por cobrar (${soles(ru.pendiente)})` : ""}</div>
                      </div>
                      {ru.liquidacion ? (
                        <span className="flex items-center gap-2 text-[12.5px]"><span className="text-muted">{ru.liquidacion.number}</span><StatusBadge status={ru.liquidacion.status} labels={ESTADO_LIQUIDACION} /></span>
                      ) : ru.status === "RETURNED" ? (
                        <Link href={`/m/caj/caj-07?ruta=${ru.id}`} className={buttonClass("primary", "sm")}>Liquidar</Link>
                      ) : <span className="text-[12.5px] text-muted">Sin liquidar</span>}
                    </div>
                    {ru.cobros.length > 0 && (
                      <ul className="mt-2 divide-y divide-line border-t border-line">
                        {ru.cobros.map((c) => (
                          <li key={c.id} className="flex items-start justify-between gap-3 py-1.5 text-[13px]">
                            <span className="min-w-0"><span className="block truncate">{c.seq ? `${c.seq}. ` : ""}{c.cliente ?? "—"}{c.pedido ? <span className="text-muted"> · {c.pedido}</span> : null}</span>
                              <span className="block text-[12px] text-muted">{c.medio_nombre}{c.reference ? ` · op. ${c.reference}` : ""} · {fechaHora(c.paid_at)}</span></span>
                            <span className={`shrink-0 tabular-nums ${c.medio === "CASH" ? "font-medium" : "text-muted"}`}>{soles(c.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {ru.por_cobrar.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-line pt-2">
                        {ru.por_cobrar.map((p) => (
                          <li key={`${p.seq}-${p.pedido}`} className="flex justify-between gap-3 text-[12.5px] text-warn">
                            <span className="min-w-0 truncate">{p.seq}. {p.cliente} · {p.pedido} · por cobrar</span><span className="shrink-0 tabular-nums">{soles(p.monto)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </Seccion>
          ))}
        </div>
      )}
    </div>
  );
}
