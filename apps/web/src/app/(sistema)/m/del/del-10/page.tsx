"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Cifra, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, hoyLima, useDatos } from "@/modulos/del/comunes";
import { FACTURA, LINEA } from "@/modulos/del/tipos";

type Factura = { id: string; supplier_id: string; empresa: string; invoice_number: string; issue_date: string; period_from: string; period_to: string; amount: number;
  expected_amount: number; difference: number; status: string; shipments: number; conciliado_por: string | null; reconciled_at: string | null };
type Linea = { id: string; external_ref: string; billed_amount: number; expected_amount: number; match_status: string; estado: string; ruta: string | null; route_date: string | null };

/** DEL-10 Conciliación de terceros: factura contra envíos entregados o fallidos × tarifa vigente (RN-DEL-11). */
export default function Conciliacion() {
  const { can } = useSesion();
  const { datos, error, cargando, recargar } = useDatos<{ data: Factura[]; tolerancia: number }>("/v1/del/facturas");
  const [nueva, setNueva] = useState(false);
  const [ver, setVer] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader description="Registra la factura de la empresa de delivery: se compara con sus envíos del período por la tarifa vigente. Queda conciliada si la diferencia no pasa la tolerancia; si no, observada."
        actions={can("del.carrier_invoice.reconcile") && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Conciliar factura</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo="Facturas">
        {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>Aún no hay facturas conciliadas.</Vacio> : (
          <ul className="divide-y divide-line">
            {datos.data.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => setVer(f.id)} className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 text-left">
                  <span className="min-w-0"><span className="block text-[14px] font-semibold text-ink">{f.invoice_number} · {f.empresa}</span>
                    <span className="text-[12.5px] text-muted">{fecha(f.period_from)} al {fecha(f.period_to)} · {f.shipments} envío(s)</span></span>
                  <span className="flex flex-col items-end gap-1 text-[13px]"><StatusBadge status={f.status} labels={FACTURA} /><span>{soles(f.amount)} · dif. {soles(f.difference)}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      {nueva && <Nueva tolerancia={datos?.tolerancia ?? 2} onClose={() => setNueva(false)} onListo={(id) => { setNueva(false); recargar(); setVer(id); }} />}
      {ver && <Ver id={ver} onClose={() => setVer(null)} />}
    </div>
  );
}

function Nueva({ tolerancia, onClose, onListo }: { tolerancia: number; onClose: () => void; onListo: (id: string) => void }) {
  const empresas = useDatos<{ data: { id: string; trade_name: string | null; legal_name: string }[] }>("/v1/del/empresas");
  const hoy = hoyLima();
  const [d, setD] = useState({ supplier_id: "", invoice_number: "", issue_date: hoy, period_from: `${hoy.slice(0, 7)}-01`, period_to: hoy, amount: "", lineas: "" });
  const previa = useDatos<{ total: number; envios: number }>(d.supplier_id && d.period_from && d.period_to ? `/v1/del/facturas/envios?supplier_id=${d.supplier_id}&period_from=${d.period_from}&period_to=${d.period_to}` : null);
  const [ocupado, setOcupado] = useState(false);
  const lineas = d.lineas.split("\n").map((l) => l.split(/[;,\t]/).map((x) => x.trim())).filter((x) => x[0]).map(([ref, monto]) => ({ ref, amount: Number((monto ?? "0").replace(",", ".")) || 0 }));
  const dif = d.amount !== "" && previa.datos ? Number(d.amount) - previa.datos.total : null;
  return (
    <Modal open onClose={onClose} title="Conciliar factura" size="lg" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!d.supplier_id || !d.invoice_number.trim() || d.amount === ""} onClick={async () => {
          setOcupado(true);
          try {
            const f = await api<{ id: string; status: string }>("/v1/del/facturas", { method: "POST", body: { supplier_id: d.supplier_id, invoice_number: d.invoice_number, issue_date: d.issue_date,
              period_from: d.period_from, period_to: d.period_to, amount: Number(d.amount), lines: lineas.length ? lineas : null } });
            toast.ok(f.status === "RECONCILED" ? "Factura conciliada." : "Factura observada: revisa las diferencias.");
            onListo(f.id);
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Conciliar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Empresa" required>
          <Select value={d.supplier_id} onChange={(e) => setD({ ...d, supplier_id: e.target.value })} placeholder="Elige la empresa"
            options={(empresas.datos?.data ?? []).map((e) => ({ value: e.id, label: e.trade_name ?? e.legal_name }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="N.º de factura" required><Input value={d.invoice_number} onChange={(e) => setD({ ...d, invoice_number: e.target.value.toUpperCase() })} placeholder="F001-000123" /></Field>
          <Field label="Emisión"><Input type="date" value={d.issue_date} onChange={(e) => setD({ ...d, issue_date: e.target.value })} /></Field>
          <Field label="Período desde" required><Input type="date" value={d.period_from} onChange={(e) => setD({ ...d, period_from: e.target.value })} /></Field>
          <Field label="Período hasta" required><Input type="date" value={d.period_to} onChange={(e) => setD({ ...d, period_to: e.target.value })} /></Field>
          <Field label="Importe facturado (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.01" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></Field>
        </div>
        {previa.datos && (
          <div className="grid grid-cols-2 gap-3">
            <Cifra titulo="Esperado" valor={soles(previa.datos.total)} detalle={`${previa.datos.envios} envío(s) × tarifa`} />
            <Cifra titulo="Diferencia" valor={dif === null ? "—" : soles(dif)} tono={dif === null ? undefined : Math.abs(dif) <= tolerancia ? "ok" : "warn"} detalle={`Tolerancia ${soles(tolerancia)}`} />
          </div>
        )}
        <Field label="Detalle de la factura (opcional)" hint="Una línea por envío: número de pedido y monto, separados por coma o punto y coma.">
          <Textarea rows={5} value={d.lineas} onChange={(e) => setD({ ...d, lineas: e.target.value })} placeholder={"DG-26-000123; 9\nDG-26-000124; 9"} />
        </Field>
      </div>
    </Modal>
  );
}

function Ver({ id, onClose }: { id: string; onClose: () => void }) {
  const { datos } = useDatos<{ factura: Factura; lineas: Linea[] }>(`/v1/del/facturas/${id}`);
  return (
    <Modal open onClose={onClose} title={datos ? `Factura ${datos.factura.invoice_number}` : "Factura"} size="lg">
      {!datos ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Cifra titulo="Facturado" valor={soles(datos.factura.amount)} />
            <Cifra titulo="Esperado" valor={soles(datos.factura.expected_amount)} />
            <Cifra titulo="Diferencia" valor={soles(datos.factura.difference)} tono={datos.factura.status === "RECONCILED" ? "ok" : "warn"} />
          </div>
          <ul className="divide-y divide-line">
            {datos.lineas.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                <span className="min-w-0"><span className="block font-medium text-ink">{l.external_ref}</span><span className="text-[12px] text-muted">{l.ruta ? `${l.ruta} · ${fecha(l.route_date)}` : "Sin envío registrado"}</span></span>
                <span className="flex flex-col items-end gap-0.5"><StatusBadge status={l.match_status} labels={LINEA} /><span className="text-[12px]">{soles(l.billed_amount)} / esperado {soles(l.expected_amount)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
