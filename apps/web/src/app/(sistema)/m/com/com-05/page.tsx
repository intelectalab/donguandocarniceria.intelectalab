"use client";

import { useState } from "react";
import { ClipboardCheck, Gauge, ShieldCheck } from "lucide-react";
import { Alert, DataTable, PageHeader } from "@/components/ui";
import { numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { FichaOrden, columnasOrden, type FilaOrden } from "@/modulos/com/Orden";
import type { Num } from "@/modulos/com/tipos";

type Cifras = { pending_approval: number; pending_amount: Num; threshold: Num };

/** COM-05 Aprobación de órdenes: bandeja del aprobador con las órdenes que superan el umbral. */
export default function AprobacionOrdenes() {
  const op = useOpcionesCom();
  const lista = useListado<FilaOrden>("/v1/com/ordenes", { orden: "order_date", filtros: { status: "PENDING_APPROVAL" } });
  const c = useDatos<Cifras>("/v1/com/cifras/05");
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader description="Órdenes que superan el umbral de aprobación. Revisa proveedor, precios y cantidades; apruébala o devuélvela con lo que hay que corregir. Nadie aprueba su propia orden." />
      {op && !op.can.order_approve && <Alert tone="info">Tu rol ve esta bandeja, pero no aprueba órdenes: lo hacen Administración y Gerencia.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Por aprobar" valor={c.datos ? numero(c.datos.pending_approval) : undefined} icono={ClipboardCheck} />
        <CifraLink titulo="Importe por aprobar" valor={c.datos ? soles(c.datos.pending_amount) : undefined} icono={Gauge} />
        <CifraLink titulo="Umbral de aprobación" valor={c.datos ? soles(c.datos.threshold) : undefined} detalle="Hasta este total se aprueban solas" icono={ShieldCheck} />
      </div>
      <DataTable {...lista.tabla} columns={columnasOrden} onRowClick={(f) => setAbierta(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número o proveedor…" }}
        empty="No hay órdenes esperando aprobación." />
      {abierta && <FichaOrden id={abierta} op={op} onClose={() => setAbierta(null)} onCambio={() => { lista.recargar(); c.recargar(); }} />}
    </div>
  );
}
