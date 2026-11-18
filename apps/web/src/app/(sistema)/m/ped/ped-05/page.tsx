"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Copy, ExternalLink, Phone, Globe } from "lucide-react";
import { Alert, Button, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { BuscarPedido } from "@/modulos/ped/BuscarPedido";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";
import { usePedido } from "@/modulos/ped/usePedido";
import { CANALES, ESTADOS, etiqueta, type Detalle } from "@/modulos/ped/tipos";

type Resumen = { texto: string; whatsapp: string | null; confirmado_en: string | null; canal: string | null };

/** PED-05 Confirmación con el cliente: resumen en un solo mensaje (RN-PED-12), copiar o abrir WhatsApp y registrar cuándo confirmó. */
export default function Confirmacion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  if (!id) {
    return (
      <Seccion titulo="Pedidos confirmados por enviar al cliente">
        <BuscarPedido estados={["CONFIRMED"]} onElegir={(x) => router.push(`/m/ped/ped-05?id=${x}`)} vacio="No hay pedidos confirmados." />
      </Seccion>
    );
  }
  return <Mensaje id={id} />;
}

function Mensaje({ id }: { id: string }) {
  const router = useRouter();
  const { puede } = useSesion();
  const { detalle: d, error, cargando, reemplazar } = usePedido(id);
  const [res, setRes] = useState<{ id: string; r?: Resumen; error?: string } | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");

  useEffect(() => {
    let vigente = true;
    api<Resumen>(`/v1/ped/pedidos/${id}/resumen`).then((r) => vigente && setRes({ id, r })).catch((e) => vigente && setRes({ id, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [id]);

  if (cargando || !res || res.id !== id) return <Vacio>Preparando el resumen…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se encontró el pedido."}</Alert>;
  if (res.error || !res.r) return <Alert tone="bad">{res.error}</Alert>;
  const o = d.pedido;
  const mensaje = texto ?? res.r.texto;
  const wa = res.r.whatsapp && texto !== null ? res.r.whatsapp.replace(/\?text=.*/, `?text=${encodeURIComponent(mensaje)}`) : res.r.whatsapp;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensaje);
      toast.ok("Mensaje copiado");
    } catch {
      toast.error("No se pudo copiar: selecciona el texto y cópialo a mano.");
    }
  }

  async function confirmo(canal: string) {
    setOcupado(canal);
    try {
      reemplazar(await api<Detalle>(`/v1/ped/pedidos/${o.id}/confirmo-cliente`, { method: "POST", body: { channel: canal } }));
      toast.ok("Confirmación del cliente registrada");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`/m/ped/ped-03?id=${o.id}`)}>Ver detalle</Button>
        <span className="font-semibold text-ink">{o.number}</span>
        <StatusBadge status={o.status} labels={ESTADOS} />
      </div>
      {o.status === "DRAFT" && <Alert tone="warn">El pedido aún es borrador: confírmalo antes de enviarlo al cliente.</Alert>}
      {o.customer_confirmed_at && (
        <Alert tone="ok" title="El cliente ya confirmó">{fechaHora(o.customer_confirmed_at)} por {etiqueta(CANALES, o.confirmation_channel)}.</Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Seccion titulo="Mensaje para el cliente" acciones={texto !== null && <Button size="sm" variant="ghost" onClick={() => setTexto(null)}>Volver al original</Button>}>
          <textarea value={mensaje} onChange={(e) => setTexto(e.target.value)} rows={18} aria-label="Mensaje"
            className="w-full rounded-[9px] border border-line bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-primary" />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={Copy} onClick={copiar}>Copiar</Button>
            {wa ? (
              <a href={wa} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-[9px] bg-primary px-4 text-[13.5px] font-semibold text-primary-ink hover:brightness-110">
                <ExternalLink size={16} aria-hidden="true" /> Abrir en WhatsApp
              </a>
            ) : <span className="self-center text-[12.5px] text-muted">El cliente no tiene un celular válido para WhatsApp.</span>}
          </div>
        </Seccion>
        <Seccion titulo="¿Confirmó el cliente?">
          <p className="mb-3 text-[13px] text-muted">Cuando el cliente responda «Sí», registra por dónde lo hizo. Queda la hora en el pedido.</p>
          {puede("PED", "E") && !["CANCELLED", "CLOSED"].includes(o.status) ? (
            <div className="grid gap-2">
              <Button variant="primary" icon={Check} loading={ocupado === "WHATSAPP"} onClick={() => confirmo("WHATSAPP")}>Confirmó por WhatsApp</Button>
              <Button icon={Phone} loading={ocupado === "PHONE"} onClick={() => confirmo("PHONE")}>Confirmó por teléfono</Button>
              <Button icon={Globe} loading={ocupado === "WEB"} onClick={() => confirmo("WEB")}>Confirmó en la web</Button>
            </div>
          ) : <Vacio>No se puede registrar en este pedido.</Vacio>}
        </Seccion>
      </div>
    </div>
  );
}
