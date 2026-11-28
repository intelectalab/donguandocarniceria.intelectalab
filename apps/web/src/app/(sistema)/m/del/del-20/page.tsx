"use client";

import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, VerArchivo, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { APOYO, DERIVACION, NIVEL, lista, type Opciones } from "@/modulos/del/tipos";

type RutaRiesgo = { id: string; code: string; repartidor: string | null; riesgo: { abiertas: number; atraso_min: number; nivel: string } };
type Apoyo = {
  id: string; number: string; route_id: string; ruta: string; reason: string; late_min: number | null; status: string; pedido_por: string | null; requested_at: string;
  ruta_apoyo: string | null; resuelto_por: string | null; resolved_at: string | null; note: string | null; paradas: { id: string; seq: number; status: string }[];
};
type Derivacion = {
  id: string; number: string; ruta: string; pedido: string; cliente: string | null; courier_name: string; courier_phone: string | null; plate: string; shipping_cost: number;
  cod_pending: number; status: string; note: string | null; handed_at: string; closed_at: string | null; cerrado_por: string | null;
  photo_courier: string | null; photo_plate: string | null; photo_product: string | null;
};
type Datos = { rutas: RutaRiesgo[]; pedidos: Apoyo[]; derivaciones: Derivacion[] };

/** DEL-20 Apoyo entre rutas y derivación a motorizado externo: la coordinación asigna otra ruta, autoriza un externo o rechaza (RN-DEL-18, RN-DEL-19). */
export default function ApoyoPage() {
  const { can } = useSesion();
  const op = useOpciones();
  const [fecha, setFecha] = useState(hoyLima());
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/del/apoyos?fecha=${fecha}`);
  const [resolver, setResolver] = useState<Apoyo | null>(null);
  const [cerrar, setCerrar] = useState<Derivacion | null>(null);
  const planifica = can("del.route.plan");
  return (
    <div className="space-y-5">
      <PageHeader description="Cuando una ruta va atrasada, su repartidor pide apoyo con las paradas que no llegará a cubrir. Las derivaciones a un motorizado externo se cierran aquí." />
      <Field label="Fecha" className="max-w-[200px]"><Input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Field>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando || !datos ? <Vacio>Cargando…</Vacio> : (
        <>
          <Seccion titulo="Rutas en la calle">
            {!datos.rutas.length ? <Vacio>No hay rutas en ruta.</Vacio> : (
              <ul className="divide-y divide-line">
                {datos.rutas.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-[13.5px]">
                    <span><span className="font-medium text-ink">{r.code}</span> <span className="text-muted">· {r.repartidor ?? "—"} · {r.riesgo.abiertas} abierta(s){r.riesgo.atraso_min > 0 ? ` · ${r.riesgo.atraso_min} min de atraso` : ""}</span></span>
                    <StatusBadge status={r.riesgo.nivel} labels={NIVEL} />
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Seccion titulo={`Pedidos de apoyo (${datos.pedidos.length})`}>
            {!datos.pedidos.length ? <Vacio>Sin pedidos de apoyo.</Vacio> : (
              <ul className="divide-y divide-line">
                {datos.pedidos.map((q) => (
                  <li key={q.id} className="py-2.5 text-[13.5px]">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{q.number} · {q.ruta}</span>
                      <StatusBadge status={q.status} labels={APOYO} />
                    </span>
                    <span className="block text-[12.5px] text-muted">{q.pedido_por ?? "—"} · {fechaHora(q.requested_at)}{q.late_min ? ` · ${q.late_min} min de atraso` : ""}</span>
                    <span className="block">{q.reason}</span>
                    <span className="block text-[12.5px] text-muted">Paradas: {q.paradas.map((p) => p.seq).join(", ") || "—"}</span>
                    {q.status !== "REQUESTED" && <span className="block text-[12.5px] text-muted">{q.ruta_apoyo ? `Apoya ${q.ruta_apoyo} · ` : ""}{q.resuelto_por ?? ""}{q.note ? ` · ${q.note}` : ""}</span>}
                    {planifica && q.status === "REQUESTED" && <Button className="mt-2" size="sm" variant="primary" onClick={() => setResolver(q)}>Atender</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Seccion titulo={`Derivaciones a motorizado externo (${datos.derivaciones.length})`}>
            {!datos.derivaciones.length ? <Vacio>Sin derivaciones.</Vacio> : (
              <ul className="divide-y divide-line">
                {datos.derivaciones.map((h) => (
                  <li key={h.id} className="py-2.5 text-[13.5px]">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">{h.pedido} · {h.cliente ?? "—"}</span>
                      <StatusBadge status={h.status} labels={DERIVACION} />
                    </span>
                    <span className="block text-[12.5px] text-muted">{h.ruta} · {h.courier_name} ({h.plate}){h.courier_phone ? ` · ${h.courier_phone}` : ""} · envío {soles(h.shipping_cost)} · {fechaHora(h.handed_at)}</span>
                    {h.cod_pending > 0 && <Badge tone="warn">Cobra {soles(h.cod_pending)}</Badge>}
                    <span className="mt-1 flex flex-wrap gap-3">
                      {h.photo_courier && <VerArchivo id={h.photo_courier} texto="Motorizado" />}
                      {h.photo_plate && <VerArchivo id={h.photo_plate} texto="Placa" />}
                      {h.photo_product && <VerArchivo id={h.photo_product} texto="Producto" />}
                    </span>
                    {h.note && <span className="block text-[12.5px] text-muted">{h.note}</span>}
                    {planifica && h.status === "HANDED" && <Button className="mt-2" size="sm" variant="primary" onClick={() => setCerrar(h)}>Cerrar</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </>
      )}
      {resolver && datos && <Resolver q={resolver} rutas={datos.rutas.filter((r) => r.id !== resolver.route_id)} onClose={() => setResolver(null)} onListo={() => { setResolver(null); recargar(); }} />}
      {cerrar && op.datos && <Cerrar h={cerrar} op={op.datos} onClose={() => setCerrar(null)} onListo={() => { setCerrar(null); recargar(); }} />}
    </div>
  );
}

function Resolver({ q, rutas, onClose, onListo }: { q: Apoyo; rutas: RutaRiesgo[]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ action: "ASSIGN", to_route_id: "", note: "" });
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Atender ${q.number}`} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={d.action === "ASSIGN" && !d.to_route_id} onClick={async () => {
          setOcupado(true);
          try { await api(`/v1/del/apoyos/${q.id}/resolver`, { method: "POST", body: { ...d, to_route_id: d.action === "ASSIGN" ? d.to_route_id : null, note: d.note || null } }); toast.ok("Pedido de apoyo atendido."); onListo(); }
          catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Guardar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Decisión"><Select value={d.action} onChange={(e) => setD({ ...d, action: e.target.value })}
          options={[{ value: "ASSIGN", label: "Pasar las paradas a otra ruta" }, { value: "EXTERNAL", label: "Autorizar motorizado externo" }, { value: "REJECT", label: "Rechazar" }]} /></Field>
        {d.action === "ASSIGN" && (
          <Field label="Ruta que apoya" required><Select value={d.to_route_id} onChange={(e) => setD({ ...d, to_route_id: e.target.value })} placeholder="Elige la ruta"
            options={rutas.map((r) => ({ value: r.id, label: `${r.code} · ${r.repartidor ?? "—"} · ${r.riesgo.abiertas} abierta(s)` }))} /></Field>
        )}
        <Field label="Nota"><Textarea rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Cerrar({ h, op, onClose, onListo }: { h: Derivacion; op: Opciones; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ delivered: "1", note: "", method: "", reference: "", card_last4: "" });
  const [ocupado, setOcupado] = useState(false);
  const entrego = d.delivered === "1";
  const cobra = entrego && h.cod_pending > 0;
  return (
    <Modal open onClose={onClose} title={`Cerrar derivación ${h.pedido}`} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={(!entrego && !d.note.trim()) || (cobra && !d.method) || (cobra && d.method === "CARD" && !/^\d{4}$/.test(d.card_last4))} onClick={async () => {
          setOcupado(true);
          try {
            await api(`/v1/del/derivaciones/${h.id}/cerrar`, { method: "POST", body: { delivered: entrego, note: d.note || null, method: cobra ? d.method : null, reference: cobra ? d.reference || null : null, card_last4: cobra && d.method === "CARD" ? d.card_last4 : null } });
            toast.ok("Derivación cerrada."); onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Cerrar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Resultado"><Select value={d.delivered} onChange={(e) => setD({ ...d, delivered: e.target.value })} options={[{ value: "1", label: "Entregó" }, { value: "0", label: "No entregó" }]} /></Field>
        {cobra && (
          <>
            <Field label={`Cómo pagó el cliente (${soles(h.cod_pending)})`} required><Select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })} placeholder="Elige" options={lista(op.medios)} /></Field>
            <Field label="Referencia"><Input value={d.reference} onChange={(e) => setD({ ...d, reference: e.target.value })} /></Field>
            {d.method === "CARD" && <Field label="Últimos 4 dígitos de la tarjeta" required><Input inputMode="numeric" maxLength={4} value={d.card_last4} onChange={(e) => setD({ ...d, card_last4: e.target.value.replace(/\D/g, "") })} /></Field>}
          </>
        )}
        <Field label={entrego ? "Nota" : "Por qué no se entregó"} required={!entrego}><Textarea rows={2} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
