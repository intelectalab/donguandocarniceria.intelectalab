"use client";

import { useState } from "react";
import { AlarmClock, CalendarCheck, ClipboardCheck, FileDiff, FileWarning, ReceiptText } from "lucide-react";
import { Alert, DataTable, PageHeader, StatusBadge } from "@/components/ui";
import { numero, porcentaje, soles } from "@/lib/formato";
import { Barras, CifraLink, Importe, PERIODO, Seccion, SelectorMes, mesActual, useAlAbrir, nombreMes, qs, useDatos, useOpcionesCnt, type Num } from "@/modulos/cnt/comunes";

type Tablero = {
  month: string; from: string; to: string;
  kpis: { docs_without_entry: number; pending_approval: number; sire_diffs: number; close_days: number | null; invalid_receipts_pct: number | null; inbox_overdue: number };
  detail: { inbox_open: number; entries_month: number; period_status: string; inbox_max_age_days: number };
  by_source: { source_type: string; entries: number; approved: number; amount: Num }[];
  inbox_by_reason: { reason: string; label: string; items: number }[];
  income: { code: string; label: string; kind: string; value: number | null }[];
  close_history: { period: string; closed_at: string; days: number }[];
};

/** CNT-16 Tablero contable: los seis indicadores del mes. */
export default function TableroContable() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); });
  const { datos: t, error } = useDatos<Tablero>(`/v1/cnt/tablero${qs({ month: mes })}`);
  const k = t?.kpis;
  return (
    <div className="space-y-5">
      <PageHeader description={`Cómo va la contabilidad de ${nombreMes(mes)}.`} actions={<SelectorMes value={mes} onChange={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <CifraLink destacada titulo="Comprobantes sin asiento" valor={t ? numero(k?.docs_without_entry) : undefined} icono={FileWarning} tono={k?.docs_without_entry ? "bad" : "ok"} href={`/m/cnt/cnt-03?month=${mes}`} />
        <CifraLink titulo="Asientos por aprobar" valor={t ? numero(k?.pending_approval) : undefined} detalle={t ? `de ${numero(t.detail.entries_month)} del mes` : undefined} icono={ClipboardCheck} tono={k?.pending_approval ? "warn" : "ok"} href={`/m/cnt/cnt-03?month=${mes}&status=PENDING_APPROVAL`} />
        <CifraLink titulo="Diferencias SIRE sin resolver" valor={t ? numero(k?.sire_diffs) : undefined} icono={FileDiff} tono={k?.sire_diffs ? "warn" : "ok"} href={`/m/cnt/cnt-06?month=${mes}`} />
        <CifraLink titulo="Días para cerrar" valor={t ? (k?.close_days != null ? `${numero(k.close_days, 1)} días` : "—") : undefined} detalle="Promedio de los últimos cierres" icono={CalendarCheck} href={`/m/cnt/cnt-12?month=${mes}`} />
        <CifraLink titulo="Gastos sin comprobante válido" valor={t ? (k?.invalid_receipts_pct != null ? porcentaje(k.invalid_receipts_pct, 1) : "—") : undefined} icono={ReceiptText} tono={Number(k?.invalid_receipts_pct) > 2 ? "bad" : undefined} href="/m/cnt/cnt-05" />
        <CifraLink titulo="Bandeja vencida" valor={t ? numero(k?.inbox_overdue) : undefined} detalle={t ? `Más de ${t.detail.inbox_max_age_days} días · ${numero(t.detail.inbox_open)} abiertos` : undefined} icono={AlarmClock} tono={k?.inbox_overdue ? "bad" : "ok"} href="/m/cnt/cnt-05" />
      </div>
      {t && <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Asientos del mes por origen" acciones={<StatusBadge status={t.detail.period_status} labels={PERIODO} />}>
          <DataTable rows={t.by_source} rowKey={(s) => s.source_type} empty="Sin asientos en el mes." columns={[
            { key: "source_type", header: "Origen", cardTitle: true, render: (s) => op?.sources[s.source_type] ?? s.source_type },
            { key: "entries", header: "Asientos", align: "right", render: (s) => numero(s.entries) },
            { key: "approved", header: "Aprobados", align: "right", render: (s) => <span className={s.approved < s.entries ? "text-warn" : ""}>{numero(s.approved)}</span> },
            { key: "amount", header: "Importe", align: "right", render: (s) => soles(s.amount) },
          ]} />
        </Seccion>
        <Seccion titulo="Resultado del mes">
          <ul className="space-y-1.5 text-[13px]">{t.income.map((l) => (
            <li key={l.code} className={`flex justify-between gap-3 ${l.kind === "SUM" ? "border-t border-line pt-1.5 font-semibold" : ""}`}><span>{l.label}</span><Importe v={l.value} formato={soles} /></li>))}</ul>
        </Seccion>
        <Seccion titulo="Bandeja abierta por motivo"><Barras filas={t.inbox_by_reason.map((x) => ({ label: x.label, value: x.items }))} formato={(v) => numero(v)} /></Seccion>
        <Seccion titulo="Días que tomó cada cierre"><Barras filas={t.close_history.map((x) => ({ label: nombreMes(x.period), value: x.days }))} formato={(v) => `${numero(v)} días`} /></Seccion>
      </div>}
    </div>
  );
}
