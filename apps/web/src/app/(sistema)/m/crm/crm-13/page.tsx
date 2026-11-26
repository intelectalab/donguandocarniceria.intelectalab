"use client";

import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, FiltroSelect, Input, PageHeader, Select, Switch, Tabs, Textarea, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";

type Opcion = { value: string; label: string };
type Regla = { id: string; code: string; name: string; rule_type: string; tipo: string; pattern: string; severity: string; gravedad: string; active: boolean; alertas: number; abiertas: number; sistema: boolean; en_catalogo: boolean | null };
type Reglas = Pagina<Regla> & { opciones: { tipos: Opcion[]; editables: Opcion[]; gravedades: Opcion[] }; puede: boolean };
type Ident = { id: string; identifier_type: string; tipo: string; value: string; label: string; brand_id: string | null; marca: string; status: string };
type Idents = Pagina<Ident> & { opciones: { tipos: Opcion[]; marcas: Opcion[] }; puede: boolean };
type Hit = { code: string; name: string; tipo: string; severity: string; gravedad: string; coincidencia: string };

const GRAVEDAD: Record<string, Tone> = { HIGH: "bad", MEDIUM: "warn", LOW: "info" };

/**
 * CRM-13 Reglas e identificadores oficiales: las frases de alerta, los términos del rubro que no vendemos, los patrones de
 * celulares y cuentas ajenas y la lista de números, cuentas, Yape y Plin de la empresa; con un probador de textos.
 */
export default function ReglasControl() {
  const { can } = useSesion();
  const permitido = Boolean(can("crm.alert_rule.manage") || can("crm.alert.review"));
  const [pestana, setPestana] = useState<"reglas" | "identificadores" | "probar">("reglas");
  if (!permitido) return <Alert tone="warn">Tu rol no consulta las reglas de control.</Alert>;
  return (
    <div className="grid gap-5">
      <PageHeader description="Qué se considera fuera del canal oficial: frases como «por fuera» o «mi yape», celulares de 9 dígitos y cuentas de 13 a 20 dígitos que no están en la lista de la empresa, y productos que no vendemos. Las frases se comparan sin tildes ni mayúsculas, y el celular del propio cliente nunca alerta." />
      <Tabs tabs={[{ key: "reglas", label: "Reglas" }, { key: "identificadores", label: "Identificadores oficiales" }, { key: "probar", label: "Probar un texto" }]} value={pestana} onChange={setPestana} />
      {pestana === "reglas" && <TablaReglas />}
      {pestana === "identificadores" && <TablaIdentificadores />}
      {pestana === "probar" && <Probar />}
    </div>
  );
}

function useBuscador() {
  const [buscar, setBuscar] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(buscar.trim()), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  return { buscar, setBuscar, q };
}

