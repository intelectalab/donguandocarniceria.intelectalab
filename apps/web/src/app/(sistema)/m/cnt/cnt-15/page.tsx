"use client";

import { useState } from "react";
import { HandCoins, Upload, Users, Wallet } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, Select, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { FichaAsiento } from "@/modulos/cnt/Asiento";
import { ASIENTO, CifraLink, PLANILLA, Seccion, SelectorMes, accion, mesActual, useAlAbrir, mesDe, nombreMes, qs, useDatos, useOpcionesCnt, type Num } from "@/modulos/cnt/comunes";

type LineaCc = { cost_center_id: string | null; cost_center_name: string | null; employees: number; gross: Num; essalud: Num; cts: Num; vac: Num; pension: Num };
type Resumen = { lines: LineaCc[]; source_hint: string; gross_total: Num; essalud_total: Num; cts_total: Num; vac_total: Num; pension_total: Num; net_total: Num; employees: number };
type Importacion = Resumen & { id: string; period: string; source: string; file_name: string | null; imported_at: string; imported_by_name: string | null; status: string; entry_id: string | null; entry_number: string | null; entry_status: string | null };
const FUENTE: Record<string, string> = { AYNI: "Ayni HR", FILE: "Archivo de planilla" };

/** CNT-15 Importación de planilla: el resumen mensual por centro de costo que genera su asiento. */
export default function Planilla() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const { datos: r, recargar } = useDatos<{ data: Importacion[] }>("/v1/cnt/planilla");
  const prev = useDatos<Resumen & { period: string }>(`/v1/cnt/planilla/previa${qs({ period: mes })}`);
  const [fuente, setFuente] = useState("");
  const [asiento, setAsiento] = useState<string | null>(null);
  const ya = r?.data.find((x) => mesDe(x.period) === mes && x.status !== "VOIDED");
  const v = ya ?? prev.datos;
  return (
    <div className="space-y-5">
      <PageHeader description={`La planilla de ${nombreMes(mes)} por centro de costo: remuneraciones, EsSalud, CTS, vacaciones y pensiones. Al importarla se genera su asiento, que aprueba la contadora.`}
        actions={<div className="flex flex-wrap items-center gap-2"><SelectorMes value={mes} onChange={setMes} />
          {!ya && op?.can.prepare && prev.datos && prev.datos.employees > 0 && <>
            <Select aria-label="Fuente" value={fuente || prev.datos.source_hint} onChange={(e) => setFuente(e.target.value)} options={Object.entries(FUENTE).map(([value, label]) => ({ value, label }))} />
            <Button variant="primary" icon={Upload} onClick={() => accion({ title: `¿Importar la planilla de ${nombreMes(mes)}?`, message: `${prev.datos!.employees} trabajadores · ${soles(prev.datos!.gross_total)} de remuneraciones.`, confirmLabel: "Importar" },
              () => api("/v1/cnt/planilla", { method: "POST", body: { period: `${mes}-01`, source: fuente || prev.datos!.source_hint, file_name: `planilla-${mes}.csv` } }), "Planilla importada y asiento generado", () => { recargar(); prev.recargar(); })}>Importar</Button>
          </>}</div>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Remuneraciones" valor={v ? soles(v.gross_total) : undefined} detalle={v ? `${numero(v.employees)} trabajadores` : undefined} icono={Users} />
        <CifraLink titulo="EsSalud" valor={v ? soles(v.essalud_total) : undefined} icono={HandCoins} />
        <CifraLink titulo="CTS y vacaciones" valor={v ? soles(Number(v.cts_total) + Number(v.vac_total)) : undefined} detalle={v ? `CTS ${soles(v.cts_total)} · vacaciones ${soles(v.vac_total)}` : undefined} icono={HandCoins} />
        <CifraLink titulo="Neto a pagar" valor={v ? soles(v.net_total) : undefined} detalle={v ? `Pensiones retenidas ${soles(v.pension_total)}` : undefined} icono={Wallet} />
      </div>
      {ya ? <Alert tone="ok" title="Ya importada">Importada {fechaHora(ya.imported_at)}{ya.imported_by_name ? ` por ${ya.imported_by_name}` : ""} desde {FUENTE[ya.source] ?? ya.source}.{ya.entry_number ? ` Asiento ${ya.entry_number}.` : ""}</Alert>
        : prev.datos && !prev.datos.employees ? <Alert tone="info">No hay trabajadores activos para armar la planilla del mes.</Alert>
        : <Alert tone="info">Vista previa con los trabajadores activos del mes; al importar queda fija y genera el asiento.</Alert>}
      <Seccion titulo="Por centro de costo">
        <DataTable rows={v?.lines ?? []} rowKey={(l) => l.cost_center_id ?? "sin"} loading={!v} empty="Sin trabajadores." columns={[
          { key: "cost_center_name", header: "Centro de costo", cardTitle: true, render: (l) => l.cost_center_name ?? "Sin centro de costo" },
          { key: "employees", header: "Trabajadores", align: "right", render: (l) => numero(l.employees) },
          { key: "gross", header: "Remuneraciones", align: "right", render: (l) => soles(l.gross) },
          { key: "essalud", header: "EsSalud", align: "right", hideOnMobile: true, render: (l) => soles(l.essalud) },
          { key: "cts", header: "CTS", align: "right", hideOnMobile: true, render: (l) => soles(l.cts) },
          { key: "vac", header: "Vacaciones", align: "right", hideOnMobile: true, render: (l) => soles(l.vac) },
          { key: "pension", header: "Pensiones", align: "right", hideOnMobile: true, render: (l) => soles(l.pension) },
        ]} />
      </Seccion>
      <Seccion titulo="Importaciones">
        <DataTable rows={r?.data ?? []} rowKey={(x) => x.id} loading={!r} onRowClick={(x) => { if (x.entry_id) setAsiento(x.entry_id); }} empty="Todavía no se importa ninguna planilla." columns={[
          { key: "period", header: "Mes", cardTitle: true, render: (x) => <span className="capitalize">{nombreMes(x.period)}</span> },
          { key: "source", header: "Fuente", hideOnMobile: true, render: (x) => FUENTE[x.source] ?? x.source },
          { key: "gross_total", header: "Remuneraciones", align: "right", render: (x) => soles(x.gross_total) },
          { key: "employees", header: "Trabajadores", align: "right", hideOnMobile: true, render: (x) => numero(x.employees) },
          { key: "entry_number", header: "Asiento", render: (x) => x.entry_number ? <span>{x.entry_number} <StatusBadge status={x.entry_status} labels={ASIENTO} /></span> : <StatusBadge status={x.status} labels={PLANILLA} /> },
        ]} />
      </Seccion>
      {asiento && <FichaAsiento id={asiento} op={op} onClose={() => setAsiento(null)} onCambio={recargar} />}
    </div>
  );
}
