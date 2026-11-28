"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, LifeBuoy, MessageSquare, Navigation, Receipt, Wallet } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, Modal, PageHeader, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { BarraCola, usePosicion } from "@/modulos/del/App";
import { nuevoId } from "@/modulos/del/cola";
import { Avance, Seccion, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PARADA, R, RUTA, hora, navegar, type Hoja, type RutaResumen } from "@/modulos/del/tipos";

/** DEL-04 App: mis rutas del día, avance y paradas pendientes. Funciona sin conexión (las acciones se guardan y se envían luego). */
export default function MisRutas() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const ruta = useSearchParams().get("ruta");
  return ruta ? <Ruta id={ruta} /> : <Lista />;
}

function Lista() {
  const router = useRouter();
  const { datos, error, cargando, recargar } = useDatos<{ data: RutaResumen[] }>(`/v1/del/app/rutas?fecha=${hoyLima()}`);
  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <PageHeader description="Tus rutas de hoy. Abre una para ver sus paradas en orden." />
      <BarraCola onSincronizado={recargar} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No tienes rutas asignadas hoy.</Vacio> : (
        <ul className="space-y-3">
          {datos.data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => router.push(`${R.app}?ruta=${r.id}`)} className="w-full cursor-pointer rounded-xl border border-line bg-surface p-4 text-left shadow-card hover:border-primary">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[16px] font-semibold text-ink">{r.code}</span>
                  <StatusBadge status={r.status} labels={RUTA} />
                </span>
                <span className="mt-1 block text-[13px] text-muted">{r.plate ?? ""} · {r.franja ?? "sin franja"} · {r.hechas} de {r.paradas} paradas</span>
                <span className="mt-2 block"><Avance valor={r.paradas ? (r.hechas / r.paradas) * 100 : 0} /></span>
                {r.siguiente && <span className="mt-2 block text-[13px] text-ink">Sigue: <b>{r.siguiente.seq}. {r.siguiente.cliente}</b> · {r.siguiente.direccion}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ruta({ id }: { id: string }) {
  const router = useRouter();
  const op = useOpciones();
  const { datos: h, error, cargando, recargar } = useDatos<Hoja>(`/v1/del/app/rutas/${id}`);
  const [apoyo, setApoyo] = useState(false);
  usePosicion(id, h?.ruta.status === "IN_ROUTE", op.datos?.parametros.intervalo_s ?? 120);

  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !h) return <Alert tone="bad">{error || "No se encontró la ruta."}</Alert>;
  const r = h.ruta;
  const pendientes = h.paradas.filter((p) => ["PENDING", "ARRIVED"].includes(p.status));
  const sig = pendientes[0];

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(R.app)}>Mis rutas</Button>
      <BarraCola onSincronizado={recargar} />
      <Seccion>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[17px] font-bold text-ink">{r.code}</span>
          <StatusBadge status={r.status} labels={RUTA} />
        </div>
        <p className="text-[13px] text-muted">{r.plate} · {r.hechas} de {r.paradas} paradas · cobrado {soles(r.cobrado)} de {soles(r.cobrar)}</p>
        <div className="mt-2"><Avance valor={r.paradas ? (r.hechas / r.paradas) * 100 : 0} /></div>
        {h.riesgo.nivel !== "OK" && <p className="mt-2 text-[13px] text-warn">Vas unos {h.riesgo.atraso_min} min atrasado para la franja: pide apoyo si no llegas.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {["PLANNED", "LOADING"].includes(r.status) && <Button className="col-span-2" variant="primary" onClick={() => router.push(`${R.hoja}?id=${r.id}`)}>Cargar bolsas y salir</Button>}
          <Button icon={Receipt} onClick={() => router.push(`${R.gastos}?ruta=${r.id}`)}>Gastos</Button>
          <Button icon={MessageSquare} onClick={() => router.push(`${R.mensajesApp}?ruta=${r.id}`)}>Mensajes</Button>
          {r.status === "IN_ROUTE" && pendientes.length > 0 && <Button icon={LifeBuoy} onClick={() => setApoyo(true)}>Pedir apoyo</Button>}
          {["RETURNED", "SETTLED"].includes(r.status) && <Button icon={Wallet} onClick={() => router.push(`${R.liquidacion}?ruta=${r.id}`)}>Liquidación</Button>}
          {r.status === "IN_ROUTE" && !pendientes.length && <Button className="col-span-2" variant="primary" onClick={() => router.push(`${R.hoja}?id=${r.id}`)}>Volver al local</Button>}
        </div>
      </Seccion>
      {sig && r.status === "IN_ROUTE" && (
        <a href={navegar(sig.lat, sig.lng)} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[15px] font-semibold text-primary-ink">
          <Navigation size={18} /> Ir a la parada {sig.seq}
        </a>
      )}
      <Seccion titulo="Paradas">
        <ol className="divide-y divide-line">
          {h.paradas.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => router.push(`${R.parada}?id=${p.id}&ruta=${r.id}`)} className="flex w-full cursor-pointer items-center gap-3 py-3 text-left">
                <span className={`grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold ${["PENDING", "ARRIVED"].includes(p.status) ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted"}`}>{p.seq}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-ink">{p.cliente}</span>
                  <span className="block truncate text-[12.5px] text-muted">{p.direccion}{p.distrito ? `, ${p.distrito}` : ""}</span>
                  <span className="block text-[12px] text-muted">~{hora(p.eta)} · {p.bolsas.length} bolsa(s){p.pendiente > 0 ? ` · cobrar ${soles(p.pendiente)}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1"><StatusBadge status={p.status} labels={PARADA} /><ChevronRight size={16} className="text-muted" /></span>
              </button>
            </li>
          ))}
        </ol>
      </Seccion>
      {apoyo && <PedirApoyo h={h} onClose={() => setApoyo(false)} onListo={() => { setApoyo(false); recargar(); }} />}
    </div>
  );
}

function PedirApoyo({ h, onClose, onListo }: { h: Hoja; onClose: () => void; onListo: () => void }) {
  const pend = h.paradas.filter((p) => p.status === "PENDING");
  const [sel, setSel] = useState<string[]>(pend.slice(-1).map((p) => p.id));
  const [motivo, setMotivo] = useState("");
  const [atraso, setAtraso] = useState(String(h.riesgo.atraso_min || ""));
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title="Pedir apoyo" description="Control asigna esas paradas a otra ruta o autoriza un motorizado externo." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!sel.length || motivo.trim().length < 3} onClick={async () => {
          setOcupado(true);
          try {
            await api(`/v1/del/app/rutas/${h.ruta.id}/apoyo`, { method: "POST", body: { stop_ids: sel, reason: motivo, late_min: atraso ? Number(atraso) : null, client_event_id: nuevoId() } });
            toast.ok("Pedido de apoyo enviado a control.");
            onListo();
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Enviar</Button>
      </>
    }>
      <div className="space-y-3">
        <div className="space-y-1">
          {pend.map((p) => <Checkbox key={p.id} checked={sel.includes(p.id)} onChange={(v) => setSel((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))} label={`${p.seq}. ${p.cliente ?? p.pedido}`} />)}
        </div>
        <Field label="Motivo" required><Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Tráfico, moto con falla, muchas paradas…" /></Field>
        <Field label="Atraso estimado (min)"><Input type="number" inputMode="numeric" min={0} value={atraso} onChange={(e) => setAtraso(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
