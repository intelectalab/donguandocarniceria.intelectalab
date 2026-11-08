"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleOff, Copy, Pencil, Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, PageHeader, Select, StatusBadge, Tabs, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ProductoForm } from "@/modulos/cat/ProductoForm";
import {
  AFECTACION_IGV, ALMACENAMIENTO, AUTORIDADES, LINEAS, MODOS_VENTA, ORIGENES, SINCRONIZACION, TIPOS_PRODUCTO, etiqueta,
  type Categoria, type FichaProducto, type Producto, type VarianteFicha,
} from "@/modulos/cat/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };
const ACCIONES: Record<string, string> = { I: "Creado", U: "Modificado", D: "Borrado" };

type Pestana = "variantes" | "precios" | "componentes" | "historial";

/** CAT-02 Ficha del producto: datos, registro sanitario, variantes, precios por lista e historial. ?id= el producto; ?nuevo=1 abre el alta. */
export default function FichaDelProducto({ searchParams }: PageProps<"/m/cat/cat-02">) {
  const params = use(searchParams);
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const { can } = useSesion();
  const puedeEditar = can("cat.product.manage");

  const productos = useListado<Producto>("/v1/cat/productos", { porPagina: 100, orden: "code", filtros: { tipo: "ALL" } }).filas;
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [ficha, setFicha] = useState<FichaProducto | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [pestana, setPestana] = useState<Pestana>("variantes");
  const [form, setForm] = useState<{ modo: "nuevo" | "editar" | "copiar" } | null>(() => params.nuevo ? { modo: "nuevo" } : null);
  const [cambiando, setCambiando] = useState(false);

  // Sin ?id, abre el primer producto de la lista.
  const actual = id || productos[0]?.id || "";

  useEffect(() => {
    let vigente = true;
    api<Categoria[]>("/v1/cat/categorias").then((c) => vigente && setCategorias(c)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (!actual) return;
    let vigente = true;
    api<FichaProducto>(`/v1/cat/productos/${actual}`)
      .then((f) => { if (vigente) { setFicha(f); setError(""); } })
      .catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [actual, version]);

  const ir = (nuevoId: string) => router.push(`/m/cat/cat-02?id=${nuevoId}`);
  const p = ficha && ficha.id === actual ? ficha : null;

  async function cambiarEstado(status: "ACTIVE" | "INACTIVE") {
    if (!p) return;
    const ok = await confirmAction(status === "INACTIVE" ? {
      title: `Inactivar ${p.name}`,
      message: "El producto y sus variantes dejan de venderse en pedidos, mostrador y la web (RN-CAT-11). No se borra: se puede volver a activar.",
      confirmLabel: "Inactivar", danger: true,
    } : { title: `Activar ${p.name}`, message: "El producto vuelve a estar disponible. Sus variantes se activan desde CAT-03.", confirmLabel: "Activar" });
    if (!ok) return;
    setCambiando(true);
    try {
      await api(`/v1/cat/productos/${p.id}/estado`, { method: "PUT", body: { status } });
      toast.ok(status === "ACTIVE" ? "Producto activado" : "Producto inactivado");
      setVersion((n) => n + 1);
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setCambiando(false);
    }
  }

  const tabs: { key: Pestana; label: string; count?: number }[] = [
    { key: "variantes", label: "Variantes y cortes", count: p?.variantes.length },
    { key: "precios", label: "Precios por lista", count: p?.precios.length },
    ...(p?.product_type === "COMBO" ? [{ key: "componentes" as const, label: "Componentes del combo", count: p.componentes.length }] : []),
    { key: "historial", label: "Historial" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Marca, tipo, origen, conservación, lote, IGV, código SUNAT, registro sanitario y si admite descuento. Sus variantes, precios por lista e historial."
        actions={<>
          <div className="w-full sm:w-[300px]">
            <Select aria-label="Producto" value={actual} onChange={(e) => ir(e.target.value)} placeholder="Elige un producto"
              options={productos.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }))} />
          </div>
          {puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setForm({ modo: "nuevo" })}>Nuevo producto</Button>}
        </>} />

      {error && <Alert tone="bad">{error}</Alert>}

      {!p ? (
        !error && <div className="h-40 animate-pulse rounded-xl bg-surface-2" />
      ) : <>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-[18px] font-semibold">{p.name}</h2>
          <StatusBadge status={p.status} labels={ESTADOS} />
          <div className="ml-auto flex flex-wrap gap-2">
            {puedeEditar && <Button size="sm" icon={Pencil} onClick={() => setForm({ modo: "editar" })}>Editar</Button>}
            {puedeEditar && <Button size="sm" icon={Copy} onClick={() => setForm({ modo: "copiar" })}>Copiar a otra marca</Button>}
            {puedeEditar && p.status === "ACTIVE" && <Button size="sm" variant="danger" icon={CircleOff} loading={cambiando} onClick={() => cambiarEstado("INACTIVE")}>Inactivar</Button>}
            {puedeEditar && p.status !== "ACTIVE" && <Button size="sm" icon={CircleCheck} loading={cambiando} onClick={() => cambiarEstado("ACTIVE")}>Activar</Button>}
          </div>
        </div>

        {p.status === "ACTIVE" && ["EXPIRED", "MISSING"].includes(p.sanitario.code) && (
          <Alert tone="bad" title={p.sanitario.code === "EXPIRED" ? "Registro sanitario vencido" : "Sin registro sanitario"}>
            No se publica en la web y el pedido muestra la alerta (RN-CAT-09). Renuévalo en Registros sanitarios (CAT-10).
          </Alert>
        )}
        {p.lotes.length > 0 && (
          <Alert tone="warn" title="Lotes bloqueados por almacén o calidad">
            {p.lotes.map((l) => `${l.code} (${l.block_reason ?? l.qc_status})`).join("; ")}. El producto sigue activo; esos lotes no se despachan.
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta titulo="Datos del producto">
            <DetailList items={[
              { label: "Código", value: <span className="font-mono">{p.code}</span> },
              { label: "Marca", value: p.brand_name ? <Badge tone="primary">{p.brand_name}</Badge> : "—" },
              { label: "Categoría", value: p.category_name ?? "—" },
              { label: "Línea", value: etiqueta(LINEAS, p.line) },
              { label: "Tipo", value: etiqueta(TIPOS_PRODUCTO, p.product_type) },
              { label: "Origen", value: etiqueta(ORIGENES, p.origin) },
              { label: "Almacenamiento", value: etiqueta(ALMACENAMIENTO, p.storage) },
              { label: "Vida útil", value: p.shelf_life_days ? `${numero(p.shelf_life_days)} días` : "—" },
              { label: "Control por lote", value: p.requires_lot ? "Sí" : "No" },
              { label: "Afectación del IGV", value: etiqueta(AFECTACION_IGV, p.igv_affectation) },
              { label: "Código SUNAT", value: p.sunat_product_code ? <span className="font-mono">{p.sunat_product_code}</span> : "—" },
              { label: "Admite descuento", value: p.allow_discount === false ? <Badge tone="warn">No (RN-CAT-10)</Badge> : "Sí" },
              { label: "Con ventas", value: p.tiene_ventas ? "Sí" : "No" },
            ]} />
          </Tarjeta>
          <Tarjeta titulo="Registro sanitario y web">
            <DetailList items={[
              { label: "Autoridad", value: etiqueta(AUTORIDADES, p.sanitary_authority) },
              { label: "Número", value: p.sanitary_registry ? <span className="font-mono">{p.sanitary_registry}</span> : "—" },
              { label: "Vencimiento", value: fecha(p.sanitary_registry_expires) },
              { label: "Semáforo", value: p.sanitario.code === "NA" ? "No requiere" : <Badge tone={p.sanitario.tone}>{p.sanitario.label}</Badge> },
              { label: "Certificado", value: p.sanitary_certificate ?? "—" },
              { label: "Publicado en la web", value: p.web_publishable ? "Sí" : "No" },
              { label: "Título web", value: p.web_title ?? "—" },
              { label: "Sincronización", value: p.web_sync_status ? SINCRONIZACION[p.web_sync_status] ?? p.web_sync_status : "—" },
            ]} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/m/cat/cat-10" className="text-[13px] text-primary hover:underline">Registros sanitarios</Link>
              <span className="text-muted">·</span>
              <Link href="/m/cat/cat-09" className="text-[13px] text-primary hover:underline">Publicación web</Link>
            </div>
          </Tarjeta>
        </div>

        <Tabs value={pestana} onChange={setPestana} tabs={tabs} />
        {pestana === "variantes" && <Variantes filas={p.variantes} />}
        {pestana === "precios" && <Precios ficha={p} />}
        {pestana === "componentes" && <Componentes ficha={p} />}
        {pestana === "historial" && <Historial ficha={p} />}
      </>}

      {form && (
        <ProductoForm producto={form.modo === "editar" ? p : null} copiarDe={form.modo === "copiar" ? p : null} categorias={categorias}
          onClose={() => setForm(null)}
          onGuardado={(nuevoId) => { setForm(null); if (nuevoId === actual) setVersion((n) => n + 1); else ir(nuevoId); }} />
      )}
    </div>
  );
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="mb-3 text-[14px] font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Variantes({ filas }: { filas: VarianteFicha[] }) {
  const columnas: Column<VarianteFicha>[] = [
    { key: "sku", header: "SKU", render: (v) => <span className="font-mono font-semibold">{v.sku}</span> },
    { key: "name", header: "Presentación", cardTitle: true, render: (v) => <div><div>{v.name}</div><div className="text-[12px] text-muted">{v.cut_name ?? "Sin corte"}</div></div> },
    { key: "sale_mode", header: "Modo de venta", render: (v) => <Badge tone={v.sale_mode === "UNIT_VARIABLE_WEIGHT" ? "primary" : v.sale_mode === "KG" ? "info" : "neutral"}>{etiqueta(MODOS_VENTA, v.sale_mode)}</Badge> },
    { key: "peso", header: "Peso nominal", align: "right", hideOnMobile: true, render: (v) => v.nominal_weight_kg ? kg(v.nominal_weight_kg) : <span className="text-muted">—</span> },
    { key: "scale_plu", header: "PLU", hideOnMobile: true, render: (v) => v.scale_plu ? <span className="font-mono">{v.scale_plu}</span> : <span className="text-muted">—</span> },
    { key: "precio", header: "Precio WhatsApp", align: "right", render: (v) => v.precio_whatsapp
      ? <span className="whitespace-nowrap tabular-nums">{soles(v.precio_whatsapp.price)}{v.precio_whatsapp.basis === "KG" ? "/kg" : ""}</span>
      : v.sellable ? <Badge tone="bad">Sin precio</Badge> : <span className="text-muted">No se vende</span> },
    { key: "status", header: "Estado", render: (v) => <StatusBadge status={v.status} labels={{ ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] }} /> },
  ];
  return <DataTable columns={columnas} rows={filas} empty="Este producto todavía no tiene variantes. Se crean en Variantes y cortes (CAT-03)." />;
}

