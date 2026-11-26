"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Repeat, Send, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { Panel, Sub, useAlAbrir, useDatos } from "@/modulos/canales/comunes";
import { importe, useCarrito } from "@/modulos/b2b/carrito";

type Repetir = { order: { id: string; number: string }; earliest_date: string;
  lines: { variant_id: string; variant_name: string; sale_mode: string; qty: number; est_weight_kg: number | null; old_price: number; new_price: number | null; basis: string; diff: number; active: boolean }[] };
type Resultado = { order: { id: string; number: string; status: string; delivery_date: string; estimated_total: string }; confirmed: boolean; reason: string | null }[];

/** B2B-13 Portal · Pedido nuevo y repetir: carrito, fecha de entrega con la hora de corte, horario y nota; repetir avisa si cambió el precio. */
export default function PedidoNuevo() {
  const router = useRouter();
  const carrito = useCarrito();
  const p = useDatos<{ earliest_date: string; cutoff: string; min_order: number; credit: { available: number } | null; account: { can_order: boolean } }>("/v1/b2b/portal/resumen");
  const [repetir, setRepetir] = useState<string | null>(null);
  const [rep, setRep] = useState<Repetir | null>(null);
  const [f, setF] = useState({ delivery_date: "", slot_from: "", notes: "" });
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<Resultado | null>(null);
  useAlAbrir((x) => {
    const id = x.get("repetir");
    if (!id) return;
    setRepetir(id);
    api<Repetir>(`/v1/b2b/portal/pedidos/${id}/repetir`).then((r) => {
      setRep(r);
      carrito.reemplazar(r.lines.filter((l) => l.active && l.new_price != null).map((l) => ({ variant_id: l.variant_id, name: l.variant_name, sku: "", sale_mode: l.sale_mode, price: l.new_price!, basis: l.basis,
        qty: l.qty, nominal_kg: l.sale_mode === "UNIT" && l.est_weight_kg && l.qty ? l.est_weight_kg / l.qty : null, cut_notes: "" })));
    }).catch((e) => toast.error(mensajeDe(e)));
  });
  const minima = p.datos?.earliest_date ?? "";
  const entrega = f.delivery_date || minima;
  const falta = p.datos ? Math.max(0, p.datos.min_order - carrito.total) : 0;

  async function pedir() {
    setEnviando(true);
    try {
      const r = await api<{ orders: Resultado }>("/v1/b2b/portal/pedidos", { method: "POST", body: { delivery_date: entrega, slot_from: f.slot_from || null, notes: f.notes || null, repeat_of: repetir,
        lines: carrito.items.map((x) => ({ variant_id: x.variant_id, qty: x.qty, cut_notes: x.cut_notes || null })) } });
      carrito.vaciar();
      setHecho(r.orders);
    } catch (e) { toast.error(mensajeDe(e)); } finally { setEnviando(false); }
  }

  if (hecho) return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Alert tone="ok" title="¡Pedido recibido!">{hecho.length > 1 ? "Tu pedido se dividió por marca, porque cada una despacha por separado." : "Te avisaremos cuando salga a reparto."}</Alert>
      {hecho.map((h) => <Panel key={h.order.id} titulo={`Pedido ${h.order.number}`}>
        <p className="text-[13.5px]">Entrega el {fecha(h.order.delivery_date)} · {soles(h.order.estimated_total)}</p>
        {h.confirmed ? <Badge tone="ok">Confirmado</Badge> : <><Badge tone="warn">Por confirmar</Badge><p className="mt-1 text-[13px] text-muted">{h.reason} Tu vendedora lo revisa y te confirma.</p></>}
      </Panel>)}
      <div className="flex gap-2"><Button variant="primary" onClick={() => router.push("/m/b2b/b2b-14")}>Ver mis pedidos</Button><Button onClick={() => router.push("/m/b2b/b2b-12")}>Seguir comprando</Button></div>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader code={rep ? `Repetir ${rep.order.number}` : undefined} description={p.datos ? `Con la hora de corte de las ${p.datos.cutoff}, la entrega más pronta es el ${fecha(minima)}.` : undefined} />
      {p.datos && !p.datos.account.can_order && <Alert tone="warn">Tu usuario puede ver pedidos y comprobantes, pero no hacer pedidos.</Alert>}
      {rep && <Panel titulo={<><Repeat size={15} className="mr-1 inline" />Cambios desde el pedido {rep.order.number}</>}>
        <ul className="divide-y divide-line text-[13.5px]">{rep.lines.map((l) => <li key={l.variant_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span>{l.variant_name} · {numero(l.qty)} {l.sale_mode === "KG" ? "kg" : "unid."}</span>
          {!l.active || l.new_price == null ? <Badge tone="bad">Ya no está disponible</Badge> : l.diff ? <Badge tone={l.diff > 0 ? "warn" : "ok"}>{soles(l.old_price)} → {soles(l.new_price)} ({l.diff > 0 ? "+" : ""}{soles(l.diff)} por {l.basis === "KG" ? "kg" : "unidad"})</Badge>
            : <span className="text-muted">Mismo precio: {soles(l.new_price)}</span>}</li>)}</ul>
      </Panel>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel titulo={`Carrito (${carrito.items.length})`}>
          {!carrito.items.length ? <p className="text-[13.5px] text-muted">Tu carrito está vacío. <Link className="text-primary underline" href="/m/b2b/b2b-12">Ir al catálogo</Link></p> :
            <ul className="divide-y divide-line">{carrito.items.map((x) => <li key={x.variant_id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_110px_auto] sm:items-center">
              <div><p className="font-medium">{x.name}</p><Sub>{soles(x.price)} por {x.basis === "KG" ? "kg" : "unidad"} · {soles(importe(x))}</Sub>
                <Input aria-label="Indicación para el corte" className="mt-1.5" value={x.cut_notes} onChange={(e) => carrito.cambiar(x.variant_id, { cut_notes: e.target.value })} placeholder="Indicación (corte, presentación)" /></div>
              <Input aria-label={`Cantidad de ${x.name}`} inputMode="decimal" suffix={x.sale_mode === "KG" ? "kg" : "unid."} value={String(x.qty)} onChange={(e) => carrito.cambiar(x.variant_id, { qty: Number(e.target.value.replace(",", ".")) || 0 })} />
              <Button variant="ghost" icon={Trash2} aria-label={`Quitar ${x.name}`} onClick={() => carrito.cambiar(x.variant_id, { qty: 0 })} />
            </li>)}</ul>}
        </Panel>
        <Panel titulo="Entrega">
          <div className="space-y-3">
            <Field label="Fecha de entrega" hint={`Desde el ${fecha(minima)}.`}><Input type="date" min={minima} value={entrega} onChange={(e) => setF({ ...f, delivery_date: e.target.value })} /></Field>
            <Field label="Horario"><Select value={f.slot_from} onChange={(e) => setF({ ...f, slot_from: e.target.value })} placeholder="El de siempre"
              options={[{ value: "09:00", label: "Mañana (9:00 a 13:00)" }, { value: "13:00", label: "Tarde (13:00 a 17:00)" }, { value: "17:00", label: "Noche (17:00 a 20:00)" }]} /></Field>
            <Field label="Nota para el reparto"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Ingreso por cocina" /></Field>
            <div className="border-t border-line pt-3 text-[13.5px]">
              <p className="flex justify-between"><span>Total estimado</span><strong>{soles(carrito.total)}</strong></p>
              <Sub>Los productos por kilo se cobran con el peso real de la balanza.</Sub>
              {p.datos?.credit && carrito.total > p.datos.credit.available && <p className="mt-1 text-[13px] text-warn">Supera tu disponible ({soles(p.datos.credit.available)}): el pedido quedará por confirmar.</p>}
              {falta > 0 && carrito.items.length > 0 && <p className="mt-1 text-[13px] text-bad">Faltan {soles(falta)} para el pedido mínimo.</p>}
            </div>
            <Button variant="primary" className="w-full" icon={Send} loading={enviando} disabled={!carrito.items.length || falta > 0 || !p.datos?.account.can_order} onClick={pedir}>Enviar pedido</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
