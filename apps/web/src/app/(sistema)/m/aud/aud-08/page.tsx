"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck2, ClipboardCheck, Lock, UserX } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { sinTildes } from "@/modulos/mae/tipos";

type Decision = "KEEP" | "CHANGE" | "DEACTIVATE";
type Item = {
  user_id: string; name: string; email: string; status: string; role: string; role_name: string; alcance: string; last_login: string | null;
  days_inactive: number; inactivo: boolean; flags: string[]; proposal: Decision; decision: Decision; note: string; decidida: boolean;
};
type Resumen = {
  id: string; number: string; quarter: string; status: "OPEN" | "COMPLETED"; opened_at: string; due_date: string; closed_at: string | null;
  reviewer: string | null; findings: string | null; revisados: number; desactivados: number; a_tiempo: boolean | null;
};
type Panel = {
  trimestre: string; actual: Resumen | null; items: Item[] | null; cerradas: Resumen[]; puede: boolean;
  cifras: { a_tiempo: number | null; a_tiempo_ok: number; a_tiempo_de: number; inactivos: number; dias: number };
  decisiones: { value: Decision; label: string }[];
};
type Detalle = Resumen & { items: (Partial<Item> & { name: string; role_name: string; decision_name: string; resultado?: string })[]; desactivados_nombres: string[] };

const DECISION: Record<Decision, [string, Tone]> = { KEEP: ["Mantener", "ok"], CHANGE: ["Cambiar", "warn"], DEACTIVATE: ["Desactivar", "bad"] };
const OPCIONES = (Object.keys(DECISION) as Decision[]).map((k) => ({ value: k, label: DECISION[k][0] }));

/**
 * AUD-08 Revisión de accesos: cada trimestre se revisan usuarios, roles, alcance y último ingreso; se marca mantener,
 * cambiar o desactivar y se cierra con los hallazgos. Las decisiones se guardan al elegirlas.
 */
