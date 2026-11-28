"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";
import { Alert, Button, Cifra, Field, Input, PageHeader, Tabs, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/del/comunes";
import { mesLima } from "@/modulos/del/tipos";

type Fila = {
  clave: string; nombre: string; entregas: number; costo: number; por_entrega: number | null; kg: number; por_kg: number | null; km: number | null; por_km: number | null;
  subsidio: number; cobrado: number; grupos: { direct: number; vehicle: number; driver: number; carrier: number; other: number };
};
type Datos = {
  period: string; run_no: number | null; filas: Fila[];
  total: { entregas: number; costo: number; por_entrega: number | null; por_kg: number | null; km: number; por_km: number | null; subsidio: number; metodo: string | null; at: string | null; por: string | null } | null;
  corridas: { run_no: number; at: string; por: string; costo: number; entregas: number }[];
};
type Por = "zone" | "mode" | "vehicle" | "driver" | "route";

const s = (v: number | null | undefined) => (v == null ? "—" : soles(v));

/** DEL-14 Costo por entrega: reparte los costos del mes entre las entregas (por kg o por entrega) y los agrupa (RN-DEL-14, RN-DEL-15). */
export default function CostoEntrega() {
  const { can } = useSesion();
  const [mes, setMes] = useState(mesLima());
  const [por, setPor] = useState<Por>("zone");
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/del/costo-entrega?mes=${mes}&por=${por}`);
  const [ocupado, setOcupado] = useState(false);
  const calcular = async () => {
    const c = await confirmAction({ title: "Calcular el costo por entrega", confirmLabel: "Calcular",
      message: "Se hace una corrida nueva con los costos y entregas registrados hasta ahora. Las corridas anteriores se conservan." });
    if (!c) return;
    setOcupado(true);
    try {
      const r = await api<{ entregas: number; costo_total: number }>("/v1/del/costo-entrega/calcular", { method: "POST", body: { mes } });
      toast.ok(`Corrida lista: ${r.entregas} entrega(s), ${soles(r.costo_total)}.`);
      recargar();
    } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
  };
  const t = datos?.total;
  return (
    <div className="space-y-5">
      <PageHeader description="Cada costo va primero a su destino (ruta, vehículo, repartidor, empresa o zona) y se reparte entre sus entregas. Con delivery gratis, el costo entero es subsidio."
        actions={can("del.cost.manage") && <Button variant="primary" icon={Calculator} loading={ocupado} onClick={calcular}>Calcular</Button>} />
      <Field label="Mes" className="max-w-[200px]"><Input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} /></Field>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.run_no ? <Vacio>Aún no se calculó el costo por entrega de este mes.</Vacio> : (
        <>
          <p className="text-[12.5px] text-muted">Corrida {datos.run_no}{t?.at ? ` · ${fechaHora(t.at)}` : ""}{t?.por ? ` · ${t.por}` : ""}{t?.metodo ? ` · reparto ${t.metodo === "KG" ? "por kg" : "por entrega"}` : ""}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Cifra titulo="Por entrega" valor={s(t?.por_entrega)} detalle={`${t?.entregas ?? 0} entrega(s)`} destacada />
            <Cifra titulo="Costo total" valor={s(t?.costo)} />
            <Cifra titulo="Por kg" valor={s(t?.por_kg)} />
            <Cifra titulo="Subsidio" valor={s(t?.subsidio)} tono={(t?.subsidio ?? 0) > 0 ? "warn" : undefined} detalle="Costo menos lo cobrado" />
          </div>
          <Tabs value={por} onChange={setPor} tabs={[{ key: "zone", label: "Zona" }, { key: "mode", label: "Modalidad" }, { key: "vehicle", label: "Vehículo" }, { key: "driver", label: "Repartidor" }, { key: "route", label: "Ruta" }]} />
          {!datos.filas.length ? <Vacio>Sin entregas en esta corrida.</Vacio> : (
            <div className="grid gap-3 md:grid-cols-2">
              {datos.filas.map((f) => (
                <Seccion key={f.clave ?? f.nombre} titulo={f.nombre} acciones={<span className="text-[15px] font-semibold text-ink">{s(f.por_entrega)}</span>}>
                  <p className="text-[12.5px] text-muted">{f.entregas} entrega(s) · {kg(f.kg)} · costo {soles(f.costo)}{f.por_kg != null ? ` · ${soles(f.por_kg)}/kg` : ""}{f.por_km != null ? ` · ${soles(f.por_km)}/km` : ""}</p>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Directo {soles(f.grupos.direct)} · vehículo {soles(f.grupos.vehicle)} · repartidor {soles(f.grupos.driver)} · tercero {soles(f.grupos.carrier)} · otros {soles(f.grupos.other)}
                  </p>
                  <p className="mt-1 text-[12.5px]">Cobrado {soles(f.cobrado)} · <span className={f.subsidio > 0 ? "text-warn" : "text-ok"}>subsidio {soles(f.subsidio)}</span></p>
                </Seccion>
              ))}
            </div>
          )}
          {datos.corridas.length > 1 && (
            <Seccion titulo="Corridas del mes">
              <ul className="divide-y divide-line text-[13px]">
                {datos.corridas.map((c) => <li key={c.run_no} className="py-1.5">Corrida {c.run_no} · {fechaHora(c.at)} · {c.por} · {c.entregas} entrega(s) · {soles(c.costo)}</li>)}
              </ul>
            </Seccion>
          )}
        </>
      )}
    </div>
  );
}
