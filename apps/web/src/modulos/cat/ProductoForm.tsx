"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field, Input, Modal, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { AFECTACION_IGV, ALMACENAMIENTO, AUTORIDADES, ORIGENES, TIPOS_PRODUCTO, type Categoria, type FichaProducto } from "./tipos";

type Valores = {
  code: string; name: string; brand_id: string; category_id: string; product_type: string; origin: string; storage: string;
  shelf_life_days: string; requires_lot: boolean; igv_affectation: string; tax_change_reason: string; sunat_product_code: string;
  allow_discount: boolean; sanitary_authority: string; sanitary_registry: string; sanitary_registry_expires: string; status: string;
};

/**
 * Crear o editar un producto (CAT-02). Con «copiarDe», arma uno nuevo con los datos de otro para otra marca
 * (RN-CAT-01: un producto es de una sola marca).
 */
export function ProductoForm({ producto, copiarDe, categorias, onClose, onGuardado }: {
  producto: FichaProducto | null; copiarDe?: FichaProducto | null; categorias: Categoria[];
  onClose: () => void; onGuardado: (id: string) => void;
}) {
  const { me, marca, can } = useSesion();
  const base = producto ?? copiarDe ?? null;
  const [v, setV] = useState<Valores>(() => ({
    code: producto?.code ?? (copiarDe ? `${copiarDe.code}-M` : ""),
    name: base?.name ?? "",
    brand_id: producto?.brand_id ?? (copiarDe ? "" : marca !== "ALL" ? marca : me.brands[0]?.id ?? ""),
    category_id: base?.category_id ?? "",
    product_type: base?.product_type ?? "GOODS",
    origin: base?.origin ?? "PRODUCED",
    storage: base?.storage ?? "CHILLED",
    shelf_life_days: base?.shelf_life_days ? String(base.shelf_life_days) : "",
    requires_lot: base?.requires_lot ?? true,
    igv_affectation: base?.igv_affectation ?? "10",
    tax_change_reason: "",
    sunat_product_code: base?.sunat_product_code ?? "",
    allow_discount: base?.allow_discount ?? true,
    sanitary_authority: base?.sanitary_authority ?? "SENASA",
    sanitary_registry: base?.sanitary_registry ?? "",
    sanitary_registry_expires: base?.sanitary_registry_expires?.slice(0, 10) ?? "",
    status: producto?.status ?? "ACTIVE",
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const set = <K extends keyof Valores>(campo: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [campo]: valor }));

  const conVentas = Boolean(producto?.tiene_ventas);
  const cambiaIgv = Boolean(producto && producto.igv_affectation !== v.igv_affectation);
  const marcas = copiarDe ? me.brands.filter((b) => b.id !== copiarDe.brand_id) : me.brands;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setErrores({});
    try {
      const body = {
        ...v,
        shelf_life_days: v.shelf_life_days === "" ? null : Number(v.shelf_life_days),
        sunat_product_code: v.sunat_product_code || null,
        sanitary_registry: v.sanitary_registry || null,
        sanitary_registry_expires: v.sanitary_registry_expires || null,
        tax_change_reason: v.tax_change_reason || null,
      };
      const r = await api<{ id: string }>(producto ? `/v1/cat/productos/${producto.id}` : "/v1/cat/productos", { method: producto ? "PUT" : "POST", body });
      toast.ok(producto ? "Producto actualizado" : "Producto creado");
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
      title={producto ? `${producto.code} · ${producto.name}` : copiarDe ? `Copiar ${copiarDe.name} a otra marca` : "Nuevo producto"}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-producto" variant="primary" loading={guardando}>{producto ? "Guardar cambios" : "Crear producto"}</Button>
      </>}>
      <form id="f-producto" onSubmit={guardar} noValidate className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad sm:col-span-2">{error}</p>}
        {conVentas && (
          <div className="sm:col-span-2">
            <Alert tone="info">Este producto tiene ventas: la marca no se cambia (RN-CAT-01) y cambiar la afectación del IGV exige el permiso cat.product.tax_change y un motivo (RN-CAT-13).</Alert>
          </div>
        )}

        <Field label="Código" required error={errores.code} hint="Único en la empresa. Letras, números o guiones.">
          <Input value={v.code} onChange={(e) => set("code")(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={40} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={v.name} onChange={(e) => set("name")(e.target.value)} maxLength={255} />
        </Field>
        <Field label="Marca" required error={errores.brand_id}>
          <Select value={v.brand_id} onChange={(e) => set("brand_id")(e.target.value)} disabled={conVentas} placeholder="Elige la marca"
            options={marcas.map((b) => ({ value: b.id, label: b.name }))} />
        </Field>
        <Field label="Categoría" required error={errores.category_id} hint="Define la línea del producto (cuy, aves, café…).">
          <Select value={v.category_id} onChange={(e) => set("category_id")(e.target.value)} placeholder="Elige la categoría"
            options={categorias.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Tipo" required error={errores.product_type}>
          <Select value={v.product_type} onChange={(e) => set("product_type")(e.target.value)} options={TIPOS_PRODUCTO} />
        </Field>
        <Field label="Origen" required error={errores.origin}>
          <Select value={v.origin} onChange={(e) => set("origin")(e.target.value)} options={ORIGENES} />
        </Field>
        <Field label="Almacenamiento" required error={errores.storage}>
          <Select value={v.storage} onChange={(e) => set("storage")(e.target.value)} options={ALMACENAMIENTO} />
        </Field>
        <Field label="Vida útil (días)" error={errores.shelf_life_days}>
          <Input type="number" min={0} value={v.shelf_life_days} onChange={(e) => set("shelf_life_days")(e.target.value)} />
        </Field>
        <Field label="Afectación del IGV" required error={errores.igv_affectation} hint="Catálogo 07 de SUNAT. Viaja al comprobante (RN-CAT-13).">
          <Select value={v.igv_affectation} onChange={(e) => set("igv_affectation")(e.target.value)} options={AFECTACION_IGV}
            disabled={conVentas && !can("cat.product.tax_change")} />
        </Field>
        <Field label="Código de producto SUNAT" error={errores.sunat_product_code} hint="8 dígitos del catálogo UNSPSC.">
          <Input value={v.sunat_product_code} onChange={(e) => set("sunat_product_code")(e.target.value.replace(/\D/g, ""))} maxLength={8} inputMode="numeric" className="font-mono" />
        </Field>
        {cambiaIgv && conVentas && (
          <Field label="Motivo del cambio de IGV" required error={errores.tax_change_reason} className="sm:col-span-2" hint="Queda en la auditoría. Al menos 10 caracteres.">
            <Input value={v.tax_change_reason} onChange={(e) => set("tax_change_reason")(e.target.value)} maxLength={200} />
          </Field>
        )}

        <h3 className="pt-2 text-[14px] font-semibold sm:col-span-2">Registro sanitario</h3>
        <Field label="Autoridad" required error={errores.sanitary_authority} hint="SENASA para carne fresca; DIGESA para industrializados y envasados.">
          <Select value={v.sanitary_authority} onChange={(e) => set("sanitary_authority")(e.target.value)} options={AUTORIDADES} />
        </Field>
        {v.sanitary_authority !== "NONE" && <>
          <Field label="Número de registro" error={errores.sanitary_registry} required={v.sanitary_authority === "DIGESA" && v.status === "ACTIVE"}>
            <Input value={v.sanitary_registry} onChange={(e) => set("sanitary_registry")(e.target.value)} maxLength={40} className="font-mono" />
          </Field>
          <Field label="Vencimiento del registro" error={errores.sanitary_registry_expires} required={v.sanitary_authority === "DIGESA" && v.status === "ACTIVE"}>
            <Input type="date" value={v.sanitary_registry_expires} onChange={(e) => set("sanitary_registry_expires")(e.target.value)} />
          </Field>
        </>}

        <h3 className="pt-2 text-[14px] font-semibold sm:col-span-2">Venta</h3>
        <div className="space-y-3 sm:col-span-2">
          <Checkbox checked={v.requires_lot} onChange={set("requires_lot")} label="Controla lote" hint="Cada ingreso al almacén lleva su lote y vencimiento." />
          <Checkbox checked={v.allow_discount} onChange={set("allow_discount")} label="Admite descuento" hint="Si no, el pedido y el mostrador rechazan descuentos (RN-CAT-10)." />
        </div>
        <Field label="Estado" required error={errores.status}>
          <Select value={v.status} onChange={(e) => set("status")(e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} />
        </Field>
        {producto && v.status === "INACTIVE" && producto.status === "ACTIVE" && (
          <p className="self-end pb-2 text-[12.5px] text-warn">Sus variantes activas también se inactivan y dejan de venderse (RN-CAT-11).</p>
        )}
      </form>
    </Modal>
  );
}
