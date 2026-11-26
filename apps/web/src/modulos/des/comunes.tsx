"use client";

import type { ReactNode } from "react";
import { Alert, Input } from "@/components/ui";
import { CabeceraOrden, ElegirOrden, useDatos, useFicha, useOrdenElegida } from "@/modulos/pro/comunes";
import type { Balance, Costeo, Ficha, Num, Resumen } from "@/modulos/pro/tipos";

export type LineaDespiece = {
  id: string; seq: number; name: string; role: string; output_variant_id: string | null; standard_yield_pct: Num; sku: string | null; variant_name: string | null;
  weighed: { id: string; weight_kg: Num; qty: Num; lot_code: string | null; at: string; recorded_by_name: string | null }[];
  progress: { cut: string; weight_kg: Num; actual_pct: Num; standard_pct: Num; deviation_pp: Num; alert_pp: Num; out_of_standard: boolean } | null;
};
export type Despiece = { summary: Resumen; lines: LineaDespiece[]; mass_balance: Balance; costing: Costeo | null; can: { record: boolean; close: boolean; override: boolean; cost: boolean } };

/** Pantalla de un despiece (DES-04 a DES-06): elegir la orden de despiece y ver su ficha y su detalle por corte. */
export function PantallaDespiece({ descripcion, estados = "RELEASED,IN_PROGRESS,CLOSED", panel }: {
  descripcion: string; estados?: string; panel: (d: Despiece, f: Ficha, recargar: () => void) => ReactNode;
}) {
  const o = useOrdenElegida(estados, "CUTTING");
  const ficha = useFicha(o.id || null);
  const des = useDatos<Despiece>(o.id ? `/v1/des/despieces/${o.id}` : null);
  const recargar = () => { ficha.recargar(); des.recargar(); };
  const error = ficha.error ?? des.error;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[13.5px] text-muted">{descripcion}</p>
      <ElegirOrden {...o} />
      {error && <Alert tone="bad">{error}</Alert>}
      {ficha.datos && des.datos && ficha.datos.order.id === o.id && <><CabeceraOrden f={ficha.datos} />{panel(des.datos, ficha.datos, recargar)}</>}
    </div>
  );
}

/** Mes o rango de fechas para los informes de despiece. */
export function Periodo({ mes, setMes }: { mes: string; setMes: (v: string) => void }) {
  return <div className="w-[170px]"><Input type="month" aria-label="Mes" value={mes} onChange={(e) => setMes(e.target.value)} /></div>;
}
