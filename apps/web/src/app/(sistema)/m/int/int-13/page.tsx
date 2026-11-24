"use client";

import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, PageHeader, Select, StatusBadge, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { useDatos } from "@/modulos/int/tipos";

type Ejemplo = { code: string; name: string; endpoint: string | null; disponible: boolean; con_secreto: boolean };
type Respuesta = { envio: number; http: number; status: string; duplicate: boolean };
type Resultado = {
  respuestas: Respuesta[]; cuerpo: string; firma: string; endpoint: string;
  evento: { id: string; event_key: string | null; duplicates: number; result: string | null; last_error: string | null; status: string } | null;
};

const ESTADOS: Record<string, [string, Tone]> = {
  RECEIVED: ["Recibido", "info"], PROCESSED: ["Procesado", "ok"], FAILED: ["Fallido", "bad"], REJECTED: ["Rechazado", "warn"], IGNORED: ["Ignorado", "neutral"],
};
const legible = (b: string) => { try { return JSON.stringify(JSON.parse(b), null, 2); } catch { return b; } };

/**
 * INT-13 Simulador de integraciones: solo en prueba. Dispara webhooks de ejemplo firmados contra los conectores de prueba
 * (adaptador falso, sin internet) y muestra la respuesta y el efecto, por el mismo camino que un webhook real.
 */
export default function Simulador() {
  const { can, puede } = useSesion();
  const permitido = Boolean(can("int.simulator.use")) && puede("INT", "E");
  const { datos, error } = useDatos<{ ejemplos: Ejemplo[] }>("/v1/int/simulador");
  const [ejemplo, setEjemplo] = useState("MP");
  const [invalida, setInvalida] = useState(false);
  const [veces, setVeces] = useState("1");
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<Resultado | null>(null);
  const actual = datos?.ejemplos.find((e) => e.code === ejemplo);

  async function disparar() {
    setEnviando(true);
    try {
      const x = await api<Resultado>("/v1/int/simulador", { method: "POST", body: { ejemplo, firma_invalida: invalida, veces: Number(veces) } });
      setR(x);
      toast.ok(x.respuestas.length === 1 ? "Webhook enviado" : `${x.respuestas.length} envíos hechos`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const columnas: Column<Respuesta>[] = [
    { key: "envio", header: "Envío", align: "right", render: (x) => x.envio },
    { key: "http", header: "HTTP", render: (x) => <span className="font-mono">{x.http}</span> },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADOS} /> },
    { key: "duplicate", header: "Repetido", render: (x) => (x.duplicate ? <Badge tone="warn">Sí · no se procesa otra vez</Badge> : "No") },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Solo en prueba: dispara avisos de ejemplo firmados contra los conectores de prueba, que usan un adaptador falso y no salen a internet. Pasan por el mismo camino que un webhook real: se valida la firma, se detectan los repetidos y queda todo en la bitácora." />
      {!permitido && <Alert tone="warn">Tu rol no tiene el permiso para usar el simulador. Puedes ver los ejemplos, pero no dispararlos.</Alert>}
      <Alert tone="info">Para ver cómo se evita procesar dos veces lo mismo, elige «Enviar 3 veces»: el proveedor reintenta y el sistema procesa solo el primero.</Alert>
      {error && <Alert tone="bad">{error}</Alert>}

      <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
        <h2 className="text-[14px] font-semibold text-ink">Disparar webhook</h2>
        <div role="radiogroup" aria-label="Ejemplo" className="flex flex-wrap gap-2">
          {(datos?.ejemplos ?? []).map((e) => (
            <button key={e.code} type="button" role="radio" aria-checked={ejemplo === e.code} disabled={!e.disponible} onClick={() => setEjemplo(e.code)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ejemplo === e.code ? "border-primary bg-primary-soft text-primary" : "border-line text-muted hover:text-ink"}`}>
              {e.name}
            </button>
          ))}
        </div>
        {actual && (
          <p className="text-[12.5px] text-muted">
            {actual.disponible ? <>Se envía a <b className="text-ink">{actual.endpoint}</b>.{!actual.con_secreto && " No tiene secreto de firma: el simulador le genera uno de prueba al disparar."}</>
              : "No hay un endpoint de prueba para este ejemplo."}
          </p>
        )}
        <div className="grid items-end gap-4 sm:grid-cols-[auto_220px_auto]">
          <Checkbox checked={invalida} onChange={setInvalida} label="Firma inválida" hint="Para ver el rechazo con 401." />
          <Field label="Veces">
            <Select value={veces} onChange={(e) => setVeces(e.target.value)} options={[{ value: "1", label: "Enviar 1 vez" }, { value: "3", label: "Enviar 3 veces (reintentos del proveedor)" }]} />
          </Field>
          <Button variant="primary" icon={Send} loading={enviando} disabled={!permitido || !actual?.disponible} onClick={disparar}>Disparar</Button>
        </div>
      </section>

      {r && (
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold text-ink">Respuesta</h2>
            {r.evento && <Link href={`/m/int/int-05?evento=${r.evento.id}`} className="text-[13px] font-medium text-primary hover:underline">Verlo en la bitácora de webhooks</Link>}
          </div>
          <DataTable columns={columnas} rows={r.respuestas} rowKey={(x) => String(x.envio)} />
          <DetailList items={[
            { label: "Endpoint", value: r.endpoint },
            { label: "Clave", value: <span className="font-mono text-[12px] break-all">{r.evento?.event_key ?? "—"}</span> },
            { label: "Repetidos", value: String(r.evento?.duplicates ?? 0) },
            { label: "Resultado", value: r.evento?.last_error ?? r.evento?.result ?? "—" },
            { label: "Firma enviada", value: <span className="font-mono text-[12px] break-all">{r.firma}</span> },
          ]} />
          <pre className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink">{legible(r.cuerpo)}</pre>
        </section>
      )}
    </div>
  );
}
