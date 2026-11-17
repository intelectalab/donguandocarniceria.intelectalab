"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, Input, PageHeader, Select, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { hoyLima, pct, useDatos } from "@/modulos/mae/tipos";

type Comision = {
  id: string; payment_method_id: string; medio: string; valid_from: string; valid_to: string | null; fee_pct: string | number; fee_fixed: string | number;
  igv_included: boolean; note: string | null; created_by: string | null; vigencia: "VIGENTE" | "PROGRAMADA" | "HISTORICA";
};
type Efectiva = { medio: string; cobros: number; cobrado: number; comision: number; pct: number };
type MedioCorto = { id: string; name: string; system_code: string | null };
type Datos = { comisiones: Comision[]; efectiva: Efectiva[]; medios: MedioCorto[] };
type Simulacion = { pct: number; fijo: number; comision: number; igv: number; neto: number; fila: { valid_from: string; valid_to: string | null; igv_included: boolean } | null };

const VIGENCIA: Record<Comision["vigencia"], [string, Tone]> = { VIGENTE: ["Vigente", "ok"], PROGRAMADA: ["Programada", "info"], HISTORICA: ["Histórica", "neutral"] };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/**
 * MAE-04 Comisiones por medio de pago: historial por vigencia (porcentaje, monto fijo, IGV incluido o no), simulador
 * «cobro de S/ 100,00 el día X» y comisión efectiva del mes. Una sola comisión por medio y fecha (RN-MAE-05).
 */
