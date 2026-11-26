"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Lock, LockOpen, XCircle } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Modal, PageHeader, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { PERIODO, Seccion, SelectorMes, TAREA, accion, mesActual, nombreMes, qs, texto, useAlAbrir, useDatos, useOpcionesCnt } from "@/modulos/cnt/comunes";

type Tarea = {
  id: string; seq: number; code: string; name: string; auto_check: boolean; status: string; done_by_name: string | null; done_at: string | null; waive_reason: string | null;
  evidence: string | null; check_ok: boolean | null; check_detail: string | null;
};
type Cierre = {
  period: string; name: string; status: string; row: { closed_at: string | null; closed_by_name: string | null; close_due_date: string | null } | null;
  tasks: Tarea[]; blockers: string[]; history: { period: string; status: string; closed_at: string | null; closed_by_name: string | null }[];
};
const ENLACE: Record<string, string> = { DOCS_ENTRY: "/m/cnt/cnt-03", INBOX_EMPTY: "/m/cnt/cnt-05", SIRE: "/m/cnt/cnt-06", BANKS: "/m/cnt/cnt-11", FARM: "/m/grj/grj-05", FS: "/m/cnt/cnt-13" };

/** CNT-12 Cierre mensual: la lista de tareas con su verificación y los botones Cerrar y Reabrir. */
export default function CierreMensual() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const { datos: c, recargar } = useDatos<Cierre>(`/v1/cnt/cierre${qs({ period: mes })}`);
  const [marcar, setMarcar] = useState<{ t: Tarea; dispensar: boolean } | null>(null);
  const cerrado = c?.status === "CLOSED";
  const hechas = c?.tasks.filter((t) => t.status !== "PENDING").length ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader description={`El cierre de ${nombreMes(mes)}. Las tareas automáticas se verifican solas; las demás las marca la contadora. Con el período cerrado ya no entran asientos con fecha de ese mes.`}
        actions={<div className="flex flex-wrap items-center gap-2"><SelectorMes value={mes} onChange={setMes} />
          {c && !cerrado && op?.can.close && <Button variant="primary" icon={Lock} disabled={c.blockers.length > 0} onClick={() => accion({ title: `¿Cerrar ${c.name}?`, confirmLabel: "Cerrar el período" },
            () => api("/v1/cnt/cierre/cerrar", { method: "POST", body: { period: c.period } }), `${c.name} cerrado`, recargar)}>Cerrar el período</Button>}
          {c && cerrado && op?.can.reopen && <Button icon={LockOpen} onClick={() => accion({ title: `¿Reabrir ${c.name}?`, message: "Queda registrado quién lo reabrió y por qué.", confirmLabel: "Reabrir", danger: true, reason: { min: 10, label: "Motivo" } },
            (m) => api("/v1/cnt/cierre/reabrir", { method: "POST", body: { period: c.period, reason: m } }), `${c.name} reabierto`, recargar)}>Reabrir</Button>}
        </div>} />
      {c && <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
        <StatusBadge status={c.status} labels={PERIODO} />
        <span className="text-muted">{hechas} de {c.tasks.length} tareas hechas</span>
        {c.row?.closed_at && <span className="text-muted">Cerrado por {c.row.closed_by_name ?? "—"} el {fechaHora(c.row.closed_at)}</span>}
      </div>}
      {c && !cerrado && c.blockers.length > 0 && <Alert tone="warn" title="Falta para cerrar"><ul className="list-disc pl-5">{c.blockers.map((b, i) => <li key={i}>{texto(b)}</li>)}</ul></Alert>}
      <Seccion titulo="Tareas del cierre">
        <ul className="divide-y divide-line">{(c?.tasks ?? []).map((t) => (
          <li key={t.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 gap-3">
              {t.status === "DONE" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : t.status === "WAIVED" ? <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted" />
                : t.check_ok === false ? <XCircle className="mt-0.5 size-5 shrink-0 text-bad" /> : <CircleDashed className="mt-0.5 size-5 shrink-0 text-warn" />}
              <div className="min-w-0">
                <p className="font-medium">{t.name} {t.auto_check ? <Badge tone="info">Automática</Badge> : <Badge>Manual</Badge>}</p>
                {t.check_detail && <p className={`text-[12.5px] ${t.check_ok ? "text-ok" : t.check_ok === false ? "text-bad" : "text-muted"}`}>{texto(t.check_detail)}</p>}
                {t.status !== "PENDING" && <p className="text-[12px] text-muted">{t.status === "WAIVED" ? `Dispensada: ${texto(t.waive_reason)}` : "Hecha"}{t.done_by_name ? ` · ${t.done_by_name}` : ""} · {fechaHora(t.done_at)}{t.evidence ? ` · ${texto(t.evidence)}` : ""}</p>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={t.status} labels={TAREA} />
              {ENLACE[t.code] && <Link href={`${ENLACE[t.code]}?month=${mes}`} className="text-[12.5px] font-medium text-primary hover:underline">Ver</Link>}
              {!cerrado && op?.can.close && (t.status === "PENDING"
                ? <><Button size="sm" disabled={t.auto_check && t.check_ok === false} onClick={() => setMarcar({ t, dispensar: false })}>Marcar hecha</Button>
                  <Button size="sm" onClick={() => setMarcar({ t, dispensar: true })}>Dispensar</Button></>
                : <Button size="sm" onClick={async () => { try { await api(`/v1/cnt/cierre/tareas/${t.id}/desmarcar`, { method: "POST" }); toast.ok("Tarea pendiente otra vez"); recargar(); } catch (e) { toast.error(mensajeDe(e)); } }}>Desmarcar</Button>)}
            </div>
          </li>))}</ul>
      </Seccion>
      <Seccion titulo="Períodos anteriores">
        <DataTable rows={c?.history ?? []} rowKey={(h) => h.period} onRowClick={(h) => setMes(h.period.slice(0, 7))} empty="Sin historia." columns={[
          { key: "period", header: "Período", cardTitle: true, render: (h) => <span className="capitalize">{nombreMes(h.period)}</span> },
          { key: "status", header: "Estado", render: (h) => <StatusBadge status={h.status} labels={PERIODO} /> },
          { key: "closed_at", header: "Cierre", render: (h) => h.closed_at ? `${fechaHora(h.closed_at)}${h.closed_by_name ? ` · ${h.closed_by_name}` : ""}` : <span className="text-muted">—</span> },
        ]} />
      </Seccion>
      {marcar && <Marcar tarea={marcar.t} dispensar={marcar.dispensar} onClose={() => setMarcar(null)} onListo={() => { setMarcar(null); recargar(); }} />}
    </div>
  );
}

function Marcar({ tarea, dispensar, onClose, onListo }: { tarea: Tarea; dispensar: boolean; onClose: () => void; onListo: () => void }) {
  const [txt, setTxt] = useState("");
  const enviar = async () => {
    try {
      await api(`/v1/cnt/cierre/tareas/${tarea.id}/marcar`, { method: "POST", body: dispensar ? { waive: true, reason: txt } : { evidence: txt || null } });
      toast.ok(dispensar ? "Tarea dispensada" : "Tarea hecha"); onListo();
    } catch (e) { toast.error(mensajeDe(e)); }
  };
  return (
    <Modal open onClose={onClose} title={dispensar ? `Dispensar: ${tarea.name}` : tarea.name}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={dispensar && txt.trim().length < 5} onClick={enviar}>{dispensar ? "Dispensar" : "Marcar hecha"}</Button></>}>
      <Field label={dispensar ? "Por qué no aplica este mes" : "Sustento (opcional)"} hint={dispensar ? "Al menos 5 caracteres" : "Dónde quedó la evidencia"}>
        <Textarea value={txt} maxLength={500} onChange={(e) => setTxt(e.target.value)} />
      </Field>
    </Modal>
  );
}