function Precios({ ficha }: { ficha: FichaProducto }) {
  type Fila = FichaProducto["precios"][number];
  const columnas: Column<Fila>[] = [
    { key: "sku", header: "SKU", render: (r) => <span className="font-mono">{r.sku}</span> },
    { key: "list_name", header: "Lista", cardTitle: true, render: (r) => <span>{r.list_name}{r.list_status !== "ACTIVE" && <span className="ml-1.5"><Badge>Borrador</Badge></span>}</span> },
    { key: "priority", header: "Prioridad", align: "right", hideOnMobile: true },
    { key: "price", header: "Precio", align: "right", render: (r) => <span className="whitespace-nowrap tabular-nums">{soles(r.price)}{r.basis === "KG" ? "/kg" : ""}</span> },
    { key: "min_qty", header: "Desde", align: "right", hideOnMobile: true, render: (r) => Number(r.min_qty) > 0 ? numero(r.min_qty, 2) : <span className="text-muted">—</span> },
    { key: "valid_from", header: "Vigente desde", render: (r) => fecha(r.valid_from) },
    { key: "valid_to", header: "Hasta", render: (r) => r.valid_to ? fecha(r.valid_to) : <span className="text-muted">Sin fin</span> },
  ];
  return <DataTable columns={columnas} rows={ficha.precios} empty="Sin precios vigentes hoy en las listas de su marca. Se cargan en Precios de la lista (CAT-06)." />;
}

