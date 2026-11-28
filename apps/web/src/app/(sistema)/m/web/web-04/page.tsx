"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, FlaskConical, Inbox, MapPinOff, Repeat, Send } from "lucide-react";
import {
  Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column,
} from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { moduloPorCodigo, pantallaVisible } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FichaBandeja } from "@/modulos/web/FichaBandeja";
import { ESTADO_BANDEJA, ESTADO_PAGO, ORIGEN_BANDEJA, cuando, useDatos, type TiendaCorta } from "@/modulos/web/comunes";

type Fila = {
  id: string; store_id: string; tienda: string; external_order_id: string; received_at: string; source: string; status: string; total: number; customer_name: string | null;
  customer_id: string | null; order_ids: string[]; attempts: number; auto_attempts: number; manual_only: boolean; duplicates: number; poll_hits: number;
  error_code: string | null; error_detail: string | null; warning_code: string | null; missing: string[] | null; ignore_reason: string | null; medio_web: string | null;
  pedidos: string | null; pago: string | null; pagos: number;
};
type Resumen = {
  cifras: { hoy: number; sin_intervencion: number | null; recibidos_mes: number; con_error: number; sin_pin: number; reenvios_mes: number; reintentos_max: number };
  tiendas: TiendaCorta[]; estados: Record<string, string>; errores: Record<string, string>; plantillas: Record<string, string>; puede_resolver: boolean; puede_simular: boolean;
};

