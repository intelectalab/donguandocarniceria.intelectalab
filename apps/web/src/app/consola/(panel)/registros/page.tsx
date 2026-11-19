"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
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
const INTERESES: Record<string, string> = { PEDIDOS: "Pedidos", MOSTRADOR: "Mostrador", REPARTO: "Reparto", COMPROBANTES: "Boletas", DESPIECE: "Despiece", CONSIGNACION: "Consignación" };

/** Registros desde la página pública (quién se registró con su RUC y en qué quedó) y pedidos de demo para atender. */
export default function RegistrosYDemos() {
  const yo = useUsuarioConsola();
  const [tab, setTab] = useState<"registros" | "demos">("registros");
  const [registros, setRegistros] = useState<RegistroFila[] | null>(null);
  const [demos, setDemos] = useState<Demo[] | null>(null);
  const [error, setError] = useState("");

  const cargar = () => Promise.all([apiConsola<{ data: RegistroFila[] }>("/registros"), apiConsola<{ data: Demo[] }>("/demos")])
    .then(([r, d]) => { setRegistros(r.data); setDemos(d.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  useEffect(() => { cargar(); }, []);
  const porAtender = useMemo(() => (demos ?? []).filter((d) => !d.attended_at).length, [demos]);
  const porVerificar = useMemo(() => (registros ?? []).filter((r) => r.status === "PENDING").length, [registros]);

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
    { key: "trade_name", header: "Empresa", cardTitle: true, render: (r) => <div><p className="font-semibold text-ink">{r.trade_name}</p><p className="text-[12.5px] text-muted">{r.legal_name} · RUC {r.ruc}</p></div> },
    { key: "contact_name", header: "Contacto", render: (r) => <div><p>{r.contact_name}</p><p className="text-[12.5px] text-muted">{r.email}{r.phone ? ` · ${r.phone}` : ""}</p></div> },
    { key: "plan_name", header: "Plan", hideOnMobile: true, render: (r) => <>{r.plan_name ?? "—"}<span className="block text-[12px] text-muted">{r.business_type_name}</span></> },
    { key: "status", header: "Estado", render: (r) => (
      <div className="grid gap-0.5">
        <StatusBadge status={r.status} labels={ESTADOS} />
        {r.status === "PROVISIONED" && r.tenant_id && <Link href={`/consola/empresas/ficha?id=${r.tenant_id}`} className="text-[12px] text-primary hover:underline">Ver la empresa</Link>}
        {r.status === "PENDING" && r.code_attempts > 0 && <span className="text-[12px] text-muted">{r.code_attempts} intento(s) fallido(s)</span>}
        {r.rejected_reason && <span className="text-[12px] text-muted">{r.rejected_reason}</span>}
      </div>
    ) },
    { key: "created_at", header: "Registro", hideOnMobile: true, render: (r) => fechaHora(r.created_at) },
    ...(yo.puede["tenant.create"] ? [{ key: "acciones", header: "", align: "right" as const, render: (r: RegistroFila) => r.status === "PENDING"
      ? <Button size="sm" variant="ghost" icon={XCircle} onClick={() => rechazar(r)}>Rechazar</Button> : null }] : []),
  ];

  const colDemos: Column<Demo>[] = [
    { key: "name", header: "Quién", cardTitle: true, render: (d) => <div><p className="font-semibold text-ink">{d.name}</p><p className="text-[12.5px] text-muted">{d.phone}{d.email ? ` · ${d.email}` : ""}</p></div> },
    { key: "business_type", header: "Rubro e interés", render: (d) => (
      <div><p>{RUBROS[d.business_type] ?? d.business_type}{d.plan_code ? <span className="text-muted"> · plan {d.plan_code.toLowerCase()}</span> : null}</p>
        {d.interests.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{d.interests.map((i) => <Badge key={i}>{INTERESES[i] ?? i}</Badge>)}</div>}</div>
    ) },
    { key: "created_at", header: "Pedido", hideOnMobile: true, render: (d) => fechaHora(d.created_at) },
    { key: "status", header: "Estado", render: (d) => d.attended_at
      ? <div className="grid gap-0.5"><Badge tone="ok" dot>Atendido</Badge><span className="text-[12px] text-muted">{d.attended_by_name} · {fechaHora(d.attended_at)}</span>{d.attended_note && <span className="text-[12px] text-muted">{d.attended_note}</span>}</div>
      : <Badge tone="warn" dot>Por atender</Badge> },
    { key: "acciones", header: "", align: "right", render: (d) => d.attended_at
      ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => atender(d, false)}>Reabrir</Button>
      : <Button size="sm" icon={CheckCircle2} onClick={() => atender(d, true)}>Atendido</Button> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Las empresas que se registraron desde la página pública con su RUC (y en qué quedó cada registro), y los pedidos de demo que dejaron los visitantes para coordinar por WhatsApp." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "registros", label: "Registros", count: porVerificar },
        { key: "demos", label: "Pedidos de demo", count: porAtender },
      ]} />
      {tab === "registros" ? (
        <DataTable columns={colRegistros} rows={registros ?? []} loading={!registros && !error} error={error} onRetry={cargar}
          empty="Aún nadie se registró desde la página." />
      ) : (
        <DataTable columns={colDemos} rows={demos ?? []} loading={!demos && !error} error={error} onRetry={cargar} empty="Aún no hay pedidos de demo." />
      )}
    </div>
  );
}
