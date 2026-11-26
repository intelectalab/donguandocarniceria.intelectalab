"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, MessageCircle, Plug, Plus, Share2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";

type Opcion = { value: string; label: string };
type Canal = {
  id: string; kind: string; kind_name: string; display_name: string; number: string; brand_id: string; brand_name: string; connection_mode: string; connection_name: string;
  free_service_quota: number; usadas: number | null; quality_rating: string | null; quality_name: string | null; assignment_mode: string; assignment_name: string;
  status: string; status_name: string; miembros: number; connector_id: string | null; connector_code: string | null; connector_status: string | null;
  connector_environment: string | null; coexistence: boolean;
};
type Ficha = Canal & {
  auto_greeting: string | null; recording_notice_text: string | null; external_id: string | null; waba_id: string | null; synced_history_from: string | null;
  connected_at: string | null; group_msgs_discarded: number; messaging_limit: number | null; connector_last_ok_at: string | null; connector_last_error: string | null;
  conversaciones_abiertas: number;
};
type Opciones = { redes: Opcion[]; conexiones: Opcion[]; por_red: Record<string, string[]>; asignacion: Opcion[]; estados: Opcion[]; marcas: Opcion[] };
type Lista = Pagina<Canal> & {
  cifras: { whatsapp: number; whatsapp_total: number; coexistencia: number; redes: number; redes_total: number; usadas: number; cuota: number; calidad_baja: number };
  mes: string; meses: Opcion[]; opciones: Opciones; conectores: (Opcion & { provider: string; libre: boolean })[]; puede: boolean;
};

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], PAUSED: ["Pausado", "warn"], DISCONNECTED: ["Desconectado", "bad"] };
const PROVEEDOR: Record<string, string> = { WHATSAPP: "WHATSAPP_CLOUD", MESSENGER: "META_MESSAGING", INSTAGRAM: "META_MESSAGING", TIKTOK: "TIKTOK" };
const SIN_CONECTOR = ["APP_ONLY", "NOT_AVAILABLE"];

