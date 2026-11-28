"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Alert, Button, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { lineasApi, vaciarCarrito, type Carrito } from "./carrito";
import { Cobro } from "./Cobro";
import { Tickets } from "./Ticket";
import { Vacio } from "./Seccion";
import type { Comprobante, Contexto, Cotizacion, LineaCarrito, Pago, VentaHecha } from "./tipos";

/** Precios, montos y totales por marca del carrito (sin guardar nada); recalcula al cambiar las líneas. */
export function useCotizacion(lineas: LineaCarrito[]) {
  const [estado, setEstado] = useState<{ clave: string; cot?: Cotizacion; error?: string } | null>(null);
  const clave = JSON.stringify(lineasApi(lineas));

  useEffect(() => {
    const ls = JSON.parse(clave) as unknown[];
    if (!ls.length) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Cotizacion>("/v1/pos/cotizar", { method: "POST", body: { lines: ls } })
        .then((c) => vigente && setEstado({ clave, cot: c }))
        .catch((e) => vigente && setEstado({ clave, error: mensajeDe(e) }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]);

  const vacio = lineas.length === 0;
  const actual = estado?.clave === clave ? estado : null;
  return {
    cot: vacio ? null : actual?.cot ?? null,
    error: vacio ? "" : actual?.error ?? "",
    cargando: !vacio && !actual,
  };
}

/** POS-04: cobra el carrito y emite los comprobantes (uno por marca). */
export function CobrarVenta({ ctx, carrito, total, onHecha }: { ctx: Contexto; carrito: Carrito; total: number; onHecha: (v: VentaHecha) => void }) {
  const [enviando, setEnviando] = useState(false);

  async function cobrar(pagos: Pago[]) {
    setEnviando(true);
    try {
      const v = await api<VentaHecha>("/v1/pos/ventas", {
        method: "POST",
        body: { lines: lineasApi(carrito.lineas), payments: pagos, customer_id: carrito.cliente?.id ?? null, doc_type: carrito.doc_type },
      });
      vaciarCarrito();
      onHecha(v);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const identificado = Boolean(carrito.cliente && carrito.cliente.id !== ctx.cliente_varios);
  return (
    <div className="space-y-3">
      {carrito.doc_type === "INVOICE" && carrito.cliente?.doc_type !== "RUC" && (
        <Alert tone="warn">La factura necesita un cliente con RUC: identifícalo en la venta.</Alert>
      )}
      {carrito.doc_type === "RECEIPT" && total > ctx.parametros.boleta_con_documento && !carrito.cliente?.doc_number && (
        <Alert tone="warn">Una boleta de más de {soles(ctx.parametros.boleta_con_documento)} necesita el DNI del cliente.</Alert>
      )}
      <Cobro total={total} medios={ctx.medios} marcasTarjeta={ctx.marcas_tarjeta} saldoCliente={identificado ? carrito.cliente?.saldo ?? 0 : 0}
        clienteIdentificado={identificado} enviando={enviando} onCobrar={cobrar}
        textoBoton={`Cobrar y emitir ${carrito.doc_type === "INVOICE" ? "factura" : "boleta"}`} />
    </div>
  );
}

/** POS-05 tras cobrar: vuelto y los comprobantes del ticket para imprimir o enviar. */
export function ResultadoVenta({ venta, onNueva }: { venta: VentaHecha; onNueva: () => void }) {
  const [lista, setLista] = useState<Comprobante[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    api<Comprobante[]>(`/v1/pos/tickets/${venta.ticket}`)
      .then((r) => vigente && setLista(r))
      .catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [venta.ticket]);

  const pendientes = venta.comprobantes.filter((c) => c.sunat_status === "PENDING").length;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-ok/30 bg-ok-soft p-4 text-center">
        <CheckCircle2 className="mx-auto text-ok" size={28} />
        <div className="mt-1 text-[15px] font-semibold text-ink">Venta {venta.ticket} cobrada · {soles(venta.total)}</div>
        {venta.vuelto > 0 && <div className="mt-1 text-[22px] font-semibold text-ok">Vuelto {soles(venta.vuelto)}</div>}
        <div className="mt-1 text-[12.5px] text-muted">{venta.comprobantes.map((c) => c.full_number).join(" · ")}</div>
      </div>
      {pendientes > 0 && <Alert tone="warn">El OSE no respondió: entrega el ticket; el comprobante queda en la cola de reintento y se envía solo.</Alert>}
      <div className="flex justify-center"><Button variant="primary" className="h-12 px-8" onClick={onNueva}>Nueva venta</Button></div>
      {error && <Alert tone="bad">{error}</Alert>}
      {!lista && !error && <Vacio>Cargando el comprobante…</Vacio>}
      {lista && <Tickets lista={lista} onCambio={(c) => setLista((l) => l?.map((x) => (x.documento.id === c.documento.id ? c : x)) ?? null)} />}
    </div>
  );
}
