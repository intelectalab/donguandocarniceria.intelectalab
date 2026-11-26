"use client";

import { useState } from "react";
import { FilePen, Lock, Plus, Trash2 } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, Field, IconButton, Input, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { FichaAsiento, type FilaAsiento } from "@/modulos/cnt/Asiento";
import { ASIENTO, CifraLink, Seccion, hoyLima, num, opcionesCuenta, texto, useDatos, useOpcionesCnt } from "@/modulos/cnt/comunes";

type Cifras = { mine_pending: number; manual_month: number; period_open: boolean };
type Linea = { account_code: string; description: string; debit: string; credit: string; cost_center_id: string; brand_id: string; third_party_doc: string; third_party_name: string };
const vacia = (): Linea => ({ account_code: "", description: "", debit: "", credit: "", cost_center_id: "", brand_id: "", third_party_doc: "", third_party_name: "" });

/** CNT-04 Asiento manual: registro con validación de cuadre, cuentas, centro de costo y tercero; queda por aprobar. */
export default function AsientoManual() {
  const op = useOpcionesCnt();
  const c = useDatos<Cifras>("/v1/cnt/cifras/04");
  const mios = useListado<FilaAsiento>("/v1/cnt/asientos", { orden: "-created_at", filtros: { source: "MANUAL", mine: 1 } });
  const [f, setF] = useState({ entry_date: hoyLima(), description: "", reference: "", brand_id: "", establishment_id: "", destination: true });
  const [lineas, setLineas] = useState<Linea[]>([vacia(), vacia()]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const debe = lineas.reduce((s, l) => s + (num(l.debit) ?? 0), 0);
  const haber = lineas.reduce((s, l) => s + (num(l.credit) ?? 0), 0);
  const cuadra = Math.abs(debe - haber) < 0.005 && debe > 0;
  const cuenta = (code: string) => op?.accounts.find((a) => a.code === code);
  const cambiar = (i: number, c: Partial<Linea>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...c } : l)));
  const guardar = async (borrador: boolean) => {
    setGuardando(true); setError(""); setErrores({});
    try {
      const r = await api<{ id: string; number: string | null }>("/v1/cnt/asientos", { method: "POST", body: {
        ...f, brand_id: f.brand_id || null, establishment_id: f.establishment_id || null, reference: f.reference || null, draft: borrador,
        lines: lineas.filter((l) => l.account_code || l.debit || l.credit).map((l) => ({
          account_code: l.account_code || null, description: l.description || null, debit: num(l.debit) ?? 0, credit: num(l.credit) ?? 0, cost_center_id: l.cost_center_id || null,
          brand_id: l.brand_id || null, third_party_doc: l.third_party_doc || null, third_party_name: l.third_party_name || null,
        })),
      } });
      toast.ok(borrador ? "Borrador guardado" : "Asiento enviado a aprobación de la contadora");
      setLineas([vacia(), vacia()]); setF({ ...f, description: "", reference: "" }); mios.recargar(); c.recargar(); setAbierto(r.id);
    } catch (e) { const p = erroresDe(e); setErrores(p); if (!Object.keys(p).length) setError(mensajeDe(e)); }
    finally { setGuardando(false); }
  };
  if (op && !op.can.prepare) return <div className="space-y-5"><PageHeader description="Registro de asientos manuales." /><Alert tone="info">Los asientos manuales los registra el equipo contable.</Alert></div>;
  return (
    <div className="space-y-5">
      <PageHeader description="Un asiento que no nace de un documento: provisiones, ajustes, reclasificaciones. Tiene que cuadrar y lo aprueba la contadora; quien lo prepara no puede aprobarlo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Míos por aprobar" valor={c.datos ? numero(c.datos.mine_pending) : undefined} icono={FilePen} />
        <CifraLink titulo="Manuales del mes" valor={c.datos ? numero(c.datos.manual_month) : undefined} icono={FilePen} href="/m/cnt/cnt-03" />
        <CifraLink titulo="Período actual" valor={c.datos ? (c.datos.period_open ? "Abierto" : "Cerrado") : undefined} icono={Lock} tono={c.datos && !c.datos.period_open ? "bad" : "ok"} href="/m/cnt/cnt-12" />
      </div>
      <Seccion titulo="Nuevo asiento">
        {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fecha" required error={errores.entry_date}><Input type="date" value={f.entry_date} onChange={(e) => setF({ ...f, entry_date: e.target.value })} /></Field>
          <Field label="Marca" error={errores.brand_id}><Select value={f.brand_id} placeholder="Ninguna" onChange={(e) => setF({ ...f, brand_id: e.target.value })} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Field>
          <Field label="Local" error={errores.establishment_id}><Select value={f.establishment_id} placeholder="Ninguno" onChange={(e) => setF({ ...f, establishment_id: e.target.value })} options={(op?.establishments ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
          <Field label="Referencia" error={errores.reference}><Input value={f.reference} maxLength={255} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Glosa" required error={errores.description} className="sm:col-span-2 lg:col-span-4"><Textarea value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <div className="mt-4 space-y-3">
          {lineas.map((l, i) => {
            const a = cuenta(l.account_code);
            return (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                <Field label={`Línea ${i + 1}: cuenta`} error={errores[`lines.${i}.account_code`]}><Select value={l.account_code} placeholder="Elegir" onChange={(e) => cambiar(i, { account_code: e.target.value })} options={opcionesCuenta(op)} /></Field>
                <Field label="Debe" error={errores[`lines.${i}.debit`]}><Input inputMode="decimal" prefix="S/" value={l.debit} onChange={(e) => cambiar(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></Field>
                <Field label="Haber" error={errores[`lines.${i}.credit`]}><Input inputMode="decimal" prefix="S/" value={l.credit} onChange={(e) => cambiar(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></Field>
                <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas(lineas.length > 2 ? lineas.filter((_, j) => j !== i) : lineas.map((x, j) => (j === i ? vacia() : x)))} />
                {(a?.requires_cost_center || a?.requires_brand || a?.requires_third_party) && <div className="grid gap-2 sm:grid-cols-2 lg:col-span-4 lg:grid-cols-4">
                  {a.requires_cost_center && <Field label="Centro de costo" required><Select value={l.cost_center_id} placeholder="Elegir" onChange={(e) => cambiar(i, { cost_center_id: e.target.value })} options={(op?.cost_centers ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} /></Field>}
                  {a.requires_brand && <Field label="Marca de la línea" required><Select value={l.brand_id} placeholder="Elegir" onChange={(e) => cambiar(i, { brand_id: e.target.value })} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} /></Field>}
                  {a.requires_third_party && <><Field label="RUC o DNI del tercero" required><Input value={l.third_party_doc} inputMode="numeric" maxLength={20} onChange={(e) => cambiar(i, { third_party_doc: e.target.value })} /></Field>
                    <Field label="Nombre del tercero"><Input value={l.third_party_name} maxLength={200} onChange={(e) => cambiar(i, { third_party_name: e.target.value })} /></Field></>}
                </div>}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" icon={Plus} onClick={() => setLineas([...lineas, vacia()])}>Agregar línea</Button>
            <p className={`text-[13px] tabular-nums ${cuadra ? "text-ok" : "text-bad"}`}>Debe {soles(debe)} · Haber {soles(haber)}{!cuadra && debe + haber > 0 ? ` · diferencia ${soles(debe - haber)}` : ""}</p>
          </div>
          {errores.lines && <p className="text-[12.5px] text-bad">{errores.lines}</p>}
          <Checkbox checked={f.destination} onChange={(v) => setF({ ...f, destination: v })} label="Generar las líneas de destino (clase 9 contra 79) de los gastos" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => guardar(true)} loading={guardando}>Guardar borrador</Button>
            <Button variant="primary" disabled={!cuadra} loading={guardando} onClick={() => guardar(false)}>Enviar a aprobación</Button>
          </div>
        </div>
      </Seccion>
      <Seccion titulo="Mis asientos manuales">
        <DataTable {...mios.tabla} onRowClick={(a) => setAbierto(a.id)} empty="Todavía no registras asientos manuales." columns={[
          { key: "number", header: "Asiento", cardTitle: true, render: (a) => <div><p className="font-medium tabular-nums">{a.number ?? "Sin número"}</p><p className="text-[12px] text-muted">{texto(a.description)}</p></div> },
          { key: "entry_date", header: "Fecha", render: (a) => fecha(a.entry_date) },
          { key: "total_debit", header: "Importe", align: "right", render: (a) => soles(a.total_debit) },
          { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ASIENTO} /> },
        ]} />
      </Seccion>
      {abierto && <FichaAsiento id={abierto} op={op} onClose={() => setAbierto(null)} onCambio={() => { mios.recargar(); c.recargar(); }} />}
    </div>
  );
}
