"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, FileCheck, FileText, Plus, Send } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { InsigniaPlataforma, TONO_ESTADO } from "@/modulos/ads/comun";

type FacturaPlat = {
  id: string; account_id: string; account_name: string; platform: string; plataforma: string;
  brand_id: string; brand_name: string; supplier_id: string | null; proveedor: string;
  invoice_number: string; doc_type: string; issue_date: string; period_from: string; period_to: string;
  currency: string; amount: number; exchange_rate: number; amount_pen: number;
  imported_spend_pen: number | null; difference_pen: number | null; tolerance_pen: number | null;
  status: string; estado: string; expense_id: string | null; expense_number: string | null;
  reconciled_by_name: string | null; reconciled_at: string | null; note: string | null;
};

type CuentaOpc = { value: string; label: string; currency: string };
type RespFacturas = {
  data: FacturaPlat[];
  cifras: { total: number; conciliadas: number; observadas: number; pendientes: number; por_enviar_gas: number };
  tolerancia_fija_pen: number;
  tolerancia_pct: number;
  opciones: { cuentas: CuentaOpc[] };
  puede: boolean;
};

/** ADS-07 Facturas de plataformas: factura o recibo de Google, Meta o TikTok contra el gasto importado del período; diferencia, estado y envío a GAS. */
export default function FacturasDePlataformas() {
  const [f, setF] = useState({ estado: "", cuenta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<RespFacturas | null>(null);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<FacturaPlat | null>(null);
  const [modalNueva, setModalNueva] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [nueva, setNueva] = useState({
    account_id: "", invoice_number: "", issue_date: "2026-10-03", period_from: "2026-09-01", period_to: "2026-09-30",
    currency: "PEN", amount: "", note: "", send_to_gas: true,
  });

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = () => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespFacturas>(`/v1/ads/facturas?${q}`).then((r) => {
      setRes(r);
      setError("");
      if (!nueva.account_id && r.opciones.cuentas[0]) {
        setNueva((n) => ({ ...n, account_id: r.opciones.cuentas[0].value, currency: r.opciones.cuentas[0].currency }));
      }
    }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [f]);

  async function registrar() {
    setProcesando(true);
    setErrores({});
    try {
      const r = await api<{ status: string; difference_pen: number | null }>("/v1/ads/facturas", {
        method: "POST",
        body: { ...nueva, amount: Number(nueva.amount) },
      });
      if (r.status === "RECONCILED") {
        toast.ok("Factura conciliada correctamente");
      } else {
        toast.error(`Factura observada: diferencia de ${soles(r.difference_pen ?? 0)}`);
      }
      setModalNueva(false);
      setNueva((n) => ({ ...n, invoice_number: "", amount: "", note: "" }));
      cargar();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function conciliar(inv: FacturaPlat) {
    setProcesando(true);
    try {
      await api(`/v1/ads/facturas/${inv.id}/conciliar`, { method: "POST", body: {} });
      toast.ok("Conciliación ejecutada");
      setDetalle(null);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function enviarAGas(inv: FacturaPlat) {
    setProcesando(true);
    try {
      const r = await api<{ expense_number?: string }>(`/v1/ads/facturas/${inv.id}/enviar-gas`, { method: "POST" });
      toast.ok(`Gasto ${r.expense_number ?? ""} registrado en Gastos`);
      setDetalle(null);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  const c = res?.cifras;
  const cols: Column<FacturaPlat>[] = [
    { key: "invoice_number", header: "Factura", cardTitle: true, render: (i) => <span className="font-mono font-semibold text-ink">{i.invoice_number}</span> },
    { key: "account_name", header: "Cuenta", render: (i) => i.account_name },
    { key: "platform", header: "Plataforma", render: (i) => <InsigniaPlataforma p={i.platform} label={i.plataforma} /> },
    { key: "issue_date", header: "Emisión", render: (i) => fecha(i.issue_date) },
    { key: "period", header: "Período", render: (i) => `${fecha(i.period_from)} – ${fecha(i.period_to)}` },
    { key: "amount", header: "Monto", align: "right", render: (i) => `${i.currency} ${numero(i.amount, 2)}` },
    { key: "amount_pen", header: "En soles", align: "right", render: (i) => soles(i.amount_pen) },
    { key: "imported_spend_pen", header: "Gasto importado", align: "right", render: (i) => i.imported_spend_pen !== null ? soles(i.imported_spend_pen) : "—" },
    {
      key: "difference_pen", header: "Diferencia", align: "right",
      render: (i) => i.difference_pen !== null ? (
        <span className={Math.abs(i.difference_pen) > (i.tolerance_pen ?? 0) ? "font-semibold text-bad" : "text-ink"}>
          {soles(i.difference_pen)}
        </span>
      ) : "—",
    },
    { key: "status", header: "Estado", render: (i) => <Badge tone={TONO_ESTADO[i.status]}>{i.estado}</Badge> },
    {
      key: "gas", header: "Gastos (GAS)",
      render: (i) => i.expense_number ? (
        <Badge tone="ok">Gasto {i.expense_number}</Badge>
      ) : i.status === "RECONCILED" ? (
        <Badge tone="warn">Por enviar</Badge>
      ) : "—",
    },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Factura o recibo de Google, Meta o TikTok contra el gasto importado del período; diferencia, estado de conciliación y envío a Gastos como gasto de publicidad."
        actions={res?.puede ? <Button variant="primary" icon={Plus} onClick={() => setModalNueva(true)}>Registrar factura</Button> : undefined}
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="Facturas" valor={numero(c.total)} icono={FileText} />
          <Cifra titulo="Conciliadas" valor={numero(c.conciliadas)} icono={CheckCircle2} tono="ok" destacada />
          <Cifra titulo="Observadas" valor={numero(c.observadas)} icono={AlertTriangle} tono={c.observadas ? "bad" : "ok"} />
          <Cifra titulo="Pendientes" valor={numero(c.pendientes)} icono={Clock} tono={c.pendientes ? "warn" : undefined} />
          <Cifra titulo="Por pasar a GAS" valor={numero(c.por_enviar_gas)} icono={FileCheck} />
        </div>
      )}

      {res && (
        <Alert tone="info">
          La factura queda conciliada si la diferencia es menor o igual al mayor entre <strong>{soles(res.tolerancia_fija_pen)}</strong> y <strong>{res.tolerancia_pct} %</strong> del gasto importado en el período. Las facturas de plataformas del exterior se envían a Gastos con documento <span className="font-mono">FOREIGN_INVOICE</span>.
        </Alert>
      )}

      <DataTable
        rowKey={(i) => i.id}
        columns={cols}
        rows={res?.data ?? []}
        loading={!res && !error}
        onRowClick={setDetalle}
        empty="No hay facturas de plataformas registradas."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por número de factura o cuenta…" }}
        toolbar={
          <>
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={165} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "PENDING", label: "Pendiente" }, { value: "RECONCILED", label: "Conciliada" }, { value: "OBSERVED", label: "Observada" }]} />
            <FiltroSelect etiqueta="Cuenta" todos="todas" ancho={220} value={f.cuenta} onChange={(v) => setF({ ...f, cuenta: v })}
              options={res?.opciones.cuentas ?? []} />
          </>
        }
      />

      {detalle && (
        <Modal
          open
          onClose={() => setDetalle(null)}
          title={`Factura ${detalle.invoice_number}`}
          description={`${detalle.account_name} · ${fecha(detalle.period_from)} al ${fecha(detalle.period_to)}`}
          footer={
            <div className="flex flex-wrap justify-between gap-2 w-full">
              <div className="flex flex-wrap gap-2">
                {res?.puede && <Button variant="primary" size="sm" loading={procesando} onClick={() => conciliar(detalle)}>Conciliar</Button>}
                {res?.puede && detalle.status === "RECONCILED" && !detalle.expense_id && (
                  <Button variant="ghost" size="sm" icon={Send} loading={procesando} onClick={() => enviarAGas(detalle)}>Enviar a Gastos (GAS)</Button>
                )}
              </div>
              <Button variant="ghost" onClick={() => setDetalle(null)}>Cerrar</Button>
            </div>
          }
        >
          <div className="grid gap-4">
            {detalle.status === "OBSERVED" && (
              <Alert tone="warn">
                Diferencia de {soles(detalle.difference_pen ?? 0)} supera la tolerancia de {soles(detalle.tolerance_pen ?? 0)}. {detalle.note}
              </Alert>
            )}
            <DetailList
              items={[
                { label: "Cuenta", value: detalle.account_name },
                { label: "Proveedor", value: detalle.proveedor },
                { label: "Tipo de documento", value: <span className="font-mono text-[12px]">FOREIGN_INVOICE</span> },
                { label: "Fecha de emisión", value: fecha(detalle.issue_date) },
                { label: "Período facturado", value: `${fecha(detalle.period_from)} – ${fecha(detalle.period_to)}` },
                { label: "Monto original", value: `${detalle.currency} ${numero(detalle.amount, 2)}` },
                { label: "Tipo de cambio", value: numero(detalle.exchange_rate, 3) },
                { label: "Monto en soles", value: soles(detalle.amount_pen) },
                { label: "Gasto importado del período", value: detalle.imported_spend_pen !== null ? soles(detalle.imported_spend_pen) : "—" },
                { label: "Tolerancia aplicable", value: detalle.tolerance_pen !== null ? soles(detalle.tolerance_pen) : "—" },
                { label: "Diferencia", value: detalle.difference_pen !== null ? soles(detalle.difference_pen) : "—" },
                { label: "Estado", value: <Badge tone={TONO_ESTADO[detalle.status]}>{detalle.estado}</Badge> },
                { label: "Conciliada por", value: detalle.reconciled_by_name ? `${detalle.reconciled_by_name} · ${fechaHora(detalle.reconciled_at)}` : "—" },
                { label: "Gasto en GAS", value: detalle.expense_number ? <span className="font-mono font-semibold">{detalle.expense_number}</span> : "—" },
              ]}
            />
          </div>
        </Modal>
      )}

      {modalNueva && res && (
        <Modal
          open
          onClose={() => setModalNueva(false)}
          title="Registrar factura de plataforma"
          description="Se concilia automáticamente frente al gasto importado del período en la cuenta."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalNueva(false)}>Cancelar</Button>
              <Button variant="primary" loading={procesando} disabled={!nueva.invoice_number.trim() || !nueva.amount} onClick={registrar}>
                Registrar y conciliar
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cuenta publicitaria" required className="sm:col-span-2">
              <Select
                value={nueva.account_id}
                onChange={(e) => {
                  const cta = res.opciones.cuentas.find((x) => x.value === e.target.value);
                  setNueva({ ...nueva, account_id: e.target.value, currency: cta?.currency ?? "PEN" });
                }}
                options={res.opciones.cuentas}
              />
            </Field>
            <Field label="Número de factura o recibo" required error={errores.invoice_number}>
              <Input className="font-mono" placeholder="FBADS-8810-09265" value={nueva.invoice_number} onChange={(e) => setNueva({ ...nueva, invoice_number: e.target.value })} />
            </Field>
            <Field label="Fecha de emisión" required>
              <Input type="date" value={nueva.issue_date} onChange={(e) => setNueva({ ...nueva, issue_date: e.target.value })} />
            </Field>
            <Field label="Período desde" required>
              <Input type="date" value={nueva.period_from} onChange={(e) => setNueva({ ...nueva, period_from: e.target.value })} />
            </Field>
            <Field label="Período hasta" required>
              <Input type="date" value={nueva.period_to} onChange={(e) => setNueva({ ...nueva, period_to: e.target.value })} />
            </Field>
            <Field label="Moneda" required>
              <Select value={nueva.currency} onChange={(e) => setNueva({ ...nueva, currency: e.target.value })}
                options={[{ value: "PEN", label: "Soles (PEN)" }, { value: "USD", label: "Dólares (USD)" }]} />
            </Field>
            <Field label="Monto de la factura" required error={errores.amount}>
              <Input type="number" step="0.01" min="0" placeholder="0.00" value={nueva.amount} onChange={(e) => setNueva({ ...nueva, amount: e.target.value })} />
            </Field>
            <Field label="Nota (si queda observada)" className="sm:col-span-2">
              <Textarea rows={2} maxLength={500} value={nueva.note} onChange={(e) => setNueva({ ...nueva, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
