"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, PenLine } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, Textarea, toast, type Tone } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Componente = {
  code: string; name: string; status: string; status_name: string; latency_ms: number | null; error_rate: number | null; queue_depth: number | null;
  detail: string | null; last_read_at: string | null; status_since: string | null; con_sonda: boolean;
  disponibilidad_24h: number | null; disponibilidad_7d: number | null; incidentes: { id: string; number: string; severity: string }[];
};
type Lectura = { status: string; latency_ms: number | null; error_rate: number | null; queue_depth: number | null; detail: string | null; source: string; registered_by: string | null; read_at: string };

const TONO_SALUD: Record<string, Tone> = { UP: "ok", DEGRADED: "warn", DOWN: "bad", UNKNOWN: "neutral" };
const NOMBRE: Record<string, string> = { UP: "Operativo", DEGRADED: "Degradado", DOWN: "Caído", UNKNOWN: "Sin lectura" };
const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("es-PE", { maximumFractionDigits: 2 })} %`);

/** Salud de componentes: estado, latencia, cola y disponibilidad de cada pieza de la plataforma. */
export default function SaludComponentes() {
  const [datos, setDatos] = useState<{ data: Componente[]; resumen: Record<string, number> } | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(() => {
    apiConsola<{ data: Componente[]; resumen: Record<string, number> }>("/salud").then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 60000);
    return () => clearInterval(t);
  }, [cargar]);

  return (
    <div className="grid gap-5">
      <PageHeader description="Se leen solos cada minuto la aplicación, la base de datos, las colas y el almacenamiento. Los servicios externos todavía no tienen adaptador: quedan «sin lectura» hasta que ingeniería registre su estado a mano. Disponibilidad: lecturas operativas sobre el total (degradado cuenta la mitad)." />
      {error && <Alert tone="bad">{error}</Alert>}
      {datos && (
        <div className="flex flex-wrap gap-2">
          {(["UP", "DEGRADED", "DOWN", "UNKNOWN"] as const).map((s) => <Badge key={s} tone={TONO_SALUD[s]} dot>{NOMBRE[s]}: {datos.resumen[s] ?? 0}</Badge>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(datos?.data ?? []).map((c) => (
          <button key={c.code} type="button" onClick={() => setAbierto(c.code)}
            className={`grid cursor-pointer gap-2 rounded-xl border bg-surface p-4 text-left shadow-card transition-colors hover:bg-surface-2 ${c.status === "DOWN" ? "border-bad/60" : c.status === "DEGRADED" ? "border-warn/60" : "border-line"}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="font-semibold text-ink">{c.name}</span>
              <Badge tone={TONO_SALUD[c.status]} dot>{c.status_name}</Badge>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-[12px]">
              <div><dt className="text-muted">Latencia</dt><dd className="text-ink">{c.latency_ms === null ? "—" : `${c.latency_ms} ms`}</dd></div>
              <div><dt className="text-muted">24 h</dt><dd className="text-ink">{pct(c.disponibilidad_24h)}</dd></div>
              <div><dt className="text-muted">7 días</dt><dd className="text-ink">{pct(c.disponibilidad_7d)}</dd></div>
            </dl>
            {c.queue_depth !== null && <span className="text-[12px] text-muted">{c.queue_depth} trabajo(s) en cola</span>}
            {c.detail && <span className="text-[12px] text-muted">{c.detail}</span>}
            <span className="text-[11.5px] text-muted">{c.last_read_at ? `Última lectura: ${fechaHora(c.last_read_at)}` : "Todavía sin lecturas"}</span>
            {c.incidentes.length > 0 && <span className="text-[12px] font-semibold text-bad">Incidente abierto: {c.incidentes.map((i) => i.number).join(", ")}</span>}
          </button>
        ))}
      </div>
      {abierto && <DetalleComponente key={abierto} codigo={abierto} onClose={() => setAbierto(null)} onCambio={cargar} />}
    </div>
  );
}

function DetalleComponente({ codigo, onClose, onCambio }: { codigo: string; onClose: () => void; onCambio: () => void }) {
  const yo = useUsuarioConsola();
  const [c, setC] = useState<(Componente & { lecturas: Lectura[] }) | null>(null);
  const [f, setF] = useState({ status: "UP", latency_ms: "", detail: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    apiConsola<Componente & { lecturas: Lectura[] }>(`/salud/${codigo}`).then(setC).catch((e) => toast.error(mensajeDe(e)));
  }, [codigo]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await apiConsola<Componente & { lecturas: Lectura[] }>(`/salud/${codigo}/lecturas`, { method: "POST",
        body: { status: f.status, latency_ms: f.latency_ms ? Number(f.latency_ms) : null, detail: f.detail } });
      setC(r);
      setF({ status: "UP", latency_ms: "", detail: "" });
      setErrores({});
      toast.ok(r.status === "DOWN" ? "Lectura registrada: si no había, se abrió un incidente" : "Lectura registrada");
      onCambio();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={c?.name ?? "Componente"}
      description={c ? <span className="inline-flex flex-wrap items-center gap-2"><Badge tone={TONO_SALUD[c.status]} dot>{c.status_name}</Badge>
        {c.status_since && <span>desde {fechaHora(c.status_since)}</span>}</span> : undefined}>
      {!c ? <p className="text-muted">Cargando…</p> : (
        <div className="grid gap-5">
          {c.incidentes.length > 0 && (
            <Alert tone="bad">Incidente abierto: {c.incidentes.map((i) => <Link key={i.id} href={`/consola/incidentes?incidente=${i.id}`} className="font-semibold underline">{i.number}</Link>)}</Alert>
          )}
          {yo.puede["health.record"] && (
            <form onSubmit={registrar} className="grid gap-3 rounded-xl border border-line p-3.5">
              <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink"><PenLine size={15} aria-hidden="true" />Registrar una lectura a mano</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <Field label="Estado" error={errores.status}>
                  <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}
                    options={[{ value: "UP", label: "Operativo" }, { value: "DEGRADED", label: "Degradado" }, { value: "DOWN", label: "Caído" }]} />
                </Field>
                <Field label="Latencia (ms)" error={errores.latency_ms}>
                  <Input type="number" min={0} value={f.latency_ms} onChange={(e) => setF({ ...f, latency_ms: e.target.value })} />
                </Field>
              </div>
              <Field label="Qué se observó" required error={errores.detail}>
                <Textarea rows={2} maxLength={300} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
              </Field>
              <Button type="submit" variant="primary" icon={Activity} loading={guardando} className="justify-self-start">Registrar</Button>
            </form>
          )}
          <div className="grid gap-1.5">
            <p className="text-[13px] font-semibold text-ink">Últimas lecturas</p>
            {c.lecturas.length === 0 ? <p className="text-[13px] text-muted">Todavía no hay lecturas.</p> : (
              <ol className="grid max-h-[380px] gap-1.5 overflow-y-auto pr-1">
                {c.lecturas.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                    <Badge tone={TONO_SALUD[l.status]} dot>{NOMBRE[l.status]}</Badge>
                    <span className="text-muted">{fechaHora(l.read_at)} · {l.source === "AUTO" ? "automática" : `a mano · ${l.registered_by ?? ""}`}</span>
                    {l.latency_ms !== null && <span className="text-muted">{l.latency_ms} ms</span>}
                    {l.queue_depth !== null && <span className="text-muted">{l.queue_depth} en cola</span>}
                    {l.detail && <span className="w-full text-ink">{l.detail}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
