"use client";

import { useState } from "react";
import { History, ListChecks, Plus, Trash2, Workflow, Zap } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, Field, IconButton, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { CifraLink, FiltroSelect, accion, hoyLima, opciones, opcionesCuenta, qs, texto, useDatos, useOpcionesCnt, type Etiquetas, type OpcionesCnt } from "@/modulos/cnt/comunes";

type Regla = {
  id: string; code: string; source: string; subtype: string; name: string; auto_approve: boolean; allocate_common: boolean; status: string; valid_from: string; valid_to: string | null;
  version: number; approved_by_name: string | null; approved_at: string | null; line_count: number; entries: number; source_label: string;
};
type Linea = { side: "D" | "C"; account_from: string; account_code: string | null; param_key: string | null; amount_key: string; third: string | null; account_name?: string | null };
type Detalle = Regla & { lines: (Linea & { id: string; seq: number })[] };
type Respuesta = { data: Regla[]; sources: Record<string, string>; amounts: Record<string, string> };
type Cifras = { active: number; auto_approve: number; sources: number };

const DE_DONDE: Record<string, string> = {
  FIXED: "Cuenta fija", DETAIL: "La del producto o gasto de cada línea", CASH: "La de la caja o banco que cobra o paga", CASH_TO: "La de la caja o banco que recibe",
  PAYABLE: "La por pagar del proveedor", PARAM: "La de un parámetro de la empresa",
};
const TERCERO: Record<string, string> = { DOC: "El del documento", CASH: "La caja o banco", CASH_TO: "La caja o banco que recibe" };
const ESTADO_REGLA: Etiquetas = { ACTIVE: ["Vigente", "ok"], INACTIVE: ["Inactiva", "neutral"] };

/** CNT-02 Reglas de asiento: por origen y subtipo, qué cuenta va al debe y al haber y qué importe toma. */
export default function Reglas() {
  const op = useOpcionesCnt();
  const [origen, setOrigen] = useState("");
  const [historia, setHistoria] = useState(false);
  const { datos: r, recargar } = useDatos<Respuesta>(`/v1/cnt/reglas${qs({ source: origen, history: historia ? 1 : null })}`);
  const c = useDatos<Cifras>("/v1/cnt/cifras/02");
  const [abierta, setAbierta] = useState<string | "nueva" | null>(null);
  const columnas: Column<Regla>[] = [
    { key: "name", header: "Regla", cardTitle: true, render: (x) => <div className="min-w-[220px]"><p className="font-medium">{texto(x.name)}</p><p className="text-[12px] text-muted">{x.source_label}{x.subtype !== "*" ? ` · ${x.subtype}` : ""} · versión {x.version}</p></div> },
    { key: "valid_from", header: "Rige", render: (x) => <span className="text-[13px]">{fecha(x.valid_from)}{x.valid_to ? ` al ${fecha(x.valid_to)}` : " en adelante"}</span> },
    { key: "line_count", header: "Líneas", align: "right", hideOnMobile: true, render: (x) => numero(x.line_count) },
    { key: "entries", header: "Asientos", align: "right", render: (x) => numero(x.entries) },
    { key: "auto_approve", header: "Aprobación", render: (x) => x.auto_approve ? <Badge tone="primary">Automática</Badge> : <span className="text-muted">La contadora</span> },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADO_REGLA} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Cómo se arma el asiento de cada documento. Cambiar una regla que ya generó asientos crea una versión nueva desde la fecha que indiques; los asientos anteriores no cambian."
        actions={op?.can.rules && <Button variant="primary" icon={Plus} onClick={() => setAbierta("nueva")}>Nueva regla</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Reglas vigentes" valor={c.datos ? numero(c.datos.active) : undefined} icono={ListChecks} onClick={() => setHistoria(false)} />
        <CifraLink titulo="Con aprobación automática" valor={c.datos ? numero(c.datos.auto_approve) : undefined} detalle="Sus asientos no pasan por la contadora" icono={Zap} />
        <CifraLink titulo="Orígenes cubiertos" valor={c.datos ? numero(c.datos.sources) : undefined} detalle={r ? `de ${Object.keys(r.sources).length}` : undefined} icono={Workflow} />
      </div>
      <DataTable rows={r?.data ?? []} rowKey={(x) => x.id} loading={!r} columns={columnas} onRowClick={(x) => setAbierta(x.id)} empty="No hay reglas con esos filtros."
        toolbar={<>
          <FiltroSelect label="Origen" value={origen} onChange={setOrigen} options={opciones(r?.sources ?? {})} ancho="sm:w-[200px]" />
          <Button size="sm" icon={History} variant={historia ? "primary" : undefined} onClick={() => setHistoria(!historia)}>{historia ? "Con versiones anteriores" : "Ver versiones anteriores"}</Button>
        </>} />
      {abierta && op && r && <FichaRegla id={abierta === "nueva" ? null : abierta} op={op} fuentes={r.sources} importes={r.amounts} onClose={() => setAbierta(null)}
        onCambio={() => { recargar(); c.recargar(); }} />}
    </div>
  );
}

