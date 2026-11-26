"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Download, FileText, Lock, Pause, Play, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, DetailList, Modal, confirmAction, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { segundos } from "@/modulos/tel/BotonLlamar";

export type FilaGrabacion = {
  id: string; call_id: string; status: string; estado: string; direccion: string; numero: string; cliente: string | null; vendedora: string | null; marca: string | null;
  pedido: string | null; started_at: string; duration_seconds: number; retention_until: string; dias: number | null; legal_hold: boolean; legal_hold_reason: string | null;
  purged_at: string | null; preview: boolean; transcrita: boolean; alertas: number; puede: boolean;
};
type Alerta = { id: string | null; regla: string; gravedad: string; coincidencia: string; estado: string; status: string; raised_at: string | null; demo: boolean };
type Detalle = FilaGrabacion & {
  notice_played: boolean; customer_id: string | null; lead_id: string | null;
  transcripcion: { texto: string; proveedor: string; idioma: string; cost_usd: number; created_at: string; preview: boolean } | null;
  alertas_lista: Alerta[]; accesos: { accion: string; action: string; motivo: string | null; accessed_at: string; quien: string | null }[];
  permisos: { escuchar: boolean; descargar: boolean; transcribir: boolean; retencion: boolean };
};

export const TONO_GRAVEDAD: Record<string, Tone> = { HIGH: "bad", MEDIUM: "warn", LOW: "info" };
const GRAVEDAD: Record<string, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Baja" };
const reloj = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const soloDigitos = (t: string) => t.replace(/\D/g, "");

/** Marca en el texto lo que encontraron las reglas (los números se buscan aunque estén con espacios o guiones). */
function Resaltado({ texto, marcas }: { texto: string; marcas: string[] }) {
  const tramos = useMemo(() => {
    const rangos: [number, number][] = [];
    const bajo = texto.toLowerCase();
    for (const m of marcas.flatMap((x) => x.split(/ · |, /)).map((x) => x.trim()).filter((x) => x.length >= 3)) {
      const d = soloDigitos(m).replace(/^51(?=9\d{8}$)/, "");
      if (d.length >= 8 && d.length === m.replace(/[\s+\-.]/g, "").replace(/^51(?=9\d{8}$)/, "").length) {
        const re = new RegExp(d.split("").join("[\\s.\\-]?"), "g");
        for (const x of texto.matchAll(re)) rangos.push([x.index ?? 0, (x.index ?? 0) + x[0].length]);
      } else {
        let i = bajo.indexOf(m.toLowerCase());
        while (i >= 0) { rangos.push([i, i + m.length]); i = bajo.indexOf(m.toLowerCase(), i + m.length); }
      }
    }
    rangos.sort((a, b) => a[0] - b[0]);
    const out: { t: string; marca: boolean }[] = [];
    let ultimo = 0;
    for (const [a, b] of rangos) {
      if (a < ultimo) continue;
      if (a > ultimo) out.push({ t: texto.slice(ultimo, a), marca: false });
      out.push({ t: texto.slice(a, b), marca: true });
      ultimo = b;
    }
    if (ultimo < texto.length) out.push({ t: texto.slice(ultimo), marca: false });
    return out;
  }, [texto, marcas]);
  return <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{tramos.map((x, i) => x.marca ? <mark key={i} className="rounded bg-warn/25 px-0.5 text-ink">{x.t}</mark> : <span key={i}>{x.t}</span>)}</p>;
}

