"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Banknote, CheckCircle2, MapPin, MessageCircle, Navigation, Phone, Receipt, Truck, XCircle } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, Select, StatusBadge, Tabs, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { BarraCola, posicionActual, usePosicion } from "@/modulos/del/App";
import { Firma, Foto } from "@/modulos/del/Captura";
import { enviar, nuevoId } from "@/modulos/del/cola";
import { Seccion, Vacio, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PARADA, R, hora, lista, navegar, type Hoja, type Opciones, type Parada } from "@/modulos/del/tipos";

/** DEL-05 App: parada. Navegar, «Llegué», llamar o escribir, cobro contra entrega, entrega con foto y código o firma, no entregado e incidencias. */
export default function ParadaApp() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const q = useSearchParams();
  const id = q.get("id");
  const ruta = q.get("ruta");
  if (!id || !ruta) return <Alert tone="info">Abre la parada desde Mis rutas.</Alert>;
  return <Detalle id={id} ruta={ruta} />;
}

type Modo = null | "cobro" | "entrega" | "falla" | "incidencia" | "derivar";

function Detalle({ id, ruta }: { id: string; ruta: string }) {
  const router = useRouter();
  const op = useOpciones();
  const { datos: h, error, cargando, recargar } = useDatos<Hoja>(`/v1/del/app/rutas/${ruta}`);
  const [modo, setModo] = useState<Modo>(null);
  // Lo hecho sin señal: se muestra como hecho mientras la cola lo envía.
  const [local, setLocal] = useState<Record<string, string>>({});
  usePosicion(ruta, h?.ruta.status === "IN_ROUTE", op.datos?.parametros.intervalo_s ?? 120);

  if (cargando || !op.datos) return <Vacio>Cargando…</Vacio>;
  if (error || !h) return <Alert tone="bad">{error || "No se encontró la ruta."}</Alert>;
  const p0 = h.paradas.find((x) => x.id === id);
  if (!p0) return <Alert tone="bad">La parada ya no está en la ruta.</Alert>;
  const p: Parada = local[p0.id] ? { ...p0, status: local[p0.id] } : p0;
  const abierta = h.ruta.status === "IN_ROUTE" && ["PENDING", "ARRIVED"].includes(p.status);
  const siguiente = h.paradas.find((x) => x.seq > p.seq && ["PENDING", "ARRIVED"].includes(x.status) && !local[x.id]);

  function hecho(estado: string, sinSenal: boolean, texto: string) {
    if (sinSenal) { setLocal((l) => ({ ...l, [p.id]: estado })); toast.info(`${texto} Sin señal: se envía al volver la conexión.`); }
    else { toast.ok(texto); recargar(); }
    setModo(null);
  }

  async function llegue() {
    const pos = await posicionActual();
    try {
      const r = await enviar({ type: "ARRIVED", stop_id: p.id, resumen: `Llegada a la parada ${p.seq}`, payload: { ...(pos ?? {}), occurred_at: new Date().toISOString() } });
      hecho("ARRIVED", r === null, "Llegada registrada.");
    } catch (e) { toast.error(mensajeDe(e)); }
  }

  async function contacto(via: "CALL" | "WHATSAPP") {
    try {
      const r = await api<{ url: string }>(`/v1/del/app/paradas/${p.id}/contacto`, { method: "POST", body: { via } });
      window.location.href = r.url;
    } catch (e) { toast.error(mensajeDe(e)); }
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push(`${R.app}?ruta=${ruta}`)}>Paradas</Button>
      <BarraCola onSincronizado={() => { setLocal({}); recargar(); }} />
      <Seccion>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted">Parada {p.seq} de {h.paradas.length} · {p.pedido}</p>
            <p className="text-[18px] font-bold text-ink">{p.cliente}</p>
          </div>
          <StatusBadge status={p.status} labels={PARADA} />
        </div>
        <p className="mt-2 flex items-start gap-1.5 text-[14px] text-ink"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" />{p.direccion}{p.distrito ? `, ${p.distrito}` : ""}</p>
        {p.referencia && <p className="pl-6 text-[13px] text-muted">{p.referencia}</p>}
        {!p.con_pin && <p className="pl-6 text-[12.5px] text-warn">Sin pin: la navegación va al centro de la zona.</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
          <span>Franja <b>{p.franja ?? "—"}</b></span><span>Llega ~<b>{hora(p.eta)}</b></span>
          <span>{p.bolsas.length} bolsa(s)</span><span>Tel. {p.telefono}{p.senal === "WHATSAPP_ONLY" ? " (solo WhatsApp)" : p.senal === "NO_SIGNAL" ? " (sin señal)" : ""}</span>
        </div>
        {p.pendiente > 0 ? (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-[15px] text-ink">Cobrar <b>{soles(p.pendiente)}</b>{p.medio ? ` · ${op.datos.medios[p.medio] ?? p.medio}` : ""}</p>
        ) : p.cobrar > 0 ? <p className="mt-3 text-[13px] text-ok">Cobrado {soles(p.cobrado)}</p> : <p className="mt-3 text-[13px] text-muted">Pagado antes: no se cobra.</p>}
        {p.notas && <p className="mt-2 text-[12.5px] text-muted">Nota del pedido: {p.notas}</p>}
        {p.pod_distance_m !== null && <p className="mt-2 text-[12.5px] text-muted">Entregado {fechaHora(p.closed_at)} a {Math.round(p.pod_distance_m)} m del pin.</p>}
        {p.motivo && <p className="mt-2 text-[13px] text-bad">No entregado: {p.motivo}</p>}
      </Seccion>

      {abierta && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <a href={navegar(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[15px] font-semibold text-primary-ink"><Navigation size={18} /> Navegar</a>
            {p.status === "PENDING" && <Button className="col-span-2" variant="secondary" icon={MapPin} onClick={() => void llegue()}>Llegué</Button>}
            <Button icon={Phone} disabled={p.senal === "WHATSAPP_ONLY"} onClick={() => void contacto("CALL")}>Llamar</Button>
            <Button icon={MessageCircle} onClick={() => void contacto("WHATSAPP")}>WhatsApp</Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {p.pendiente > 0 && <Button className="col-span-2" variant="primary" icon={Banknote} onClick={() => setModo("cobro")}>Cobrar {soles(p.pendiente)}</Button>}
            <Button variant={p.pendiente > 0 ? "secondary" : "primary"} icon={CheckCircle2} disabled={p.pendiente > 0} onClick={() => setModo("entrega")}>Entregado</Button>
            <Button variant="danger" icon={XCircle} onClick={() => setModo("falla")}>No entregado</Button>
            <Button icon={AlertTriangle} onClick={() => setModo("incidencia")}>Incidencia</Button>
            <Button icon={Truck} onClick={() => setModo("derivar")}>Derivar</Button>
          </div>
        </>
      )}
      {!abierta && h.ruta.status === "IN_ROUTE" && siguiente && (
        <Button className="w-full" variant="primary" onClick={() => router.push(`${R.parada}?id=${siguiente.id}&ruta=${ruta}`)}>Siguiente parada: {siguiente.seq}. {siguiente.cliente}</Button>
      )}
      {["DELIVERED", "HANDED_OFF"].includes(p.status) && (
        <Button className="w-full" icon={Receipt} onClick={() => router.push(`${R.ticket}?parada=${p.id}`)}>Ticket de entrega</Button>
      )}
      {h.ruta.status !== "IN_ROUTE" && ["PENDING"].includes(p.status) && <Alert tone="info">La ruta aún no sale: las acciones se habilitan con la ruta EN RUTA.</Alert>}

      {modo === "cobro" && <Cobro p={p} op={op.datos} onClose={() => setModo(null)} onListo={(s) => hecho(p.status, s, "Cobro registrado.")} />}
      {modo === "entrega" && <Entrega p={p} onClose={() => setModo(null)} onListo={(s) => hecho("DELIVERED", s, "Entrega registrada.")} />}
      {modo === "falla" && <Falla p={p} op={op.datos} onClose={() => setModo(null)} onListo={(s) => hecho("FAILED", s, "No entregado registrado.")} />}
      {modo === "incidencia" && <Incidencia p={p} op={op.datos} onClose={() => setModo(null)} onListo={(s) => hecho(p.status, s, "Incidencia enviada a control.")} />}
      {modo === "derivar" && <Derivar p={p} op={op.datos} onClose={() => setModo(null)} onListo={() => hecho("HANDED_OFF", false, "Pedido derivado al motorizado externo.")} />}
    </div>
  );
}

function Cobro({ p, op, onClose, onListo }: { p: Parada; op: Opciones; onClose: () => void; onListo: (sinSenal: boolean) => void }) {
  const [medio, setMedio] = useState(p.medio && op.medios[p.medio] ? p.medio : "CASH");
  const [ref, setRef] = useState("");
  const [tarjeta, setTarjeta] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const pideRef = medio === "YAPE" || medio === "PLIN";
  return (
    <Modal open onClose={onClose} title={`Cobrar ${soles(p.pendiente)}`} description="Solo con los medios de la empresa. El monto es el de la parada." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={(pideRef && !ref.trim()) || (medio === "CARD" && !/^\d{4}$/.test(tarjeta))} onClick={async () => {
          setOcupado(true);
          try {
            const pos = await posicionActual();
            const r = await enviar({ type: "COD_COLLECTED", stop_id: p.id, resumen: `Cobro de ${soles(p.pendiente)} (parada ${p.seq})`,
              payload: { method: medio, amount: p.pendiente, reference: ref.trim() || null, card_last4: medio === "CARD" ? tarjeta : null, ...(pos ?? {}), occurred_at: new Date().toISOString() } });
            onListo(r === null);
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Registrar cobro</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Medio"><Select value={medio} onChange={(e) => setMedio(e.target.value)} options={lista(op.medios)} /></Field>
        {pideRef && <Field label="N.º de operación" required><Input inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
        {medio === "CARD" && <Field label="4 últimos dígitos de la tarjeta" required><Input inputMode="numeric" maxLength={4} value={tarjeta} onChange={(e) => setTarjeta(e.target.value.replace(/\D/g, ""))} /></Field>}
        {medio === "CASH" && <p className="text-[12.5px] text-muted">El efectivo queda en tu caja de repartidor y se liquida al volver.</p>}
      </div>
    </Modal>
  );
}

function Entrega({ p, onClose, onListo }: { p: Parada; onClose: () => void; onListo: (sinSenal: boolean) => void }) {
  const [foto, setFoto] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<"codigo" | "firma">("codigo");
  const [codigo, setCodigo] = useState("");
  const [firma, setFirma] = useState<string | null>(null);
  const [recibe, setRecibe] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const listo = !!foto && (prueba === "codigo" ? /^\d{4}$/.test(codigo) : !!firma);
  return (
    <Modal open onClose={onClose} title="Entregar pedido" description="Foto del pedido entregado y el código de 4 dígitos que recibió el cliente, o su firma." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!listo} onClick={async () => {
          setOcupado(true);
          try {
            const pos = await posicionActual();
            const r = await enviar<{ outside_radius: boolean; distance_m: number | null }>({ type: "DELIVERED", stop_id: p.id, resumen: `Entrega de la parada ${p.seq}`, client_event_id: nuevoId(),
              payload: { photo_data: foto, code: prueba === "codigo" ? codigo : null, signature_data: prueba === "firma" ? firma : null, receiver: recibe.trim() || null, ...(pos ?? {}), occurred_at: new Date().toISOString() } });
            if (r?.outside_radius) toast.info(`La prueba se tomó a ${Math.round(r.distance_m ?? 0)} m del pin: control recibe el aviso.`);
            onListo(r === null);
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Confirmar entrega</Button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Foto del pedido entregado" required><Foto valor={foto} onChange={setFoto} /></Field>
        <Tabs value={prueba} onChange={setPrueba} tabs={[{ key: "codigo", label: "Código" }, { key: "firma", label: "Firma" }]} />
        {prueba === "codigo" ? (
          <Field label="Código de entrega del cliente" hint="Lo recibió en el mensaje «va en camino».">
            <Input inputMode="numeric" maxLength={4} autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} className="text-center font-mono text-[20px] tracking-[0.4em]" />
          </Field>
        ) : <Firma onChange={setFirma} />}
        <Field label="Quién recibe (opcional)"><Input value={recibe} onChange={(e) => setRecibe(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Falla({ p, op, onClose, onListo }: { p: Parada; op: Opciones; onClose: () => void; onListo: (sinSenal: boolean) => void }) {
  const [motivo, setMotivo] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title="No entregado" description="Elige el motivo y toma una foto (fachada, timbre o producto). Las bolsas vuelven al almacén." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" loading={ocupado} disabled={!motivo || !foto || (motivo === "OTHER" && !nota.trim())} onClick={async () => {
          setOcupado(true);
          try {
            const pos = await posicionActual();
            const r = await enviar({ type: "FAILED", stop_id: p.id, resumen: `No entregado en la parada ${p.seq}`,
              payload: { reason: motivo, photo_data: foto, notes: nota.trim() || null, ...(pos ?? {}), occurred_at: new Date().toISOString() } });
            onListo(r === null);
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Registrar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Motivo" required><Select value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Elige el motivo" options={lista(op.motivos)} /></Field>
        <Field label="Foto" required><Foto valor={foto} onChange={setFoto} /></Field>
        <Field label={motivo === "OTHER" ? "Qué pasó" : "Nota (opcional)"} required={motivo === "OTHER"}><Textarea value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Incidencia({ p, op, onClose, onListo }: { p: Parada; op: Opciones; onClose: () => void; onListo: (sinSenal: boolean) => void }) {
  const [tipo, setTipo] = useState("");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title="Incidencia" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!tipo} onClick={async () => {
          setOcupado(true);
          try {
            const pos = await posicionActual();
            const r = await enviar({ type: "INCIDENT", stop_id: p.id, resumen: `Incidencia en la parada ${p.seq}`, payload: { type: tipo, notes: nota.trim() || null, ...(pos ?? {}) } });
            onListo(r === null);
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Enviar a control</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Tipo" required><Select value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Elige el tipo" options={lista(op.incidencias)} /></Field>
        <Field label="Detalle"><Textarea value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function Derivar({ p, op, onClose, onListo }: { p: Parada; op: Opciones; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ courier_name: "", courier_phone: "", plate: "", shipping_cost: "", paid_with: "ROUTE_CASH", note: "" });
  const [fotos, setFotos] = useState<{ courier: string | null; plate: string | null; product: string | null }>({ courier: null, plate: null, product: null });
  const [ocupado, setOcupado] = useState(false);
  const listo = d.courier_name.trim() && d.plate.trim() && d.shipping_cost !== "" && fotos.courier && fotos.plate && fotos.product;
  return (
    <Modal open onClose={onClose} title="Derivar a motorizado externo" description="Con el nombre, la placa y tres fotos. El costo del envío entra como gasto de la ruta." footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!listo} onClick={async () => {
          setOcupado(true);
          try {
            await api(`/v1/del/app/paradas/${p.id}/derivar`, { method: "POST", body: { ...d, shipping_cost: Number(d.shipping_cost), client_event_id: nuevoId(),
              photo_courier_data: fotos.courier, photo_plate_data: fotos.plate, photo_product_data: fotos.product } });
            onListo();
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Derivar</Button>
      </>
    }>
      <div className="space-y-3">
        {p.pendiente > 0 && <Badge tone="warn">Cobro pendiente {soles(p.pendiente)}: lo confirma control al cerrar la derivación.</Badge>}
        <Field label="Nombre del motorizado" required><Input value={d.courier_name} onChange={(e) => setD({ ...d, courier_name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Placa" required><Input value={d.plate} onChange={(e) => setD({ ...d, plate: e.target.value.toUpperCase() })} placeholder="1234-AB" /></Field>
          <Field label="Celular"><Input inputMode="tel" value={d.courier_phone} onChange={(e) => setD({ ...d, courier_phone: e.target.value })} /></Field>
          <Field label="Costo del envío (S/)" required><Input type="number" inputMode="decimal" min={0} value={d.shipping_cost} onChange={(e) => setD({ ...d, shipping_cost: e.target.value })} /></Field>
          <Field label="Pagado con"><Select value={d.paid_with} onChange={(e) => setD({ ...d, paid_with: e.target.value })} options={lista(op.pagado_con)} /></Field>
        </div>
        <Field label="Foto del motorizado" required><Foto valor={fotos.courier} onChange={(v) => setFotos({ ...fotos, courier: v })} /></Field>
        <Field label="Foto de la placa" required><Foto valor={fotos.plate} onChange={(v) => setFotos({ ...fotos, plate: v })} /></Field>
        <Field label="Foto del producto que le entregas" required><Foto valor={fotos.product} onChange={(v) => setFotos({ ...fotos, product: v })} /></Field>
      </div>
    </Modal>
  );
}
