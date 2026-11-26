"use client";

import { useState } from "react";
import { CalendarX, ClipboardCheck, FilePen, PackageOpen, Plus } from "lucide-react";
import { Button, DataTable, PageHeader } from "@/components/ui";
import { numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, useDatos, useOpcionesCom } from "@/modulos/com/comunes";
import { FichaOrden, FormOrden, columnasOrden, type FilaOrden } from "@/modulos/com/Orden";
import { ORDEN, opciones, type Num } from "@/modulos/com/tipos";

type Cifras = { draft: number; pending_approval: number; pending_amount: Num; open: number; late: number; month_total: Num; threshold: Num };

/** COM-04 Órdenes de compra: proveedor, destino, líneas por unidad o por kg, IGV, total, entrega esperada y estado. */
export default function Ordenes() {
  const op = useOpcionesCom();
  const [estado, setEstado] = useState("");
  const [atrasadas, setAtrasadas] = useState(false);
  const [prov, setProv] = useState("");
  const lista = useListado<FilaOrden>("/v1/com/ordenes", { orden: "-order_date", filtros: { status: estado, late: atrasadas ? 1 : null, supplier_id: prov } });
  const c = useDatos<Cifras>("/v1/com/cifras/04");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const recargar = () => { lista.recargar(); c.recargar(); };
  return (
    <div className="space-y-5">
      <PageHeader description={`Las órdenes a los proveedores. Hasta ${c.datos ? soles(c.datos.threshold) : "el umbral"} se aprueban solas al enviarlas; las mayores las aprueba Administración o Gerencia.`}
        actions={op?.can.order_create && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Nueva orden</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Abiertas por recibir" valor={c.datos ? numero(c.datos.open) : undefined} icono={PackageOpen} onClick={() => { setEstado("APPROVED"); setAtrasadas(false); }} />
        <CifraLink titulo="Atrasadas" valor={c.datos ? numero(c.datos.late) : undefined} detalle="Pasó la fecha de entrega" icono={CalendarX} tono={c.datos?.late ? "bad" : "ok"} onClick={() => { setEstado(""); setAtrasadas(true); }} />
        <CifraLink titulo="Por aprobar" valor={c.datos ? numero(c.datos.pending_approval) : undefined} detalle={c.datos ? soles(c.datos.pending_amount) : undefined} icono={ClipboardCheck} tono={c.datos?.pending_approval ? "warn" : undefined} href="/m/com/com-05" />
        <CifraLink titulo="Borradores" valor={c.datos ? numero(c.datos.draft) : undefined} icono={FilePen} onClick={() => { setEstado("DRAFT"); setAtrasadas(false); }} />
      </div>
      <DataTable {...lista.tabla} columns={columnasOrden} onRowClick={(f) => setAbierta(f.id)} search={{ ...lista.tabla.search, placeholder: "Buscar número o proveedor…" }} empty="No hay órdenes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={(v) => { setEstado(v); setAtrasadas(false); }} options={opciones(Object.fromEntries(Object.entries(ORDEN).map(([k, v]) => [k, v[0]])))} />
          <FiltroSelect label="Proveedor" value={prov} onChange={setProv} ancho="sm:w-[220px]" options={(op?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </>} />
      {abierta && <FichaOrden id={abierta} op={op} onClose={() => setAbierta(null)} onCambio={recargar} />}
      {nueva && op && <FormOrden op={op} onClose={() => setNueva(false)} onGuardado={(id) => { setNueva(false); recargar(); setAbierta(id); }} />}
    </div>
  );
}