/** Reproductor: el audio real si el proveedor lo guardó; con el de prueba, una barra que avanza (no hay audio). */
function Reproductor({ g, onAcceso }: { g: Detalle; onAcceso: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [prueba, setPrueba] = useState(false);
  const [pos, setPos] = useState(0);
  const [sonando, setSonando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const barras = useMemo(() => {
    let x = 0;
    for (const ch of g.id) x = (x * 31 + ch.charCodeAt(0)) % 9973;
    return Array.from({ length: 64 }, (_, i) => 6 + (((x * (i + 7)) % 97) / 97) * 34);
  }, [g.id]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const dur = Math.max(1, g.duration_seconds);

  async function reproducir() {
    if (sonando && timer.current) { clearInterval(timer.current); timer.current = null; setSonando(false); return; }
    if (!url && !prueba) {
      setPidiendo(true);
      try {
        const r = await api<{ url: string | null; prueba: boolean }>(`/v1/tel/grabaciones/${g.id}/acceso`, { method: "POST", body: { accion: "PLAY" } });
        setUrl(r.url); setPrueba(r.prueba);
        onAcceso();
        if (r.url) return;
      } catch (e) {
        toast.error(mensajeDe(e));
        return;
      } finally {
        setPidiendo(false);
      }
    }
    if (url) return;
    // Prueba: avanza en unos 15 segundos sin importar la duración real.
    setSonando(true);
    const paso = dur / 60;
    timer.current = setInterval(() => setPos((p) => {
      const n = Math.min(dur, p + paso);
      if (n >= dur && timer.current) { clearInterval(timer.current); timer.current = null; setSonando(false); }
      return n >= dur ? 0 : n;
    }), 250);
  }
  async function descargar() {
    const r = await confirmAction({ title: "Descargar la grabación", message: "La descarga queda en la bitácora con tu nombre y el motivo (Ley 29733).", confirmLabel: "Descargar",
      reason: { label: "Motivo (reclamo, pedido de autoridad, revisión)", min: 5 } });
    if (!r) return;
    try {
      const x = await api<{ url: string | null; prueba: boolean }>(`/v1/tel/grabaciones/${g.id}/acceso`, { method: "POST", body: { accion: "DOWNLOAD", motivo: r.reason } });
      onAcceso();
      if (x.url) window.open(x.url, "_blank", "noopener");
      else toast.info("Descarga registrada en la bitácora. El proveedor de prueba no guarda audio para descargar.");
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (g.status === "PURGED") {
    return <Alert tone="warn">La grabación se purgó el {fecha(g.purged_at)} al vencer su retención: ya no se puede escuchar. Los datos de la llamada se conservan.</Alert>;
  }
  if (!g.permisos.escuchar) {
    return <Alert tone="info"><Lock size={14} className="mr-1 inline" />Solo escuchas tus grabaciones; las de otras vendedoras las escucha la supervisión.</Alert>;
  }
  const avance = pos / dur;
  return (
    <div className="grid gap-3">
      {url ? <audio controls autoPlay src={url} className="w-full" /> : (
        <svg viewBox={`0 0 ${64 * 6} 48`} className="h-12 w-full" role="img" aria-label="Forma de la grabación">
          {barras.map((h, i) => <rect key={i} x={i * 6} y={24 - h / 2} width={4} height={h} rx={1} fill={i / 64 <= avance && (sonando || pos > 0) ? "var(--primary)" : "var(--muted)"} opacity={0.85} />)}
        </svg>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {!url && <Button size="sm" variant="primary" icon={sonando ? Pause : Play} loading={pidiendo} onClick={reproducir}>{sonando ? "Pausa" : "Reproducir"}</Button>}
          {g.permisos.descargar && <Button size="sm" variant="ghost" icon={Download} onClick={descargar}>Descargar</Button>}
        </div>
        {!url && <span className="font-mono text-[12.5px] text-muted">{reloj(pos)} / {reloj(dur)}</span>}
      </div>
      {prueba && <p className="text-[12px] text-muted">Grabación de prueba: el proveedor de prueba no guarda audio. La escucha igual quedó en la bitácora.</p>}
    </div>
  );
}

/** TEL-10: la grabación con su reproductor, la transcripción con lo encontrado resaltado, las alertas y quién la escuchó. */
export function DetalleGrabacion({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio?: () => void }) {
  const [g, setG] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [transcribiendo, setTranscribiendo] = useState(false);
  const cargar = useCallback(() => api<Detalle>(`/v1/tel/grabaciones/${id}`).then((r) => { setG(r); setError(""); }).catch((e) => setError(mensajeDe(e))), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function transcribir() {
    setTranscribiendo(true);
    try {
      const r = await api<Detalle>(`/v1/tel/grabaciones/${id}/transcribir`, { method: "POST" });
      setG(r);
      const n = r.alertas_lista.filter((a) => !a.demo).length;
      if (n) toast.error(`Transcrita: ${n} alerta${n === 1 ? "" : "s"} para revisar`);
      else toast.ok("Transcrita, sin alertas");
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTranscribiendo(false);
    }
  }
  async function retencion() {
    if (!g) return;
    const r = await confirmAction(g.legal_hold
      ? { title: "Quitar la retención legal", message: "La grabación volverá a purgarse al vencer su plazo.", confirmLabel: "Quitar retención", danger: true, reason: { label: "Motivo", min: 5 } }
      : { title: "Retención legal", message: "Mientras siga, la grabación no se purga aunque venza su plazo.", confirmLabel: "Retener", reason: { label: "Motivo (reclamo, proceso o pedido de autoridad)", min: 5 } });
    if (!r) return;
    try {
      setG(await api<Detalle>(`/v1/tel/grabaciones/${id}/retencion`, { method: "POST", body: { activa: !g.legal_hold, motivo: r.reason } }));
      toast.ok(g.legal_hold ? "Retención legal quitada" : "Grabación en retención legal");
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  return (
    <Modal open onClose={onClose} size="xl" title={g ? `${g.direccion} · ${g.numero}` : "Grabación"} description={g ? `${fechaHora(g.started_at)} · ${g.vendedora ?? "Sin vendedora"}` : undefined}
      footer={g && (g.permisos.retencion || g.permisos.transcribir) ? (
        <>
          {g.permisos.retencion && <Button variant="ghost" icon={ShieldCheck} onClick={retencion}>{g.legal_hold ? "Quitar retención legal" : "Retención legal"}</Button>}
          {g.permisos.transcribir && <Button variant="primary" icon={FileText} loading={transcribiendo} onClick={transcribir}>Transcribir</Button>}
        </>
      ) : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {g && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="grid content-start gap-4">
            {g.preview && <Alert tone="info">Grabación de los datos de demostración.</Alert>}
            <section className="grid gap-2 rounded-xl border border-line p-3">
              <h3 className="text-[13.5px] font-semibold text-ink">Reproductor</h3>
              <Reproductor g={g} onAcceso={cargar} />
              <p className="text-[12px] text-muted">
                {g.status === "AVAILABLE" ? `Se conserva hasta el ${fecha(g.retention_until)}` : `Purgada el ${fecha(g.purged_at)}`}
                {g.legal_hold && " · en retención legal"} · aviso de grabación: {g.notice_played ? "reproducido" : "no"}
              </p>
              {g.legal_hold && g.legal_hold_reason && <p className="text-[12px] text-ink">Motivo de la retención: {g.legal_hold_reason}</p>}
            </section>
            <section className="grid gap-2 rounded-xl border border-line p-3">
              <h3 className="text-[13.5px] font-semibold text-ink">Transcripción</h3>
              {g.transcripcion ? (
                <>
                  <Resaltado texto={g.transcripcion.texto} marcas={g.alertas_lista.map((a) => a.coincidencia)} />
                  <p className="text-[12px] text-muted">{g.transcripcion.proveedor} · español · USD {g.transcripcion.cost_usd.toFixed(4)}{g.transcripcion.created_at ? ` · ${fechaHora(g.transcripcion.created_at)}` : ""}</p>
                </>
              ) : <p className="text-[13px] text-muted">{g.permisos.transcribir ? "Sin transcripción. Usa «Transcribir»: el texto pasa por las reglas de control." : "Sin transcripción."}</p>}
            </section>
          </div>
          <div className="grid content-start gap-4">
            <section className="grid gap-2 rounded-xl border border-line p-3">
              <h3 className="text-[13.5px] font-semibold text-ink">Llamada</h3>
              <DetailList items={[
                { label: g.lead_id && !g.customer_id ? "Lead" : "Cliente", value: g.customer_id ? <Link href={`/m/crm/crm-04?id=${g.customer_id}`} className="font-semibold text-primary hover:underline">{g.cliente ?? "—"}</Link> : g.cliente ?? "—" },
                { label: "Marca", value: g.marca ?? "—" }, { label: "Duración", value: segundos(g.duration_seconds) }, { label: "Pedido", value: g.pedido ?? "—" },
              ]} />
            </section>
            <section className="grid gap-2 rounded-xl border border-line p-3">
              <h3 className="text-[13.5px] font-semibold text-ink">Alertas encontradas</h3>
              {g.alertas_lista.length === 0 && <p className="text-[13px] text-muted">Sin alertas.</p>}
              {g.alertas_lista.map((a, i) => (
                <div key={a.id ?? `demo-${i}`} className="grid gap-1 rounded-lg border border-line p-2 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone={TONO_GRAVEDAD[a.gravedad] ?? "neutral"}>{GRAVEDAD[a.gravedad] ?? a.gravedad}</Badge><b className="text-ink">{a.regla}</b></div>
                  <span>«{a.coincidencia}»</span>
                  <span className="text-muted">{a.estado}{a.demo ? " · demostración" : ""}</span>
                  {a.id && <Link href={`/m/crm/crm-12?id=${a.id}`} className="w-fit font-semibold text-primary hover:underline">Revisar en Alertas</Link>}
                </div>
              ))}
            </section>
            <section className="grid gap-2 rounded-xl border border-line p-3">
              <h3 className="text-[13.5px] font-semibold text-ink">Quién la escuchó</h3>
              {g.accesos.length === 0 && <p className="text-[13px] text-muted">Nadie la escuchó todavía.</p>}
              {g.accesos.map((x, i) => (
                <p key={i} className="text-[12.5px]"><span className="text-muted">{fechaHora(x.accessed_at)}</span> · {x.quien ?? "—"} · <Badge tone={x.action === "DOWNLOAD" ? "warn" : "neutral"}>{x.accion}</Badge>{x.motivo ? ` · ${x.motivo}` : ""}</p>
              ))}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
