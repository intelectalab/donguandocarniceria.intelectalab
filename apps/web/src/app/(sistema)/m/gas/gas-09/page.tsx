"use client";

import { useState } from "react";
import { Truck } from "lucide-react";
import { Alert, Button, Cifra, DataTable, PageHeader, Tabs, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { SinPermiso, columnasGasto, useDatos, usePermisosGas } from "@/modulos/gas/comunes";
import { Ficha } from "@/modulos/gas/Ficha";
import type { FilaGasto } from "@/modulos/gas/tipos";

type Extra = { resumen?: { n: number; total: number; observados: number }; por_traer?: number };

/**
 * GAS-09 Bandeja de la contadora: gastos sin comprobante válido por confirmar y los observados. Desde aquí se traen
 * los gastos de ruta ya liquidados en Delivery (D-GAS-04): entran aprobados y sin duplicar el costo de reparto.
 */
export default function Contadora() {
  const p = usePermisosGas();
  return p.contadora ? <Pantalla /> : <SinPermiso que="La bandeja de la contadora es de contabilidad." />;
}

function Pantalla() {
  const p = usePermisosGas();
  const [vista, setVista] = useState<"pendientes" | "revisados">("pendientes");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);
  const lista = useListado<FilaGasto>("/v1/gas/contadora", { filtros: { vista }, orden: "-issue_date" });
  const { datos: extra, recargar: recargarResumen } = useDatos<Extra>(p.contadora ? `/v1/gas/contadora?vista=${vista}&per_page=1` : null);
  const cambio = () => { lista.recargar(); recargarResumen(); };
  const porTraer = extra?.por_traer ?? 0;

  async function traer() {
    if (!(await confirmAction({ title: `Traer ${porTraer} gastos de ruta`, confirmLabel: "Traer" }))) return;
    setTrayendo(true);
    try {
      const r = await api<{ traidos: number; total: number; en_periodo_cerrado: number }>("/v1/gas/contadora/traer-de-ruta", { method: "POST" });
      toast.ok(r.traidos ? `Se trajeron ${r.traidos} gastos de ruta por ${soles(r.total)}.` : "No había gastos de ruta por traer.");
      if (r.en_periodo_cerrado) toast.info(`${r.en_periodo_cerrado} gastos quedaron fuera porque su mes está cerrado.`);
      cambio();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setTrayendo(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader description="Confirma si un gasto tiene comprobante válido para la contabilidad, corrige su categoría o centro de costo, u obsérvalo para que quien lo registró lo corrija."
        actions={<Button variant={porTraer ? "primary" : "secondary"} icon={Truck} loading={trayendo} disabled={!porTraer} onClick={traer}>{porTraer ? `Traer ${porTraer} gastos de ruta` : "Sin gastos de ruta por traer"}</Button>} />
      {porTraer > 0 && <Alert tone="info">Hay {porTraer} gastos de ruta liquidados en Delivery que todavía no están en Gastos. Al traerlos entran aprobados; los que no tienen comprobante quedan aquí para confirmarlos.</Alert>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Cifra titulo={vista === "pendientes" ? "Por revisar" : "Revisados"} valor={String(extra?.resumen?.n ?? "…")} detalle={extra?.resumen ? soles(extra.resumen.total) : undefined} destacada />
        {vista === "pendientes" && <Cifra titulo="Observados" valor={String(extra?.resumen?.observados ?? "…")} detalle="Esperan corrección" tono={(extra?.resumen?.observados ?? 0) > 0 ? "warn" : "ok"} />}
      </div>
      <Tabs tabs={[{ key: "pendientes", label: "Por revisar" }, { key: "revisados", label: "Revisados" }]} value={vista} onChange={(k) => setVista(k as "pendientes" | "revisados")} />
      <DataTable {...lista.tabla} onRowClick={(g) => setAbierto(g.id)}
        columns={columnasGasto([
          { key: "origen", header: "Origen", hideOnMobile: true, render: (g) => (g.de_ruta ? "Ruta de reparto" : g.pay_source === "PETTY" ? "Caja chica" : "Registro") },
          ...(vista === "pendientes" ? [{ key: "accounting_note", header: "Observación", hideOnMobile: true, render: (g: FilaGasto) => g.accounting_note ?? "—" }] : []),
          ...(vista === "revisados" ? [{ key: "approved_at", header: "Aprobado", hideOnMobile: true, render: (g: FilaGasto) => (g.approved_at ? fecha(g.approved_at.slice(0, 10)) : "—") }] : []),
        ])}
        search={{ ...lista.tabla.search, placeholder: "Buscar por número, proveedor o descripción" }}
        empty={vista === "pendientes" ? "No hay gastos por revisar." : "No hay gastos revisados en los últimos 120 días."} />
      <Ficha id={abierto} onClose={() => setAbierto(null)} onCambio={cambio} />
    </div>
  );
}
