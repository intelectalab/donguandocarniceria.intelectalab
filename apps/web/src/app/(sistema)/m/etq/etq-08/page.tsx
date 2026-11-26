"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Alert, Button, DetailList, PageHeader, StatusBadge } from "@/components/ui";
import { fecha } from "@/lib/formato";
import { BuscarLote, ESTADO_LOTE, Qr, Seccion, useAlAbrir, useDatos, type Lote } from "@/modulos/etq/comunes";

type Publico = { product: string; variant: string | null; brand: string | null; lot: string; production_date: string | null; expiry_date: string | null; storage: string | null;
  sanitary: { authority: string; number: string | null; expires: string | null } | null; farm: { farm_name: string; tagline: string } | null; recalled: boolean };
type Qrs = { token: string; url: string; public: Publico | null };

/** ETQ-08 Página pública del QR: lo que ve el cliente al escanear la etiqueta, sin precio, costo, cliente ni pedido (RN-ETQ-09). */
export default function PaginaQr() {
  const [lote, setLote] = useState<Pick<Lote, "id" | "code"> & Partial<Lote> | null>(null);
  useAlAbrir((p) => { const id = p.get("lot"); if (id) setLote({ id, code: "" }); });
  const { datos: q, error } = useDatos<Qrs>(lote ? `/v1/etq/lotes/${lote.id}/qr` : null);
  const local = q ? `/l/${q.token}` : null;
  const pub = q?.public;
  return (
    <div className="space-y-5">
      <PageHeader description="Cada lote tiene un enlace propio que va en el QR de la etiqueta. Se abre sin iniciar sesión y muestra solo datos del producto y del lote; si el lote está en retiro, lo avisa primero." />
      <div className="max-w-xl">
        {lote ? <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line px-3 py-2">
          <span className="font-mono font-semibold">{lote.code || pub?.lot || "…"}</span>
          <Button size="sm" variant="ghost" icon={X} aria-label="Cambiar lote" onClick={() => setLote(null)} />
        </div> : <BuscarLote onElegir={setLote} />}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {!lote && <p className="text-[13px] text-muted">Busca un lote para ver su QR y su página pública.</p>}
      {q && !q.public && <Alert tone="info">La página pública de este lote se activa cuando Calidad lo libera. Mientras esté en cuarentena, retenido o rechazado, el QR muestra «lote no disponible».</Alert>}
      {q && pub && local && <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Seccion titulo="Código QR">
          <div className="flex flex-col items-center gap-3">
            <Qr texto={q.url} tamano={200} titulo={`QR del lote ${pub.lot}`} />
            <p className="max-w-full font-mono text-[12px] break-all text-muted">{q.url}</p>
            <Button icon={ExternalLink} onClick={() => window.open(local, "_blank", "noopener")}>Abrir la página</Button>
          </div>
          <div className="mt-4">
            <DetailList items={[
              { label: "Producto", value: pub.variant ?? pub.product }, { label: "Marca", value: pub.brand ?? "—" },
              { label: "Vence", value: fecha(pub.expiry_date) }, { label: "Registro", value: pub.sanitary?.number ?? "—" },
              { label: "Estado", value: pub.recalled ? <StatusBadge status="RECALLED" labels={ESTADO_LOTE} /> : "Se muestra normal" },
              { label: "Origen", value: pub.farm ? pub.farm.tagline : "Sin origen de granja" },
            ]} />
          </div>
        </Seccion>
        <Seccion titulo="Así lo ve el cliente">
          <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[28px] border-[6px] border-ink/80 bg-bg shadow-lg">
            <iframe title="Página pública del lote" src={local} className="block h-[640px] w-full" />
          </div>
        </Seccion>
      </div>}
    </div>
  );
}
