"use client";

import { useState } from "react";
import { MessageSquareOff, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, opciones, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { BuscarCliente, type ClienteBuscado } from "@/modulos/cmp/BuscarCliente";
import { FUENTE_CONSENTIMIENTO, type Opciones } from "@/modulos/cmp/tipos";

type Registro = { id: string; customer_id: string; granted: boolean; channel: string; evidence_text: string | null; recorded_at: string; brand_id: string | null; source: string;
  full_name: string; phone: string | null; brand_name: string | null };
type Resp = { data: Registro[]; summary: { brand: string; brand_id: string; granted: number; revoked: number; keyword: number }[]; by_campaign: { id: string; code: string; name: string; optouts: number }[] };

/** CMP-11 Consentimientos por marca: quién acepta promociones de cada marca, de dónde salió la autorización y las bajas por campaña. */
export default function Consentimientos() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [marca, setMarca] = useState("");
  const [fuente, setFuente] = useState("");
  const [acepta, setAcepta] = useState("");
  const [q, setQ] = useState("");
  const r = useDatos<Resp>(`/v1/cmp/consentimientos${qs({ brand_id: marca, source: fuente, granted: acepta, q })}`);
  const [dialogo, setDialogo] = useState<"registrar" | "baja" | null>(null);
  const gestiona = Boolean(op?.can["crm.consent.manage"] || op?.can["cmp.campaign.manage"]);

  const columnas: Column<Registro>[] = [
    { key: "full_name", header: "Cliente", cardTitle: true, render: (x) => <div><p className="font-semibold">{x.full_name}</p><Sub>{x.phone ?? "Sin teléfono"}</Sub></div> },
    { key: "brand_name", header: "Marca", render: (x) => x.brand_name ?? "Todas las marcas" },
    { key: "granted", header: "Promociones", render: (x) => x.granted ? <Badge tone="ok">Acepta</Badge> : <Badge tone="bad">No acepta</Badge> },
    { key: "source", header: "Origen", render: (x) => <div>{FUENTE_CONSENTIMIENTO[x.source] ?? x.source}<Sub>{fechaHora(x.recorded_at)}</Sub></div> },
    { key: "evidence_text", header: "Evidencia", hideOnMobile: true, render: (x) => <span className="block max-w-[340px] text-[12.5px]">{x.evidence_text ?? "—"}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Solo reciben campañas los clientes que aceptaron promociones de esa marca. Vale el registro más reciente: una baja por palabra clave detiene los envíos de inmediato."
        actions={gestiona && <>
          <Button icon={MessageSquareOff} disabled={!op} onClick={() => setDialogo("baja")}>Probar baja por palabra</Button>
          <Button variant="primary" icon={ShieldCheck} disabled={!op} onClick={() => setDialogo("registrar")}>Registrar consentimiento</Button>
        </>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(r.datos?.summary ?? []).map((s) => (
          <button key={s.brand_id} type="button" onClick={() => setMarca(marca === s.brand_id ? "" : s.brand_id)}
            className={`rounded-xl border bg-surface p-4 text-left transition hover:-translate-y-px ${marca === s.brand_id ? "border-primary" : "border-border"}`}>
            <p className="font-semibold">{s.brand}</p>
            <p className="mt-1 text-[22px] font-semibold tabular-nums">{numero(s.granted)} <span className="text-[13px] font-normal text-muted">aceptan</span></p>
            <Sub>{numero(s.revoked)} no aceptan · {numero(s.keyword)} bajas por palabra</Sub>
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay registros con esos filtros."
          toolbar={<>
            <Input aria-label="Buscar" placeholder="Buscar cliente o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-[220px]" />
            <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
            <FiltroSelect label="Origen" value={fuente} onChange={setFuente} options={opciones(FUENTE_CONSENTIMIENTO)} />
            <FiltroSelect label="Promociones" value={acepta} onChange={setAcepta} options={[{ value: "1", label: "Acepta" }, { value: "0", label: "No acepta" }]} />
          </>} />
        <Panel titulo="Bajas por campaña">
          {(r.datos?.by_campaign ?? []).length === 0 ? <p className="text-muted">Ninguna campaña generó bajas.</p> : (
            <ul className="space-y-2.5">
              {r.datos!.by_campaign.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="font-mono text-[12.5px]">{c.code}</p><Sub>{c.name}</Sub></div>
                  <Badge tone={c.optouts ? "warn" : "neutral"}>{numero(c.optouts)}</Badge>
                </li>
              ))}
            </ul>
          )}
          {op && <p className="mt-4 text-[12.5px] text-muted">Palabras de baja: {op.params.optout_keywords.join(", ")}.</p>}
        </Panel>
      </div>
      {dialogo === "registrar" && op && <Registrar op={op} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); r.recargar(); }} />}
      {dialogo === "baja" && op && <ProbarBaja op={op} onClose={() => { setDialogo(null); r.recargar(); }} />}
    </div>
  );
}

