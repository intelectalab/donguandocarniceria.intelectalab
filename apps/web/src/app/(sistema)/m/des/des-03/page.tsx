"use client";

import { useState } from "react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { Tabla, num, qs, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import { ESPECIE, type Num } from "@/modulos/pro/tipos";

type Hist = { id: string; price_per_kg: Num; valid_from: string; valid_to: string | null; source: string; note: string | null; status: string; created_by_name: string | null };
type Fila = { variant_id: string; sku: string; name: string; species: string; roles: string; price_per_kg: Num; valid_from: string | null; source: string | null; history: Hist[] };
const FUENTE: Record<string, string> = { MANUAL: "Manual", WEB_LIST: "Lista web sin IGV" };

/** DES-03 Precios de referencia por corte: base del costeo conjunto por valor de mercado (RN-DES-04); sin precio, el despiece no se cierra. */
export default function Precios() {
  const { puede } = useSesion();
  const op = useOpcionesPro();
  const [q, setQ] = useState("");
  const { datos, error, recargar } = useDatos<{ date: string; data: Fila[]; missing: number }>(`/v1/des/precios${qs({ q })}`);
  const [editar, setEditar] = useState<Fila | null>(null);
  const [historial, setHistorial] = useState<Fila | null>(null);
  const gestiona = Boolean(op?.can.price) && puede("DES", "E");
  const columnas: Column<Fila>[] = [
    { key: "name", header: "Corte", cardTitle: true, render: (c) => <div><p className="font-medium">{c.name}</p><p className="font-mono text-[12px] text-muted">{c.sku}</p></div> },
    { key: "species", header: "Especie", render: (c) => c.species.split(", ").map((s) => ESPECIE[s] ?? s).join(", ") },
    { key: "roles", header: "Rol", render: (c) => (c.roles.includes("CO_PRODUCT") ? "Corte principal" : "Subproducto") },
    { key: "price_per_kg", header: "Precio por kg", align: "right", render: (c) => c.price_per_kg === null ? <Badge tone="bad">Sin precio</Badge> : <b className="tabular-nums">{soles(c.price_per_kg)}</b> },
    { key: "valid_from", header: "Desde", render: (c) => fecha(c.valid_from) },
    { key: "source", header: "Origen", hideOnMobile: true, render: (c) => (c.source ? FUENTE[c.source] ?? c.source : "—") },
    { key: "acc", header: "", render: (c) => <span className="flex gap-1">
      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setHistorial(c); }}>Historial</Button>
      {gestiona && <Button size="sm" onClick={(e) => { e.stopPropagation(); setEditar(c); }}>Nuevo precio</Button>}
    </span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="El precio por kg de cada corte reparte el costo de la canal entre los cortes según su valor de mercado. Por defecto se toma la lista web sin IGV; un precio manual la reemplaza desde su fecha." />
      {error && <Alert tone="bad">{error}</Alert>}
      {datos && datos.missing > 0 && <Alert tone="warn">{datos.missing} corte(s) sin precio de referencia: sus despieces no se pueden cerrar hasta registrarlo.</Alert>}
      <DataTable rows={datos?.data ?? []} rowKey={(c) => c.variant_id} columns={columnas} loading={!datos && !error} search={{ value: q, onChange: setQ, placeholder: "Buscar corte, SKU o especie…" }} empty="No hay cortes." />
      {editar && <Dialogo titulo={`Precio de ${editar.name}`} boton="Guardar precio" onClose={() => setEditar(null)}
        aviso="El precio anterior queda en el historial con su fecha de fin."
        enviar={async () => {
          const f = document.getElementById("f-dialogo") as HTMLFormElement;
          const d = new FormData(f);
          await api("/v1/des/precios", { method: "POST", body: { variant_id: editar.variant_id, source: d.get("source"), price_per_kg: num(String(d.get("price") ?? "")), valid_from: d.get("valid_from") || null, note: d.get("note") || null } });
          toast.ok("Precio guardado"); setEditar(null); recargar();
        }}>
        {(err) => <>
          <Field label="Origen" error={err.source}><Select name="source" defaultValue="MANUAL" options={[{ value: "MANUAL", label: "Manual" }, { value: "WEB_LIST", label: "Lista web sin IGV" }]} /></Field>
          <Field label="Precio por kg" error={err.price_per_kg} hint="Vacío con lista web: se toma de la lista"><Input name="price" inputMode="decimal" prefix="S/" /></Field>
          <Field label="Desde" error={err.valid_from}><Input name="valid_from" type="date" defaultValue={datos?.date} /></Field>
          <Field label="Nota" error={err.note}><Input name="note" maxLength={255} /></Field>
        </>}
      </Dialogo>}
      {historial && <Modal open onClose={() => setHistorial(null)} title={`Historial de ${historial.name}`} size="lg">
        <Tabla cabeza={["Precio", "Desde", "Hasta", "Origen", "Nota", "Registró"]} filas={historial.history.map((h) => [soles(h.price_per_kg), fecha(h.valid_from), fecha(h.valid_to), FUENTE[h.source] ?? h.source, h.note ?? "—", h.created_by_name ?? "—"])} vacio="Sin precios registrados." />
      </Modal>}
    </div>
  );
}
