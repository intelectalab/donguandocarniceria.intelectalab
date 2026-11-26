"use client";

import { useState } from "react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { FiltroSelect, Seccion, Tabla, opcionesDe, useDatos } from "@/modulos/cal/comunes";
import { DECISION, GRAVEDAD, RESULTADO } from "@/modulos/cal/tipos";
import { ESTADO_LOTE, VARIABLE } from "@/modulos/pro/tipos";

type Fila = { id: string; code: string; origin: string; qc_status: string; production_date: string | null; expiry_date: string | null; production_order_ref: string | null; product_name: string;
  sanitary_authority: string | null; sku: string; establishment_name: string | null; stock_qty: string | null; last_inspection: string | null; open_nc: number; days_to_expiry: number | null; critical_deviation: boolean | null };
type Detalle = {
  lot: { id: string; code: string; qc_status: string; product_name: string; sku: string; production_date: string | null; expiry_date: string | null; supervisor_name: string | null; created_by_name: string | null; sanitary_registry: string | null; sanitary_registry_expires: string | null };
  order: { number: string; critical_deviation: boolean } | null;
  inspections: { id: string; number: string; result: string; score_pct: string; inspected_at: string; checklist_name: string }[];
  readings: { id: string; code: string; variable: string; value: string; unit: string | null; in_range: boolean; read_at: string; is_critical: boolean }[];
  nonconformities: { id: string; number: string; severity: string; status: string; description: string }[];
  decisions: { id: string; decision: string; decided_at: string; decided_by_name: string | null; reason: string | null }[];
  blocks: { code: string; msg: string; decisions?: string[] }[];
  can_decide: boolean;
  release_warehouses: { id: string; code: string; name: string }[];
};

/** CAL-07 Lotes por liberar: Calidad libera, retiene o rechaza cada lote de producción con su evidencia (RN-CAL-01 a 03, RN-CAL-10). */
export default function LotesPorLiberar() {
  const { local } = useSesion();
  const [estado, setEstado] = useState("QUARANTINE,BLOCKED");
  const lista = useListado<Fila>("/v1/cal/lotes", { orden: "-created_at", filtros: { status: estado, site: local } });
  const [ver, setVer] = useState<string | null>(null);
  const columnas: Column<Fila>[] = [
    { key: "code", header: "Lote", sortable: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "product_name", header: "Producto", sortable: true, cardTitle: true, render: (l) => <div><p className="font-medium">{l.product_name}</p><p className="text-[12px] text-muted">{l.sku} · {l.production_order_ref ?? "—"}</p></div> },
    { key: "production_date", header: "Producido", sortable: true, render: (l) => fecha(l.production_date) },
    { key: "expiry_date", header: "Vence", sortable: true, render: (l) => <span>{fecha(l.expiry_date)}{l.days_to_expiry !== null && <span className={`block text-[11.5px] ${l.days_to_expiry < 0 ? "text-bad" : "text-muted"}`}>{l.days_to_expiry < 0 ? "vencido" : `${l.days_to_expiry} d`}</span>}</span> },
    { key: "stock_qty", header: "Stock", align: "right", render: (l) => numero(l.stock_qty, 3) },
    { key: "last_inspection", header: "Inspección", render: (l) => l.last_inspection ? <StatusBadge status={l.last_inspection} labels={RESULTADO} /> : <Badge tone="warn">Sin inspección</Badge> },
    { key: "open_nc", header: "Alertas", render: (l) => <span className="flex flex-wrap gap-1">{l.open_nc > 0 && <Badge tone="bad">{l.open_nc} NC abierta(s)</Badge>}{l.critical_deviation && <Badge tone="bad">Desvío crítico</Badge>}{l.sanitary_authority === "DIGESA" && <Badge>DIGESA</Badge>}</span> },
    { key: "status", header: "Estado", render: (l) => <StatusBadge status={l.qc_status} labels={ESTADO_LOTE} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Los lotes de producción y despiece nacen en cuarentena. Quien supervisó la orden no libera su lote; sin inspección conforme, con una no conformidad abierta o sin registro DIGESA vigente, no se libera." />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(l) => setVer(l.id)} search={{ ...lista.tabla.search, placeholder: "Buscar lote, producto, SKU u orden…" }} empty="No hay lotes por decidir."
        toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={[{ value: "QUARANTINE,BLOCKED", label: "Por decidir" }, { value: "QUARANTINE", label: "En cuarentena" }, { value: "BLOCKED", label: "Retenidos" }, { value: "RELEASED", label: "Liberados" }, { value: "REJECTED", label: "Rechazados" }]} />} />
      {ver && <FichaLote id={ver} onClose={() => setVer(null)} onCambio={() => { setVer(null); lista.recargar(); }} />}
    </div>
  );
}