function Registrar({ op, onClose, onHecho }: { op: Opciones; onClose: () => void; onHecho: () => void }) {
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  const [f, setF] = useState({ brand_id: "", granted: "1", evidence: "" });
  return (
    <Dialogo titulo="Registrar consentimiento" boton="Registrar" onClose={onClose}
      aviso="Anota de dónde sale la autorización (por ejemplo, lo que el cliente escribió). Este registro reemplaza al anterior para esa marca."
      enviar={async () => {
        await api("/v1/cmp/consentimientos", { method: "POST", body: { customer_id: cliente?.id ?? null, brand_id: f.brand_id || null, granted: f.granted === "1", evidence: f.evidence || null } });
        toast.ok("Consentimiento registrado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Cliente" required error={e.customer_id} className="sm:col-span-2"><BuscarCliente valor={cliente} onChange={setCliente} /></Field>
        <Field label="Marca" error={e.brand_id}><Select value={f.brand_id} onChange={(x) => setF({ ...f, brand_id: x.target.value })} placeholder="Todas las marcas" options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Promociones" required error={e.granted}><Select value={f.granted} onChange={(x) => setF({ ...f, granted: x.target.value })} options={[{ value: "1", label: "Acepta" }, { value: "0", label: "No acepta" }]} /></Field>
        <Field label="Evidencia" error={e.evidence} className="sm:col-span-2"><Textarea rows={2} value={f.evidence} onChange={(x) => setF({ ...f, evidence: x.target.value })} placeholder="Ej.: respondió «sí, envíenme ofertas» el 12/10" /></Field>
      </>}
    </Dialogo>
  );
}

function ProbarBaja({ op, onClose }: { op: Opciones; onClose: () => void }) {
  const [cliente, setCliente] = useState<ClienteBuscado | null>(null);
  const [f, setF] = useState({ brand_id: op.brands[0]?.id ?? "", text: op.params.optout_keywords[0] ?? "BAJA" });
  const [res, setRes] = useState<{ optout: boolean } | null>(null);
  return (
    <Dialogo titulo="Probar baja por palabra" boton={res ? "Probar otra vez" : "Simular mensaje"} onClose={onClose}
      aviso="Simula un mensaje que el cliente escribe al número de la marca. Si contiene una palabra de baja, deja de recibir promociones de esa marca y se le confirma por WhatsApp."
      enviar={async () => {
        setRes(await api("/v1/cmp/mensajes/entrante", { method: "POST", body: { customer_id: cliente?.id ?? null, brand_id: f.brand_id, text: f.text } }));
      }}>
      {(e) => <>
        <Field label="Cliente" required error={e.customer_id} className="sm:col-span-2"><BuscarCliente valor={cliente} onChange={(c) => { setCliente(c); setRes(null); }} /></Field>
        <Field label="Marca" required error={e.brand_id}><Select value={f.brand_id} onChange={(x) => { setF({ ...f, brand_id: x.target.value }); setRes(null); }} options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
        <Field label="Mensaje" required error={e.text}><Input value={f.text} onChange={(x) => { setF({ ...f, text: x.target.value }); setRes(null); }} /></Field>
        {res && <div className="sm:col-span-2">{res.optout
          ? <Alert tone="ok" title="Baja registrada">{cliente?.full_name} ya no recibirá promociones de esta marca.</Alert>
          : <Alert tone="info" title="No es una baja">El mensaje no contiene una palabra de baja; queda como conversación normal.</Alert>}</div>}
      </>}
    </Dialogo>
  );
}
