"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Save, Send } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Foto } from "@/modulos/del/Captura";
import { Seccion } from "./comunes";
import { FotoComprobante } from "./Ficha";
import { lista, type FichaGasto, type Opciones } from "./tipos";

type Valores = {
  establishment_id: string; brand_id: string; cost_center_id: string; category_id: string; doc_type: string; doc_series: string; doc_number: string;
  issue_date: string; currency: string; total: string; igv: string; other_taxes: string; description: string; pay_source: string; supplier_doc: string;
  supplier_name: string; vehicle_id: string; route_id: string; employee_id: string; fuel_gallons: string; fuel_voucher_no: string; odometer_km: string;
  ad_campaign_id: string; sales_channel: string;
};

const n = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));
const dos = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

function iniciales(op: Opciones, local: string, g: FichaGasto | null): Valores {
  if (g) {
    const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
    return {
      establishment_id: g.establishment_id, brand_id: g.brand_id, cost_center_id: g.cost_center_id, category_id: g.category_id, doc_type: g.doc_type,
      doc_series: s(g.doc_series), doc_number: s(g.doc_number), issue_date: g.issue_date, currency: g.currency, total: s(g.total), igv: s(g.igv),
      other_taxes: s(g.other_taxes), description: g.description, pay_source: g.pay_source ?? "PAYABLE", supplier_doc: s(g.supplier_doc), supplier_name: s(g.proveedor),
      vehicle_id: s(g.vehicle_id), route_id: s(g.route_id), employee_id: s(g.employee_id), fuel_gallons: s(g.fuel_gallons), fuel_voucher_no: s(g.fuel_voucher_no),
      odometer_km: s(g.odometer_km), ad_campaign_id: s(g.ad_campaign_id), sales_channel: s(g.sales_channel),
    };
  }
  return {
    establishment_id: op.locales.find((l) => l.id === local)?.id ?? (op.locales.length === 1 ? op.locales[0].id : ""), brand_id: "", cost_center_id: "", category_id: "",
    doc_type: "", doc_series: "", doc_number: "", issue_date: op.hoy, currency: "PEN", total: "", igv: "0", other_taxes: "0", description: "", pay_source: "PAYABLE",
    supplier_doc: "", supplier_name: "", vehicle_id: "", route_id: "", employee_id: "", fuel_gallons: "", fuel_voucher_no: "", odometer_km: "", ad_campaign_id: "", sales_channel: "",
  };
}

