"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Badge, FiltroFecha, MapView, PageHeader, StatusBadge } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { Avance, Seccion, Vacio, hoyLima, useDatos } from "@/modulos/del/comunes";
import { PARADA, R, RUTA, hora } from "@/modulos/del/tipos";

type ParadaMapa = { id: string; seq: number; status: string; eta: string | null; pedido: string; cliente: string | null; distrito: string | null; lat: number | null; lng: number | null; atrasada: boolean; fuera_radio: boolean };
type RutaMapa = { id: string; code: string; status: string; mode: string; repartidor: string | null; plate: string | null; empresa: string | null; franja?: string;
  posicion: { lat: number; lng: number; at: string; fuente: string } | null; paradas: ParadaMapa[]; total: number; hechas: number; atrasadas: number; local: [number, number] };
type Mapa = { rutas: RutaMapa[]; fuera_radio: { ruta: string; parada: number; pedido: string; distancia_m: number; hora: string }[]; radio_m: number };

/** DEL-07 Seguimiento en mapa: rutas en curso con su última posición, paradas hechas y atrasadas, entregas fuera del radio. */
export default function Seguimiento() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const [dia, setDia] = useState(useSearchParams().get("fecha") ?? hoyLima());
  const [ruta, setRuta] = useState("");
  const { datos, error, cargando, recargar } = useDatos<Mapa>(`/v1/del/mapa?fecha=${dia}`);
  useEffect(() => { const t = window.setInterval(recargar, 60000); return () => window.clearInterval(t); }, [recargar]);

  const vistas = (datos?.rutas ?? []).filter((r) => !ruta || r.id === ruta);
  const puntos = vistas.flatMap((r) => [
    ...(r.posicion ? [{ id: `pos-${r.id}`, lat: r.posicion.lat, lng: r.posicion.lng, label: `Ahora ${r.code}`, title: `${r.repartidor ?? r.empresa ?? ""} · ${fechaHora(r.posicion.at)}` }] : []),
    ...r.paradas.filter((p) => p.lat !== null && p.lng !== null).map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, label: `${r.code}·${p.seq}`, title: `${p.pedido} · ${p.cliente ?? ""}`, muted: !["PENDING", "ARRIVED"].includes(p.status) })),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader description="Dónde va cada ruta: la última posición del repartidor, las paradas hechas y las atrasadas, y las entregas tomadas lejos del pin. Se actualiza cada minuto." />
      <FiltroFecha etiqueta="Fecha" value={dia} onChange={(v) => setDia(v || hoyLima())} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.rutas.length ? <Vacio>No hay rutas para esta fecha.</Vacio> : (
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Seccion titulo="Mapa">{puntos.length ? <MapView height={420} points={puntos} /> : <Vacio>Aún no hay posiciones.</Vacio>}</Seccion>
          <div className="space-y-3">
            {datos.fuera_radio.length > 0 && (
              <Alert tone="warn" title={`Entregas a más de ${datos.radio_m} m del pin`}>
                {datos.fuera_radio.map((f) => <span key={`${f.ruta}-${f.parada}`} className="block">{f.ruta} · parada {f.parada} · {f.pedido}: {Math.round(f.distancia_m)} m</span>)}
              </Alert>
            )}
            {datos.rutas.map((r) => (
              <div key={r.id} className={`rounded-xl border bg-surface p-3 shadow-card ${ruta === r.id ? "border-primary" : "border-line"}`}>
                <button type="button" className="w-full cursor-pointer text-left" onClick={() => setRuta(ruta === r.id ? "" : r.id)}>
                  <span className="flex items-center justify-between gap-2"><span className="text-[14.5px] font-semibold text-ink">{r.code}</span><StatusBadge status={r.status} labels={RUTA} /></span>
                  <span className="block text-[12.5px] text-muted">{r.mode === "THIRD_PARTY" ? r.empresa : `${r.plate ?? ""} · ${r.repartidor ?? ""}`}{r.posicion ? ` · visto ${hora(r.posicion.at)}` : ""}</span>
                  <span className="mt-1.5 block"><Avance valor={r.total ? (r.hechas / r.total) * 100 : 0} tono={r.atrasadas ? "warn" : undefined} /></span>
                  <span className="mt-1 flex flex-wrap gap-1 text-[12px]">
                    <Badge>{r.hechas}/{r.total} hechas</Badge>{r.atrasadas > 0 && <Badge tone="warn">{r.atrasadas} atrasada(s)</Badge>}
                  </span>
                </button>
                {ruta === r.id && (
                  <ul className="mt-2 divide-y divide-line">
                    {r.paradas.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-[12.5px]">
                        <span className="min-w-0 truncate">{p.seq}. {p.cliente ?? p.pedido} · ~{hora(p.eta)}{p.atrasada ? " · atrasada" : ""}{p.fuera_radio ? " · fuera del radio" : ""}</span>
                        <StatusBadge status={p.status} labels={PARADA} />
                      </li>
                    ))}
                    <li className="pt-2"><button type="button" className="cursor-pointer text-[12.5px] font-medium text-primary" onClick={() => router.push(`${R.hoja}?id=${r.id}`)}>Abrir hoja de ruta</button></li>
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
