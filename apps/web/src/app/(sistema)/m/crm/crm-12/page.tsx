"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, ShieldAlert, ShieldX, XCircle } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Modal, PageHeader, Select, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Hilo, type Ficha as FichaChat } from "@/modulos/crm/conversacion";

type Opcion = { value: string; label: string };
type AlertaFila = {
  id: string; raised_at: string; vendedora: string | null; user_id: string; regla: string; rule_code: string; tipo: string; severity: string; gravedad: string; coincidencia: string;
  extracto: string; fuente: string; marca: string | null; status: string; estado: string; conversation_id: string | null; message_id: string | null; reviso: string | null;
  reviewed_at: string | null; nota: string | null; puede_revisar: boolean; propia: boolean; chat?: string | null;
};
type Lista = Pagina<AlertaFila> & {
  cifras: { abiertas: number; altas: number; en_revision: number; confirmadas_mes: number; confirmadas: number; descartadas: number };
  por_vendedora: { nombre: string; n: number; alta: boolean }[]; conversacion: string | null;
  opciones: { estados: Opcion[]; gravedades: Opcion[]; fuentes: Opcion[]; reglas: Opcion[]; vendedoras: Opcion[]; marcas: Opcion[] }; puede: { revisar: boolean };
};

const ESTADOS: Record<string, Tone> = { OPEN: "bad", UNDER_REVIEW: "warn", DISMISSED: "neutral", CONFIRMED: "bad" };
const GRAVEDAD: Record<string, Tone> = { HIGH: "bad", MEDIUM: "warn", LOW: "info" };

/**
 * CRM-12 Alertas de control: por vendedora, regla y gravedad con la coincidencia, el extracto y el enlace al mensaje.
 * La supervisora (o la gerencia) las toma en revisión y las cierra como confirmadas o descartadas, siempre con nota.
 * Las alertas no se borran y nadie revisa una alerta sobre sí misma.
 */