function Componentes({ ficha }: { ficha: FichaProducto }) {
  type Fila = FichaProducto["componentes"][number];
  const columnas: Column<Fila>[] = [
    { key: "combo_sku", header: "Combo", render: (r) => <span className="font-mono">{r.combo_sku}</span> },
    { key: "name", header: "Componente", cardTitle: true, render: (r) => <div><div>{r.name}</div><div className="font-mono text-[12px] text-muted">{r.sku}</div></div> },
    { key: "qty", header: "Cantidad", align: "right", render: (r) => numero(r.qty, 3) },
    { key: "est_weight_kg", header: "Peso estimado", align: "right", render: (r) => r.est_weight_kg ? kg(r.est_weight_kg) : <span className="text-muted">—</span> },
    { key: "price_share_pct", header: "Parte del precio", align: "right", render: (r) => porcentaje(r.price_share_pct, 1) },
  ];
  return <DataTable columns={columnas} rows={ficha.componentes} empty="El combo no tiene componentes. Se arman en Combos (CAT-08)." />;
}

function Historial({ ficha }: { ficha: FichaProducto }) {
  if (!ficha.historial.length) return <p className="text-[13px] text-muted">Sin cambios registrados. Los cambios de precio están en Historial de precios (CAT-12).</p>;
  return (
    <ol className="space-y-3">
      {ficha.historial.map((h) => (
        <li key={h.id} className="rounded-lg border border-line bg-surface px-4 py-3">
          <div className="text-[12px] text-muted">{fechaHora(h.changed_at)} · {h.user_name ?? "Sistema"}</div>
          <div className="text-[13.5px]">
            {ACCIONES[h.action]} {h.table_name === "products" ? "el producto" : "la variante"} <span className="font-mono">{h.ref}</span>
            {h.changed_columns && <span className="text-muted"> · {String(h.changed_columns).replace(/[{}]/g, "").split(",").join(", ")}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
