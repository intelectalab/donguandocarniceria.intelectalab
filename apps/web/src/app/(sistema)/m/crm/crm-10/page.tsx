"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, FiltroSelect, Input, PageHeader, Select, StatusBadge, Tabs, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";

type Opcion = { value: string; label: string };
type Respuesta = { id: string; shortcut: string; body: string; status: string; brand_id: string | null; owner_user_id: string | null; alcance: string; mia: boolean; puede_editar: boolean };
type ListaR = Pagina<Respuesta> & { marcas: Opcion[]; puede_marca: boolean };
type Producto = { id: string; sku: string; name: string; brand_id: string; brand_name: string; status: string; precio: number | null; base: string | null; publicado: boolean };
type ListaC = Pagina<Producto> & { cifras: { publicados: number; fuera: number }; sincronizado: string | null; puede_sincronizar: boolean };

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };

/**
 * CRM-10 Respuestas rápidas y catálogo: atajos personales o de la marca (/delivery, /pago, /peso) y el catálogo de
 * WhatsApp sincronizado con el catálogo oficial (solo productos activos con precio vigente).
 */
function RespuestasYCatalogo() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [tab, setTab] = useState<"respuestas" | "catalogo">(params.get("tab") === "catalogo" ? "catalogo" : "respuestas");
  if (!permitido) return <Alert tone="warn">Tu rol no usa respuestas rápidas.</Alert>;
  return (
    <div className="grid gap-5">
      <PageHeader description="Atajos para responder rápido: los personales los crea cada quien y los de la marca, la supervisión. En la conversación se escribe el atajo (por ejemplo /delivery y un espacio) y se reemplaza por el texto. El catálogo de WhatsApp muestra solo lo activo con precio vigente en la lista de WhatsApp." />
      <Tabs value={tab} onChange={(t) => { setTab(t); router.replace(`/m/crm/crm-10${t === "catalogo" ? "?tab=catalogo" : ""}`, { scroll: false }); }}
        tabs={[{ key: "respuestas" as const, label: "Respuestas rápidas" }, { key: "catalogo" as const, label: "Catálogo de WhatsApp" }]} />
      {tab === "respuestas" ? <Respuestas /> : <Catalogo />}
    </div>
  );
}