export default function RevisionDeAccesos() {
  const { can } = useSesion();
  const permitido = Boolean(can("aud.access_review.run") || can("aud.change_log.view"));
  const [p, setP] = useState<Panel | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ buscar: "", propuesta: "", decision: "", hallazgos: "" });
  const [fc, setFc] = useState({ buscar: "" });
  const [nota, setNota] = useState<Item | null>(null);
  const [cerrada, setCerrada] = useState<string | null>(null);
  const [hallazgos, setHallazgos] = useState("");

  const cargar = useCallback(() => {
    if (!permitido) return;
    api<Panel>("/v1/aud/revision").then((r) => { setP(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [permitido]);
  useEffect(() => cargar(), [cargar]);

  const visibles = useMemo(() => {
    const q = sinTildes(f.buscar.trim());
    return (p?.items ?? []).filter((i) => (!q || sinTildes(`${i.name} ${i.email} ${i.role_name} ${i.alcance} ${i.flags.join(" ")}`).includes(q))
      && (!f.propuesta || i.proposal === f.propuesta) && (!f.decision || i.decision === f.decision) && (!f.hallazgos || (f.hallazgos === "si" ? i.flags.length > 0 : i.flags.length === 0)));
  }, [p, f]);
  const ord = useOrdenLocal(visibles, {
    name: (i) => i.name, role: (i) => i.role_name, alcance: (i) => i.alcance, last_login: (i) => i.days_inactive, flags: (i) => i.flags.length,
    proposal: (i) => i.proposal, decision: (i) => i.decision,
  });
  const pagina = usePaginaLocal(ord.filas, `${JSON.stringify(f)}|${ord.orden.sort}`, 50);

  const cerradasVisibles = useMemo(() => {
    const q = sinTildes(fc.buscar.trim());
    return (p?.cerradas ?? []).filter((r) => !q || sinTildes(`${r.number} ${r.reviewer ?? ""} ${r.findings ?? ""}`).includes(q));
  }, [p, fc]);
  const ordC = useOrdenLocal(cerradasVisibles, { number: (r) => r.quarter, closed_at: (r) => r.closed_at, reviewer: (r) => r.reviewer, revisados: (r) => r.revisados, desactivados: (r) => r.desactivados });
  const paginaC = usePaginaLocal(ordC.filas, `${JSON.stringify(fc)}|${ordC.orden.sort}`);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta la revisión de accesos.</Alert>;

  const actual = p?.actual;
  const abierta = actual?.status === "OPEN" ? actual : null;
  const puede = Boolean(p?.puede);

  async function iniciar() {
    try {
      const r = await api<Panel>("/v1/aud/revision", { method: "POST" });
      setP(r);
      toast.ok(`Revisión ${r.actual?.number} abierta`);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function decidir(i: Item, decision: Decision, note = i.note) {
    if (!abierta) return;
    try {
      const nuevo = await api<Item>(`/v1/aud/revision/${abierta.id}/decisiones`, { method: "PUT", body: { user_id: i.user_id, decision, note } });
      setP((x) => (x ? { ...x, items: (x.items ?? []).map((y) => (y.user_id === i.user_id ? nuevo : y)) } : x));
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function cerrar() {
    if (!abierta || !p?.items) return;
    const desactivar = p.items.filter((i) => i.decision === "DEACTIVATE");
    const cambiar = p.items.filter((i) => i.decision === "CHANGE").length;
    const ok = await confirmAction({ title: `¿Cerrar la revisión ${abierta.number}?`, confirmLabel: "Cerrar la revisión", danger: desactivar.length > 0,
      message: `${p.items.length} usuarios revisados. ${desactivar.length ? `Se desactivará a ${desactivar.length} persona(s): ${desactivar.map((i) => i.name).join(", ")}; se cierran sus sesiones y se revocan sus celulares.` : "No se desactiva a nadie."} ${cambiar ? `${cambiar} quedan con cambios de rol o alcance por hacer en Usuarios.` : ""} Después no se puede modificar.` });
    if (!ok) return;
    try {
      const r = await api<Detalle>(`/v1/aud/revision/${abierta.id}/cerrar`, { method: "POST", body: { findings: hallazgos } });
      toast.ok(`${r.number} cerrada: ${r.revisados} revisados, ${r.desactivados} desactivado(s)`);
      setHallazgos("");
      cargar();
      setCerrada(r.id);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Item>[] = [
    { key: "name", sortable: true, header: "Usuario", cardTitle: true, render: (i) => (
      <div className="min-w-0"><p className="font-semibold text-ink">{i.name}</p><p className="text-[12px] text-muted">{i.email}</p></div>
    ) },
    { key: "role", sortable: true, header: "Rol", render: (i) => <span className="text-[12.5px]">{i.role_name}</span> },
    { key: "alcance", sortable: true, header: "Alcance", hideOnMobile: true, render: (i) => <span className="text-[12px] text-muted">{i.alcance}</span> },
    { key: "last_login", sortable: true, header: "Último ingreso", render: (i) => (
      <span className={`whitespace-nowrap text-[12.5px] ${i.inactivo ? "font-semibold text-bad" : ""}`}>
        {i.last_login ? `${fecha(i.last_login)} (hace ${i.days_inactive} días)` : `Nunca (creado hace ${i.days_inactive} días)`}
      </span>
    ) },
    { key: "flags", sortable: true, header: "Hallazgos", render: (i) => (i.flags.length ? <span className="text-[12px] text-warn">{i.flags.join("; ")}</span> : <span className="text-muted">—</span>) },
    { key: "proposal", sortable: true, header: "Propuesta", render: (i) => <Badge tone={DECISION[i.proposal][1]} dot>{DECISION[i.proposal][0]}</Badge> },
    { key: "decision", sortable: true, header: "Decisión", render: (i) => (puede && abierta
      ? <div onClick={(e) => e.stopPropagation()} className="min-w-[130px]"><Select value={i.decision} onChange={(e) => decidir(i, e.target.value as Decision)} options={OPCIONES} aria-label={`Decisión sobre ${i.name}`} /></div>
      : <Badge tone={DECISION[i.decision][1]}>{DECISION[i.decision][0]}</Badge>) },
  ];

  const columnasC: Column<Resumen>[] = [
    { key: "number", sortable: true, header: "Revisión", cardTitle: true, render: (r) => <span className="whitespace-nowrap font-mono font-semibold text-ink">{r.number}</span> },
    { key: "closed_at", sortable: true, header: "Cerrada", render: (r) => <span className="whitespace-nowrap">{fecha(r.closed_at)}</span> },
    { key: "reviewer", sortable: true, header: "Revisor", render: (r) => r.reviewer ?? "—" },
    { key: "revisados", sortable: true, header: "Revisados", align: "right", render: (r) => numero(r.revisados) },
    { key: "desactivados", sortable: true, header: "Desactivados", align: "right", render: (r) => numero(r.desactivados) },
    { key: "a_tiempo", header: "A tiempo", render: (r) => (r.a_tiempo ? <Badge tone="ok" dot>Sí</Badge> : <Badge tone="bad" dot>Tarde</Badge>) },
    { key: "findings", header: "Hallazgos", hideOnMobile: true, render: (r) => <span className="line-clamp-2 max-w-[420px] text-[12.5px]">{r.findings}</span> },
  ];

  const c = p?.cifras;
  const porDesactivar = (p?.items ?? []).filter((i) => i.decision === "DEACTIVATE").length;
  return (
    <div className="grid gap-5">
      <PageHeader description={`Cada trimestre se revisan los usuarios con su rol, su alcance por marca y local, y su último ingreso. Se propone desactivar a quien no ingresa hace ${c?.dias ?? 60} días o tiene su trabajador cesado. Al cerrar la revisión se desactiva a los marcados y quedan los hallazgos.`}
        actions={p && !actual && puede ? <Button variant="primary" icon={ClipboardCheck} onClick={iniciar}>Iniciar revisión de {p.trimestre}</Button> : undefined} />
      {p && c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Revisión en curso" valor={actual ? `${actual.quarter.slice(5)} ${actual.quarter.slice(0, 4)}` : "—"} icono={ClipboardCheck} destacada
            detalle={actual ? (actual.status === "OPEN" ? `Vence el ${fecha(actual.due_date)}` : `Cerrada el ${fecha(actual.closed_at)}`) : "No iniciada"} />
          <Cifra titulo="Revisiones a tiempo" valor={c.a_tiempo === null ? "—" : porcentaje(c.a_tiempo)} icono={CalendarCheck2}
            tono={c.a_tiempo !== null && c.a_tiempo < 100 ? "warn" : "ok"} detalle={`${c.a_tiempo_ok} de ${c.a_tiempo_de} · meta 100 %`} />
          <Cifra titulo="Usuarios inactivos" valor={numero(c.inactivos)} icono={UserX} tono={c.inactivos ? "warn" : undefined} detalle={`${c.dias} días o más sin ingresar`} />
          <Cifra titulo="Por desactivar" valor={abierta ? numero(porDesactivar) : "—"} icono={Lock} detalle={abierta ? "Con la decisión actual" : "Sin revisión abierta"} />
        </div>
      )}
      {error && <Alert tone="bad">{error}</Alert>}
      {p && !actual && <Alert tone="info">La revisión de {p.trimestre} todavía no se abrió. Se abre sola el primer día del trimestre y avisa a la gerencia{puede ? "; también puedes iniciarla ahora" : ""}.</Alert>}

      {abierta && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-semibold text-ink">{abierta.number} · abierta el {fecha(abierta.opened_at)}</h2>
            <p className="text-[12.5px] text-muted">{puede ? "La decisión se guarda al elegirla. Haz clic en una fila para dejar una nota." : "Solo la gerencia y administración del sistema deciden y cierran la revisión."}</p>
          </div>
          <DataTable {...ord.orden} rowKey={(i) => i.user_id} columns={columnas} rows={pagina.filas} pagination={pagina.props} onRowClick={puede ? setNota : undefined}
            empty="Nadie coincide con estos filtros."
            search={{ value: f.buscar, onChange: (v) => setF({ ...f, buscar: v }), placeholder: "Buscar persona, rol o hallazgo…" }}
            toolbar={<>
              <FiltroSelect etiqueta="Propuesta" ancho={180} value={f.propuesta} onChange={(v) => setF({ ...f, propuesta: v })} options={OPCIONES} />
              <FiltroSelect etiqueta="Decisión" ancho={180} value={f.decision} onChange={(v) => setF({ ...f, decision: v })} options={OPCIONES} />
              <FiltroSelect etiqueta="Hallazgos" ancho={170} value={f.hallazgos} onChange={(v) => setF({ ...f, hallazgos: v })} options={[{ value: "si", label: "Con hallazgos" }, { value: "no", label: "Sin hallazgos" }]} />
            </>} />
          {puede && (
            <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <Field label="Hallazgos y acuerdos" required hint="Al menos 10 caracteres. Se guardan con la revisión, junto con el resumen de revisados y desactivados.">
                <Textarea rows={3} maxLength={2000} value={hallazgos} onChange={(e) => setHallazgos(e.target.value)} placeholder="Por ejemplo: se pidió segundo factor a contabilidad; soporte de Intelectalab solo con acceso temporal." />
              </Field>
              <div className="flex justify-end"><Button variant="primary" icon={ClipboardCheck} disabled={hallazgos.trim().length < 10} onClick={cerrar}>Cerrar la revisión</Button></div>
            </div>
          )}
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Revisiones cerradas</h2>
        <DataTable {...ordC.orden} columns={columnasC} rows={paginaC.filas} pagination={paginaC.props} loading={!p && !error} onRowClick={(r) => setCerrada(r.id)}
          empty="Todavía no hay revisiones cerradas."
          search={{ value: fc.buscar, onChange: (v) => setFc({ buscar: v }), placeholder: "Buscar revisión, revisor o hallazgo…" }} />
      </section>

      {nota && abierta && <NotaDecision item={nota} onClose={() => setNota(null)} onGuardar={async (d, n) => { await decidir(nota, d, n); setNota(null); }} />}
      {cerrada && <DetalleRevision id={cerrada} onClose={() => setCerrada(null)} />}
    </div>
  );
}

function NotaDecision({ item, onClose, onGuardar }: { item: Item; onClose: () => void; onGuardar: (d: Decision, nota: string) => Promise<void> }) {
  const [d, setD] = useState<Decision>(item.decision);
  const [n, setN] = useState(item.note);
  return (
    <Modal open onClose={onClose} title={item.name} description={`${item.role_name} · ${item.email}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={() => onGuardar(d, n)}>Guardar</Button></>}>
      <div className="grid gap-4">
        <DetailList items={[
          { label: "Alcance", value: item.alcance },
          { label: "Último ingreso", value: item.last_login ? `${fechaHora(item.last_login)} (hace ${item.days_inactive} días)` : "Nunca" },
          { label: "Hallazgos", value: item.flags.length ? item.flags.join("; ") : "Ninguno" },
          { label: "Propuesta", value: <Badge tone={DECISION[item.proposal][1]} dot>{DECISION[item.proposal][0]}</Badge> },
        ]} />
        <Field label="Decisión"><Select value={d} onChange={(e) => setD(e.target.value as Decision)} options={OPCIONES} /></Field>
        <Field label="Nota" hint="Por ejemplo, qué cambiar del rol o del alcance."><Textarea rows={3} maxLength={300} value={n} onChange={(e) => setN(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function DetalleRevision({ id, onClose }: { id: string; onClose: () => void }) {
  const [r, setR] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Detalle>(`/v1/aud/revision/${id}`).then((x) => vivo && setR(x)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);
  const filas = (r?.items ?? []).filter((i) => !buscar.trim() || sinTildes(`${i.name} ${i.role_name} ${i.decision_name}`).includes(sinTildes(buscar.trim())));
  return (
    <Modal open onClose={onClose} size="lg" title={r ? `Revisión ${r.number}` : "Revisión"}>
      {error && <Alert tone="bad">{error}</Alert>}
      {r && (
        <div className="grid gap-4">
          <DetailList items={[
            { label: "Trimestre", value: r.quarter }, { label: "Abierta", value: fechaHora(r.opened_at) },
            { label: "Cerrada", value: r.closed_at ? `${fechaHora(r.closed_at)} · ${r.a_tiempo ? "a tiempo" : "fuera de plazo"}` : "—" }, { label: "Revisor", value: r.reviewer ?? "—" },
            { label: "Hallazgos", value: r.findings ?? "—" },
            { label: "Desactivados", value: r.desactivados_nombres.length ? r.desactivados_nombres.join(", ") : "Ninguno" },
          ]} />
          <DataTable columns={[
            { key: "name", header: "Usuario", cardTitle: true, render: (i) => i.name },
            { key: "role", header: "Rol", render: (i) => i.role_name },
            { key: "flags", header: "Hallazgos", hideOnMobile: true, render: (i) => (i.flags?.length ? <span className="text-[12px] text-warn">{i.flags.join("; ")}</span> : <span className="text-muted">—</span>) },
            { key: "decision", header: "Decisión", render: (i) => i.decision_name },
            { key: "resultado", header: "Resultado", hideOnMobile: true, render: (i) => <span className="text-[12px]">{i.resultado ?? i.note ?? "—"}</span> },
          ] as Column<Detalle["items"][number]>[]} rowKey={(i) => `${i.user_id ?? ""}-${i.name}`} rows={filas} empty="Nadie coincide."
            search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar persona o decisión…" }} />
        </div>
      )}
    </Modal>
  );
}
