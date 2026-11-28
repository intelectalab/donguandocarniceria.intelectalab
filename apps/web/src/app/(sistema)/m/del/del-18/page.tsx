"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, MessageCircle } from "lucide-react";
import { Alert, Badge, Button, PageHeader, toast } from "@/components/ui";
import { mensajeDe } from "@/lib/api";
import { fecha, kg, soles } from "@/lib/formato";
import { enviar } from "@/modulos/del/cola";
import { Dato, Seccion, Vacio, useDatos } from "@/modulos/del/comunes";
import { R } from "@/modulos/del/tipos";

type Linea = { nombre: string; cantidad: number; por_kg: boolean; precio: number; kg_pedido: number | null; kg_pesado: number | null; dif_kg: number | null; dif_pct: number | null; monto: number; monto_estimado: number };
type Ticket = {
  pedido: string; cliente: string | null; fecha: string; marca: string | null; lineas: Linea[]; subtotal: number; subtotal_estimado: number; ajustes: number; delivery: number;
  total: number; pagado: number; por_cobrar: number; diferencia_peso: number; pesado: boolean; stop_id: string; route_id: string; seq: number; status: string; telefono: string | null;
};

/** DEL-18 Ticket de entrega: lo pedido frente a lo pesado, con el total a cobrar; se muestra o se envía por WhatsApp (RN-DEL-15). */
export default function TicketEntrega() {
  return <Suspense><Pantalla /></Suspense>;
}

function texto(t: Ticket) {
  const l = t.lineas.map((x) => `• ${x.nombre}: ${x.por_kg ? `${x.kg_pesado ?? x.kg_pedido} kg` : x.cantidad} — ${soles(x.monto)}`).join("\n");
  return `${t.marca ?? ""} · Pedido ${t.pedido}\n${l}\nDelivery: ${soles(t.delivery)}\nTotal: ${soles(t.total)}\nPagado: ${soles(t.pagado)}${t.por_cobrar > 0 ? `\nPor cobrar: ${soles(t.por_cobrar)}` : ""}`;
}

function Pantalla() {
  const router = useRouter();
  const parada = useSearchParams().get("parada");
  const { datos: t, error, cargando } = useDatos<Ticket>(parada ? `/v1/del/paradas/${parada}/ticket` : null);
  const registrar = async (via: "SHOWN" | "WHATSAPP") => {
    if (!t) return;
    if (via === "WHATSAPP" && t.telefono) window.open(`https://wa.me/${t.telefono}?text=${encodeURIComponent(texto(t))}`, "_blank", "noopener");
    try {
      const r = await enviar({ type: "TICKET", stop_id: t.stop_id, resumen: `Ticket ${t.pedido}`, payload: { via } });
      toast.ok(r ? "Ticket registrado." : "Sin señal: se registrará al volver la conexión.");
    } catch (x) { toast.error(mensajeDe(x)); }
  };
  if (!parada) return <Vacio>Abre el ticket desde la parada.</Vacio>;
  return (
    <div className="mx-auto max-w-[560px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => (t ? router.push(`${R.parada}?id=${t.stop_id}&ruta=${t.route_id}`) : router.back())}>Volver a la parada</Button>
      <PageHeader description="Muéstralo al cliente antes de cobrar: lo pedido, lo que pesó y el total." />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando || !t ? <Vacio>Cargando…</Vacio> : (
        <>
          <Seccion titulo={`${t.marca ?? ""} · ${t.pedido}`}>
            <p className="text-[12.5px] text-muted">{t.cliente ?? "—"} · {fecha(t.fecha)}</p>
            <ul className="mt-2 divide-y divide-line">
              {t.lineas.map((l, i) => (
                <li key={i} className="py-2 text-[13.5px]">
                  <span className="flex justify-between gap-2"><span className="font-medium text-ink">{l.nombre}</span><span className="font-medium">{soles(l.monto)}</span></span>
                  <span className="block text-[12.5px] text-muted">
                    {l.por_kg ? <>Pedido {kg(l.kg_pedido)} · pesó {l.kg_pesado != null ? kg(l.kg_pesado) : "—"} · {soles(l.precio)}/kg</> : <>{l.cantidad} × {soles(l.precio)}</>}
                    {l.dif_pct != null && Math.abs(l.dif_pct) >= 0.1 && <span className="ml-1.5"><Badge tone={Math.abs(l.dif_pct) > 10 ? "warn" : "neutral"}>{l.dif_pct > 0 ? "+" : ""}{l.dif_pct}%</Badge></span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-line pt-2">
              <Dato label="Subtotal">{soles(t.subtotal)}</Dato>
              {t.pesado && Math.abs(t.diferencia_peso) > 0.004 && <Dato label="Diferencia por peso">{t.diferencia_peso > 0 ? "+" : ""}{soles(t.diferencia_peso)}</Dato>}
              {Math.abs(t.ajustes - t.delivery) > 0.004 && <Dato label="Descuentos y ajustes">{soles(t.ajustes - t.delivery)}</Dato>}
              <Dato label="Delivery">{t.delivery > 0 ? soles(t.delivery) : "Gratis"}</Dato>
              <Dato label="Total">{soles(t.total)}</Dato>
              <Dato label="Pagado">{soles(t.pagado)}</Dato>
              <div className="mt-1 flex items-baseline justify-between text-[17px] font-semibold"><span>Por cobrar</span><span>{soles(t.por_cobrar)}</span></div>
            </div>
          </Seccion>
          <div className="grid grid-cols-2 gap-2">
            <Button icon={Eye} onClick={() => registrar("SHOWN")}>Lo vio</Button>
            <Button variant="primary" icon={MessageCircle} disabled={!t.telefono} onClick={() => registrar("WHATSAPP")}>WhatsApp</Button>
          </div>
        </>
      )}
    </div>
  );
}
