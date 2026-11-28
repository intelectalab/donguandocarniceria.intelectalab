"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Copy, Radio, RotateCcw, XCircle } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, FiltroFecha, FiltroSelect, Modal, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Crudo, ESTADO_BANDEJA, ESTADO_EVENTO, ESTADO_PAGO, Vacio, cuando, useDatos } from "@/modulos/web/comunes";

type Fila = {
  id: string; received_at: string; event_key: string; status: string; http_status: number | null; duplicates: number; attempts: number; processed_at: string | null;
  result: string | null; last_error: string | null; provider: string; conector: string; environment: string; segundos: string | null; referencia: string | null; proveedor_nombre: string;
};
type Resumen = { cifras: { hoy: number; fallidos: number; rechazados: number; repetidos: number }; proveedores: Record<string, string> };
type Detalle = {
  id: string; received_at: string; connector_name: string; endpoint_name: string; event_key: string; duplicates: number; attempts: number; processed_at: string | null;
  segundos: number | null; status: string; http_status: number | null; last_error: string | null; result: string | null; headers: unknown; body: unknown; ack_ms: number | null;
  failed_at: string | null; last_duplicate_at: string | null; max_intentos: number; ack_segundos: number;
  bandeja: { id: string; external_order_id: string; status: string } | null; pago: { id: string; external_payment_id: string; status: string } | null; puede_reprocesar: boolean;
};

/** WEB-07 Eventos webhook: lo que mandaron WooCommerce y Mercado Pago, tal como llegó, y qué se hizo con cada aviso. */
export default function Eventos() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("id");
  const [f, setF] = useState({ proveedor: "", estado: "", dia: "" });
  const [abierto, setAbierto] = useState<string | null>(inicial);
  const lista = useListado<Fila>("/v1/web/eventos", { filtros: f });
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>("/v1/web/eventos?per_page=1");
  const recargar = () => { lista.recargar(); recargarResumen(); };
  const c = r?.cifras;
  const poner = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function cerrar() {
    setAbierto(null);
    if (inicial) router.replace("/m/web/web-07");
  }

  const columnas: Column<Fila>[] = [
    { key: "received_at", header: "Recibido", sortable: true, cardTitle: true, render: (e) => (
      <div className="min-w-0"><div className="font-medium">{e.proveedor_nombre} · {e.referencia ?? e.event_key}</div><div className="text-[12px] text-muted">{cuando(e.received_at)}</div></div>
    ) },
    { key: "conector", header: "Conector", hideOnMobile: true, render: (e) => (
      <div className="min-w-0 text-[13px]"><div className="truncate">{e.conector}</div>{e.environment !== "PRODUCTION" && <Badge tone="info">Prueba</Badge>}</div>
    ) },
    { key: "result", header: "Resultado", render: (e) => (
      <div className="min-w-0 text-[13px]"><div className="line-clamp-2">{e.last_error ?? e.result ?? "—"}</div>
        <div className="text-[12px] text-muted">HTTP {e.http_status ?? "—"}{e.attempts > 1 ? ` · ${e.attempts} intentos` : ""}{e.duplicates ? ` · ${e.duplicates} repetido${e.duplicates === 1 ? "" : "s"}` : ""}</div></div>
    ) },
    { key: "status", header: "Estado", sortable: true, render: (e) => <StatusBadge status={e.status} labels={ESTADO_EVENTO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada aviso entra por el receptor de Integraciones: se guarda tal cual, se valida la firma y se descarta si es repetido; después lo procesa WEB. Un aviso fallido se puede reprocesar sin duplicar nada." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Recibidos hoy" icono={Radio} destacada valor={c ? numero(c.hoy) : undefined} />
        <Cifra titulo="Fallidos" icono={XCircle} tono={c && c.fallidos > 0 ? "bad" : undefined} valor={c ? numero(c.fallidos) : undefined} detalle="no se pudieron procesar" />
        <Cifra titulo="Rechazados" icono={Ban} tono={c && c.rechazados > 0 ? "warn" : undefined} valor={c ? numero(c.rechazados) : undefined} detalle="firma inválida o sin secreto" />
        <Cifra titulo="Repetidos" icono={Copy} valor={c ? numero(c.repetidos) : undefined} detalle="reenvíos descartados" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(e) => setAbierto(e.id)} empty="No hay eventos con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "Clave del evento o referencia…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Proveedor" value={f.proveedor} onChange={poner("proveedor")} options={Object.entries(r?.proveedores ?? {}).map(([value, label]) => ({ value, label }))} ancho={190} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={poner("estado")} options={Object.entries(ESTADO_EVENTO).map(([value, [label]]) => ({ value, label }))} />
          <FiltroFecha etiqueta="Día" value={f.dia} onChange={poner("dia")} visible />
        </>} />
      {abierto && <FichaEvento id={abierto} onClose={cerrar} onCambio={recargar} />}
    </div>
  );
}

function FichaEvento({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const { datos: e, error, recargar } = useDatos<Detalle>(`/v1/web/eventos/${id}`);
  const [trabajando, setTrabajando] = useState(false);

  async function reprocesar() {
    setTrabajando(true);
    try {
      const r = await api<Detalle>(`/v1/web/eventos/${id}/reprocesar`, { method: "POST" });
      if (r.status === "PROCESSED") toast.ok(r.result ?? "Reprocesado."); else toast.error(r.last_error ?? "Sigue sin procesarse.");
      recargar();
      onCambio();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={e ? `Evento ${e.event_key}` : "Evento"} description={e ? `${e.endpoint_name} · ${cuando(e.received_at)}` : undefined}
      footer={<>
        {e?.puede_reprocesar && <Button icon={RotateCcw} loading={trabajando} onClick={reprocesar}>Reprocesar</Button>}
        <Button variant="primary" onClick={onClose}>Cerrar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!e ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={e.status} labels={ESTADO_EVENTO} /><span className="text-[13px] text-muted">HTTP {e.http_status ?? "—"}</span></div>
          {e.last_error && <Alert tone="bad" title="Error">{e.last_error}</Alert>}
          {e.result && !e.last_error && <Alert tone="ok">{e.result}</Alert>}
          <DetailList items={[
            { label: "Conector", value: e.connector_name },
            { label: "Respuesta al proveedor", value: e.ack_ms !== null ? `${e.ack_ms} ms (límite ${e.ack_segundos} s)` : "—" },
            { label: "Procesado", value: e.processed_at ? `${cuando(e.processed_at)}${e.segundos !== null ? ` · ${e.segundos} s después` : ""}` : "—" },
            { label: "Intentos", value: `${e.attempts} de ${e.max_intentos}` },
            { label: "Repetidos", value: e.duplicates ? `${e.duplicates} · último ${cuando(e.last_duplicate_at)}` : "Ninguno" },
            { label: "Pedido web", value: e.bandeja ? <span className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary underline" href={`/m/web/web-05?id=${e.bandeja.id}`}>#{e.bandeja.external_order_id}</Link><StatusBadge status={e.bandeja.status} labels={ESTADO_BANDEJA} /></span> : "—" },
            { label: "Pago", value: e.pago ? <span className="inline-flex flex-wrap items-center gap-2"><Link className="text-primary underline" href={`/m/web/web-06?id=${e.pago.id}`}>{e.pago.external_payment_id}</Link><StatusBadge status={e.pago.status} labels={ESTADO_PAGO} /></span> : "—" },
          ]} />
          <Crudo titulo="Cabeceras" valor={e.headers} />
          <Crudo titulo="Cuerpo recibido" valor={e.body} />
        </div>
      )}
    </Modal>
  );
}
