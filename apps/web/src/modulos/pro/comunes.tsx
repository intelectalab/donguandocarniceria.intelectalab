"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Alert, Badge, Button, DetailList, Field, Input, Select, StatusBadge, Textarea, toast, type Tone } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { num, qs, useAlAbrir, useDatos } from "@/modulos/alm/comunes";
import {
  ESTADO_LOTE, ESTADO_ORDEN, FUNCION, ROL_INSUMO, ROL_SALIDA, TIPO_ORDEN, VARIABLE,
  type Balance, type Costeo, type Ficha, type Num, type Opciones, type Resumen,
} from "./tipos";

export { useDatos, qs, num, accion, CifraLink, FiltroSelect, Barras, useAlAbrir, useParametrosIniciales } from "@/modulos/alm/comunes";

let cacheOpciones: Promise<Opciones> | null = null;

/** Opciones de PRO y DES (líneas, recetas, plantillas, personal, equipos…), una vez por carga de página. */
export function useOpcionesPro(): Opciones | null {
  const [op, setOp] = useState<Opciones | null>(null);
  useEffect(() => {
    let vigente = true;
    cacheOpciones ??= api<Opciones>("/v1/pro/opciones");
    cacheOpciones.then((o) => vigente && setOp(o)).catch((e) => { cacheOpciones = null; toast.error(mensajeDe(e)); });
    return () => { vigente = false; };
  }, []);
  return op;
}
export const olvidarOpcionesPro = () => { cacheOpciones = null; };

/** Semáforo de rendimiento o costo: verde, ámbar o rojo. */
export function Semaforo({ luz, children }: { luz: string | null | undefined; children: ReactNode }) {
  if (!luz) return <span className="tabular-nums">{children}</span>;
  const c = luz === "ok" ? "bg-ok" : luz === "warn" ? "bg-warn" : "bg-bad";
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums"><span aria-hidden className={`size-2 rounded-full ${c}`} />{children}</span>;
}

/** Tono por desvío en puntos: dentro de la tolerancia, hasta el doble, más. */
export const tonoDesvio = (pp: Num, tol: Num = 3): Tone => {
  if (pp === null || pp === "") return "neutral";
  const a = Math.abs(Number(pp)), t = Number(tol) || 3;
  return a <= t ? "ok" : a <= t * 2 ? "warn" : "bad";
};

export const pp = (v: Num) => (v === null || v === "" ? "—" : `${Number(v) > 0 ? "+" : ""}${numero(v, 2)} pp`);

/** Tarjeta de sección con título. */
export function Seccion({ titulo, acciones, children, className = "" }: { titulo: string; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 shadow-card ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[14px] font-semibold">{titulo}</h2>{acciones}</div>
      {children}
    </section>
  );
}

