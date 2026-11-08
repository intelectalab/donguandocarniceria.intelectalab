"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Calculator, MessageCircle, Plus, ShieldAlert } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, Tabs, type Column, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ALMACENAMIENTO, LINEAS, etiqueta, type Categoria, type Producto, type ResumenProductos } from "@/modulos/cat/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };

type Pestana = "SALE" | "INPUT" | "ALL";

/** CAT-01 Productos: lo que vende cada marca, una sola vez, con sus variantes, el precio de WhatsApp y el registro sanitario. */
export default function Productos() {
  const router = useRouter();
  const { me, marca, can } = useSesion();
  const [tipo, setTipo] = useState<Pestana>("SALE");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [linea, setLinea] = useState("");
  const [categoria, setCategoria] = useState("");
  const [estado, setEstado] = useState("");
  const [almacen, setAlmacen] = useState("");
  const [web, setWeb] = useState("");
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [resumen, setResumen] = useState<ResumenProductos | null>(null);

  // Con una marca elegida arriba, manda esa; si no, el filtro de la tabla.
  const brand = marca !== "ALL" ? marca : marcaFiltro;
  const lista = useListado<Producto>("/v1/cat/productos", {
    orden: "code",
    filtros: { tipo, brand_id: brand, line: linea, category_id: categoria, status: estado, storage: almacen, web },
  });

  useEffect(() => {
    let vigente = true;
    api<Categoria[]>("/v1/cat/categorias").then((c) => vigente && setCategorias(c)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    let vigente = true;
    const params = new URLSearchParams({ tipo });
    if (brand) params.set("brand_id", brand);
    api<ResumenProductos>(`/v1/cat/productos/resumen?${params}`).then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [tipo, brand]);

  const r = resumen;
  const faltan = r ? r.variantes_vendibles - r.con_precio : 0;

  const columnas: Column<Producto>[] = [
    { key: "code", header: "Código", sortable: true, render: (p) => <span className="font-mono font-semibold">{p.code}</span> },
    {
      key: "name", header: "Producto", sortable: true, cardTitle: true,
      render: (p) => (
        <div className="min-w-0">
          <div>{p.name}</div>
          <div className="text-[12px] text-muted">{etiqueta(LINEAS, p.line)} · {etiqueta(ALMACENAMIENTO, p.storage)}</div>
        </div>
      ),
    },
    { key: "brand_name", header: "Marca", render: (p) => p.brand_name ? <Badge tone="primary">{p.brand_name}</Badge> : <span className="text-muted">—</span> },
    { key: "variantes_activas", header: "Variantes", align: "right", hideOnMobile: true, render: (p) => numero(p.variantes_activas) },
    { key: "precio_whatsapp", header: "Precio WhatsApp", align: "right", render: (p) => <Precio producto={p} /> },
    {
      key: "sanitario", header: "Registro sanitario", hideOnMobile: true,
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.sanitario.code === "NA" ? <span className="text-[12.5px] text-muted">No requiere</span> : <Badge tone={p.sanitario.tone}>{p.sanitario.label}</Badge>}
          {p.lotes_bloqueados > 0 && <Badge tone="bad">{p.lotes_bloqueados === 1 ? "1 lote bloqueado" : `${p.lotes_bloqueados} lotes bloqueados`}</Badge>}
        </div>
      ),
    },
    { key: "web_publishable", header: "Web", hideOnMobile: true, render: (p) => p.web_publishable ? <Badge tone="ok">Publicado</Badge> : <span className="text-muted">No</span> },
    { key: "status", header: "Estado", sortable: true, render: (p) => <StatusBadge status={p.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Lo que vende cada marca, una sola vez: sus variantes, el precio vigente del canal WhatsApp y las alertas de registro sanitario y lotes bloqueados."
        actions={<>
          <Button icon={Calculator} onClick={() => router.push("/m/cat/cat-07")}>Simulador de precio</Button>
          {can("cat.product.manage") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/cat/cat-02?nuevo=1")}>Nuevo producto</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Productos activos" icono={Boxes} destacada valor={r ? numero(r.activos) : undefined} detalle={r ? `${numero(r.en_vista)} en la vista` : ""} />
        <Cifra titulo="Variantes vendibles" icono={Boxes} valor={r ? numero(r.variantes_vendibles) : undefined} detalle="Activas, con SKU" />
        <Cifra titulo="Cobertura de precios WhatsApp" icono={MessageCircle} valor={r ? porcentaje(r.cobertura, 1) : undefined}
          detalle={r ? `${r.con_precio} de ${r.variantes_vendibles} con precio vigente` : ""} tono={r ? (faltan > 0 ? "warn" : "ok") : undefined} />
        <Cifra titulo="Registros por vencer o vencidos" icono={ShieldAlert} valor={r ? numero(r.sanitario_por_vencer) : undefined}
          detalle={r ? `Aviso a ${r.dias_aviso} días` : ""} tono={r ? (r.sanitario_vencidos > 0 ? "bad" : r.sanitario_por_vencer > 0 ? "warn" : "ok") : undefined} />
      </div>

      <Tabs value={tipo} onChange={setTipo} tabs={[
        { key: "SALE", label: "Productos de venta" },
        { key: "INPUT", label: "Insumos, materia prima y empaques" },
        { key: "ALL", label: "Todos" },
      ]} />

      {r && faltan > 0 && tipo !== "INPUT" && (
        <Alert tone="warn" title={`${faltan === 1 ? "1 variante activa" : `${faltan} variantes activas`} sin precio vigente en WhatsApp`}>
          No se pueden vender en ese canal hasta que tengan precio (RN-CAT-05): {r.sin_precio.slice(0, 4).map((v) => v.name).join(", ")}
          {faltan > 4 ? "…" : "."}
        </Alert>
      )}

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar por nombre, código o SKU…" }}
        onRowClick={(p) => router.push(`/m/cat/cat-02?id=${p.id}`)}
        empty="No hay productos con esos filtros."
        toolbar={<>
          {marca === "ALL" && me.brands.length > 1 && (
            <Filtro label="Marca" value={marcaFiltro} onChange={setMarcaFiltro} options={me.brands.map((b) => ({ value: b.id, label: b.name }))} />
          )}
          <Filtro label="Línea" value={linea} onChange={setLinea} options={LINEAS} />
          <Filtro label="Categoría" value={categoria} onChange={setCategoria} options={categorias.map((c) => ({ value: c.id, label: c.name }))} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" }]} />
          <Filtro label="Almacenamiento" value={almacen} onChange={setAlmacen} options={ALMACENAMIENTO} />
          <Filtro label="Web" value={web} onChange={setWeb} options={[{ value: "1", label: "Publicado" }, { value: "0", label: "No publicado" }]} />
        </>} />
    </div>
  );
}

/** Precio vigente de WhatsApp: uno solo o el rango entre sus variantes. */
function Precio({ producto: p }: { producto: Producto }) {
  if (!p.se_vende) return <span className="text-[12.5px] text-muted">No se vende</span>;
  if (!p.precio_whatsapp) return <Badge tone="bad">Sin precio</Badge>;
  const { min, max, basis } = p.precio_whatsapp;
  const sufijo = basis === "KG" ? "/kg" : "";
  return (
    <span className="whitespace-nowrap tabular-nums">
      {min === max ? soles(min) : `${soles(min)} – ${soles(max)}`}{sufijo}
    </span>
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
