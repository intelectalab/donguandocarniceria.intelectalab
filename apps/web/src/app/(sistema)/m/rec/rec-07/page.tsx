"use client";

import Link from "next/link";
import { CalendarCheck, CheckCircle2, ClipboardCheck, FilePen, Undo2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, PageHeader, buttonClass } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CifraLink, NavVersion, SelectorVersion, accion, useDatos, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import { CONSERVACION, type Check, type Num, type Version } from "@/modulos/rec/tipos";

type Resumen = { id: string; version: number; status: string; base_output_kg: string; total_kg: string; yield_pct: string | null; shelf_life_days: number | null;
  storage: string; allergens: string[]; cost_per_kg: Num; steps: number; control_points: number };
type Revision = { version: Resumen; previous: Resumen | null; ingredients: { variant_id: string; sku: string; name: string; before: string | null; now: string | null }[];
  checks: Check[]; author: { id: string; name: string | null; is_me: boolean }; reviewer: { name: string; can_approve: boolean } };

/** REC-07 Revisión y aprobación: comparación con la vigente, validaciones y aprobación por alguien distinto del autor. */
export default function RevisionAprobacion() {
  const { can } = useSesion();
  const sel = useVersionElegida("IN_REVIEW,DRAFT");
  const v = useVersion(sel.id);
  const c = useDatos<{ in_review: number; drafts: number; approved_30d: number }>("/v1/rec/cifras/07");
  const recargar = () => { v.recargar(); c.recargar(); };
  return (
    <div className="space-y-5">
      <PageHeader description="Calidad revisa la versión frente a la vigente: aditivos y su dosis, puntos de control, vida útil y rendimiento. La aprueba alguien con el permiso que no la creó; aprobarla retira la versión anterior." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="En revisión" valor={c.datos ? numero(c.datos.in_review) : undefined} detalle="Esperan aprobación" icono={ClipboardCheck} tono={c.datos?.in_review ? "warn" : "ok"} />
        <CifraLink titulo="En borrador" valor={c.datos ? numero(c.datos.drafts) : undefined} detalle="Todavía en edición" icono={FilePen} />
        <CifraLink titulo="Aprobadas en 30 días" valor={c.datos ? numero(c.datos.approved_30d) : undefined} icono={CalendarCheck} />
      </div>
      <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
      {!sel.cargando && !sel.id && <Alert tone="ok">No hay versiones por revisar.</Alert>}
      {v.error && <Alert tone="bad">{v.error}</Alert>}
      {v.datos && <Detalle key={`${v.datos.id}-${v.datos.status}`} v={v.datos} costos={can("rec.cost.view")} onCambio={recargar} />}
    </div>
  );
}

const TONO = { ok: ["OK", "ok"], warn: ["Aviso", "warn"], error: ["Bloquea", "bad"] } as const;

