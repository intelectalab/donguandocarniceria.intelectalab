"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { MODOS_VENTA, type Corte, type Producto, type Variante } from "./tipos";

type Valores = {
  product_id: string; sku: string; name: string; cut_type_id: string; sale_mode: string; nominal_weight_kg: string; min_weight_kg: string;
  max_weight_kg: string; weight_tolerance_pct: string; barcode: string; scale_plu: string; min_order_qty: string; qty_step: string;
  std_cost: string; web_publishable: boolean; status: string;
};

const texto = (x: string | number | null | undefined) => (x === null || x === undefined ? "" : String(Number(x)));

/** Crear o editar una variante (CAT-03): un SKU por corte o presentación. */
export function VarianteForm({ variante, productoId, productos, tolerancia, onClose, onGuardado }: {
  variante: Variante | null; productoId?: string; productos: Producto[]; tolerancia: number;
  onClose: () => void; onGuardado: (id: string) => void;
}) {
  const [v, setV] = useState<Valores>(() => ({
    product_id: variante?.product_id ?? productoId ?? "",
    sku: variante?.sku ?? "", name: variante?.name ?? "", cut_type_id: variante?.cut_type_id ?? "",
    sale_mode: variante?.sale_mode ?? "UNIT_VARIABLE_WEIGHT",
    nominal_weight_kg: texto(variante?.nominal_weight_kg), min_weight_kg: texto(variante?.min_weight_kg), max_weight_kg: texto(variante?.max_weight_kg),
    weight_tolerance_pct: texto(variante?.weight_tolerance_pct), barcode: variante?.barcode ?? "", scale_plu: variante?.scale_plu ?? "",
    min_order_qty: variante ? texto(variante.min_order_qty) : "1", qty_step: variante ? texto(variante.qty_step) : "1",
    std_cost: texto(variante?.std_cost), web_publishable: Boolean(variante?.web_publishable), status: variante?.status ?? "ACTIVE",
  }));
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));

  // Al crear una variante solo se ofrecen los cortes de la línea de su producto.
  useEffect(() => {
    let vigente = true;
    const q = v.product_id ? `?product_id=${v.product_id}` : "";
    api<Corte[]>(`/v1/cat/cortes${q}`).then((c) => vigente && setCortes(c)).catch(() => {});
    return () => { vigente = false; };
  }, [v.product_id]);

  const porUnidad = v.sale_mode === "UNIT";
  const nominal = Number(v.nominal_weight_kg) || 0;
  const tol = v.weight_tolerance_pct === "" ? tolerancia : Number(v.weight_tolerance_pct);
  const precio = variante?.precio_whatsapp;
  const producto = productos.find((p) => p.id === v.product_id);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setErrores({});
    const n = (x: string) => (x === "" ? null : Number(x));
    try {
      const body = {
        ...v, cut_type_id: v.cut_type_id || null, barcode: v.barcode || null, scale_plu: v.scale_plu || null,
        nominal_weight_kg: n(v.nominal_weight_kg), min_weight_kg: n(v.min_weight_kg), max_weight_kg: n(v.max_weight_kg),
        weight_tolerance_pct: n(v.weight_tolerance_pct), min_order_qty: n(v.min_order_qty), qty_step: n(v.qty_step), std_cost: n(v.std_cost),
      };
      const r = await api<{ id: string }>(variante ? `/v1/cat/variantes/${variante.id}` : "/v1/cat/variantes", { method: variante ? "PUT" : "POST", body });
      toast.ok(variante ? "Variante actualizada" : "Variante creada");
      onGuardado(r.id);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="lg"
      title={variante ? `${variante.sku} · ${variante.name}` : "Nueva variante o corte"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-variante" variant="primary" loading={guardando}>{variante ? "Guardar cambios" : "Crear variante"}</Button>
      </>}>
      <form id="f-variante" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}

        <div className="sm:col-span-2">
          <Alert tone="info">
            {v.sale_mode === "UNIT_VARIABLE_WEIGHT"
              ? <>Se pide por unidad y se cobra por kg (RN-CAT-02). 2 u × {numero(nominal, 3)} kg = {numero(2 * nominal, 3)} kg estimados
                {precio && precio.basis === "KG" ? <> × {soles(precio.price)}/kg = {soles(2 * nominal * precio.price)}</> : null}.</>
              : v.sale_mode === "KG" ? "Se pide y se cobra por kg." : "Precio fijo por unidad."}
            {!porUnidad && nominal > 0 && <> Tolerancia {numero(tol, 1)} %: de {numero(nominal * (1 - tol / 100), 3)} a {numero(nominal * (1 + tol / 100), 3)} kg por unidad sin avisar al cliente.</>}
          </Alert>
        </div>

        <Field label="Producto" required error={errores.product_id} className="sm:col-span-2">
          <Select value={v.product_id} onChange={(e) => setV((x) => ({ ...x, product_id: e.target.value, cut_type_id: "" }))} disabled={Boolean(variante)}
            placeholder="Elige el producto" options={productos.map((p) => ({ value: p.id, label: `${p.code} · ${p.name} (${p.brand_name ?? ""})` }))} />
        </Field>
        <Field label="SKU" required error={errores.sku} hint={producto ? `Único en la empresa. Ej.: DG-${producto.code}` : "Único en la empresa."}>
          <Input value={v.sku} onChange={(e) => set("sku")(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={40} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre de la presentación" required error={errores.name}>
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Tipo de corte" error={errores.cut_type_id} hint="Solo los cortes que aplican a la línea del producto.">
          <Select value={v.cut_type_id} onChange={(e) => set("cut_type_id")(e.target.value)} placeholder="Sin corte"
            options={cortes.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Modo de venta" required error={errores.sale_mode}>
          <Select value={v.sale_mode} onChange={(e) => set("sale_mode")(e.target.value)} options={MODOS_VENTA} />
        </Field>

        {!porUnidad && <>
          <Field label="Peso nominal por unidad (kg)" error={errores.nominal_weight_kg} required={v.sale_mode === "UNIT_VARIABLE_WEIGHT"}>
            <Input type="number" step="0.001" min={0} value={v.nominal_weight_kg} onChange={(e) => set("nominal_weight_kg")(e.target.value)} />
          </Field>
          <Field label="Tolerancia de peso (%)" error={errores.weight_tolerance_pct} hint={`Vacío: la de la empresa (${numero(tolerancia, 0)} %).`}>
            <Input type="number" step="0.1" min={0} value={v.weight_tolerance_pct} onChange={(e) => set("weight_tolerance_pct")(e.target.value)} />
          </Field>
          <Field label="Peso mínimo (kg)" error={errores.min_weight_kg} hint="Por unidad. Valida el peso en el mostrador.">
            <Input type="number" step="0.001" min={0} value={v.min_weight_kg} onChange={(e) => set("min_weight_kg")(e.target.value)} />
          </Field>
          <Field label="Peso máximo (kg)" error={errores.max_weight_kg}>
            <Input type="number" step="0.001" min={0} value={v.max_weight_kg} onChange={(e) => set("max_weight_kg")(e.target.value)} />
          </Field>
        </>}

        <Field label="Código de barras" error={errores.barcode}>
          <Input value={v.barcode} onChange={(e) => set("barcode")(e.target.value.replace(/\D/g, ""))} maxLength={14} inputMode="numeric" className="font-mono" />
        </Field>
        <Field label="PLU de balanza" error={errores.scale_plu} hint="5 dígitos, único entre las activas (RN-CAT-04).">
          <Input value={v.scale_plu} onChange={(e) => set("scale_plu")(e.target.value.replace(/\D/g, ""))} maxLength={5} inputMode="numeric" className="font-mono" />
        </Field>
        <Field label="Cantidad mínima de pedido" error={errores.min_order_qty}>
          <Input type="number" step="0.001" min={0} value={v.min_order_qty} onChange={(e) => set("min_order_qty")(e.target.value)} />
        </Field>
        <Field label="Múltiplo de pedido" error={errores.qty_step} hint="Ej.: 0,25 kg para frutos secos a granel (RN-CAT-07).">
          <Input type="number" step="0.001" min={0} value={v.qty_step} onChange={(e) => set("qty_step")(e.target.value)} />
        </Field>
        <Field label="Costo estándar (S/)" error={errores.std_cost}>
          <Input type="number" step="0.01" min={0} value={v.std_cost} onChange={(e) => set("std_cost")(e.target.value)} />
        </Field>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={v.web_publishable} onChange={set("web_publishable")} label="Publicar en la web" hint="No se publica si el registro sanitario del producto está vencido (RN-CAT-09)." />
        </div>
      </form>
    </Modal>
  );
}
