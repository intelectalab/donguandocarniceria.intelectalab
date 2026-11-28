"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { Badge, Button, Cifra, Field, FiltroSelect, Modal, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, porcentaje } from "@/lib/formato";
import { AlDetalle, ESTADOS_ALERTA, ErrorCarga, FiltroMes, Seccion, Semaforo, Vacio, hoyLima, mesLargo, s0, useDatos } from "@/modulos/prs/comunes";

type Comentario = { at: string; user: string; text: string };
type AlertaFila = { id: string; version_id: string; period: string; mes: string; concept_id: string; code: string; name: string; dimension: string; cost_center_id: string | null;
  level: string; status: string; estado: string; budget: number; actual: number; forecast: number; pct: number | null; as_of: string; days_elapsed: number;
  responsable: string | null; avisados: string[]; comments: Comentario[]; raised_at: string; closed_at: string | null; puede_comentar: boolean };
type Datos = { alertas: AlertaFila[]; conteo: { abiertas: number; seguimiento: number; cerradas: number }; umbral: number };
type Semaforos = { filas: { concept_id: string; name: string; centro: string; cost_center_id: string | null; responsable: string | null; budget: number; forecast: number; fpct: number | null; light: string }[]; mes: string; al: string };

/** PRS-10 Alertas de desviación: las líneas cuya proyección pasa el umbral, su responsable, los comentarios y el semáforo por centro de costo (RN-PRS-10). */
export default function AlertasDeDesviacion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const hoy = hoyLima();
  const [estado, setEstado] = useState(sp.get("estado") ?? "ACTIVAS");
  const [mes, setMes] = useState(sp.get("mes") ?? "");
  const [comentando, setComentando] = useState<AlertaFila | null>(null);
  const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(mes ? { mes } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/prs/alertas?${q}`);
  const mesSem = mes || hoy.slice(0, 7);
  const alSem = mesSem === hoy.slice(0, 7) ? hoy : finDeMes(mesSem);
  const { datos: sem } = useDatos<Semaforos>(`/v1/prs/alertas/semaforo?mes=${mesSem}&al=${alSem}`);
  if (error) return <ErrorCarga error={error} que="Las alertas las ven sus responsables, Gerencia, Administración y la Contadora." />;
  const c = datos?.conteo;

  return (
    <div className="space-y-4">
      <PageHeader description={`Una alerta se abre cuando la proyección de cierre de una línea de gasto pasa el ${datos?.umbral ?? 10} % de su presupuesto. Se avisa al responsable del centro de costo y a Gerencia; ahí se deja el comentario o la acción tomada.`} />
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} vacio="Todas" ancho={190}
          options={[{ value: "ACTIVAS", label: "Abiertas y en seguimiento" }, { value: "OPEN", label: "Abiertas" }, { value: "ACK", label: "En seguimiento" }, { value: "CLOSED", label: "Cerradas" }, { value: "RESOLVED", label: "Resueltas" }]} />
        <FiltroMes value={mes} onChange={setMes} />
        {mes && <Button size="sm" variant="ghost" onClick={() => setMes("")}>Todos los meses</Button>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Cifra titulo="Abiertas" valor={c ? String(c.abiertas) : undefined} detalle="De todos los meses" tono={c?.abiertas ? "bad" : "ok"} destacada />
        <Cifra titulo="En seguimiento" valor={c ? String(c.seguimiento) : undefined} tono={c?.seguimiento ? "warn" : undefined} />
        <Cifra titulo="Cerradas o resueltas" valor={c ? String(c.cerradas) : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {cargando && !datos && <Vacio>Cargando…</Vacio>}
          {datos && datos.alertas.length === 0 && <Seccion><Vacio>No hay alertas con este filtro.</Vacio></Seccion>}
          {datos?.alertas.map((a) => (
            <Seccion key={a.id} titulo={<span className="flex flex-wrap items-center gap-2"><AlDetalle concepto={a.concept_id} mes={a.period.slice(0, 7)} al={a.as_of}>{a.name}</AlDetalle>
              <StatusBadge status={a.status} labels={ESTADOS_ALERTA} /></span>}
              acciones={a.puede_comentar && !["CLOSED", "RESOLVED"].includes(a.status) ? <Button size="sm" icon={MessageSquare} onClick={() => setComentando(a)}>Comentar</Button> : undefined}>
              <p className="text-[12.5px] text-muted">{a.code} · {a.dimension} · {a.mes} · al {fecha(a.as_of)} (día {a.days_elapsed})</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
                <div><span className="block text-[12px] text-muted">Presupuesto</span>{s0(a.budget)}</div>
                <div><span className="block text-[12px] text-muted">Real</span>{s0(a.actual)}</div>
                <div><span className="block text-[12px] text-muted">Proyección</span><span className="font-medium text-bad">{s0(a.forecast)}{a.pct !== null ? ` · ${porcentaje(a.pct, 1)}` : ""}</span></div>
              </div>
              <p className="mt-2 text-[12.5px]">Responsable: <span className="font-medium">{a.responsable ?? "Sin responsable"}</span>{a.avisados.length > 0 && <span className="text-muted"> · avisados: {a.avisados.join(", ")}</span>}</p>
              {a.comments.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-t border-line pt-2 text-[13px]">
                  {a.comments.map((m, i) => <li key={i}><span className="font-medium">{m.user}</span> <span className="text-[12px] text-muted">{m.at.replace("T", " ").slice(0, 16)}</span><span className="block">{m.text}</span></li>)}
                </ul>)}
            </Seccion>))}
        </div>
        <Seccion titulo={`Semáforo por centro de costo · ${mesLargo(`${mesSem}-01`)}`} className="self-start">
          {sem && sem.filas.length === 0 && <Vacio>Todos los centros van en verde.</Vacio>}
          <ul className="space-y-2 text-[13px]">
            {sem?.filas.map((x, i) => (
              <li key={`${x.concept_id}-${x.cost_center_id}-${i}`} className="flex items-start justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span className="min-w-0"><span className="block font-medium">{x.centro}</span><span className="block text-[12px] text-muted">{x.name}{x.responsable ? ` · ${x.responsable}` : ""}</span></span>
                <Semaforo luz={x.light} pct={x.fpct} />
              </li>))}
          </ul>
          <Link className="mt-2 block text-[12.5px] text-primary hover:underline" href={`/m/prs/prs-08?mes=${mesSem}&al=${alSem}`}>Ver la proyección de cierre</Link>
        </Seccion>
      </div>
      {comentando && <Comentar alerta={comentando} onClose={() => setComentando(null)} onListo={() => { setComentando(null); recargar(); }} />}
    </div>
  );
}

function finDeMes(m: string) {
  const [y, mm] = m.split("-").map(Number);
  return `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, "0")}`;
}

function Comentar({ alerta, onClose, onListo }: { alerta: AlertaFila; onClose: () => void; onListo: () => void }) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState(alerta.status === "OPEN" ? "ACK" : alerta.status);
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api(`/v1/prs/alertas/${alerta.id}/comentar`, { method: "POST", body: { texto, estado } });
      toast.ok("Comentario guardado");
      onListo();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Comentar la alerta" description={`${alerta.name} · ${alerta.dimension} · ${alerta.mes}`} dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-prs-alerta" loading={guardando} disabled={texto.trim().length < 5}>Guardar</Button></>}>
      <form id="f-prs-alerta" onSubmit={guardar} className="space-y-3">
        <Field label="Comentario o acción tomada" required hint="Por ejemplo: qué causó la desviación y qué se hará."><Textarea value={texto} maxLength={1000} rows={4} onChange={(e) => setTexto(e.target.value)} /></Field>
        <Field label="Estado">
          <Select value={estado} onChange={(e) => setEstado(e.target.value)} options={[{ value: "OPEN", label: "Abierta" }, { value: "ACK", label: "En seguimiento" }, { value: "CLOSED", label: "Cerrada" }]} />
        </Field>
        <p className="text-[12px] text-muted"><Badge>{alerta.estado}</Badge> Al cerrar, la alerta deja de avisar este mes.</p>
      </form>
    </Modal>
  );
}
