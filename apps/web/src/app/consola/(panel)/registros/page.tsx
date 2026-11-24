"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Clock, MessageSquare, RotateCcw, XCircle } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type RegistroFila = {
  id: string; ruc: string; legal_name: string; trade_name: string; business_type_name: string; plan_name: string | null; contact_name: string; email: string;
  phone: string | null; status: string; status_name: string; code_attempts: number; tenant_id: string | null; tenant_short: string | null;
  rejected_reason: string | null; source: string | null; created_at: string; updated_at: string;
};
type Demo = {
  id: string; name: string; phone: string; email: string | null; business_type: string; interests: string[]; plan_code: string | null; source: string | null;
  created_at: string; attended_at: string | null; attended_by_name: string | null; attended_note: string | null;
};

const ESTADOS: Record<string, [string, "warn" | "ok" | "neutral" | "bad"]> = {
  PENDING: ["Por verificar", "warn"], PROVISIONED: ["Empresa creada", "ok"], EXPIRED: ["Vencido", "neutral"], REJECTED: ["Rechazado", "bad"],
};
const RUBROS: Record<string, string> = { CARNICERIA: "Carnicería", DISTRIBUIDORA: "Distribuidora", AVICOLA: "Avícola", GRANJA: "Granja", PLANTA: "Planta", OTRO: "Otro" };
const origenDe = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "Directo");

/** Barras horizontales simples (como los gráficos del prototipo): etiqueta, barra y cantidad. */
function Barras({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-[13px] text-muted">Sin registros todavía.</p>;
  return (
    <ul className="grid gap-2">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[110px_1fr_32px] items-center gap-2 text-[12.5px]">
          <span className="truncate text-ink" title={i.label}>{i.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums text-ink">{i.value}</span>
        </li>
      ))}
    </ul>
  );
}

const INTERESES: Record<string, string> = { PEDIDOS: "Pedidos", MOSTRADOR: "Mostrador", REPARTO: "Reparto", COMPROBANTES: "Boletas", DESPIECE: "Despiece", CONSIGNACION: "Consignación" };

