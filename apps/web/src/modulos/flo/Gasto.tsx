"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useDatos } from "./comunes";

/** Enlace con GAS (RN-FLO-17): ninguno, un gasto ya registrado del vehículo o crear el gasto con el comprobante. */
export type GastoForm = { modo: "" | "ENLAZAR" | "CREAR"; expense_id: string; doc_type: string; doc_series: string; doc_number: string; supplier_doc: string; supplier_name: string };
export const GASTO_VACIO: GastoForm = { modo: "", expense_id: "", doc_type: "INVOICE", doc_series: "", doc_number: "", supplier_doc: "", supplier_name: "" };

export function cuerpoGasto(g: GastoForm): Record<string, unknown> {
  if (g.modo === "ENLAZAR") return { expense_id: g.expense_id || null };
  if (g.modo === "CREAR") return { create_expense: true, doc_type: g.doc_type, doc_series: g.doc_series || null, doc_number: g.doc_number || null, supplier_doc: g.supplier_doc || null, supplier_name: g.supplier_name || null };
  return {};
}

type Candidato = { id: string; number: string; issue_date: string; amount_pen: number; status: string; description: string; doc_series: string | null; doc_number: string | null; categoria: string | null };

const DOCS = [{ value: "INVOICE", label: "Factura" }, { value: "RECEIPT", label: "Boleta" }, { value: "TICKET", label: "Ticket" }, { value: "SIMPLE_RECEIPT", label: "Recibo simple" }];

export function CamposGasto({ g, onChange, tipo, vehiculo, puedeCrear }: { g: GastoForm; onChange: (g: GastoForm) => void; tipo: string; vehiculo: string; puedeCrear: boolean }) {
  const { datos } = useDatos<{ data: Candidato[] }>(g.modo === "ENLAZAR" && vehiculo ? `/v1/flo/gastos-candidatos?tipo=${tipo}&vehiculo=${vehiculo}` : null);
  const pon = (k: keyof GastoForm, v: string) => onChange({ ...g, [k]: v });
  return (
    <div className="space-y-3 rounded-[9px] border border-line p-3">
      <Field label="Gasto (GAS)" hint="Cada carga o comprobante se registra una sola vez como gasto (RN-FLO-17).">
        <Select value={g.modo} onChange={(e) => pon("modo", e.target.value)} options={[{ value: "", label: "Sin gasto por ahora" }, { value: "ENLAZAR", label: "Enlazar un gasto ya registrado" },
          ...(puedeCrear ? [{ value: "CREAR", label: "Crear el gasto en GAS" }] : [])]} />
      </Field>
      {g.modo === "ENLAZAR" && (
        <Field label="Gasto del vehículo" required>
          <Select value={g.expense_id} onChange={(e) => pon("expense_id", e.target.value)} placeholder={datos ? (datos.data.length ? "Elige" : "No hay gastos sin enlazar") : "Cargando…"}
            options={(datos?.data ?? []).map((c) => ({ value: c.id, label: `${c.number} · ${fecha(c.issue_date)} · ${soles(c.amount_pen)} · ${c.description}` }))} />
        </Field>
      )}
      {g.modo === "CREAR" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Comprobante"><Select value={g.doc_type} onChange={(e) => pon("doc_type", e.target.value)} options={DOCS} /></Field>
          <Field label="Serie"><Input value={g.doc_series} maxLength={20} onChange={(e) => pon("doc_series", e.target.value.toUpperCase())} /></Field>
          <Field label="Número"><Input value={g.doc_number} maxLength={20} onChange={(e) => pon("doc_number", e.target.value)} /></Field>
          <Field label="RUC o DNI del proveedor"><Input value={g.supplier_doc} maxLength={15} inputMode="numeric" onChange={(e) => pon("supplier_doc", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Proveedor" className="col-span-2"><Input value={g.supplier_name} maxLength={160} onChange={(e) => pon("supplier_name", e.target.value)} /></Field>
        </div>
      )}
    </div>
  );
}

/** Enlazar o crear después el gasto de un registro ya guardado (carga, orden, multa pagada o costo). */
export function EnlazarGasto({ titulo, url, tipo, vehiculo, puedeCrear, onClose, onListo }: {
  titulo: string; url: string; tipo: string; vehiculo: string; puedeCrear: boolean; onClose: () => void; onListo: () => void;
}) {
  const [g, setG] = useState<GastoForm>({ ...GASTO_VACIO, modo: "ENLAZAR" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(url, { method: "POST", body: cuerpoGasto(g) });
      toast.ok("Gasto enlazado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={titulo} dismissable={!guardando} placement="center"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-gasto" loading={guardando} disabled={!g.modo}>Guardar</Button></>}>
      <form id="f-gasto" onSubmit={guardar} className="space-y-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <CamposGasto g={g} onChange={setG} tipo={tipo} vehiculo={vehiculo} puedeCrear={puedeCrear} />
      </form>
    </Modal>
  );
}
