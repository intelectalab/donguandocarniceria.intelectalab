"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleOff, Pencil, Plus, Scale, ScanBarcode, Tag, Trash2, Weight } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { VarianteForm } from "@/modulos/cat/VarianteForm";
import { MODOS_VENTA, etiqueta, type Corte, type DetalleVariante, type Producto, type Variante } from "@/modulos/cat/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };
const TONO_MODO: Record<string, Tone> = { UNIT_VARIABLE_WEIGHT: "primary", KG: "info", UNIT: "neutral" };

type Resumen = { peso_variable: number; por_kg: number; por_unidad: number; con_plu: number; tolerancia: number };

/** CAT-03 Variantes y cortes. ?product_id= muestra las de un producto; con &nueva=1 abre el alta. */
export default function Variantes({ searchParams }: PageProps<"/m/cat/cat-03">) {
  const params = use(searchParams);
  const productoId = typeof params.product_id === "string" ? params.product_id : "";
  const router = useRouter();
  const { me, marca, can } = useSesion();
  const puedeEditar = can("cat.product.manage");

  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [modo, setModo] = useState("");
  const [corte, setCorte] = useState("");
  const [estado, setEstado] = useState("");
  const brand = marca !== "ALL" ? marca : marcaFiltro;
  const lista = useListado<Variante>("/v1/cat/variantes", {
    orden: "sku", filtros: { product_id: productoId, brand_id: brand, sale_mode: modo, cut_type_id: corte, status: estado },
  });
  const productos = useListado<Producto>("/v1/cat/productos", { porPagina: 100, orden: "code", filtros: { tipo: "ALL" } }).filas;
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [version, setVersion] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [form, setForm] = useState<{ variante: Variante | null } | null>(() => params.nueva ? { variante: null } : null);

  useEffect(() => {
    let vigente = true;
    api<Corte[]>("/v1/cat/cortes").then((c) => vigente && setCortes(c)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    let vigente = true;
    const q = new URLSearchParams();
    if (brand) q.set("brand_id", brand);
    if (productoId) q.set("product_id", productoId);
    api<Resumen>(`/v1/cat/variantes/resumen?${q}`).then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [brand, productoId, version]);

  const recargar = () => { lista.recargar(); setVersion((n) => n + 1); };
  const producto = productos.find((p) => p.id === productoId);
  const r = resumen;

  const columnas: Column<Variante>[] = [
    { key: "sku", header: "SKU", sortable: true, render: (v) => <span className="whitespace-nowrap font-mono font-semibold">{v.sku}</span> },
    { key: "name", header: "Presentación", sortable: true, cardTitle: true,
      render: (v) => <div className="min-w-[210px]"><div>{v.name}</div><div className="text-[12px] text-muted">{v.cut_name ?? "Sin corte"}{productoId ? "" : ` · ${v.product_name ?? ""}`}</div></div> },
    ...(productoId ? [] : [{ key: "brand_name", header: "Marca", hideOnMobile: true, render: (v: Variante) => v.brand_name ? <Badge tone="primary">{v.brand_name}</Badge> : "—" }]),
    { key: "sale_mode", header: "Modo de venta", sortable: true, render: (v) => <Badge tone={TONO_MODO[v.sale_mode]}>{etiqueta(MODOS_VENTA, v.sale_mode)}</Badge> },
    { key: "pesos", header: "Nominal · mín–máx", align: "right", hideOnMobile: true, render: (v) => v.sale_mode === "UNIT" ? <span className="text-muted">—</span>
      : v.nominal_weight_kg ? <span className="whitespace-nowrap tabular-nums">{numero(v.nominal_weight_kg, 3)} · {numero(v.min_weight_kg, 3)}–{numero(v.max_weight_kg, 3)} kg</span> : "Por kg" },
    { key: "tolerancia", header: "Tol.", align: "right", hideOnMobile: true, render: (v) => v.tolerancia === null ? <span className="text-muted">—</span> : <span className="whitespace-nowrap">{porcentaje(v.tolerancia)}</span> },
    { key: "scale_plu", header: "PLU", hideOnMobile: true, render: (v) => v.scale_plu ? <span className="font-mono">{v.scale_plu}</span> : <span className="text-muted">—</span> },
    { key: "minimo", header: "Mín. · múltiplo", align: "right", hideOnMobile: true,
      render: (v) => <span className="tabular-nums">{numero(v.min_order_qty, v.sale_mode === "KG" ? 2 : 0)} · {numero(v.qty_step, v.sale_mode === "KG" ? 2 : 0)}</span> },
    { key: "precio", header: "Precio WhatsApp", align: "right", render: (v) => !v.sellable ? <span className="text-[12.5px] text-muted">Insumo</span>
      : v.precio_whatsapp ? <span className="whitespace-nowrap tabular-nums">{soles(v.precio_whatsapp.price)}{v.precio_whatsapp.basis === "KG" ? "/kg" : ""}</span>
      : <Badge tone="bad">Sin precio</Badge> },
    { key: "status", header: "Estado", sortable: true, render: (v) => <StatusBadge status={v.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Un SKU por corte o presentación, con su modo de venta (unidad, kg o unidad de peso variable), pesos nominal, mínimo y máximo, tolerancia, código de barras, PLU, mínimo y múltiplo de pedido."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setForm({ variante: null })}>Nueva variante</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Peso variable (por unidad)" icono={Weight} destacada valor={r ? numero(r.peso_variable) : undefined} detalle="Se piden por unidad, se cobran por kg" />
        <Cifra titulo="Por kg" icono={Scale} valor={r ? numero(r.por_kg) : undefined} detalle="Activas y vendibles" />
        <Cifra titulo="Por unidad (precio fijo)" icono={Tag} valor={r ? numero(r.por_unidad) : undefined} detalle="Activas y vendibles" />
        <Cifra titulo="Con PLU de balanza" icono={ScanBarcode} valor={r ? numero(r.con_plu) : undefined} detalle="Únicos entre activas (RN-CAT-04)" />
      </div>

      {productoId && (
        <Alert tone="info">
          Mostrando las variantes de <b>{producto?.name ?? "este producto"}</b>. <Link href="/m/cat/cat-03" className="text-primary underline">Ver todas</Link>
          {" · "}<Link href={`/m/cat/cat-02?id=${productoId}`} className="text-primary underline">Ficha del producto</Link>
        </Alert>
      )}

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar SKU, nombre, código de barras o PLU…" }}
        onRowClick={(v) => setAbierta(v.id)}
        empty="No hay variantes con esos filtros."
        toolbar={<>
          {marca === "ALL" && me.brands.length > 1 && !productoId && (
            <Filtro label="Marca" value={marcaFiltro} onChange={setMarcaFiltro} options={me.brands.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <Filtro label="Modo" value={modo} onChange={setModo} options={MODOS_VENTA} />
          <Filtro label="Corte" value={corte} onChange={setCorte} options={cortes.map((c) => ({ value: c.id, label: c.name }))} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activas" }, { value: "INACTIVE", label: "Inactivas" }]} />
        </>} />

      {abierta && (
        <Detalle id={abierta} puedeEditar={puedeEditar} version={version} onClose={() => setAbierta(null)}
          onEditar={(v) => { setAbierta(null); setForm({ variante: v }); }}
          onCambio={() => recargar()} onBorrada={() => { setAbierta(null); recargar(); }}
          onProducto={(id) => router.push(`/m/cat/cat-02?id=${id}`)} />
      )}
      {form && (
        <VarianteForm variante={form.variante} productoId={productoId} productos={productos} tolerancia={r?.tolerancia ?? 10}
          onClose={() => setForm(null)} onGuardado={(id) => { setForm(null); recargar(); setAbierta(id); }} />
      )}
    </div>
  );
}

/** Panel con la ficha de una variante, sus precios vigentes y las acciones. */
function Detalle({ id, puedeEditar, version, onClose, onEditar, onCambio, onBorrada, onProducto }: {
  id: string; puedeEditar: boolean; version: number; onClose: () => void; onEditar: (v: Variante) => void;
  onCambio: () => void; onBorrada: () => void; onProducto: (id: string) => void;
}) {
  const [v, setV] = useState<DetalleVariante | null>(null);
  const [error, setError] = useState("");
  const [propia, setPropia] = useState(0);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    api<DetalleVariante>(`/v1/cat/variantes/${id}`).then((d) => vigente && setV(d)).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [id, version, propia]);

  async function estado(status: "ACTIVE" | "INACTIVE") {
    if (!v) return;
    setOcupado(true);
    try {
      await api(`/v1/cat/variantes/${v.id}/estado`, { method: "PUT", body: { status } });
      toast.ok(status === "ACTIVE" ? "Variante activada" : "Variante inactivada");
      setPropia((n) => n + 1);
      onCambio();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    if (!v) return;
    const ok = await confirmAction({ title: `Borrar ${v.sku}`, message: "Solo se borra una variante sin ventas ni movimientos (RN-CAT-11). Sus precios se borran con ella.", confirmLabel: "Borrar", danger: true });
    if (!ok) return;
    setOcupado(true);
    try {
      await api(`/v1/cat/variantes/${v.id}`, { method: "DELETE" });
      toast.ok("Variante borrada");
      onBorrada();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  const unidad = v?.sale_mode === "UNIT" ? "u" : "kg";

  return (
    <Modal open onClose={onClose} size="lg" title={v ? `${v.sku} · ${v.name}` : "Variante"}
      footer={v && puedeEditar ? <>
        <Button variant="danger" icon={Trash2} loading={ocupado} onClick={borrar}>Borrar</Button>
        {v.status === "ACTIVE"
          ? <Button icon={CircleOff} loading={ocupado} onClick={() => estado("INACTIVE")}>Inactivar</Button>
          : <Button icon={CircleCheck} loading={ocupado} onClick={() => estado("ACTIVE")}>Activar</Button>}
        <Button variant="primary" icon={Pencil} onClick={() => onEditar(v)}>Editar</Button>
      </> : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!v ? !error && <div className="h-40 animate-pulse rounded-xl bg-surface-2" /> : (
        <div className="space-y-6">
          <DetailList items={[
            { label: "Producto", value: <button type="button" onClick={() => onProducto(v.producto.id)} className="cursor-pointer text-left text-primary hover:underline">{v.producto.code} · {v.producto.name}</button> },
            { label: "Marca", value: v.brand_name ?? "—" },
            { label: "Corte", value: v.cut_name ?? "Sin corte" },
            { label: "Modo de venta", value: <Badge tone={TONO_MODO[v.sale_mode]}>{etiqueta(MODOS_VENTA, v.sale_mode)}</Badge> },
            { label: "Peso nominal", value: v.nominal_weight_kg ? kg(v.nominal_weight_kg) : "—" },
            { label: "Peso mínimo / máximo", value: v.min_weight_kg ? `${kg(v.min_weight_kg)} / ${kg(v.max_weight_kg)}` : "—" },
            { label: "Tolerancia", value: v.tolerancia === null ? "—" : porcentaje(v.tolerancia, 1) },
            { label: "Código de barras", value: v.barcode ? <span className="font-mono">{v.barcode}</span> : "—" },
            { label: "PLU de balanza", value: v.scale_plu ? <span className="font-mono">{v.scale_plu}</span> : "—" },
            { label: "Cantidad mínima · múltiplo", value: `${numero(v.min_order_qty, 3)} · ${numero(v.qty_step, 3)}` },
            { label: "Costo estándar", value: soles(v.std_cost) },
            { label: "Stock", value: `${numero(v.stock, 3)} ${unidad}` },
            { label: "Web", value: v.web_publishable ? "Publicada" : "No" },
            { label: "Estado", value: <StatusBadge status={v.status} labels={ESTADOS} /> },
            { label: "Con movimientos", value: v.con_movimientos ? "Sí: no se borra, se inactiva (RN-CAT-11)" : "No" },
          ]} />
          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Precios vigentes</h3>
            {v.precios.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {v.precios.map((x) => (
                  <li key={x.list_id + (x.min_qty ?? "")} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
                    <span>{x.list_name}{Number(x.min_qty) > 0 && <span className="text-muted"> · desde {numero(x.min_qty, 2)}</span>}</span>
                    <b className="whitespace-nowrap tabular-nums">{soles(x.price)}{x.basis === "KG" ? "/kg" : ""}</b>
                  </li>
                ))}
              </ul>
            ) : v.sellable ? <Alert tone="warn">Sin precio vigente: no se puede vender (RN-CAT-05).</Alert> : <p className="text-[13px] text-muted">Es un insumo: no se vende.</p>}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
