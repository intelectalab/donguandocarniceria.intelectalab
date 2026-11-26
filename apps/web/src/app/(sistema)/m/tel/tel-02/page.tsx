"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Upload } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Tarifas = { out_mobile: number; out_landline: number; inbound: number; recording: number; transcription: number };
type Ajustes = {
  provider: string; connector_id: string | null; stage: string; stage_name: string; recording_enabled: boolean; recording_notice_text: string | null; ring_strategy: string;
  retention_days: number; callback_due_minutes: number; ring_timeout_s: number; transcription_enabled: boolean; outbound_registered_only: boolean; tarifas: Tarifas;
  audio: { id: string; nombre: string; bytes: number; subido: string; por: string } | null; central: string | null;
  conectores: (Opcion & { status: string })[]; opciones: { proveedores: Opcion[]; repartos: Opcion[] }; puede: boolean;
};
type Form = Omit<Ajustes, "stage" | "stage_name" | "audio" | "central" | "conectores" | "opciones" | "puede" | "tarifas"> & { tarifas: Record<keyof Tarifas, string>; motivo: string };

const TARIFAS: [keyof Tarifas, string][] = [["out_mobile", "Saliente a celular"], ["out_landline", "Saliente a fijo"], ["inbound", "Entrante"], ["recording", "Grabación"], ["transcription", "Transcripción"]];

/**
 * TEL-02 Ajustes: proveedor y conector, grabación y aviso, transcripción, retención, reparto, timbre, plazo para devolver
 * llamadas y «solo llamar a clientes registrados». Los plazos son parámetros de la empresa: cambiarlos pide el motivo.
 */
