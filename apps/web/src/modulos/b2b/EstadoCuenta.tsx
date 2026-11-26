"use client";

import { Badge, DataTable, type Column } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { Cifras, CifraLink, DiasMora } from "@/modulos/canales/comunes";
import type { Movimiento, Resumen } from "./tipos";

const TIPO = { DOC: ["Comprobante", "info"], NC: ["Nota de crédito", "neutral"], PAY: ["Pago", "ok"] } as const;

/** Cifras del crédito del cliente (B2B-07 y portal B2B-15). */
export function CifrasCredito({ s }: { s: Resumen | undefined }) {
  return (
    <Cifras>
      <CifraLink destacada titulo="Saldo" valor={s ? soles(s.balance) : undefined} detalle={s?.unbilled ? `+ ${soles(s.unbilled)} en pedidos por facturar` : "Por pagar"} />
      <CifraLink titulo="Vencido" valor={s ? soles(s.overdue) : undefined} detalle={s?.overdue_days ? `${s.overdue_days} días de atraso` : "Al día"} tono={s?.overdue ? (s.overdue_days > s.grace_days ? "bad" : "warn") : "ok"} />
      <CifraLink titulo="Línea de crédito" valor={s ? soles(s.credit_limit) : undefined} detalle={s ? `${s.term_days} días de plazo` : undefined} />
      <CifraLink titulo="Disponible" valor={s ? soles(s.available) : undefined} detalle={s?.status === "BLOCKED" ? "Crédito bloqueado" : "Para nuevos pedidos"} tono={s?.status === "BLOCKED" ? "bad" : undefined} />
    </Cifras>
  );
}

/** Movimientos con saldo acumulado: comprobantes, notas de crédito y pagos. */
export function Movimientos({ filas, cargando, extra }: { filas: Movimiento[]; cargando?: boolean; extra?: (m: Movimiento) => React.ReactNode }) {
  const columnas: Column<Movimiento>[] = [
    { key: "date", header: "Fecha", render: (m) => <span className="whitespace-nowrap">{fecha(m.date)}</span> },
    { key: "kind", header: "Movimiento", render: (m) => <Badge tone={TIPO[m.kind][1]}>{TIPO[m.kind][0]}</Badge> },
    { key: "ref", header: "Referencia", cardTitle: true, render: (m) => <span className="font-mono">{m.ref}</span> },
    { key: "due_date", header: "Vence", render: (m) => m.kind === "DOC" ? fecha(m.due_date) : "—" },
    { key: "charge", header: "Cargo", align: "right", render: (m) => m.charge ? soles(m.charge) : "" },
    { key: "credit", header: "Abono", align: "right", render: (m) => m.credit ? soles(m.credit) : "" },
    { key: "balance", header: "Saldo", align: "right", render: (m) => <strong>{soles(m.balance)}</strong> },
    { key: "days_overdue", header: "Mora", render: (m) => m.kind === "DOC" && m.open > 0 ? <DiasMora d={m.days_overdue} /> : m.kind === "DOC" ? <Badge tone="ok">Pagado</Badge> : null },
    ...(extra ? [{ key: "extra", header: "", render: extra }] : []),
  ];
  return <DataTable columns={columnas} rows={filas} rowKey={(m) => `${m.kind}-${m.ref}-${m.date}`} loading={cargando} empty="Sin movimientos." />;
}
