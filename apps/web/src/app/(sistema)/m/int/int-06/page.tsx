"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, PlayCircle, RotateCcw, Skull } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Input, Modal, PageHeader, Select, Tabs, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { nombreModulo } from "@/modulos/int/tipos";
import { EstadoSaliente, FichaSaliente, type Saliente } from "@/modulos/int/salientes";

type Lista = Pagina<Saliente> & {
  cifras: { pendientes: number; reintentando: number; muertos: number; atendidos: number; exito: number | null; enviados_30: number; base_30: number };
  max_intentos: number; conectores: { id: string; name: string }[]; modulos: string[]; estados: Record<string, string>; tipos: Record<string, string>;
};
type Evento = { id: number; event_name: string; aggregate_type: string | null; aggregate_id: string | null; payload: unknown; user_name: string | null; occurred_at: string };
type ListaEventos = Pagina<Evento> & { eventos: string[] };

const META_EXITO = 99.5;
const pct = (v: number) => `${numero(v, 2)} %`;

/**
 * INT-06 Mensajes salientes: cada efecto externo (mensaje, comprobante, sincronización) se registra junto con el
 * cambio de negocio y se envía después, con reintentos de espera creciente hasta enviarse o caer en la cola muerta.
 */
function Salientes() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "eventos" ? "eventos" : "mensajes";
  const { can, puede } = useSesion();
  const gestiona = Boolean(can("int.outbox.retry")) && puede("INT", "E");
  const [cifras, setCifras] = useState<Lista["cifras"] | null>(null);
  const [vez, setVez] = useState(0);
  const [procesando, setProcesando] = useState(false);

  async function procesar() {
    setProcesando(true);
    try {
      const r = await api<{ procesados: number }>("/v1/int/salientes/procesar", { method: "POST" });
      toast.ok(r.procesados ? `${r.procesados} ${r.procesados === 1 ? "mensaje procesado" : "mensajes procesados"}` : "No había mensajes por enviar");
      setVez((v) => v + 1);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  const c = cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada efecto externo (un WhatsApp, un comprobante al OSE, una sincronización) se registra junto con el cambio de negocio y se envía después. Si falla, se reintenta con una espera que se duplica en cada intento (30 s, 1 min, 2 min… hasta 1 hora). Al agotar los intentos pasa a la cola muerta y avisa a la administración del sistema."
        actions={gestiona ? <Button variant="primary" icon={PlayCircle} loading={procesando} onClick={procesar}>Procesar la cola</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Éxito de entrega" valor={c.exito === null ? "—" : pct(c.exito)} icono={CheckCircle2} destacada
            detalle={c.base_30 ? `${numero(c.enviados_30)} de ${numero(c.base_30)} en 30 días · meta ≥ 99,5 %` : "Sin envíos en 30 días"} />
          <Cifra titulo="Pendientes" valor={numero(c.pendientes)} icono={Clock} detalle="Se envían en el próximo minuto" />
          <Cifra titulo="Reintentando" valor={numero(c.reintentando)} icono={RotateCcw} tono={c.reintentando ? "warn" : undefined} detalle="Esperan su próximo intento" />
          <Link href="/m/int/int-07" className="rounded-xl focus-visible:outline-2 focus-visible:outline-primary" title="Abrir la cola muerta">
            <Cifra titulo="Cola muerta" valor={numero(c.muertos)} icono={Skull} tono={c.muertos ? "bad" : "ok"} detalle={c.muertos ? "Reintenta o cancela con motivo" : "Vacía"} />
          </Link>
        </div>
      )}
      {c && c.exito !== null && c.exito < META_EXITO && (
        <Alert tone="warn" title="El éxito de entrega está debajo de la meta">Revisa los conectores en error y la cola muerta.</Alert>
      )}
      <Tabs value={tab} onChange={(t) => router.replace(t === "eventos" ? "/m/int/int-06?tab=eventos" : "/m/int/int-06", { scroll: false })}
        tabs={[{ key: "mensajes", label: "Mensajes" }, { key: "eventos", label: "Eventos de dominio" }]} />
      {tab === "mensajes" ? <Mensajes gestiona={gestiona} vez={vez} onCifras={setCifras} onCambio={() => setVez((v) => v + 1)} /> : <><Mensajes oculto gestiona={gestiona} vez={vez} onCifras={setCifras} onCambio={() => setVez((v) => v + 1)} /><Eventos /></>}
    </div>
  );
}

