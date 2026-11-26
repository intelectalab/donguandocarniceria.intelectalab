"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleSlash, FileClock, Plus, Send } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { tarifa } from "@/modulos/crm/conversacion";

type Opcion = { value: string; label: string };
type Plantilla = {
  id: string; brand_id: string; brand_name: string; name: string; category: string; category_name: string; purpose: string; purpose_name: string; status: string; status_name: string;
  body: string; variables: string[]; provider_template_id: string | null; rejection_reason: string | null; submitted_at: string | null; envios: number; costo_fuera: number; costo_dentro: number;
  ejemplo?: string;
};
type Lista = Pagina<Plantilla> & {
  cifras: { aprobadas: number; revision: number; rechazadas: number; borradores: number; tope: number };
  opciones: { categorias: Opcion[]; estados: Opcion[]; propositos: Opcion[]; marcas: Opcion[] }; puede: boolean;
};

const ESTADOS: Record<string, [string, Tone]> = { DRAFT: ["Borrador", "neutral"], PENDING: ["En revisión de Meta", "warn"], APPROVED: ["Aprobada", "ok"], REJECTED: ["Rechazada", "bad"], PAUSED: ["Pausada", "warn"], DISABLED: ["Desactivada", "neutral"] };
const BAJA = "\n\nSi no deseas recibir promociones, responde BAJA.";

/**
 * CRM-09 Plantillas: de utilidad y marketing por marca, con sus variables, propósito, estado de aprobación en Meta y
 * costo por envío. Solo las aprobadas se envían; su texto ya no cambia.
 */
export default function Plantillas() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.template.manage") || can("crm.conversation.view_all") || can("crm.template.send_marketing"));
  const [f, setF] = useState({ categoria: "", estado: "", marca: "", proposito: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);
  const [editar, setEditar] = useState<Plantilla | "nueva" | null>(null);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/crm/plantillas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta las plantillas.</Alert>;

  const columnas: Column<Plantilla>[] = [
    { key: "brand_name", sortable: true, header: "Marca", render: (t) => <span className="text-[12.5px]">{t.brand_name}</span> },
    { key: "name", sortable: true, header: "Nombre", cardTitle: true, render: (t) => <span className="font-mono text-[12.5px] font-semibold text-ink">{t.name}</span> },
    { key: "category_name", sortable: true, header: "Categoría", render: (t) => <Badge tone={t.category === "MARKETING" ? "info" : "neutral"}>{t.category_name}</Badge> },
    { key: "purpose_name", sortable: true, header: "Propósito", hideOnMobile: true, render: (t) => <span className="text-[12.5px]">{t.purpose_name}</span> },
    { key: "status_name", sortable: true, header: "Meta", render: (t) => <StatusBadge status={t.status} labels={ESTADOS} /> },
    { key: "costo_fuera", sortable: true, header: "Fuera de ventana", align: "right", render: (t) => <span className="tabular-nums">{tarifa(t.costo_fuera)}</span> },
    { key: "costo_dentro", sortable: true, header: "En ventana", align: "right", hideOnMobile: true, render: (t) => <span className="tabular-nums">{t.costo_dentro ? tarifa(t.costo_dentro) : "Gratis"}</span> },
    { key: "envios", sortable: true, header: "Envíos", align: "right", render: (t) => numero(t.envios) },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Plantillas de utilidad y marketing por marca. Se crean en borrador, se envían a revisión de Meta y solo las aprobadas se usan en los chats; su texto ya no cambia. El costo es por envío fuera de la ventana de 24 h (dentro de la ventana, la utilidad es gratis; con la ventana de anuncio de 72 h, todo es gratis)."
        actions={lista?.puede ? <Button variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Nueva plantilla</Button> : undefined} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Aprobadas" valor={numero(c.aprobadas)} icono={BadgeCheck} destacada detalle={`${c.borradores} en borrador`} />
          <Cifra titulo="En revisión de Meta" valor={numero(c.revision)} icono={FileClock} tono={c.revision ? "warn" : undefined} detalle="Esperan la respuesta" />
          <Cifra titulo="Rechazadas" valor={numero(c.rechazadas)} icono={CircleSlash} tono={c.rechazadas ? "bad" : undefined} detalle="Se corrigen y se reenvían" />
          <Cifra titulo="Tope por pedido" valor={`${c.tope} de utilidad`} icono={Send} detalle="Confirmación y «va en camino»" />
        </div>
      )}
      <Alert tone="info">Por confirmar con Meta: la encuesta posentrega se trata como utilidad. Si Meta la reclasifica como marketing, se cobra como tal y se envía solo dentro de la ventana.</Alert>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(t) => setAbierta(t.id)} empty="Ninguna plantilla con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar nombre o texto…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={lista?.opciones.marcas ?? []} />
          <FiltroSelect etiqueta="Categoría" todos="todas" ancho={170} value={f.categoria} onChange={(v) => setF({ ...f, categoria: v })} options={lista?.opciones.categorias ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={190} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={lista?.opciones.estados ?? []} />
          <FiltroSelect etiqueta="Propósito" ancho={200} value={f.proposito} onChange={(v) => setF({ ...f, proposito: v })} options={lista?.opciones.propositos ?? []} />
        </>} />
      {abierta && lista && <FichaPlantilla id={abierta} puede={lista.puede} onClose={() => setAbierta(null)} onEditar={(t) => { setAbierta(null); setEditar(t); }} onCambio={cargar} />}
      {editar && lista && <EditarPlantilla t={editar === "nueva" ? null : editar} lista={lista} onClose={() => setEditar(null)} onListo={(id) => { setEditar(null); cargar(); setAbierta(id); }} />}
    </div>
  );
}

