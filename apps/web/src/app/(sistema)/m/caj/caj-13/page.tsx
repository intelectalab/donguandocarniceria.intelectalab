"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CircleDollarSign, Scale, Undo2 } from "lucide-react";
import { Alert, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Diferencia, ESTADO_LIQUIDACION, Seccion, Vacio, hoy, useDatos } from "@/modulos/caj/comunes";

type Cuenta = { id: string; code: string; name: string; tipo: string; account_type: string; cobrado: number; n: number; revertido: number; entra: number; sale: number; conciliado: number; saldo: number };
type Medio = { medio: string; nombre: string; n: number; monto: number; comision: number };
type Dif = { id: string; number: string; monto: string; motivo: string | null; status: string; ruta: string | null; quien: string | null; tipo: string; pantalla: string };
type Cierre = {
  fecha: string; cuentas: Cuenta[]; por_medio: Medio[]; diferencias: Dif[];
  totales: { cobrado: number; revertido: number; trasladado: number; conciliado: number; diferencias: number; n_diferencias: number };
};

const PANTALLA: Record<string, string> = { "CAJ-07": "/m/caj/caj-07", "CAJ-08": "/m/caj/caj-08", "POS-07": "/m/pos/pos-07" };

/** CAJ-13 Cierre diario de caja: por cuenta, lo cobrado, revertido, trasladado y conciliado del día, con las diferencias abiertas. */
export default function CierreDiario() {
  const { me } = useSesion();
  const [dia, setDia] = useState(hoy());
  const [local, setLocal] = useState("");
  const p = new URLSearchParams(Object.entries({ fecha: dia, establishment_id: local }).filter(([, v]) => v));
  const { datos: c, error, cargando } = useDatos<Cierre>(`/v1/caj/cierre?${p}`);
  const t = c?.totales;
  const conMovimiento = (c?.cuentas ?? []).filter((x) => x.cobrado || x.revertido || x.entra || x.sale || x.conciliado);

  const columnas: Column<Cuenta>[] = [
    { key: "name", header: "Cuenta", cardTitle: true, render: (x) => <div className="min-w-0"><div className="font-medium">{x.name}</div><div className="text-[12px] text-muted">{x.code} · {x.tipo}</div></div> },
    { key: "cobrado", header: "Cobrado", align: "right", render: (x) => <div className="text-right tabular-nums">{soles(x.cobrado)}<div className="text-[11.5px] text-muted">{x.n} cobros</div></div> },
    { key: "revertido", header: "Revertido", align: "right", hideOnMobile: true, render: (x) => <span className={`tabular-nums ${x.revertido ? "text-bad" : "text-muted"}`}>{soles(x.revertido)}</span> },
    { key: "entra", header: "Traslados", align: "right", render: (x) => <div className="text-right text-[13px] tabular-nums"><span className="text-ok">+{soles(x.entra)}</span><div className="text-bad">−{soles(x.sale)}</div></div> },
    { key: "conciliado", header: "Conciliado", align: "right", hideOnMobile: true, render: (x) => <span className="tabular-nums">{soles(x.conciliado)}</span> },
    { key: "saldo", header: "Saldo hoy", align: "right", render: (x) => <span className={`font-semibold tabular-nums ${x.saldo < 0 ? "text-bad" : ""}`}>{soles(x.saldo)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="El resumen del día por cuenta y por medio de pago: lo cobrado, lo revertido, los traslados y lo conciliado. Las diferencias de liquidaciones, turnos y abonos se revisan en su pantalla."
        actions={<FiltroFecha etiqueta="Día" visible value={dia} max={hoy()} onChange={(v) => v && setDia(v)} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cobrado" icono={CircleDollarSign} destacada valor={t ? soles(t.cobrado) : undefined} detalle="Cobros vigentes del día" />
        <Cifra titulo="Revertido" icono={Undo2} tono={t && t.revertido > 0 ? "warn" : undefined} valor={t ? soles(t.revertido) : undefined} detalle="Con su motivo" />
        <Cifra titulo="Trasladado" icono={ArrowLeftRight} valor={t ? soles(t.trasladado) : undefined} detalle={t ? `Conciliado ${soles(t.conciliado)}` : ""} />
        <Cifra titulo="Diferencias" icono={Scale} tono={t && t.n_diferencias > 0 ? "bad" : undefined} valor={t ? (t.n_diferencias ? soles(t.diferencias) : "Ninguna") : undefined} detalle={t ? `${t.n_diferencias} por revisar` : ""} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      <DataTable rows={conMovimiento.length ? c!.cuentas : []} columns={columnas} loading={cargando} empty={cargando ? "Cargando…" : "No hubo movimientos ese día."}
        toolbar={me.establishments.length > 1 && (
          <FiltroSelect etiqueta="Local" value={local} onChange={setLocal} options={me.establishments.map((e) => ({ value: e.id, label: e.name }))} ancho={220} />
        )} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Por medio de pago">
          {!c ? <Vacio>Cargando…</Vacio> : !c.por_medio.length ? <Vacio>Sin cobros ese día.</Vacio> : (
            <ul className="divide-y divide-line">
              {c.por_medio.map((m) => (
                <li key={m.medio} className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
                  <span className="min-w-0">{m.nombre}<span className="block text-[12px] text-muted">{m.n} cobros{m.comision ? ` · comisión estimada ${soles(m.comision)}` : ""}</span></span>
                  <span className="shrink-0 font-medium tabular-nums">{soles(m.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
        <Seccion titulo="Diferencias del día">
          {!c ? <Vacio>Cargando…</Vacio> : !c.diferencias.length ? <Vacio>Todo cuadra.</Vacio> : (
            <ul className="divide-y divide-line">
              {c.diferencias.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {PANTALLA[d.pantalla] ? <Link href={PANTALLA[d.pantalla]} className="font-medium text-primary hover:underline">{d.number}</Link> : <span className="font-medium">{d.number}</span>}
                      <span className="text-muted">{d.tipo}</span>
                      {ESTADO_LIQUIDACION[d.status] && <StatusBadge status={d.status} labels={ESTADO_LIQUIDACION} />}
                    </div>
                    <div className="text-[12px] text-muted">{[d.quien, d.ruta ? `ruta ${d.ruta}` : null].filter(Boolean).join(" · ")}</div>
                    {d.motivo && <div className="text-[12px] text-muted">{d.motivo}</div>}
                  </div>
                  <span className="shrink-0"><Diferencia valor={d.monto} /></span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    </div>
  );
}
