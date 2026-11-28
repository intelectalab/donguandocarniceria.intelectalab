"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Fuel, MapPin, Pause, Play } from "lucide-react";
import { Alert, Badge, Button, Field, FiltroSelect, Input, Modal, PageHeader, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { Bloqueos, ErrorCarga, Seccion, Vacio, useDatos } from "@/modulos/flo/comunes";
import { hora } from "@/modulos/flo/tipos";

type VehiculoApp = {
  id: string; etiqueta: string; tipo: string; odometro: number; checklist: Record<string, string>; bloqueos: string[];
  ocupado: string | null; mio: boolean; ruta: string | null; programada: string | null;
};
type Jornada = {
  id: string; number: string; vehicle_id: string; vehiculo: string; started_at: string; odometer_start: string; odometro: number; km_gps: number;
  entregas: number; posiciones: number; ultima: { recorded_at: string; lat: string; lng: string; speed_kmh: string | null } | null;
  checklist: Record<string, string>; cargas: { number: string; gallons: string; amount: string; loaded_at: string }[]; tanque: number;
};
type App = {
  conductor: { id: string; nombre: string }; coordina: boolean; conductores: { id: string; name: string }[];
  licencia: { number: string; expires_on: string | null; license_class: string | null; semaforo: string } | null;
  jornada: Jornada | null; vehiculos: VehiculoApp[]; intervalo: number; hoy: string;
};
type Punto = { vehicle_id: string; recorded_at: string; lat: number; lng: number; speed_kmh: number | null; heading: number | null; accuracy_m: number | null };

const COLA = "flo-gps-cola";
const leerCola = (): Punto[] => {
  try {
    return JSON.parse(localStorage.getItem(COLA) ?? "[]") as Punto[];
  } catch {
    return [];
  }
};
const guardarCola = (c: Punto[]) => localStorage.setItem(COLA, JSON.stringify(c.slice(-2000)));

/** FLO-15 App · Jornada: el conductor inicia la jornada (odómetro, checklist y foto), la app envía su ubicación y al volver la cierra. */
export default function AppJornada() {
  const [conductor, setConductor] = useState("");
  const { datos, error, cargando, recargar } = useDatos<App>(`/v1/flo/app${conductor ? `?conductor=${conductor}` : ""}`);
  if (error) return <ErrorCarga error={error} que="La app de jornada es del conductor (y el coordinador la usa para ayudarlo)." />;
  const lic = datos?.licencia;
  const ajeno = Boolean(datos?.coordina && conductor);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader description={datos ? `${datos.conductor.nombre} · ${fecha(datos.hoy)}` : "Tu jornada de hoy"} />
      {datos?.coordina && (
        <div className="flex flex-wrap gap-2">
          <FiltroSelect etiqueta="Conductor" value={conductor} onChange={setConductor} ancho={240} vacio="Yo mismo"
            options={datos.conductores.map((c) => ({ value: c.id, label: c.name }))} />
        </div>
      )}
      {lic ? (
        lic.semaforo !== "VALID" && lic.semaforo !== "NO_EXPIRY" && (
          <Alert tone={lic.semaforo === "EXPIRED" ? "bad" : "warn"} title={lic.semaforo === "EXPIRED" ? "Licencia vencida: no puedes iniciar la jornada" : "Tu licencia vence pronto"}>
            Licencia {lic.number}{lic.license_class ? ` (${lic.license_class})` : ""} · vence el {fecha(lic.expires_on)}. Avisa a administración para renovarla.
          </Alert>
        )
      ) : datos && <Alert tone="warn">No hay una licencia de conducir registrada para {datos.conductor.nombre}. Sin licencia vigente no se inicia la jornada.</Alert>}
      {cargando && !datos ? <Vacio>Cargando…</Vacio> : datos?.jornada
        ? <EnCurso j={datos.jornada} intervalo={datos.intervalo} enviarGps={!ajeno} onCambio={recargar} />
        : datos && <Iniciar app={datos} conductor={conductor || null} onListo={recargar} />}
    </div>
  );
}

