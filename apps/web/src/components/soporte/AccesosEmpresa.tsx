"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { MODULOS } from "@/lib/modulos";

const nombreModulo = (c: string) => MODULOS.find((m) => m.code === c)?.name ?? c;
/** De qué módulo fue una consulta del soporte (la ruta técnica queda en el globo de ayuda). */
const moduloDeRuta = (ruta: string) => {
  const c = ruta.split("/")[3]?.toUpperCase() ?? "";
  return MODULOS.some((m) => m.code === c) ? nombreModulo(c) : "Sistema";
};

export type Acceso = {
  id: string; tenant_id: string; tenant_short: string | null; ticket_id: string | null; ticket_number: string | null; ticket_subject: string | null;
  platform_user_id: string; platform_user_name: string; reason: string; level: "RO" | "RW"; level_name: string; modules: string[]; can_export: boolean;
  suggested_hours: number; hours: number | null; status: string; status_name: string; decided_by_name: string | null; decided_at: string | null;
  decision_reason: string | null; expires_at: string | null; first_used_at: string | null; ended_at: string | null; ended_by_name: string | null;
  end_reason: string | null; created_at: string;
};
export type Evento = { kind: string; actor_name: string; method: string | null; path: string | null; status_code: number | null; detail: string | null; at: string };
export type AccesoDetalle = Acceso & { eventos: Evento[] | null; resumen: Record<string, number> };

export const ESTADOS_ACCESO: Record<string, [string, Tone]> = {
  PENDING: ["Por aprobar", "warn"], ACTIVE: ["Vigente", "ok"], REJECTED: ["Rechazado", "neutral"], REVOKED: ["Revocado", "bad"],
  EXPIRED: ["Vencido", "neutral"], FINISHED: ["Terminado por soporte", "neutral"], CANCELLED: ["Cancelado", "neutral"],
};
const EVENTOS: Record<string, string> = {
  REQUESTED: "Pidió el acceso", CANCELLED: "Canceló el pedido", APPROVED: "Aprobó", REJECTED: "Rechazó", REVOKED: "Revocó", EXPIRED: "Venció",
  FINISHED: "Terminó el acceso", SESSION_STARTED: "Entró a la empresa", SESSION_ENDED: "Salió", READ: "Consultó", WRITE: "Modificó", EXPORT: "Exportó", DENIED: "Intento rechazado",
};

