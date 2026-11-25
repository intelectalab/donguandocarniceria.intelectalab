"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PhoneIncoming, PhoneMissed, PhoneOff, Voicemail } from "lucide-react";
import { Alert, Badge, Button, Field, Input, PageHeader, Select, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { segundos, type Llamada } from "@/modulos/tel/BotonLlamar";
import { TelefoniaApagada, useTelefonia } from "@/modulos/tel/comun";

type Opcion = { value: string; label: string };
type Telefono = {
  en_vivo: boolean; proveedor: string; central: string | null; numeros: Opcion[]; opciones: Opcion[]; en_horario: boolean; ultimas: Llamada[]; simulador: boolean; resultados: Opcion[];
};
type Ficha = { tipo: "CLIENTE"; id: string; nombre: string; pedidos: number; ultimo: string | null; en_curso: { id: string; number: string; status: string }[] }
  | { tipo: "LEAD"; id: string; nombre: string; nuevo: boolean };
type Atendida = { id: string; estado: string; estado_name: string; fuera_de_horario: boolean; tarea: { id: string; vence: string } | null; nuevo_lead: boolean; llamada: Llamada & { ficha: Ficha } };

const TONO: Record<string, Tone> = { COMPLETED: "ok", MISSED: "bad", NO_ANSWER: "bad", VOICEMAIL: "warn", BUSY: "warn", FAILED: "bad", RINGING: "info", IN_PROGRESS: "info" };

/**
 * TEL-06 Teléfono en la app: el teléfono de la central en la computadora o el celular de la empresa. Al sonar se busca al
 * cliente por su celular y se abre su ficha; si no existe, se crea el lead. En el entorno de prueba se simula la llamada.
 */
export default function TelefonoEnLaApp() {
  const encendida = useTelefonia();
  const [t, setT] = useState<Telefono | null>(null);
  const [error, setError] = useState("");
  const [d, setD] = useState({ from: "", option: "1", number_id: "", segundos: "120" });
  const [actual, setActual] = useState<Atendida | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => {
    if (!encendida) return;
    api<Telefono>("/v1/tel/telefono").then((r) => { setT(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [encendida]);
  useEffect(() => cargar(), [cargar]);

  async function simular(resultado: string) {
    setOcupado(resultado);
    try {
      const r = await api<Atendida>("/v1/tel/telefono/simular", { method: "POST", body: { from: d.from || desconocido(), option: Number(d.option) || null, number_id: d.number_id || null, resultado, segundos: Number(d.segundos) || 120 } });
      setActual(r);
      toast.ok(r.estado === "COMPLETED" ? "Llamada atendida" : r.fuera_de_horario ? "Fuera de horario: quedó la tarea de devolverla" : "Llamada perdida: quedó la tarea de devolverla");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(null);
    }
  }

  if (!encendida) return <div className="grid gap-5"><PageHeader description="El teléfono de la central en la computadora o el celular de la empresa." /><TelefoniaApagada /></div>;
  if (!t) return error ? <Alert tone="bad">{error}</Alert> : <p className="text-[13px] text-muted">Cargando…</p>;
  const ficha = actual?.llamada.ficha;
  return (
    <div className="grid gap-5">
      <PageHeader description="El teléfono de la central, en la computadora o en el celular de la empresa. Cuando suena, el sistema busca al cliente por su celular y abre su ficha con sus pedidos; si el número no está registrado, crea el lead." />
      {!t.en_vivo && <Alert tone="warn">Telefonía está en configuración: todavía no entran ni salen llamadas. Se pasa a en vivo en la Lista de activación.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <section className="grid content-start gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-2">
            <div><p className="text-[15px] font-semibold text-ink">Central {t.central ?? ""}</p><p className="text-[12px] text-muted">{t.proveedor} · {t.en_horario ? "en horario de atención" : "fuera de horario"}</p></div>
            <Badge tone={t.en_vivo ? "ok" : "warn"}>{t.en_vivo ? "En línea" : "Sin servicio"}</Badge>
          </div>
          {actual && ficha ? (
            <div className="grid gap-3 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-mono font-semibold text-ink">{actual.llamada.from_e164}</span><Badge tone={TONO[actual.estado] ?? "neutral"}>{actual.estado_name}</Badge></div>
              {ficha.tipo === "CLIENTE" ? (
                <div className="grid gap-1 text-[13px]">
                  <p className="font-semibold text-ink">{ficha.nombre}</p>
                  <p className="text-muted">{ficha.pedidos} pedidos{ficha.ultimo ? ` · último el ${fecha(ficha.ultimo)}` : ""}</p>
                  {ficha.en_curso.length > 0 && <p>En curso: {ficha.en_curso.map((o) => o.number).join(", ")}</p>}
                  <Link href={`/m/crm/crm-04?id=${ficha.id}`} className="mt-1 w-fit text-[12.5px] font-semibold text-primary hover:underline">Abrir la ficha 360</Link>
                </div>
              ) : (
                <div className="grid gap-1 text-[13px]">
                  <p className="font-semibold text-ink">{ficha.nombre}</p>
                  <p className="text-muted">{ficha.nuevo ? "Número nuevo: se creó el lead con origen teléfono." : "Lead ya registrado."}</p>
                  <Link href={`/m/crm/crm-05?id=${ficha.id}`} className="mt-1 w-fit text-[12.5px] font-semibold text-primary hover:underline">Abrir el lead</Link>
                </div>
              )}
              {actual.tarea && <Alert tone="warn">Quedó la tarea de devolver la llamada, vence a las {fechaHora(actual.tarea.vence).slice(-5)}. Está en Mis tareas.</Alert>}
              {actual.llamada.notice_played && <p className="text-[12px] text-muted">El cliente escuchó el aviso de grabación antes de hablar.</p>}
              <Button icon={PhoneOff} variant="ghost" onClick={() => setActual(null)}>Colgar</Button>
            </div>
          ) : t.simulador ? (
            <div className="grid gap-3">
              <p className="text-[12px] text-muted">Entorno de prueba: el proveedor todavía no está contratado, así que aquí simulas que alguien llama.</p>
              <Field label="Quién llama" hint="Un celular; si es de un cliente, se abre su ficha. Vacío: un número desconocido.">
                <Input value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })} placeholder="955 500 777" />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Número de la central"><Select value={d.number_id} onChange={(e) => setD({ ...d, number_id: e.target.value })} placeholder="El general" options={t.numeros} /></Field>
                <Field label="Opción que marca"><Select value={d.option} onChange={(e) => setD({ ...d, option: e.target.value })} options={t.opciones} /></Field>
              </div>
              <Field label="Si contestas, dura (segundos)"><Input type="number" min={1} max={7200} value={d.segundos} onChange={(e) => setD({ ...d, segundos: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={PhoneIncoming} loading={ocupado === "COMPLETED"} disabled={!t.en_vivo} onClick={() => simular("COMPLETED")}>Contestar</Button>
                <Button icon={PhoneMissed} loading={ocupado === "MISSED"} disabled={!t.en_vivo} onClick={() => simular("MISSED")}>No contestar</Button>
                <Button variant="ghost" icon={Voicemail} loading={ocupado === "VOICEMAIL"} disabled={!t.en_vivo} onClick={() => simular("VOICEMAIL")}>Al buzón</Button>
              </div>
            </div>
          ) : (
            <Alert tone="info">El teléfono de la app llega con el proveedor de telefonía: cuando se contrate, aquí suenan las llamadas y se abre la ficha del cliente.</Alert>
          )}
        </section>
        <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="text-[14px] font-semibold text-ink">Últimas llamadas entrantes</h2>
          {t.ultimas.length === 0 && <p className="text-[13px] text-muted">Todavía no hay llamadas.</p>}
          <ul className="grid gap-1.5">
            {t.ultimas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                <span className="min-w-0"><b className="block truncate text-ink">{c.cliente ?? c.lead ?? c.from_e164}</b><span className="font-mono text-muted">{c.from_e164} · {fechaHora(c.started_at)}</span></span>
                <span className="text-right"><Badge tone={TONO[c.status] ?? "neutral"}>{c.estado}</Badge><span className="block text-[11.5px] text-muted">{c.vendedora ?? "—"}{c.duration_seconds ? ` · ${segundos(c.duration_seconds)}` : ""}</span></span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function desconocido(): string {
  return `+51955${String(Math.floor(100000 + Math.random() * 899999))}`;
}
