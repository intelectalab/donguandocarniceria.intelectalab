"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Gauge, Link2, Link2Off, PackagePlus } from "lucide-react";
import {
  Alert, Badge, Button, Cifra, DataTable, DetailList, FiltroSelect, Modal, PageHeader, StatusBadge, Switch, confirmAction, toast,
  type Column,
} from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { FormVincular } from "@/modulos/web/FormVincular";
import { ESTADO_MAPEO, ElegirTienda, Historial, PROBLEMA, Seccion, Vacio, cuando, useDatos, useTienda, type Historia, type TiendaCorta } from "@/modulos/web/comunes";

type Mapeo = {
  id: string; sku: string; woo_product_id: number; woo_variation_id: number | null; woo_name: string | null; variant_id: string | null; variante: string | null;
  variante_sku: string | null; sale_mode: string | null; unidad: string | null; brand_id: string | null; marca: string | null; publish: boolean; web_status: string | null;
  status: string; remote_missing: boolean; last_error: string | null; last_price_sent: number | null; last_price_at: string | null; last_stock_sent: number | null;
  last_stock_at: string | null; precio: number | null; stock: number | null; problemas: string[];
};
type Detalle = Mapeo & {
  precio_detalle?: string | null; stock_detalle?: string; variante_activa?: boolean; publicable?: boolean; store_id: string; tienda: string; linked_at: string | null;
  linked_by: string | null; history: Historia[]; puede_editar: boolean;
};
type Faltante = { id: string; sku: string; name: string; marca: string | null; unidad: string; precio: number | null; lista: string | null; stock: number };
type Resumen = {
  cifras: { vinculados: number; publicados: number; sin_vinculo: number; con_error: number; sin_producto: number; kpi: { valor: number; numerador: number; denominador: number } };
  marcas: { id: string; name: string }[]; faltan: Faltante[]; puede_editar: boolean;
};

