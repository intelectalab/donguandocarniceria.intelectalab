"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, MailCheck, MailX, Megaphone, Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, Switch, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, usePaginaLocal, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { RedEtiqueta } from "@/modulos/crm/conversacion";
import { sinTildes } from "@/modulos/mae/tipos";

type Opcion = { value: string; label: string };
type Registro = {
  id: string; recorded_at: string; quien: string; celular: string | null; customer_id: string | null; purpose: string; proposito: string; granted: boolean; canal: string; marca: string;
  evidencia: string | null; evidencia_mensaje: string | null; conversation_id: string | null; registro: string | null; origen: string | null;
};
type Lista = Pagina<Registro> & {
  cifras: { avisos: number; otorgados: number; bajas: number; vigentes: number };
  puede: { registrar: boolean; ficha: boolean; numeros: boolean };
  opciones: { propositos: Opcion[]; a_mano: Opcion[]; canales: Opcion[]; canales_a_mano: Opcion[]; origenes: Opcion[]; marcas: Opcion[] };
};
type Aviso = { id: string; red: string; kind: string; nombre: string; numero: string | null; marca: string | null; texto: string | null; enviados: number; ultimo: string | null; exigido: boolean };

/**
 * CRM-18 Consentimientos y avisos (Ley 29733): el historial por cliente del aviso de registro, el tratamiento de datos,
 * el marketing y las bajas; registrar un «sí» o una baja siempre con evidencia, y los textos del aviso de cada número.
 * Los registros solo se agregan: el último de cada cliente es el que vale.
 */
export default function Consentimientos() {
  const { can } = useSesion();
  const permitido = Boolean(can("crm.consent.manage") || can("crm.conversation.view_all") || can("crm.customer.view_full"));
  const [pestana, setPestana] = useState<"historial" | "avisos">("historial");
  const [lista, setLista] = useState<Lista | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta los consentimientos.</Alert>;
  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada cliente tiene su historial de avisos y consentimientos: el aviso de registro que recibió al escribir por primera vez, el tratamiento de sus datos, si acepta promociones y sus bajas. El consentimiento nunca se presume: se registra con lo que dijo el cliente o el documento que firmó, y vale el último registro."
        actions={lista?.puede.registrar ? <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Registrar consentimiento o baja</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Avisos de registro" valor={numero(c.avisos)} icono={BellRing} destacada detalle="Enviados al primer mensaje" />
          <Cifra titulo="Marketing otorgado" valor={numero(c.otorgados)} icono={MailCheck} tono="ok" detalle="Registros de «sí»" />
          <Cifra titulo="Bajas de marketing" valor={numero(c.bajas)} icono={MailX} tono={c.bajas ? "bad" : undefined} detalle="Se excluyen de las campañas" />
          <Cifra titulo="Aceptan promociones hoy" valor={numero(c.vigentes)} icono={Megaphone} detalle="Clientes cuyo último registro es «sí»" />
        </div>
      )}
      <Tabs tabs={[{ key: "historial", label: "Historial", count: lista?.total }, { key: "avisos", label: "Textos del aviso por número" }]} value={pestana} onChange={setPestana} />
      {pestana === "historial" ? <Historial vuelta={vuelta} onLista={setLista} /> : <Avisos puedeEditar={Boolean(lista?.puede.numeros)} />}
      {nuevo && lista && <Registrar lista={lista} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); setVuelta((n) => n + 1); }} />}
    </div>
  );
}

