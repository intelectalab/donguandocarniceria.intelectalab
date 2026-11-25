"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";

type Opcion = { value: string; label: string };
type Lead = {
  id: string; full_name: string; phone: string | null; source: string; source_name: string; canal: string | null; marca: string | null; brand_id: string; ad_code: string | null;
  vendedora: string | null; first_contact_at: string; status: string; status_name: string; lost_reason: string | null; lost_name: string | null;
};
type Ficha = Lead & { notes: string | null; first_response_at: string | null; converted_at: string | null; pedido: string | null; conversacion: string | null };
type Lista = Pagina<Lead> & {
  embudo: { estado: string; nombre: string; n: number }[]; conversion: { creados: number; ganados: number; pct: number | null };
  opciones: { estados: Opcion[]; motivos: Opcion[]; redes: Opcion[]; manuales: Opcion[]; marcas: Opcion[]; canales: Opcion[]; vendedoras: Opcion[] }; puede: boolean;
};

const ESTADOS: Record<string, [string, Tone]> = { NEW: ["Nuevo", "info"], CONTACTED: ["Contactado", "info"], QUALIFIED: ["Calificado", "warn"], WON: ["Ganado", "ok"], LOST: ["Perdido", "bad"], DISCARDED: ["Descartado", "neutral"] };
const TONO_EMBUDO: Record<string, string> = { WON: "border-ok/50", LOST: "border-bad/50", DISCARDED: "border-line" };

/**
 * CRM-05 Leads: el embudo NUEVO → CONTACTADO → CALIFICADO → GANADO o PERDIDO / DESCARTADO por marca, red, número, anuncio
 * y vendedora. Un lead se gana solo con su pedido desde el chat y se pierde con motivo.
 */
function Leads() {
  const params = useSearchParams();
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [f, setF] = useState({ estado: "", marca: "", red: "", canal: "", anuncio: "", vendedora: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(params.get("id"));
  const [nuevo, setNuevo] = useState(false);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/leads?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta los leads.</Alert>;

  const total = lista?.embudo.reduce((s, e) => s + e.n, 0) ?? 0;
  const columnas: Column<Lead>[] = [
    { key: "nombre", sortable: true, header: "Lead", cardTitle: true, render: (l) => <div><p className="font-semibold text-ink">{l.full_name}</p><p className="font-mono text-[12px] text-muted">{l.phone ?? "—"}</p></div> },
    { key: "source", header: "Red", render: (l) => <span className="text-[12.5px]">{l.source_name}</span> },
    { key: "canal", sortable: true, header: "Número", hideOnMobile: true, render: (l) => <span className="text-[12.5px]">{l.canal ?? "Cargado a mano"}</span> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (l) => <span className="text-[12.5px]">{l.marca}</span> },
    { key: "ad_code", header: "Anuncio", render: (l) => (l.ad_code ? <Badge tone="info">{l.ad_code}</Badge> : <span className="text-muted">Orgánico</span>) },
    { key: "vendedora", sortable: true, header: "Vendedora", hideOnMobile: true, render: (l) => <span className="text-[12.5px]">{l.vendedora ?? "—"}</span> },
    { key: "primer_contacto", sortable: true, header: "Primer contacto", render: (l) => <span className="whitespace-nowrap">{fechaHora(l.first_contact_at)}</span> },
    { key: "estado", sortable: true, header: "Estado", render: (l) => <StatusBadge status={l.status} labels={ESTADOS} /> },
    { key: "motivo", header: "Motivo", hideOnMobile: true, render: (l) => l.lost_name ? <span className="text-[12.5px]">{l.lost_name}</span> : <span className="text-muted">—</span> },
  ];
  const o = lista?.opciones;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada número desconocido que escribe es un lead hasta su primer pedido. Pasa a ganado solo con su pedido desde el chat; si no compra, se marca perdido con su motivo o se descarta."
        actions={lista?.puede ? <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo lead</Button> : undefined} />
      {lista && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {lista.embudo.map((e) => (
            <button key={e.estado} type="button" onClick={() => setF({ ...f, estado: f.estado === e.estado ? "" : e.estado })}
              className={`grid cursor-pointer gap-1 rounded-xl border-2 bg-surface p-3 text-left shadow-card hover:brightness-105 ${f.estado === e.estado ? "border-primary" : TONO_EMBUDO[e.estado] ?? "border-line"}`}>
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{e.nombre}</span>
              <span className="text-[22px] font-semibold tabular-nums text-ink">{numero(e.n)}</span>
              <span className="text-[11.5px] text-muted">{total ? porcentaje((e.n / total) * 100) : "—"}</span>
            </button>
          ))}
        </div>
      )}
      {lista && <Alert tone="info">Conversión del mes: {lista.conversion.pct === null ? "sin leads nuevos este mes" : `${porcentaje(lista.conversion.pct, 1)} (${lista.conversion.ganados} ganados de ${lista.conversion.creados} leads)`}.</Alert>}
      <DataTable {...pag.orden} rowKey={(l) => l.id} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(l) => setAbierto(l.id)} empty="Ningún lead con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar nombre, celular o anuncio…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={o?.estados ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroSelect etiqueta="Red" todos="todas" ancho={160} value={f.red} onChange={(v) => setF({ ...f, red: v })} options={o?.redes ?? []} />
          <FiltroSelect etiqueta="Número" ancho={180} value={f.canal} onChange={(v) => setF({ ...f, canal: v })} options={o?.canales ?? []} />
          <FiltroSelect etiqueta="Anuncio" ancho={160} value={f.anuncio} onChange={(v) => setF({ ...f, anuncio: v })} options={[{ value: "1", label: "Con anuncio" }, { value: "0", label: "Orgánico" }]} />
          <FiltroSelect etiqueta="Vendedora" todos="todas" ancho={190} value={f.vendedora} onChange={(v) => setF({ ...f, vendedora: v })} options={o?.vendedoras ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {abierto && lista && <FichaLead id={abierto} lista={lista} onClose={() => setAbierto(null)} onCambio={cargar} />}
      {nuevo && lista && <NuevoLead lista={lista} onClose={() => setNuevo(false)} onListo={(id) => { setNuevo(false); cargar(); setAbierto(id); }} />}
    </div>
  );
}