/** WEB-04 Bandeja de pedidos web: cada pedido de WooCommerce tal como llegó, qué pedido creó y por qué no. */
export default function Bandeja() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const params = useSearchParams();
  const [f, setF] = useState({ store: "", estado: params.get("estado") ?? "", origen: "", error: "", sin_pin: params.get("sin_pin") ?? "", dia: "" });
  const [simulando, setSimulando] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const { me } = useSesion();
  const w05 = moduloPorCodigo("WEB")?.screens.find((p) => p.code === "WEB-05");
  const veResolver = Boolean(w05 && pantallaVisible("WEB", w05, me.roles));
  const lista = useListado<Fila>("/v1/web/bandeja", { filtros: f });
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>("/v1/web/bandeja?per_page=1");
  const recargar = () => { lista.recargar(); recargarResumen(); };
  const c = r?.cifras;
  const poner = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const columnas: Column<Fila>[] = [
    { key: "external_order_id", header: "Pedido web", sortable: true, cardTitle: true, render: (b) => (
      <div className="min-w-0">
        <div className="font-medium">#{b.external_order_id}</div>
        <div className="text-[12px] text-muted">{cuando(b.received_at)} · {ORIGEN_BANDEJA[b.source] ?? b.source}{(r?.tiendas.length ?? 0) > 1 ? ` · ${b.tienda}` : ""}</div>
      </div>
    ) },
    { key: "customer_name", header: "Cliente", sortable: true, render: (b) => <span className="truncate">{b.customer_name ?? "—"}</span> },
    { key: "total", header: "Total", sortable: true, align: "right", render: (b) => <span className="tabular-nums">{soles(b.total)}</span> },
    { key: "pedidos", header: "Pedido creado", render: (b) => b.pedidos
      ? <span className="text-[13px]">{b.pedidos}</span>
      : <span className="text-[13px] text-muted">{b.status === "IGNORED" ? "Ignorado" : "Ninguno"}</span> },
    { key: "pago", header: "Pago", hideOnMobile: true, render: (b) => b.pago ? <StatusBadge status={b.pago} labels={ESTADO_PAGO} /> : <span className="text-[12.5px] text-muted">Sin pago</span> },
    { key: "status", header: "Estado", sortable: true, render: (b) => (
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={b.status} labels={ESTADO_BANDEJA} />
        {b.error_code && <Badge tone="bad">{r?.errores[b.error_code] ?? b.error_code}</Badge>}
        {b.warning_code === "ADDRESS_NO_PIN" && <Badge tone="warn">Sin pin</Badge>}
        {b.duplicates > 0 && <Badge tone="neutral">{b.duplicates} reenvío{b.duplicates === 1 ? "" : "s"}</Badge>}
      </div>
    ) },
  ];

  // Quien no tiene WEB-05 (la vendedora) ve el detalle aquí mismo y completa el pin.
  const abrir = (b: Fila) => (veResolver ? router.push(`/m/web/web-05?id=${b.id}`) : setPanel(b.id));

  return (
    <div className="space-y-5">
      <PageHeader description="Cada pedido que llega de la web por webhook o por la consulta de respaldo. Un pedido web crea su pedido una sola vez aunque WooCommerce lo reenvíe (RN-WEB-02); los que fallan se reintentan solos y, si no, se resuelven aquí."
        actions={r?.puede_simular ? <Button icon={FlaskConical} onClick={() => setSimulando(true)}>Simular pedido</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Recibidos hoy" icono={Inbox} destacada valor={c ? numero(c.hoy) : undefined} detalle={c ? `${numero(c.recibidos_mes)} en el mes` : undefined} />
        <Cifra titulo="Sin intervención" icono={CheckCircle2} tono={c?.sin_intervencion !== null && c?.sin_intervencion !== undefined && c.sin_intervencion < 95 ? "warn" : undefined}
          valor={c ? (c.sin_intervencion === null ? "—" : porcentaje(c.sin_intervencion, 1)) : undefined} detalle="del mes · meta 95 %" />
        <Cifra titulo="Con error" icono={AlertTriangle} tono={c && c.con_error > 0 ? "bad" : undefined} valor={c ? numero(c.con_error) : undefined}
          detalle={c ? `se reintentan hasta ${c.reintentos_max} veces` : undefined} />
        <Cifra titulo="Sin pin" icono={MapPinOff} tono={c && c.sin_pin > 0 ? "warn" : undefined} valor={c ? numero(c.sin_pin) : undefined}
          detalle="dirección por ubicar" />
      </div>
      {c && c.con_error > 0 && f.estado !== "ERROR" && (
        <Alert tone="bad" title={`${c.con_error} pedido${c.con_error === 1 ? "" : "s"} web con error`}>
          No crearon su pedido. <button type="button" className="cursor-pointer font-medium underline" onClick={() => setF((x) => ({ ...x, estado: "ERROR" }))}>Ver solo los que tienen error</button>
          {veResolver && <>{" "}o ábrelos en <Link className="font-medium underline" href="/m/web/web-05">Resolver error</Link></>}.
        </Alert>
      )}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={abrir} empty="No hay pedidos web con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "N.º de pedido, cliente o celular…" }}
        toolbar={<>
          {(r?.tiendas.length ?? 0) > 1 && <FiltroSelect etiqueta="Tienda" todos="todas" value={f.store} onChange={poner("store")} options={(r?.tiendas ?? []).map((s) => ({ value: s.id, label: s.name }))} ancho={200} />}
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={poner("estado")} options={Object.entries(ESTADO_BANDEJA).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Error" value={f.error} onChange={poner("error")} options={Object.entries(r?.errores ?? {}).map(([value, label]) => ({ value, label }))} ancho={190} />
          <FiltroSelect etiqueta="Origen" value={f.origen} onChange={poner("origen")} options={Object.entries(ORIGEN_BANDEJA).map(([value, label]) => ({ value, label }))} ancho={190} />
          <FiltroSelect etiqueta="Pin" value={f.sin_pin} onChange={poner("sin_pin")} vacio="Con y sin pin" options={[{ value: "1", label: "Solo sin pin" }]} />
          <FiltroFecha etiqueta="Día de llegada" value={f.dia} onChange={poner("dia")} visible />
        </>} />
      {panel && (
        <Modal open onClose={() => { setPanel(null); recargar(); }} size="xl" title="Pedido web" footer={<Button variant="primary" onClick={() => { setPanel(null); recargar(); }}>Cerrar</Button>}>
          <FichaBandeja id={panel} enPanel />
        </Modal>
      )}
      {simulando && r && <Simulador tiendas={r.tiendas} plantillas={r.plantillas} onClose={() => setSimulando(false)} onListo={recargar} />}
    </div>
  );
}

type Resultado = {
  respuestas: { envio: number; http: number; status: string; duplicate: boolean }[];
  inbox: { id: string; status: string; error_code: string | null; external_order_id: string; duplicates: number; pedidos: string[] } | null;
};

/** Simulador (solo conectores de prueba): manda el webhook firmado por el receptor de Integraciones, como WooCommerce. */
function Simulador({ tiendas, plantillas, onClose, onListo }: { tiendas: TiendaCorta[]; plantillas: Record<string, string>; onClose: () => void; onListo: () => void }) {
  const prueba = tiendas.find((t) => t.status === "TESTING") ?? tiendas[0];
  const [d, setD] = useState({ store_id: prueba?.id ?? "", plantilla: "normal", payload: "", veces: "1", delivery_id: "", mismo_envio: false, firma_valida: true });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [trabajando, setTrabajando] = useState<"" | "ejemplo" | "enviar">("");
  const [res, setRes] = useState<Resultado | null>(null);

  async function ejemplo() {
    setTrabajando("ejemplo");
    setGeneral("");
    try {
      const p = await api<Record<string, unknown>>(`/v1/web/bandeja/ejemplo?store_id=${d.store_id}&plantilla=${d.plantilla}`);
      setD((x) => ({ ...x, payload: JSON.stringify(p, null, 2) }));
    } catch (e) {
      setGeneral(mensajeDe(e));
    } finally {
      setTrabajando("");
    }
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    let payload: unknown;
    try { payload = JSON.parse(d.payload); } catch { setErrores({ payload: "No es un JSON válido." }); return; }
    setTrabajando("enviar");
    setErrores({});
    setGeneral("");
    try {
      const x = await api<Resultado>("/v1/web/bandeja/simular", { method: "POST", body: {
        store_id: d.store_id, payload, veces: Number(d.veces), delivery_id: d.delivery_id || null, mismo_envio: d.mismo_envio, firma_valida: d.firma_valida,
      } });
      setRes(x);
      onListo();
      toast.info(x.inbox ? `Pedido web #${x.inbox.external_order_id}: ${ESTADO_BANDEJA[x.inbox.status]?.[0] ?? x.inbox.status}` : "Enviado.");
    } catch (err) {
      setErrores(erroresDe(err));
      setGeneral(mensajeDe(err));
    } finally {
      setTrabajando("");
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Simular pedido de WooCommerce" dismissable={!trabajando}
      description="Solo con conectores de prueba. El cuerpo se firma con el secreto del webhook y entra por el receptor de Integraciones, igual que uno real."
      footer={<>
        <Button onClick={onClose} disabled={Boolean(trabajando)}>Cerrar</Button>
        <Button variant="primary" type="submit" form="f-simular" icon={Send} loading={trabajando === "enviar"} disabled={!d.payload || Boolean(trabajando)}>Enviar</Button>
      </>}>
      <form id="f-simular" onSubmit={enviar} className="space-y-3">
        {general && <Alert tone="bad">{general}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tienda" required error={errores.store_id}>
            <Select value={d.store_id} onChange={(e) => setD((x) => ({ ...x, store_id: e.target.value, payload: "" }))} options={tiendas.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <Field label="Plantilla">
            <Select value={d.plantilla} onChange={(e) => setD((x) => ({ ...x, plantilla: e.target.value }))} options={Object.entries(plantillas).map(([value, label]) => ({ value, label }))} />
          </Field>
        </div>
        <Button size="sm" icon={FlaskConical} loading={trabajando === "ejemplo"} disabled={!d.store_id || Boolean(trabajando)} onClick={ejemplo}>
          {d.payload ? "Generar otro ejemplo" : "Generar ejemplo"}
        </Button>
        <Field label="Cuerpo del webhook (JSON)" required error={errores.payload} hint="Puedes editarlo antes de enviarlo.">
          <Textarea value={d.payload} onChange={(e) => setD((x) => ({ ...x, payload: e.target.value }))} rows={9} className="font-mono text-[12px]" spellCheck={false} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Envíos" hint="WooCommerce reintenta si no respondemos; 0 = el webhook se perdió y lo encuentra la consulta de respaldo." error={errores.veces}>
            <Select value={d.veces} onChange={(e) => setD((x) => ({ ...x, veces: e.target.value }))}
              options={["0", "1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v === "0" ? "Ninguno (webhook perdido)" : `${v} envío${v === "1" ? "" : "s"}` }))} />
          </Field>
          <Field label="Id de entrega" hint="Opcional: x-wc-webhook-delivery-id" error={errores.delivery_id}>
            <Input value={d.delivery_id} onChange={(e) => setD((x) => ({ ...x, delivery_id: e.target.value }))} maxLength={80} />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox checked={d.mismo_envio} onChange={(v) => setD((x) => ({ ...x, mismo_envio: v }))} label="Repetir el mismo id de entrega en cada envío" />
          <Checkbox checked={!d.firma_valida} onChange={(v) => setD((x) => ({ ...x, firma_valida: !v }))} label="Mandar con firma inválida (debe rechazarse)" />
        </div>
        {res && (
          <div className="space-y-2 rounded-lg border border-line p-3 text-[13px]">
            {res.respuestas.length === 0 && <p className="text-muted">Sin envíos: el pedido quedó solo en WooCommerce. Córrelo con «Pedidos» en Sincronización.</p>}
            {res.respuestas.map((x) => (
              <div key={x.envio} className="flex items-center gap-2">
                <Repeat size={14} className="text-muted" aria-hidden="true" />
                Envío {x.envio}: HTTP {x.http} · {x.status || "—"}{x.duplicate ? " · repetido, no se procesa de nuevo" : ""}
              </div>
            ))}
            {res.inbox ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className="font-medium">#{res.inbox.external_order_id}</span>
                <StatusBadge status={res.inbox.status} labels={ESTADO_BANDEJA} />
                {res.inbox.error_code && <Badge tone="bad">{res.inbox.error_code}</Badge>}
                <span className="text-muted">{res.inbox.pedidos.length ? `Pedido ${res.inbox.pedidos.join(", ")}` : "Sin pedido"}</span>
                <Link className="font-medium text-primary underline" href={`/m/web/web-05?id=${res.inbox.id}`}>Abrir</Link>
              </div>
            ) : res.respuestas.length > 0 && <p className="text-muted">No entró a la bandeja.</p>}
          </div>
        )}
      </form>
    </Modal>
  );
}