function FichaRegla({ id, op, fuentes, importes, onClose, onCambio }: {
  id: string | null; op: OpcionesCnt; fuentes: Record<string, string>; importes: Record<string, string>; onClose: () => void; onCambio: () => void;
}) {
  const { datos: d } = useDatos<Detalle>(id ? `/v1/cnt/reglas/${id}` : null);
  const [editando, setEditando] = useState(!id);
  if (id && !d) return <Modal open onClose={onClose} title="Regla" size="xl"><p className="text-muted">Cargando…</p></Modal>;
  if (editando) return <FormRegla regla={d ?? null} op={op} fuentes={fuentes} importes={importes} onClose={id ? () => setEditando(false) : onClose} onGuardado={() => { onCambio(); onClose(); }} />;
  const x = d!;
  return (
    <Modal open onClose={onClose} size="xl" title={texto(x.name)} description={`${x.source_label}${x.subtype !== "*" ? ` · ${x.subtype}` : ""} · versión ${x.version} · rige desde el ${fecha(x.valid_from)}${x.valid_to ? ` hasta el ${fecha(x.valid_to)}` : ""}`}
      footer={op.can.rules && !x.valid_to ? <>
        <Button onClick={() => accion({ title: x.status === "ACTIVE" ? "¿Desactivar la regla?" : "¿Activar la regla?", message: x.status === "ACTIVE" ? "Los documentos nuevos de este origen irán a la bandeja de la contadora." : undefined, confirmLabel: x.status === "ACTIVE" ? "Desactivar" : "Activar", danger: x.status === "ACTIVE" },
          () => api(`/v1/cnt/reglas/${x.id}/estado`, { method: "POST", body: { status: x.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" } }), "Regla actualizada", () => { onCambio(); onClose(); })}>
          {x.status === "ACTIVE" ? "Desactivar" : "Activar"}</Button>
        <Button variant="primary" onClick={() => setEditando(true)}>{x.entries ? "Nueva versión" : "Editar"}</Button>
      </> : undefined}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {x.auto_approve ? <Badge tone="primary">Aprobación automática</Badge> : <Badge>Aprueba la contadora</Badge>}
          {x.allocate_common && <Badge tone="info">Reparte gastos comunes entre marcas</Badge>}
          <Badge tone="neutral">{numero(x.entries)} asientos generados</Badge>
          {x.approved_by_name && <span className="text-[12.5px] text-muted">Aprobada por {x.approved_by_name}</span>}
        </div>
        <TablaLineas lineas={x.lines} importes={importes} />
      </div>
    </Modal>
  );
}

function TablaLineas({ lineas, importes }: { lineas: Linea[]; importes: Record<string, string> }) {
  return (
    <DataTable rows={lineas.map((l, i) => ({ ...l, i }))} rowKey={(l) => String(l.i)} columns={[
      { key: "side", header: "Lado", render: (l) => <Badge tone={l.side === "D" ? "info" : "primary"}>{l.side === "D" ? "Debe" : "Haber"}</Badge> },
      { key: "account", header: "Cuenta", cardTitle: true, render: (l) => l.account_from === "FIXED"
        ? <span><span className="tabular-nums">{l.account_code}</span> {l.account_name}</span> : <span className="text-muted">{DE_DONDE[l.account_from] ?? l.account_from}</span> },
      { key: "amount_key", header: "Importe", render: (l) => importes[l.amount_key] ?? l.amount_key },
      { key: "third", header: "Tercero", render: (l) => l.third ? TERCERO[l.third] ?? l.third : <span className="text-muted">—</span> },
    ]} />
  );
}

function FormRegla({ regla, op, fuentes, importes, onClose, onGuardado }: {
  regla: Detalle | null; op: OpcionesCnt; fuentes: Record<string, string>; importes: Record<string, string>; onClose: () => void; onGuardado: () => void;
}) {
  const [f, setF] = useState({
    source: regla?.source ?? "EXPENSE", subtype: regla?.subtype ?? "*", name: texto(regla?.name), auto_approve: regla?.auto_approve ?? false, allocate_common: regla?.allocate_common ?? false,
    valid_from: regla?.entries ? hoyLima() : regla?.valid_from ?? hoyLima(),
  });
  const [lineas, setLineas] = useState<Linea[]>(regla?.lines.map((l) => ({ side: l.side, account_from: l.account_from, account_code: l.account_code, param_key: l.param_key, amount_key: l.amount_key, third: l.third }))
    ?? [{ side: "D", account_from: "DETAIL", account_code: null, param_key: null, amount_key: "BASE", third: null }, { side: "C", account_from: "PAYABLE", account_code: null, param_key: null, amount_key: "TOTAL", third: "DOC" }]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const cambiar = (i: number, c: Partial<Linea>) => setLineas(lineas.map((l, j) => (j === i ? { ...l, ...c } : l)));
  const guardar = async () => {
    setGuardando(true); setError(""); setErrores({});
    try {
      await api(regla ? `/v1/cnt/reglas/${regla.id}` : "/v1/cnt/reglas", { method: regla ? "PUT" : "POST", body: { ...f, lines: lineas.map((l) => ({ ...l, account_code: l.account_from === "FIXED" ? l.account_code : null })) } });
      toast.ok(regla?.entries ? "Nueva versión de la regla guardada" : "Regla guardada"); onGuardado();
    } catch (e) { const p = erroresDe(e); setErrores(p); if (!Object.keys(p).length) setError(mensajeDe(e)); }
    finally { setGuardando(false); }
  };
  const cuentas = opcionesCuenta(op);
  return (
    <Modal open onClose={onClose} size="xl" dismissable={!guardando} title={regla ? (regla.entries ? `Nueva versión de ${texto(regla.name)}` : texto(regla.name)) : "Nueva regla"}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-4">
        {regla?.entries ? <Alert tone="info">La regla ya generó {numero(regla.entries)} asientos: la versión actual se cierra el día anterior a la fecha de inicio y la nueva rige desde esa fecha.</Alert> : null}
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Origen" required error={errores.source}><Select value={f.source} disabled={!!regla} onChange={(e) => setF({ ...f, source: e.target.value })} options={opciones(fuentes)} /></Field>
          <Field label="Subtipo" error={errores.subtype} hint="«*» para todos los documentos del origen"><Input value={f.subtype} maxLength={40} disabled={!!regla} onChange={(e) => setF({ ...f, subtype: e.target.value })} /></Field>
          <Field label="Nombre" required error={errores.name}><Input value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Rige desde" error={errores.valid_from}><Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
          <div className="grid gap-2 sm:col-span-2">
            <Checkbox checked={f.auto_approve} onChange={(v) => setF({ ...f, auto_approve: v })} label="Aprobación automática" hint="Los asientos que cuadran se aprueban solos; los demás van a la contadora." />
            <Checkbox checked={f.allocate_common} onChange={(v) => setF({ ...f, allocate_common: v })} label="Repartir los gastos comunes entre las marcas" />
          </div>
        </div>
        <div className="space-y-3">
          {lineas.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[6rem_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field label="Lado"><Select value={l.side} onChange={(e) => cambiar(i, { side: e.target.value as "D" | "C" })} options={[{ value: "D", label: "Debe" }, { value: "C", label: "Haber" }]} /></Field>
              <Field label="Cuenta" error={errores[`lines.${i}.account_from`]}><Select value={l.account_from} onChange={(e) => cambiar(i, { account_from: e.target.value })} options={opciones(DE_DONDE)} /></Field>
              {l.account_from === "FIXED" ? <Field label="Cuenta fija" error={errores[`lines.${i}.account_code`]}><Select value={l.account_code ?? ""} placeholder="Elegir" onChange={(e) => cambiar(i, { account_code: e.target.value })} options={cuentas} /></Field>
                : l.account_from === "PARAM" ? <Field label="Parámetro"><Input value={l.param_key ?? ""} onChange={(e) => cambiar(i, { param_key: e.target.value })} /></Field> : <div className="hidden sm:block" />}
              <Field label="Importe" error={errores[`lines.${i}.amount_key`]}><Select value={l.amount_key} onChange={(e) => cambiar(i, { amount_key: e.target.value })} options={opciones(importes)} /></Field>
              <Field label="Tercero"><Select value={l.third ?? ""} placeholder="Ninguno" onChange={(e) => cambiar(i, { third: e.target.value || null })} options={opciones(TERCERO)} /></Field>
              <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas(lineas.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => setLineas([...lineas, { side: "D", account_from: "FIXED", account_code: null, param_key: null, amount_key: "TOTAL", third: null }])}>Agregar línea</Button>
          {errores.lines && <p className="text-[12.5px] text-bad">{errores.lines}</p>}
        </div>
      </div>
    </Modal>
  );
}
