"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Field, Input, PageHeader } from "@/components/ui";
import { soles } from "@/lib/formato";
import { Dato, Seccion, Vacio, useDatos } from "@/modulos/del/comunes";
import { R, mesLima } from "@/modulos/del/tipos";

type Zona = {
  zone_id: string; zona: string; entregas: number; propia: number | null; alquilada: number | null; tercero: number | null; tarifa: number | null;
  diferencia: number | null; sugerencia: "EVALUAR_TERCERIZAR" | "MANTENER_PROPIO" | "SIN_DATOS";
};

const SUGERENCIA = {
  EVALUAR_TERCERIZAR: ["Evaluar tercerizar", "warn"], MANTENER_PROPIO: ["Mantener propio", "ok"], SIN_DATOS: ["Sin datos para comparar", "neutral"],
} as const;
const s = (v: number | null) => (v == null ? "—" : soles(v));

/** DEL-15 Comparativo por zona: costo por entrega propio y alquilado frente a la tarifa de la empresa de delivery. */
export default function Comparativo() {
  const [mes, setMes] = useState(mesLima());
  const { datos, error, cargando } = useDatos<{ period: string; run_no: number | null; zonas: Zona[] }>(`/v1/del/comparativo?mes=${mes}`);
  return (
    <div className="space-y-5">
      <PageHeader description="Usa la última corrida del costo por entrega. Si el reparto propio cuesta más que la tarifa vigente del tercero, conviene evaluar tercerizar esa zona." />
      <Field label="Mes" className="max-w-[200px]"><Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Field>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.run_no ? (
        <Vacio>Calcula primero el <Link className="text-primary underline" href={R.costoEntrega}>costo por entrega</Link> de este mes.</Vacio>
      ) : !datos.zonas.length ? <Vacio>No hay entregas por zona en este mes.</Vacio> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {datos.zonas.map((z) => {
            const [txt, tono] = SUGERENCIA[z.sugerencia];
            return (
              <Seccion key={z.zone_id ?? z.zona} titulo={z.zona} acciones={<Badge tone={tono}>{txt}</Badge>}>
                <Dato label="Entregas">{z.entregas}</Dato>
                <Dato label="Propia, por entrega">{s(z.propia)}</Dato>
                <Dato label="Alquilada, por entrega">{s(z.alquilada)}</Dato>
                <Dato label="Tercero, por entrega (real)">{s(z.tercero)}</Dato>
                <Dato label="Tarifa vigente del tercero">{s(z.tarifa)}</Dato>
                <Dato label="Diferencia">{z.diferencia == null ? "—" : <span className={z.diferencia > 0 ? "text-warn" : "text-ok"}>{z.diferencia > 0 ? "+" : ""}{soles(z.diferencia)}</span>}</Dato>
              </Seccion>
            );
          })}
        </div>
      )}
    </div>
  );
}
