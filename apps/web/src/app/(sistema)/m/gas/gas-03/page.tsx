"use client";

import { useState } from "react";
import { Cifra, DataTable, PageHeader } from "@/components/ui";
import { fechaHora, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { SinPermiso, columnasGasto, usePermisosGas, useDatos } from "@/modulos/gas/comunes";
import { Ficha } from "@/modulos/gas/Ficha";
import { NIVELES, type FilaGasto } from "@/modulos/gas/tipos";

type Resumen = { resumen: { n: number; total: number }; nivel: number };

/** GAS-03 Bandeja de aprobación: gastos enviados que el usuario puede aprobar según su nivel (RN-GAS-07); nunca los propios (RN-GAS-08). */
export default function Bandeja() {
  const p = usePermisosGas();
  return p.aprueba ? <Pantalla /> : <SinPermiso que="Tu rol no aprueba gastos." />;
}

function Pantalla() {
  const p = usePermisosGas();
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useListado<FilaGasto>("/v1/gas/aprobaciones", { orden: "submitted_at" });
  const { datos: r, recargar } = useDatos<Resumen>(p.aprueba ? "/v1/gas/aprobaciones?per_page=1" : null);
  const cambio = () => { lista.recargar(); recargar(); };
  return (
    <div className="space-y-4">
      <PageHeader description={`Apruebas hasta el ${NIVELES[p.nivel]?.toLowerCase() ?? "nivel " + p.nivel}. Los más antiguos van primero. Abre cada gasto para ver la foto del comprobante y aprobar o rechazar con comentario.`} />
      <div className="grid grid-cols-2 gap-3">
        <Cifra titulo="Por aprobar" valor={String(r?.resumen.n ?? "…")} destacada tono={(r?.resumen.n ?? 0) > 0 ? "warn" : "ok"} />
        <Cifra titulo="Monto" valor={r ? soles(r.resumen.total) : "…"} />
      </div>
      <DataTable {...lista.tabla} onRowClick={(g) => setAbierto(g.id)}
        columns={columnasGasto([
          { key: "submitted_at", header: "Enviado", sortable: true, hideOnMobile: true, render: (g) => (g.submitted_at ? fechaHora(g.submitted_at) : "—") },
          { key: "required_level", header: "Nivel", hideOnMobile: true, render: (g) => (g.required_level ? `Nivel ${g.required_level}` : "—") },
        ], ["comprobante"])}
        search={{ ...lista.tabla.search, placeholder: "Buscar por número, descripción o quién lo registró" }}
        empty="No tienes gastos por aprobar." />
      <Ficha id={abierto} onClose={() => setAbierto(null)} onCambio={cambio} />
    </div>
  );
}