/** Tabla simple, legible en el celular (desliza en horizontal dentro de su tarjeta). */
export function Tabla({ cabeza, filas, vacio = "Sin registros." }: { cabeza: ReactNode[]; filas: ReactNode[][]; vacio?: string }) {
  if (!filas.length) return <p className="text-[13px] text-muted">{vacio}</p>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[520px] text-[13px]">
        <thead><tr className="border-b border-line text-left text-[12px] text-muted">{cabeza.map((c, i) => <th key={i} className="py-2 pr-3 font-medium">{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i} className="border-b border-line/60 last:border-0">{f.map((c, j) => <td key={j} className="py-2 pr-3 align-top">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ============================================================ elegir orden (PRO-06 a PRO-10, PRO-13, DES-04 a DES-06) */

type OrdenCorta = { id: string; number: string; status: string; order_type: string; product_name: string | null; line_code: string; planned_date: string; planned_output_kg: Num };

/**
 * La orden elegida en las pantallas de un paso: la de ?id=, la que se elige o, si no, la primera abierta del local.
 *   const o = useOrdenElegida("RELEASED,IN_PROGRESS");  <ElegirOrden {...o} />  … o.id
 */
export function useOrdenElegida(estados = "RELEASED,IN_PROGRESS", tipo?: string) {
  const { local } = useSesion();
  const [elegida, setElegida] = useState("");
  useAlAbrir((p) => setElegida(p.get("id") ?? ""));
  const { datos } = useDatos<{ data: OrdenCorta[] }>(`/v1/pro/ordenes${qs({ status: estados, order_type: tipo, site: local, per_page: 100, sort: "-planned_date" })}`);
  const lista = datos?.data;
  const id = elegida || lista?.[0]?.id || "";
  const elegir = (v: string) => { setElegida(v); window.history.replaceState(null, "", `?id=${v}`); };
  return { id, elegir, lista };
}

/** Selector de órdenes del local elegido arriba. */
export function ElegirOrden({ id, elegir, lista }: ReturnType<typeof useOrdenElegida>) {
  const opciones = (lista ?? []).map((o) => ({ value: o.id, label: `${o.number} · ${o.product_name ?? TIPO_ORDEN[o.order_type]} · ${o.line_code} · ${fecha(o.planned_date)} (${ESTADO_ORDEN[o.status]?.[0] ?? o.status})` }));
  return (
    <div className="w-full sm:w-[440px]">
      <Select aria-label="Orden" value={id} searchable placeholder={lista ? (lista.length ? "Elige la orden" : "No hay órdenes abiertas") : "Cargando…"}
        options={opciones} onChange={(e) => elegir(e.target.value)} />
    </div>
  );
}

/** La ficha de una orden con su recarga. */
export function useFicha(id: string | null) {
  return useDatos<Ficha>(id ? `/v1/pro/ordenes/${id}` : null);
}

/** Cabecera de una orden: número, estado, producto, línea y kg planificados. */
export function CabeceraOrden({ f }: { f: Ficha }) {
  const o = f.order;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <Link href={`/m/pro/pro-11?id=${o.id}`} className="font-mono text-[15px] font-semibold text-primary hover:underline">{o.number}</Link>
      <StatusBadge status={o.status} labels={ESTADO_ORDEN} />
      <span className="text-[13.5px] font-medium">{o.order_type === "CUTTING" ? `${o.template_name ?? "Despiece"} (v${o.template_version})` : o.output_variant_name ?? o.product_name}</span>
      <span className="text-[12.5px] text-muted">{o.line_code} · {o.establishment_name} · {fecha(o.planned_date)} · {kg(o.planned_output_kg)} planificados</span>
      {o.critical_deviation && <Badge tone="bad">Desvío crítico en un punto de control</Badge>}
    </div>
  );
}

/** Envía un formulario corto y muestra el error de la regla. */
function useEnvio() {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar(fn: () => Promise<void>) {
    setEnviando(true); setError(""); setErrores({});
    try { await fn(); } catch (e) {
      const c = erroresDe(e); setErrores(c);
      if (!Object.keys(c).length) setError(mensajeDe(e));
    } finally { setEnviando(false); }
  }
  return { errores, error, enviando, enviar };
}

const abierta = (f: Ficha) => f.order.status === "RELEASED" || f.order.status === "IN_PROGRESS";

/* ============================================================ PRO-06 consumo */

export function PanelConsumo({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const op = useOpcionesPro();
  const [x, setX] = useState({ variant_id: "", lot_code: "", qty: "", role: "", fefo_override_reason: "" });
  const { errores, error, enviando, enviar } = useEnvio();
  const t = f.theoretical.find((r) => r.variant_id === x.variant_id);
  const fefoDistinto = Boolean(t?.fefo && x.lot_code && x.lot_code.toUpperCase() !== t.fefo.lot_code);
  const puede = f.can.record && abierta(f);
  const elegir = (id: string) => { const r = f.theoretical.find((y) => y.variant_id === id); setX({ ...x, variant_id: id, role: r?.role ?? "", lot_code: r?.fefo?.lot_code ?? "", fefo_override_reason: "" }); };
  return (
    <div className="space-y-4">
      <Seccion titulo="Consumo teórico y real">
        <Tabla cabeza={["Insumo", "Tipo", "Teórico", "Consumido", "Diferencia", "Lote sugerido (FEFO)"]}
          filas={f.theoretical.map((r) => [
            <span key="a"><b className="font-mono text-[12.5px]">{r.sku}</b> {r.name}</span>, ROL_INSUMO[r.role] ?? r.role, kg(r.theoretical_kg), kg(r.consumed_kg),
            <span key="d" className={r.tolerance_kg !== null && Math.abs(Number(r.difference_kg)) > Number(r.tolerance_kg) ? "font-medium text-warn" : ""}>{r.difference_kg === null ? "—" : kg(r.difference_kg)}</span>,
            r.fefo ? <span key="f" className="font-mono text-[12.5px]">{r.fefo.lot_code} <span className="font-sans text-muted">vence {fecha(r.fefo.expiry_date)}</span></span> : "—",
          ])} vacio="La orden no tiene insumos teóricos." />
      </Seccion>
      {puede && <Seccion titulo="Registrar consumo">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void enviar(async () => {
          await api(`/v1/pro/ordenes/${f.order.id}/consumos`, { method: "POST", body: { variant_id: x.variant_id || null, lot_code: x.lot_code || null, qty: num(x.qty), role: x.role || null,
            fefo_override_reason: x.fefo_override_reason || null } });
          toast.ok("Consumo registrado"); setX({ variant_id: "", lot_code: "", qty: "", role: "", fefo_override_reason: "" }); onCambio();
        }); }}>
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Insumo" required error={errores.variant_id} className="sm:col-span-2">
            <Select value={x.variant_id} searchable placeholder="Elegir" onChange={(e) => elegir(e.target.value)}
              options={[...f.theoretical.map((r) => ({ value: r.variant_id, label: `${r.sku} · ${r.name}` })),
                ...(op?.variants ?? []).filter((v) => !f.theoretical.some((r) => r.variant_id === v.id) && v.requires_lot).map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))]} />
          </Field>
          <Field label="Lote" required error={errores.lot_code} hint={t?.fefo ? `El sistema sugiere ${t.fefo.lot_code} por vencer primero` : "Escanea o escribe el código"}>
            <Input value={x.lot_code} onChange={(e) => setX({ ...x, lot_code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Peso o cantidad" required error={errores.qty}><Input inputMode="decimal" suffix="kg" value={x.qty} onChange={(e) => setX({ ...x, qty: e.target.value })} /></Field>
          {fefoDistinto && <Field label="Motivo para no usar el lote sugerido" required error={errores.fefo_override_reason} className="sm:col-span-2"
            hint={f.can.fefo ? "Lo autoriza el jefe de producción" : "Solo el jefe de producción puede cambiar el lote sugerido"}>
            <Input value={x.fefo_override_reason} onChange={(e) => setX({ ...x, fefo_override_reason: e.target.value })} />
          </Field>}
          <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={enviando} className="w-full sm:w-auto">Registrar consumo</Button></div>
        </form>
      </Seccion>}
      <Seccion titulo="Consumos registrados">
        <Tabla cabeza={["Hora", "Insumo", "Lote", "Cantidad", ...(f.can.cost ? ["Costo"] : []), "Registró"]}
          filas={f.consumptions.map((c) => [fechaHora(c.consumed_at), <span key="i"><b className="font-mono text-[12.5px]">{c.sku}</b> {c.variant_name}</span>,
            <span key="l" className="font-mono text-[12.5px]">{c.lot_code ?? "—"}{c.fefo_override_reason && <span className="block font-sans text-[11.5px] text-warn">Fuera de FEFO: {c.fefo_override_reason}</span>}</span>,
            kg(c.weight_kg ?? c.qty), ...(f.can.cost ? [soles(c.total_cost)] : []), c.recorded_by_name ?? "—"])} vacio="Aún no se registran consumos." />
      </Seccion>
    </div>
  );
}

/* ============================================================ PRO-07 puntos de control */

export function PanelControl({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const [x, setX] = useState({ control_point_id: "", value: "", corrective_action: "" });
  const { errores, error, enviando, enviar } = useEnvio();
  const p = f.control_points.find((c) => c.id === x.control_point_id);
  const v = num(x.value);
  const fuera = p && v !== null && ((p.min_value !== null && v < Number(p.min_value)) || (p.max_value !== null && v > Number(p.max_value)));
  return (
    <div className="space-y-4">
      {f.order.critical_deviation && <Alert tone="bad" title="Desvío en un punto crítico">El lote queda retenido: Calidad decide con una no conformidad cerrada.</Alert>}
      {f.can.record && abierta(f) && f.control_points.length > 0 && <Seccion titulo="Registrar lectura">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void enviar(async () => {
          const r = await api<{ in_range: boolean }>(`/v1/pro/ordenes/${f.order.id}/lecturas`, { method: "POST", body: { ...x, value: v, corrective_action: x.corrective_action || null } });
          if (r.in_range) toast.ok("Lectura dentro del rango"); else toast.error("Lectura fuera de rango: se avisó al jefe y a Calidad");
          setX({ ...x, value: "", corrective_action: "" }); onCambio();
        }); }}>
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          <Field label="Punto de control" required error={errores.control_point_id} className="sm:col-span-2">
            <Select value={x.control_point_id} placeholder="Elegir" onChange={(e) => setX({ ...x, control_point_id: e.target.value })}
              options={f.control_points.map((c) => ({ value: c.id, label: `${c.code} · ${VARIABLE[c.variable] ?? c.variable} (${numero(c.min_value)} a ${numero(c.max_value)} ${c.unit ?? ""})${c.is_critical ? " · crítico" : ""}` }))} />
          </Field>
          <Field label="Valor medido" required error={errores.value}><Input inputMode="decimal" suffix={p?.unit ?? undefined} value={x.value} onChange={(e) => setX({ ...x, value: e.target.value })} /></Field>
          <div className="flex items-end">{fuera && <Badge tone="bad">Fuera de rango</Badge>}</div>
          {fuera && <Field label="Acción correctiva" required error={errores.corrective_action} className="sm:col-span-2" hint={p?.corrective_action ?? undefined}>
            <Textarea rows={2} value={x.corrective_action} onChange={(e) => setX({ ...x, corrective_action: e.target.value })} />
          </Field>}
          <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={enviando} className="w-full sm:w-auto">Registrar lectura</Button></div>
        </form>
      </Seccion>}
      <Seccion titulo="Lecturas">
        <Tabla cabeza={["Hora", "Punto", "Valor", "Rango", "Resultado", "Leyó"]}
          filas={f.readings.map((r) => [fechaHora(r.read_at), `${r.code} · ${VARIABLE[r.variable] ?? r.variable}${r.is_critical ? " (crítico)" : ""}`, `${numero(r.value, 1)} ${r.unit ?? ""}`,
            `${numero(r.min_value)} a ${numero(r.max_value)}`, <span key="r">{r.in_range ? <Badge tone="ok">En rango</Badge> : <Badge tone="bad">Fuera</Badge>}
              {r.corrective_action && <span className="block text-[11.5px] text-muted">{r.corrective_action}</span>}</span>, r.reader_name ?? "—"])}
          vacio={f.control_points.length ? "Aún no hay lecturas." : "La receta no tiene puntos de control."} />
      </Seccion>
    </div>
  );
}

/* ============================================================ PRO-08 registro de producción */

export function PanelProduccion({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const op = useOpcionesPro();
  const despiece = f.order.order_type === "CUTTING";
  const [x, setX] = useState({ output_role: despiece ? "CO_PRODUCT" : "MAIN", template_line_id: "", qty: "", scale_equipment_id: "", waste_reason: "", lot_code: "" });
  const { errores, error, enviando, enviar } = useEnvio();
  const balanzas = (op?.equipment ?? []).filter((e) => e.category === "SCALE" && e.establishment_id === f.order.establishment_id);
  const corte = f.template_lines?.find((l) => l.id === x.template_line_id);
  return (
    <div className="space-y-4">
      {f.can.record && abierta(f) && <Seccion titulo={despiece ? "Pesar un corte" : "Registrar producción"}>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void enviar(async () => {
          const r = await api<{ lot_code?: string | null; alert?: { out_of_standard: boolean; cut: string; actual_pct: Num; standard_pct: Num } | null }>(`/v1/pro/ordenes/${f.order.id}/produccion`, {
            method: "POST", body: { output_role: despiece ? (corte?.role ?? x.output_role) : x.output_role, template_line_id: x.template_line_id || null, variant_id: corte?.output_variant_id ?? null,
              qty: num(x.qty), scale_equipment_id: x.scale_equipment_id || null, waste_reason: x.waste_reason || null, lot_code: x.lot_code || null } });
          if (r.alert?.out_of_standard) toast.error(`${r.alert.cut}: ${porcentaje(r.alert.actual_pct, 1)} contra ${porcentaje(r.alert.standard_pct, 1)} del estándar`);
          else toast.ok(r.lot_code ? `Registrado en el lote ${r.lot_code}` : "Registrado");
          setX({ ...x, qty: "", waste_reason: "", lot_code: "" }); onCambio();
        }); }}>
          {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
          {despiece
            ? <Field label="Corte" required error={errores.template_line_id} className="sm:col-span-2">
              <Select value={x.template_line_id} placeholder="Elegir" onChange={(e) => setX({ ...x, template_line_id: e.target.value })}
                options={(f.template_lines ?? []).map((l) => ({ value: l.id, label: `${l.name} · ${ROL_SALIDA[l.role]} · estándar ${porcentaje(l.standard_yield_pct, 1)}` }))} />
            </Field>
            : <Field label="Qué se registra" required error={errores.output_role}>
              <Select value={x.output_role} options={["MAIN", "BY_PRODUCT", "WASTE"].map((k) => ({ value: k, label: ROL_SALIDA[k] }))} onChange={(e) => setX({ ...x, output_role: e.target.value })} />
            </Field>}
          <Field label="Peso" required error={errores.qty} hint={x.output_role === "MAIN" && !despiece ? `${f.order.output_sku ?? ""} · se crea el lote en cuarentena` : undefined}>
            <Input inputMode="decimal" suffix="kg" value={x.qty} onChange={(e) => setX({ ...x, qty: e.target.value })} />
          </Field>
          <Field label="Balanza" error={errores.scale_equipment_id} hint="Con la calibración vigente">
            <Select value={x.scale_equipment_id} placeholder="Elegir" options={balanzas.map((b) => ({ value: b.id, label: `${b.code}${b.not_usable ? " · no apta" : ""}`, disabled: Boolean(b.not_usable) }))}
              onChange={(e) => setX({ ...x, scale_equipment_id: e.target.value })} />
          </Field>
          {(x.output_role === "WASTE" || corte?.role === "WASTE") && <Field label="Motivo de la merma" required error={errores.waste_reason} className="sm:col-span-2">
            <Input value={x.waste_reason} onChange={(e) => setX({ ...x, waste_reason: e.target.value })} />
          </Field>}
          <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={enviando} className="w-full sm:w-auto">Registrar</Button></div>
        </form>
      </Seccion>}
      <Seccion titulo="Producción registrada">
        <Tabla cabeza={["Hora", "Tipo", "Producto", "Lote", "Peso", "Registró"]}
          filas={f.outputs.map((s) => [fechaHora(s.at), ROL_SALIDA[s.output_role] ?? s.output_role,
            <span key="p">{s.sku ? <b className="font-mono text-[12.5px]">{s.sku} </b> : null}{s.variant_name ?? s.waste_reason ?? "—"}</span>,
            s.lot_code ? <span key="l" className="font-mono text-[12.5px]">{s.lot_code}{s.qc_status && <> <StatusBadge status={s.qc_status} labels={ESTADO_LOTE} /></>}</span> : "—",
            kg(s.weight_kg ?? s.qty), s.recorded_by_name ?? "—"])} vacio="Aún no hay producción registrada." />
      </Seccion>
      <ResumenKg r={f.summary} />
    </div>
  );
}

/** Cifras de kg y rendimiento de una orden. */
export function ResumenKg({ r }: { r: Resumen }) {
  // Sin nada pesado todavía, la merma sería el 100 %: se muestra la entrada y lo esperado, sin desvío.
  const sinSalida = !Number(r.main_kg) && !Number(r.by_product_kg);
  if (sinSalida) return (
    <Seccion titulo="Rendimiento">
      <DetailList items={[{ label: "Entrada", value: kg(r.input_kg) }, { label: "Rendimiento esperado", value: porcentaje(r.expected_yield_pct, 2) },
        { label: "Merma máxima", value: porcentaje(r.max_waste_pct) }]} />
      <p className="mt-3 text-[13px] text-muted">El rendimiento real, la merma y el desvío aparecen al registrar la primera pesada.</p>
    </Seccion>
  );
  return (
    <Seccion titulo="Rendimiento">
      <DetailList items={[
        { label: "Entrada", value: kg(r.input_kg) }, { label: "Producto principal", value: kg(r.main_kg) },
        { label: "Subproductos", value: kg(r.by_product_kg) }, { label: "Merma", value: `${kg(r.waste_kg)} · ${porcentaje(r.waste_pct, 2)} (máx. ${porcentaje(r.max_waste_pct)})` },
        { label: "Rendimiento real", value: porcentaje(r.actual_yield_pct, 2) }, { label: "Rendimiento esperado", value: porcentaje(r.expected_yield_pct, 2) },
        { label: "Desvío", value: <Badge tone={tonoDesvio(r.yield_deviation_pp, r.yield_tolerance_pp)}>{pp(r.yield_deviation_pp)}</Badge> },
      ]} />
    </Seccion>
  );
}

/* ============================================================ PRO-09 personal y equipos */

export function PanelPersonal({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const op = useOpcionesPro();
  const [p, setP] = useState({ employee_id: "", task_role: "HELPER", hours: "" });
  const [q, setQ] = useState({ equipment_id: "", hours: "" });
  const e1 = useEnvio(), e2 = useEnvio();
  const edita = f.can.record && abierta(f);
  const equipos = (op?.equipment ?? []).filter((e) => e.establishment_id === f.order.establishment_id && !["COLD_ROOM", "FREEZER", "LABEL_PRINTER", "SCALE"].includes(e.category));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Seccion titulo="Personal">
        {edita && <form className="mb-4 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void e1.enviar(async () => {
          await api(`/v1/pro/ordenes/${f.order.id}/personal`, { method: "POST", body: { ...p, hours: num(p.hours) } });
          toast.ok("Horas registradas"); setP({ ...p, employee_id: "", hours: "" }); onCambio();
        }); }}>
          {e1.error && <div className="sm:col-span-3"><Alert tone="bad">{e1.error}</Alert></div>}
          <Field label="Persona" required error={e1.errores.employee_id} className="sm:col-span-3">
            <Select value={p.employee_id} searchable placeholder="Elegir" onChange={(e) => setP({ ...p, employee_id: e.target.value })}
              options={(op?.employees ?? []).filter((x) => !x.establishment_id || x.establishment_id === f.order.establishment_id).map((x) => ({ value: x.id, label: x.full_name }))} />
          </Field>
          <Field label="Función" error={e1.errores.task_role}><Select value={p.task_role} options={Object.entries(FUNCION).map(([value, label]) => ({ value, label }))} onChange={(e) => setP({ ...p, task_role: e.target.value })} /></Field>
          <Field label="Horas" required error={e1.errores.hours}><Input inputMode="decimal" suffix="h" value={p.hours} onChange={(e) => setP({ ...p, hours: e.target.value })} /></Field>
          <div className="flex items-end"><Button type="submit" loading={e1.enviando} className="w-full">Agregar</Button></div>
        </form>}
        <Tabla cabeza={["Persona", "Función", "Fecha", "Horas", ...(f.can.cost ? ["Costo"] : [])]}
          filas={f.labor.map((l) => [l.employee_name, FUNCION[l.task_role] ?? l.task_role, fecha(l.work_date), numero(l.hours, 2), ...(f.can.cost ? [soles(l.cost)] : [])])} vacio="Sin horas registradas." />
      </Seccion>
      <Seccion titulo="Equipos">
        {edita && <form className="mb-4 grid gap-3 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void e2.enviar(async () => {
          await api(`/v1/pro/ordenes/${f.order.id}/equipos`, { method: "POST", body: { ...q, hours: num(q.hours) } });
          toast.ok("Uso de equipo registrado"); setQ({ equipment_id: "", hours: "" }); onCambio();
        }); }}>
          {e2.error && <div className="sm:col-span-3"><Alert tone="bad">{e2.error}</Alert></div>}
          <Field label="Equipo" required error={e2.errores.equipment_id} className="sm:col-span-2">
            <Select value={q.equipment_id} searchable placeholder="Elegir" onChange={(e) => setQ({ ...q, equipment_id: e.target.value })}
              options={equipos.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}${x.not_usable ? " · fuera de servicio" : ""}`, disabled: Boolean(x.not_usable) }))} />
          </Field>
          <Field label="Horas" required error={e2.errores.hours}><Input inputMode="decimal" suffix="h" value={q.hours} onChange={(e) => setQ({ ...q, hours: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Button type="submit" loading={e2.enviando}>Agregar</Button></div>
        </form>}
        <Tabla cabeza={["Equipo", "Horas", ...(f.can.cost ? ["Tarifa", "Costo"] : [])]}
          filas={f.equipment.map((q2) => [`${q2.equipment_code} · ${q2.equipment_name}`, numero(q2.hours, 2), ...(f.can.cost ? [`${soles(q2.hourly_rate)}/h`, soles(q2.cost)] : [])])} vacio="Sin equipos registrados." />
      </Seccion>
    </div>
  );
}

/* ============================================================ PRO-10 cierre */

export function CostosOrden({ r }: { r: Resumen }) {
  return (
    <DetailList items={[
      { label: "Materia prima", value: soles(r.raw_material_cost) }, { label: "Insumos", value: soles(r.input_cost) }, { label: "Empaques", value: soles(r.packaging_cost) },
      { label: "Mano de obra", value: soles(r.labor_cost) }, { label: "Equipos", value: soles(r.equipment_cost) }, { label: "Costo total", value: <b>{soles(r.total_cost)}</b> },
      { label: "Costo por kg", value: r.cost_per_kg !== null ? `${soles(r.cost_per_kg)} / kg` : "—" },
      { label: "Costo estándar", value: r.standard_cost_per_kg !== null ? `${soles(r.standard_cost_per_kg)} / kg${r.cost_deviation_pct !== null ? ` (${Number(r.cost_deviation_pct) > 0 ? "+" : ""}${numero(r.cost_deviation_pct, 1)} %)` : ""}` : "—" },
    ]} />
  );
}

export function BalanceMasa({ b }: { b: Balance }) {
  return (
    <div className="space-y-2">
      <DetailList items={[
        { label: "Entrada", value: kg(b.input_kg) }, { label: "Registrado (cortes + subproductos + merma)", value: kg(b.registered_kg) },
        { label: "Cortes principales", value: kg(b.co_product_kg) }, { label: "Subproductos", value: kg(b.by_product_kg) }, { label: "Merma", value: kg(b.waste_kg) },
        { label: "Diferencia", value: <Badge tone={b.ok ? "ok" : "bad"}>{kg(b.difference_kg)} · {porcentaje(b.difference_pct, 2)} (tolerancia {porcentaje(b.tolerance_pct, 1)})</Badge> },
      ]} />
      {!b.ok && Number(b.input_kg) > 0 && <Alert tone="warn">El balance no cuadra: pesa lo que falta o el jefe de producción lo cierra con su aprobación.</Alert>}
    </div>
  );
}

export function TablaCosteo({ c }: { c: Costeo }) {
  return (
    <div className="space-y-3">
      {c.errors.map((e) => <Alert key={e} tone="bad">{e}</Alert>)}
      <Tabla cabeza={["Corte", "Lote", "Peso", "Rend. real", "Estándar", "Precio ref.", "Valor de mercado", "Costo asignado", "Costo por kg"]}
        filas={c.rows.map((r) => [<span key="c">{r.cut}<span className="block font-mono text-[11.5px] text-muted">{r.sku}</span></span>, r.lot_code ?? "—", kg(r.weight_kg),
          porcentaje(r.actual_yield_pct, 2), porcentaje(r.standard_yield_pct, 1), r.price_per_kg !== null ? `${soles(r.price_per_kg)}/kg` : r.nrv !== null ? `VNR ${soles(r.nrv)}` : "—",
          soles(r.market_value), soles(r.allocated_cost), r.cost_per_kg !== null ? soles(r.cost_per_kg) : "—"])} vacio="Aún no hay cortes pesados." />
      <DetailList items={[
        { label: "Costo conjunto", value: soles(c.joint_cost) }, { label: "Subproductos al VNR", value: soles(c.nrv_total) },
        { label: "Por repartir entre cortes", value: soles(c.to_allocate) }, { label: "Valor de mercado total", value: soles(c.market_value_total) },
        { label: "Asignado", value: soles(c.allocated_total) }, { label: "Redondeo", value: soles(c.rounding) },
      ]} />
    </div>
  );
}

export function PanelCierre({ f, onCambio }: { f: Ficha; onCambio: () => void }) {
  const { datos } = useDatos<{ summary: Resumen; mass_balance?: Balance; costing?: Costeo | null }>(`/v1/pro/ordenes/${f.order.id}/resumen?v=${f.consumptions.length}-${f.outputs.length}-${f.labor.length}-${f.equipment.length}`);
  const r = datos?.summary ?? f.summary;
  const [x, setX] = useState({ yield_deviation_reason: f.order.yield_deviation_reason ?? "", waste_reason: f.order.waste_reason ?? "", mass_balance_override: false });
  const { errores, error, enviando, enviar } = useEnvio();
  const b = datos?.mass_balance ?? f.mass_balance;
  return (
    <div className="space-y-4">
      {f.order.status === "CLOSED" && <Alert tone="ok">Orden cerrada el {fecha(f.order.close_date)}{f.order.closed_by_name ? ` por ${f.order.closed_by_name}` : ""}. Su costo quedó en los lotes producidos.</Alert>}
      <ResumenKg r={r} />
      {b && <Seccion titulo="Balance de masa"><BalanceMasa b={b} /></Seccion>}
      {f.can.cost && <Seccion titulo="Costo de la orden"><CostosOrden r={r} /></Seccion>}
      {f.can.cost && datos?.costing && <Seccion titulo="Costeo conjunto por valor de mercado"><TablaCosteo c={datos.costing} /></Seccion>}
      {f.can.close && abierta(f) && <Seccion titulo="Cerrar la orden">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void enviar(async () => {
          await api(`/v1/pro/ordenes/${f.order.id}/cerrar`, { method: "POST", body: { yield_deviation_reason: x.yield_deviation_reason || null, waste_reason: x.waste_reason || null,
            mass_balance_override: x.mass_balance_override } });
          toast.ok(`Orden ${f.order.number} cerrada`); onCambio();
        }); }}>
          {error && <Alert tone="bad">{error}</Alert>}
          {r.needs_yield_reason && <Field label="Motivo del desvío de rendimiento" required error={errores.yield_deviation_reason} hint={`Desvío ${pp(r.yield_deviation_pp)}, tolerancia ±${numero(r.yield_tolerance_pp)} pp`}>
            <Textarea rows={2} value={x.yield_deviation_reason} onChange={(e) => setX({ ...x, yield_deviation_reason: e.target.value })} />
          </Field>}
          {r.needs_waste_reason && <Field label="Motivo de la merma" required error={errores.waste_reason} hint={`Merma ${porcentaje(r.waste_pct, 2)}, máximo de la línea ${porcentaje(r.max_waste_pct)}`}>
            <Textarea rows={2} value={x.waste_reason} onChange={(e) => setX({ ...x, waste_reason: e.target.value })} />
          </Field>}
          {b && !b.ok && f.can.release && <label className="flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" checked={x.mass_balance_override} onChange={(e) => setX({ ...x, mass_balance_override: e.target.checked })} />
            Cerrar aunque el balance de masa no cuadre (queda registrado con mi nombre)
          </label>}
          <div><Button type="submit" variant="primary" loading={enviando}>Cerrar orden</Button></div>
        </form>
      </Seccion>}
    </div>
  );
}

/** Pantalla de un paso de la orden: selector arriba y el panel del paso. */
export function PasoDeOrden({ descripcion, estados, tipo, panel }: {
  descripcion: string; estados?: string; tipo?: string; panel: (f: Ficha, recargar: () => void) => ReactNode;
}) {
  const o = useOrdenElegida(estados, tipo);
  const { datos, error, recargar } = useFicha(o.id || null);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[13.5px] text-muted">{descripcion}</p>
      <ElegirOrden {...o} />
      {error && <Alert tone="bad">{error}</Alert>}
      {datos && datos.order.id === o.id && <><CabeceraOrden f={datos} />{panel(datos, recargar)}</>}
    </div>
  );
}