function TablaReglas() {
  const b = useBuscador();
  const [f, setF] = useState({ tipo: "", gravedad: "", activa: "" });
  const [r, setR] = useState<Reglas | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState<Regla | "nueva" | null>(null);
  const pag = usePagina(JSON.stringify({ ...f, q: b.q }));
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, buscar: b.q }).filter(([, v]) => v)).toString();
    api<Reglas>(`/v1/crm/reglas?${q}${q ? "&" : ""}${pag.qs}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, b.q, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  const columnas: Column<Regla>[] = [
    { key: "nombre", sortable: true, header: "Regla", cardTitle: true, render: (x) => <div><p className="font-semibold text-ink">{x.name}</p><p className="font-mono text-[11.5px] text-muted">{x.code}</p></div> },
    { key: "tipo", sortable: true, header: "Tipo", render: (x) => <div className="text-[12.5px]">{x.tipo}{x.sistema && <p className="text-[11px] text-muted">Señal del sistema</p>}</div> },
    { key: "pattern", header: "Frase o término", render: (x) => (
      <div className="text-[12.5px]">{x.sistema || ["FOREIGN_PHONE", "FOREIGN_ACCOUNT"].includes(x.rule_type) ? <span className="text-muted">{x.pattern}</span> : <b>«{x.pattern}»</b>}
        {x.en_catalogo && <p className="text-[11px] text-warn">Hoy está en el catálogo: no alerta</p>}</div>) },
    { key: "gravedad", sortable: true, header: "Gravedad", render: (x) => <Badge tone={GRAVEDAD[x.severity] ?? "neutral"}>{x.gravedad}</Badge> },
    { key: "status", header: "Estado", render: (x) => x.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="neutral">Apagada</Badge> },
    { key: "alertas", sortable: true, header: "Alertas", align: "right", render: (x) => <div className="text-right tabular-nums">{numero(x.alertas)}{x.abiertas > 0 && <p className="text-[11px] text-bad">{x.abiertas} abiertas</p>}</div> },
  ];
  return (
    <div className="grid gap-3">
      <DataTable {...pag.orden} columns={columnas} rows={r?.data ?? []} pagination={pag.props(r)} loading={!r && !error} error={error} onRetry={cargar} empty="Ninguna regla con estos filtros."
        onRowClick={r?.puede ? (x) => setEditar(x) : undefined} search={{ value: b.buscar, onChange: b.setBuscar, placeholder: "Buscar código, nombre o frase…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Tipo" ancho={210} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={r?.opciones.tipos ?? []} />
          <FiltroSelect etiqueta="Gravedad" todos="todas" ancho={150} value={f.gravedad} onChange={(v) => setF({ ...f, gravedad: v })} options={r?.opciones.gravedades ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={150} value={f.activa} onChange={(v) => setF({ ...f, activa: v })} options={[{ value: "1", label: "Activas" }, { value: "0", label: "Apagadas" }]} />
          {r?.puede && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditar("nueva")}>Nueva regla</Button>}
        </>} />
      <Alert tone="info">Un término del rubro (por ejemplo «lechón») alerta solo si ningún producto activo del catálogo lo contiene: si mañana se vende, deja de alertar solo. Borrado en el celular, chat sin responder y encuesta son señales del sistema: solo se cambia su gravedad o se apagan. Las reglas no se borran; se apagan.</Alert>
      {editar && r && <EditarRegla regla={editar === "nueva" ? null : editar} opciones={r.opciones} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

function EditarRegla({ regla, opciones, onClose, onListo }: { regla: Regla | null; opciones: Reglas["opciones"]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ code: regla?.code ?? "", name: regla?.name ?? "", rule_type: regla?.rule_type ?? "KEYWORD", pattern: regla?.pattern ?? "", severity: regla?.severity ?? "MEDIUM", active: regla?.active ?? true });
  const editablePatron = !regla?.sistema;
  return (
    <Dialogo titulo={regla ? `Regla ${regla.code}` : "Nueva regla"} boton="Guardar" onClose={onClose}
      aviso={regla?.sistema ? "Señal del sistema: cambia su gravedad o apágala." : "La frase se compara sin tildes ni mayúsculas, como palabra completa."}
      enviar={async () => {
        const body = regla ? { code: d.code, name: d.name, severity: d.severity, active: d.active, ...(editablePatron ? { pattern: d.pattern } : {}) } : d;
        await api(regla ? `/v1/crm/reglas/${regla.id}` : "/v1/crm/reglas", { method: regla ? "PUT" : "POST", body });
        toast.ok("Regla guardada");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Código" required error={errores.code} hint="Por ejemplo CTL-17."><Input maxLength={20} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Nombre" required error={errores.name}><Input maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
          <Field label="Tipo" required error={errores.rule_type}>
            {regla ? <Input value={regla.tipo} disabled /> : <Select value={d.rule_type} onChange={(e) => setD({ ...d, rule_type: e.target.value })} options={opciones.editables} />}
          </Field>
          <Field label="Gravedad" required error={errores.severity}><Select value={d.severity} onChange={(e) => setD({ ...d, severity: e.target.value })} options={opciones.gravedades} /></Field>
          {editablePatron && (
            <Field label={["KEYWORD", "OFF_CATALOG_TERM"].includes(d.rule_type) ? "Frase o término" : "Descripción del patrón"} required error={errores.pattern} className="sm:col-span-2">
              <Input maxLength={255} value={d.pattern} onChange={(e) => setD({ ...d, pattern: e.target.value })} />
            </Field>
          )}
          <Field label="Estado"><Switch checked={d.active} onChange={(v: boolean) => setD({ ...d, active: v })} label={d.active ? "Activa" : "Apagada"} /></Field>
        </>
      )}
    </Dialogo>
  );
}

function TablaIdentificadores() {
  const b = useBuscador();
  const [f, setF] = useState({ tipo: "", estado: "", marca: "" });
  const [r, setR] = useState<Idents | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState<Ident | "nuevo" | null>(null);
  const pag = usePagina(JSON.stringify({ ...f, q: b.q }));
  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, buscar: b.q }).filter(([, v]) => v)).toString();
    api<Idents>(`/v1/crm/identificadores?${q}${q ? "&" : ""}${pag.qs}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, b.q, pag.qs]);
  useEffect(() => cargar(), [cargar]);
  const columnas: Column<Ident>[] = [
    { key: "tipo", sortable: true, header: "Tipo", render: (x) => <span className="text-[12.5px] font-semibold">{x.tipo}</span> },
    { key: "valor", sortable: true, header: "Valor", cardTitle: true, render: (x) => <span className="font-mono text-[12.5px] text-ink">{x.value}</span> },
    { key: "descripcion", sortable: true, header: "Descripción", render: (x) => <span className="text-[12.5px]">{x.label}</span> },
    { key: "marca", sortable: true, header: "Marca", render: (x) => <span className="text-[12.5px]">{x.marca}</span> },
    { key: "status", sortable: true, sortKey: "estado", header: "Estado", render: (x) => x.status === "ACTIVE" ? <Badge tone="ok">Activo</Badge> : <Badge tone="neutral">Inactivo</Badge> },
  ];
  return (
    <div className="grid gap-3">
      <DataTable {...pag.orden} columns={columnas} rows={r?.data ?? []} pagination={pag.props(r)} loading={!r && !error} error={error} onRetry={cargar} empty="Ningún identificador con estos filtros."
        onRowClick={r?.puede ? (x) => setEditar(x) : undefined} search={{ value: b.buscar, onChange: b.setBuscar, placeholder: "Buscar valor o descripción…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Tipo" ancho={190} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={r?.opciones.tipos ?? []} />
          <FiltroSelect etiqueta="Estado" ancho={150} value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" }]} />
          <FiltroSelect etiqueta="Marca" todos="todas" ancho={170} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={r?.opciones.marcas ?? []} />
          {r?.puede && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Nuevo identificador</Button>}
        </>} />
      <Alert tone="info">Lo que está aquí no alerta cuando una vendedora lo escribe: los números de WhatsApp de cada marca, la central, el Yape y el Plin, y las cuentas y el CCI de la empresa. Un identificador que deja de usarse se pasa a inactivo.</Alert>
      {editar && r && <EditarIdentificador ident={editar === "nuevo" ? null : editar} opciones={r.opciones} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

function EditarIdentificador({ ident, opciones, onClose, onListo }: { ident: Ident | null; opciones: Idents["opciones"]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ identifier_type: ident?.identifier_type ?? "YAPE", value: ident?.value ?? "", label: ident?.label ?? "", brand_id: ident?.brand_id ?? "", status: ident?.status ?? "ACTIVE" });
  return (
    <Dialogo titulo={ident ? "Identificador oficial" : "Nuevo identificador oficial"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(ident ? `/v1/crm/identificadores/${ident.id}` : "/v1/crm/identificadores", { method: ident ? "PUT" : "POST", body: { ...d, brand_id: d.brand_id || null } });
        toast.ok("Identificador guardado");
        onListo();
      }}>
      {(errores) => (
        <>
          <Field label="Tipo" required error={errores.identifier_type}><Select value={d.identifier_type} onChange={(e) => setD({ ...d, identifier_type: e.target.value })} options={opciones.tipos} /></Field>
          <Field label="Valor" required error={errores.value} hint={["PHONE", "YAPE", "PLIN"].includes(d.identifier_type) ? "9 dígitos o con el código de país." : d.identifier_type === "CCI" ? "20 dígitos." : undefined}>
            <Input maxLength={120} value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} />
          </Field>
          <Field label="Descripción" required error={errores.label} className="sm:col-span-2"><Input maxLength={120} value={d.label} onChange={(e) => setD({ ...d, label: e.target.value })} /></Field>
          <Field label="Marca" error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} placeholder="Todas las marcas" options={opciones.marcas} /></Field>
          <Field label="Estado" required error={errores.status}><Select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        </>
      )}
    </Dialogo>
  );
}

function Probar() {
  const [texto, setTexto] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function probar() {
    setEnviando(true);
    try {
      setHits((await api<{ data: Hit[] }>("/v1/crm/reglas/probar", { method: "POST", body: { texto } })).data);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
      <Field label="Texto de prueba" hint="No crea ninguna alerta: solo muestra cuáles daría.">
        <Textarea rows={4} maxLength={4096} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Por ejemplo: «Mejor escríbeme a mi número 987 654 321, te lo dejo más barato por fuera»" />
      </Field>
      <div><Button variant="primary" icon={FlaskConical} loading={enviando} disabled={!texto.trim()} onClick={probar}>Probar</Button></div>
      {hits && (hits.length === 0 ? <Alert tone="ok">Sin alertas: el texto respeta el canal oficial.</Alert> : (
        <div className="grid gap-2">
          {hits.map((h, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
              <Badge tone={GRAVEDAD[h.severity] ?? "neutral"}>{h.gravedad}</Badge><b>{h.name}</b><span className="text-muted">{h.tipo}</span><span className="font-semibold text-bad">«{h.coincidencia}»</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
