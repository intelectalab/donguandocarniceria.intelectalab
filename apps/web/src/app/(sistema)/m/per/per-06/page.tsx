"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff, LocateFixed, QrCode, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, PageHeader, Select, Tabs, toast } from "@/components/ui";
import { ApiError, api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { Escaner, sonar } from "@/modulos/pre/Escaner";
import { ErrorCarga, Estado, Seccion, Vacio, useDatos } from "@/modulos/per/comunes";
import { ESTADO_DIA, MARCAS, hora, hoyLima, minutos } from "@/modulos/per/tipos";

type Marca = { id: string; mark_type: string; tipo: string; marked_at: string; method: string; distance_m: number | null; is_valid: boolean; invalid_reason: string | null; synced_late: boolean; repetida?: boolean };
type App = {
  vinculado: boolean; trabajador?: string; local?: { id: string; short: string; name: string; lat: string | null; lng: string | null } | null; radio_m?: number;
  turno?: { code: string; name: string; inicio: string; fin: string } | null; descanso?: boolean; marcas?: Marca[];
  dia?: { worked_minutes: number; late_minutes: number; status: string } | null; siguiente?: string; mes?: { trabajados: number; tardanzas: number; min_tardanza: number; faltas: number };
};
type Pendiente = { method: string; mark_type: string; establishment_id?: string; lat?: number; lng?: number; qr_token?: string; marked_at: string; offline_uuid: string; device_id: string; foto?: string };

const COLA = "per-marcas-cola";
const leerCola = (): Pendiente[] => {
  try {
    return JSON.parse(localStorage.getItem(COLA) ?? "[]") as Pendiente[];
  } catch {
    return [];
  }
};
const guardarCola = (c: Pendiente[]) => localStorage.setItem(COLA, JSON.stringify(c.slice(-50)));
const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
function dispositivo(): string {
  let d = localStorage.getItem("per-dispositivo");
  if (!d) {
    d = `web-${uuid().slice(0, 8)}`;
    localStorage.setItem("per-dispositivo", d);
  }
  return d;
}
/** Hora local con su desfase (2026-11-26T08:01:00-05:00): la API guarda la hora en que se marcó, no la de envío. */
function ahoraIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
const sinRed = (x: unknown) => !(x instanceof ApiError) || x.status === 0 || x.status >= 502;

function ubicacion(): Promise<GeolocationPosition> {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) return mal(new Error("Este celular no da su ubicación: usa el QR del local."));
    navigator.geolocation.getCurrentPosition(ok, (e) => mal(new Error(e.code === 1 ? "Permite la ubicación en el navegador para marcar con GPS, o usa el QR del local." : "No se pudo obtener la ubicación. Sal a un lugar abierto o usa el QR.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/** PER-06 App · Marcación: entrada, refrigerio y salida con GPS o leyendo el QR del local; foto opcional y funciona sin conexión (RN-PER-03, 04 y 06). */
export default function Marcacion() {
  const { datos, error, recargar } = useDatos<App>("/v1/per/app");
  const [metodo, setMetodo] = useState<"GEO" | "QR">("GEO");
  const [tipo, setTipo] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<Marca | null>(null);
  const [cola, setCola] = useState<Pendiente[]>([]);
  const [enviando, setEnviando] = useState(false);

  const vaciar = useCallback(async () => {
    const pend = leerCola();
    if (!pend.length || !navigator.onLine) return;
    setEnviando(true);
    const quedan: Pendiente[] = [];
    let ok = 0;
    for (const p of pend) {
      try {
        await api("/v1/per/marcaciones", { method: "POST", body: p });
        ok++;
      } catch (x) {
        if (sinRed(x)) quedan.push(p);
        else toast.error(`Marcación de las ${hora(p.marked_at)}: ${mensajeDe(x)}`);
      }
    }
    guardarCola(quedan);
    setCola(quedan);
    setEnviando(false);
    if (ok) {
      toast.ok(`${ok} marcación(es) guardadas sin conexión se enviaron.`);
      recargar();
    }
  }, [recargar]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCola(leerCola());
    vaciar();
    window.addEventListener("online", vaciar);
    return () => window.removeEventListener("online", vaciar);
  }, [vaciar]);

  if (error) return <ErrorCarga error={error} que="La marcación es para el personal con usuario vinculado a su ficha." />;
  if (!datos) return <p className="text-[13px] text-muted">Cargando…</p>;
  if (!datos.vinculado) return <Alert tone="info" title="Tu usuario no está vinculado a un trabajador">Pide a RR. HH. que vincule tu usuario a tu ficha para marcar asistencia.</Alert>;
  const marcaTipo = tipo || datos.siguiente || "IN";

  async function enviar(extra: Partial<Pendiente>) {
    const body: Pendiente = { method: metodo, mark_type: marcaTipo, establishment_id: datos?.local?.id, marked_at: ahoraIso(), offline_uuid: uuid(), device_id: dispositivo(), ...(foto ? { foto } : {}), ...extra };
    try {
      const r = await api<Marca>("/v1/per/marcaciones", { method: "POST", body });
      setResultado(r);
      sonar(r.is_valid);
      setFoto(null);
      setTipo("");
      recargar();
    } catch (x) {
      if (sinRed(x)) {
        const c = [...leerCola(), body];
        guardarCola(c);
        setCola(c);
        sonar(true);
        toast.info("Sin conexión: la marcación quedó guardada en este celular y se enviará sola al volver la señal (hasta 48 horas).");
      } else {
        sonar(false);
        toast.error(mensajeDe(x));
      }
    }
  }

  async function conGps() {
    setOcupado(true);
    setResultado(null);
    try {
      const p = await ubicacion();
      await enviar({ lat: p.coords.latitude, lng: p.coords.longitude });
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setOcupado(false);
    }
  }

  async function conQr(codigo: string) {
    setOcupado(true);
    setResultado(null);
    try {
      await enviar({ qr_token: codigo });
    } finally {
      setOcupado(false);
    }
  }

  const m = datos.mes;
  return (
    <div className="mx-auto max-w-[560px] space-y-4">
      <PageHeader description="Marca tu entrada, refrigerio y salida. Con GPS debes estar dentro del local; con QR, lee el código que cambia en la pantalla del local." />
      <Seccion>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[16px] font-semibold text-ink">{datos.trabajador}</p>
            <p className="text-[13px] text-muted">{datos.local?.short ?? "Sin local"} · {fecha(hoyLima())}</p>
            <p className="text-[13px]">{datos.descanso ? "Hoy es tu descanso" : datos.turno ? `Turno ${datos.turno.name}: ${datos.turno.inicio} a ${datos.turno.fin}` : "Sin turno programado hoy"}</p>
          </div>
          {datos.dia && <Estado s={datos.dia.status} labels={ESTADO_DIA} />}
        </div>
        {cola.length > 0 && (
          <Alert tone="warn" title={`${cola.length} marcación(es) sin enviar`}>
            <span className="flex flex-wrap items-center gap-2">Se guardaron sin conexión. <Button size="sm" icon={RefreshCw} loading={enviando} onClick={vaciar}>Enviar ahora</Button></span>
          </Alert>
        )}
      </Seccion>

      <Seccion titulo="Marcar">
        <div className="space-y-3">
          <Select aria-label="Tipo de marcación" value={marcaTipo} onChange={(e) => setTipo(e.target.value)} options={Object.entries(MARCAS).map(([value, label]) => ({ value, label: value === datos.siguiente ? `${label} (te toca)` : label }))} />
          <Tabs tabs={[{ key: "GEO", label: "Con GPS" }, { key: "QR", label: "Con QR del local" }]} value={metodo} onChange={(k) => setMetodo(k)} />
          {metodo === "GEO" ? (
            <div className="space-y-2">
              <Button variant="primary" icon={LocateFixed} loading={ocupado} className="h-14 w-full text-[16px]" onClick={conGps}>Marcar {MARCAS[marcaTipo].toLowerCase()}</Button>
              <p className="text-[12.5px] text-muted">Debes estar a menos de {datos.radio_m ?? 100} m de {datos.local?.short ?? "tu local"}. Fuera del radio la marcación queda registrada pero inválida.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Escaner onLeer={conQr} ocupado={ocupado} placeholder="Lee el QR o escribe el código (L1-…)" />
              <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><QrCode className="h-4 w-4" /> El código cambia cada minuto: uno viejo se rechaza.</p>
            </div>
          )}
          <Foto valor={foto} onChange={setFoto} texto="Foto (opcional)" />
          {resultado && (
            <Alert tone={resultado.is_valid ? "ok" : "bad"} title={resultado.is_valid ? `${resultado.tipo} registrada a las ${hora(resultado.marked_at)}` : "Marcación registrada como inválida"}>
              {resultado.invalid_reason ?? (resultado.repetida ? "Ya estaba registrada." : resultado.distance_m !== null ? `A ${Math.round(resultado.distance_m)} m del local.` : "Con el QR del local.")}
            </Alert>
          )}
        </div>
      </Seccion>

      <Seccion titulo="Hoy">
        {datos.marcas?.length ? (
          <ul className="space-y-1.5 text-[13.5px]">
            {datos.marcas.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-2">
                <span>{x.tipo} <span className="text-[12px] text-muted">· {x.method === "GEO" ? "GPS" : x.method === "QR" ? "QR" : "manual"}{x.synced_late ? " · sin conexión" : ""}</span></span>
                <span className="flex items-center gap-2"><span className="tabular-nums">{hora(x.marked_at)}</span>{!x.is_valid && <Badge tone="bad">inválida</Badge>}</span>
              </li>
            ))}
          </ul>
        ) : <Vacio>Aún no marcas hoy.</Vacio>}
        {datos.dia && datos.dia.late_minutes > 0 && <p className="mt-2 text-[13px] text-warn">Tardanza de {minutos(datos.dia.late_minutes)}.</p>}
        {cola.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-warn"><CloudOff className="h-4 w-4" /> {cola.map((c) => `${MARCAS[c.mark_type]} ${hora(c.marked_at)}`).join(" · ")} por enviar</p>}
      </Seccion>

      {m && (
        <Seccion titulo="Este mes">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-[20px] font-semibold">{m.trabajados}</p><p className="text-[12px] text-muted">días trabajados</p></div>
            <div><p className="text-[20px] font-semibold">{m.tardanzas}</p><p className="text-[12px] text-muted">tardanzas ({m.min_tardanza} min)</p></div>
            <div><p className="text-[20px] font-semibold">{m.faltas}</p><p className="text-[12px] text-muted">faltas</p></div>
          </div>
        </Seccion>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href="/m/per/per-08" className="text-[13px] font-medium text-primary hover:underline">Pedir permiso o vacaciones</Link>
        <span className="text-muted">·</span>
        <Link href="/m/per/per-09" className="text-[13px] font-medium text-primary hover:underline">Pedir adelanto</Link>
      </div>
    </div>
  );
}