function FichaLead({ id, lista, onClose, onCambio }: { id: string; lista: Lista; onClose: () => void; onCambio: () => void }) {
  const [l, setL] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [perder, setPerder] = useState({ abierto: false, motivo: "", nota: "" });
  useEffect(() => {
    let vivo = true;
    api<Ficha>(`/v1/crm/leads/${id}`).then((r) => vivo && setL(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);
  async function estado(e: string, extra: Record<string, unknown> = {}) {
    try {
      setL(await api<Ficha>(`/v1/crm/leads/${id}/estado`, { method: "POST", body: { estado: e, ...extra } }));
      toast.ok("Lead actualizado");
      setPerder({ abierto: false, motivo: "", nota: "" });
      onCambio();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const abiertoAEditar = l && lista.puede && l.status !== "WON";
  return (
    <Modal open onClose={onClose} size="lg" title={l?.full_name ?? "Lead"} description={l ? `${l.source_name}${l.canal ? ` · ${l.canal}` : ""} · ${l.marca}` : undefined}
      footer={abiertoAEditar ? (
        <>
          {l.status !== "DISCARDED" && <Button variant="ghost" onClick={() => estado("DISCARDED")}>Descartar</Button>}
          {l.status !== "LOST" && <Button variant="ghost" onClick={() => setPerder({ ...perder, abierto: true })}>Marcar perdido</Button>}
          {l.status !== "QUALIFIED" && <Button variant="primary" onClick={() => estado("QUALIFIED")}>Calificado</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {l && (
        <div className="grid gap-4">
          <DetailList items={[
            { label: "Estado", value: <StatusBadge status={l.status} labels={ESTADOS} /> }, { label: "Celular", value: l.phone ?? "—" },
            { label: "Anuncio", value: l.ad_code ?? "Orgánico" }, { label: "Vendedora", value: l.vendedora ?? "—" },
            { label: "Primer contacto", value: fechaHora(l.first_contact_at) }, { label: "Primera respuesta", value: l.first_response_at ? fechaHora(l.first_response_at) : "—" },
            { label: "Pedido", value: l.pedido ? `${l.pedido} · ${fechaHora(l.converted_at!)}` : "—" }, { label: "Motivo de pérdida", value: l.lost_name ?? "—" },
            { label: "Notas", value: l.notes ?? "—" },
          ]} />
          {l.status === "WON" && <Alert tone="ok">Ganado con su pedido: ya es cliente y no cambia de estado.</Alert>}
          {l.conversacion && <Link href={`/m/crm/crm-02?id=${l.conversacion}`} className="inline-flex w-fit items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Abrir el chat</Link>}
          {perder.abierto && (
            <div className="grid gap-2 rounded-lg border border-line p-3">
              <Field label="Motivo"><Select value={perder.motivo} onChange={(e) => setPerder({ ...perder, motivo: e.target.value })} placeholder="Elige el motivo" options={lista.opciones.motivos} /></Field>
              <Field label="Nota (opcional)"><Input maxLength={500} value={perder.nota} onChange={(e) => setPerder({ ...perder, nota: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPerder({ abierto: false, motivo: "", nota: "" })}>Cancelar</Button>
                <Button variant="danger" disabled={!perder.motivo} onClick={() => estado("LOST", { motivo: perder.motivo, nota: perder.nota || null })}>Marcar perdido</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function NuevoLead({ lista, onClose, onListo }: { lista: Lista; onClose: () => void; onListo: (id: string) => void }) {
  const [d, setD] = useState({ full_name: "", phone: "", brand_id: lista.opciones.marcas[0]?.value ?? "", source: "PHONE", notes: "" });
  return (
    <Dialogo titulo="Nuevo lead" boton="Crear lead" onClose={onClose} aviso="Para quien llama, visita el local o llega referido. Un número que ya es cliente no es lead."
      enviar={async () => {
        const r = await api<Ficha>("/v1/crm/leads", { method: "POST", body: { ...d, notes: d.notes || null } });
        toast.ok("Lead creado");
        onListo(r.id);
      }}>
      {(errores) => (
        <>
          <Field label="Nombre" required error={errores.full_name}><Input maxLength={120} value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
          <Field label="Celular" required error={errores.phone} hint="9 dígitos o con +51."><Input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
          <Field label="Marca" required error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} options={lista.opciones.marcas} /></Field>
          <Field label="Origen" required error={errores.source}><Select value={d.source} onChange={(e) => setD({ ...d, source: e.target.value })} options={lista.opciones.manuales} /></Field>
          <Field label="Notas" error={errores.notes} className="sm:col-span-2"><Textarea rows={3} maxLength={2000} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </>
      )}
    </Dialogo>
  );
}

export default function Page() {
  return <Suspense><Leads /></Suspense>;
}
