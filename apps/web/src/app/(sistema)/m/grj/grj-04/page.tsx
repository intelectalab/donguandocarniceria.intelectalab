"use client";

import { useState } from "react";
import { Alert, Badge, Button, DetailList, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, kg, numero, porcentaje, soles } from "@/lib/formato";
import { useParametrosIniciales } from "@/modulos/alm/comunes";
import { DECISION_DISPUTA, ENVIO, Seccion, accion, limpio, useDatos, useOpcionesGrj, type Num, type OpcionesGrj } from "@/modulos/grj/comunes";

type Linea = { id: string; farm_item_code: string; farm_item_name: string; farm_lot_code: string | null; farm_origin: Record<string, string> | null; sent_qty: Num; sent_weight_kg: Num;
  unit_price: Num; mapping_id: string | null; received_qty: Num; received_weight_kg: Num; temp_c: Num; lot_id: string | null; lot_code?: string | null; difference_pct: Num;
  difference_reason: string | null; variant_id: string | null; variant_name?: string | null; sku?: string | null };
type Envio = { id: string; farm_document_type: string; farm_document_number: string; dispatched_at: string; expected_doc_type: string; total_sent_kg: Num; total_value: Num; status: string;
  error_message: string | null; received_at: string | null; received_by_name: string | null; supplier_name: string; receipt_number: string | null; doc_series: string | null; doc_number: string | null;
  doc_type: string | null; doc_total: Num; doc_igv: Num; was_disputed: boolean; agreement: string | null; confirmation_sent_at: string | null; lines: Linea[] };
type Pendiente = { id: string; farm_document_number: string; dispatched_at: string; total_sent_kg: Num };