function Red({ c }: { c: Pick<Canal, "kind" | "kind_name"> }) {
  const tono: Record<string, string> = { WHATSAPP: "bg-[#25D366]/15 text-[#1DAA55]", MESSENGER: "bg-[#3B82F6]/15 text-[#3B82F6]", INSTAGRAM: "bg-[#E1306C]/15 text-[#E1306C]", TIKTOK: "bg-ink/10 text-ink" };
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-[11.5px] font-semibold ${tono[c.kind] ?? "bg-surface-2 text-ink"}`}>{c.kind_name}</span>;
}

function Uso({ c }: { c: Canal }) {
  if (c.usadas === null) return <span className="text-muted">—</span>;
  const pct = Math.min(100, (c.usadas / Math.max(1, c.free_service_quota)) * 100);
  return (
    <div className="min-w-[130px]">
      <p className="text-[12px] tabular-nums">{numero(c.usadas)} de {numero(c.free_service_quota)}</p>
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

/**
 * CRM-07 Números y cuentas: cada número de WhatsApp o cuenta de red se conecta una sola vez por la API oficial (con
 * coexistencia, el número sigue en la app del celular). Las credenciales están en Integraciones.
 */
export default function NumerosYCuentas() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.channel.manage") || can("crm.conversation.view_all"));
  const [f, setF] = useState({ red: "", marca: "", estado: "", mes: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [editar, setEditar] = useState<Ficha | "nuevo" | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/canales?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta los números y cuentas.</Alert>;

  const columnas: Column<Canal>[] = [
    { key: "kind_name", sortable: true, header: "Red", render: (c) => <Red c={c} /> },
    { key: "display_name", sortable: true, header: "Nombre", cardTitle: true, render: (c) => <span className="inline-block min-w-[140px] font-semibold text-ink">{c.display_name}</span> },
    { key: "number", sortable: true, header: "Número o cuenta", render: (c) => <span className="whitespace-nowrap font-mono text-[12.5px]">{c.number}</span> },
    { key: "brand_name", sortable: true, header: "Marca", render: (c) => <span className="text-[12.5px]">{c.brand_name}</span> },
    { key: "connection_name", sortable: true, header: "Conexión", render: (c) => (
      <Badge tone={c.connection_mode === "NOT_AVAILABLE" ? "warn" : c.connection_mode === "APP_ONLY" ? "neutral" : "ok"} dot>{c.connection_name}</Badge>
    ) },
    { key: "usadas", sortable: true, header: "Respuestas gratis usadas", render: (c) => <Uso c={c} /> },
    { key: "quality_rating", sortable: true, header: "Calidad", hideOnMobile: true, render: (c) => (c.quality_name ? <Badge tone={c.quality_rating === "HIGH" ? "ok" : "warn"}>{c.quality_name}</Badge> : <span className="text-muted">—</span>) },
    { key: "assignment_name", sortable: true, header: "Asignación", hideOnMobile: true, render: (c) => <span className="text-[12.5px]">{c.assignment_name}</span> },
    { key: "status_name", sortable: true, header: "Estado", render: (c) => <StatusBadge status={c.status} labels={ESTADOS} /> },
  ];

  const c = lista?.cifras;
  const mesNombre = lista?.meses.find((m) => m.value === lista.mes)?.label ?? "";
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada número de WhatsApp o cuenta de red se conecta una sola vez por la API oficial. Con coexistencia, el número sigue en la app WhatsApp Business del celular y se sincronizan 6 meses de historial. No hay conexión por QR de WhatsApp Web. Las credenciales las carga el administrador en Integraciones y las vendedoras nunca las ven."
        actions={lista?.puede ? <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Conectar número o cuenta</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Números de WhatsApp" valor={`${c.whatsapp} de ${c.whatsapp_total}`} icono={MessageCircle} destacada detalle={`${c.coexistencia} con coexistencia`} />
          <Cifra titulo="Redes sociales" valor={`${c.redes} de ${c.redes_total}`} icono={Share2} detalle="Messenger, Instagram y TikTok activas" />
          <Cifra titulo="Respuestas gratis usadas" valor={numero(c.usadas)} icono={Gauge} tono={c.cuota && c.usadas >= c.cuota * 0.8 ? "warn" : undefined} detalle={`De ${numero(c.cuota)} · ${mesNombre}`} />
          <Cifra titulo="Calidad media o baja" valor={numero(c.calidad_baja)} icono={Plug} tono={c.calidad_baja ? "warn" : "ok"} detalle={c.calidad_baja ? "Revisa sus mensajes" : "Todos en calidad alta"} />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(x) => setAbierto(x.id)} empty="Ningún número o cuenta con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar nombre, número o marca…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Red" todos="todas" ancho={150} value={f.red} onChange={(v) => setF({ ...f, red: v })} options={lista?.opciones.redes ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={190} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={lista?.opciones.marcas ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={lista?.opciones.estados ?? []} />
          <FiltroSelect etiqueta="Mes" ancho={190} vacio={mesNombre ? `Uso de ${mesNombre.toLowerCase()}` : "Mes con uso"} value={f.mes} onChange={(v) => setF({ ...f, mes: v })} options={lista?.meses ?? []} />
        </>} />
      {abierto && lista && <FichaCanal id={abierto} puede={lista.puede} onClose={() => setAbierto(null)} onEditar={(x) => { setAbierto(null); setEditar(x); }} />}
      {editar && lista && <EditarCanal canal={editar === "nuevo" ? null : editar} lista={lista} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

function FichaCanal({ id, puede, onClose, onEditar }: { id: string; puede: boolean; onClose: () => void; onEditar: (c: Ficha) => void }) {
  const [c, setC] = useState<Ficha | null>(null);
  const [error, setError] = useState("");
  const [probando, setProbando] = useState(false);
  useEffect(() => {
    let vivo = true;
    api<Ficha>(`/v1/crm/canales/${id}`).then((r) => vivo && setC(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);

  async function probar() {
    setProbando(true);
    try {
      const r = await api<{ ok: boolean; mensaje: string }>(`/v1/crm/canales/${id}/probar`, { method: "POST" });
      if (r.ok) toast.ok(r.mensaje); else toast.info(r.mensaje);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProbando(false);
    }
  }

  const wa = c?.kind === "WHATSAPP";
  return (
    <Modal open onClose={onClose} size="lg" title={c ? c.display_name : "Número"} description={c ? `${c.kind_name} · ${c.number}` : undefined}
      footer={c ? (
        <>
          {puede && <Button variant="ghost" disabled={probando} onClick={probar}>{probando ? "Probando…" : "Probar conexión"}</Button>}
          {puede && <Button variant="primary" onClick={() => onEditar(c)}>Editar</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid gap-4">
          <DetailList items={[
            { label: "Marca", value: c.brand_name }, { label: "Estado", value: <StatusBadge status={c.status} labels={ESTADOS} /> },
            { label: "Conexión", value: c.connection_name },
            { label: "Conector en Integraciones", value: c.connector_code ? `${c.connector_code}${c.connector_environment === "SANDBOX" ? " (prueba)" : ""}` : "Sin conector" },
            { label: "Asignación de chats", value: c.assignment_name }, { label: "Miembros", value: `${c.miembros} · ${c.conversaciones_abiertas} chats abiertos` },
            ...(wa ? [
              { label: "Respuestas gratis este mes", value: `${numero(c.usadas ?? 0)} de ${numero(c.free_service_quota)}` },
              { label: "Calidad en Meta", value: c.quality_name ?? "—" },
              { label: "Límite de mensajería", value: c.messaging_limit ? `${numero(c.messaging_limit)} contactos por día` : "—" },
              { label: "Historial sincronizado desde", value: fecha(c.synced_history_from) },
              { label: "Mensajes de grupo descartados", value: `${numero(c.group_msgs_discarded)} (los grupos no se sincronizan)` },
              { label: "Cuenta de WhatsApp Business", value: c.waba_id ? <span className="font-mono text-[12px]">{c.waba_id}</span> : "—" },
            ] : []),
            { label: "Conectado", value: c.connected_at ? fechaHora(c.connected_at) : "—" },
            { label: "Credenciales", value: "Guardadas cifradas en Integraciones; las vendedoras nunca las ven" },
          ]} />
          {c.connector_last_error && <Alert tone="warn">Último error del conector: {c.connector_last_error}</Alert>}
          <section className="grid gap-1 rounded-lg border border-line p-3">
            <h3 className="text-[13px] font-semibold text-ink">Saludo automático</h3>
            <p className="text-[13px] text-muted">{c.auto_greeting || "Sin saludo automático."}</p>
          </section>
          <section className="grid gap-1 rounded-lg border border-line p-3">
            <h3 className="text-[13px] font-semibold text-ink">Aviso de registro (Ley 29733)</h3>
            <p className="text-[13px] text-muted">{c.recording_notice_text || "Sin aviso."}</p>
            <p className="text-[11.5px] text-muted">Se envía en el primer mensaje de cada contacto nuevo. Texto provisional: por validar con el abogado de datos personales.</p>
          </section>
        </div>
      )}
    </Modal>
  );
}

function EditarCanal({ canal, lista, onClose, onListo }: { canal: Ficha | null; lista: Lista; onClose: () => void; onListo: () => void }) {
  const o = lista.opciones;
  const [d, setD] = useState({
    kind: canal?.kind ?? "WHATSAPP", number: canal?.number ?? "", display_name: canal?.display_name ?? "", brand_id: canal?.brand_id ?? "",
    connection_mode: canal?.connection_mode ?? "CLOUD_API_COEXISTENCE", connector_id: canal?.connector_id ?? "", assignment_mode: canal?.assignment_mode ?? "SHIFT_ROUND_ROBIN",
    status: canal?.status ?? "ACTIVE", auto_greeting: canal?.auto_greeting ?? "", recording_notice_text: canal?.recording_notice_text ?? "",
  });
  const modos = o.conexiones.filter((x) => (o.por_red[d.kind] ?? []).includes(x.value));
  const conectores = lista.conectores.filter((x) => x.provider === PROVEEDOR[d.kind] && (x.libre || x.value === canal?.connector_id));
  const usaConector = !SIN_CONECTOR.includes(d.connection_mode);
  return (
    <Dialogo titulo={canal ? `Editar ${canal.display_name}` : "Conectar número o cuenta"} boton={canal ? "Guardar" : "Conectar"} onClose={onClose}
      aviso={d.kind === "WHATSAPP" ? "Solo por la API oficial (con o sin coexistencia) o «solo app». No hay conexión por QR." : undefined}
      enviar={async () => {
        const body: Record<string, unknown> = { ...d, connector_id: usaConector ? d.connector_id || null : null };
        if (canal) { delete body.kind; delete body.number; }
        await api(canal ? `/v1/crm/canales/${canal.id}` : "/v1/crm/canales", { method: canal ? "PUT" : "POST", body });
        toast.ok(canal ? "Cambios guardados" : "Número conectado");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Red" required error={errores.kind}>
            <Select value={d.kind} disabled={Boolean(canal)} onChange={(e) => { const k = e.target.value; setD({ ...d, kind: k, connection_mode: o.por_red[k]?.[0] ?? "", connector_id: "" }); }} options={o.redes} />
          </Field>
          <Field label={d.kind === "WHATSAPP" ? "Número" : "Cuenta"} required error={errores.number} hint={canal ? "No cambia: otro número se conecta aparte." : d.kind === "WHATSAPP" ? "Formato internacional: +51987650101." : "Por ejemplo @donguando."}>
            <Input value={d.number} disabled={Boolean(canal)} onChange={(e) => setD({ ...d, number: e.target.value })} />
          </Field>
          <Field label="Nombre visible" required error={errores.display_name}><Input maxLength={80} value={d.display_name} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></Field>
          <Field label="Marca" required error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} placeholder="Elige la marca" options={o.marcas} /></Field>
          <Field label="Modo de conexión" required error={errores.connection_mode}>
            <Select value={d.connection_mode} onChange={(e) => setD({ ...d, connection_mode: e.target.value })} options={modos} />
          </Field>
          {usaConector ? (
            <Field label="Conector en Integraciones" required error={errores.connector_id} hint="Donde el administrador cargó las credenciales.">
              <Select value={d.connector_id} onChange={(e) => setD({ ...d, connector_id: e.target.value })} placeholder="Elige el conector" options={conectores} />
            </Field>
          ) : <div className="flex items-end pb-2 text-[12.5px] text-muted">{d.connection_mode === "APP_ONLY" ? "Sin integración: los pedidos de este número se registran a mano." : "No disponible para esta cuenta."}</div>}
          <Field label="Asignación de chats" required error={errores.assignment_mode}><Select value={d.assignment_mode} onChange={(e) => setD({ ...d, assignment_mode: e.target.value })} options={o.asignacion} /></Field>
          <Field label="Estado" required error={errores.status}><Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })} options={o.estados} /></Field>
          <Field label="Saludo automático" error={errores.auto_greeting} hint="Se responde solo cuando entra un chat nuevo; no cuenta como primera respuesta." className="sm:col-span-2">
            <Textarea rows={2} maxLength={1000} value={d.auto_greeting} onChange={(e) => setD({ ...d, auto_greeting: e.target.value })} />
          </Field>
          <Field label="Aviso de registro (Ley 29733)" required={d.kind === "WHATSAPP" && d.connection_mode !== "APP_ONLY"} error={errores.recording_notice_text}
            hint="Se envía en el primer mensaje de cada contacto nuevo y queda en sus consentimientos." className="sm:col-span-2">
            <Textarea rows={3} maxLength={1000} value={d.recording_notice_text} onChange={(e) => setD({ ...d, recording_notice_text: e.target.value })} />
          </Field>
        </>
      )}
    </Dialogo>
  );
}
