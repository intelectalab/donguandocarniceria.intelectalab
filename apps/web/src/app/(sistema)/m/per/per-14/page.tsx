"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, Cifra, DataTable, FiltroSelect, PageHeader, Tabs, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { ErrorCarga, FiltroLocal, FiltroMes, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { hoyLima, inicioMes, nombreMes } from "@/modulos/per/tipos";

type Grupo = { clave: string; nombre: string; planilla: number; comisiones: number; bonos: number; total: number };
type Costo = {
  mes: string; nombre: string; hasta: string; planilla_importada: string | null;
  totales: { total: number; planilla: number; comisiones: number; bonos: number; costo_pedido: number; pedidos: number; por_pedido: number | null };
  por_area: Grupo[]; por_local: Grupo[]; por_marca: Grupo[]; por_centro: Grupo[]; tendencia: { mes: string; total: number; por_pedido: number | null; pedidos: number }[];
};

/** PER-14 Costo de personal: por área, local, marca, centro de costo y por pedido entregado, con planilla importada, comisiones y bonos (RN-PER-18). */
export default function CostoPersonal() {
  const { datos: op } = useOpciones();
  const [mes, setMes] = useState(inicioMes(hoyLima()));
  const [local, setLocal] = useState("");
  const [marca, setMarca] = useState("");
  const [vista, setVista] = useState<"por_area" | "por_local" | "por_marca" | "por_centro">("por_area");
  const [bajando, setBajando] = useState(false);
  const q = new URLSearchParams({ mes, ...(local ? { local } : {}), ...(marca ? { marca } : {}) });
  const { datos, error, cargando } = useDatos<Costo>(`/v1/per/costo?${q}`);
  if (error) return <ErrorCarga error={error} que="El costo de personal lo ven Gerencia, Administración, RR. HH. y Contabilidad." />;
  const t = datos?.totales;
  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/per/costo/exportar?${q}`, `costo-personal-${mes.slice(0, 7)}.xlsx`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }
  const filas = datos?.[vista] ?? [];
  const max = Math.max(1, ...filas.map((f) => f.total));
  const columnas: Column<Grupo>[] = [
    { key: "nombre", header: "Grupo", cardTitle: true, render: (g) => (
      <span className="flex min-w-[160px] flex-col gap-1"><span className="font-medium">{g.nombre}</span>
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2"><span className="block h-full bg-primary" style={{ width: `${(g.total / max) * 100}%` }} /></span></span>
    ) },
    { key: "planilla", header: "Planilla", align: "right", render: (g) => soles(g.planilla) },
    { key: "comisiones", header: "Comisiones", align: "right", render: (g) => soles(g.comisiones) },
    { key: "bonos", header: "Bonos", align: "right", render: (g) => soles(g.bonos) },
    { key: "total", header: "Total", align: "right", render: (g) => <span className="font-semibold">{soles(g.total)}</span> },
  ];
  const maxT = Math.max(1, ...(datos?.tendencia ?? []).map((x) => x.total));
  return (
    <div className="space-y-4">
      <PageHeader description="El costo de planilla sale de lo importado de Ayni HR o del contador; si el mes aún no se importa, se estima con las condiciones de pago × 1,215 (aportes y provisiones). Se reparte por los porcentajes de cada centro de costo. El costo por pedido toma ventas, almacén y reparto."
        actions={<Button icon={Download} loading={bajando} onClick={exportar}>Exportar a Excel</Button>} />
      <div className="flex flex-wrap gap-2">
        <FiltroMes value={mes} onChange={setMes} />
        <FiltroLocal op={op} value={local} onChange={setLocal} />
        <FiltroSelect etiqueta="Marca" value={marca} onChange={setMarca} todos="todas" options={(op?.marcas ?? []).map((m) => ({ value: m.id, label: m.name }))} />
      </div>
      {datos && !datos.planilla_importada && <Alert tone="warn">La planilla de {datos.nombre} aún no se importa: el monto es una estimación con las condiciones de pago.</Alert>}
      {datos?.planilla_importada && <Alert tone="ok">Planilla importada el {fecha(datos.planilla_importada)}.</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Costo de personal" valor={t ? soles(t.total) : undefined} detalle={datos ? `hasta el ${fecha(datos.hasta)}` : ""} destacada />
        <Cifra titulo="Planilla" valor={t ? soles(t.planilla) : undefined} detalle={datos?.planilla_importada ? "importada" : "estimada"} />
        <Cifra titulo="Comisiones y bonos" valor={t ? soles(t.comisiones + t.bonos) : undefined} />
        <Cifra titulo="Costo por pedido entregado" valor={t ? (t.por_pedido === null ? "—" : soles(t.por_pedido)) : undefined} detalle={t ? `${t.pedidos} pedidos · ${soles(t.costo_pedido)} de ventas, almacén y reparto` : ""} />
      </div>
      <Tabs tabs={[{ key: "por_area", label: "Por área" }, { key: "por_local", label: "Por local" }, { key: "por_marca", label: "Por marca" }, { key: "por_centro", label: "Por centro de costo" }]} value={vista} onChange={setVista} />
      <DataTable rows={filas} rowKey={(g) => g.clave} columns={columnas} loading={cargando} empty={<Vacio>Sin costo en este mes.</Vacio>} />
      {datos && datos.tendencia.length > 0 && (
        <Seccion titulo="Últimos 6 meses">
          <div className="grid grid-cols-6 items-end gap-2" style={{ height: 160 }}>
            {datos.tendencia.map((x) => (
              <div key={x.mes} className="flex h-full flex-col items-center justify-end gap-1" title={`${nombreMes(x.mes)}: ${soles(x.total)}`}>
                <span className="text-[10.5px] tabular-nums text-muted">{Math.round(x.total / 1000)} mil</span>
                <span className={`w-full max-w-[44px] rounded-t ${x.mes === mes ? "bg-primary" : "bg-primary-soft"}`} style={{ height: `${(x.total / maxT) * 110}px` }} />
                <span className="text-[11px] text-muted">{nombreMes(x.mes).slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </Seccion>
      )}
    </div>
  );
}