function Respuestas() {
  const [f, setF] = useState({ alcance: "", marca: "", estado: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<ListaR | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState<Respuesta | "nueva" | null>(null);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<ListaR>(`/v1/crm/respuestas?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  const columnas: Column<Respuesta>[] = [
    { key: "shortcut", sortable: true, header: "Atajo", cardTitle: true, render: (r) => <span className="font-mono font-semibold text-ink">{r.shortcut}</span> },
    { key: "alcance", sortable: true, header: "Alcance", render: (r) => (r.owner_user_id ? <Badge tone="info">{r.mia ? "Personal (mía)" : r.alcance}</Badge> : <span className="text-[12.5px]">{r.alcance}</span>) },
    { key: "body", header: "Texto", render: (r) => <span className="line-clamp-2 max-w-[520px] text-[12.5px]">{r.body}</span> },
    { key: "status", sortable: true, header: "Estado", render: (r) => <StatusBadge status={r.status} labels={ESTADOS} /> },
  ];
  return (
    <>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(r) => (r.puede_editar ? setEditar(r) : toast.info("Las respuestas de la marca las cambia la supervisión."))} empty="Ninguna respuesta con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar atajo o texto…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Alcance" ancho={170} value={f.alcance} onChange={(v) => setF({ ...f, alcance: v })} options={[{ value: "ME", label: "Personales" }, { value: "MARCA", label: "De la marca" }]} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={lista?.marcas ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={150} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "ACTIVE", label: "Activas" }, { value: "INACTIVE", label: "Inactivas" }]} />
          <Button variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Nueva respuesta</Button>
        </>} />
      {editar && lista && <EditarRespuesta r={editar === "nueva" ? null : editar} lista={lista} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </>
  );
}

function EditarRespuesta({ r, lista, onClose, onListo }: { r: Respuesta | null; lista: ListaR; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ shortcut: r?.shortcut ?? "/", body: r?.body ?? "", status: r?.status ?? "ACTIVE", alcance: r?.brand_id ?? "ME" });
  return (
    <Dialogo titulo={r ? `Respuesta ${r.shortcut}` : "Nueva respuesta rápida"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(r ? `/v1/crm/respuestas/${r.id}` : "/v1/crm/respuestas", { method: r ? "PUT" : "POST", body: d });
        toast.ok("Respuesta guardada");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Atajo" required error={errores.shortcut} hint="Empieza con / y usa minúsculas, por ejemplo /delivery."><Input maxLength={31} value={d.shortcut} onChange={(e) => setD({ ...d, shortcut: e.target.value })} /></Field>
          <Field label="Alcance" required error={errores.alcance}>
            <Select value={d.alcance} onChange={(e) => setD({ ...d, alcance: e.target.value })}
              options={[{ value: "ME", label: "Personal (solo yo)" }, ...(lista.puede_marca ? lista.marcas.map((m) => ({ value: m.value, label: `Marca ${m.label}` })) : [])]} />
          </Field>
          <Field label="Texto" required error={errores.body} className="sm:col-span-2"><Textarea rows={4} maxLength={2000} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} /></Field>
          <Field label="Estado" required error={errores.status}><Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} /></Field>
        </>
      )}
    </Dialogo>
  );
}

function Catalogo() {
  const { marca } = useSesion();
  const [f, setF] = useState({ marca: "", estado: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<ListaC | null>(null);
  const [error, setError] = useState("");
  const [sinc, setSinc] = useState(false);
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");
  const pag = usePagina(JSON.stringify({ ...f, filtroMarca }));
  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<ListaC>(`/v1/crm/catalogo?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  const [marcas, setMarcas] = useState<Opcion[]>([]);
  useEffect(() => { api<ListaR>("/v1/crm/respuestas?per_page=1").then((r) => setMarcas(r.marcas)).catch(() => {}); }, []);

  async function sincronizar() {
    setSinc(true);
    try {
      const r = await api<{ numeros: number }>("/v1/crm/catalogo/sincronizar", { method: "POST" });
      toast.ok(`Catálogo sincronizado en ${r.numeros} número(s) de WhatsApp`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setSinc(false);
    }
  }

  const columnas: Column<Producto>[] = [
    { key: "brand_name", sortable: true, header: "Marca", render: (p) => <span className="text-[12.5px]">{p.brand_name}</span> },
    { key: "sku", sortable: true, header: "SKU", render: (p) => <span className="font-mono text-[12px]">{p.sku}</span> },
    { key: "name", sortable: true, header: "Producto", cardTitle: true, render: (p) => <span className="font-semibold text-ink">{p.name}</span> },
    { key: "precio", sortable: true, header: "Precio WhatsApp", align: "right", render: (p) => (p.precio !== null ? <span className="tabular-nums">{soles(p.precio)} {p.base === "KG" ? "el kg" : "c/u"}</span> : <span className="text-muted">—</span>) },
    { key: "publicado", header: "En el catálogo", render: (p) => (p.publicado ? <Badge tone="ok" dot>Publicado</Badge> : <Badge tone="warn" dot>{p.status !== "ACTIVE" ? "Fuera: inactivo" : "Fuera: sin precio"}</Badge>) },
  ];
  return (
    <>
      {lista && (
        <p className="text-[12.5px] text-muted">
          {numero(lista.cifras.publicados)} productos publicados · {numero(lista.cifras.fuera)} fuera · {lista.sincronizado ? `Última sincronización: ${fechaHora(lista.sincronizado)}` : "Aún no se sincroniza"}
        </p>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        empty="Ningún producto con estos filtros."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar producto o SKU…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={marcas} />
          <FiltroSelect etiqueta="En el catálogo" ancho={200} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "PUBLICADO", label: "Publicados" }, { value: "FUERA", label: "Fuera" }]} />
          {lista?.puede_sincronizar && <Button icon={RefreshCw} loading={sinc} onClick={sincronizar}>Sincronizar con el catálogo</Button>}
        </>} />
    </>
  );
}

export default function Page() {
  return <Suspense><RespuestasYCatalogo /></Suspense>;
}
