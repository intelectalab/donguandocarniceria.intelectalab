"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CircleDollarSign, Plus, ShieldCheck, ShieldX } from "lucide-react";
import { Button, DataTable, PageHeader, type Column } from "@/components/ui";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CifraLink, FiltroSelect, FormCalibracion, qs, resultado, useAlAbrir, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { CATEGORIA, type Calibracion, type Num } from "@/modulos/equ/tipos";

type Cifras = { year: number; this_year: number; failed: number; cost: Num; scale_months: number };

/** EQU-03 Calibraciones: fecha, vigencia, proveedor, número y archivo del certificado, error máximo, resultado y costo. Solo inserción (RN-EQU-12). */
export default function Calibraciones() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesEqu();
  const [res, setRes] = useState("");
  const [cat, setCat] = useState("");
  const lista = useListado<Calibracion>("/v1/equ/calibraciones", { orden: "-calibrated_on", filtros: { result: res, category: cat, site: local } });
  const c = useDatos<Cifras>(`/v1/equ/cifras/03${qs({ site: local })}`);
  const [nueva, setNueva] = useState<{ equipo: string | null } | null>(null);
  useAlAbrir((p) => { if (p.get("nuevo")) setNueva({ equipo: p.get("id") }); });
  const registra = Boolean(op?.can.calibrate) && puede("EQU", "C");

  const columnas: Column<Calibracion>[] = [
    { key: "calibrated_on", header: "Fecha", sortable: true, render: (x) => <span className="whitespace-nowrap">{fecha(x.calibrated_on)}</span> },
    { key: "equipment_code", header: "Equipo", sortable: true, cardTitle: true, render: (x) => <div className="min-w-[160px]"><p className="font-mono font-semibold">{x.equipment_code}</p>
      <p className="text-[12px] text-muted">{x.equipment_name} · {CATEGORIA[x.category ?? ""] ?? x.category}</p></div> },
    { key: "valid_until", header: "Vigente hasta", sortable: true, render: (x) => <span className="whitespace-nowrap">{fecha(x.valid_until)}</span> },
    { key: "certificate_number", header: "Certificado", render: (x) => <div><p className="font-mono">{x.certificate_number}</p><p className="max-w-[200px] truncate text-[12px] text-muted" title={x.certificate_url}>{x.certificate_url}</p></div> },
    { key: "provider_name", header: "Proveedor", hideOnMobile: true, render: (x) => <span className="line-clamp-2 max-w-[220px]">{x.provider_name ?? "—"}</span> },
    { key: "max_error_g", header: "Error máx.", align: "right", render: (x) => x.max_error_g != null ? `${numero(x.max_error_g, 2)} ${x.category === "THERMOMETER" ? "°C" : "g"}` : "—" },
    { key: "result", header: "Resultado", sortable: true, render: (x) => resultado(x.result) },
    { key: "cost", header: "Costo", sortable: true, align: "right", render: (x) => soles(x.cost) },
    { key: "recorded_by", header: "Registró", hideOnMobile: true, render: (x) => x.recorded_by },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada calibración con su certificado. No se editan ni se borran: un error se corrige registrando otra. Un resultado no conforme deja el equipo fuera de servicio."
        actions={registra && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNueva({ equipo: null })}>Registrar calibración</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo={`Calibraciones ${c.datos?.year ?? ""}`} valor={c.datos ? numero(c.datos.this_year) : undefined} detalle="Registradas en el año" icono={ShieldCheck} />
        <CifraLink titulo="No conformes" valor={c.datos ? numero(c.datos.failed) : undefined} detalle="Dejaron el equipo fuera de servicio" icono={ShieldX} tono={c.datos?.failed ? "bad" : "ok"}
          onClick={() => setRes("FAIL")} />
        <CifraLink titulo="Costo del año" valor={c.datos ? soles(c.datos.cost) : undefined} detalle="Laboratorios y certificados" icono={CircleDollarSign} />
        <CifraLink titulo="Vigencia sugerida" valor={c.datos ? `${c.datos.scale_months} meses` : undefined} detalle="Balanzas" icono={CalendarClock} href="/m/equ/equ-04" />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(x) => router.push(`/m/equ/equ-02?id=${x.equipment_id}`)}
        search={{ ...lista.tabla.search, placeholder: "Buscar equipo, certificado o proveedor…" }} empty="No hay calibraciones con esos filtros."
        toolbar={<>
          <FiltroSelect label="Resultado" value={res} onChange={setRes} options={[{ value: "PASS", label: "Conforme" }, { value: "FAIL", label: "No conforme" }]} />
          <FiltroSelect label="Categoría" value={cat} onChange={setCat} options={[{ value: "SCALE", label: "Balanzas" }, { value: "THERMOMETER", label: "Termómetros" }]} />
        </>} />
      {nueva && op && <FormCalibracion op={op} equipoId={nueva.equipo} onClose={() => setNueva(null)} onGuardado={() => { setNueva(null); lista.recargar(); c.recargar(); }} />}
    </div>
  );
}
