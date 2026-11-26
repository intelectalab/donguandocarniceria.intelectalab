"use client";

import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { Alert, Badge, DataTable, Modal, PageHeader } from "@/components/ui";
import { fecha, soles } from "@/lib/formato";
import { FichaAsiento } from "@/modulos/cnt/Asiento";
import { CifraLink, FiltroSelect, Importe, SelectorMes, mesActual, nombreMes, qs, rangoMes, texto, useAlAbrir, useDatos, useOpcionesCnt } from "@/modulos/cnt/comunes";

type Saldo = { code: string; name: string; opening: number; debit: number; credit: number; closing: number };
type Balance = { from: string; to: string; data: Saldo[]; totals: { opening: number; debit: number; credit: number; closing: number } };
type Mayor = { code: string; name: string; opening: number; closing: number;
  rows: { entry_id: string; number: string; entry_date: string; description: string; line_description: string | null; debit: string; credit: string; third_party_name: string | null; balance: number }[] };

/** CNT-14 Balance de comprobación: saldos por cuenta del período, por marca y local, y el libro mayor de cada cuenta. */
export default function BalanceDeComprobacion() {
  const op = useOpcionesCnt();
  const [mes, setMes] = useState(mesActual());
  const [marca, setMarca] = useState("");
  const [local, setLocal] = useState("");
  const [buscar, setBuscar] = useState("");
  const [cuenta, setCuenta] = useState<string | null>(null);
  useAlAbrir((p) => { if (p.get("month")) setMes(p.get("month")!); if (p.get("account")) setCuenta(p.get("account")); });
  const { from, to } = rangoMes(mes);
  const filtros = { from, to, brand: marca, site: local };
  const { datos: b, error, cargando } = useDatos<Balance>(`/v1/cnt/balance${qs(filtros)}`);
  const filas = useMemo(() => (b?.data ?? []).filter((s) => !buscar || s.code.startsWith(buscar) || s.name.toLowerCase().includes(buscar.toLowerCase())), [b, buscar]);
  const cuadra = b ? Math.abs(b.totals.debit - b.totals.credit) < 0.01 : true;
  return (
    <div className="space-y-5">
      <PageHeader description={`Saldos por cuenta de ${nombreMes(mes)} con los asientos aprobados. Toca una cuenta para ver su libro mayor.`} actions={<SelectorMes value={mes} onChange={setMes} />} />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink destacada titulo="Debe del período" valor={b ? soles(b.totals.debit) : undefined} icono={Scale} />
        <CifraLink titulo="Haber del período" valor={b ? soles(b.totals.credit) : undefined} icono={Scale} />
        <CifraLink titulo="Cuadre" valor={b ? (cuadra ? "Cuadra" : soles(b.totals.debit - b.totals.credit)) : undefined} icono={Scale} tono={cuadra ? "ok" : "bad"} />
        <CifraLink titulo="Cuentas con saldo" valor={b ? String(b.data.length) : undefined} icono={Scale} />
      </div>
      <DataTable rows={filas} rowKey={(s) => s.code} loading={cargando} onRowClick={(s) => setCuenta(s.code)} search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cuenta…" }}
        empty="Sin movimientos aprobados en el período."
        toolbar={<>
          <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={(op?.brands ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <FiltroSelect label="Local" value={local} onChange={setLocal} options={(op?.establishments ?? []).map((x) => ({ value: x.id, label: x.name }))} ancho="sm:w-[200px]" />
        </>}
        columns={[
          { key: "code", header: "Cuenta", cardTitle: true, render: (s) => <span><span className="tabular-nums text-muted">{s.code}</span> {s.name}</span> },
          { key: "opening", header: "Saldo inicial", align: "right", hideOnMobile: true, render: (s) => <Importe v={s.opening} formato={soles} /> },
          { key: "debit", header: "Debe", align: "right", render: (s) => soles(s.debit) },
          { key: "credit", header: "Haber", align: "right", render: (s) => soles(s.credit) },
          { key: "closing", header: "Saldo final", align: "right", render: (s) => <Importe v={s.closing} formato={soles} /> },
        ]} />
      {b && <p className="text-right text-[13px] tabular-nums text-muted">Totales: saldo inicial {soles(b.totals.opening)} · debe {soles(b.totals.debit)} · haber {soles(b.totals.credit)} · saldo final {soles(b.totals.closing)}</p>}
      {cuenta && <LibroMayor codigo={cuenta} filtros={filtros} onClose={() => setCuenta(null)} />}
    </div>
  );
}

function LibroMayor({ codigo, filtros, onClose }: { codigo: string; filtros: Record<string, string>; onClose: () => void }) {
  const op = useOpcionesCnt();
  const { datos: m } = useDatos<Mayor>(`/v1/cnt/mayor/${codigo}${qs(filtros)}`);
  const [asiento, setAsiento] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} size="xl" title={m ? `${m.code} · ${m.name}` : `Cuenta ${codigo}`} description={`Libro mayor del ${fecha(filtros.from)} al ${fecha(filtros.to)}`}>
      {m && <div className="space-y-3">
        <div className="flex flex-wrap gap-2"><Badge>Saldo inicial {soles(m.opening)}</Badge><Badge tone="primary">Saldo final {soles(m.closing)}</Badge>{m.rows.length >= 2000 && <Badge tone="warn">Se muestran los primeros 2000 movimientos</Badge>}</div>
        <DataTable rows={m.rows.map((r, i) => ({ ...r, i }))} rowKey={(r) => `${r.entry_id}-${r.i}`} onRowClick={(r) => setAsiento(r.entry_id)} empty="Sin movimientos en el período." columns={[
          { key: "number", header: "Asiento", cardTitle: true, render: (r) => <div className="min-w-[200px]"><p className="font-medium tabular-nums">{r.number} <span className="font-normal text-muted">{fecha(r.entry_date)}</span></p><p className="text-[12px] text-muted">{texto(r.line_description || r.description)}</p></div> },
          { key: "debit", header: "Debe", align: "right", render: (r) => Number(r.debit) ? soles(r.debit) : "" },
          { key: "credit", header: "Haber", align: "right", render: (r) => Number(r.credit) ? soles(r.credit) : "" },
          { key: "balance", header: "Saldo", align: "right", render: (r) => <Importe v={r.balance} formato={soles} /> },
        ]} />
      </div>}
      {asiento && <FichaAsiento id={asiento} op={op} onClose={() => setAsiento(null)} />}
    </Modal>
  );
}
