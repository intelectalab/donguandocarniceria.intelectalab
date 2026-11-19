"use client";

import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { Plus, Printer, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DetailList, Field, Input, Modal, Select, StatusBadge, Textarea, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { accion, num, useDatos } from "@/modulos/alm/comunes";
import { CATEGORIAS, ESTADO_ORDEN, ESTADOS, FRIO, RESULTADO, TIPO_ORDEN, URGENCIA, type Equipo, type Opciones, type Orden } from "./tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, Barras, useAlAbrir, useParametrosIniciales } from "@/modulos/alm/comunes";

let cacheOpciones: Promise<Opciones> | null = null;

/** Opciones de los formularios de EQU (locales, almacenes, equipos, proveedores…), una vez por carga de página. */
export function useOpcionesEqu(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cacheOpciones ??= api<Opciones>("/v1/equ/opciones");
    cacheOpciones.then((o) => vigente && setOp(o)).catch((e) => { cacheOpciones = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
/** Después de crear o editar un equipo, las opciones se vuelven a pedir. */
export const olvidarOpcionesEqu = () => { cacheOpciones = null; };

/** «SEL-L1-01 · Empacadora al vacío de campana» para un Select. */
export const opcionesEquipo = (op: Opciones | null, filtro?: (e: Opciones["equipment"][number]) => boolean) =>
  (op?.equipment ?? []).filter(filtro ?? (() => true)).map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }));

/** Dirección que abre el QR: el reporte de falla con el equipo ya elegido (EQU-07). */
export const urlDelQr = (codigoQr: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/m/equ/equ-07?code=${encodeURIComponent(codigoQr)}`;

/** Código QR en SVG (se ve igual en claro y oscuro: fondo blanco, módulos negros). */
export function Qr({ texto, tamano = 120, titulo }: { texto: string; tamano?: number; titulo?: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d, n: n + 4 };
  }, [texto]);
  return (
    <svg role="img" aria-label={titulo ?? `Código QR ${texto}`} width={tamano} height={tamano} viewBox={`0 0 ${svg.n} ${svg.n}`} shapeRendering="crispEdges" className="rounded-md">
      <rect width={svg.n} height={svg.n} fill="#fff" />
      <path d={svg.d} fill="#000" />
    </svg>
  );
}

/** Ventana con el QR grande para imprimir y pegar en el equipo. */
export function VentanaQr({ e, onClose }: { e: { code: string; name: string; qr_code: string; establishment_name?: string }; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} placement="center" title={`QR de ${e.code}`}
      footer={<><Button onClick={onClose}>Cerrar</Button><Button variant="primary" icon={Printer} onClick={() => window.print()}>Imprimir</Button></>}>
      <div className="flex flex-col items-center gap-2 text-center">
        <Qr texto={urlDelQr(e.qr_code)} tamano={220} titulo={`QR de ${e.code}`} />
        <p className="font-mono text-[15px] font-semibold">{e.qr_code}</p>
        <p className="text-[13.5px]">{e.name}</p>
        <p className="text-[12.5px] text-muted">{e.establishment_name ? `${e.establishment_name} · ` : ""}Escanéalo con el celular para reportar una falla.</p>
      </div>
    </Modal>
  );
}

/** Apto o no apto para usarse hoy (RN-EQU-03 y RN-EQU-04). */
export function Apto({ usable, rule }: { usable: boolean; rule?: string | null }) {
  if (usable) return <Badge tone="ok">Apto</Badge>;
  return <Badge tone="bad">{rule === "RN-EQU-03" ? "Calibración vencida" : "No usar"}</Badge>;
}

/** Días hasta una fecha: «vence en 12 d», «venció hace 3 d». */
export function DiasVence({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined) return <span className="text-muted">—</span>;
  const tono = d < 0 ? "text-bad" : d <= 30 ? "text-warn" : "text-ink";
  return <span className={`whitespace-nowrap tabular-nums font-medium ${tono}`}>{d < 0 ? `Venció hace ${-d} d` : d === 0 ? "Vence hoy" : `${d} d`}</span>;
}

/* ============================================================ formulario de equipo (EQU-01, EQU-02) */

/** Crear o editar un equipo. RN-EQU-01 (balanza calibrada) y RN-EQU-11 (cámara con punto de temperatura) los valida la API. */
export function FormEquipo({ e, op, onClose, onGuardado }: { e?: Equipo | null; op: Opciones; onClose: () => void; onGuardado: (id: string) => void }) {
  const { local } = useSesion();
  const inicial = e?.establishment_id ?? (local !== "ALL" ? local : op.establishments[0]?.id ?? "");
  const [f, setF] = useState({
    code: e?.code ?? "", name: e?.name ?? "", category: e?.category ?? "SEALER", establishment_id: inicial, warehouse_id: e?.warehouse_id ?? "",
    cost_center_id: e?.cost_center_id ?? "", requires_calibration: e?.requires_calibration ?? false, brand_name: e?.brand_name ?? "", model: e?.model ?? "",
    serial_number: e?.serial_number ?? "", capacity: e?.capacity ?? "", purchase_date: e?.purchase_date ?? "", purchase_cost: e?.purchase_cost != null ? String(e.purchase_cost) : "",
    useful_life_months: e?.useful_life_months != null ? String(e.useful_life_months) : "", hourly_rate: e?.hourly_rate != null ? String(Number(e.hourly_rate)) : "0",
    power_kw: e?.power_kw != null ? String(e.power_kw) : "", manual_url: e?.manual_url ?? "", status: e?.status ?? "ACTIVE", notes: e?.notes ?? "",
  });
  const almacenes = op.warehouses.filter((w) => w.establishment_id === f.establishment_id);
  const centros = op.cost_centers.filter((c) => !c.establishment_id || c.establishment_id === f.establishment_id);
  const balanza = f.category === "SCALE";
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={e ? `Editar ${e.code}` : "Nuevo equipo"} boton={e ? "Guardar" : "Crear equipo"} onClose={onClose}
      aviso={FRIO.includes(f.category) ? "Una cámara o congeladora activa necesita su punto de temperatura registrado en Calidad. Sin él, guárdala como fuera de servicio." : undefined}
      enviar={async () => {
        const body = {
          ...f, requires_calibration: balanza || f.requires_calibration, warehouse_id: f.warehouse_id || null, cost_center_id: f.cost_center_id || null,
          purchase_date: f.purchase_date || null, purchase_cost: num(f.purchase_cost), useful_life_months: f.useful_life_months ? Number(f.useful_life_months) : null,
          hourly_rate: num(f.hourly_rate) ?? 0, power_kw: num(f.power_kw),
        };
        const r = await api<{ id: string; code: string }>(e ? `/v1/equ/equipos/${e.id}` : "/v1/equ/equipos", { method: e ? "PUT" : "POST", body });
        olvidarOpcionesEqu();
        toast.ok(`Equipo ${r.code} guardado`);
        onGuardado(r.id);
      }}>
      {(err) => <>
        <Field label="Código" required error={err.code} hint="Por ejemplo SEL-L1-02; el QR será EQ- y el código"><Input value={f.code} maxLength={40} onChange={(x) => set("code", x.target.value.toUpperCase())} /></Field>
        <Field label="Nombre" required error={err.name}><Input value={f.name} maxLength={80} onChange={(x) => set("name", x.target.value)} /></Field>
        <Field label="Categoría" required error={err.category}>
          <Select value={f.category} options={CATEGORIAS} onChange={(x) => setF({ ...f, category: x.target.value, requires_calibration: x.target.value === "SCALE" ? true : f.requires_calibration })} />
        </Field>
        <Field label="Local" required error={err.establishment_id}>
          <Select value={f.establishment_id} options={op.establishments.map((l) => ({ value: l.id, label: l.short ?? l.name }))}
            onChange={(x) => setF({ ...f, establishment_id: x.target.value, warehouse_id: "", cost_center_id: "" })} />
        </Field>
        <Field label="Almacén asociado" error={err.warehouse_id} hint="Para cámaras, congeladoras y balanzas de mostrador">
          <Select value={f.warehouse_id} placeholder="Ninguno" options={almacenes.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} onChange={(x) => set("warehouse_id", x.target.value)} />
        </Field>
        <Field label="Centro de costo" error={err.cost_center_id} hint="Ahí se cargan sus mantenimientos">
          <Select value={f.cost_center_id} placeholder="El de producción del local" options={centros.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} onChange={(x) => set("cost_center_id", x.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={balanza || f.requires_calibration} disabled={balanza} onChange={(v) => set("requires_calibration", v)} label="Exige calibración"
            hint={balanza ? "Toda balanza exige calibración." : "Por ejemplo, termómetros de olla. Sin calibración vigente no se usa."} />
        </div>
        <Field label="Marca" error={err.brand_name}><Input value={f.brand_name} maxLength={40} onChange={(x) => set("brand_name", x.target.value)} /></Field>
        <Field label="Modelo" error={err.model}><Input value={f.model} maxLength={40} onChange={(x) => set("model", x.target.value)} /></Field>
        <Field label="N.º de serie" error={err.serial_number}><Input value={f.serial_number} maxLength={40} onChange={(x) => set("serial_number", x.target.value)} /></Field>
        <Field label="Capacidad" error={err.capacity} hint="30 kg × 2 g, 100 L…"><Input value={f.capacity} maxLength={40} onChange={(x) => set("capacity", x.target.value)} /></Field>
        <Field label="Fecha de compra" error={err.purchase_date}><Input type="date" value={f.purchase_date} onChange={(x) => set("purchase_date", x.target.value)} /></Field>
        <Field label="Costo de compra" error={err.purchase_cost}><Input inputMode="decimal" prefix="S/" value={f.purchase_cost} onChange={(x) => set("purchase_cost", x.target.value)} /></Field>
        <Field label="Vida útil" error={err.useful_life_months}><Input inputMode="numeric" suffix="meses" value={f.useful_life_months} onChange={(x) => set("useful_life_months", x.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Potencia" error={err.power_kw}><Input inputMode="decimal" suffix="kW" value={f.power_kw} onChange={(x) => set("power_kw", x.target.value)} /></Field>
        <Field label="Carga por hora" error={err.hourly_rate} hint="La fija el jefe de producción"><Input inputMode="decimal" prefix="S/" value={f.hourly_rate} onChange={(x) => set("hourly_rate", x.target.value)} /></Field>
        <Field label="Estado" error={err.status}><Select value={f.status} options={ESTADOS} onChange={(x) => set("status", x.target.value)} /></Field>
        <Field label="Manual" error={err.manual_url} className="sm:col-span-2" hint="Ruta o enlace del PDF"><Input value={f.manual_url} maxLength={255} onChange={(x) => set("manual_url", x.target.value)} /></Field>
        <Field label="Notas" error={err.notes} className="sm:col-span-2"><Textarea value={f.notes} rows={2} onChange={(x) => set("notes", x.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}

/* ============================================================ calibración (EQU-03, EQU-04, EQU-02) */

/** Registrar una calibración (solo inserción, RN-EQU-12). Avisa cómo queda el equipo según el resultado. */
export function FormCalibracion({ op, equipoId, onClose, onGuardado }: { op: Opciones; equipoId?: string | null; onClose: () => void; onGuardado: () => void }) {
  const calibran = op.equipment.filter((e) => e.requires_calibration || e.category === "SCALE");
  const [f, setF] = useState({
    equipment_id: equipoId ?? "", calibrated_on: op.today, valid_until: op.suggested_valid_until, provider_supplier_id: "", provider_name: "",
    certificate_number: "", certificate_url: "", max_error_g: "", result: "PASS", cost: "", notes: "",
  });
  const apto = useDatos<{ usable: boolean; rule: string | null; message: string | null }>(f.equipment_id ? `/v1/equ/equipos/${f.equipment_id}/apto` : null).datos;
  const eq = op.equipment.find((e) => e.id === f.equipment_id);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo="Registrar calibración" boton="Registrar" onClose={onClose}
      aviso="Las calibraciones no se editan ni se borran: si hay un error, registra otra."
      enviar={async () => {
        await api("/v1/equ/calibraciones", { method: "POST", body: { ...f, provider_supplier_id: f.provider_supplier_id || null, max_error_g: num(f.max_error_g), cost: num(f.cost) ?? 0 } });
        toast.ok(`Calibración de ${eq?.code ?? "equipo"} registrada`);
        onGuardado();
      }}>
      {(err) => <>
        <Field label="Equipo" required error={err.equipment_id} className="sm:col-span-2">
          <Select value={f.equipment_id} placeholder="Elegir" searchable options={(calibran.length ? calibran : op.equipment).map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))}
            onChange={(x) => set("equipment_id", x.target.value)} />
        </Field>
        {eq && apto && <div className="sm:col-span-2">
          <Alert tone={f.result === "FAIL" ? "bad" : apto.usable ? "ok" : "warn"}>
            {apto.usable ? `${eq.code} está apto hoy.` : apto.message}{" "}
            {f.result === "FAIL" ? "Un resultado no conforme lo deja fuera de servicio hasta una nueva calibración conforme."
              : `Con esta calibración conforme quedará apto hasta el ${fecha(f.valid_until)}.`}
          </Alert>
        </div>}
        <Field label="Fecha de calibración" required error={err.calibrated_on}><Input type="date" value={f.calibrated_on} max={op.today} onChange={(x) => set("calibrated_on", x.target.value)} /></Field>
        <Field label="Vigente hasta" required error={err.valid_until} hint={`Sugerido: ${op.params.scale_calibration_months} meses`}>
          <Input type="date" value={f.valid_until} onChange={(x) => set("valid_until", x.target.value)} />
        </Field>
        <Field label="Proveedor registrado" error={err.provider_supplier_id}>
          <Select value={f.provider_supplier_id} placeholder="Ninguno" searchable options={op.suppliers.map((s) => ({ value: s.id, label: s.legal_name }))} onChange={(x) => set("provider_supplier_id", x.target.value)} />
        </Field>
        <Field label="Proveedor (nombre)" error={err.provider_name} hint="Laboratorio que entrega el certificado"><Input value={f.provider_name} maxLength={255} onChange={(x) => set("provider_name", x.target.value)} /></Field>
        <Field label="N.º de certificado" required error={err.certificate_number} hint="Obligatorio"><Input value={f.certificate_number} maxLength={40} onChange={(x) => set("certificate_number", x.target.value.toUpperCase())} /></Field>
        <Field label="Archivo del certificado" required error={err.certificate_url} hint="Ruta o enlace del PDF"><Input value={f.certificate_url} maxLength={255} placeholder="certificados/CC-2026-118.pdf" onChange={(x) => set("certificate_url", x.target.value)} /></Field>
        <Field label="Resultado" required error={err.result}>
          <Select value={f.result} options={[{ value: "PASS", label: "Conforme" }, { value: "FAIL", label: "No conforme" }]} onChange={(x) => set("result", x.target.value)} />
        </Field>
        <Field label="Error máximo encontrado" error={err.max_error_g}><Input inputMode="decimal" suffix={eq?.category === "THERMOMETER" ? "°C" : "g"} value={f.max_error_g} onChange={(x) => set("max_error_g", x.target.value)} /></Field>
        <Field label="Costo" error={err.cost}><Input inputMode="decimal" prefix="S/" value={f.cost} onChange={(x) => set("cost", x.target.value)} /></Field>
        <Field label="Notas" error={err.notes}><Input value={f.notes} onChange={(x) => set("notes", x.target.value)} /></Field>
      </>}
    </Dialogo>
  );
}

export const resultado = (r: string) => <StatusBadge status={r} labels={RESULTADO} />;

/* ============================================================ orden de mantenimiento (EQU-06, EQU-02, EQU-07) */

/** Ficha de una orden con iniciar, terminar y costear, o anular. */
export function FichaOrden({ id, op, onClose, onCambio }: { id: string; op: Opciones | null; onClose: () => void; onCambio: () => void }) {
  const { puede } = useSesion();
  const { datos: o, error, recargar } = useDatos<Orden>(`/v1/equ/ordenes/${id}`);
  const [cerrando, setCerrando] = useState(false);
  const gestiona = Boolean(op?.can.maintain) && puede("EQU", "E");
  const abierta = o && (o.status === "OPEN" || o.status === "IN_PROGRESS");
  const cambio = () => { recargar(); onCambio(); };
  return (
    <Modal open onClose={onClose} size="lg" title={o ? `${o.number} · ${o.equipment_code}` : "Orden de mantenimiento"}
      footer={o && gestiona && abierta && <>
        {puede("EQU", "A") && <Button variant="danger" onClick={() => accion({ title: `¿Anular ${o.number}?`, confirmLabel: "Anular", danger: true, reason: { min: 5 } },
          (motivo) => api(`/v1/equ/ordenes/${o.id}/anular`, { method: "POST", body: { reason: motivo } }), `Orden ${o.number} anulada`, cambio)}>Anular</Button>}
        {o.status === "OPEN" && <Button onClick={() => accion({ title: `¿Empezar ${o.number}?`, confirmLabel: "Empezar" },
          () => api(`/v1/equ/ordenes/${o.id}/iniciar`, { method: "POST" }), "Orden en curso", cambio)}>Empezar trabajo</Button>}
        <Button variant="primary" onClick={() => setCerrando(true)}>Terminar y costear</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {o && <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={o.kind} labels={TIPO_ORDEN} /><StatusBadge status={o.status} labels={ESTADO_ORDEN} />
          <StatusBadge status={o.urgency} labels={URGENCIA} />
          {o.kind === "CORRECTIVE" && abierta && <Badge tone="bad">{o.equipment_code} fuera de servicio</Badge>}
        </div>
        <DetailList items={[
          { label: "Equipo", value: `${o.equipment_code} · ${o.equipment_name}` }, { label: o.kind === "CORRECTIVE" ? "Falla" : "Actividad", value: o.description },
          { label: "Reportada", value: `${fechaHora(o.reported_at)}${o.reported_by_name ? ` · ${o.reported_by_name}` : ""}` },
          { label: "Plan", value: o.plan_activity ?? "—" }, { label: "Vence", value: fecha(o.due_on) },
          { label: "Empezó", value: fechaHora(o.started_at ?? null) },
          { label: "Terminó", value: o.finished_at ? `${fechaHora(o.finished_at)}${o.finished_by_name ? ` · ${o.finished_by_name}` : ""}` : "—" },
          { label: "Diagnóstico", value: o.diagnosis ?? "—" }, { label: "Fuera de servicio", value: o.downtime_hours != null ? `${numero(o.downtime_hours, 1)} h` : "—" },
          { label: "Foto", value: o.photo_url ?? "—" },
          ...(o.status === "VOIDED" ? [{ label: "Motivo de anulación", value: o.void_reason ?? "—" }] : []),
        ]} />
        {(o.status === "DONE" || (o.parts?.length ?? 0) > 0) && <section className="space-y-2">
          <h2 className="text-[14px] font-semibold">Costo</h2>
          {(o.parts?.length ?? 0) > 0 && <ul className="divide-y divide-line rounded-[9px] border border-line text-[13px]">
            {o.parts!.map((p, i) => <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">{p.description}</span><span className="tabular-nums text-muted">{numero(p.qty)} × {soles(p.unit_cost)}</span>
              <span className="w-24 text-right tabular-nums">{soles(p.qty * p.unit_cost)}</span>
            </li>)}
          </ul>}
          <DetailList items={[
            { label: "Mano de obra", value: `${soles(o.labor_cost)} · ${numero(o.labor_hours, 1)} h` }, { label: "Repuestos", value: soles(o.parts_cost) },
            { label: "Servicio externo", value: `${soles(o.external_cost)}${o.supplier_name ? ` · ${o.supplier_name}` : ""}` },
            { label: "Total", value: <b>{soles(o.total_cost)}</b> }, { label: "Centro de costo", value: o.cost_center_code ? `${o.cost_center_code} · ${o.cost_center_name}` : "—" },
          ]} />
        </section>}
      </div>}
      {cerrando && o && op && <TerminarOrden o={o} op={op} onClose={() => setCerrando(false)} onGuardado={() => { setCerrando(false); cambio(); }} />}
    </Modal>
  );
}

type Repuesto = { description: string; qty: string; unit_cost: string };

/** Cerrar la orden con diagnóstico, repuestos, horas, servicio externo y tiempo fuera de servicio. */
function TerminarOrden({ o, op, onClose, onGuardado }: { o: Orden; op: Opciones; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ diagnosis: o.diagnosis ?? (o.kind === "PREVENTIVE" ? "Actividad del plan realizada" : ""), labor_hours: "", labor_cost: "", external_cost: "0",
    external_supplier_id: "", downtime_hours: "" });
  const [partes, setPartes] = useState<Repuesto[]>([{ description: "", qty: "1", unit_cost: "" }]);
  const repuestos = partes.reduce((s, p) => s + (Number(p.qty.replace(",", ".")) || 0) * (Number(p.unit_cost.replace(",", ".")) || 0), 0);
  const total = (num(f.labor_cost) ?? 0) + repuestos + (num(f.external_cost) ?? 0);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo={`Terminar ${o.number}`} boton="Terminar orden" onClose={onClose}
      aviso={o.kind === "CORRECTIVE" ? `Al terminar, ${o.equipment_code} vuelve a activo si no tiene otra correctiva abierta.` : "Al terminar, el plan corre su próxima fecha u horas de uso."}
      enviar={async () => {
        await api(`/v1/equ/ordenes/${o.id}/terminar`, { method: "POST", body: {
          diagnosis: f.diagnosis || null, labor_hours: num(f.labor_hours) ?? 0, labor_cost: num(f.labor_cost) ?? 0, external_cost: num(f.external_cost) ?? 0,
          external_supplier_id: f.external_supplier_id || null, downtime_hours: num(f.downtime_hours),
          parts: partes.filter((p) => p.description.trim()).map((p) => ({ description: p.description, qty: num(p.qty), unit_cost: num(p.unit_cost) ?? 0 })),
        } });
        toast.ok(`Orden ${o.number} terminada: ${soles(total)}`);
        onGuardado();
      }}>
      {(err) => <>
        <Field label="Diagnóstico" error={err.diagnosis} className="sm:col-span-2"><Textarea rows={2} value={f.diagnosis} onChange={(x) => set("diagnosis", x.target.value)} /></Field>
        <Field label="Horas de mano de obra" error={err.labor_hours}><Input inputMode="decimal" suffix="h" value={f.labor_hours} onChange={(x) => set("labor_hours", x.target.value)} /></Field>
        <Field label="Costo de mano de obra" error={err.labor_cost}><Input inputMode="decimal" prefix="S/" value={f.labor_cost} onChange={(x) => set("labor_cost", x.target.value)} /></Field>
        <div className="space-y-2 sm:col-span-2">
          <p className="text-[13px] font-medium">Repuestos</p>
          {partes.map((p, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_70px_100px_auto] items-center gap-2">
              <Input aria-label="Repuesto" placeholder="Repuesto" value={p.description} onChange={(x) => setPartes(partes.map((y, j) => j === i ? { ...y, description: x.target.value } : y))} />
              <Input aria-label="Cantidad" inputMode="decimal" value={p.qty} onChange={(x) => setPartes(partes.map((y, j) => j === i ? { ...y, qty: x.target.value } : y))} />
              <Input aria-label="Costo unitario" inputMode="decimal" prefix="S/" value={p.unit_cost} onChange={(x) => setPartes(partes.map((y, j) => j === i ? { ...y, unit_cost: x.target.value } : y))} />
              <button type="button" aria-label="Quitar repuesto" className="cursor-pointer p-1 text-muted hover:text-bad" onClick={() => setPartes(partes.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} onClick={() => setPartes([...partes, { description: "", qty: "1", unit_cost: "" }])}>Agregar repuesto</Button>
        </div>
        <Field label="Servicio externo" error={err.external_cost}><Input inputMode="decimal" prefix="S/" value={f.external_cost} onChange={(x) => set("external_cost", x.target.value)} /></Field>
        <Field label="Proveedor del servicio" error={err.external_supplier_id} hint="Obligatorio si hay servicio externo">
          <Select value={f.external_supplier_id} placeholder="Ninguno" searchable options={op.suppliers.map((s) => ({ value: s.id, label: s.legal_name }))} onChange={(x) => set("external_supplier_id", x.target.value)} />
        </Field>
        <Field label="Tiempo fuera de servicio" error={err.downtime_hours} hint={o.kind === "CORRECTIVE" ? "Vacío: desde el reporte hasta ahora" : "Vacío: lo que duró el trabajo"}>
          <Input inputMode="decimal" suffix="h" value={f.downtime_hours} onChange={(x) => set("downtime_hours", x.target.value)} />
        </Field>
        <div className="flex items-end sm:justify-end">
          <p className="text-[13px] text-muted">Total: <b className="text-[16px] text-ink tabular-nums">{soles(total)}</b><br />
            <span className="text-[12px]">Mano de obra + repuestos {soles(repuestos)} + servicio externo</span></p>
        </div>
      </>}
    </Dialogo>
  );
}

/** Nueva orden desde EQU-06: correctiva (falla) o preventiva (de un plan del equipo). */
export function NuevaOrden({ op, onClose, onCreada }: { op: Opciones; onClose: () => void; onCreada: (id: string) => void }) {
  const [f, setF] = useState({ equipment_id: "", kind: "CORRECTIVE", plan_id: "", description: "", urgency: "NORMAL" });
  const planes = useDatos<{ data: { id: string; activity: string; open_order_number: string | null }[] }>(f.equipment_id && f.kind === "PREVENTIVE" ? `/v1/equ/planes?equipment_id=${f.equipment_id}&status=ACTIVE` : null).datos?.data ?? [];
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialogo titulo="Nueva orden de mantenimiento" boton="Abrir orden" onClose={onClose}
      aviso={f.kind === "CORRECTIVE" ? "Una orden correctiva deja el equipo fuera de servicio hasta cerrarla." : undefined}
      enviar={async () => {
        const o = await api<Orden>("/v1/equ/ordenes", { method: "POST", body: { ...f, plan_id: f.plan_id || null } });
        toast.ok(`Orden ${o.number} abierta`);
        onCreada(o.id);
      }}>
      {(err) => <>
        <Field label="Tipo" required error={err.kind}>
          <Select value={f.kind} options={[{ value: "CORRECTIVE", label: "Correctiva (falla)" }, { value: "PREVENTIVE", label: "Preventiva (de un plan)" }]} onChange={(x) => setF({ ...f, kind: x.target.value, plan_id: "" })} />
        </Field>
        <Field label="Urgencia" error={err.urgency}><Select value={f.urgency} options={Object.entries(URGENCIA).map(([value, [label]]) => ({ value, label }))} onChange={(x) => set("urgency", x.target.value)} /></Field>
        <Field label="Equipo" required error={err.equipment_id} className="sm:col-span-2">
          <Select value={f.equipment_id} placeholder="Elegir" searchable options={opcionesEquipo(op)} onChange={(x) => setF({ ...f, equipment_id: x.target.value, plan_id: "" })} />
        </Field>
        {f.kind === "PREVENTIVE" && <Field label="Plan" required error={err.plan_id} className="sm:col-span-2">
          <Select value={f.plan_id} placeholder={f.equipment_id ? (planes.length ? "Elegir" : "El equipo no tiene planes activos") : "Elige el equipo"}
            options={planes.map((p) => ({ value: p.id, label: p.activity + (p.open_order_number ? ` (ya tiene ${p.open_order_number})` : "") }))}
            onChange={(x) => setF({ ...f, plan_id: x.target.value, description: f.description || (planes.find((p) => p.id === x.target.value)?.activity ?? "") })} />
        </Field>}
        <Field label={f.kind === "CORRECTIVE" ? "Falla" : "Actividad"} required error={err.description} className="sm:col-span-2">
          <Textarea rows={3} value={f.description} onChange={(x) => set("description", x.target.value)} />
        </Field>
      </>}
    </Dialogo>
  );
}

/** Tono de un estado de equipo para las tarjetas. */
export const tonoEstado = (s: string): Tone => (s === "ACTIVE" ? "ok" : s === "OUT_OF_SERVICE" ? "bad" : "neutral");
