"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, Button, PageHeader } from "@/components/ui";
import { kg, soles } from "@/lib/formato";
import { useCarrito } from "@/modulos/pos/carrito";
import { Seccion, SinTurno, Vacio } from "@/modulos/pos/Seccion";
import { esPeso, type VentaHecha } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";
import { CobrarVenta, ResultadoVenta, useCotizacion } from "@/modulos/pos/Venta";

/** POS-04 Cobro: medios mezclados (efectivo con vuelto, tarjeta, Yape o Plin, saldo a favor) sobre la venta en curso. */
export default function Cobro() {
  const router = useRouter();
  const { ctx, error, cargando } = useContexto();
  const carrito = useCarrito();
  const { cot, error: errorCot, cargando: cotizando } = useCotizacion(carrito.lineas);
  const [hecha, setHecha] = useState<VentaHecha | null>(null);

  if (cargando) return <Vacio>Cargando el mostrador…</Vacio>;
  if (error || !ctx) return <Alert tone="bad">{error || "No se pudo cargar el mostrador."}</Alert>;

  return (
    <div className="space-y-4">
      <PageHeader code="POS-04" description="Cobra la venta en curso con uno o varios medios. Solo el efectivo da vuelto; tarjeta, Yape y Plin piden el número de operación."
        actions={<Button icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-02")}>Volver a la venta</Button>} />
      {hecha ? (
        <div className="mx-auto max-w-[560px]"><ResultadoVenta venta={hecha} onNueva={() => router.push("/m/pos/pos-02")} /></div>
      ) : !ctx.turno ? (
        <SinTurno abrir={ctx.puede.abrir} />
      ) : carrito.lineas.length === 0 ? (
        <Alert tone="info">No hay una venta en curso. Agrega productos en Venta.</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Seccion titulo="Resumen">
            <ul className="divide-y divide-line text-[13.5px]">
              {carrito.lineas.map((l, i) => {
                const c = cot?.lineas.find((x) => x.i === i);
                return (
                  <li key={l.key} className="flex justify-between gap-2 py-1.5">
                    <span className="min-w-0">{l.name} <span className="text-muted">· {esPeso(l.sale_mode) ? kg(l.weight_kg) : `${l.qty} u`}</span></span>
                    <span className="shrink-0 tabular-nums">{c ? soles(c.amount) : "…"}</span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 text-[12.5px] text-muted">
              {carrito.doc_type === "INVOICE" ? "Factura" : "Boleta"} · {carrito.cliente ? carrito.cliente.trade_name || carrito.cliente.full_name : "Clientes varios"}
            </div>
          </Seccion>
          <Seccion titulo="Cobro">
            {errorCot && <Alert tone="bad">{errorCot}</Alert>}
            {cotizando && <Vacio>Calculando el total…</Vacio>}
            {cot && <CobrarVenta ctx={ctx} carrito={carrito} total={cot.total} onHecha={setHecha} />}
          </Seccion>
        </div>
      )}
    </div>
  );
}
