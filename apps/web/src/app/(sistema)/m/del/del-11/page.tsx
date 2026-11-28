"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dato, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PEDIDO, PROVINCIA, lista } from "@/modulos/del/tipos";

type Guia = { id: string; full_number: string; issue_date: string; status: string; sunat_status: string | null };
type Envio = {
  id: string; order_id: string; pedido: string; cliente: string | null; order_status: string; delivery_date: string; agency_supplier_id: string; agencia: string | null;
  packaging: string; packages: number; weight_kg: number; freight_cost: number; packaging_cost: number; charged_to_customer: number; destination: string;
  destination_ubigeo: string | null; status: string; tracking_number: string | null; dispatch_guide_id: string | null; guia: string | null; notes: string | null;
  handed_at: string | null; delivered_at: string | null; guias: Guia[]; siguientes: string[];
};
type Pendiente = {
  id: string; number: string; cliente: string | null; status: string; delivery_date: string; province_destination: string | null; province_agency: string | null;
  thermal_packaging: boolean; kg: number; guias: Guia[];
};

const EMBALAJES = { THERMAL_BOX: "Caja térmica", BOX: "Caja", BAG: "Bolsa", COOLER: "Cooler" };

/** DEL-11 Envíos a provincia: agencia, embalaje, guía de remisión (la emite Comprobantes), seguimiento, flete y empaque (RN-DEL-12). */
export default function Provincia() {
  const { can } = useSesion();
  const op = useOpciones();
  const [tab, setTab] = useState("activos");
  const { datos, error, cargando, recargar } = useDatos<{ data: Envio[]; pedidos: Pendiente[] }>("/v1/del/provincia");
  const [nuevo, setNuevo] = useState<Pendiente | null>(null);
  const [editar, setEditar] = useState<Envio | null>(null);
  const gestiona = can("del.province.manage");
  const agencias = (op.datos?.agencias ?? []).map((a) => ({ value: a.id, label: a.trade_name ?? a.legal_name }));
  const envios = (datos?.data ?? []).filter((e) => (tab === "activos" ? ["PREPARED", "HANDED_TO_AGENCY", "IN_TRANSIT"].includes(e.status) : !["PREPARED", "HANDED_TO_AGENCY", "IN_TRANSIT"].includes(e.status)));

  const mover = async (e: Envio, status: string) => {
    const pide = ["RETURNED", "LOST"].includes(status);
    const c = await confirmAction({ title: `Marcar como ${PROVINCIA[status]?.[0].toLowerCase()}`, danger: pide, confirmLabel: "Confirmar",
      reason: pide ? { label: "Qué pasó con el envío", min: 5 } : undefined });
    if (!c) return;
    try { await api(`/v1/del/provincia/${e.id}/estado`, { method: "POST", body: { status, note: c.reason ?? null } }); toast.ok("Envío actualizado."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
  };

  const aAgencia = async (e: Envio) => {
    const c = await confirmAction({ title: `Entregar ${e.pedido} a ${e.agencia ?? "la agencia"}`, confirmLabel: "Entregado a la agencia",
      message: "El pedido pasa a «en ruta» y el flete y el empaque se cargan a los costos de reparto.",
      reason: e.tracking_number ? { label: `Seguimiento (vacío para usar ${e.tracking_number})`, optional: true } : { label: "Número de seguimiento de la agencia", min: 1 } });
    if (!c) return;
    try { await api(`/v1/del/provincia/${e.id}/agencia`, { method: "POST", body: { tracking_number: c.reason || null } }); toast.ok("Entregado a la agencia."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader description="Pedidos que viajan por agencia. Para entregarlo a la agencia hace falta la guía de remisión electrónica del pedido y el número de seguimiento." />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : (
        <>
          <Seccion titulo={`Pedidos por enviar (${datos?.pedidos.length ?? 0})`}>
            {!datos?.pedidos.length ? <Vacio>No hay pedidos a provincia sin envío.</Vacio> : (
              <ul className="divide-y divide-line">
                {datos.pedidos.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{p.number} · {p.cliente ?? "—"}</span>
                      <span className="text-[12.5px] text-muted">{p.province_destination ?? "Sin destino"} · {kg(p.kg)} · {fecha(p.delivery_date)}{p.thermal_packaging ? " · caja térmica" : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge status={p.status} labels={PEDIDO} />
                      {gestiona && <Button size="sm" icon={Plus} onClick={() => setNuevo(p)}>Preparar envío</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Tabs value={tab} onChange={setTab} tabs={[{ key: "activos", label: "En curso" }, { key: "cerrados", label: "Cerrados" }]} />
          {!envios.length ? <Vacio>No hay envíos aquí.</Vacio> : (
            <div className="grid gap-4 md:grid-cols-2">
              {envios.map((e) => (
                <Seccion key={e.id} titulo={`${e.pedido} → ${e.destination}`} acciones={<StatusBadge status={e.status} labels={PROVINCIA} />}>
                  <Dato label="Cliente">{e.cliente ?? "—"}</Dato>
                  <Dato label="Agencia">{e.agencia ?? "—"}</Dato>
                  <Dato label="Embalaje">{EMBALAJES[e.packaging as keyof typeof EMBALAJES] ?? e.packaging} · {e.packages} bulto(s) · {kg(e.weight_kg)}</Dato>
                  <Dato label="Guía de remisión">{e.guia ?? <Badge tone="warn">Falta</Badge>}</Dato>
                  <Dato label="Seguimiento">{e.tracking_number ?? "—"}</Dato>
                  <Dato label="Flete + empaque">{soles(e.freight_cost)} + {soles(e.packaging_cost)}</Dato>
                  <Dato label="Cobrado al cliente">{soles(e.charged_to_customer)}</Dato>
                  {e.notes && <p className="mt-1 text-[12.5px] text-muted">{e.notes}</p>}
                  {gestiona && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {e.status === "PREPARED" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditar(e)}>Editar</Button>
                          <Button size="sm" variant="primary" onClick={() => aAgencia(e)}>Entregar a la agencia</Button>
                        </>
                      )}
                      {e.siguientes.map((s) => (
                        <Button key={s} size="sm" variant={s === "DELIVERED" ? "primary" : "ghost"} onClick={() => mover(e, s)}>{PROVINCIA[s]?.[0] ?? s}</Button>
                      ))}
                    </div>
                  )}
                </Seccion>
              ))}
            </div>
          )}
        </>
      )}
      {(nuevo || editar) && (
        <FormEnvio p={nuevo} e={editar} agencias={agencias} onClose={() => { setNuevo(null); setEditar(null); }}
          onListo={() => { setNuevo(null); setEditar(null); recargar(); }} />
      )}
    </div>
  );
}

function FormEnvio({ p, e, agencias, onClose, onListo }: { p: Pendiente | null; e: Envio | null; agencias: { value: string; label: string }[]; onClose: () => void; onListo: () => void }) {
  const guias = e?.guias ?? p?.guias ?? [];
  const [d, setD] = useState({
    agency_supplier_id: e?.agency_supplier_id ?? p?.province_agency ?? "", destination: e?.destination ?? p?.province_destination ?? "",
    packaging: e?.packaging ?? (p?.thermal_packaging ? "THERMAL_BOX" : "BOX"), packages: String(e?.packages ?? 1), weight_kg: String(e?.weight_kg ?? p?.kg ?? ""),
    freight_cost: e ? String(e.freight_cost) : "", packaging_cost: e ? String(e.packaging_cost) : "", charged_to_customer: e ? String(e.charged_to_customer) : "",
    dispatch_guide_id: e?.dispatch_guide_id ?? guias[0]?.id ?? "", tracking_number: e?.tracking_number ?? "", notes: e?.notes ?? "",
  });
  const [ocupado, setOcupado] = useState(false);
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <Modal open onClose={onClose} title={e ? `Editar envío ${e.pedido}` : `Preparar envío ${p?.number}`} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={!d.destination.trim() || (!e && !d.agency_supplier_id)} onClick={async () => {
          setOcupado(true);
          try {
            const body = { ...(e ? {} : { order_id: p!.id, agency_supplier_id: d.agency_supplier_id }), destination: d.destination, packaging: d.packaging, packages: Number(d.packages) || 1,
              weight_kg: num(d.weight_kg), freight_cost: num(d.freight_cost), packaging_cost: num(d.packaging_cost), charged_to_customer: num(d.charged_to_customer),
              dispatch_guide_id: d.dispatch_guide_id || null, tracking_number: d.tracking_number || null, notes: d.notes || null };
            await api(e ? `/v1/del/provincia/${e.id}` : "/v1/del/provincia", { method: e ? "PUT" : "POST", body });
            toast.ok("Envío guardado.");
            onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Guardar</Button>
      </>
    }>
      <div className="space-y-3">
        {!e && <Field label="Agencia" required><Select value={d.agency_supplier_id} onChange={(x) => setD({ ...d, agency_supplier_id: x.target.value })} placeholder="Elige la agencia" options={agencias} /></Field>}
        <Field label="Destino" required hint="Ciudad o agencia de destino"><Input value={d.destination} onChange={(x) => setD({ ...d, destination: x.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Embalaje"><Select value={d.packaging} onChange={(x) => setD({ ...d, packaging: x.target.value })} options={lista(EMBALAJES)} /></Field>
          <Field label="Bultos"><Input type="number" inputMode="numeric" min={1} value={d.packages} onChange={(x) => setD({ ...d, packages: x.target.value })} /></Field>
          <Field label="Peso (kg)"><Input type="number" inputMode="decimal" min={0} step="0.001" value={d.weight_kg} onChange={(x) => setD({ ...d, weight_kg: x.target.value })} /></Field>
          <Field label="Flete (S/)"><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.freight_cost} onChange={(x) => setD({ ...d, freight_cost: x.target.value })} /></Field>
          <Field label="Empaque (S/)"><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.packaging_cost} onChange={(x) => setD({ ...d, packaging_cost: x.target.value })} /></Field>
          <Field label="Cobrado al cliente (S/)"><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.charged_to_customer} onChange={(x) => setD({ ...d, charged_to_customer: x.target.value })} /></Field>
        </div>
        <Field label="Guía de remisión" hint={guias.length ? undefined : "El pedido aún no tiene guía: emítela en Comprobantes."}>
          <Select value={d.dispatch_guide_id} onChange={(x) => setD({ ...d, dispatch_guide_id: x.target.value })} placeholder="Sin guía" options={guias.map((g) => ({ value: g.id, label: `${g.full_number} · ${fecha(g.issue_date)}` }))} />
        </Field>
        <Field label="Número de seguimiento"><Input value={d.tracking_number} onChange={(x) => setD({ ...d, tracking_number: x.target.value })} /></Field>
        <Field label="Notas"><Textarea rows={2} value={d.notes} onChange={(x) => setD({ ...d, notes: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}
