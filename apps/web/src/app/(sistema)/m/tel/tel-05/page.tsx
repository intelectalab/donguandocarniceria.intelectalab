"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search } from "lucide-react";
import { Alert, Badge, Button, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Miembro = { id: string; user_id: string; nombre: string; priority: number; active: boolean; usuario_activo: boolean };
type Grupo = {
  id: string; name: string; brand_id: string; marca: string; strategy: string; estrategia: string; ring_timeout_s: number; miembros: Miembro[];
  plan: { nombres: string[]; desde: number; hasta: number }[]; numeros: string[];
};
type Lista = { data: Grupo[]; opciones: { marcas: Opcion[]; estrategias: Opcion[]; sin_grupo: Opcion[] }; puede: boolean };

/**
 * TEL-05 Grupos de llamada: las vendedoras de cada marca con su prioridad. Por turno, cada una suena unos segundos en
 * orden; todas a la vez, suenan juntas. Si nadie contesta, la llamada va al buzón o queda perdida según el menú.
 */
export default function Grupos() {
  const encendida = useTelefonia();
  const [f, setF] = useState({ marca: "", estrategia: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState<Grupo | "nuevo" | null>(null);
  const [agregar, setAgregar] = useState<Grupo | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);
  const cargar = useCallback(() => {
    if (!encendida) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/tel/grupos${q ? `?${q}` : ""}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, encendida]);
  useEffect(() => cargar(), [cargar]);

  async function cambiar(m: Miembro, cuerpo: Record<string, unknown>) {
    try {
      await api(`/v1/tel/miembros/${m.id}`, { method: "PUT", body: cuerpo });
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Las vendedoras de cada marca que atienden las llamadas." /><TelefoniaApagada /></div>;
  return (
    <div className="grid gap-5">
      <PageHeader description="Las vendedoras de cada marca que atienden las llamadas, en orden de prioridad. Por turno, cada una suena unos segundos y pasa a la siguiente; todas a la vez, suenan juntas. Si nadie contesta, la llamada va al buzón o queda como perdida." />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="relative w-full sm:w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Buscar" className="pl-9" placeholder="Buscar grupo, marca o vendedora…" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <div className="w-full sm:w-[180px]"><FiltroSelect etiqueta="Marca" todos="todas" ancho={180} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={lista?.opciones.marcas ?? []} /></div>
        <div className="w-full sm:w-[180px]"><FiltroSelect etiqueta="Estrategia" todos="todas" ancho={180} value={f.estrategia} onChange={(v) => setF({ ...f, estrategia: v })} options={lista?.opciones.estrategias ?? []} /></div>
        {lista?.puede && lista.opciones.sin_grupo.length > 0 && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Nuevo grupo</Button>}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {lista && lista.data.length === 0 && <p className="rounded-xl border border-line bg-surface p-6 text-center text-[13px] text-muted">Ningún grupo con estos filtros.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {lista?.data.map((g) => (
          <section key={g.id} className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-[15px] font-semibold text-ink">{g.name}</h2><p className="text-[12px] text-muted">{g.marca}{g.numeros.length ? ` · número directo ${g.numeros.join(", ")}` : ""}</p></div>
              <div className="flex flex-wrap gap-1.5"><Badge tone="info">{g.estrategia}</Badge><Badge tone="neutral">{g.ring_timeout_s} s{g.strategy === "ROUND_ROBIN" ? " por vendedora" : ""}</Badge></div>
            </div>
            <ol className="grid gap-1">
              {g.miembros.map((m, i) => (
                <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]">
                  <span className="w-6 text-center tabular-nums text-muted">{m.priority}</span>
                  <span className={`flex-1 ${m.active ? "text-ink" : "text-muted line-through"}`}>{m.nombre}{!m.usuario_activo && <span className="ml-1 text-[11px] text-bad">(usuario inactivo)</span>}</span>
                  {m.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="neutral">Pausada</Badge>}
                  {lista.puede && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" icon={ArrowUp} aria-label={`Subir a ${m.nombre}`} title="Subir en la prioridad" disabled={i === 0} onClick={() => cambiar(m, { mover: "subir" })} />
                      <Button size="sm" variant="ghost" icon={ArrowDown} aria-label={`Bajar a ${m.nombre}`} title="Bajar en la prioridad" disabled={i === g.miembros.length - 1} onClick={() => cambiar(m, { mover: "bajar" })} />
                      <Button size="sm" variant="ghost" onClick={() => cambiar(m, { active: !m.active })}>{m.active ? "Pausar" : "Activar"}</Button>
                    </span>
                  )}
                </li>
              ))}
              {g.miembros.length === 0 && <li className="text-[12.5px] text-muted">Sin vendedoras: las llamadas de la marca no sonarán en nadie.</li>}
            </ol>
            <p className="text-[12px] text-muted">
              <b className="text-ink">Orden de timbre:</b>{" "}
              {g.plan.length ? g.plan.map((p) => `${p.nombres.join(" + ")} (${p.desde}–${p.hasta} s)`).join(" → ") : "nadie activo"} → buzón o llamada perdida.
            </p>
            {lista.puede && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setEditar(g)}>Editar grupo</Button>
                <Button size="sm" icon={Plus} onClick={() => setAgregar(g)}>Agregar vendedora</Button>
              </div>
            )}
          </section>
        ))}
      </div>
      {editar && lista && <EditarGrupo g={editar === "nuevo" ? null : editar} o={lista.opciones} onClose={() => setEditar(null)} onListo={() => { setEditar(null); cargar(); }} />}
      {agregar && <Agregar g={agregar} onClose={() => setAgregar(null)} onListo={() => { setAgregar(null); cargar(); }} />}
    </div>
  );
}

function EditarGrupo({ g, o, onClose, onListo }: { g: Grupo | null; o: Lista["opciones"]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ brand_id: g?.brand_id ?? o.sin_grupo[0]?.value ?? "", name: g?.name ?? "", strategy: g?.strategy ?? "ROUND_ROBIN", ring_timeout_s: String(g?.ring_timeout_s ?? 25) });
  return (
    <Dialogo titulo={g ? g.name : "Nuevo grupo de llamada"} boton="Guardar" onClose={onClose} aviso="Cada marca tiene un solo grupo."
      enviar={async () => {
        await api(g ? `/v1/tel/grupos/${g.id}` : "/v1/tel/grupos", { method: g ? "PUT" : "POST", body: { ...d, ring_timeout_s: Number(d.ring_timeout_s), brand_id: g ? null : d.brand_id } });
        toast.ok("Grupo guardado");
        onListo();
      }}>
      {(errores) => (
        <>
          {!g && <Field label="Marca" required error={errores.brand_id}><Select value={d.brand_id} onChange={(e) => setD({ ...d, brand_id: e.target.value })} options={o.sin_grupo} /></Field>}
          <Field label="Nombre" required error={errores.name}><Input maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Vendedoras de la marca" /></Field>
          <Field label="Estrategia" required error={errores.strategy}><Select value={d.strategy} onChange={(e) => setD({ ...d, strategy: e.target.value })} options={o.estrategias} /></Field>
          <Field label="Segundos que suena" required error={errores.ring_timeout_s} hint="De 5 a 120; por turno, es el tiempo de cada vendedora.">
            <Input type="number" min={5} max={120} value={d.ring_timeout_s} onChange={(e) => setD({ ...d, ring_timeout_s: e.target.value })} />
          </Field>
        </>
      )}
    </Dialogo>
  );
}

function Agregar({ g, onClose, onListo }: { g: Grupo; onClose: () => void; onListo: () => void }) {
  const [candidatos, setCandidatos] = useState<Opcion[] | null>(null);
  const [usuario, setUsuario] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    api<{ data: Opcion[] }>(`/v1/tel/grupos/${g.id}/candidatos`).then((r) => setCandidatos(r.data)).catch(() => setCandidatos([]));
  }, [g.id]);
  async function guardar() {
    setEnviando(true);
    try {
      await api(`/v1/tel/grupos/${g.id}/miembros`, { method: "POST", body: { user_id: usuario } });
      toast.ok("Vendedora agregada al final de la prioridad");
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Agregar a ${g.name}`} description={`Vendedoras de ${g.marca} (o de todas las marcas) y supervisoras de ventas.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={!usuario} onClick={guardar}>Agregar</Button></>}>
      {candidatos === null ? <p className="text-[13px] text-muted">Cargando…</p> : candidatos.length === 0
        ? <Alert tone="info">No hay más vendedoras de esta marca para agregar. Para sumar a otra, primero dale la marca en Usuarios.</Alert>
        : <Field label="Persona" required><Select value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Elige" options={candidatos} /></Field>}
    </Modal>
  );
}