/** WEB-02 Mapeo de productos: cada SKU de WooCommerce con su variante del catálogo, el último precio y stock enviados y qué falta. */
export default function Mapeo() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const params = useSearchParams();
  const inicial = params.get("id");
  const { datos: ts } = useDatos<{ data: TiendaCorta[] }>("/v1/web/tiendas");
  const [tienda, setTienda] = useTienda(ts?.data, params.get("store"));
  const [f, setF] = useState({ estado: "", marca: "", problema: "" });
  const [abierto, setAbierto] = useState<string | null>(inicial);
  const [vinculando, setVinculando] = useState<{ sku?: string } | null>(null);
  const [creando, setCreando] = useState<string | null>(null);
  const filtros = { store: tienda, ...f };
  const lista = useListado<Mapeo>("/v1/web/mapeos", { orden: "sku", filtros });
  const { datos: r, recargar: recargarResumen } = useDatos<Resumen>(tienda ? `/v1/web/mapeos?store=${tienda}&per_page=1` : null);
  const recargar = () => { lista.recargar(); recargarResumen(); };
  const c = r?.cifras;

  async function crear(v: Faltante) {
    if (!(await confirmAction({ title: `¿Crear ${v.name} en la web?`, message: `Se crea en WooCommerce con ${v.precio ? soles(v.precio) : "su precio"} y el stock publicado, y queda vinculado.`, confirmLabel: "Crear" }))) return;
    setCreando(v.id);
    try {
      await api("/v1/web/mapeos/crear", { method: "POST", body: { store_id: tienda, variant_id: v.id } });
      toast.ok(`${v.name} creado en la web.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCreando(null);
    }
  }

  function cerrar() {
    setAbierto(null);
    if (inicial) router.replace("/m/web/web-02");
  }

  const columnas: Column<Mapeo>[] = [
    { key: "sku", header: "SKU de la web", sortable: true, cardTitle: true, render: (m) => (
      <div className="min-w-0"><div className="font-medium">{m.sku}</div><div className="truncate text-[12px] text-muted">{m.woo_name ?? "—"}{m.woo_product_id ? ` · #${m.woo_product_id}` : ""}</div></div>
    ) },
    { key: "variante", header: "Variante del catálogo", sortable: true, render: (m) => m.variante
      ? <div className="min-w-0"><div className="truncate">{m.variante}</div><div className="text-[12px] text-muted">{m.variante_sku}{m.marca ? ` · ${m.marca}` : ""}</div></div>
      : <span className="text-warn">Sin vincular</span> },
    { key: "precio", header: "Precio web", sortable: true, align: "right", render: (m) => (
      <div className="text-right"><div className="tabular-nums">{m.precio !== null ? soles(m.precio) : "—"}</div>
        {m.last_price_sent !== null && m.precio !== null && Math.abs(m.last_price_sent - m.precio) > 0.004 && <div className="text-[11.5px] text-warn">enviado {soles(m.last_price_sent)}</div>}</div>
    ) },
    { key: "stock", header: "Stock", sortable: true, align: "right", render: (m) => (
      <div className="text-right"><div className="tabular-nums">{m.stock ?? "—"}</div>
        {m.last_stock_sent !== null && m.stock !== null && m.last_stock_sent !== m.stock && <div className="text-[11.5px] text-warn">enviado {m.last_stock_sent}</div>}</div>
    ) },
    { key: "problemas", header: "Pendiente", hideOnMobile: true, render: (m) => m.problemas.length
      ? <div className="flex flex-wrap gap-1">{m.problemas.map((p) => <Badge key={p} tone={p === "ERROR" || p === "PRICE_MISSING" ? "bad" : "warn"}>{PROBLEMA[p] ?? p}</Badge>)}</div>
      : <span className="text-[12.5px] text-muted">{m.status === "UNLINKED" ? "—" : m.publish ? "Al día" : "No publicado"}</span> },
    { key: "status", header: "Estado", sortable: true, render: (m) => <StatusBadge status={m.status} labels={ESTADO_MAPEO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada producto de WooCommerce se traduce por su SKU a una variante del catálogo: un pedido con un SKU sin vínculo no se crea (RN-WEB-03). Aquí se vincula, se publica y se crea en la web lo que falta."
        actions={<>
          <ElegirTienda tiendas={ts?.data ?? []} value={tienda} onChange={setTienda} />
          {r?.puede_editar && <Button variant="primary" icon={Link2} onClick={() => setVinculando({})}>Vincular SKU</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Vinculados" icono={Link2} destacada valor={c ? numero(c.vinculados) : undefined} detalle={c ? `${numero(c.publicados)} publicados` : undefined} />
        <Cifra titulo="Sin vínculo" icono={Link2Off} tono={c && c.sin_vinculo > 0 ? "warn" : undefined} valor={c ? numero(c.sin_vinculo) : undefined} detalle="SKU de la web sin variante" />
        <Cifra titulo="Con error" icono={AlertTriangle} tono={c && c.con_error > 0 ? "bad" : undefined} valor={c ? numero(c.con_error) : undefined} detalle="WooCommerce rechazó el envío" />
        <Cifra titulo="Desactualizados" icono={Gauge} tono={c && c.kpi.valor > 10 ? "warn" : undefined} valor={c ? porcentaje(c.kpi.valor, 1) : undefined}
          detalle={c ? `${c.kpi.numerador} de ${c.kpi.denominador} con error o precio o stock por enviar` : undefined} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(m) => setAbierto(m.id)} empty="No hay SKU con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "SKU, producto o variante…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => setF((x) => ({ ...x, estado: v }))} options={Object.entries(ESTADO_MAPEO).map(([value, [label]]) => ({ value, label }))} />
          {(r?.marcas.length ?? 0) > 1 && (
            <FiltroSelect etiqueta="Marca" todos="todas" value={f.marca} onChange={(v) => setF((x) => ({ ...x, marca: v }))} options={(r?.marcas ?? []).map((m) => ({ value: m.id, label: m.name }))} ancho={190} />
          )}
          <FiltroSelect etiqueta="Pendiente" value={f.problema} onChange={(v) => setF((x) => ({ ...x, problema: v }))} options={[{ value: "SI", label: "Con algo pendiente" }, { value: "NO", label: "Al día" }]} ancho={190} />
        </>} />
      {(r?.faltan.length ?? 0) > 0 && (
        <Seccion titulo={`Del catálogo y sin producto en la web (${r?.faltan.length})`}>
          <p className="mb-3 text-[12.5px] text-muted">Variantes marcadas para la web en Catálogo que la tienda todavía no tiene.</p>
          <ul className="divide-y divide-line">
            {r?.faltan.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13.5px]">
                <div className="min-w-0">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-[12px] text-muted">{v.sku}{v.marca ? ` · ${v.marca}` : ""} · {v.precio !== null ? `${soles(v.precio)} por ${v.unidad}` : "sin precio en la lista"} · stock {v.stock}</div>
                </div>
                {r.puede_editar && (
                  <div className="flex gap-2">
                    <Button size="sm" icon={Link2} onClick={() => setVinculando({ sku: v.sku })}>Vincular</Button>
                    <Button size="sm" icon={PackagePlus} loading={creando === v.id} disabled={v.precio === null} onClick={() => crear(v)}>Crear en la web</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Seccion>
      )}
      {abierto && <FichaMapeo id={abierto} onClose={cerrar} onCambio={recargar} onVincular={(sku) => setVinculando({ sku })} />}
      {vinculando && tienda && <FormVincular tienda={tienda} sku={vinculando.sku} onClose={() => setVinculando(null)} onListo={() => { setVinculando(null); recargar(); }} />}
    </div>
  );
}

function FichaMapeo({ id, onClose, onCambio, onVincular }: { id: string; onClose: () => void; onCambio: () => void; onVincular: (sku: string) => void }) {
  const { datos: m, error, recargar } = useDatos<Detalle>(`/v1/web/mapeos/${id}`);
  const [trabajando, setTrabajando] = useState(false);

  async function publicar(si: boolean) {
    setTrabajando(true);
    try {
      await api(`/v1/web/mapeos/${id}/publicar`, { method: "POST", body: { publish: si } });
      toast.ok(si ? "Publicado: sale en la próxima corrida de catálogo." : "Retirado de la web.");
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function desvincular() {
    if (!m) return;
    const r = await confirmAction({ title: `¿Desvincular ${m.sku}?`, message: "Los pedidos web con este SKU quedarán con error hasta volver a vincularlo.", confirmLabel: "Desvincular", danger: true, reason: { label: "Motivo", min: 10 } });
    if (!r) return;
    try {
      await api(`/v1/web/mapeos/${id}/desvincular`, { method: "POST", body: { reason: r.reason } });
      toast.ok("SKU desvinculado.");
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  return (
    <Modal open onClose={onClose} title={m ? m.sku : "SKU"} description={m ? `${m.tienda}${m.woo_name ? ` · ${m.woo_name}` : ""}` : undefined} size="lg"
      footer={<>
        {m?.puede_editar && m.status !== "UNLINKED" && <Button variant="danger" icon={Link2Off} onClick={desvincular}>Desvincular</Button>}
        {m?.puede_editar && <Button icon={Link2} onClick={() => onVincular(m.sku)}>{m.status === "UNLINKED" ? "Vincular" : "Cambiar variante"}</Button>}
        <Button variant="primary" onClick={onClose}>Cerrar</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!m ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={m.status} labels={ESTADO_MAPEO} />
            {m.problemas.map((p) => <Badge key={p} tone={p === "ERROR" || p === "PRICE_MISSING" ? "bad" : "warn"}>{PROBLEMA[p] ?? p}</Badge>)}
          </div>
          {m.last_error && <Alert tone="bad" title="Último error de WooCommerce">{m.last_error}</Alert>}
          {m.status !== "UNLINKED" && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
              <div className="text-[13.5px]">
                <div className="font-medium">Publicado en la web</div>
                <div className="text-[12.5px] text-muted">{m.publish ? "Visible en la tienda" : "Queda como borrador (no visible)"}</div>
              </div>
              <Switch label="Publicado en la web" checked={m.publish} disabled={!m.puede_editar || trabajando} onChange={publicar} />
            </div>
          )}
          <DetailList items={[
            { label: "Variante", value: m.variante ? `${m.variante} (${m.variante_sku})` : "Sin vincular" },
            { label: "Marca", value: m.marca ?? "—" },
            { label: "Producto en WooCommerce", value: m.woo_product_id ? `#${m.woo_product_id}${m.woo_variation_id ? ` · variación ${m.woo_variation_id}` : ""}` : "Por ubicar (se busca por SKU en la próxima corrida)" },
            { label: "Precio web vigente", value: m.precio_detalle ?? (m.status === "UNLINKED" ? "—" : "Sin precio en la lista de la tienda") },
            { label: "Último precio enviado", value: m.last_price_sent !== null ? `${soles(m.last_price_sent)} · ${cuando(m.last_price_at)}` : "—" },
            { label: "Stock publicado", value: m.stock_detalle ?? "—" },
            { label: "Último stock enviado", value: m.last_stock_sent !== null ? `${m.last_stock_sent} · ${cuando(m.last_stock_at)}` : "—" },
            { label: "Vinculado por", value: m.linked_by ? `${m.linked_by} · ${cuando(m.linked_at)}` : "—" },
          ]} />
          {m.variante_activa === false && <Alert tone="warn">La variante está inactiva o no se vende: los pedidos con este SKU quedan con error (VARIANT_INACTIVE).</Alert>}
          {m.publicable === false && m.status !== "UNLINKED" && <Alert tone="info">La variante no está marcada para la web en Catálogo (Publicación web): no se publica.</Alert>}
          <Seccion titulo="Historial"><Historial items={m.history} /></Seccion>
        </div>
      )}
    </Modal>
  );
}