function FichaLote({ id, onClose, onCambio }: { id: string; onClose: () => void; onCambio: () => void }) {
  const { datos: d } = useDatos<Detalle>(`/v1/cal/lotes/${id}`);
  const [decision, setDecision] = useState("RELEASE");
  const [motivo, setMotivo] = useState("");
  const [destino, setDestino] = useState("WASTE");
  const [mover, setMover] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const decide = d && d.can_decide && ["QUARANTINE", "BLOCKED"].includes(d.lot.qc_status);
  const bloqueaLiberar = (d?.blocks ?? []).length > 0 && decision.startsWith("RELEASE");
  return (
    <Modal open onClose={onClose} size="lg" title={d ? `${d.lot.code} · ${d.lot.product_name}` : "Lote"}
      footer={decide && <><Button onClick={onClose}>Cancelar</Button><Button variant={decision === "REJECT" ? "danger" : "primary"} loading={enviando} onClick={async () => {
        setEnviando(true); setError("");
        try {
          await api(`/v1/cal/lotes/${id}/decision`, { method: "POST", body: { decision, reason: motivo || null, reject_destination: decision === "REJECT" ? destino : null, move_to: decision.startsWith("RELEASE") ? mover || null : null } });
          toast.ok(`${d.lot.code}: ${DECISION[decision].toLowerCase()}`); onCambio();
        } catch (e) { setError(mensajeDe(e)); } finally { setEnviando(false); }
      }}>{DECISION[decision]}</Button></>}>
      {d && <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px]"><StatusBadge status={d.lot.qc_status} labels={ESTADO_LOTE} /><span className="text-muted">{d.lot.sku} · producido {fecha(d.lot.production_date)} · vence {fecha(d.lot.expiry_date)}{d.order ? ` · orden ${d.order.number}` : ""}{d.lot.supervisor_name ? ` · supervisó ${d.lot.supervisor_name}` : ""}</span></div>
        {d.blocks.map((b) => <Alert key={b.code + b.msg} tone="warn">{b.msg}</Alert>)}
        <Seccion titulo="Inspecciones"><Tabla cabeza={["Número", "Checklist", "Fecha", "Resultado"]} filas={d.inspections.map((i) => [i.number, i.checklist_name, fechaHora(i.inspected_at), <StatusBadge key="r" status={i.result} labels={RESULTADO} />])} vacio="Sin inspecciones." /></Seccion>
        {d.readings.length > 0 && <Seccion titulo="Puntos de control de la orden"><Tabla cabeza={["Punto", "Valor", "Hora", ""]} filas={d.readings.map((r) => [`${r.code} · ${VARIABLE[r.variable] ?? r.variable}${r.is_critical ? " (crítico)" : ""}`, `${numero(r.value, 1)} ${r.unit ?? ""}`, fechaHora(r.read_at), r.in_range ? <Badge key="b" tone="ok">En rango</Badge> : <Badge key="b" tone="bad">Fuera</Badge>])} /></Seccion>}
        {d.nonconformities.length > 0 && <Seccion titulo="No conformidades"><Tabla cabeza={["Número", "Gravedad", "Estado", "Descripción"]} filas={d.nonconformities.map((n) => [n.number, <StatusBadge key="g" status={n.severity} labels={GRAVEDAD} />, n.status === "CLOSED" ? "Cerrada" : "Abierta", n.description])} /></Seccion>}
        {d.decisions.length > 0 && <Seccion titulo="Decisiones anteriores"><Tabla cabeza={["Decisión", "Fecha", "Quién", "Motivo"]} filas={d.decisions.map((x) => [DECISION[x.decision] ?? x.decision, fechaHora(x.decided_at), x.decided_by_name ?? "—", x.reason ?? "—"])} /></Seccion>}
        {decide && <Seccion titulo="Decisión">
          <div className="grid gap-3 sm:grid-cols-2">
            {error && <div className="sm:col-span-2"><Alert tone="bad">{error}</Alert></div>}
            <Field label="Decisión" required><Select value={decision} options={opcionesDe(DECISION)} onChange={(e) => setDecision(e.target.value)} /></Field>
            {decision.startsWith("RELEASE") && <Field label="Mover a" hint="Al liberar, el stock sale de cuarentena"><Select value={mover} placeholder="Dejar donde está" options={d.release_warehouses.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} onChange={(e) => setMover(e.target.value)} /></Field>}
            {decision === "REJECT" && <Field label="Destino" required><Select value={destino} options={[{ value: "WASTE", label: "Merma" }, { value: "REPROCESS", label: "Reproceso" }]} onChange={(e) => setDestino(e.target.value)} /></Field>}
            <Field label="Motivo u observación" required={decision !== "RELEASE"} className="sm:col-span-2"><Input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
            {bloqueaLiberar && <p className="text-[12.5px] text-warn sm:col-span-2">Con los avisos de arriba, la liberación se rechazará: retén el lote o resuelve lo pendiente.</p>}
          </div>
        </Seccion>}
        {!d.can_decide && <Alert tone="info">Solo Calidad decide sobre el lote.</Alert>}
      </div>}
    </Modal>
  );
}
