"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleCheck, CircleOff, Copy, ListOrdered, Pencil, Plus, Tags } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { ListaForm } from "@/modulos/cat/ListaForm";
import { CANALES, ESTADOS_LISTA, TIPOS_CLIENTE, alcance, type ListaPrecio } from "@/modulos/cat/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], DRAFT: ["Borrador", "warn"], INACTIVE: ["Inactiva", "neutral"] };
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const corto = (v: string[], o: { value: string; label: string }[]) => v.length > 3 ? `${alcance(v.slice(0, 2), o)} y ${v.length - 2} más` : alcance(v, o);
const vigencia = (l: ListaPrecio) => `${fecha(l.valid_from)} – ${l.valid_to ? fecha(l.valid_to) : "sin fin"}`;

/** CAT-05 Listas de precio: por marca, canal y tipo de cliente, con vigencia y prioridad. */
export default function ListasDePrecio() {
  const router = useRouter();
  const { me, marca, can } = useSesion();
  const puedeEditar = can("cat.price.manage");
  const [datos, setDatos] = useState<ListaPrecio[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [buscar, setBuscar] = useState("");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [estado, setEstado] = useState("");
  const [abierta, setAbierta] = useState<ListaPrecio | null>(null);
  const [dialogo, setDialogo] = useState<{ tipo: "editar" | "copiar" | "programar"; lista: ListaPrecio | null } | null>(null);
  const brand = marca !== "ALL" ? marca : marcaFiltro;

  useEffect(() => {
    let vigente = true;
    api<ListaPrecio[]>(`/v1/cat/listas${brand ? `?brand_id=${brand}` : ""}`)
      .then((l) => { if (vigente) { setDatos(l); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [brand, version]);
  const recargar = () => setVersion((n) => n + 1);

  const filas = useMemo(() => datos ?? [], [datos]);
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return filas.filter((l) => (!estado || l.status === estado) && (!q || l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));
  }, [filas, buscar, estado]);
  const h = hoy();
  const cargando = datos === null && !error;

  const columnas: Column<ListaPrecio>[] = [
    { key: "code", header: "Código", render: (l) => <span className="whitespace-nowrap font-mono font-semibold">{l.code}</span> },
    { key: "name", header: "Lista", cardTitle: true, render: (l) => <div className="min-w-[180px]">{l.name}</div> },
    { key: "brand", header: "Marca", render: (l) => l.brand_name ? <Badge tone="primary">{l.brand_name}</Badge> : <span className="text-muted">Todas</span> },
    { key: "channels", header: "Canales", hideOnMobile: true, render: (l) => <span className="text-[12.5px]" title={alcance(l.channels, CANALES)}>{corto(l.channels, CANALES)}</span> },
    { key: "customer_types", header: "Tipo de cliente", hideOnMobile: true, render: (l) => <span className="text-[12.5px]">{alcance(l.customer_types, TIPOS_CLIENTE)}</span> },
    { key: "priority", header: "Prioridad", align: "right", render: (l) => <span className="tabular-nums">{l.priority ?? 100}</span> },
    { key: "igv", header: "IGV", hideOnMobile: true, render: (l) => l.includes_igv ? "Incluido" : "Sin IGV" },
    { key: "vigencia", header: "Vigencia", hideOnMobile: true, render: (l) => <span className="whitespace-nowrap text-[12.5px]">{vigencia(l)}</span> },
    { key: "vigentes", header: "Precios", align: "right", render: (l) => (
      <span className="tabular-nums">{numero(l.vigentes)}{l.programados > 0 && <span className="text-muted"> (+{l.programados})</span>}</span>
    ) },
    { key: "status", header: "Estado", render: (l) => <StatusBadge status={l.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Por marca, canal y tipo de cliente, con vigencia y prioridad (menor número gana). Copia una lista, programa una nueva vigencia o mira cuál aplica a un caso."
        actions={<>
          <Button icon={ListOrdered} onClick={() => router.push("/m/cat/cat-07")}>¿Qué lista aplica?</Button>
          {puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setDialogo({ tipo: "editar", lista: null })}>Nueva lista</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Listas activas" icono={Tags} destacada valor={cargando ? undefined : numero(filas.filter((l) => l.status === "ACTIVE").length)} detalle="Se usan para vender" />
        <Cifra titulo="Programadas o en borrador" valor={cargando ? undefined : numero(filas.filter((l) => l.status === "DRAFT" || (l.valid_from ?? "") > h).length)} detalle="Aún no se usan" />
        <Cifra titulo="Precios vigentes" valor={cargando ? undefined : numero(filas.reduce((s, l) => s + l.vigentes, 0))} detalle="En todas las listas" />
        <Cifra titulo="Cambios programados" icono={CalendarClock} valor={cargando ? undefined : numero(filas.reduce((s, l) => s + l.programados, 0))} detalle="Precios con vigencia futura" />
      </div>

      <Alert tone="info">D-CAT-03 (valor provisional): una lista por canal, inicialmente con los mismos precios en la web y en WhatsApp.</Alert>

      <DataTable columns={columnas} rows={visibles} rowKey={(l) => l.id} loading={cargando} error={error} onRetry={recargar}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por código o nombre…" }}
        onRowClick={(l) => setAbierta(l)} empty="No hay listas con esos filtros."
        toolbar={<>
          {marca === "ALL" && me.brands.length > 1 && (
            <div className="w-44"><Select value={marcaFiltro} onChange={(e) => setMarcaFiltro(e.target.value)} placeholder="Marca: todas" options={me.brands.map((b) => ({ value: b.id, label: b.name }))} /></div>
          )}
          <div className="w-40"><Select value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Estado: todos" options={ESTADOS_LISTA} /></div>
        </>} />

      {abierta && (
        <Detalle id={abierta.id} puedeEditar={puedeEditar} onClose={() => setAbierta(null)}
          onPrecios={(id) => router.push(`/m/cat/cat-06?lista=${id}`)}
          onDialogo={(tipo, l) => { setAbierta(null); setDialogo({ tipo, lista: l }); }}
          onCambio={recargar} />
      )}
      {dialogo?.tipo === "editar" && (
        <ListaForm lista={dialogo.lista} marcas={me.brands} marcaPorDefecto={brand || (me.brands[0]?.id ?? "")}
          onClose={() => setDialogo(null)}
          onGuardada={(id) => { setDialogo(null); recargar(); if (!dialogo.lista) router.push(`/m/cat/cat-06?lista=${id}`); }} />
      )}
      {dialogo?.tipo === "copiar" && dialogo.lista && (
        <Copiar lista={dialogo.lista} onClose={() => setDialogo(null)} onHecho={(id) => { setDialogo(null); router.push(`/m/cat/cat-06?lista=${id}`); }} />
      )}
      {dialogo?.tipo === "programar" && dialogo.lista && (
        <Programar lista={dialogo.lista} onClose={() => setDialogo(null)} onHecho={(id) => { setDialogo(null); router.push(`/m/cat/cat-06?lista=${id}&cuando=FUTURE`); }} />
      )}
    </div>
  );
}

/** Ficha de una lista con sus acciones. */
function Detalle({ id, puedeEditar, onClose, onPrecios, onDialogo, onCambio }: {
  id: string; puedeEditar: boolean; onClose: () => void; onPrecios: (id: string) => void;
  onDialogo: (tipo: "editar" | "copiar" | "programar", l: ListaPrecio) => void; onCambio: () => void;
}) {
  const [l, setL] = useState<ListaPrecio | null>(null);
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    api<ListaPrecio>(`/v1/cat/listas/${id}`).then((d) => vigente && setL(d)).catch((err) => toast.error(mensajeDe(err)));
    return () => { vigente = false; };
  }, [id, version]);

  async function estado(status: string) {
    setOcupado(true);
    try {
      await api(`/v1/cat/listas/${id}/estado`, { method: "PUT", body: { status } });
      toast.ok(status === "ACTIVE" ? "Lista activada" : "Lista inactivada");
      setVersion((n) => n + 1); onCambio();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={l ? l.name : "Lista de precio"}
      footer={l && <>
        {puedeEditar && (l.status === "ACTIVE"
          ? <Button icon={CircleOff} onClick={() => estado("INACTIVE")} disabled={ocupado}>Inactivar</Button>
          : <Button icon={CircleCheck} onClick={() => estado("ACTIVE")} disabled={ocupado}>Activar</Button>)}
        {puedeEditar && <Button icon={Copy} onClick={() => onDialogo("copiar", l)}>Copiar</Button>}
        {puedeEditar && <Button icon={CalendarClock} onClick={() => onDialogo("programar", l)}>Programar vigencia</Button>}
        {puedeEditar && <Button icon={Pencil} onClick={() => onDialogo("editar", l)}>Editar</Button>}
        <Button variant="primary" onClick={() => onPrecios(l.id)}>Ver precios</Button>
      </>}>
      {!l ? <p className="text-muted">Cargando…</p> : (
        <div className="space-y-5">
          {l.status !== "ACTIVE" && <Alert tone="warn">La lista está {l.status === "DRAFT" ? "en borrador" : "inactiva"}: no se usa para vender hasta activarla.</Alert>}
          <DetailList items={[
            { label: "Código", value: <span className="font-mono">{l.code}</span> },
            { label: "Marca", value: l.brand_name ?? "Todas" },
            { label: "Canales", value: alcance(l.channels, CANALES) },
            { label: "Tipo de cliente", value: alcance(l.customer_types, TIPOS_CLIENTE) },
            { label: "Prioridad", value: l.priority ?? 100 },
            { label: "IGV", value: l.includes_igv ? "Incluido en el precio" : "Sin IGV" },
            { label: "Vigencia", value: vigencia(l) },
            { label: "Estado", value: <StatusBadge status={l.status} labels={ESTADOS} /> },
          ]} />
          <div className="grid grid-cols-3 gap-3">
            <Cifra titulo="Vigentes hoy" valor={numero(l.vigentes)} />
            <Cifra titulo="Programados" valor={numero(l.programados)} />
            <Cifra titulo="Históricos" valor={numero(l.historicos ?? 0)} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Copia la lista en borrador con sus precios vigentes y un ajuste en %. */
function Copiar({ lista, onClose, onHecho }: { lista: ListaPrecio; onClose: () => void; onHecho: (id: string) => void }) {
  const [v, setV] = useState({ code: `${lista.code}-2`.slice(0, 20), name: `${lista.name} (copia)`, pct: "0", valid_from: lista.valid_from && lista.valid_from > hoy() ? lista.valid_from : hoy(), priority: String(lista.priority ?? 100) });
  return (
    <Dialogo titulo={`Copiar ${lista.code}`} boton="Copiar lista" onClose={onClose}
      enviar={async () => {
        const r = await api<{ id: string; items: number; code: string }>(`/v1/cat/listas/${lista.id}/copiar`, { method: "POST", body: { ...v, pct: Number(v.pct), priority: Number(v.priority) } });
        toast.ok(`Lista ${r.code} creada en borrador con ${r.items} precios`);
        onHecho(r.id);
      }}>
      {(errores) => <>
        <Field label="Código nuevo" required error={errores.code}><Input value={v.code} maxLength={20} className="font-mono uppercase" onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} /></Field>
        <Field label="Nombre" required error={errores.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Ajuste de precios (%)" error={errores.pct} hint="Ej.: 5 sube 5 %; -3 baja 3 %."><Input type="number" step="0.1" value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} /></Field>
        <Field label="Vigente desde" required error={errores.valid_from}><Input type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} /></Field>
        <Field label="Prioridad" error={errores.priority}><Input type="number" min={0} value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

/** Programa una nueva vigencia de toda la lista con un ajuste (RN-CAT-06). */
function Programar({ lista, onClose, onHecho }: { lista: ListaPrecio; onClose: () => void; onHecho: (id: string) => void }) {
  const d = new Date(); d.setMonth(d.getMonth() + 1, 1);
  const [v, setV] = useState({ valid_from: d.toLocaleDateString("en-CA"), pct: "5", reason: "" });
  return (
    <Dialogo titulo={`Programar nueva vigencia · ${lista.name}`} boton="Programar" onClose={onClose}
      aviso="Cada precio vigente se cierra el día anterior y se abre otro con el ajuste, sin superponer vigencias (RN-CAT-06)."
      enviar={async () => {
        const r = await api<{ items: number }>(`/v1/cat/listas/${lista.id}/programar`, { method: "POST", body: { ...v, pct: Number(v.pct) } });
        toast.ok(`${r.items} precios programados desde el ${fecha(v.valid_from)}`);
        onHecho(lista.id);
      }}>
      {(errores) => <>
        <Field label="Nueva vigencia desde" required error={errores.valid_from}><Input type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} /></Field>
        <Field label="Ajuste (%)" required error={errores.pct}><Input type="number" step="0.1" value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} /></Field>
        <Field label="Motivo" required error={errores.reason} className="sm:col-span-2"><Input value={v.reason} maxLength={80} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Ej.: Alza del proveedor" /></Field>
      </>}
    </Dialogo>
  );
}
