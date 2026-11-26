"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, DataTable, Input, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { qs, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import type { Num } from "@/modulos/pro/tipos";

type Fila = {
  recipe_id: string; recipe_code: string; recipe_name: string; version: number; variant_id: string; sku: string; variant_name: string; brand_name: string; orders_kg: Num;
  sales_orders: number; safety_kg: Num; released_stock_kg: Num; open_orders_kg: Num; open_orders: number; need_kg: Num; suggested_kg: Num; base_output_kg: Num;
  line_id: string | null; line_code: string | null; line_name: string | null; establishment_name: string | null;
};
type Plan = { from: string; to: string; safety_days: Num; data: Fila[]; totals: { need_kg: Num; to_produce: number } };

/** PRO-02 Plan semanal: pedidos confirmados + stock de seguridad − stock liberado − órdenes abiertas = lo que hay que producir. */
export default function PlanSemanal() {
  const { local, puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesPro();
  const [desde, setDesde] = useState("");
  const { datos: p, error, recargar } = useDatos<Plan>(`/v1/pro/plan${qs({ from: desde, site: local })}`);
  const [creando, setCreando] = useState<string | null>(null);
  const crea = Boolean(op?.can.create) && puede("PRO", "C");

  async function crear(f: Fila) {
    if (!f.line_id) return toast.error("La receta no tiene una línea en este local.");
    setCreando(f.recipe_id);
    try {
      const o = await api<{ id: string; number: string }>("/v1/pro/ordenes", { method: "POST", body: { order_type: "RECIPE", recipe_id: f.recipe_id, line_id: f.line_id, planned_output_kg: Number(f.suggested_kg), planned_date: p?.from } });
      toast.ok(`Orden ${o.number} creada`); recargar();
    } catch (e) { toast.error(mensajeDe(e)); } finally { setCreando(null); }
  }

  const columnas: Column<Fila>[] = [
    { key: "recipe_name", header: "Producto", cardTitle: true, render: (f) => <div className="min-w-[170px]"><p className="font-medium">{f.variant_name}</p><p className="text-[12px] text-muted">{f.sku} · {f.recipe_code} v{f.version} · {f.brand_name}</p></div> },
    { key: "orders_kg", header: "Pedidos", align: "right", render: (f) => <span className="whitespace-nowrap">{kg(f.orders_kg)}<span className="block text-[11.5px] text-muted">{f.sales_orders} pedidos</span></span> },
    { key: "safety_kg", header: "Seguridad", align: "right", render: (f) => kg(f.safety_kg) },
    { key: "released_stock_kg", header: "Stock liberado", align: "right", render: (f) => kg(f.released_stock_kg) },
    { key: "open_orders_kg", header: "Órdenes abiertas", align: "right", render: (f) => <span className="whitespace-nowrap">{kg(f.open_orders_kg)}<span className="block text-[11.5px] text-muted">{f.open_orders} órdenes</span></span> },
    { key: "need_kg", header: "Falta", align: "right", render: (f) => <b className={Number(f.need_kg) > 0 ? "text-warn" : "text-muted"}>{kg(f.need_kg)}</b> },
    { key: "suggested_kg", header: "Sugerido", align: "right", render: (f) => <span className="whitespace-nowrap">{kg(f.suggested_kg)}<span className="block text-[11.5px] text-muted">lotes de {numero(f.base_output_kg)} kg</span></span> },
    { key: "line_code", header: "Línea", hideOnMobile: true, render: (f) => f.line_code ? `${f.line_code} · ${f.establishment_name}` : "—" },
    { key: "acc", header: "", hideInCard: false, render: (f) => crea && Number(f.suggested_kg) > 0 ? <Button size="sm" loading={creando === f.recipe_id} onClick={(e) => { e.stopPropagation(); void crear(f); }}>Crear orden</Button> : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description={p ? `Semana del ${fecha(p.from)} al ${fecha(p.to)}. Stock de seguridad: ${numero(p.safety_days, 1)} días de venta promedio de las últimas 4 semanas.` : "Lo que hay que producir en la semana."}
        actions={<div className="w-[170px]"><Input type="date" aria-label="Semana desde" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {p && <Alert tone={p.totals.to_produce ? "warn" : "ok"}>{p.totals.to_produce ? `${p.totals.to_produce} producto(s) por producir: ${kg(p.totals.need_kg)} en total.` : "Con el stock y las órdenes abiertas se cubre la semana."}</Alert>}
      <DataTable rows={p?.data ?? []} rowKey={(f) => f.recipe_id} columns={columnas} loading={!p && !error} empty="No hay recetas activas para planificar."
        onRowClick={(f) => router.push(`/m/pro/pro-05?recipe=${f.recipe_id}&kg=${Number(f.suggested_kg) || ""}`)} />
    </div>
  );
}
