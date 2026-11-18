"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDollarSign, Plus, Scale, Wrench } from "lucide-react";
import { Badge, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Apto, CifraLink, FiltroSelect, FormEquipo, Qr, VentanaQr, qs, urlDelQr, useDatos, useOpcionesEqu } from "@/modulos/equ/comunes";
import { CATEGORIA, CATEGORIAS, ESTADO, ESTADOS, type Num } from "@/modulos/equ/tipos";

type Fila = {
  id: string; code: string; name: string; category: string; status: string; establishment_name: string; warehouse_code: string | null; brand_name: string | null;
  model: string | null; serial_number: string | null; qr_code: string; requires_calibration: boolean; hour_meter: Num; cal_valid_until: string | null;
  cal_last_until: string | null; open_orders: number; usable: boolean; oos_reason: string | null;
};
type Cifras = { equipment: number; out_of_service: number; scales: number; scales_not_usable: number; blocked_calibration: number; purchase_value: Num };

/** EQU-01 Equipos: maestro con QR, categoría, local, almacén asociado, marca, modelo, serie y estado. */
export default function Equipos() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesEqu();
  const [cat, setCat] = useState("");
  const [estado, setEstado] = useState("");
  const [apto, setApto] = useState("");
  const lista = useListado<Fila>("/v1/equ/equipos", { orden: "code", filtros: { category: cat, status: estado, apto, site: local } });
  const c = useDatos<Cifras>(`/v1/equ/cifras/01${qs({ site: local })}`).datos;
  const [nuevo, setNuevo] = useState(false);
  const [qr, setQr] = useState<Fila | null>(null);
  const crea = Boolean(op?.can.manage) && puede("EQU", "C");

  const columnas: Column<Fila>[] = [
    { key: "code", header: "Código", sortable: true, render: (f) => <span className="font-mono font-semibold whitespace-nowrap">{f.code}</span> },
    { key: "qr", header: "QR", hideOnMobile: true, hideInCard: true, render: (f) => (
      <button type="button" className="cursor-pointer" aria-label={`Ver QR de ${f.code}`} onClick={(e) => { e.stopPropagation(); setQr(f); }}>
        <Qr texto={urlDelQr(f.qr_code)} tamano={34} titulo={`QR de ${f.code}`} />
      </button>) },
    { key: "name", header: "Equipo", sortable: true, cardTitle: true, render: (f) => <div className="min-w-[170px]"><p className="font-medium">{f.name}</p>
      <p className="text-[12px] text-muted">{[f.brand_name, f.model, f.serial_number].filter(Boolean).join(" · ") || "—"}</p></div> },
    { key: "category", header: "Categoría", sortable: true, render: (f) => CATEGORIA[f.category] ?? f.category },
    { key: "establishment_name", header: "Local", sortable: true, render: (f) => <span className="whitespace-nowrap">{f.establishment_name}{f.warehouse_code ? <span className="text-muted"> · {f.warehouse_code}</span> : null}</span> },
    { key: "cal_valid_until", header: "Calibración", sortable: true, render: (f) => !f.requires_calibration ? <span className="text-muted">No exige</span>
      : f.cal_valid_until ? <span className="whitespace-nowrap">Hasta {fecha(f.cal_valid_until)}</span>
        : <span className="whitespace-nowrap text-bad">Venció {fecha(f.cal_last_until)}</span> },
    { key: "hour_meter", header: "Horómetro", sortable: true, align: "right", hideOnMobile: true, render: (f) => Number(f.hour_meter) ? `${numero(f.hour_meter, 1)} h` : "—" },
    { key: "status", header: "Estado", sortable: true, render: (f) => <span className="flex flex-wrap items-center gap-1"><StatusBadge status={f.status} labels={ESTADO} />
      {f.open_orders > 0 && <Badge tone="warn">{f.open_orders} OM</Badge>}</span> },
    { key: "usable", header: "Uso hoy", render: (f) => f.status === "RETIRED" ? <span className="text-muted">—</span> : <Apto usable={f.usable} rule={f.status === "ACTIVE" ? "RN-EQU-03" : "RN-EQU-04"} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Selladoras, cocinas, ollas, balanzas, cámaras, congeladoras, molinos y embutidoras de los locales, con su QR. Un equipo fuera de servicio o con la calibración vencida no se usa (RN-EQU-03 y RN-EQU-04)."
        actions={crea && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => setNuevo(true)}>Nuevo equipo</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Equipos" valor={c ? numero(c.equipment) : undefined} detalle="Activos y fuera de servicio" icono={Wrench} onClick={() => { setEstado(""); setApto(""); }} />
        <CifraLink titulo="Fuera de servicio" valor={c ? numero(c.out_of_service) : undefined} detalle="Con correctiva o calibración no conforme" icono={Wrench}
          tono={c?.out_of_service ? "bad" : "ok"} onClick={() => setEstado("OUT_OF_SERVICE")} />
        <CifraLink titulo="Balanzas no aptas" valor={c ? numero(c.scales_not_usable) : undefined} detalle={c ? `de ${c.scales} balanzas · no pesan ventas ni lotes` : undefined} icono={Scale}
          tono={c?.scales_not_usable ? "bad" : "ok"} href="/m/equ/equ-04" />
        <CifraLink titulo="Valor de compra" valor={c ? soles(c.purchase_value) : undefined} detalle="Equipos activos y fuera de servicio" icono={CircleDollarSign} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(f) => router.push(`/m/equ/equ-02?id=${f.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Buscar código, nombre, marca, modelo o serie…" }} empty="No hay equipos con esos filtros."
        toolbar={<>
          <FiltroSelect label="Categoría" value={cat} onChange={setCat} options={CATEGORIAS} ancho="sm:w-[200px]" />
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={ESTADOS} />
          <FiltroSelect label="Uso hoy" value={apto} onChange={setApto} options={[{ value: "SI", label: "Aptos" }, { value: "NO", label: "No aptos" }]} />
        </>} />
      {nuevo && op && <FormEquipo op={op} onClose={() => setNuevo(false)} onGuardado={(id) => { setNuevo(false); router.push(`/m/equ/equ-02?id=${id}`); }} />}
      {qr && <VentanaQr e={qr} onClose={() => setQr(null)} />}
    </div>
  );
}