function Detalle({ v, costos, onCambio }: { v: Version; costos: boolean; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const { datos: r, error } = useDatos<Revision>(`/v1/rec/versiones/${v.id}/revision`);
  const bloqueos = r?.checks.filter((x) => x.level === "error").length ?? 0;
  const aprueba = can("rec.version.approve") && puede("REC", "E");
  const abierta = v.status === "DRAFT" || v.status === "IN_REVIEW";
  const puedeAprobar = aprueba && abierta && r && !r.author.is_me && bloqueos === 0;
  const p = r?.previous;
  const cambio = (a: string | number | null | undefined, b: string | number | null | undefined) => (p ? <><span className="text-muted">{a ?? "—"}</span> → <b>{b ?? "—"}</b></> : <b>{b ?? "—"}</b>);
  return (
    <div className="space-y-5">
      <NavVersion v={v} actual="rec-07" costos={costos} />
      {error && <Alert tone="bad">{error}</Alert>}
      {r && <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold">Validaciones</h2>
          <ul className="space-y-2">
            {r.checks.map((x, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <Badge tone={TONO[x.level][1]}>{TONO[x.level][0]}</Badge>
                <span><b className="font-mono text-[12px]">{x.code}</b> {x.msg}</span>
              </li>
            ))}
            <li className="flex items-start gap-2 text-[13px]">
              <Badge tone={r.author.is_me || !r.reviewer.can_approve ? "bad" : "ok"}>{r.author.is_me || !r.reviewer.can_approve ? "Bloquea" : "OK"}</Badge>
              <span><b className="font-mono text-[12px]">RN-REC-02</b> Autor: {r.author.name ?? "—"} · revisa: {r.reviewer.name}
                {r.author.is_me ? " (es la misma persona: la aprueba otra)" : !r.reviewer.can_approve ? " (sin el permiso de aprobar recetas)" : ""}</span>
            </li>
          </ul>
          {abierta && bloqueos > 0 && <Alert tone="bad">No se aprueba mientras haya {bloqueos} bloqueo{bloqueos === 1 ? "" : "s"}.</Alert>}
          {!abierta && <Alert tone="info">Esta versión ya está {v.status === "APPROVED" ? "aprobada" : "retirada"}.</Alert>}
          <div className="flex flex-wrap gap-2">
            {aprueba && abierta && <Button variant="primary" icon={CheckCircle2} disabled={!puedeAprobar}
              onClick={() => accion({ title: `¿Aprobar ${v.recipe_code} v${v.version}?`, message: p ? `La v${p.version} pasa a retirada. Se fijan los alérgenos, el rendimiento y el costo estándar.` : "Se fijan los alérgenos, el rendimiento y el costo estándar.", confirmLabel: "Aprobar" },
                () => api(`/v1/rec/versiones/${v.id}/aprobar`, { method: "POST" }), `v${v.version} aprobada${p && p.status === "APPROVED" ? `; la v${p.version} pasa a retirada` : ""}`, onCambio)}>Aprobar versión</Button>}
            {v.status === "IN_REVIEW" && (aprueba || can("rec.version.edit")) && <Button icon={Undo2}
              onClick={() => accion({ title: "¿Devolver a borrador?", message: "El autor recibe tu comentario.", confirmLabel: "Devolver", reason: { label: "Qué debe corregirse", min: 5 } },
                (m) => api(`/v1/rec/versiones/${v.id}/devolver`, { method: "POST", body: { reason: m } }), "Versión devuelta al autor", onCambio)}>Devolver a borrador</Button>}
            <Link href={`/m/rec/rec-02?v=${v.id}`} className={buttonClass("ghost")}>Ver versión</Link>
          </div>
        </section>
        <section className="space-y-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold">{p ? `Frente a la v${p.version} ${p.status === "APPROVED" ? "vigente" : "anterior"}` : "Primera versión"}</h2>
          <DetailList items={[
            { label: "Kg base de salida", value: cambio(numero(p?.base_output_kg, 3), numero(r.version.base_output_kg, 3)) },
            { label: "Kg de ingredientes", value: cambio(numero(p?.total_kg, 4), numero(r.version.total_kg, 4)) },
            { label: "Rendimiento esperado", value: cambio(porcentaje(p?.yield_pct, 2), porcentaje(r.version.yield_pct, 2)) },
            { label: "Vida útil", value: cambio(p?.shelf_life_days ? `${p.shelf_life_days} días` : "—", r.version.shelf_life_days ? `${r.version.shelf_life_days} días` : "Sin definir") },
            { label: "Conservación", value: cambio(p ? CONSERVACION[p.storage] : null, CONSERVACION[r.version.storage]) },
            ...(costos ? [{ label: "Costo por kg", value: cambio(soles(p?.cost_per_kg ?? null), soles(r.version.cost_per_kg)) }] : []),
            { label: "Alérgenos", value: cambio(p ? p.allergens.join(", ") || "ninguno" : null, r.version.allergens.join(", ") || "ninguno") },
            { label: "Pasos y puntos de control", value: cambio(p ? `${p.steps} · ${p.control_points}` : null, `${r.version.steps} · ${r.version.control_points}`) },
          ]} />
          <DataTable rows={r.ingredients} rowKey={(x) => x.variant_id} columns={[
            { key: "name", header: "Ingrediente", cardTitle: true, render: (x) => x.name },
            { key: "before", header: p ? `v${p.version}` : "Antes", align: "right", render: (x) => numero(x.before, 4) },
            { key: "now", header: `v${v.version}`, align: "right", render: (x) => numero(x.now, 4) },
            { key: "cambio", header: "Cambio", align: "right", render: (x) => x.before === null ? <Badge tone="info">Nuevo</Badge> : x.now === null ? <Badge tone="warn">Quitado</Badge>
              : Number(x.before) === Number(x.now) ? <span className="text-muted">—</span> : <b className="tabular-nums">{Number(x.now) > Number(x.before) ? "+" : ""}{numero(Number(x.now) - Number(x.before), 4)}</b> },
          ]} />
        </section>
      </div>}
    </div>
  );
}
