"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Link2, MapPin, MessageCircle, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Input, MapPicker, PageHeader, Select, StatusBadge, confirmAction, toast, type LatLng } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { ESTADOS as ESTADO_PEDIDO } from "@/modulos/ped/tipos";
import { FormVincular } from "@/modulos/web/FormVincular";
import { Crudo, ESTADO_BANDEJA, ESTADO_PAGO, Historial, MEDIO_MP, ORIGEN_BANDEJA, Seccion, Vacio, cuando, useDatos, type Historia } from "@/modulos/web/comunes";

export const ERRORES: Record<string, string> = {
  SKU_NOT_MAPPED: "SKU sin mapeo", VARIANT_INACTIVE: "Producto inactivo", PHONE_INVALID: "Celular inválido", ADDRESS_NO_PIN: "Dirección sin pin",
  PRICE_MISSING: "Sin precio web", INVALID_PAYLOAD: "Datos incompletos", PROCESSING_ERROR: "Error al crear el pedido",
};

type Pedido = { id: string; number: string; status: string; estimated_total: string; paid_amount: string | null; discount_total: string | null; discount_reason: string | null; delivery_fee: string | null; marca: string | null; faltan: { codigo: string; texto: string }[] };
type Linea = { sku: string | null; name: string | null; quantity: number | null; price: string | null; total: string | null; mapeo: "OK" | "SIN_MAPEO" | "INACTIVA"; mapping_id: string | null; variante: string | null };
type Pago = { id: string; external_payment_id: string; date_created: string; amount: string; status: string; payment_method: string | null; cobro: string | null };
type Detalle = {
  id: string; store_id: string; tienda: string; external_order_id: string; received_at: string; source: string; status: string; total: number; customer_name: string | null;
  attempts: number; auto_attempts: number; manual_only: boolean; duplicates: number; poll_hits: number; processed_at: string | null; error_code: string | null; error_detail: string | null;
  error_skus: string[]; warning_code: string | null; missing: string[]; ignore_reason: string | null; reintentos_max: number; celular_web: string | null; celular_corregido: string | null;
  correo: string | null; direccion_web: string; referencia_web: string | null; medio_web: string | null; nota: string | null; envio: string | null;
  pedidos: Pedido[]; lineas: Linea[]; pagos: Pago[];
  direccion: { id: string; address_line: string; district: string | null; reference: string | null; lat: string | null; lng: string | null; needs_pin: boolean; zone_id: string | null } | null;
  cliente: { id: string; full_name: string; phone: string | null } | null; distritos: string[]; min_referencia: number; local: { lat: string; lng: string } | null;
  history: Historia[]; payload: string; puede_resolver: boolean; puede_mapear: boolean;
};

/**
 * Detalle de un pedido web con la acción que corrige su error (WEB-05). En WEB-04 se abre dentro de un panel para quien
 * no tiene WEB-05 (la vendedora): ve el pedido y completa el pin; corregir y reprocesar exige web.inbox.resolve.
 */
