"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Thermometer } from "lucide-react";
import { Alert, Badge, Button, Cifra, FiltroSelect, PageHeader } from "@/components/ui";
import { fechaHora, numero } from "@/lib/formato";
import { ErrorCarga, Estado, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { MapaFlota, colorTono, type PuntoFlota, type Trazo } from "@/modulos/flo/Mapa";
import { ESTADO_VIVO, SEVERIDAD, hora } from "@/modulos/flo/tipos";

type VehiculoVivo = {
  id: string; etiqueta: string; plate: string; tipo: string; modalidad: string; ownership: string; refrigerated: boolean; estado: string; bloqueos: string[];
  jornada: { id: string; number: string; started_at: string; conductor: string; odometer_start: number } | null;
  posicion: { lat: number; lng: number; speed_kmh: number; recorded_at: string } | null;
  minutos_sin_senal: number | null; rastro: [number, number][]; km_gps: number | null;
  ruta: { code: string; status: string } | null; proxima: { seq: number; number: string; eta: string | null } | null;
  temperatura: { temp_c: number; in_range: boolean; read_at: string } | null; rango: { min: number | null; max: number } | null;
  alertas: { id: string; number: string; alert_type: string; tipo: string; title: string; severity: string }[];
};
type Mapa = {
  vehiculos: VehiculoVivo[]; locales: { id: string; code: string; name: string; lat: number; lng: number }[]; ahora: string;
  resumen: { en_jornada: number; movimiento: number; silenciosos: number; bloqueados: number; alertas: number };
};

/** FLO-01 Mapa en vivo: vehículos en jornada con su última posición, velocidad, ruta, próxima parada, temperatura y alertas. */
export default function MapaEnVivo() {
  const { datos: op } = useOpciones();
  const [local, setLocal] = useState("");
  const [modalidad, setModalidad] = useState("");
  const [elegido, setElegido] = useState("");
  const q = new URLSearchParams({ barrido: "1", ...(local ? { local } : {}), ...(modalidad ? { modalidad } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Mapa>(`/v1/flo/mapa?${q}`);
  // La app manda la posición cada 30 s: el mapa se refresca cada 30 s.
  useEffect(() => { const t = window.setInterval(recargar, 30000); return () => window.clearInterval(t); }, [recargar]);

  if (error) return <ErrorCarga error={error} que="El mapa en vivo es del coordinador de delivery y de gerencia." />;
  const vs = datos?.vehiculos ?? [];
  const tono = (v: VehiculoVivo) => ESTADO_VIVO[v.estado]?.[1] ?? "neutral";
  const puntos: PuntoFlota[] = [
    ...(datos?.locales ?? []).map((l) => ({ id: `local-${l.id}`, lat: l.lat, lng: l.lng, label: l.code, title: l.name, color: "#6b6b6b" })),
    ...vs.filter((v) => v.posicion).map((v) => ({
      id: v.id, lat: v.posicion!.lat, lng: v.posicion!.lng, label: v.plate, color: colorTono(tono(v)),
      title: `${v.etiqueta} · ${v.jornada?.conductor ?? ""} · ${numero(v.posicion!.speed_kmh, 0)} km/h`,
    })),
  ];
  const trazos: Trazo[] = vs.filter((v) => v.rastro.length > 1 && (!elegido || v.id === elegido)).map((v) => ({ id: v.id, puntos: v.rastro, color: colorTono(tono(v)) }));
  const sel = vs.find((v) => v.id === elegido);

  return (
    <div className="space-y-4">
      <PageHeader description="Dónde está cada unidad en jornada: la última posición que mandó la app, su velocidad, la ruta y la próxima parada, la temperatura del furgón y sus alertas. Se actualiza cada 30 segundos."
        actions={<Button icon={RefreshCw} onClick={recargar}>Actualizar</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="En jornada" valor={datos ? String(datos.resumen.en_jornada) : undefined} detalle={datos ? `${datos.resumen.movimiento} en movimiento` : ""} destacada />
        <Cifra titulo="GPS silencioso" valor={datos ? String(datos.resumen.silenciosos) : undefined} detalle={`más de ${op?.parametros.gps_silencio ?? 10} min sin posición`} tono={datos?.resumen.silenciosos ? "warn" : undefined} />
        <Cifra titulo="No pueden salir" valor={datos ? String(datos.resumen.bloqueados) : undefined} detalle="documentos o mantenimiento" tono={datos?.resumen.bloqueados ? "bad" : undefined} />
        <Cifra titulo="Alertas abiertas" valor={datos ? String(datos.resumen.alertas) : undefined} detalle="de estas unidades" tono={datos?.resumen.alertas ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Local" value={local} onChange={setLocal} options={(op?.locales ?? []).map((l) => ({ value: l.id, label: l.name }))} ancho={220} />
        <FiltroSelect etiqueta="Modalidad" value={modalidad} onChange={setModalidad} options={[{ value: "OWN", label: "Propio" }, { value: "RENTED", label: "Alquilado" }]} />
      </div>
      {cargando && !datos ? <Vacio>Cargando…</Vacio> : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Seccion titulo={sel ? `Rastro de ${sel.etiqueta}` : "Mapa"} acciones={sel && <Button size="sm" variant="ghost" onClick={() => setElegido("")}>Ver todas</Button>}>
            <MapaFlota height={440} puntos={puntos} trazos={trazos} onSelect={(id) => !id.startsWith("local-") && setElegido(id)} encuadre={elegido} />
            <p className="mt-2 text-[12px] text-muted">El trazo es lo último que recorrió (las 40 posiciones más recientes). Toca un vehículo para ver solo el suyo.</p>
          </Seccion>
          <div className="space-y-3">
            {vs.length === 0 && <Vacio>No hay vehículos con estos filtros.</Vacio>}
            {vs.map((v) => (
              <button key={v.id} type="button" onClick={() => setElegido(v.id === elegido ? "" : v.id)}
                className={`block w-full cursor-pointer rounded-xl border bg-surface p-3 text-left shadow-card ${elegido === v.id ? "border-primary" : "border-line"}`}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold text-ink">{v.etiqueta}</span>
                    <span className="block text-[12.5px] text-muted">{v.tipo} · {v.modalidad}{v.jornada ? ` · ${v.jornada.conductor}` : ""}</span>
                  </span>
                  <Estado s={v.estado} labels={ESTADO_VIVO} />
                </span>
                {v.jornada && (
                  <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px] text-ink">
                    <span>Jornada {v.jornada.number} desde {hora(v.jornada.started_at)}</span>
                    <span>{v.km_gps !== null ? `${numero(v.km_gps, 1)} km por GPS` : "—"}</span>
                    <span>{v.posicion ? `${numero(v.posicion.speed_kmh, 0)} km/h · ${hora(v.posicion.recorded_at)}` : "Sin posición aún"}</span>
                    <span className={v.estado === "SILENT" ? "font-semibold text-warn" : ""}>{v.minutos_sin_senal !== null ? `hace ${v.minutos_sin_senal} min` : ""}</span>
                    {v.ruta && <span>Ruta {v.ruta.code}</span>}
                    {v.proxima && <span>Próxima: parada {v.proxima.seq} · {v.proxima.number}{v.proxima.eta ? ` (${hora(v.proxima.eta)})` : ""}</span>}
                  </span>
                )}
                {v.refrigerated && v.temperatura && (
                  <span className={`mt-2 flex items-center gap-1.5 text-[12.5px] ${v.temperatura.in_range ? "text-ok" : "font-semibold text-bad"}`}>
                    <Thermometer size={14} aria-hidden="true" /> {numero(v.temperatura.temp_c, 1)} °C (rango {v.rango?.min ?? "—"} a {v.rango?.max} °C) · {fechaHora(v.temperatura.read_at)}
                  </span>
                )}
                {!v.jornada && v.bloqueos.length > 0 && <span className="mt-2 block text-[12.5px] text-bad">{v.bloqueos.join(" ")}</span>}
                {v.alertas.length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1">
                    {v.alertas.slice(0, 3).map((a) => <Badge key={a.id} tone={SEVERIDAD[a.severity]?.[1] ?? "warn"}>{a.tipo}</Badge>)}
                    {v.alertas.length > 3 && <Badge>+{v.alertas.length - 3}</Badge>}
                  </span>
                )}
              </button>
            ))}
            {sel && (
              <Alert tone="info">
                <Link className="font-medium text-primary hover:underline" href={`/m/flo/flo-02?vehiculo=${sel.id}`}>Ver el recorrido del día</Link>
                {" · "}
                <Link className="font-medium text-primary hover:underline" href={`/m/flo/flo-04?id=${sel.id}`}>Ficha del vehículo</Link>
                {sel.alertas.length > 0 && <>{" · "}<Link className="font-medium text-primary hover:underline" href={`/m/flo/flo-14?vehiculo=${sel.id}`}>Sus alertas</Link></>}
              </Alert>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