function Alertas() {
  const params = useSearchParams();
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.alert.review"));
  const [f, setF] = useState({ estado: "", gravedad: "", vendedora: "", regla: "", fuente: "", marca: "", desde: "", hasta: "", conversacion: params.get("conversacion") ?? "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<string | null>(params.get("id"));
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/alertas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="info">Las alertas de control las revisa la supervisora de ventas o la gerencia. Una vendedora no ve las alertas sobre ella.</Alert>;
  const c = lista?.cifras;
  const max = Math.max(1, ...(lista?.por_vendedora ?? []).map((v) => v.n));
  const columnas: Column<AlertaFila>[] = [
    { key: "fecha", sortable: true, header: "Fecha", render: (a) => <span className="whitespace-nowrap">{fechaHora(a.raised_at)}</span> },
    { key: "vendedora", sortable: true, header: "Vendedora", cardTitle: true, render: (a) => <span className="font-semibold text-ink">{a.vendedora ?? "—"}</span> },
    { key: "regla", sortable: true, header: "Regla", render: (a) => <div><p className="text-[12.5px] font-semibold text-ink">{a.regla}</p><p className="text-[11.5px] text-muted">{a.tipo}</p></div> },
    { key: "gravedad", sortable: true, header: "Gravedad", render: (a) => <Badge tone={GRAVEDAD[a.severity] ?? "neutral"}>{a.gravedad}</Badge> },
    { key: "coincidencia", header: "Coincidencia", render: (a) => <span className="font-semibold text-bad">«{a.coincidencia}»</span> },
    { key: "extracto", header: "Extracto", hideOnMobile: true, render: (a) => <span className="line-clamp-2 max-w-[320px] text-[12.5px] text-muted">{a.extracto}</span> },
    { key: "fuente", header: "Fuente", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{a.fuente}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (a) => <Badge tone={ESTADOS[a.status] ?? "neutral"}>{a.estado}</Badge> },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description="Lo que las vendedoras escriben se compara con las reglas: frases como «por fuera» o «mi yape», celulares y cuentas que no son de la empresa y productos que no vendemos. También avisan el borrado de un mensaje en el celular y los chats sin responder. Cada alerta se revisa y se cierra con una nota; ninguna se borra." />
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN", gravedad: "" })}><Cifra titulo="Abiertas" valor={numero(c.abiertas)} icono={ShieldAlert} destacada /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "OPEN", gravedad: "HIGH" })}><Cifra titulo="Gravedad alta abiertas" valor={numero(c.altas)} icono={ShieldX} tono={c.altas ? "bad" : "ok"} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "UNDER_REVIEW", gravedad: "" })}><Cifra titulo="En revisión" valor={numero(c.en_revision)} icono={Eye} tono={c.en_revision ? "warn" : undefined} detalle="Clic para verlas" /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "CONFIRMED", gravedad: "" })}><Cifra titulo="Confirmadas del mes" valor={numero(c.confirmadas_mes)} icono={CheckCircle2} tono={c.confirmadas_mes ? "bad" : undefined} detalle={`${numero(c.confirmadas)} en total`} /></button>
          <button type="button" className="text-left" onClick={() => setF({ ...f, estado: "DISMISSED", gravedad: "" })}><Cifra titulo="Descartadas" valor={numero(c.descartadas)} icono={XCircle} detalle="Falsos positivos" /></button>
        </div>
      )}
      {f.conversacion && <Alert tone="info">Solo las alertas del chat con {lista?.conversacion ?? "este cliente"}. <button type="button" className="cursor-pointer font-semibold underline" onClick={() => setF({ ...f, conversacion: "" })}>Ver todas</button></Alert>}
      {lista && lista.por_vendedora.length > 0 && (
        <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-ink">Abiertas y en revisión por vendedora</h2>
          {lista.por_vendedora.map((v) => (
            <div key={v.nombre} className="grid grid-cols-[minmax(110px,180px)_1fr_40px] items-center gap-3 text-[12.5px]">
              <span className="truncate">{v.nombre}</span>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${v.alta ? "bg-bad" : "bg-warn"}`} style={{ width: `${(v.n / max) * 100}%` }} /></div>
              <span className="text-right tabular-nums">{v.n}</span>
            </div>
          ))}
          <p className="text-[11.5px] text-muted">En rojo, las que tienen alguna de gravedad alta.</p>
        </section>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(a) => setAbierta(a.id)} empty={f.estado ? "Ninguna alerta con estos filtros." : "No hay alertas abiertas ni en revisión."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar vendedora, regla, coincidencia o extracto…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={240} vacio="Estado: abiertas y en revisión" value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[...(o?.estados ?? []), { value: "ALL", label: "Todas" }]} />
          <FiltroSelect etiqueta="Gravedad" todos="todas" ancho={150} value={f.gravedad} onChange={(v) => setF({ ...f, gravedad: v })} options={o?.gravedades ?? []} />
          <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />
          <FiltroSelect etiqueta="Regla" todos="todas" ancho={200} value={f.regla} onChange={(v) => setF({ ...f, regla: v })} options={o?.reglas ?? []} />
          <FiltroSelect etiqueta="Fuente" todos="todas" ancho={170} value={f.fuente} onChange={(v) => setF({ ...f, fuente: v })} options={o?.fuentes ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {abierta && <FichaAlerta id={abierta} onClose={() => setAbierta(null)} onCambio={cargar} />}
    </div>
  );
}

function FichaAlerta({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const [a, setA] = useState<AlertaFila | null>(null);
  const [chat, setChat] = useState<FichaChat | null>(null);
  const [error, setError] = useState("");
  const [d, setD] = useState({ estado: "CONFIRMED", nota: "" });
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    let vivo = true;
    api<AlertaFila>(`/v1/crm/alertas/${id}`).then((r) => {
      if (!vivo) return;
      setA(r);
      if (r.conversation_id) api<FichaChat>(`/v1/crm/conversaciones/${r.conversation_id}`).then((x) => vivo && setChat(x)).catch(() => undefined);
    }).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);
  async function revisar(estado: string, nota?: string) {
    setEnviando(true);
    try {
      setA(await api<AlertaFila>(`/v1/crm/alertas/${id}/revision`, { method: "POST", body: { estado, nota: nota || null } }));
      toast.ok(estado === "UNDER_REVIEW" ? "Alerta en revisión" : estado === "CONFIRMED" ? "Alerta confirmada: se avisó a la gerencia" : "Alerta descartada");
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title={a ? `${a.regla} · ${a.vendedora ?? ""}` : "Alerta"} description={a ? `${a.tipo} · ${fechaHora(a.raised_at)}` : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {a && (
        <div className="grid gap-4">
          <DetailList items={[
            { label: "Estado", value: <Badge tone={ESTADOS[a.status] ?? "neutral"}>{a.estado}</Badge> }, { label: "Gravedad", value: <Badge tone={GRAVEDAD[a.severity] ?? "neutral"}>{a.gravedad}</Badge> },
            { label: "Coincidencia", value: <span className="font-semibold text-bad">«{a.coincidencia}»</span> }, { label: "Fuente", value: a.fuente },
            { label: "Extracto", value: a.extracto }, { label: "Chat", value: a.chat ?? "—" }, { label: "Marca", value: a.marca ?? "—" },
            { label: "Revisó", value: a.reviso ? `${a.reviso} · ${fechaHora(a.reviewed_at)}` : "—" }, { label: "Nota de la revisión", value: a.nota ?? "—" },
          ]} />
          {a.conversation_id && <Link href={`/m/crm/crm-02?id=${a.conversation_id}`} className="inline-flex w-fit items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Ir al chat</Link>}
          {a.propia && ["OPEN", "UNDER_REVIEW"].includes(a.status) && <Alert tone="info">Esta alerta es sobre ti: la revisa otra persona (la gerencia o otra supervisora).</Alert>}
          {a.puede_revisar && (
            <div className="grid gap-3 rounded-lg border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">Cerrar la revisión</p>
                {a.status === "OPEN" && <Button size="sm" variant="ghost" loading={enviando} onClick={() => revisar("UNDER_REVIEW")}>Tomar en revisión</Button>}
              </div>
              <Field label="Resultado"><Select value={d.estado} onChange={(e) => setD({ ...d, estado: e.target.value })}
                options={[{ value: "CONFIRMED", label: "Confirmada (se avisa a la gerencia)" }, { value: "DISMISSED", label: "Descartada (falso positivo)" }]} /></Field>
              <Field label="Nota de la revisión" required hint="Qué se encontró y qué se hizo. Queda guardada y no se puede cambiar.">
                <Textarea rows={3} maxLength={2000} value={d.nota} onChange={(e) => setD({ ...d, nota: e.target.value })} />
              </Field>
              <div className="flex justify-end"><Button variant={d.estado === "CONFIRMED" ? "danger" : "primary"} loading={enviando} disabled={d.nota.trim().length < 5} onClick={() => revisar(d.estado, d.nota)}>Cerrar alerta</Button></div>
            </div>
          )}
          {chat && <div className="grid gap-2"><p className="text-[13px] font-semibold text-ink">Conversación</p><Hilo c={chat} onMensaje={() => undefined} /></div>}
        </div>
      )}
    </Modal>
  );
}

export default function Page() {
  return <Suspense><Alertas /></Suspense>;
}
