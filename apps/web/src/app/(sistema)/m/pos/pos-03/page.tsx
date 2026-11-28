"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Scale, Search } from "lucide-react";
import { Alert, Button, Input, PageHeader, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, soles } from "@/lib/formato";
import { cambiarCarrito, claveLinea, useCarrito } from "@/modulos/pos/carrito";
import { MODOS_BALANZA, esPeso, type Producto } from "@/modulos/pos/tipos";
import { Seccion, Vacio } from "@/modulos/pos/Seccion";
import { TecladoPeso } from "@/modulos/pos/TecladoPeso";
import { useContexto } from "@/modulos/pos/useContexto";

type Respuesta = { caja: { id: string; name: string; scale_mode: "MANUAL" | "SCALE" | "LABEL" }; productos: Producto[] };

/**
 * POS-03 Ingreso de peso: teclado con 3 decimales y el rango aceptado de la variante (RN-POS-04). En la
 * venta se abre solo al tocar un producto por peso; aquí se elige el producto y el peso va al carrito.
 */
export default function IngresoPeso() {
  const router = useRouter();
  const { ctx } = useContexto();
  const carrito = useCarrito();
  const [q, setQ] = useState("");
  const [datos, setDatos] = useState<{ q: string; r?: Respuesta; error?: string } | null>(null);
  const [producto, setProducto] = useState<Producto | null>(null);

  useEffect(() => {
    let vigente = true;
    const t = setTimeout(() => {
      api<Respuesta>(`/v1/pos/productos${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((r) => vigente && setDatos({ q, r }))
        .catch((e) => vigente && setDatos({ q, error: mensajeDe(e) }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  const lista = (datos?.r?.productos ?? []).filter((p) => esPeso(p.sale_mode) && p.precio !== null);
  const modo = datos?.r?.caja.scale_mode ?? "MANUAL";
  const pesadas = carrito.lineas.filter((l) => esPeso(l.sale_mode));

  return (
    <div className="space-y-4">
      <PageHeader code="POS-03" description={`Peso en kg con 3 decimales y el rango aceptado de la variante. Modo de la caja: ${MODOS_BALANZA[modo]}.`}
        actions={<Button icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-02")}>Volver a la venta</Button>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Producto por peso">
          <div className="relative mb-3">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cuy, conejo, pierna…" aria-label="Buscar producto" className="pl-9" />
          </div>
          {datos?.error && <Alert tone="bad">{datos.error}</Alert>}
          {!datos && <Vacio>Cargando productos…</Vacio>}
          {datos?.r && lista.length === 0 && <Vacio>No hay productos por peso con esa búsqueda.</Vacio>}
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {lista.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => setProducto(p)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-2.5 text-left hover:bg-surface-2 ${producto?.id === p.id ? "bg-primary-soft" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-ink">{p.name}</span>
                    <span className="block text-[12px] text-muted">
                      {p.marca}{p.min_weight_kg !== null && p.max_weight_kg !== null ? ` · ${kg(p.min_weight_kg)} a ${kg(p.max_weight_kg)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">{soles(p.precio)}/kg</span>
                </button>
              </li>
            ))}
          </ul>
        </Seccion>
        <Seccion titulo="Peso">
          {!producto ? (
            <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-muted"><Scale size={26} />Elige un producto.</div>
          ) : (
            <TecladoPeso key={producto.id} producto={producto} modo={modo} puedeForzar={Boolean(ctx?.puede.peso_fuera_de_rango)}
              onCancelar={() => setProducto(null)}
              onAceptar={(p) => {
                cambiarCarrito((c) => ({ ...c, lineas: [...c.lineas, {
                  key: claveLinea(), variant_id: producto.id, name: producto.name, sale_mode: producto.sale_mode, weight_kg: p.weight_kg,
                  qty: producto.sale_mode === "UNIT_VARIABLE_WEIGHT" ? p.qty : undefined, weight_source: p.weight_source, barcode: p.barcode, override: p.override || undefined,
                }] }));
                toast.ok(`${producto.name}: ${kg(p.weight_kg)} agregado a la venta.`);
                setProducto(null);
              }} />
          )}
        </Seccion>
      </div>
      {pesadas.length > 0 && (
        <Seccion titulo="Pesados en la venta en curso">
          <ul className="space-y-1 text-[13.5px]">
            {pesadas.map((l) => <li key={l.key} className="flex justify-between"><span>{l.name}</span><span className="tabular-nums">{kg(l.weight_kg)}</span></li>)}
          </ul>
          <div className="mt-3 flex justify-end"><Button variant="primary" onClick={() => router.push("/m/pos/pos-02")}>Ir a la venta</Button></div>
        </Seccion>
      )}
    </div>
  );
}