export default function Comisiones() {
  const { puede, can } = useSesion();
  const [medio, setMedio] = useState("");
  const { datos, error, recargar } = useDatos<Datos>(`/v1/mae/comisiones${medio ? `?payment_method_id=${medio}` : ""}`);
  const [nueva, setNueva] = useState(false);
  const gestiona = can("mae.payment_method.manage") && puede("MAE", "C");
  const mes = MESES[Number(hoyLima().slice(5, 7)) - 1];

  const columnas: Column<Comision>[] = [
    { key: "medio", header: "Medio", cardTitle: true, render: (f) => <span className="font-semibold">{f.medio}</span> },
    { key: "valid_from", header: "Desde", render: (f) => fecha(f.valid_from) },
    { key: "valid_to", header: "Hasta", render: (f) => (f.valid_to ? fecha(f.valid_to) : "Sin fin") },
    { key: "fee_pct", header: "%", align: "right", render: (f) => pct(Number(f.fee_pct)) },
    { key: "fee_fixed", header: "Fijo", align: "right", render: (f) => soles(Number(f.fee_fixed)) },
    { key: "igv_included", header: "IGV", hideOnMobile: true, render: (f) => (f.igv_included ? "Incluido" : "Más IGV") },
    { key: "vigencia", header: "Vigencia hoy", render: (f) => <Badge tone={VIGENCIA[f.vigencia][1]}>{VIGENCIA[f.vigencia][0]}</Badge> },
    { key: "note", header: "Nota", hideOnMobile: true, render: (f) => f.note ?? "—" },
  ];
  const columnasEfectiva: Column<Efectiva>[] = [
    { key: "medio", header: "Medio", cardTitle: true },
    { key: "cobros", header: "Cobros", align: "right", render: (r) => numero(r.cobros) },
    { key: "cobrado", header: "Cobrado", align: "right", render: (r) => soles(r.cobrado) },
    { key: "comision", header: "Comisión", align: "right", render: (r) => soles(r.comision) },
    { key: "pct", header: "%", align: "right", render: (r) => pct(r.pct) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Historial de comisiones por vigencia. Una sola comisión por medio y fecha; comisión = monto × % + fijo, redondeada a 2 decimales."
        actions={gestiona ? <Button variant="primary" onClick={() => setNueva(true)} disabled={!datos}>Nueva comisión</Button> : undefined} />

      <Alert tone="info">La comisión del POS Visa está por registrar y la de Mercado Pago (3,99 %) es una tasa de ejemplo hasta confirmar el contrato.</Alert>
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold">Simulador «cobro de {soles(100)} el día X»</h2>
          {datos ? <Simulador medios={datos.medios} /> : <p className="text-[13px] text-muted">Cargando…</p>}
        </section>
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Comisión efectiva de {mes}</h2>
          <DataTable columns={columnasEfectiva} rows={datos?.efectiva ?? []} rowKey={(r) => r.medio} loading={!datos && !error}
            empty={`Sin cobros confirmados en ${mes}.`} />
        </section>
      </div>

      <DataTable columns={columnas} rows={datos?.comisiones ?? []} loading={!datos && !error} empty="Sin comisiones registradas para ese medio."
        toolbar={
          <div className="w-full sm:w-[220px]">
            <Select aria-label="Medio" value={medio} onChange={(e) => setMedio(e.target.value)} placeholder="Medio: todos" className="!min-h-9 h-9 py-1.5 text-[13px]"
              options={(datos?.medios ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          </div>
        } />

      {nueva && datos && <NuevaComision medios={datos.medios} inicial={medio} onClose={() => setNueva(false)} onGuardado={() => { setNueva(false); recargar(); }} />}
    </div>
  );
}

/** Comisión de un cobro en una fecha, con la vigencia que le toca (RN-MAE-05) y el neto que se abona. */
function Simulador({ medios }: { medios: MedioCorto[] }) {
  const [v, setV] = useState({ medio: medios.find((m) => m.system_code === "MERCADOPAGO")?.id ?? medios[0]?.id ?? "", fecha: hoyLima(), monto: "100" });
  const [r, setR] = useState<Simulacion | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const monto = Number(v.monto);
    if (!v.medio || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha) || !(monto >= 0)) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Simulacion>(`/v1/mae/comisiones/simular?payment_method_id=${v.medio}&date=${v.fecha}&amount=${monto}`)
        .then((x) => { if (vigente) { setR(x); setError(""); } })
        .catch((e) => { if (vigente) setError(mensajeDe(e)); });
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [v.medio, v.fecha, v.monto]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
        <Field label="Medio"><Select value={v.medio} onChange={(e) => setV({ ...v, medio: e.target.value })} options={medios.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Fecha del cobro"><Input type="date" value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.target.value })} /></Field>
        <Field label="Monto (S/)"><Input type="number" min={0} step="0.01" value={v.monto} onChange={(e) => setV({ ...v, monto: e.target.value })} /></Field>
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {r && !error && (
        <DetailList items={[
          { label: "Comisión vigente", value: r.fila ? `${pct(r.pct)} + ${soles(r.fijo)} (del ${fecha(r.fila.valid_from)} ${r.fila.valid_to ? `al ${fecha(r.fila.valid_to)}` : "sin fin"})` : "Sin comisión para esa fecha" },
          { label: "Comisión del cobro", value: <b>{soles(r.comision)}</b> },
          ...(r.fila && !r.fila.igv_included ? [{ label: "IGV de la comisión", value: soles(r.igv) }] : []),
          { label: "Neto que se abona", value: soles(r.neto) },
        ]} />
      )}
    </div>
  );
}

/** Nueva vigencia de comisión; puede cerrar la abierta anterior el día previo. Las vigencias no se cruzan (RN-MAE-05). */
function NuevaComision({ medios, inicial, onClose, onGuardado }: { medios: MedioCorto[]; inicial: string; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({
    payment_method_id: inicial || medios[0]?.id || "", valid_from: hoyLima(), valid_to: "", fee_pct: "0", fee_fixed: "0",
    igv_included: true, close_previous: true, note: "",
  });
  return (
    <Dialogo titulo="Nueva comisión" boton="Registrar" onClose={onClose}
      aviso="Si se cruza con otra vigencia del mismo medio no se registra. Marca «Cerrar la vigencia abierta anterior» para que la anterior termine el día previo."
      enviar={async () => {
        await api("/v1/mae/comisiones", { method: "POST", body: {
          ...v, valid_to: v.valid_to || null, fee_pct: Number(v.fee_pct), fee_fixed: Number(v.fee_fixed || 0), note: v.note.trim() || null,
        } });
        toast.ok("Comisión registrada");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Medio" required error={e.payment_method_id} className="sm:col-span-2">
          <Select value={v.payment_method_id} onChange={(x) => setV({ ...v, payment_method_id: x.target.value })} options={medios.map((m) => ({ value: m.id, label: m.name }))} />
        </Field>
        <Field label="Vigente desde" required error={e.valid_from}><Input type="date" value={v.valid_from} onChange={(x) => setV({ ...v, valid_from: x.target.value })} /></Field>
        <Field label="Vigente hasta" error={e.valid_to} hint="Vacío: sin fecha de fin">
          <Input type="date" value={v.valid_to} min={v.valid_from} onChange={(x) => setV({ ...v, valid_to: x.target.value })} />
        </Field>
        <Field label="Porcentaje (%)" required error={e.fee_pct} hint="De 0 a 20">
          <Input type="number" min={0} max={20} step="0.01" value={v.fee_pct} onChange={(x) => setV({ ...v, fee_pct: x.target.value })} />
        </Field>
        <Field label="Monto fijo (S/)" error={e.fee_fixed}>
          <Input type="number" min={0} step="0.01" value={v.fee_fixed} onChange={(x) => setV({ ...v, fee_fixed: x.target.value })} />
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="La comisión incluye IGV" checked={v.igv_included} onChange={(si) => setV({ ...v, igv_included: si })} />
          <Checkbox label="Cerrar la vigencia abierta anterior el día previo" checked={v.close_previous} onChange={(si) => setV({ ...v, close_previous: si })} />
        </div>
        <Field label="Nota" error={e.note} className="sm:col-span-2"><Textarea value={v.note} maxLength={255} onChange={(x) => setV({ ...v, note: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}
