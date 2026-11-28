"use client";

import { useState } from "react";
import { Cifra, DataTable, FiltroFecha, PageHeader, Tabs } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { SinPermiso, columnasGasto, useDatos, usePermisosGas } from "@/modulos/gas/comunes";
import { Ficha } from "@/modulos/gas/Ficha";
import type { FilaGasto } from "@/modulos/gas/tipos";

type Resumen = { resumen: { n: number; total: number } };

/** GAS-04 Gastos por pagar y pagados: el pago sale de una cuenta de CAJ (banco, billetera o caja) con su número de operación. */
export default function PorPagar() {
  const p = usePermisosGas();
  return (p.paga || p.reporte) ? <Pantalla /> : <SinPermiso que="Los pagos de gastos los ve administración, gerencia y contabilidad." />;
}

function Pantalla() {
  const p = usePermisosGas();
  const [vista, setVista] = useState<"pagar" | "pagados">("pagar");
  const [desde, setDesde] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const filtros = { vista, desde: vista === "pagados" ? desde : "" };
  const lista = useListado<FilaGasto>("/v1/gas/gastos", { filtros, orden: vista === "pagar" ? "approved_at" : "-paid_at" });
  const ver = p.paga || p.reporte;
  const { datos: rp, recargar: r1 } = useDatos<Resumen>(ver ? "/v1/gas/gastos?vista=pagar&per_page=1" : null);
  const { datos: rd, recargar: r2 } = useDatos<Resumen>(ver ? "/v1/gas/gastos?vista=pagados&per_page=1" : null);
  const cambio = () => { lista.recargar(); r1(); r2(); };
  return (
    <div className="space-y-4">
      <PageHeader description="Gastos aprobados «por pagar» y los ya pagados. Los de caja chica no salen aquí: se pagan con el fondo y se reponen con la rendición. Un recibo por honorarios se paga sin la retención." />
      <div className="grid grid-cols-2 gap-3">
        <Cifra titulo="Por pagar" valor={rp ? soles(rp.resumen.total) : "…"} detalle={rp ? `${rp.resumen.n} gastos` : undefined} destacada tono={(rp?.resumen.n ?? 0) > 0 ? "warn" : "ok"} />
        <Cifra titulo="Pagados" valor={rd ? soles(rd.resumen.total) : "…"} detalle={rd ? `${rd.resumen.n} gastos` : undefined} />
      </div>
      <Tabs tabs={[{ key: "pagar", label: "Por pagar" }, { key: "pagados", label: "Pagados" }]} value={vista} onChange={(k) => setVista(k as "pagar" | "pagados")} />
      <DataTable {...lista.tabla} onRowClick={(g) => setAbierto(g.id)}
        columns={columnasGasto(vista === "pagados" ? [
          { key: "paid_at", header: "Pagado", sortable: true, hideOnMobile: true, render: (g) => (g.paid_at ? fecha(g.paid_at.slice(0, 10)) : "—") },
          { key: "payment_reference", header: "Operación", hideOnMobile: true, render: (g) => g.payment_reference ?? "—" },
        ] : [
          { key: "approved_at", header: "Aprobado", sortable: true, hideOnMobile: true, render: (g) => (g.approved_at ? fecha(g.approved_at.slice(0, 10)) : "—") },
        ], ["registro"])}
        search={{ ...lista.tabla.search, placeholder: "Buscar por número, proveedor o descripción" }}
        toolbar={vista === "pagados" ? <FiltroFecha etiqueta="Desde" visible value={desde} onChange={setDesde} /> : undefined}
        empty={vista === "pagar" ? "No hay gastos por pagar." : "No hay pagos con ese filtro."} />
      <Ficha id={abierto} onClose={() => setAbierto(null)} onCambio={cambio} />
    </div>
  );
}