export function FichaBandeja({ id, enPanel = false }: { id: string; enPanel?: boolean }) {
  const { datos: b, error, recargar } = useDatos<Detalle>(`/v1/web/bandeja/${id}`);
  const [trabajando, setTrabajando] = useState("");
  const [vincular, setVincular] = useState<string | null>(null);

  async function accion(nombre: string, ruta: string, body?: Record<string, unknown>, ok?: string) {
    setTrabajando(nombre);
    try {
      const r = await api<Detalle>(`/v1/web/bandeja/${id}/${ruta}`, { method: "POST", body });
      toast[r.status === "ERROR" ? "error" : "ok"](r.status === "ERROR" ? `Sigue con error: ${r.error_detail ?? r.error_code}` : (ok ?? "Listo."));
      recargar();
      return true;
    } catch (e) {
      toast.error(mensajeDe(e));
      return false;
    } finally {
      setTrabajando("");
    }
  }

  async function ignorar() {
    const r = await confirmAction({ title: `¿Ignorar el pedido web #${b?.external_order_id}?`, message: "No se creará ningún pedido. Queda en la bandeja con el motivo.", confirmLabel: "Ignorar", danger: true, reason: { label: "Motivo", min: 10 } });
    if (r) await accion("ignorar", "ignorar", { reason: r.reason }, "Pedido web ignorado.");
  }

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!b) return <Vacio>Cargando…</Vacio>;

  const abierto = b.status === "ERROR" || b.status === "RECEIVED";
  const resolver = b.puede_resolver && abierto;
  const sinPin = b.error_code === "ADDRESS_NO_PIN" || b.warning_code === "ADDRESS_NO_PIN";
  const skus = b.error_skus.length ? b.error_skus : b.lineas.filter((l) => l.mapeo !== "OK" && l.sku).map((l) => l.sku as string);

  return (
    <div className="space-y-5">
      {(() => {
        const botones = <>
          {resolver && <Button variant="danger" icon={Ban} disabled={Boolean(trabajando)} onClick={ignorar}>Ignorar</Button>}
          {resolver && <Button variant="primary" icon={RotateCcw} loading={trabajando === "reprocesar"} disabled={Boolean(trabajando)}
            onClick={() => accion("reprocesar", "reprocesar", undefined, "Reprocesado: pedido creado.")}>Reprocesar</Button>}
        </>;
        const lugar = `${b.tienda} · llegó ${cuando(b.received_at)} por ${(ORIGEN_BANDEJA[b.source] ?? b.source).toLowerCase()}`;
        return enPanel
          ? <div className="space-y-2"><p className="text-[13px] text-muted">{lugar}</p>{resolver && <div className="flex flex-wrap gap-2">{botones}</div>}</div>
          : <PageHeader description={lugar} actions={<>
              <Link href="/m/web/web-04" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary"><ArrowLeft size={15} aria-hidden="true" />Bandeja</Link>
              {botones}
            </>} />;
      })()}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[18px] font-semibold">Pedido web #{b.external_order_id}</span>
        <StatusBadge status={b.status} labels={ESTADO_BANDEJA} />
        {b.error_code && <Badge tone="bad">{ERRORES[b.error_code] ?? b.error_code}</Badge>}
        {b.warning_code === "ADDRESS_NO_PIN" && <Badge tone="warn">Sin pin</Badge>}
        {b.duplicates > 0 && <Badge tone="neutral">{b.duplicates} reenvío{b.duplicates === 1 ? "" : "s"} sin duplicar</Badge>}
      </div>
      {b.status === "ERROR" && (
        <Alert tone="bad" title={ERRORES[b.error_code ?? ""] ?? "Error"}>
          {b.error_detail}
          <div className="mt-1 text-[12.5px]">
            {b.manual_only ? "Ya no se reintenta solo: resuélvelo y reprocesa." : `Reintentos automáticos: ${b.auto_attempts} de ${b.reintentos_max}.`} Intentos en total: {b.attempts}.
          </div>
        </Alert>
      )}
      {b.status === "IGNORED" && <Alert tone="info" title="Ignorado">{b.ignore_reason}</Alert>}
      {b.status === "PROCESSED" && !sinPin && <Alert tone="ok">Procesado {cuando(b.processed_at)}: no hay nada que resolver.</Alert>}
      {!b.puede_resolver && abierto && !sinPin && <Alert tone="info">Tu rol puede ver este pedido web, pero no corregirlo: avisa a la supervisora.</Alert>}

      <div className={enPanel ? "space-y-4" : "grid gap-4 lg:grid-cols-3"}>
        <div className={enPanel ? "min-w-0 space-y-4" : "min-w-0 space-y-4 lg:col-span-2"}>
          {resolver && (b.error_code === "SKU_NOT_MAPPED" || b.error_code === "VARIANT_INACTIVE") && (
            <Seccion titulo={b.error_code === "SKU_NOT_MAPPED" ? "Vincula el SKU" : "Producto inactivo"}>
              <p className="mb-2 text-[13px] text-muted">
                {b.error_code === "SKU_NOT_MAPPED" ? "Vincula cada SKU a su variante del catálogo y reprocesa." : "La variante está inactiva o no se vende: actívala en Catálogo o vincula el SKU a otra variante, y reprocesa."}
              </p>
              <ul className="divide-y divide-line">
                {skus.map((s) => (
                  <li key={s} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                    <span className="font-medium">{s}</span>
                    {b.puede_mapear ? <Button size="sm" icon={Link2} onClick={() => setVincular(s)}>Vincular</Button>
                      : <span className="text-[12.5px] text-muted">Pide a marketing que lo vincule en Mapeo (WEB-02).</span>}
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
          {resolver && b.error_code === "PHONE_INVALID" && <Celular b={b} trabajando={trabajando} onGuardar={(phone) => accion("celular", "celular", { phone }, "Celular corregido y reprocesado.")} />}
          {resolver && b.error_code === "PRICE_MISSING" && (
            <Alert tone="warn" title="Sin precio web">Carga el precio en la lista de precios de la tienda (Catálogo) y reprocesa.</Alert>
          )}
          {sinPin && b.direccion && <Pin b={b} trabajando={trabajando} setTrabajando={setTrabajando} accion={accion} onListo={recargar} />}

          <Seccion titulo={`Productos (${b.lineas.length})`}>
            {!b.lineas.length ? <Vacio>El pedido no trae productos.</Vacio> : (
              <ul className="divide-y divide-line">
                {b.lineas.map((l, k) => (
                  <li key={k} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                    <div className="min-w-0">
                      <div className="font-medium">{l.name ?? "—"}</div>
                      <div className="text-[12px] text-muted">{l.sku ?? "sin SKU"} · {l.quantity} × {soles(Number(l.price ?? 0))}{l.variante && l.mapeo === "OK" ? ` · ${l.variante}` : ""}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="tabular-nums">{soles(Number(l.total ?? 0))}</span>
                      {l.mapeo !== "OK" && <Badge tone="bad">{l.mapeo === "SIN_MAPEO" ? "Sin mapeo" : "Inactiva"}</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-[13.5px] font-medium">
              <span>Total en la web{b.envio && Number(b.envio) > 0 ? ` (envío ${soles(Number(b.envio))})` : ""}</span><span className="tabular-nums">{soles(b.total)}</span>
            </div>
          </Seccion>

          <Seccion titulo="Pedidos creados">
            {!b.pedidos.length ? <Vacio>Todavía ninguno.</Vacio> : (
              <ul className="divide-y divide-line">
                {b.pedidos.map((o) => (
                  <li key={o.id} className="py-2 text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link className="font-medium text-primary underline" href={`/m/ped/ped-03?id=${o.id}`}>{o.number}</Link>
                      <StatusBadge status={o.status} labels={ESTADO_PEDIDO} />
                    </div>
                    <div className="text-[12px] text-muted">
                      {o.marca ?? "—"} · {soles(Number(o.estimated_total))} · pagado {soles(Number(o.paid_amount ?? 0))}
                      {o.discount_total && Number(o.discount_total) > 0 ? ` · descuento ${soles(Number(o.discount_total))}${o.discount_reason ? ` (${o.discount_reason})` : ""}` : ""}
                    </div>
                    {o.faltan.length > 0 && <div className="mt-1 text-[12px] text-warn">En borrador, falta: {o.faltan.map((x) => x.texto).join(", ")}</div>}
                    {o.status === "DRAFT" && !o.faltan.length && <div className="mt-1 text-[12px] text-warn">En borrador: el motivo está en el historial (por ejemplo, sin stock). Se confirma en Pedidos.</div>}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Pagos de Mercado Pago">
            {!b.pagos.length ? <Vacio>Sin pagos para este pedido web.</Vacio> : (
              <ul className="divide-y divide-line">
                {b.pagos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                    <div className="min-w-0">
                      {enPanel ? <span className="font-medium">{p.external_payment_id}</span> : <Link className="font-medium text-primary underline" href={`/m/web/web-06?id=${p.id}`}>{p.external_payment_id}</Link>}
                      <div className="text-[12px] text-muted">{cuando(p.date_created)} · {MEDIO_MP[p.payment_method ?? ""] ?? p.payment_method ?? "—"} · {soles(Number(p.amount))}{p.cobro ? ` · cobro ${p.cobro}` : ""}</div>
                    </div>
                    <StatusBadge status={p.status} labels={ESTADO_PAGO} />
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>

        <div className="min-w-0 space-y-4">
          <Seccion titulo="Lo que llegó de la web">
            <DetailList items={[
              { label: "Cliente", value: b.cliente ? <Link className="text-primary underline" href={`/m/cli/cli-02?id=${b.cliente.id}`}>{b.cliente.full_name}</Link> : (b.customer_name ?? "—") },
              { label: "Celular", value: b.celular_corregido ? `${b.celular_corregido} (corregido; llegó ${b.celular_web ?? "vacío"})` : (b.celular_web ?? "—") },
              { label: "Correo", value: b.correo ?? "—" },
              { label: "Dirección", value: b.direccion_web || "—" },
              { label: "Referencia", value: b.referencia_web || "—" },
              { label: "Medio de pago", value: b.medio_web ?? "—" },
              { label: "Nota del cliente", value: b.nota || "—" },
              { label: "Recepción", value: `${ORIGEN_BANDEJA[b.source] ?? b.source}${b.poll_hits ? ` · visto ${b.poll_hits} vez(es) por la consulta de respaldo` : ""}` },
            ]} />
          </Seccion>
          <Seccion titulo="Historial"><Historial items={b.history} /></Seccion>
          <Seccion><Crudo titulo="Cuerpo recibido (JSON)" valor={b.payload} /></Seccion>
        </div>
      </div>
      {vincular && <FormVincular tienda={b.store_id} sku={vincular} onClose={() => setVincular(null)} onListo={() => { setVincular(null); recargar(); }} />}
    </div>
  );
}

function Celular({ b, trabajando, onGuardar }: { b: Detalle; trabajando: string; onGuardar: (phone: string) => Promise<boolean> }) {
  const [phone, setPhone] = useState(b.celular_corregido ?? "");
  const valido = /^9\d{8}$/.test(phone.replace(/\D/g, "").replace(/^51(?=9\d{8}$)/, ""));
  async function guardar(e: FormEvent) {
    e.preventDefault();
    await onGuardar(phone);
  }
  return (
    <Seccion titulo="Corrige el celular">
      <form onSubmit={guardar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Celular correcto" hint={`Llegó «${b.celular_web ?? ""}». Confírmalo con el cliente${b.correo ? ` (${b.correo})` : ""}.`} required>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={15} placeholder="987654321" />
        </Field>
        <Button variant="primary" type="submit" loading={trabajando === "celular"} disabled={!valido || Boolean(trabajando)}>Corregir y reprocesar</Button>
      </form>
    </Seccion>
  );
}

function Pin({ b, trabajando, setTrabajando, accion, onListo }: {
  b: Detalle; trabajando: string; setTrabajando: (v: string) => void; onListo: () => void;
  accion: (nombre: string, ruta: string, body?: Record<string, unknown>, ok?: string) => Promise<boolean>;
}) {
  const d = b.direccion!;
  const [pin, setPin] = useState<LatLng | null>(d.lat && d.lng ? { lat: Number(d.lat), lng: Number(d.lng) } : null);
  const [f, setF] = useState({ address_line: d.address_line ?? "", district: d.district ?? "", reference: d.reference ?? "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const local = b.local?.lat ? [{ lat: Number(b.local.lat), lng: Number(b.local.lng), label: "Local" }] : [];

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!pin) return;
    setErrores({});
    setTrabajando("pin");
    try {
      const r = await api<Detalle>(`/v1/web/bandeja/${b.id}/pin`, { method: "POST", body: { ...f, lat: pin.lat, lng: pin.lng } });
      const ultimo = r.history[0];
      toast.ok(ultimo?.detail ?? "Pin guardado.");
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      toast.error(mensajeDe(err));
    } finally {
      setTrabajando("");
    }
  }

  async function enlace() {
    setTrabajando("enlace");
    try {
      const r = await api<{ token: string; horas: number; phone: string | null; nombre: string }>(`/v1/web/bandeja/${b.id}/enlace`, { method: "POST" });
      const url = `${window.location.origin}/u/${r.token}`;
      const texto = `Hola ${r.nombre}, para entregar tu pedido web #${b.external_order_id} necesitamos tu ubicación exacta. Márcala aquí: ${url} (vence en ${r.horas} h). ¡Gracias!`;
      if (r.phone) window.open(`https://wa.me/${r.phone.replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
      else await navigator.clipboard?.writeText(texto);
      toast.ok(r.phone ? "Enlace creado: se abrió WhatsApp con el mensaje." : "Enlace creado y copiado: el cliente no tiene celular.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTrabajando("");
    }
  }

  return (
    <Seccion titulo="Marca el pin de la entrega" acciones={<>
      <Button size="sm" icon={MessageCircle} loading={trabajando === "enlace"} disabled={Boolean(trabajando)} onClick={enlace}>Pedir ubicación por WhatsApp</Button>
      <Button size="sm" icon={MapPin} loading={trabajando === "ubicacion"} disabled={Boolean(trabajando)}
        onClick={() => accion("ubicacion", "ubicacion", undefined, "Se usó la ubicación que envió el cliente.")}>Usar la que envió el cliente</Button>
    </>}>
      <p className="mb-3 text-[13px] text-muted">El pedido queda en borrador hasta tener el pin y el pago aprobado (RN-WEB-07). Marca el punto en el mapa o pide al cliente que lo envíe.</p>
      <form onSubmit={guardar} className="space-y-3">
        <MapPicker value={pin} onChange={setPin} references={local} height={280} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitud" error={errores.lat}>
            <Input type="number" step="any" min={-90} max={90} value={pin?.lat ?? ""} placeholder="-12.1385"
              onChange={(e) => setPin(e.target.value === "" ? null : { lat: Number(e.target.value), lng: pin?.lng ?? 0 })} />
          </Field>
          <Field label="Longitud" error={errores.lng}>
            <Input type="number" step="any" min={-180} max={180} value={pin?.lng ?? ""} placeholder="-76.9905"
              onChange={(e) => setPin(e.target.value === "" ? null : { lat: pin?.lat ?? 0, lng: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dirección" error={errores.address_line}>
            <Input value={f.address_line} onChange={(e) => setF((x) => ({ ...x, address_line: e.target.value }))} maxLength={200} />
          </Field>
          <Field label="Distrito" error={errores.district}>
            <Select value={f.district} onChange={(e) => setF((x) => ({ ...x, district: e.target.value }))} placeholder="Elige el distrito"
              options={Array.from(new Set([...(f.district ? [f.district] : []), ...b.distritos])).map((x) => ({ value: x, label: x }))} />
          </Field>
        </div>
        <Field label="Referencia" error={errores.reference} hint={`Al menos ${b.min_referencia} caracteres.`}>
          <Input value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} maxLength={200} />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" type="submit" icon={MapPin} loading={trabajando === "pin"} disabled={!pin || !pin.lat || !pin.lng || Boolean(trabajando)}>Guardar pin</Button>
        </div>
      </form>
    </Seccion>
  );
}
