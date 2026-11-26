"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Repeat } from "lucide-react";
import { Badge, Button, DataTable, Modal, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fecha, kg, numero, soles } from "@/lib/formato";
import { FiltroSelect, Sub, opcionesDe, useDatos } from "@/modulos/canales/comunes";
import { Descargas } from "@/modulos/b2b/Comprobante";
import { ESTADO_PEDIDO } from "@/modulos/b2b/tipos";

type Pedido = { id: string; number: string; status: string; delivery_date: string; slot_from: string | null; slot_to: string | null; estimated_total: string; final_total: string | null;
  created_at: string; origin_ref: string | null; brand_name: string };
type Detalle = Pedido & { notes: string | null; lines: { id: string; variant_name: string; qty: string; unit_price: string; price_basis: string; est_weight_kg: string | null; weighed_kg: string | null; est_amount: string; final_amount: string | null; cut_notes: string | null }[];
  documents: { id: string; doc_type: string; full_number: string; issue_date: string; total: string; sunat_status: string }[] };

/** B2B-14 Portal · Mis pedidos: estado, entrega, total estimado y final con el peso real, comprobantes y repetir. */
export default function MisPedidos() {
  const router = useRouter();
  const [estado, setEstado] = useState("");
  const r = useDatos<{ data: Pedido[] }>("/v1/b2b/portal/pedidos");
  const [ver, setVer] = useState<string | null>(null);
  const filas = (r.datos?.data ?? []).filter((o) => !estado || o.status === estado);

  const columnas: Column<Pedido>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (o) => <div><p className="font-mono font-semibold">{o.number}</p><Sub>{o.brand_name}{o.origin_ref?.startsWith("Repetir") ? ` · ${o.origin_ref}` : ""}</Sub></div> },
    { key: "delivery_date", header: "Entrega", render: (o) => <div>{fecha(o.delivery_date)}<Sub>{o.slot_from ? `${o.slot_from.slice(0, 5)}–${o.slot_to?.slice(0, 5)}` : ""}</Sub></div> },
    { key: "status", header: "Estado", render: (o) => <StatusBadge status={o.status} labels={ESTADO_PEDIDO} /> },
    { key: "estimated_total", header: "Total", align: "right", render: (o) => <div>{soles(o.final_total ?? o.estimated_total)}<Sub>{o.final_total ? "con peso real" : "estimado"}</Sub></div> },
    { key: "acc", header: "", render: (o) => <Button size="sm" variant="ghost" icon={Repeat} onClick={(e) => { e.stopPropagation(); router.push(`/m/b2b/b2b-13?repetir=${o.id}`); }}>Repetir</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los pedidos de tu empresa, también los que hicieron tus compañeros. Los productos por kilo se cobran con el peso de la balanza." />
      <DataTable columns={columnas} rows={filas} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="Todavía no hay pedidos." onRowClick={(o) => setVer(o.id)}
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_PEDIDO)} />} />
      {ver && <VerPedido id={ver} onClose={() => setVer(null)} onRepetir={() => router.push(`/m/b2b/b2b-13?repetir=${ver}`)} />}
    </div>
  );
}

function VerPedido({ id, onClose, onRepetir }: { id: string; onClose: () => void; onRepetir: () => void }) {
  const r = useDatos<Detalle>(`/v1/b2b/portal/pedidos/${id}`);
  const o = r.datos;
  return (
    <Modal open onClose={onClose} size="lg" title={o ? `Pedido ${o.number}` : "Pedido"} description={o ? `Entrega ${fecha(o.delivery_date)}` : undefined}
      footer={<><Button onClick={onClose}>Cerrar</Button><Button variant="primary" icon={Repeat} onClick={onRepetir}>Repetir pedido</Button></>}>
      {!o ? <p className="text-sm text-muted">{r.error ?? "Cargando…"}</p> : <div className="space-y-4 text-[13.5px]">
        <StatusBadge status={o.status} labels={ESTADO_PEDIDO} />
        <ul className="divide-y divide-line">{o.lines.map((l) => <li key={l.id} className="flex justify-between gap-2 py-1.5">
          <span>{l.variant_name}<Sub>{numero(l.qty)} {l.price_basis === "KG" ? `· ${l.weighed_kg ? `pesó ${kg(l.weighed_kg)}` : `aprox. ${kg(l.est_weight_kg)}`}` : "unid."} · {soles(l.unit_price)}{l.cut_notes ? ` · ${l.cut_notes}` : ""}</Sub></span>
          <span className="tabular-nums">{soles(l.final_amount ?? l.est_amount)}</span></li>)}</ul>
        <p className="flex justify-between font-semibold"><span>Total {o.final_total ? "final" : "estimado"}</span><span>{soles(o.final_total ?? o.estimated_total)}</span></p>
        {o.documents.length > 0 && <div><p className="mb-1 font-medium">Comprobantes</p>
          {o.documents.map((d) => <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1"><span className="font-mono">{d.full_number}</span>
            <Badge tone={d.sunat_status === "ACCEPTED" ? "ok" : "warn"}>{d.sunat_status === "ACCEPTED" ? "Aceptado por SUNAT" : "En proceso"}</Badge><Descargas id={d.id} numero={d.full_number} aceptado={d.sunat_status === "ACCEPTED"} /></div>)}</div>}
      </div>}
    </Modal>
  );
}