/** GRJ-04 Recepción de un envío: kg y unidades enviados frente a recibidos, temperatura, lote de la granja, lote local, diferencia y motivo. */
export default function RecepcionEnvio() {
  const op = useOpcionesGrj();
  const p = useParametrosIniciales();
  const [elegido, setElegido] = useState<string | null>(null);
  const id = elegido ?? p?.get("envio") ?? null;
  const pendientes = useDatos<{ data: Pendiente[] }>("/v1/grj/envios?status=RECEIVED_PENDING,DISPUTED&per_page=50");
  const porDefecto = !id && pendientes.datos?.data[0]?.id;
  const actual = id ?? (porDefecto || null);
  const { datos: e, error, recargar } = useDatos<Envio>(actual ? `/v1/grj/envios/${actual}` : null);
  return (
    <div className="space-y-5">
      <PageHeader description={`Pesa lo que llegó y compáralo con lo que mandó la granja. Hasta ${op?.tolerance_pct ?? 1} % de diferencia se acepta; más, exige un motivo y el envío queda en disputa hasta acordarlo. Cada línea crea su lote local con el origen de la granja.`}
        actions={<div className="w-full sm:w-[320px]"><Select aria-label="Envío" value={actual ?? ""} placeholder="Elegir envío por recibir" onChange={(x) => { setElegido(x.target.value); try { window.history.replaceState(null, "", `?envio=${x.target.value}`); } catch { /* sin historial */ } }}
          options={[...(pendientes.datos?.data ?? []).map((d) => ({ value: d.id, label: `${d.farm_document_number} · ${fechaHora(d.dispatched_at)} · ${kg(d.total_sent_kg)}` })),
            ...(e && !(pendientes.datos?.data ?? []).some((d) => d.id === e.id) ? [{ value: e.id, label: `${e.farm_document_number} · ${ENVIO[e.status]?.[0] ?? e.status}` }] : [])]} /></div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {!actual && pendientes.datos && <Alert tone="ok">No hay envíos por recibir.</Alert>}
      {e && op && <Detalle e={e} op={op} onCambio={() => { recargar(); pendientes.recargar(); }} />}
    </div>
  );
}

function Detalle({ e, op, onCambio }: { e: Envio; op: OpcionesGrj; onCambio: () => void }) {
  const [cab, setCab] = useState({ warehouse_id: op.default_warehouse_id ?? "", vehicle_temp_c: "", scale_equipment_id: "", inspection_result: "OK" });
  const [ls, setLs] = useState(() => Object.fromEntries(e.lines.map((l) => [l.id, { received_weight_kg: String(l.sent_weight_kg ?? ""), received_qty: String(l.sent_qty ?? ""), temp_c: "", reason: "", decision: "ACCEPT" }])));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [disputa, setDisputa] = useState({ decision: "ACCEPT_RECEIVED", note: "" });
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
  const porRecibir = e.status === "RECEIVED_PENDING";
  const dif = (l: Linea) => { const r = n(ls[l.id]?.received_weight_kg ?? ""); const s = Number(l.sent_weight_kg); return r === null || !s ? null : ((r - s) / s) * 100; };
  async function recibir() {
    setGuardando(true); setErrores({});
    try {
      const r = await api<Envio>(`/v1/grj/envios/${e.id}/recibir`, { method: "POST", body: { warehouse_id: cab.warehouse_id || null, vehicle_temp_c: n(cab.vehicle_temp_c), scale_equipment_id: cab.scale_equipment_id || null,
        inspection_result: cab.inspection_result, lines: e.lines.map((l) => ({ id: l.id, received_weight_kg: n(ls[l.id].received_weight_kg), received_qty: n(ls[l.id].received_qty), temp_c: n(ls[l.id].temp_c),
          reason: ls[l.id].reason || null, decision: ls[l.id].decision })) } });
      toast.ok(r.status === "DISPUTED" ? "Recibido con diferencia: queda en disputa con la granja" : "Envío recibido y lotes creados"); onCambio();
    } catch (x) { const c = erroresDe(x); setErrores(c); if (!Object.keys(c).length) toast.error(mensajeDe(x)); } finally { setGuardando(false); }
  }
  return (
    <div className="space-y-5">
      {e.status === "ERROR" && <Alert tone="bad" title="El envío está detenido">{limpio(e.error_message)}</Alert>}
      {e.status === "DISPUTED" && <Alert tone="warn" title="En disputa con la granja">La diferencia supera la tolerancia. Acuérdala con la granja para cerrar la conciliación del mes.</Alert>}
      <Seccion titulo={`${e.farm_document_number} · ${e.supplier_name}`}>
        <DetailList items={[
          { label: "Estado", value: <StatusBadge status={e.status} labels={ENVIO} /> }, { label: "Despachado", value: fechaHora(e.dispatched_at) },
          { label: "Comprobante creado", value: e.doc_series ? `${e.doc_type === "INTERNAL_TRANSFER" ? "NTI" : "Factura"} ${e.doc_series}-${e.doc_number} · ${soles(e.doc_total)}${Number(e.doc_igv) ? ` (IGV ${soles(e.doc_igv)})` : " sin IGV"}` : "—" },
          { label: "Enviado", value: `${kg(e.total_sent_kg)} · ${soles(e.total_value)}` },
          { label: "Recibido", value: e.received_at ? `${fechaHora(e.received_at)} · ${e.received_by_name ?? ""}${e.receipt_number ? ` · ${e.receipt_number}` : ""}` : "Por recibir" },
          { label: "Confirmación a la granja", value: e.confirmation_sent_at ? fechaHora(e.confirmation_sent_at) : "—" },
        ]} />
      </Seccion>
      {porRecibir && op.can.receive && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Almacén" error={errores.warehouse_id}><Select value={cab.warehouse_id} onChange={(x) => setCab({ ...cab, warehouse_id: x.target.value })} options={op.warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} /></Field>
        <Field label="Temperatura del vehículo" error={errores.vehicle_temp_c}><Input inputMode="decimal" suffix="°C" value={cab.vehicle_temp_c} onChange={(x) => setCab({ ...cab, vehicle_temp_c: x.target.value })} /></Field>
        <Field label="Balanza" error={errores.scale_equipment_id}><Select value={cab.scale_equipment_id} placeholder="Elegir" onChange={(x) => setCab({ ...cab, scale_equipment_id: x.target.value })} options={op.scales.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} /></Field>
        <Field label="Inspección" error={errores.inspection_result}><Select value={cab.inspection_result} onChange={(x) => setCab({ ...cab, inspection_result: x.target.value })} options={[{ value: "OK", label: "Conforme" }, { value: "PENDING", label: "Por inspeccionar" }, { value: "OBSERVED", label: "Observada" }]} /></Field>
      </div>}
      <div className="space-y-3">
        {e.lines.map((l, i) => {
          const d = porRecibir ? dif(l) : l.difference_pct !== null ? Number(l.difference_pct) : null;
          const fuera = d !== null && Math.abs(d) > op.tolerance_pct;
          return (
            <div key={l.id} className={`rounded-xl border p-3 ${fuera ? "border-warn/50 bg-warn-soft" : "border-line bg-surface"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{l.farm_item_name} <span className="font-mono text-[12px] text-muted">{l.farm_item_code}</span></p>
                  <p className="text-[12px] text-muted">{l.variant_name ? `${l.sku} · ${l.variant_name}` : <Badge tone="bad">Sin mapear</Badge>} · lote de la granja {l.farm_lot_code ?? "—"}{l.lot_code ? ` · lote local ${l.lot_code}` : ""}</p>
                  {l.farm_origin && <p className="text-[12px] text-muted">{Object.values(l.farm_origin).join(" · ")}</p>}
                </div>
                <div className="text-right text-[13px]"><p>Enviado {kg(l.sent_weight_kg)} · {numero(l.sent_qty)} und · {soles(l.unit_price)} / kg</p>
                  {d !== null && <p className={fuera ? "font-semibold text-warn" : "text-muted"}>Diferencia {porcentaje(d, 2)}</p>}</div>
              </div>
              {porRecibir && op.can.receive ? <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Kg recibidos" error={errores[`lines.${i}.received_weight_kg`]}><Input inputMode="decimal" value={ls[l.id].received_weight_kg} onChange={(x) => setLs({ ...ls, [l.id]: { ...ls[l.id], received_weight_kg: x.target.value } })} /></Field>
                <Field label="Unidades"><Input inputMode="decimal" value={ls[l.id].received_qty} onChange={(x) => setLs({ ...ls, [l.id]: { ...ls[l.id], received_qty: x.target.value } })} /></Field>
                <Field label="Temperatura" error={errores[`lines.${i}.temp_c`]}><Input inputMode="decimal" suffix="°C" value={ls[l.id].temp_c} onChange={(x) => setLs({ ...ls, [l.id]: { ...ls[l.id], temp_c: x.target.value } })} /></Field>
                <Field label="Decisión"><Select value={ls[l.id].decision} onChange={(x) => setLs({ ...ls, [l.id]: { ...ls[l.id], decision: x.target.value } })} options={[{ value: "ACCEPT", label: "Aceptar" }, { value: "QUALITY_HOLD", label: "Retener para Calidad" }, { value: "REJECT", label: "Rechazar" }]} /></Field>
                <Field label={fuera ? "Motivo de la diferencia" : "Motivo"} required={fuera} error={errores[`lines.${i}.reason`]}><Input value={ls[l.id].reason} maxLength={200} onChange={(x) => setLs({ ...ls, [l.id]: { ...ls[l.id], reason: x.target.value } })} /></Field>
              </div> : l.received_weight_kg !== null && <p className="mt-1 text-[13px]">Recibido {kg(l.received_weight_kg)}{l.temp_c !== null ? ` · ${numero(l.temp_c, 1)} °C` : ""}{l.difference_reason ? ` · ${l.difference_reason}` : ""}</p>}
            </div>
          );
        })}
      </div>
      {porRecibir && op.can.receive && <div className="flex justify-end"><Button variant="primary" loading={guardando} onClick={recibir}>Registrar recepción</Button></div>}
      {e.status === "ERROR" && op.can.mapping && <Button onClick={() => accion({ title: "¿Reprocesar el envío?", message: "Úsalo después de mapear el ítem que faltaba.", confirmLabel: "Reprocesar" }, () => api(`/v1/grj/envios/${e.id}/reprocesar`, { method: "POST" }), "Envío reprocesado", onCambio)}>Reprocesar</Button>}
      {e.status === "DISPUTED" && op.can.agree && <Seccion titulo="Acuerdo con la granja">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decisión"><Select value={disputa.decision} onChange={(x) => setDisputa({ ...disputa, decision: x.target.value })} options={Object.entries(DECISION_DISPUTA).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Nota del acuerdo" required><Textarea rows={2} value={disputa.note} maxLength={300} onChange={(x) => setDisputa({ ...disputa, note: x.target.value })} /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button variant="primary" disabled={disputa.note.trim().length < 5} onClick={async () => {
          try { await api(`/v1/grj/envios/${e.id}/acuerdo`, { method: "POST", body: disputa }); toast.ok("Disputa resuelta"); onCambio(); } catch (x) { toast.error(mensajeDe(x)); } }}>Registrar acuerdo</Button></div>
      </Seccion>}
      {e.agreement && <Alert tone="info" title="Acuerdo">{limpio(e.agreement)}</Alert>}
    </div>
  );
}