function Mensajes({ gestiona, vez, onCifras, onCambio, oculto }: { gestiona: boolean; vez: number; onCifras: (c: Lista["cifras"]) => void; onCambio: () => void; oculto?: boolean }) {
  const router = useRouter();
  const abierto = useSearchParams().get("mensaje");
  const [f, setF] = useState({ status: "", connector: "", module: "", kind: "", dia: "" });
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/int/salientes?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); onCifras(r.cifras); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, onCifras]);
  useEffect(() => cargar(), [cargar, vez]);

  if (oculto) return null;
  const ver = (id: string | null) => router.replace(id ? `/m/int/int-06?mensaje=${id}` : "/m/int/int-06", { scroll: false });
  const espera = (m: Saliente) => ["PENDING", "RETRYING"].includes(m.status);

  const columnas: Column<Saliente>[] = [
    { key: "number", sortable: true, header: "N.º", cardTitle: true, render: (m) => <span className="font-mono font-semibold whitespace-nowrap text-ink">{m.number}</span> },
    { key: "created_at", sortable: true, header: "Creado", render: (m) => <span className="whitespace-nowrap">{fechaHora(m.created_at)}</span> },
    { key: "module", sortable: true, header: "Módulo", hideOnMobile: true, render: (m) => nombreModulo(m.module) },
    { key: "event", sortable: true, header: "Evento", render: (m) => (m.event ? <span className="font-mono text-[12.5px]">{m.event}</span> : <span className="text-muted">—</span>) },
    { key: "kind", sortable: true, header: "Tipo", hideOnMobile: true, render: (m) => <span className="whitespace-nowrap">{m.kind_name}</span> },
    { key: "connector", sortable: true, header: "Conector", render: (m) => m.connector_name },
    { key: "ref", sortable: true, header: "Referencia", hideOnMobile: true, render: (m) => (m.ref ? <span className="font-mono text-[12.5px]">{m.ref}</span> : <span className="text-muted">—</span>) },
    { key: "attempts", sortable: true, header: "Intentos", align: "right", render: (m) => `${m.attempts} de ${lista?.max_intentos ?? 8}` },
    { key: "next_attempt_at", sortable: true, header: "Próximo intento", hideOnMobile: true, render: (m) => (espera(m) && m.next_attempt_at ? <span className="whitespace-nowrap">{fechaHora(m.next_attempt_at)}</span> : <span className="text-muted">—</span>) },
    { key: "status", sortable: true, header: "Estado", render: (m) => <EstadoSaliente status={m.status} /> },
    { key: "last_error", sortable: true, header: "Último error", hideOnMobile: true, render: (m) => (m.last_error ? <span className="text-[12.5px] text-bad">{m.last_error}</span> : <span className="text-muted">—</span>) },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
          options={Object.entries(lista?.estados ?? {}).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Conector" value={f.connector} onChange={(e) => setF({ ...f, connector: e.target.value })} placeholder="Todos los conectores"
          options={(lista?.conectores ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <Select aria-label="Módulo" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} placeholder="Todos los módulos"
          options={(lista?.modulos ?? []).map((x) => ({ value: x, label: nombreModulo(x) }))} />
        <Select aria-label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="Todos los tipos"
          options={Object.entries(lista?.tipos ?? {}).map(([value, label]) => ({ value, label }))} />
        <Input type="date" aria-label="Fecha de creación" title="Fecha de creación" value={f.dia} onChange={(e) => setF({ ...f, dia: e.target.value })} />
      </div>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(m) => ver(m.id)} empty="No hay mensajes con estos filtros." />
      {abierto && <FichaSaliente id={abierto} gestiona={gestiona} onClose={() => ver(null)} onCambio={() => { onCambio(); }} />}
    </div>
  );
}

function Eventos() {
  const [evento, setEvento] = useState("");
  const [lista, setLista] = useState<ListaEventos | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<Evento | null>(null);
  const pag = usePagina(evento);

  const cargar = useCallback(() => {
    api<ListaEventos>(`/v1/int/salientes/eventos?${evento ? `evento=${encodeURIComponent(evento)}&` : ""}${pag.qs}`)
      .then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [evento, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  const columnas: Column<Evento>[] = [
    { key: "occurred_at", sortable: true, header: "Fecha y hora", render: (e) => <span className="whitespace-nowrap">{fechaHora(e.occurred_at)}</span> },
    { key: "event_name", sortable: true, header: "Evento", cardTitle: true, render: (e) => <span className="font-mono text-[12.5px] text-ink">{e.event_name}</span> },
    { key: "user", header: "Usuario", render: (e) => e.user_name ?? <span className="text-muted">Sistema</span> },
    { key: "payload", header: "Datos", hideOnMobile: true, render: (e) => <span className="font-mono text-[12px] text-muted">{JSON.stringify(e.payload).slice(0, 90)}</span> },
    { key: "status", header: "Estado", render: () => <Badge tone="ok" dot>Registrado</Badge> },
  ];

  return (
    <div className="grid gap-4">
      <Alert tone="info">Los eventos que registran los módulos al cambiar algo importante (un pedido confirmado, un conector desactivado, un mensaje en la cola muerta). Son de solo lectura y quedan para la auditoría.</Alert>
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-md">
        <Select aria-label="Evento" value={evento} onChange={(e) => setEvento(e.target.value)} placeholder="Todos los eventos"
          options={(lista?.eventos ?? []).map((x) => ({ value: x, label: x }))} />
      </div>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} rowKey={(e) => String(e.id)} pagination={pag.props(lista)} loading={!lista && !error} error={error}
        onRetry={cargar} onRowClick={setAbierto} empty="Todavía no hay eventos registrados." />
      {abierto && (
        <Modal open onClose={() => setAbierto(null)} title={abierto.event_name} description={fechaHora(abierto.occurred_at)}>
          <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink">{JSON.stringify(abierto.payload, null, 2)}</pre>
        </Modal>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense><Salientes /></Suspense>;
}