function Iniciar({ app, conductor, onListo }: { app: App; conductor: string | null; onListo: () => void }) {
  const [sel, setSel] = useState(() => app.vehiculos.find((v) => v.mio && !v.ocupado && !v.bloqueos.length)?.id ?? "");
  const [odo, setOdo] = useState("");
  const [ch, setCh] = useState<Record<string, boolean>>({});
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const v = app.vehiculos.find((x) => x.id === sel);
  const items = Object.entries(v?.checklist ?? {});
  const observados = items.filter(([k]) => ch[k] === false).length;
  const completo = items.every(([k]) => k in ch);
  async function iniciar(e: FormEvent) {
    e.preventDefault();
    if (!v) return;
    setGuardando(true);
    setError("");
    try {
      await api("/v1/flo/jornadas", { method: "POST", body: { vehicle_id: v.id, odometer: Number(odo), checklist: ch, notes: nota || undefined, foto_data: foto ?? undefined, source: "APP", driver_user_id: conductor ?? undefined } });
      toast.ok("Jornada iniciada. Buen viaje.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <form className="space-y-4" onSubmit={iniciar}>
      <Seccion titulo="1. Elige el vehículo">
        {app.vehiculos.length === 0 ? <Vacio>No hay vehículos activos en tu local.</Vacio> : (
          <ul className="grid gap-2">
            {app.vehiculos.map((x) => {
              const no = Boolean(x.ocupado || x.bloqueos.length);
              return (
                <li key={x.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${sel === x.id ? "border-primary bg-primary/5" : "border-line"} ${no ? "opacity-70" : ""}`}>
                    <input type="radio" name="vehiculo" className="mt-1" checked={sel === x.id} onChange={() => { setSel(x.id); setCh({}); setOdo(""); }} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">{x.etiqueta} <span className="text-[12px] font-normal text-muted">{x.tipo}</span>
                        {x.mio && <Badge tone="info">{x.ruta ? `Tu ruta ${x.ruta}` : `Programada ${x.programada}`}</Badge>}</span>
                      <span className="text-[12px] text-muted">Odómetro {numero(x.odometro, 0)} km</span>
                      {x.ocupado && <span className="text-[12px] text-warn">En jornada con {x.ocupado}</span>}
                      {x.bloqueos.map((b) => <span key={b} className="text-[12px] text-bad">{b}</span>)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>
      {v && (
        <>
          {v.bloqueos.length > 0 && <Bloqueos lista={v.bloqueos} />}
          <Seccion titulo="2. Odómetro y foto del tablero">
            <div className="space-y-3">
              <Field label="Odómetro (km)" required hint={`El último registrado es ${numero(v.odometro, 0)} km.`}>
                <Input type="number" inputMode="decimal" step="0.1" min={0} value={odo} onChange={(e) => setOdo(e.target.value)} placeholder={String(v.odometro)} />
              </Field>
              <Foto valor={foto} onChange={setFoto} texto="Foto del tablero" />
            </div>
          </Seccion>
          <Seccion titulo="3. Revisa el vehículo">
            <ul className="divide-y divide-line">
              {items.map(([k, l]) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-[13.5px]">{l}</span>
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant={ch[k] === true ? "primary" : "secondary"} onClick={() => setCh((c) => ({ ...c, [k]: true }))}>Bien</Button>
                    <Button type="button" size="sm" variant={ch[k] === false ? "danger" : "secondary"} onClick={() => setCh((c) => ({ ...c, [k]: false }))}>Observación</Button>
                  </span>
                </li>
              ))}
            </ul>
            {(observados > 0 || nota) && (
              <Field label="¿Qué observaste?" required={observados > 0}>
                <Textarea value={nota} maxLength={1000} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: la llanta trasera está baja" />
              </Field>
            )}
          </Seccion>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button variant="primary" type="submit" className="w-full" icon={Play} loading={guardando}
            disabled={!odo || !foto || !completo || v.bloqueos.length > 0 || Boolean(v.ocupado) || (observados > 0 && nota.trim().length < 5)}>
            Iniciar jornada
          </Button>
          {(!odo || !foto || !completo) && <p className="text-center text-[12px] text-muted">Falta: {[!odo && "odómetro", !foto && "foto del tablero", !completo && "checklist"].filter(Boolean).join(", ")}.</p>}
        </>
      )}
    </form>
  );
}

/** Ubicación del teléfono: la guarda en una cola local y la envía por lotes (si se cae la señal, se manda después). */
function useGps(vehiculo: string, activo: boolean, intervalo: number) {
  const [estado, setEstado] = useState<{ cola: number; enviado: string | null; error: string; precision: number | null }>({ cola: 0, enviado: null, error: "", precision: null });
  const ultimo = useRef(0);
  const enviando = useRef(false);
  const enviar = useCallback(async () => {
    const cola = leerCola();
    setEstado((e) => ({ ...e, cola: cola.length }));
    if (!cola.length || enviando.current) return;
    enviando.current = true;
    const lote = cola.slice(0, 500);
    try {
      await api("/v1/flo/posiciones", { method: "POST", body: { posiciones: lote } });
      const resto = leerCola().slice(lote.length);
      guardarCola(resto);
      setEstado((e) => ({ ...e, cola: resto.length, enviado: new Date().toISOString(), error: "" }));
    } catch (x) {
      setEstado((e) => ({ ...e, error: `No se pudo enviar (${mensajeDe(x)}). Se reintenta solo.` }));
    } finally {
      enviando.current = false;
    }
  }, []);
  useEffect(() => {
    if (!activo || typeof navigator === "undefined" || !navigator.geolocation) {
      if (activo) setEstado((e) => ({ ...e, error: "Este teléfono no da la ubicación." }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const ahora = p.timestamp || Date.now();
        if (ahora - ultimo.current < Math.max(5, intervalo) * 1000 * 0.9) return;
        ultimo.current = ahora;
        const c = p.coords;
        guardarCola([...leerCola(), {
          vehicle_id: vehiculo, recorded_at: new Date(ahora).toISOString(), lat: Number(c.latitude.toFixed(7)), lng: Number(c.longitude.toFixed(7)),
          speed_kmh: c.speed !== null && c.speed >= 0 ? Math.round(c.speed * 3.6 * 10) / 10 : null, heading: c.heading !== null && !Number.isNaN(c.heading) ? Math.round(c.heading) : null,
          accuracy_m: Math.round(c.accuracy),
        }]);
        setEstado((e) => ({ ...e, cola: leerCola().length, precision: Math.round(c.accuracy), error: "" }));
      },
      (err) => setEstado((e) => ({ ...e, error: err.code === err.PERMISSION_DENIED ? "Permite la ubicación al navegador para que el coordinador te vea en el mapa." : "No se obtiene la ubicación. Revisa el GPS." })),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [vehiculo, activo, intervalo]);
  useEffect(() => {
    void enviar();
    const t = window.setInterval(() => void enviar(), Math.max(10, intervalo) * 1000);
    const online = () => void enviar();
    window.addEventListener("online", online);
    return () => { window.clearInterval(t); window.removeEventListener("online", online); };
  }, [enviar, intervalo]);
  return { ...estado, enviar };
}

function EnCurso({ j, intervalo, enviarGps, onCambio }: { j: Jornada; intervalo: number; enviarGps: boolean; onCambio: () => void }) {
  const [gps, setGps] = useState(enviarGps);
  const [cerrar, setCerrar] = useState(false);
  const g = useGps(j.vehicle_id, gps, intervalo);
  return (
    <div className="space-y-4">
      <Seccion titulo={`Jornada ${j.number} · ${j.vehiculo}`} acciones={<Badge tone="ok">Abierta</Badge>}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
          <div><dt className="text-muted">Inicio</dt><dd className="font-medium">{hora(j.started_at)}</dd></div>
          <div><dt className="text-muted">Odómetro inicial</dt><dd className="font-medium tabular-nums">{numero(j.odometer_start, 0)} km</dd></div>
          <div><dt className="text-muted">Km por GPS</dt><dd className="font-medium tabular-nums">{numero(j.km_gps, 1)} km</dd></div>
          <div><dt className="text-muted">Entregas</dt><dd className="font-medium tabular-nums">{j.entregas}</dd></div>
        </dl>
      </Seccion>
      <Seccion titulo="Ubicación" acciones={enviarGps && (
        <Button size="sm" icon={gps ? Pause : MapPin} onClick={() => setGps((x) => !x)}>{gps ? "Pausar" : "Enviar ubicación"}</Button>
      )}>
        {!enviarGps ? <Vacio>Estás viendo la jornada de otro conductor: la ubicación la envía su teléfono.</Vacio> : (
          <div className="space-y-2 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              {gps ? <Badge tone="ok">Enviando cada {intervalo} s</Badge> : <Badge tone="warn">En pausa</Badge>}
              {g.precision !== null && <span className="text-muted">precisión {g.precision} m</span>}
            </p>
            <p className="text-muted">
              {g.cola > 0 ? `${g.cola} punto(s) por enviar. ` : ""}
              {g.enviado ? `Último envío ${hora(g.enviado)}.` : j.ultima ? `Última posición recibida ${hora(j.ultima.recorded_at)}.` : "Aún no llega ninguna posición."}
            </p>
            {g.error && <Alert tone="warn">{g.error}</Alert>}
            <p className="text-[12px] text-muted">Deja esta pantalla abierta durante la ruta. Si pierdes señal, los puntos se guardan en el teléfono y se envían al volver.</p>
          </div>
        )}
      </Seccion>
      <Seccion titulo="Combustible" acciones={<Link href={`/m/flo/flo-05?nueva=1&vehiculo=${j.vehicle_id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"><Fuel size={15} />Registrar carga</Link>}>
        {j.cargas.length === 0 ? <Vacio>Sin cargas en esta jornada. Tanque de {numero(j.tanque, 1)} gal.</Vacio> : (
          <ul className="divide-y divide-line text-[13px]">
            {j.cargas.map((c) => <li key={c.number} className="flex justify-between py-1.5"><span>{c.number} · {hora(c.loaded_at)}</span><span className="tabular-nums">{numero(c.gallons, 2)} gal · S/ {numero(c.amount, 2)}</span></li>)}
          </ul>
        )}
      </Seccion>
      <Button variant="primary" className="w-full" onClick={() => setCerrar(true)}>Cerrar jornada</Button>
      {cerrar && <Cierre j={j} onClose={() => setCerrar(false)} antes={g.enviar} onListo={() => { setCerrar(false); setGps(false); onCambio(); }} />}
    </div>
  );
}

function Cierre({ j, onClose, antes, onListo }: { j: Jornada; onClose: () => void; antes: () => Promise<void>; onListo: () => void }) {
  const [odo, setOdo] = useState("");
  const [nota, setNota] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const recorridos = odo ? Number(odo) - Number(j.odometer_start) : null;
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await antes();
      const checklist = Object.fromEntries(Object.keys(j.checklist).map((k) => [k, true]));
      const r = await api<{ km_diff_pct?: number | null }>(`/v1/flo/jornadas/${j.id}/cerrar`, { method: "POST", body: { odometer: Number(odo), checklist, notes: nota || undefined, foto_data: foto ?? undefined } });
      toast.ok(r.km_diff_pct !== null && r.km_diff_pct !== undefined && Math.abs(r.km_diff_pct) > 15 ? "Jornada cerrada. Los km no cuadran con el GPS: el coordinador lo revisará." : "Jornada cerrada.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Cerrar ${j.number}`} placement="center" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-cierre" loading={guardando} disabled={!odo || !foto}>Cerrar jornada</Button></>}>
      <form id="f-cierre" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Odómetro final (km)" required hint={`Inició con ${numero(j.odometer_start, 0)} km · el GPS lleva ${numero(j.km_gps, 1)} km.`}>
          <Input type="number" inputMode="decimal" step="0.1" min={Number(j.odometer_start)} value={odo} onChange={(e) => setOdo(e.target.value)} />
        </Field>
        {recorridos !== null && recorridos >= 0 && <p className="text-[13px] text-muted">Recorriste {numero(recorridos, 1)} km según el odómetro.</p>}
        {recorridos !== null && recorridos < 0 && <Alert tone="bad">El odómetro final no puede ser menor que el inicial.</Alert>}
        <Foto valor={foto} onChange={setFoto} texto="Foto del tablero" />
        <Field label="Comentario"><Textarea value={nota} maxLength={1000} onChange={(e) => setNota(e.target.value)} placeholder="Algo que deba saber el coordinador" /></Field>
      </form>
    </Modal>
  );
}