function FichaPlantilla({ id, puede, onClose, onEditar, onCambio }: { id: string; puede: boolean; onClose: () => void; onEditar: (t: Plantilla) => void; onCambio: () => void }) {
  const [t, setT] = useState<Plantilla | null>(null);
  const [error, setError] = useState("");
  const [rechazo, setRechazo] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    api<Plantilla>(`/v1/crm/plantillas/${id}`).then((r) => vivo && setT(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id]);

  async function accion(ruta: string, body?: Record<string, unknown>, ok?: string) {
    try {
      setT(await api<Plantilla>(`/v1/crm/plantillas/${id}/${ruta}`, { method: "POST", body }));
      if (ok) toast.ok(ok);
      setRechazo(null);
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const editable = t && ["DRAFT", "REJECTED"].includes(t.status);
  return (
    <Modal open onClose={onClose} size="lg" title={t?.name ?? "Plantilla"} description={t ? `${t.brand_name} · ${t.category_name} · ${t.purpose_name}` : undefined}
      footer={t && puede ? (
        <>
          {editable && <Button variant="ghost" onClick={() => onEditar(t)}>Editar</Button>}
          {editable && <Button variant="primary" icon={Send} onClick={() => accion("revision", undefined, "Enviada a revisión de Meta")}>Enviar a revisión</Button>}
          {t.status === "PENDING" && <Button variant="ghost" onClick={() => setRechazo("")}>Registrar rechazo</Button>}
          {t.status === "PENDING" && <Button variant="primary" icon={BadgeCheck} onClick={() => accion("respuesta", { aprobada: true }, "Plantilla aprobada")}>Registrar aprobación</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {t && (
        <div className="grid gap-4">
          <DetailList items={[
            { label: "Marca", value: t.brand_name }, { label: "Categoría", value: <Badge tone={t.category === "MARKETING" ? "info" : "neutral"}>{t.category_name}</Badge> },
            { label: "Propósito", value: t.purpose_name },
            { label: "Estado en Meta", value: <StatusBadge status={t.status} labels={ESTADOS} /> }, { label: "Id en Meta", value: t.provider_template_id ?? "—" },
            { label: "Variables", value: t.variables.length ? t.variables.map((v) => `{{${v}}}`).join(", ") : "Sin variables" },
            { label: "Costo", value: `${tarifa(t.costo_fuera)} fuera de la ventana · ${t.costo_dentro ? tarifa(t.costo_dentro) : "gratis"} dentro` },
            { label: "Envíos", value: numero(t.envios) },
            ...(t.rejection_reason ? [{ label: "Motivo del rechazo", value: t.rejection_reason }] : []),
          ]} />
          <div className="grid gap-1.5">
            <p className="text-[12.5px] font-semibold text-ink">Texto</p>
            <p className="whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 font-mono text-[12.5px]">{t.body}{t.category === "MARKETING" ? BAJA : ""}</p>
          </div>
          {t.ejemplo && (
            <div className="grid gap-1.5">
              <p className="text-[12.5px] font-semibold text-ink">Así le llega al cliente (con datos de ejemplo)</p>
              <p className="max-w-[90%] justify-self-end whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] text-primary-ink">{t.ejemplo}</p>
            </div>
          )}
          {t.status === "PENDING" && <p className="text-[12px] text-muted">Cuando el proveedor oficial esté conectado, la respuesta de Meta llega sola; mientras tanto se registra a mano.</p>}
          {rechazo !== null && (
            <div className="grid gap-2 rounded-lg border border-line p-3">
              <Field label="Motivo que dio Meta"><Textarea rows={2} maxLength={255} value={rechazo} onChange={(e) => setRechazo(e.target.value)} /></Field>
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setRechazo(null)}>Cancelar</Button><Button variant="danger" onClick={() => accion("respuesta", { aprobada: false, motivo: rechazo }, "Rechazo registrado")}>Registrar rechazo</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function EditarPlantilla({ t, lista, onClose, onListo }: { t: Plantilla | null; lista: Lista; onClose: () => void; onListo: (id: string) => void }) {
  const o = lista.opciones;
  const [d, setD] = useState({ brand_id: t?.brand_id ?? o.marcas[0]?.value ?? "", name: t?.name ?? "", category: t?.category ?? "UTILITY", purpose: t?.purpose ?? "OTHER", body: t?.body ?? "" });
  const vars = [...new Set([...d.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  return (
    <Dialogo titulo={t ? `Editar ${t.name}` : "Nueva plantilla"} boton="Guardar borrador" onClose={onClose}
      aviso="Queda en borrador. Después se envía a revisión de Meta; una vez aprobada, su texto no cambia."
      enviar={async () => {
        const r = await api<Plantilla>(t ? `/v1/crm/plantillas/${t.id}` : "/v1/crm/plantillas", { method: t ? "PUT" : "POST", body: d });
        toast.ok("Plantilla guardada en borrador");
        onListo(r.id);
      }}>
      {(errores) => (
        <>
          <Field label="Marca" required error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} options={o.marcas} /></Field>
          <Field label="Nombre" required error={errores.name} hint="Minúsculas, números y guion bajo, como lo pide Meta."><Input maxLength={250} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Categoría" required error={errores.category}><Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={o.categorias} /></Field>
          <Field label="Propósito" required error={errores.purpose}><Select value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })} options={o.propositos} /></Field>
          <Field label="Texto" required error={errores.body} hint={`Variables entre llaves dobles, como {{cliente}} o {{pedido}}.${d.category === "MARKETING" ? " La opción de baja se agrega sola al enviar." : ""}`} className="sm:col-span-2">
            <Textarea rows={5} maxLength={1024} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
          </Field>
          {vars.length > 0 && <p className="text-[12px] text-muted sm:col-span-2">Variables: {vars.map((v) => `{{${v}}}`).join(", ")}</p>}
        </>
      )}
    </Dialogo>
  );
}