/** Registros desde la página pública (quién se registró con su RUC y en qué quedó) y pedidos de demo para atender. */
export default function RegistrosYDemos() {
  const yo = useUsuarioConsola();
  const [tab, setTab] = useState<"registros" | "demos">("registros");
  const [registros, setRegistros] = useState<RegistroFila[] | null>(null);
  const [demos, setDemos] = useState<Demo[] | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ status: "", rubro: "", origen: "" });

  const cargar = () => Promise.all([apiConsola<{ data: RegistroFila[] }>("/registros"), apiConsola<{ data: Demo[] }>("/demos")])
    .then(([r, d]) => { setRegistros(r.data); setDemos(d.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);
  const porAtender = useMemo(() => (demos ?? []).filter((d) => !d.attended_at).length, [demos]);
  const porVerificar = useMemo(() => (registros ?? []).filter((r) => r.status === "PENDING").length, [registros]);
  const filtrados = useMemo(() => (registros ?? []).filter((r) => (!f.status || r.status === f.status) && (!f.rubro || r.business_type_name === f.rubro)
    && (!f.origen || origenDe(r.source) === f.origen)), [registros, f]);
  const ordR = useOrdenLocal(filtrados, {
    trade_name: (r) => r.trade_name, contact_name: (r) => r.contact_name, plan_name: (r) => r.plan_name, status: (r) => r.status_name,
    source: (r) => origenDe(r.source), rejected_reason: (r) => r.rejected_reason, created_at: (r) => r.created_at,
  });
  const pagRegistros = usePaginaLocal(ordR.filas, `${JSON.stringify(f)}|${ordR.orden.sort}`);
  const cuenta = (st: string) => (registros ?? []).filter((r) => r.status === st).length;
  const agrupar = (clave: (r: RegistroFila) => string) => Object.entries((registros ?? []).reduce<Record<string, number>>((a, r) => { const k = clave(r); a[k] = (a[k] ?? 0) + 1; return a; }, {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const porRubro = agrupar((r) => r.business_type_name || "Sin rubro");
  const porOrigen = agrupar((r) => origenDe(r.source));
  const ordD = useOrdenLocal(demos ?? [], {
    name: (d) => d.name, business_type: (d) => RUBROS[d.business_type] ?? d.business_type, created_at: (d) => d.created_at, status: (d) => (d.attended_at ? 1 : 0),
  });
  const pagDemos = usePaginaLocal(ordD.filas, ordD.orden.sort);

  async function rechazar(r: RegistroFila) {
    const c = await confirmAction({ title: `¿Rechazar el registro de ${r.trade_name}?`, danger: true, confirmLabel: "Rechazar", reason: { min: 5 },
      message: "Ya no podrá activar su cuenta con ese código y el RUC queda libre para registrarse de nuevo." });
    if (!c) return;
    try {
      await apiConsola(`/registros/${r.id}/rechazar`, { method: "POST", body: { reason: c.reason } });
      toast.ok("Registro rechazado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function atender(d: Demo, atendido: boolean) {
    let nota: string | undefined;
    if (atendido) {
      const c = await confirmAction({ title: `¿Marcar como atendido el pedido de ${d.name}?`, confirmLabel: "Marcar atendido",
        reason: { label: "Nota (qué se coordinó)", min: 0, optional: true } });
      if (!c) return;
      nota = c.reason;
    }
    try {
      await apiConsola(`/demos/${d.id}/atender`, { method: "POST", body: { attended: atendido, note: nota || null } });
      toast.ok(atendido ? "Pedido atendido" : "Pedido vuelto a pendiente");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const colRegistros: Column<RegistroFila>[] = [
    { key: "trade_name", sortable: true, header: "Empresa", cardTitle: true, render: (r) => <div><p className="font-semibold text-ink">{r.trade_name}</p><p className="text-[12.5px] text-muted">{r.legal_name} · RUC {r.ruc}</p></div> },
    { key: "contact_name", sortable: true, header: "Contacto", render: (r) => <div><p>{r.contact_name}</p><p className="text-[12.5px] text-muted">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p></div> },
    { key: "plan_name", sortable: true, header: "Plan", hideOnMobile: true, render: (r) => <>{r.plan_name ?? "—"}<span className="block text-[12px] text-muted">{r.business_type_name}</span></> },
    { key: "status", sortable: true, header: "Estado", render: (r) => (
      <div className="grid gap-0.5">
        <StatusBadge status={r.status} labels={ESTADOS} />
        {r.status === "PROVISIONED" && r.tenant_id && <Link href={`/consola/empresas/ficha?id=${r.tenant_id}`} className="text-[12px] text-primary hover:underline">Ver la empresa</Link>}
        {r.status === "PENDING" && r.code_attempts > 0 && <span className="text-[12px] text-muted">{r.code_attempts} {r.code_attempts === 1 ? "intento fallido" : "intentos fallidos"}</span>}
      </div>
    ) },
    { key: "source", sortable: true, header: "Origen", hideOnMobile: true, render: (r) => origenDe(r.source) },
    { key: "rejected_reason", sortable: true, header: "Motivo", hideOnMobile: true, render: (r) => r.rejected_reason ?? <span className="text-muted">—</span> },
    { key: "created_at", sortable: true, header: "Registro", hideOnMobile: true, render: (r) => fechaHora(r.created_at) },
    ...(yo.puede["tenant.create"] ? [{ key: "acciones", header: "", align: "right" as const, render: (r: RegistroFila) => r.status === "PENDING"
      ? <Button size="sm" variant="ghost" icon={XCircle} onClick={() => rechazar(r)}>Rechazar</Button> : null }] : []),
  ];

  const colDemos: Column<Demo>[] = [
    { key: "name", sortable: true, header: "Quién", cardTitle: true, render: (d) => <div><p className="font-semibold text-ink">{d.name}</p><p className="text-[12.5px] text-muted">{d.phone}{d.email ? ` · ${d.email}` : ""}</p></div> },
    { key: "business_type", sortable: true, header: "Rubro e interés", render: (d) => (
      <div><p>{RUBROS[d.business_type] ?? d.business_type}{d.plan_code ? <span className="text-muted"> · plan {d.plan_code.toLowerCase()}</span> : null}</p>
        {d.interests.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{d.interests.map((i) => <Badge key={i}>{INTERESES[i] ?? i}</Badge>)}</div>}</div>
    ) },
    { key: "created_at", sortable: true, header: "Pedido", hideOnMobile: true, render: (d) => fechaHora(d.created_at) },
    { key: "status", sortable: true, header: "Estado", render: (d) => d.attended_at
      ? <div className="grid gap-0.5"><Badge tone="ok" dot>Atendido</Badge><span className="text-[12px] text-muted">{d.attended_by_name} · {fechaHora(d.attended_at)}</span>{d.attended_note && <span className="text-[12px] text-muted">{d.attended_note}</span>}</div>
      : <Badge tone="warn" dot>Por atender</Badge> },
    { key: "acciones", header: "", align: "right", render: (d) => d.attended_at
      ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => atender(d, false)}>Reabrir</Button>
      : <Button size="sm" icon={CheckCircle2} onClick={() => atender(d, true)}>Atendido</Button> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Las empresas que se registraron desde la página pública con su RUC (y en qué quedó cada registro), y los pedidos de demo que dejaron los visitantes para coordinar por WhatsApp." />
      {registros && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Cifra titulo="Por verificar" valor={String(cuenta("PENDING"))} tono={cuenta("PENDING") ? "warn" : undefined} icono={Clock} />
          <Cifra titulo="Empresas creadas" valor={String(cuenta("PROVISIONED"))} tono="ok" icono={CheckCircle2} destacada />
          <Cifra titulo="Rechazados" valor={String(cuenta("REJECTED"))} tono={cuenta("REJECTED") ? "bad" : undefined} icono={XCircle} />
          <Cifra titulo="Vencidos" valor={String(cuenta("EXPIRED"))} icono={CalendarClock} />
          <Cifra titulo="Demos por atender" valor={String(porAtender)} tono={porAtender ? "warn" : undefined} icono={MessageSquare} />
        </div>
      )}
      {registros && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"><p className="font-semibold text-ink">Registros por rubro</p><Barras items={porRubro} /></section>
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"><p className="font-semibold text-ink">Registros por origen</p><Barras items={porOrigen} /></section>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "registros", label: "Registros", count: porVerificar },
        { key: "demos", label: "Pedidos de demo", count: porAtender },
      ]} />
      {tab === "registros" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
            <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
              options={Object.entries(ESTADOS).map(([value, [label]]) => ({ value, label }))} />
            <Select aria-label="Rubro" value={f.rubro} onChange={(e) => setF({ ...f, rubro: e.target.value })} placeholder="Todos los rubros"
              options={porRubro.map((x) => ({ value: x.label, label: x.label }))} />
            <Select aria-label="Origen" value={f.origen} onChange={(e) => setF({ ...f, origen: e.target.value })} placeholder="Todos los orígenes"
              options={porOrigen.map((x) => ({ value: x.label, label: x.label }))} />
          </div>
          <DataTable {...ordR.orden} columns={colRegistros} rows={pagRegistros.filas} pagination={pagRegistros.props} loading={!registros && !error} error={error} onRetry={cargar}
            empty={f.status || f.rubro || f.origen ? "Ningún registro con esos filtros." : "Aún nadie se registró desde la página."} />
        </>
      ) : (
        <DataTable {...ordD.orden} columns={colDemos} rows={pagDemos.filas} pagination={pagDemos.props} loading={!demos && !error} error={error} onRetry={cargar} empty="Aún no hay pedidos de demo." />
      )}
    </div>
  );
}
