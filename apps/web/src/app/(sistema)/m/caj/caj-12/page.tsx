"use client";

import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { Badge, Button, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { TIPOS_CUENTA, hoy, useDatos } from "@/modulos/caj/comunes";

type Fila = {
  id: string; transferred_at: string; amount: string; reference: string; reason: string; status: string; batch_id: string | null; settlement_id: string | null;
  desde: string; desde_code: string; hacia: string; hacia_code: string; registrado_por: string | null; liquidacion: string | null; tipo: "MANUAL" | "LIQUIDACION" | "ABONO";
};
type Cuenta = { id: string; code: string; name: string; account_type: string };

const TIPOS: Record<string, string> = { MANUAL: "Manual", LIQUIDACION: "Liquidación del repartidor", ABONO: "Abono" };

/** CAJ-12 Traslados entre cuentas: depósito del efectivo al banco, reposición de caja chica y otros, con referencia y motivo. */
export default function Traslados() {
  const { puede } = useSesion();
  const [f, setF] = useState({ desde: "", hasta: "", cuenta: "", tipo: "" });
  const [nuevo, setNuevo] = useState(false);
  const lista = useListado<Fila>("/v1/caj/traslados", { orden: "-transferred_at", filtros: f });
  const { datos: extra } = useDatos<{ cuentas: Cuenta[] }>("/v1/caj/traslados?per_page=1");
  const cuentas = extra?.cuentas ?? [];

  const columnas: Column<Fila>[] = [
    { key: "transferred_at", header: "Fecha", sortable: true, cardTitle: true, render: (t) => <div><div className="font-medium">{fechaHora(t.transferred_at)}</div><div className="text-[12px] text-muted">{t.reference}</div></div> },
    { key: "ruta", header: "De → a", render: (t) => (
      <div className="flex flex-wrap items-center gap-1.5 text-[13px]"><span>{t.desde}</span><ArrowRight size={14} aria-hidden="true" className="text-muted" /><span>{t.hacia}</span></div>
    ) },
    { key: "reason", header: "Motivo", hideOnMobile: true, render: (t) => <div className="min-w-0"><div className="truncate text-[13px]">{t.reason}</div><div className="text-[12px] text-muted">{t.registrado_por ?? "Sistema"}</div></div> },
    { key: "tipo", header: "Tipo", render: (t) => <Badge tone={t.tipo === "MANUAL" ? "neutral" : "info"}>{t.liquidacion ? `${TIPOS[t.tipo]} ${t.liquidacion}` : TIPOS[t.tipo]}</Badge> },
    { key: "amount", header: "Monto", sortable: true, align: "right", render: (t) => <span className="font-semibold tabular-nums">{soles(t.amount)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Movimientos de dinero entre cuentas de la empresa: depositar el efectivo de la caja al banco, reponer la caja chica, pasar de una billetera al banco. Las liquidaciones del repartidor y los abonos se registran solos."
        actions={puede("CAJ", "E") && <Button variant="primary" icon={Plus} disabled={!cuentas.length} onClick={() => setNuevo(true)}>Nuevo traslado</Button>} />
      <DataTable {...lista.tabla} columns={columnas} empty="No hay traslados con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "Referencia, motivo o cuenta…" }}
        toolbar={<>
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} ancho={150} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} ancho={150} />
          <FiltroSelect etiqueta="Cuenta" todos="todas" value={f.cuenta} onChange={(v) => setF({ ...f, cuenta: v })} options={cuentas.map((c) => ({ value: c.id, label: c.name }))} ancho={200} />
          <FiltroSelect etiqueta="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={Object.entries(TIPOS).map(([value, label]) => ({ value, label }))} ancho={200} />
        </>} />
      {nuevo && <NuevoTraslado cuentas={cuentas} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); lista.recargar(); }} />}
    </div>
  );
}

function NuevoTraslado({ cuentas, onClose, onListo }: { cuentas: Cuenta[]; onClose: () => void; onListo: () => void }) {
  const [f, setF] = useState({ from_account_id: "", to_account_id: "", amount: "", reference: "", reason: "", date: hoy() });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const poner = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const opcion = (c: Cuenta) => ({ value: c.id, label: `${c.name} (${TIPOS_CUENTA[c.account_type] ?? c.account_type})` });

  async function guardar() {
    setEnviando(true);
    setErrores({});
    try {
      await api("/v1/caj/traslados", { method: "POST", body: { ...f, amount: Number(f.amount), reference: f.reference.trim(), reason: f.reason.trim() } });
      toast.ok(`Traslado de ${soles(Number(f.amount))} registrado.`);
      onListo();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo traslado" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={enviando} onClick={guardar}
          disabled={!f.from_account_id || !f.to_account_id || f.from_account_id === f.to_account_id || !(Number(f.amount) > 0) || !f.reference.trim() || f.reason.trim().length < 3}>Registrar traslado</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sale de" required error={errores.from_account_id}>
          <Select value={f.from_account_id} placeholder="Elige la cuenta" options={cuentas.map(opcion)} onChange={(e) => poner("from_account_id", e.target.value)} />
        </Field>
        <Field label="Entra a" required error={errores.to_account_id || (f.from_account_id && f.from_account_id === f.to_account_id ? "Elige otra cuenta." : undefined)}>
          <Select value={f.to_account_id} placeholder="Elige la cuenta" options={cuentas.filter((c) => c.id !== f.from_account_id).map(opcion)} onChange={(e) => poner("to_account_id", e.target.value)} />
        </Field>
        <Field label="Monto (S/)" required error={errores.amount}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => poner("amount", e.target.value)} className="text-right tabular-nums" />
        </Field>
        <Field label="Fecha" error={errores.date}><Input type="date" value={f.date} max={hoy()} onChange={(e) => poner("date", e.target.value)} /></Field>
        <Field label="Referencia" required error={errores.reference} hint="Número de operación o del depósito.">
          <Input value={f.reference} maxLength={40} onChange={(e) => poner("reference", e.target.value)} placeholder="DEP-CAJA-L1-20261125" />
        </Field>
        <Field label="Motivo" required error={errores.reason} className="sm:col-span-2">
          <Textarea rows={2} maxLength={255} value={f.reason} onChange={(e) => poner("reason", e.target.value)} placeholder="Depósito del efectivo del día" />
        </Field>
      </div>
    </Modal>
  );
}