/** GAS-01: registro desde el celular (foto, proveedor por RUC, montos, categoría y centro de costo; pide lo que exige la categoría). */
export function FormularioGasto({ op, gasto }: { op: Opciones; gasto: FichaGasto | null }) {
  const router = useRouter();
  const { local } = useSesion();
  const [v, setV] = useState<Valores>(() => iniciales(op, local, gasto));
  const [foto, setFoto] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState<"" | "borrador" | "enviar">("");
  const [proveedor, setProveedor] = useState<{ ruc: string; mensaje: string; maestro: boolean } | null>(null);
  const cambiar = (k: keyof Valores, valor: string) => setV((x) => ({ ...x, [k]: valor }));

  const cat = op.categorias.find((c) => c.id === v.category_id);
  const doc = v.doc_type || cat?.default_doc_type || "";
  const conProveedor = op.con_proveedor.includes(doc);
  const sinValido = op.sin_valido.includes(doc);
  const reparto = cat?.category_group === "DELIVERY";
  const fondo = op.fondos.find((f) => f.establishment_id === v.establishment_id);
  const total = n(v.total);
  const subtotal = total - n(v.igv) - n(v.other_taxes);
  const maxCaja = fondo?.max_expense_amount ?? op.parametros.petty_max;
  const retencion = doc === "FEES_RECEIPT" && total >= op.parametros.retencion_desde ? total * op.parametros.retencion_pct / 100 : 0;

  const grupos = useMemo(() => {
    const m = new Map<string, { value: string; label: string }[]>();
    for (const c of op.categorias) {
      const g = op.grupos[c.category_group] ?? c.category_group;
      m.set(g, [...(m.get(g) ?? []), { value: c.id, label: c.name }]);
    }
    return [...m.entries()];
  }, [op]);

  function elegirCategoria(id: string) {
    const c = op.categorias.find((x) => x.id === id);
    setV((x) => ({ ...x, category_id: id, cost_center_id: c?.default_cost_center_id ?? x.cost_center_id, doc_type: c?.default_doc_type ?? x.doc_type,
      igv: c?.default_doc_type === "INVOICE" ? x.igv : "0" }));
  }

  function elegirRuta(id: string) {
    const r = op.rutas.find((x) => x.id === id);
    setV((x) => ({ ...x, route_id: id, vehicle_id: x.vehicle_id || r?.vehicle_id || "", employee_id: x.employee_id || r?.driver_employee_id || "" }));
  }

  async function buscarRuc(ruc: string) {
    if (ruc.length !== 11) return;
    try {
      const r = await api<{ valido: boolean; mensaje?: string; nombre?: string | null; del_maestro?: boolean }>(`/v1/gas/proveedor/${ruc}`);
      if (!r.valido) { setProveedor({ ruc, mensaje: r.mensaje ?? "RUC no válido.", maestro: false }); return; }
      if (r.nombre) cambiar("supplier_name", r.nombre);
      setProveedor({ ruc, mensaje: r.del_maestro ? "Proveedor del maestro de Compras." : r.nombre ? "Usado antes en otro gasto." : "No está en el maestro: escribe la razón social.", maestro: Boolean(r.del_maestro) });
    } catch {
      setProveedor(null);
    }
  }

  async function guardar(e: FormEvent, enviar: boolean) {
    e.preventDefault();
    setGuardando(enviar ? "enviar" : "borrador");
    setErrores({});
    setError("");
    try {
      const f = new FormData();
      for (const [k, valor] of Object.entries(v)) f.set(k, valor);
      f.set("doc_type", doc);
      if (foto) f.set("foto_data", foto);
      if (enviar) f.set("enviar", "1");
      const r = await api<FichaGasto>(gasto ? `/v1/gas/gastos/${gasto.id}` : "/v1/gas/gastos", { method: "POST", body: f });
      toast.ok(enviar ? `Gasto ${r.number} enviado a aprobación.` : `Gasto ${r.number} guardado como borrador.`);
      router.push(`/m/gas/gas-02?id=${r.id}`);
    } catch (x) {
      setErrores(erroresDe(x));
      setError(mensajeDe(x));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setGuardando("");
    }
  }

  const centros = op.centros.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const fotoRequerida = doc !== "NONE";

  return (
    <form className="mx-auto max-w-3xl space-y-4" onSubmit={(e) => guardar(e, true)}>
      {error && <Alert tone="bad">{error}</Alert>}
      {gasto?.status === "REJECTED" && gasto.rejection_reason && <Alert tone="warn" title="Lo rechazaron por">{gasto.rejection_reason}</Alert>}

      <Seccion titulo="Comprobante">
        <div className="space-y-3">
          <Field label="Foto del comprobante" required={fotoRequerida} hint={fotoRequerida ? "Para enviarlo a aprobación hace falta la foto." : "Sin comprobante no hace falta la foto."}>
            <Foto valor={foto} onChange={setFoto} texto={gasto?.foto ? "Cambiar la foto" : "Tomar o elegir la foto"} />
          </Field>
          {gasto?.foto && !foto && <div className="max-w-xs"><FotoComprobante id={gasto.id} hay /></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoría" required error={errores.category_id}>
              <Select value={v.category_id} onChange={(e) => elegirCategoria(e.target.value)} placeholder="Elige la categoría" searchable
                options={grupos.flatMap(([g, ops]) => ops.map((o) => ({ value: o.value, label: `${o.label} · ${g}` })))} />
            </Field>
            <Field label="Tipo de comprobante" required>
              <Select value={doc} onChange={(e) => setV((x) => ({ ...x, doc_type: e.target.value, igv: e.target.value === "INVOICE" ? x.igv : "0" }))} options={lista(op.documentos)} placeholder="Elige" />
            </Field>
          </div>
          {sinValido && <Alert tone="warn">{doc === "NONE" ? "Sin comprobante" : op.documentos[doc]}: se acepta, pero queda marcado para la contadora y no da crédito fiscal.</Alert>}
          {doc !== "NONE" && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Serie" required={conProveedor}><Input value={v.doc_series} maxLength={20} placeholder="F001" onChange={(e) => cambiar("doc_series", e.target.value.toUpperCase())} /></Field>
              <Field label="Número" required={conProveedor || doc === "FOREIGN_INVOICE"}><Input value={v.doc_number} maxLength={20} placeholder="345" onChange={(e) => cambiar("doc_number", e.target.value)} /></Field>
              <Field label="Fecha" required className="col-span-2 sm:col-span-2"><Input type="date" value={v.issue_date} max={op.hoy} onChange={(e) => cambiar("issue_date", e.target.value)} /></Field>
            </div>
          )}
          {doc === "NONE" && <Field label="Fecha" required><Input type="date" value={v.issue_date} max={op.hoy} onChange={(e) => cambiar("issue_date", e.target.value)} /></Field>}
          {(doc !== "NONE" || Boolean(cat?.requires_supplier)) && (
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <Field label={doc === "FOREIGN_INVOICE" ? "RUC (si tiene)" : "RUC del proveedor"} required={conProveedor} hint={proveedor && proveedor.ruc === v.supplier_doc ? proveedor.mensaje : undefined}>
                <Input value={v.supplier_doc} inputMode="numeric" maxLength={11} placeholder="20…" onChange={(e) => { const r = e.target.value.replace(/\D/g, ""); cambiar("supplier_doc", r); if (r.length === 11) void buscarRuc(r); }} />
              </Field>
              <Field label="Proveedor (razón social)" required={conProveedor || doc === "FOREIGN_INVOICE" || Boolean(cat?.requires_supplier)}>
                <Input value={v.supplier_name} maxLength={160} disabled={Boolean(proveedor?.maestro && proveedor.ruc === v.supplier_doc)} onChange={(e) => cambiar("supplier_name", e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </Seccion>

      <Seccion titulo="Montos">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Moneda"><Select value={v.currency} onChange={(e) => cambiar("currency", e.target.value)} options={[{ value: "PEN", label: "Soles" }, { value: "USD", label: "Dólares" }]} /></Field>
            <Field label="Total" required><Input inputMode="decimal" value={v.total} placeholder="0.00" onChange={(e) => cambiar("total", e.target.value)} /></Field>
            <Field label="IGV" hint={doc === "INVOICE" ? undefined : "Solo en factura"}>
              <Input inputMode="decimal" value={v.igv} disabled={doc !== "INVOICE"} onChange={(e) => cambiar("igv", e.target.value)} />
            </Field>
            <Field label="Otros tributos"><Input inputMode="decimal" value={v.other_taxes} onChange={(e) => cambiar("other_taxes", e.target.value)} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
            {doc === "INVOICE" && total > 0 && (
              <Button size="sm" icon={Calculator} onClick={() => cambiar("igv", dos((total - n(v.other_taxes)) - (total - n(v.other_taxes)) / 1.18))}>IGV 18 % del total</Button>
            )}
            <span>Subtotal: <b className="text-ink">{v.currency === "USD" ? "US$ " + dos(Math.max(0, subtotal)) : soles(Math.max(0, subtotal))}</b></span>
            {v.currency === "USD" && <span>Se convierte con el tipo de cambio de venta de la fecha.</span>}
            {retencion > 0 && <span>Retención de 4.ª categoría ({op.parametros.retencion_pct} %): <b className="text-ink">{soles(retencion)}</b></span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Se paga">
              <Select value={v.pay_source} onChange={(e) => cambiar("pay_source", e.target.value)}
                options={[{ value: "PAYABLE", label: "Por pagar (tesorería)" }, ...(fondo ? [{ value: "PETTY", label: `Con caja chica (hasta ${soles(maxCaja)})` }] : [])]} />
            </Field>
            {v.pay_source === "PETTY" && total > maxCaja && <Alert tone="bad">La caja chica acepta gastos de hasta {soles(maxCaja)}.</Alert>}
          </div>
        </div>
      </Seccion>

      <Seccion titulo="A qué se imputa">
        <div className="space-y-3">
          <Field label="Descripción" required error={errores.description}>
            <Textarea rows={2} maxLength={2000} value={v.description} placeholder="En qué se gastó" onChange={(e) => cambiar("description", e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Local" required><Select value={v.establishment_id} onChange={(e) => cambiar("establishment_id", e.target.value)} placeholder="Elige el local" options={op.locales.map((l) => ({ value: l.id, label: l.name }))} /></Field>
            <Field label="Centro de costo" required><Select value={v.cost_center_id} onChange={(e) => cambiar("cost_center_id", e.target.value)} placeholder="Elige" options={centros} /></Field>
            <Field label="Marca" hint="Si no la eliges, la del centro de costo."><Select value={v.brand_id} onChange={(e) => cambiar("brand_id", e.target.value)} placeholder="La del centro" options={op.marcas.map((m) => ({ value: m.id, label: m.name }))} /></Field>
          </div>
          {(reparto || cat?.requires_vehicle || cat?.requires_employee) && (
            <div className="grid gap-3 sm:grid-cols-3">
              {reparto && <Field label="Ruta" hint="Opcional: completa vehículo y repartidor."><Select value={v.route_id} onChange={(e) => elegirRuta(e.target.value)} placeholder="Sin ruta" options={op.rutas.map((r) => ({ value: r.id, label: `${r.code} · ${r.route_date.slice(8, 10)}/${r.route_date.slice(5, 7)}` }))} /></Field>}
              {(reparto || cat?.requires_vehicle) && <Field label="Vehículo" required={Boolean(cat?.requires_vehicle)}><Select value={v.vehicle_id} onChange={(e) => cambiar("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.plate }))} /></Field>}
              {(reparto || cat?.requires_employee) && <Field label="Repartidor o trabajador" required={Boolean(cat?.requires_employee)}><Select value={v.employee_id} onChange={(e) => cambiar("employee_id", e.target.value)} placeholder="Elige" options={op.trabajadores.map((t) => ({ value: t.id, label: t.full_name }))} /></Field>}
            </div>
          )}
          {cat?.requires_gallons && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Galones" required><Input inputMode="decimal" value={v.fuel_gallons} onChange={(e) => cambiar("fuel_gallons", e.target.value)} /></Field>
              <Field label="N.º de vale" hint="Si no hay, va el del comprobante."><Input value={v.fuel_voucher_no} maxLength={20} onChange={(e) => cambiar("fuel_voucher_no", e.target.value)} /></Field>
              <Field label="Odómetro (km)"><Input inputMode="decimal" value={v.odometer_km} onChange={(e) => cambiar("odometer_km", e.target.value)} /></Field>
            </div>
          )}
          {(cat?.requires_campaign || cat?.category_group === "ADVERTISING" || cat?.category_group === "CONTENT_CREATORS") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Campaña" required={Boolean(cat?.requires_campaign)}><Select value={v.ad_campaign_id} onChange={(e) => cambiar("ad_campaign_id", e.target.value)} placeholder="Elige la campaña" options={op.campanas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
              <Field label="Canal"><Select value={v.sales_channel} onChange={(e) => cambiar("sales_channel", e.target.value)} placeholder="Sin canal" options={lista(op.canales)} /></Field>
            </div>
          )}
          {reparto && <p className="text-[12.5px] text-muted">Al aprobarse, el gasto entra a los costos de Delivery sin IGV, con su vehículo, ruta, repartidor y galones.</p>}
        </div>
      </Seccion>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap justify-end gap-2 border-t border-line bg-bg/95 px-1 py-3 backdrop-blur">
        <Button icon={Save} loading={guardando === "borrador"} disabled={Boolean(guardando)} onClick={(e) => guardar(e as unknown as FormEvent, false)}>Guardar borrador</Button>
        <Button type="submit" variant="primary" icon={Send} loading={guardando === "enviar"} disabled={Boolean(guardando)}>Enviar a aprobación</Button>
      </div>
    </form>
  );
}
