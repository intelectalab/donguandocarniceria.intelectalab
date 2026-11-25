"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, PhoneCall, Power, RotateCcw, Settings2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Paso = { no: number; code: string; nombre: string; descripcion: string; done: boolean; done_at: string | null; done_by_name: string | null; notes: string | null };
type Activacion = {
  encendido: boolean; etapa: "SETUP" | "LIVE"; etapa_name: string; en_vivo_desde: string | null; en_vivo_por: string | null; motivo_configuracion: string | null;
  proveedor: string; hechos: number; total: number; pasos: Paso[]; puede: boolean; responsables: Opcion[];
};

/**
 * TEL-01 Lista de activación: los 6 pasos para encender la central con responsable, fecha y evidencia. Al encender en
 * Módulos activables queda en configuración (se prepara todo, sin cursar llamadas); con los 6 pasos se pasa a en vivo.
 */
export default function Activacion() {
  const encendida = useTelefonia();
  const [a, setA] = useState<Activacion | null>(null);
  const [error, setError] = useState("");
  const [marcar, setMarcar] = useState<Paso | null>(null);
  const [volver, setVolver] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(() => {
    if (!encendida) return;
    api<Activacion>("/v1/tel/activacion").then((r) => { setA(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [encendida]);
  useEffect(() => cargar(), [cargar]);

  async function enVivo() {
    setOcupado(true);
    try {
      setA(await api<Activacion>("/v1/tel/activacion/en-vivo", { method: "POST" }));
      toast.ok("Telefonía en vivo: ya se pueden cursar llamadas");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  }

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Los 6 pasos para encender la central de llamadas." /><TelefoniaApagada /></div>;
  const columnas: Column<Paso>[] = [
    { key: "no", header: "Paso", align: "center", render: (p) => <span className="tabular-nums font-semibold">{p.no}</span> },
    { key: "nombre", header: "Qué se hace", cardTitle: true, render: (p) => <div><p className="font-semibold text-ink">{p.nombre}</p><p className="text-[12px] text-muted">{p.descripcion}</p></div> },
    { key: "status", header: "Estado", render: (p) => p.done ? <Badge tone="ok">Hecho</Badge> : <Badge tone="warn">Pendiente</Badge> },
    { key: "responsable", header: "Responsable", render: (p) => <span className="text-[12.5px]">{p.done_by_name ?? "—"}</span> },
    { key: "fecha", header: "Fecha", render: (p) => <span className="whitespace-nowrap text-[12.5px]">{p.done_at ? fechaHora(p.done_at) : "—"}</span> },
    { key: "notes", header: "Evidencia", hideOnMobile: true, render: (p) => <span className="line-clamp-2 max-w-[320px] text-[12.5px] text-muted">{p.notes ?? "—"}</span> },
    { key: "acciones", header: "", align: "right", render: (p) => a?.puede && p.code !== "SWITCH_ON" ? (
      <div onClick={(e) => e.stopPropagation()}><Button size="sm" variant={p.done ? "ghost" : "primary"} onClick={() => setMarcar(p)}>{p.done ? "Actualizar" : "Marcar hecho"}</Button></div>) : null },
  ];
  const vivo = a?.etapa === "LIVE";
  return (
    <div className="grid gap-5">
      <PageHeader description="Los 6 pasos para que la central de llamadas funcione: cada uno con responsable, fecha y evidencia. Al encender Telefonía queda en configuración, donde se prepara todo sin cursar llamadas; con los 6 pasos se pasa a en vivo."
        actions={a?.puede ? (vivo
          ? <Button icon={RotateCcw} onClick={() => setVolver(true)}>Volver a configuración</Button>
          : <Button variant="primary" icon={Power} loading={ocupado} disabled={a.hechos < a.total} title={a.hechos < a.total ? "Faltan pasos de la lista" : undefined} onClick={enVivo}>Pasar a en vivo</Button>) : undefined} />
      {error && <Alert tone="bad">{error}</Alert>}
      {a && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Cifra titulo="Etapa" valor={a.etapa_name} icono={PhoneCall} destacada detalle={vivo ? `Desde el ${fechaHora(a.en_vivo_desde)}` : "Sin cursar llamadas"} />
            <Cifra titulo="Lista de activación" valor={`${a.hechos} de ${a.total}`} icono={CheckCircle2} tono={a.hechos === a.total ? "ok" : "warn"} detalle={a.hechos === a.total ? "Completa" : "Pasos pendientes"} />
            <Cifra titulo="Proveedor" valor={a.proveedor} icono={Settings2} detalle="Se cambia en Ajustes" />
          </div>
          {!vivo && a.motivo_configuracion && <Alert tone="info">Volvió a configuración: {a.motivo_configuracion}</Alert>}
          {vivo && <Alert tone="ok">En vivo desde el {fechaHora(a.en_vivo_desde)}{a.en_vivo_por ? `, por ${a.en_vivo_por}` : ""}. Las llamadas entran y salen por los números de la central.</Alert>}
          {!a.puede && <Alert tone="warn">Marcar pasos y pasar a en vivo lo hace el administrador del sistema.</Alert>}
          <ol className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {a.pasos.map((p) => (
              <li key={p.code} className={`flex items-start gap-2 rounded-xl border p-3 text-[12.5px] shadow-card ${p.done ? "border-ok/40 bg-surface" : "border-line bg-surface"}`}>
                {p.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" />}
                <span><b className="text-ink">{p.no}. {p.nombre}</b><span className="block text-muted">{p.done ? `${p.done_by_name ?? ""} · ${fechaHora(p.done_at)}` : "Pendiente"}</span></span>
              </li>
            ))}
          </ol>
        </>
      )}
      <DataTable columns={columnas} rows={a?.pasos ?? []} rowKey={(p) => p.code} loading={!a && !error} error={error} onRetry={cargar} empty="Sin pasos." />
      <Alert tone="info">El paso 6, «Encendido», se marca solo al encender Telefonía en Módulos activables. Apagarla la devuelve a configuración: se conserva todo lo registrado y vuelve a bloquear las llamadas.</Alert>
      {marcar && a && <MarcarPaso paso={marcar} responsables={a.responsables} onClose={() => setMarcar(null)} onListo={(x) => { setMarcar(null); setA(x); }} />}
      {volver && <VolverAConfiguracion onClose={() => setVolver(false)} onListo={(x) => { setVolver(false); setA(x); }} />}
    </div>
  );
}

function MarcarPaso({ paso, responsables, onClose, onListo }: { paso: Paso; responsables: Opcion[]; onClose: () => void; onListo: (a: Activacion) => void }) {
  const [d, setD] = useState({ evidencia: paso.notes ?? "", responsable: "" });
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      onListo(await api<Activacion>(`/v1/tel/activacion/pasos/${paso.code}`, { method: "POST", body: { evidencia: d.evidencia, responsable: d.responsable || null } }));
      toast.ok("Paso marcado");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Paso ${paso.no}: ${paso.nombre}`} description={paso.descripcion}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={d.evidencia.trim().length < 5} onClick={guardar}>Marcar hecho</Button></>}>
      <div className="grid gap-3">
        <Field label="Responsable" hint="Si lo dejas vacío, quedas tú."><Select value={d.responsable} onChange={(e) => setD({ ...d, responsable: e.target.value })} placeholder="Yo" options={responsables} /></Field>
        <Field label="Evidencia" required hint="Qué se hizo y dónde está el respaldo (contrato, constancia del operador, política firmada…).">
          <Textarea rows={3} maxLength={1000} value={d.evidencia} onChange={(e) => setD({ ...d, evidencia: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function VolverAConfiguracion({ onClose, onListo }: { onClose: () => void; onListo: (a: Activacion) => void }) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      onListo(await api<Activacion>("/v1/tel/activacion/configuracion", { method: "POST", body: { motivo } }));
      toast.ok("Telefonía en configuración: ya no se cursan llamadas");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Volver a configuración" description="Mientras esté en configuración no entran ni salen llamadas. Úsalo, por ejemplo, para cambiar de proveedor."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={enviando} disabled={motivo.trim().length < 10} onClick={guardar}>Volver a configuración</Button></>}>
      <Field label="Motivo" required hint="Al menos 10 caracteres. Queda registrado."><Textarea rows={3} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </Modal>
  );
}
