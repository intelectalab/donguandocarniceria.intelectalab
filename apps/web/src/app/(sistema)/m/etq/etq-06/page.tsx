"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Siren, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, Field, PageHeader, Select, StatusBadge, Textarea, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero } from "@/lib/formato";
import { BuscarLote, ESTADO_LOTE, RIESGO, Seccion, Tabla, useAlAbrir, useOpcionesEtq, type Num } from "@/modulos/etq/comunes";

type Alcance = { lots: { lot_id: string; code: string; product: string; qc_status: string; is_descendant: boolean; stock_qty: Num }[];
  customers: { customer_id: string | null; customer_name: string; phone: string | null; kg: Num; references: string[] }[]; open_orders: string[]; stock_qty: Num; sold_kg: Num };

/** ETQ-06 Nuevo retiro: motivo, clase de riesgo, lotes y derivados; la vista previa muestra los clientes y el stock que se bloquea antes de confirmar (RN-ETQ-06, RN-ETQ-07). */
export default function NuevoRetiro() {
  const router = useRouter();
  const op = useOpcionesEtq();
  const [lotes, setLotes] = useState<{ id: string; code: string }[]>([]);
  const [f, setF] = useState({ reason: "", risk_class: "CLASS_II", include_descendants: true });
  const [alcance, setAlcance] = useState<Alcance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const calcular = async (ids: string[], derivados: boolean) => {
    if (!ids.length) { setAlcance(null); return; }
    setOcupado(true); setError(null);
    try {
      const a = await api<Alcance>("/v1/etq/retiros/previa", { method: "POST", body: { lot_ids: ids, include_descendants: derivados } });
      setAlcance(a);
      setLotes((x) => x.map((l) => ({ ...l, code: l.code || a.lots.find((y) => y.lot_id === l.id)?.code || "" })));
    } catch (e) { setError(mensajeDe(e)); } finally { setOcupado(false); }
  };
  useAlAbrir((p) => { const id = p.get("lot"); if (id) { setLotes([{ id, code: "" }]); void calcular([id], true); } });
  const quitar = (id: string) => { const n = lotes.filter((l) => l.id !== id); setLotes(n); void calcular(n.map((l) => l.id), f.include_descendants); };
  const iniciar = async () => {
    if (!alcance) return;
    const ok = await confirmAction({ title: "¿Iniciar el retiro?", danger: true, confirmLabel: "Iniciar retiro",
      message: `Se bloquea el stock de ${alcance.lots.length} lote(s) y se arma la lista de ${alcance.customers.length} cliente(s) para contactar. No se puede deshacer.` });
    if (!ok) return;
    setOcupado(true); setError(null);
    try {
      const r = await api<{ id: string; number: string }>("/v1/etq/retiros", { method: "POST", body: { lot_ids: lotes.map((l) => l.id), ...f } });
      toast.ok(`Retiro ${r.number} iniciado`); router.push(`/m/etq/etq-07?id=${r.id}`);
    } catch (e) { setError(mensajeDe(e)); setOcupado(false); }
  };
  if (op && !op.can.start_recall) return <Alert tone="info">Iniciar un retiro lo hace Calidad o Gerencia.</Alert>;
  return (
    <div className="space-y-5">
      <PageHeader description="Agrega los lotes afectados. Con «incluir derivados» también se retiran los lotes producidos con ellos. Revisa el alcance antes de confirmar." />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Seccion titulo="Retiro">
          <div className="space-y-3">
            <Field label="Lotes" required>
              <BuscarLote onElegir={(l) => { if (lotes.some((x) => x.id === l.id)) return; const n = [...lotes, { id: l.id, code: l.code }]; setLotes(n); void calcular(n.map((x) => x.id), f.include_descendants); }} />
            </Field>
            {lotes.length > 0 && <div className="flex flex-wrap gap-1.5">{lotes.map((l) => <span key={l.id} className="inline-flex items-center gap-1 rounded-lg border border-line py-0.5 pr-1 pl-2 font-mono text-[12.5px]">
              {l.code || "…"}<button type="button" aria-label={`Quitar ${l.code}`} onClick={() => quitar(l.id)} className="rounded p-0.5 hover:bg-surface-2"><X className="size-3.5" /></button></span>)}</div>}
            <Checkbox checked={f.include_descendants} onChange={(v) => { setF((x) => ({ ...x, include_descendants: v })); void calcular(lotes.map((l) => l.id), v); }}
              label="Incluir lotes derivados" hint="Los producidos con estos lotes como insumo" />
            <Field label="Clase de riesgo" required><Select value={f.risk_class} options={(op?.risk_classes ?? Object.keys(RIESGO)).map((c) => ({ value: c, label: RIESGO[c] ?? c }))} onChange={(e) => setF((x) => ({ ...x, risk_class: e.target.value }))} /></Field>
            <Field label="Motivo" required hint="Qué se encontró y dónde"><Textarea rows={4} value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button icon={Eye} disabled={!lotes.length} loading={ocupado && !alcance} onClick={() => calcular(lotes.map((l) => l.id), f.include_descendants)}>Ver alcance</Button>
              <Button variant="danger" icon={Siren} disabled={!alcance || f.reason.trim().length < 5} loading={ocupado && !!alcance} onClick={iniciar}>Iniciar retiro</Button>
            </div>
          </div>
        </Seccion>
        <Seccion titulo="Alcance">
          {!alcance && <p className="text-[13px] text-muted">Agrega un lote para ver a quién llegó y cuánto stock se bloquea.</p>}
          {alcance && <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Cifra titulo="Lotes" valor={String(alcance.lots.length)} />
              <Cifra titulo="Clientes" valor={String(alcance.customers.length)} detalle={kg(alcance.sold_kg)} />
              <Cifra titulo="Stock a bloquear" valor={numero(alcance.stock_qty)} detalle="unidades o kg" />
            </div>
            {alcance.open_orders.length > 0 && <Alert tone="warn" title="Órdenes de producción en curso usan estos lotes">{alcance.open_orders.join(", ")}</Alert>}
            <Tabla cabeza={["Lote", "Producto", "Estado", "Stock"]} filas={alcance.lots.map((l) => [<span key="c" className="font-mono">{l.code}{l.is_descendant && <> <Badge tone="info">derivado</Badge></>}</span>,
              l.product, <StatusBadge key="s" status={l.qc_status} labels={ESTADO_LOTE} />, numero(l.stock_qty)])} />
            <Tabla cabeza={["Cliente", "Teléfono", "Comprobantes", "Kg"]} filas={alcance.customers.map((c) => [c.customer_name, c.phone ?? "—", c.references.join(", "), kg(c.kg)])}
              vacio="Ningún cliente recibió estos lotes: solo se bloquea el stock." />
          </div>}
        </Seccion>
      </div>
    </div>
  );
}