function Historial({ vuelta, onLista }: { vuelta: number; onLista: (l: Lista) => void }) {
  const { marca } = useSesion();
  const [f, setF] = useState({ proposito: "", estado: "", canal: "", origen: "", marca: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [ver, setVer] = useState<Registro | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/consentimientos?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); onLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, onLista]);
  useEffect(() => cargar(), [cargar, vuelta]);

  const columnas: Column<Registro>[] = [
    { key: "fecha", sortable: true, header: "Fecha", render: (k) => <span className="whitespace-nowrap">{fechaHora(k.recorded_at)}</span> },
    { key: "quien", sortable: true, header: "Cliente o contacto", cardTitle: true, render: (k) => <div><p className="font-semibold text-ink">{k.quien}</p>{k.celular && <p className="font-mono text-[12px] text-muted">{k.celular}</p>}</div> },
    { key: "proposito", sortable: true, header: "Propósito", render: (k) => <span className="text-[12.5px]">{k.proposito}</span> },
    { key: "status", header: "Estado", render: (k) => k.granted ? <Badge tone="ok">{k.purpose === "RECORDING_NOTICE" ? "Enviado" : "Otorgado"}</Badge> : <Badge tone="bad">Baja</Badge> },
    { key: "canal", sortable: true, header: "Canal", hideOnMobile: true, render: (k) => <span className="text-[12.5px]">{k.canal}</span> },
    { key: "marca", sortable: true, header: "Marca", hideOnMobile: true, render: (k) => <span className="text-[12.5px]">{k.marca}</span> },
    { key: "evidencia", header: "Evidencia", render: (k) => <span className="line-clamp-2 text-[12.5px] text-muted">{k.evidencia ?? (k.evidencia_mensaje ? "Mensaje del cliente" : "—")}</span> },
    { key: "registro", header: "Registró", hideOnMobile: true, render: (k) => <div className="text-[12.5px]">{k.registro ?? "—"}{k.origen && <p className="text-[11.5px] text-muted">{k.origen}</p>}</div> },
  ];
  const o = lista?.opciones;
  return (
    <>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={setVer} empty="Ningún registro con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cliente, celular o evidencia…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Propósito" ancho={190} value={f.proposito} onChange={(v) => setF({ ...f, proposito: v })} options={o?.propositos ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={150} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "1", label: "Otorgado" }, { value: "0", label: "Baja" }]} />
          <FiltroSelect etiqueta="Canal" ancho={160} value={f.canal} onChange={(v) => setF({ ...f, canal: v })} options={o?.canales ?? []} />
          <FiltroSelect etiqueta="Origen" ancho={200} value={f.origen} onChange={(v) => setF({ ...f, origen: v })} options={o?.origenes ?? []} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={o?.marcas ?? []} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {ver && (
        <Modal open onClose={() => setVer(null)} title={`${ver.proposito} · ${ver.quien}`} description={fechaHora(ver.recorded_at)}>
          <div className="grid gap-3 text-[13px]">
            <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted">Estado</dt><dd>{ver.granted ? <Badge tone="ok">{ver.purpose === "RECORDING_NOTICE" ? "Enviado" : "Otorgado"}</Badge> : <Badge tone="bad">Baja</Badge>}</dd>
              <dt className="text-muted">Celular</dt><dd className="font-mono">{ver.celular ?? "—"}</dd>
              <dt className="text-muted">Canal</dt><dd>{ver.canal}</dd>
              <dt className="text-muted">Marca</dt><dd>{ver.marca}</dd>
              <dt className="text-muted">Evidencia</dt><dd>{ver.evidencia ?? "—"}</dd>
              <dt className="text-muted">Registró</dt><dd>{[ver.registro, ver.origen].filter(Boolean).join(" · ") || "—"}</dd>
            </dl>
            {ver.evidencia_mensaje && <blockquote className="rounded-lg border border-line bg-surface-2 p-3 text-[12.5px] whitespace-pre-line">{ver.evidencia_mensaje}</blockquote>}
            <div className="flex flex-wrap gap-2">
              {ver.conversation_id && <Link href={`/m/crm/crm-02?id=${ver.conversation_id}`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Abrir el chat</Link>}
              {lista?.puede.ficha && ver.customer_id && <Link href={`/m/crm/crm-04?id=${ver.customer_id}`} className="inline-flex items-center rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-primary hover:bg-surface-2">Ver ficha 360</Link>}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Avisos({ puedeEditar }: { puedeEditar: boolean }) {
  const [filas, setFilas] = useState<Aviso[] | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  useEffect(() => {
    api<{ data: Aviso[] }>("/v1/crm/consentimientos/avisos").then((r) => setFilas(r.data)).catch((e) => setError(mensajeDe(e)));
  }, []);
  const t = sinTildes(buscar.trim().toLowerCase());
  const vistas = (filas ?? []).filter((a) => !t || sinTildes(`${a.nombre} ${a.numero ?? ""} ${a.marca ?? ""} ${a.red} ${a.texto ?? ""}`.toLowerCase()).includes(t));
  const pag = usePaginaLocal(vistas, t);
  const columnas: Column<Aviso>[] = [
    { key: "nombre", header: "Número o cuenta", cardTitle: true, render: (a) => <div><RedEtiqueta kind={a.kind} nombre={a.nombre} />{a.numero && <p className="mt-0.5 font-mono text-[12px] text-muted">{a.numero}</p>}</div> },
    { key: "marca", header: "Marca", render: (a) => <span className="text-[12.5px]">{a.marca ?? "—"}</span> },
    { key: "texto", header: "Texto del aviso", render: (a) => a.texto ? <p className="max-w-[560px] text-[12.5px] whitespace-pre-line">{a.texto}</p>
      : <span className="text-[12.5px] text-muted">{a.exigido ? <Badge tone="bad">Falta el aviso</Badge> : "Sin aviso"}</span> },
    { key: "enviados", header: "Avisos enviados", align: "right", render: (a) => <div className="text-right"><span className="tabular-nums">{numero(a.enviados)}</span>{a.ultimo && <p className="text-[11.5px] text-muted">Último {fechaHora(a.ultimo)}</p>}</div> },
  ];
  return (
    <div className="grid gap-3">
      <Alert tone="warn">Los textos del aviso son provisionales: falta validarlos con el abogado de datos personales.{puedeEditar && <> Se editan en <Link href="/m/crm/crm-07" className="font-semibold underline">Números y cuentas</Link>.</>}</Alert>
      <DataTable columns={columnas} rows={pag.filas} pagination={pag.props} loading={!filas && !error} error={error} empty="Ningún número con estos datos."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar número, marca o texto…" }} />
    </div>
  );
}

function Registrar({ lista, onClose, onListo }: { lista: Lista; onClose: () => void; onListo: () => void }) {
  const [buscar, setBuscar] = useState("");
  const [clientes, setClientes] = useState<(Opcion & { marketing: boolean | null })[]>([]);
  const [d, setD] = useState({ customer_id: "", cliente: "", purpose: "MARKETING", granted: true, channel: "WHATSAPP", brand_id: lista.opciones.marcas.length === 1 ? lista.opciones.marcas[0].value : "", evidence_text: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    const q = buscar.trim();
    if (q.length < 2 || q === d.cliente) return;
    const t = setTimeout(() => {
      api<{ data: (Opcion & { marketing: boolean | null })[] }>(`/v1/crm/consentimientos/clientes?buscar=${encodeURIComponent(q)}`).then((r) => setClientes(r.data)).catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscar, d.cliente]);
  const elegido = clientes.find((x) => x.value === d.customer_id);
  async function guardar() {
    setEnviando(true);
    setErrores({});
    setGeneral("");
    try {
      await api("/v1/crm/consentimientos", { method: "POST", body: { customer_id: d.customer_id, purpose: d.purpose, granted: d.granted, channel: d.channel, brand_id: d.brand_id || null, evidence_text: d.evidence_text } });
      toast.ok(d.granted ? "Consentimiento registrado" : d.purpose === "MARKETING" ? "Baja registrada: el cliente sale de las campañas" : "Baja registrada");
      onListo();
    } catch (e) {
      const x = e as { errors?: Record<string, string[]> };
      if (x.errors) setErrores(Object.fromEntries(Object.entries(x.errors).map(([k, v]) => [k, v[0]])));
      setGeneral(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="lg" title="Registrar consentimiento o baja" description="Siempre con evidencia: lo que dijo el cliente y dónde, o el documento que firmó. Queda en el historial y no se puede cambiar."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={!d.customer_id || d.evidence_text.trim().length < 5} onClick={guardar}>Registrar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {general && <div className="sm:col-span-2"><Alert tone="bad">{general}</Alert></div>}
        <Field label="Cliente" required error={errores.customer_id} className="sm:col-span-2" hint={d.customer_id ? undefined : "Escribe el nombre, el celular o el documento."}>
          <Input value={buscar} onChange={(e) => { setBuscar(e.target.value); setD({ ...d, customer_id: "", cliente: "" }); }} placeholder="Buscar cliente…" />
        </Field>
        {!d.customer_id && buscar.trim().length >= 2 && clientes.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-lg border border-line sm:col-span-2">
            {clientes.map((x) => (
              <li key={x.value}><button type="button" className="w-full cursor-pointer px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                onClick={() => { setD({ ...d, customer_id: x.value, cliente: x.label }); setBuscar(x.label); setClientes([x]); }}>
                {x.label}<span className="ml-2 text-[11.5px] text-muted">{x.marketing === null ? "sin registro de marketing" : x.marketing ? "acepta promociones" : "dio de baja"}</span>
              </button></li>
            ))}
          </ul>
        )}
        {elegido && <p className="text-[12px] text-muted sm:col-span-2">Hoy: {elegido.marketing === null ? "sin registro de marketing" : elegido.marketing ? "acepta promociones" : "dio de baja las promociones"}.</p>}
        <Field label="Propósito" required error={errores.purpose}><Select value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} options={lista.opciones.a_mano} /></Field>
        <Field label="Canal" required error={errores.channel}><Select value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })} options={lista.opciones.canales_a_mano} /></Field>
        <Field label="Marca" error={errores.brand_id} hint={lista.opciones.marcas.length > 1 ? "Déjalo vacío para todas las marcas." : undefined}>
          <Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} placeholder="Todas las marcas" options={lista.opciones.marcas} />
        </Field>
        <Field label="Otorga" hint={d.granted ? "El cliente dijo que sí." : "Es una baja: el cliente pidió no recibir más."}>
          <Switch checked={d.granted} onChange={(v: boolean) => setD({ ...d, granted: v })} label={d.granted ? "Otorga" : "Baja"} />
        </Field>
        <Field label="Evidencia" required error={errores.evidence_text} className="sm:col-span-2" hint="Por ejemplo: «Respondió SÍ al mensaje del 12/11» o «Firmó la hoja de promociones en el local».">
          <Textarea rows={3} maxLength={500} value={d.evidence_text} onChange={(e) => setD({ ...d, evidence_text: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
