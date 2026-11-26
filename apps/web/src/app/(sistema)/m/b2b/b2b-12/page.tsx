"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { Alert, Badge, Button, Input, PageHeader, StatusBadge } from "@/components/ui";
import { fecha, numero, soles } from "@/lib/formato";
import { Cifras, CifraLink, FiltroSelect, Panel, Sub, qs, useDatos } from "@/modulos/canales/comunes";
import { useCarrito } from "@/modulos/b2b/carrito";
import { ESTADO_PEDIDO, type Resumen } from "@/modulos/b2b/tipos";

type Producto = { id: string; sku: string; name: string; sale_mode: string; nominal_weight_kg: string | null; brand_id: string; brand_name: string; price: number; basis: string; list_price: number; own_price: boolean };
type Portada = { customer: { full_name: string }; role_label: string; account: { can_order: boolean; can_view_statement: boolean }; credit: Resumen | null; earliest_date: string; cutoff: string;
  min_order: number; open_orders: number; open_claims: number; last_orders: { id: string; number: string; status: string; delivery_date: string; estimated_total: string; brand_name: string }[] };

/** B2B-12 Portal · Catálogo: productos con el precio pactado de la empresa, fecha mínima de entrega y carrito. */
export default function Catalogo() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [marca, setMarca] = useState("");
  const p = useDatos<Portada>("/v1/b2b/portal/resumen");
  const c = useDatos<{ data: Producto[]; earliest_date: string }>(`/v1/b2b/portal/catalogo${qs({ q })}`);
  const carrito = useCarrito();
  const d = p.datos;
  const marcas = [...new Map((c.datos?.data ?? []).map((x) => [x.brand_id, x.brand_name])).entries()];
  const filas = (c.datos?.data ?? []).filter((x) => !marca || x.brand_id === marca);
  const enCarrito = (id: string) => carrito.items.find((x) => x.variant_id === id)?.qty ?? 0;
  const poner = (x: Producto, qty: number) => carrito.poner({ variant_id: x.id, name: x.name, sku: x.sku, sale_mode: x.sale_mode, price: x.price, basis: x.basis, qty: Math.max(0, Math.round(qty * 1000) / 1000),
    nominal_kg: x.nominal_weight_kg ? Number(x.nominal_weight_kg) : null, cut_notes: carrito.items.find((y) => y.variant_id === x.id)?.cut_notes ?? "" });
  const paso = (x: Producto) => (x.sale_mode === "KG" ? 0.5 : 1);

  return (
    <div className="space-y-5">
      <PageHeader code={d ? `${d.customer.full_name} · ${d.role_label}` : undefined}
        description={d ? `Pide antes de las ${d.cutoff} y te entregamos desde el ${fecha(d.earliest_date)}. Pedido mínimo ${soles(d.min_order)}. Los precios son los pactados con tu empresa.` : undefined}
        actions={d?.account.can_order && <Button variant="primary" icon={ShoppingCart} onClick={() => router.push("/m/b2b/b2b-13")}>Ver carrito ({carrito.items.length}) · {soles(carrito.total)}</Button>} />
      {p.error && <Alert tone="bad">{p.error}</Alert>}
      {d?.credit?.status === "BLOCKED" && <Alert tone="bad" title="Tu crédito está bloqueado">Puedes pedir, pero el pedido queda por confirmar hasta regularizar el pago. Revisa tu <Link className="underline" href="/m/b2b/b2b-15">estado de cuenta</Link>.</Alert>}
      {d && <Cifras>
        <CifraLink destacada titulo="Disponible para pedir" valor={d.credit ? soles(d.credit.available) : "Pago al contado"} detalle={d.credit ? `Línea de ${soles(d.credit.credit_limit)}` : "Transferencia antes de la entrega"} />
        <CifraLink titulo="Por pagar" valor={d.credit ? soles(d.credit.balance) : "—"} detalle={d.credit?.overdue ? `${soles(d.credit.overdue)} vencido` : "Al día"} tono={d.credit?.overdue ? "warn" : "ok"} href={d.account.can_view_statement ? "/m/b2b/b2b-15" : undefined} />
        <CifraLink titulo="Pedidos en curso" valor={numero(d.open_orders)} href="/m/b2b/b2b-14" />
        <CifraLink titulo="Reclamos abiertos" valor={numero(d.open_claims)} href="/m/b2b/b2b-16" tono={d.open_claims ? "warn" : undefined} />
      </Cifras>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input aria-label="Buscar" placeholder="Buscar producto…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-[280px]" />
        <FiltroSelect label="Marca" value={marca} onChange={setMarca} options={marcas.map(([value, label]) => ({ value, label }))} />
      </div>
      {c.cargando && <p className="text-sm text-muted">Cargando catálogo…</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filas.map((x) => {
          const n = enCarrito(x.id);
          return (
            <li key={x.id} className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <div className="flex items-start justify-between gap-2"><p className="font-semibold">{x.name}</p>{x.own_price && <Badge tone="info">Precio pactado</Badge>}</div>
                <Sub>{x.brand_name} · {x.sku}{x.sale_mode === "UNIT" && x.nominal_weight_kg ? ` · ${numero(x.nominal_weight_kg, 3)} kg aprox.` : ""}</Sub>
                <p className="mt-2 text-[18px] font-bold">{soles(x.price)} <span className="text-[13px] font-normal text-muted">por {x.basis === "KG" ? "kg" : "unidad"}</span></p>
                {x.own_price && x.list_price !== x.price && <Sub>Lista {soles(x.list_price)}</Sub>}
              </div>
              {d?.account.can_order && <div className="mt-3 flex items-center gap-2">
                {n > 0 ? <>
                  <Button size="sm" icon={Minus} aria-label="Quitar" onClick={() => poner(x, n - paso(x))} />
                  <Input aria-label={`Cantidad de ${x.name}`} inputMode="decimal" className="w-20 text-center" value={String(n)} onChange={(e) => poner(x, Number(e.target.value.replace(",", ".")) || 0)} />
                  <Button size="sm" icon={Plus} aria-label="Agregar" onClick={() => poner(x, n + paso(x))} />
                  <span className="text-[12.5px] text-muted">{x.sale_mode === "KG" ? "kg" : "unid."}</span>
                </> : <Button size="sm" icon={Plus} onClick={() => poner(x, x.sale_mode === "KG" ? 1 : 1)}>Agregar</Button>}
              </div>}
            </li>
          );
        })}
      </ul>
      {d && d.last_orders.length > 0 && <Panel titulo="Tus últimos pedidos" acciones={<Link className="text-[13px] text-primary underline" href="/m/b2b/b2b-14">Ver todos</Link>}>
        <ul className="divide-y divide-line text-[13.5px]">{d.last_orders.map((o) => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><span className="font-mono">{o.number}</span> · {o.brand_name} · entrega {fecha(o.delivery_date)}</span>
          <span className="flex items-center gap-2"><StatusBadge status={o.status} labels={ESTADO_PEDIDO} /><span className="tabular-nums">{soles(o.estimated_total)}</span>
            {d.account.can_order && <Button size="sm" variant="ghost" onClick={() => router.push(`/m/b2b/b2b-13?repetir=${o.id}`)}>Repetir</Button>}</span></li>)}</ul>
      </Panel>}
    </div>
  );
}
