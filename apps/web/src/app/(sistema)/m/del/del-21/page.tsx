"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, StatusBadge, Tabs, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { BarraCola } from "@/modulos/del/App";
import { Foto, Grabadora } from "@/modulos/del/Captura";
import { enviar, nuevoId } from "@/modulos/del/cola";
import { Seccion, TarjetaRuta, Vacio, VerArchivo, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { MENSAJE, R, lista, type Hoja, type RutaResumen } from "@/modulos/del/tipos";

type Mensaje = {
  id: string; kind: string; text: string | null; audio_file_id: string | null; audio_sec: number | null; photo_file_id: string | null; amount: number | null; to_role: string;
  status: string; reply: string | null; confirmed_amount: number | null; seq: number | null; atendido_por: string | null; created_at: string;
};
type Tipo = "TEXT" | "AUDIO" | "CAPTURE";

/** DEL-21 Mensajes a control desde la app: texto, audio o captura de pago con su monto (RN-DEL-17). */
export default function MensajesApp() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const ruta = useSearchParams().get("ruta");
  return ruta ? <DeRuta id={ruta} /> : <Elegir />;
}

function Elegir() {
  const router = useRouter();
  const { datos, error, cargando } = useDatos<{ data: RutaResumen[] }>(`/v1/del/app/rutas?fecha=${hoyLima()}`);
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader description="Elige la ruta para escribir a la coordinación o a cobranza." />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No tienes rutas hoy.</Vacio> : (
        <div className="space-y-3">{datos.data.map((r) => <TarjetaRuta key={r.id} r={r} onClick={() => router.push(`${R.mensajesApp}?ruta=${r.id}`)} />)}</div>
      )}
    </div>
  );
}

function DeRuta({ id }: { id: string }) {
  const router = useRouter();
  const op = useOpciones();
  const hoja = useDatos<Hoja>(`/v1/del/app/rutas/${id}`);
  const { datos, error, cargando, recargar } = useDatos<{ data: Mensaje[] }>(`/v1/del/app/rutas/${id}/mensajes`);
  const [tipo, setTipo] = useState<Tipo>("TEXT");
  const [d, setD] = useState({ text: "", stop_id: "", amount: "", to_role: "COORDINADOR_DELIVERY" });
  const [foto, setFoto] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ archivo: File; segundos: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [clave, setClave] = useState(0);
  const listo = tipo === "TEXT" ? d.text.trim() !== "" : tipo === "AUDIO" ? !!audio : !!foto && Number(d.amount) > 0;
  const limpiar = () => { setD({ ...d, text: "", amount: "" }); setFoto(null); setAudio(null); setClave((k) => k + 1); };
  const mandar = async () => {
    setOcupado(true);
    try {
      if (tipo === "AUDIO" && audio) {
        // El audio va directo (no se guarda en la cola del teléfono).
        const f = new FormData();
        f.append("client_event_id", nuevoId()); f.append("kind", "AUDIO"); f.append("to_role", d.to_role); f.append("audio_sec", String(Math.max(1, Math.round(audio.segundos))));
        f.append("audio", audio.archivo); if (d.stop_id) f.append("stop_id", d.stop_id); if (d.text.trim()) f.append("text", d.text.trim());
        await api(`/v1/del/app/rutas/${id}/mensajes`, { method: "POST", body: f });
        toast.ok("Audio enviado.");
      } else {
        const r = await enviar({ type: "MESSAGE", route_id: id, resumen: tipo === "CAPTURE" ? `Captura de pago ${soles(Number(d.amount))}` : "Mensaje a control", payload: {
          kind: tipo, text: d.text.trim() || null, stop_id: d.stop_id || null, to_role: d.to_role, amount: tipo === "CAPTURE" ? Number(d.amount) : null, photo_data: tipo === "CAPTURE" ? foto : null } });
        toast.ok(r ? "Mensaje enviado." : "Sin señal: se enviará al volver la conexión.");
      }
      limpiar();
      recargar();
    } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
  };
  const paradas = (hoja.datos?.paradas ?? []).map((p) => ({ value: p.id, label: `${p.seq}. ${p.pedido} · ${p.cliente ?? "—"}` }));
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`${R.app}?ruta=${id}`)}>Volver a la ruta</Button>
      <BarraCola onSincronizado={recargar} />
      <Seccion titulo="Nuevo mensaje">
        <Tabs value={tipo} onChange={setTipo} tabs={[{ key: "TEXT", label: "Texto" }, { key: "AUDIO", label: "Audio" }, { key: "CAPTURE", label: "Captura de pago" }]} />
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Para"><Select value={d.to_role} onChange={(e) => setD({ ...d, to_role: e.target.value })} options={lista(op.datos?.destinos)} /></Field>
            <Field label="Parada"><Select value={d.stop_id} onChange={(e) => setD({ ...d, stop_id: e.target.value })} placeholder="De la ruta" options={paradas} /></Field>
          </div>
          {tipo === "AUDIO" && <Grabadora key={clave} onListo={setAudio} />}
          {tipo === "CAPTURE" && (
            <>
              <Field label="Monto que se ve en la captura (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></Field>
              <Foto valor={foto} onChange={setFoto} texto="Foto o captura del pago" />
            </>
          )}
          <Field label={tipo === "TEXT" ? "Mensaje" : "Comentario"} required={tipo === "TEXT"}><Textarea rows={3} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} /></Field>
          <Button className="w-full" variant="primary" icon={Send} loading={ocupado} disabled={!listo} onClick={mandar}>Enviar</Button>
        </div>
      </Seccion>
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo="Enviados">
        {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>Sin mensajes.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.data.map((m) => (
              <li key={m.id} className="py-2.5 text-[13.5px]">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink">{m.kind === "AUDIO" ? `Audio de ${m.audio_sec ?? "?"} s` : m.kind === "CAPTURE" ? `Captura ${soles(m.amount)}` : "Texto"}{m.seq ? ` · parada ${m.seq}` : ""}</span>
                  <StatusBadge status={m.status} labels={MENSAJE} />
                </span>
                {m.text && <span className="block">{m.text}</span>}
                <span className="block text-[12.5px] text-muted">{op.datos?.destinos[m.to_role] ?? m.to_role} · {fechaHora(m.created_at)}</span>
                {m.audio_file_id && <VerArchivo id={m.audio_file_id} texto="Escuchar" />}
                {m.photo_file_id && <VerArchivo id={m.photo_file_id} texto="Ver captura" />}
                {m.reply && <span className="mt-1 block rounded-lg bg-surface-2 px-2 py-1 text-[12.5px]">{m.atendido_por ?? "Control"}: {m.reply}</span>}
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );
}
