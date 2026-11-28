"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock, FastForward, RefreshCw, RotateCw, Skull } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { EstadoHttp, TONO_ENTREGA, type EntregaWebhook } from "@/modulos/api/comun";

type Opcion = { value: string; label: string };
type Lista = Pagina<EntregaWebhook> & {
  cifras: {
    total: number;
    pendientes: number;
    reintentando: number;
    entregadas: number;
    muertas: number;
    muertas_sin_reenviar: number;
    a_la_primera_pct: number | null;
  };
  opciones: { destinos: Opcion[]; eventos: Opcion[] };
  puede_gestionar: boolean;
  puede_reenviar: boolean;
};

/** API-06 Entregas: historial de entregas de webhooks por destino, evento y estado, con reintentos exponenciales y cola muerta. */
function EntregasDeWebhooksVista() {
  const params = useSearchParams();
  const [f, setF] = useState({
    estado: params.get("estado") || params.get("status") || "",
    destino: params.get("destino") || params.get("endpoint") || "",
    evento: "",
    fecha: "",
    buscar: "",
  });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [procesando, setProcesando] = useState(false);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/api/entregas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setRes(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function procesar(all: boolean) {
    setProcesando(true);
    try {
      const r = await api<{ procesadas: number }>("/v1/api/entregas/procesar", {
        method: "POST",
        body: { all, endpoint: f.destino || null },
      });
      toast.ok(r.procesadas ? `${r.procesadas} intento(s) realizados` : "Nada pendiente para procesar a esta hora");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  const c = res?.cifras;
  const cols: Column<EntregaWebhook>[] = [
    {
      key: "number", header: "Entrega", cardTitle: true,
      render: (d) => (
        <div>
          <Link href={`/m/api/api-07?id=${d.id}`} className="font-mono font-semibold text-ink hover:text-primary">{d.number}</Link>
          {d.resent_from_number && <p className="text-[11.5px] text-muted">reenvío de {d.resent_from_number}</p>}
          {d.is_test && <p className="text-[11.5px] text-muted">prueba</p>}
        </div>
      ),
    },
    { key: "created_at", header: "Creada", render: (d) => fechaHora(d.created_at) },
    { key: "endpoint_name", header: "Destino", render: (d) => <span className="font-medium text-ink">{d.endpoint_name}</span> },
    {
      key: "event_type", header: "Evento",
      render: (d) => (
        <div>
          <span className="font-mono text-[12px] text-ink">{d.event_type}</span>
          <p className="font-mono text-[11px] text-muted">{d.event_id.slice(0, 20)}…</p>
        </div>
      ),
    },
    { key: "attempts", header: "Intentos", align: "right", render: (d) => `${d.attempts} / ${d.max_attempts}` },
    {
      key: "last_http", header: "Última respuesta",
      render: (d) => d.attempts > 0 ? (
        <div className="grid gap-0.5">
          <div><EstadoHttp s={d.last_http} /></div>
          {d.last_error && d.status !== "DELIVERED" && <p className="max-w-[240px] truncate text-[11.5px] text-bad" title={d.last_error}>{d.last_error}</p>}
        </div>
      ) : <span className="text-muted">—</span>,
    },
    {
      key: "next_attempt_at", header: "Siguiente intento", hideOnMobile: true,
      render: (d) => ["PENDING", "RETRYING"].includes(d.status) && d.next_attempt_at
        ? fechaHora(d.next_attempt_at)
        : d.status === "DELIVERED" && d.delivered_at
          ? `Entregado ${fechaHora(d.delivered_at)}`
          : d.resent_to_number
            ? `Reenviada (${d.resent_to_number})`
            : "—",
    },
    { key: "status", header: "Estado", render: (d) => <Badge tone={TONO_ENTREGA[d.status]}>{d.estado}</Badge> },
  ];

  const destinoActivoNombre = f.destino ? res?.opciones.destinos.find((x) => x.value === f.destino)?.label : null;

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Historial de entregas por destino, evento y estado. Los reintentos esperan 1, 5, 30, 120, 360, 720 y 1440 minutos; al octavo intento fallido la entrega pasa a la cola muerta."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" icon={RefreshCw} loading={procesando} onClick={() => procesar(false)}>Procesar vencidas ahora</Button>
            <Button variant="ghost" icon={FastForward} loading={procesando} onClick={() => procesar(true)}>Adelantar al siguiente reintento</Button>
          </div>
        }
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="Pendientes" valor={numero(c.pendientes)} icono={Clock} />
          <Cifra titulo="Reintentando" valor={numero(c.reintentando)} icono={RotateCw} tono={c.reintentando ? "warn" : undefined} />
          <Cifra titulo="Entregadas" valor={numero(c.entregadas)} icono={CheckCircle2} destacada />
          <Cifra titulo="Cola muerta" valor={numero(c.muertas)} icono={Skull} tono={c.muertas ? "bad" : "ok"} detalle={`${numero(c.muertas_sin_reenviar)} sin reenviar`} />
          <Cifra titulo="A la primera (30 d)" valor={c.a_la_primera_pct === null ? "—" : porcentaje(c.a_la_primera_pct, 1)} icono={CheckCircle2} />
        </div>
      )}
      {destinoActivoNombre && (
        <Alert tone="info">
          Filtrado por el destino <strong>{destinoActivoNombre}</strong>.{" "}
          <button type="button" onClick={() => setF({ ...f, destino: "" })} className="cursor-pointer font-semibold underline">Ver todas las entregas</button>
        </Alert>
      )}
      <DataTable
        rowKey={(d) => d.id}
        columns={cols}
        rows={res?.data ?? []}
        loading={!res && !error}
        empty="No hay entregas para los filtros seleccionados."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por número, event_id, evento o destino…" }}
        pagination={pag.props(res)}
        toolbar={
          <>
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={165} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "PENDING", label: "Pendiente" }, { value: "RETRYING", label: "Reintentando" }, { value: "DELIVERED", label: "Entregado" }, { value: "DEAD", label: "Cola muerta" }]} />
            <FiltroSelect etiqueta="Destino" todos="todos" ancho={230} value={f.destino} onChange={(v) => setF({ ...f, destino: v })}
              options={res?.opciones.destinos ?? []} />
            <FiltroSelect etiqueta="Evento" todos="todos" ancho={190} value={f.evento} onChange={(v) => setF({ ...f, evento: v })}
              options={res?.opciones.eventos ?? []} />
            <FiltroFecha etiqueta="Fecha" value={f.fecha} onChange={(v) => setF({ ...f, fecha: v })} />
          </>
        }
      />
    </div>
  );
}

export default function EntregasDeWebhooks() {
  return <Suspense><EntregasDeWebhooksVista /></Suspense>;
}
