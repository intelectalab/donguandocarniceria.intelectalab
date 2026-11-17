"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import type { ZonaDelPin } from "./tipos";

/** Pregunta la zona del pin (o del distrito) mientras se mueve. Devuelve null mientras no hay respuesta. */
export function useZonaDelPin(lat: number | null | undefined, lng: number | null | undefined, distrito: string) {
  const clave = `${lat ?? ""}|${lng ?? ""}|${distrito}`;
  const [r, setR] = useState<{ clave: string; z: ZonaDelPin } | null>(null);
  useEffect(() => {
    if (lat == null && !distrito) return;
    let vigente = true;
    const q = new URLSearchParams();
    if (lat != null && lng != null) { q.set("lat", String(lat)); q.set("lng", String(lng)); }
    if (distrito) q.set("distrito", distrito);
    const t = setTimeout(() => {
      api<ZonaDelPin>(`/v1/cli/zona-del-pin?${q}`).then((z) => vigente && setR({ clave, z })).catch(() => {});
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave, lat, lng, distrito]);
  return r?.clave === clave ? r.z : null;
}

/** «Zona Surco A · S/ 10 · gratis desde 3 unidades o 3 kg» o el aviso de fuera de cobertura. */
export function AvisoZona({ z }: { z: ZonaDelPin | null }) {
  if (!z) return null;
  if (!z.en_peru) return <Alert tone="bad" title="Pin fuera del Perú">Muévelo a la dirección real (RN-CLI-04).</Alert>;
  if (!z.zona) return <Alert tone="warn" title="Fuera de cobertura">Ninguna zona cubre ese punto ni ese distrito. Se puede guardar, pero el pedido no tendrá tarifa de delivery hasta que se cree la zona.</Alert>;
  const gratis = [z.zona.free_from_units && `${z.zona.free_from_units} unidades`, z.zona.free_from_kg && `${numero(z.zona.free_from_kg)} kg`, z.zona.free_from_amount && soles(z.zona.free_from_amount)].filter(Boolean);
  return (
    <Alert tone="ok" title={`Zona ${z.zona.name}${z.zona.province ? " (provincia)" : ""}`}>
      Delivery {soles(z.zona.delivery_fee)}{gratis.length ? `, gratis desde ${gratis.join(" o ")}` : ""}. Pedido mínimo {soles(z.zona.min_order_amount)}.
      {" "}Sale de {z.zona.local ?? "—"}. {z.por === "POLYGON" ? "Por el polígono de la zona." : "Por el distrito."}
    </Alert>
  );
}