export default function AjustesTelefonia() {
  const encendida = useTelefonia();
  const [s, setS] = useState<Ajustes | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  const aplicar = (x: Ajustes) => {
    setS(x);
    setF({ provider: x.provider, connector_id: x.connector_id, recording_enabled: x.recording_enabled, recording_notice_text: x.recording_notice_text ?? "", ring_strategy: x.ring_strategy,
      retention_days: x.retention_days, callback_due_minutes: x.callback_due_minutes, ring_timeout_s: x.ring_timeout_s, transcription_enabled: x.transcription_enabled,
      outbound_registered_only: x.outbound_registered_only, tarifas: Object.fromEntries(TARIFAS.map(([k]) => [k, String(x.tarifas[k])])) as Form["tarifas"], motivo: "" });
  };
  const cargar = useCallback(() => {
    if (!encendida) return;
    api<Ajustes>("/v1/tel/ajustes").then((r) => { aplicar(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [encendida]);
  useEffect(() => cargar(), [cargar]);

  if (!encendida) return <div className="grid gap-5"><PageHeader description="Proveedor, grabación, aviso, retención y reparto de las llamadas." /><TelefoniaApagada /></div>;
  if (!s || !f) return error ? <Alert tone="bad">{error}</Alert> : <p className="text-[13px] text-muted">Cargando…</p>;

  const cambianPlazos = f.retention_days !== s.retention_days || f.callback_due_minutes !== s.callback_due_minutes || f.ring_timeout_s !== s.ring_timeout_s
    || f.transcription_enabled !== s.transcription_enabled || f.outbound_registered_only !== s.outbound_registered_only;
  const dis = !s.puede;
  async function guardar() {
    if (!f) return;
    setEnviando(true);
    try {
      aplicar(await api<Ajustes>("/v1/tel/ajustes", { method: "PUT", body: { ...f, connector_id: f.connector_id || null, motivo: f.motivo || null,
        tarifas: Object.fromEntries(TARIFAS.map(([k]) => [k, Number(String(f.tarifas[k]).replace(",", "."))])) } }));
      toast.ok("Ajustes guardados");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  async function subir(file: File) {
    const fd = new FormData();
    fd.append("archivo", file);
    try {
      aplicar(await api<Ajustes>("/v1/tel/ajustes/audio", { method: "POST", body: fd }));
      toast.ok("Audio del aviso cargado");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  async function escuchar() {
    try {
      const r = await api<{ url: string }>("/v1/tel/ajustes/audio");
      window.open(r.url, "_blank", "noopener");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  const num = (v: string) => Number(v || 0);
  return (
    <div className="grid gap-5">
      <PageHeader description="Cómo funciona la central: el proveedor, si se graban y transcriben las llamadas, el aviso que escucha el cliente, cuánto se guardan las grabaciones y cómo suenan las llamadas en el equipo."
        actions={s.puede ? <Button variant="primary" loading={enviando} disabled={cambianPlazos && f.motivo.trim().length < 10} onClick={guardar}>Guardar ajustes</Button> : undefined} />
      {!s.puede && <Alert tone="warn">Los ajustes los cambia el administrador del sistema.</Alert>}
      {s.stage === "LIVE" && <Alert tone="info">Telefonía está en vivo: el proveedor y el conector solo se cambian volviendo a configuración en la Lista de activación.</Alert>}
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-ink">Proveedor y grabación</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proveedor" required><Select disabled={dis} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} options={s.opciones.proveedores} /></Field>
            <Field label="Conector de Integraciones" hint="Donde están las credenciales del proveedor."><Select disabled={dis} value={f.connector_id ?? ""} onChange={(e) => setF({ ...f, connector_id: e.target.value })} placeholder="Sin conector" options={s.conectores} /></Field>
            <Checkbox label="Grabar las llamadas" checked={f.recording_enabled} disabled={dis} onChange={(v) => setF({ ...f, recording_enabled: v })} />
            <Checkbox label="Transcribir las grabaciones y revisarlas con las alertas de control" checked={f.transcription_enabled} disabled={dis} onChange={(v) => setF({ ...f, transcription_enabled: v })} />
            <Field label="Aviso de grabación" required={f.recording_enabled} className="sm:col-span-2" hint="Lo escucha el cliente antes de hablar con la vendedora en toda llamada grabada (Ley 29733).">
              <Textarea rows={2} maxLength={500} disabled={dis} value={f.recording_notice_text ?? ""} onChange={(e) => setF({ ...f, recording_notice_text: e.target.value })} />
            </Field>
            <Field label="Días que se guardan las grabaciones" required hint="180 días mientras el abogado de datos personales lo valida."><Input type="number" min={1} max={3650} disabled={dis} value={f.retention_days} onChange={(e) => setF({ ...f, retention_days: num(e.target.value) })} /></Field>
            <Checkbox label="Solo llamar a clientes o leads registrados" checked={f.outbound_registered_only} disabled={dis} onChange={(v) => setF({ ...f, outbound_registered_only: v })} />
          </div>
          <h2 className="mt-2 text-[14px] font-semibold text-ink">Reparto de llamadas</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Reparto por defecto" required><Select disabled={dis} value={f.ring_strategy} onChange={(e) => setF({ ...f, ring_strategy: e.target.value })} options={s.opciones.repartos} /></Field>
            <Field label="Segundos que suena cada vendedora" required hint="De 5 a 120."><Input type="number" min={5} max={120} disabled={dis} value={f.ring_timeout_s} onChange={(e) => setF({ ...f, ring_timeout_s: num(e.target.value) })} /></Field>
            <Field label="Minutos para devolver una perdida" required><Input type="number" min={1} max={1440} disabled={dis} value={f.callback_due_minutes} onChange={(e) => setF({ ...f, callback_due_minutes: num(e.target.value) })} /></Field>
          </div>
          <h2 className="mt-2 text-[14px] font-semibold text-ink">Tarifas del proveedor (USD por minuto)</h2>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {TARIFAS.map(([k, l]) => (
              <Field key={k} label={l}><Input inputMode="decimal" disabled={dis} value={f.tarifas[k]} onChange={(e) => setF({ ...f, tarifas: { ...f.tarifas, [k]: e.target.value } })} /></Field>
            ))}
          </div>
          {s.puede && cambianPlazos && (
            <Field label="Motivo del cambio" required hint="La retención, los plazos, la transcripción y «solo registrados» son parámetros de la empresa: el cambio queda en su historial.">
              <Input maxLength={255} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} />
            </Field>
          )}
        </section>
        <div className="grid content-start gap-4">
          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Audio del aviso</h2>
            {s.audio ? (
              <p className="text-[12.5px]"><b>{s.audio.nombre}</b><span className="block text-muted">{(s.audio.bytes / 1024).toFixed(0)} KB · {s.audio.por} · {fechaHora(s.audio.subido)}</span></p>
            ) : <Badge tone="warn">Falta el audio (paso 3 de la lista)</Badge>}
            <div className="flex flex-wrap gap-2">
              {s.audio && <Button size="sm" icon={Headphones} onClick={escuchar}>Escuchar</Button>}
              {s.puede && <Button size="sm" icon={Upload} onClick={() => archivo.current?.click()}>{s.audio ? "Reemplazar" : "Subir audio"}</Button>}
              <input ref={archivo} type="file" accept=".mp3,.ogg,.wav,audio/*" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) subir(x); e.target.value = ""; }} />
            </div>
            <p className="text-[11.5px] text-muted">mp3, ogg o wav. Se guarda con los archivos de la empresa.</p>
          </section>
          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Llamadas de WhatsApp</h2>
            <p className="text-[12.5px] text-muted">Las llamadas de WhatsApp no pasan por la central ni se graban. El perfil y la respuesta automática de cada número indican el número de la central{s.central ? <>: <b className="font-mono text-ink">{s.central}</b></> : " (se configura en Números y desvíos)"}.</p>
          </section>
          <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">Datos personales</h2>
            <p className="text-[12.5px] text-muted">Las grabaciones son datos personales: la política de privacidad informa la finalidad (calidad y control), el plazo de conservación ({s.retention_days} días) y cómo ejercer los derechos de acceso, rectificación, cancelación y oposición.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