export const quedan = (hasta: string | null) => {
  if (!hasta) return "";
  const min = Math.max(0, Math.floor((new Date(hasta).getTime() - Date.now()) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/** Qué pide el acceso: nivel, exportación y módulos. */
export function Alcance({ a }: { a: Acceso }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={a.level === "RW" ? "warn" : "info"}>{a.level_name}</Badge>
      {a.can_export && <Badge tone="warn">Puede exportar</Badge>}
      <span className="text-[12.5px] text-muted">{a.modules.length ? a.modules.map(nombreModulo).join(", ") : "Todos los módulos"}</span>
    </span>
  );
}

/** Bitácora del acceso: cada consulta, cambio, exportación e intento rechazado del soporte (solo lectura). */
export function BitacoraAcceso({ eventos }: { eventos: Evento[] }) {
  if (!eventos.length) return <p className="text-[13px] text-muted">Todavía no hay movimientos.</p>;
  return (
    <ol className="grid max-h-[420px] gap-1.5 overflow-y-auto pr-1">
      {eventos.map((e, i) => (
        <li key={i} className="grid gap-0.5 rounded-lg border border-line px-3 py-2 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={e.kind === "DENIED" ? "bad" : e.kind === "WRITE" || e.kind === "EXPORT" ? "warn" : "neutral"}>{EVENTOS[e.kind] ?? e.kind}</Badge>
            <span className="text-muted">{e.actor_name} · {fechaHora(e.at)}</span>
          </div>
          {e.path && <span title={`${e.method} ${e.path}`} className="text-ink">{moduloDeRuta(e.path)}{e.status_code && e.status_code >= 400 ? " · no se completó" : ""}</span>}
          {e.detail && <span className="text-muted">{e.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/** OPS-14 Accesos de soporte: aprobar o rechazar lo que pide el soporte, revocar lo vigente y ver lo que hizo. */
export function AccesosEmpresa({ abierto, onAbrir, onCambio }: { abierto: string | null; onAbrir: (id: string | null) => void; onCambio?: () => void }) {
  const sesion = useSesion();
  const [datos, setDatos] = useState<{ data: Acceso[]; horas_por_defecto: number; max_horas: number } | null>(null);
  const [error, setError] = useState("");
  const [aprobando, setAprobando] = useState<Acceso | null>(null);

  const cargar = useCallback(() => {
    api<{ data: Acceso[]; horas_por_defecto: number; max_horas: number }>("/v1/soporte/accesos").then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => cargar(), [cargar]);
  const cambio = () => { cargar(); onCambio?.(); };

  const aprueba = sesion.can("ops.support_access.approve");
  const revoca = sesion.can("ops.support_access.revoke");

  async function rechazar(a: Acceso) {
    const c = await confirmAction({ title: `¿Rechazar el acceso que pide ${a.platform_user_name}?`, confirmLabel: "Rechazar", danger: true, reason: { min: 5 } });
    if (!c) return;
    try {
      await api(`/v1/soporte/accesos/${a.id}/rechazar`, { method: "POST", body: { reason: c.reason } });
      toast.ok("Acceso rechazado");
      cambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function revocar(a: Acceso) {
    const c = await confirmAction({ title: `¿Revocar el acceso de ${a.platform_user_name}?`, confirmLabel: "Revocar", danger: true,
      message: "El soporte sale de inmediato de tu empresa.", reason: { min: 0, optional: true } });
    if (!c) return;
    try {
      await api(`/v1/soporte/accesos/${a.id}/revocar`, { method: "POST", body: { reason: c.reason || null } });
      toast.ok("Acceso revocado");
      cambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Acceso>[] = [
    { key: "platform_user_name", header: "Quién y para qué", cardTitle: true, render: (a) => (
      <div><p className="font-semibold text-ink">{a.platform_user_name}</p>
        <p className="line-clamp-2 text-[12.5px] text-muted">{a.ticket_number ? `${a.ticket_number} · ` : ""}{a.reason}</p></div>
    ) },
    { key: "level", header: "Qué puede hacer", render: (a) => <Alcance a={a} /> },
    { key: "status", header: "Estado", render: (a) => (
      <div className="grid gap-0.5">
        <StatusBadge status={a.status} labels={ESTADOS_ACCESO} />
        {a.status === "ACTIVE" && <span className="text-[12px] text-muted">Quedan {quedan(a.expires_at)}</span>}
        {a.status === "PENDING" && <span className="text-[12px] text-muted">Pide {a.suggested_hours} h</span>}
      </div>
    ) },
    { key: "created_at", header: "Pedido", hideOnMobile: true, render: (a) => fechaHora(a.created_at) },
    { key: "acciones", header: "", align: "right", render: (a) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {a.status === "PENDING" && aprueba && <>
          <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setAprobando(a)}>Aprobar</Button>
          <Button size="sm" variant="ghost" icon={XCircle} onClick={() => rechazar(a)}>Rechazar</Button>
        </>}
        {a.status === "ACTIVE" && revoca && <Button size="sm" variant="ghost" icon={Ban} onClick={() => revocar(a)}>Revocar</Button>}
      </div>
    ) },
  ];

  return (
    <div className="grid gap-4">
      <Alert tone="info">El equipo de GestionCarnica no entra a los datos de tu empresa sin tu aprobación. Cada acceso es temporal, personal y queda registrado.</Alert>
      <DataTable columns={columnas} rows={datos?.data ?? []} loading={!datos && !error} error={error} onRetry={cargar} onRowClick={(a) => onAbrir(a.id)}
        empty="El soporte no ha pedido acceso a tu empresa." />
      {aprobando && datos && <Aprobar a={aprobando} porDefecto={datos.horas_por_defecto} max={datos.max_horas} onClose={() => setAprobando(null)}
        onListo={() => { setAprobando(null); cambio(); }} />}
      {abierto && <DetalleAcceso key={abierto} id={abierto} onClose={() => onAbrir(null)} />}
    </div>
  );
}

function Aprobar({ a, porDefecto, max, onClose, onListo }: { a: Acceso; porDefecto: number; max: number; onClose: () => void; onListo: () => void }) {
  const [horas, setHoras] = useState(String(Math.min(a.suggested_hours, max)));
  const [guardando, setGuardando] = useState(false);

  async function aprobar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(`/v1/soporte/accesos/${a.id}/aprobar`, { method: "POST", body: { hours: horas ? Number(horas) : null } });
      toast.ok("Acceso aprobado");
      onListo();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} placement="center" size="sm" title={`Aprobar el acceso de ${a.platform_user_name}`}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-aprobar" icon={ShieldCheck} loading={guardando}>Aprobar</Button></>}>
      <form id="f-aprobar" onSubmit={aprobar} className="grid gap-4">
        <p className="text-[13.5px] text-ink">{a.reason}</p>
        <Alcance a={a} />
        <Field label="Por cuántas horas" hint={`Vacío: ${porDefecto} h. Máximo ${max} h. Se puede revocar antes.`}>
          <Input type="number" min={1} max={max} value={horas} onChange={(e) => setHoras(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function DetalleAcceso({ id, onClose }: { id: string; onClose: () => void }) {
  const [a, setA] = useState<AccesoDetalle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<AccesoDetalle>(`/v1/soporte/accesos/${id}`).then(setA).catch((e) => setError(mensajeDe(e)));
  }, [id]);

  return (
    <Modal open onClose={onClose} size="lg" title={a ? `Acceso de ${a.platform_user_name}` : "Acceso de soporte"}
      description={a ? <span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={a.status} labels={ESTADOS_ACCESO} /><Alcance a={a} /></span> : undefined}>
      {error ? <Alert tone="bad">{error}</Alert> : !a ? <p className="text-muted">Cargando…</p> : <ContenidoAcceso a={a} />}
    </Modal>
  );
}

/** Ficha del acceso: datos, decisión, vigencia y la bitácora (si quien mira puede verla). */
export function ContenidoAcceso({ a }: { a: AccesoDetalle }) {
  const filas: [string, string | null][] = [
    ["Motivo", a.reason], ["Ticket", a.ticket_number ? `${a.ticket_number} · ${a.ticket_subject}` : null], ["Pedido", fechaHora(a.created_at)],
    ["Aprobado o rechazado por", a.decided_by_name ? `${a.decided_by_name} · ${fechaHora(a.decided_at)}${a.decision_reason ? ` · ${a.decision_reason}` : ""}` : null],
    ["Vigente hasta", a.expires_at ? `${fechaHora(a.expires_at)}${a.hours ? ` (${a.hours} h)` : ""}` : null],
    ["Primer uso", a.first_used_at ? fechaHora(a.first_used_at) : null],
    ["Terminó", a.ended_at ? `${fechaHora(a.ended_at)} · ${a.ended_by_name ?? ""}${a.end_reason ? ` · ${a.end_reason}` : ""}` : null],
  ];
  const r = a.resumen ?? {};
  return (
    <div className="grid gap-5">
      <dl className="grid gap-2 text-[13.5px] sm:grid-cols-[180px_1fr]">
        {filas.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        <Badge>{r.READ ?? 0} consultas</Badge><Badge tone="warn">{r.WRITE ?? 0} cambios</Badge><Badge tone="warn">{r.EXPORT ?? 0} exportaciones</Badge>
        <Badge tone="bad">{r.DENIED ?? 0} rechazados</Badge>
      </div>
      {a.eventos ? <BitacoraAcceso eventos={a.eventos} /> : <p className="text-[13px] text-muted">Tu rol no puede ver el detalle de lo que hizo el soporte.</p>}
    </div>
  );
}
