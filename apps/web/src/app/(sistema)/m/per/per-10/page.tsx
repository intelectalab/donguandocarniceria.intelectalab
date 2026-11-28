"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { ErrorCarga, Estado, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ACTIVO, hoyLima, inicioMes, type Opciones } from "@/modulos/per/tipos";

type Plan = {
  id: string; code: string; name: string; plan_type: string; tipo: string; brand_id: string | null; marca: string; channel: string | null; rate_pct: number | null;
  per_delivery_amount: number | null; tiers: { from: number; rate_pct: number }[]; alert_penalty_pct: number; valid_from: string; valid_to: string | null; status: string; usos: number;
};

const CANALES: Record<string, string> = { WHATSAPP: "WhatsApp", PHONE: "Teléfono", WEB: "Web", COUNTER: "Mostrador", B2B: "B2B", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", TIKTOK: "TikTok" };

/** PER-10 Planes de comisión y bono: comisión sobre lo cobrado (sin IGV) o bono por entrega, por marca y canal, con tramos y vigencia (RN-PER-10 a 13). */
export default function Planes() {
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Plan[] }>("/v1/per/planes");
  const [editar, setEditar] = useState<Plan | "nuevo" | null>(null);
  if (error) return <ErrorCarga error={error} que="Los planes los definen RR. HH. y Gerencia." />;
  const gestiona = Boolean(op?.permisos.comisiones);
  const columnas: Column<Plan>[] = [
    { key: "name", header: "Plan", cardTitle: true, render: (p) => <span className="flex flex-col"><span className="font-medium">{p.name}</span><span className="text-[12px] text-muted">{p.code} · {p.tipo}</span></span> },
    { key: "alcance", header: "Aplica a", render: (p) => `${p.marca}${p.channel ? ` · ${CANALES[p.channel] ?? p.channel}` : " · todos los canales"}` },
    { key: "monto", header: "Monto", render: (p) => p.plan_type === "DRIVER_DELIVERY" ? `${soles(p.per_delivery_amount)} por entrega` : (
      <span className="flex flex-col">{p.tiers.length ? p.tiers.map((t) => <span key={t.from} className="text-[12.5px]">desde {soles(t.from)}: {numero(t.rate_pct, 2)} %</span>) : `${numero(p.rate_pct, 2)} % de lo cobrado sin IGV`}</span>
    ) },
    { key: "alert_penalty_pct", header: "Castigo por alerta", hideOnMobile: true, render: (p) => `${numero(p.alert_penalty_pct)} %` },
    { key: "valid_from", header: "Vigencia", render: (p) => `${fecha(p.valid_from)}${p.valid_to ? ` – ${fecha(p.valid_to)}` : " en adelante"}` },
    { key: "usos", header: "Usado", align: "right", hideOnMobile: true, render: (p) => p.usos ? <Badge tone="info">{p.usos} registros</Badge> : "—" },
    { key: "status", header: "Estado", render: (p) => <Estado s={p.status} labels={ACTIVO} /> },
    ...(gestiona ? [{ key: "acc", header: "", render: (p: Plan) => <Button size="sm" variant="ghost" icon={Pencil} onClick={(e) => { e.stopPropagation(); setEditar(p); }}>Editar</Button> }] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="La comisión se calcula sobre lo cobrado sin IGV y se reversa si el cobro se anula. El bono se paga por pedido entregado. Si un plan ya se usó, sus montos no cambian: crea otro con nueva vigencia."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Plan</Button>} />
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>Sin planes.</Vacio>} />
      {editar && op && <Formulario op={op} plan={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, plan, onClose, onListo }: { op: Opciones; plan: Plan | null; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({
    code: plan?.code ?? "", name: plan?.name ?? "", plan_type: plan?.plan_type ?? "SELLER_COLLECTED", brand_id: plan?.brand_id ?? "", channel: plan?.channel ?? "",
    rate_pct: plan?.rate_pct === null || !plan ? "" : String(plan.rate_pct), per_delivery_amount: plan?.per_delivery_amount === null || !plan ? String(op.parametros.bono) : String(plan.per_delivery_amount),
    alert_penalty_pct: String(plan?.alert_penalty_pct ?? 10), valid_from: plan?.valid_from ?? inicioMes(hoyLima()), valid_to: plan?.valid_to ?? "", status: plan?.status ?? "ACTIVE",
  });
  const [tramos, setTramos] = useState((plan?.tiers ?? []).map((t) => ({ from: String(t.from), rate_pct: String(t.rate_pct) })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const usado = Boolean(plan?.usos);
  const comision = v.plan_type === "SELLER_COLLECTED";
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { ...v, brand_id: v.brand_id || null, channel: v.channel || null, valid_to: v.valid_to || null,
        rate_pct: comision && v.rate_pct !== "" ? Number(v.rate_pct) : null, per_delivery_amount: comision ? null : Number(v.per_delivery_amount), alert_penalty_pct: Number(v.alert_penalty_pct),
        tiers: comision ? tramos.filter((t) => t.from !== "" && t.rate_pct !== "").map((t) => ({ from: Number(t.from), rate_pct: Number(t.rate_pct) })) : [] };
      await api(plan ? `/v1/per/planes/${plan.id}` : "/v1/per/planes", { method: plan ? "PUT" : "POST", body });
      toast.ok(plan ? "Plan actualizado." : "Plan creado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  const num = (k: keyof typeof v) => ({ inputMode: "decimal" as const, value: v[k], disabled: usado, onChange: (e: { target: { value: string } }) => pon(k, e.target.value.replace(",", ".")) });
  return (
    <Modal open onClose={onClose} size="lg" title={plan ? `Editar ${plan.code}` : "Nuevo plan"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-plan" loading={guardando}>Guardar</Button></>}>
      <form id="f-plan" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        {usado && <Alert tone="info">Este plan ya generó {plan?.usos} registros: solo puedes cambiar el nombre, el fin de vigencia y el estado.</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código" required><Input value={v.code} maxLength={30} disabled={usado} onChange={(e) => pon("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Tipo" required><Select value={v.plan_type} disabled={usado} onChange={(e) => pon("plan_type", e.target.value)} options={[{ value: "SELLER_COLLECTED", label: "Comisión sobre cobrado (vendedora)" }, { value: "DRIVER_DELIVERY", label: "Bono por entrega (repartidor)" }]} /></Field>
        </div>
        <Field label="Nombre" required><Input value={v.name} maxLength={160} onChange={(e) => pon("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Marca"><Select value={v.brand_id} disabled={usado} onChange={(e) => pon("brand_id", e.target.value)} placeholder="Todas" options={op.marcas.map((m) => ({ value: m.id, label: m.name }))} /></Field>
          <Field label="Canal"><Select value={v.channel} disabled={usado} onChange={(e) => pon("channel", e.target.value)} placeholder="Todos" options={Object.entries(CANALES).map(([value, label]) => ({ value, label }))} /></Field>
          {comision
            ? <Field label="Porcentaje (%)" hint="Si usas tramos, el tramo manda."><Input {...num("rate_pct")} /></Field>
            : <Field label="Monto por entrega (S/)" required><Input {...num("per_delivery_amount")} /></Field>}
          <Field label="Castigo por alerta grave (%)" hint="Se descuenta si hay alerta confirmada."><Input {...num("alert_penalty_pct")} /></Field>
          <Field label="Vigente desde" required><Input type="date" value={v.valid_from} disabled={usado} onChange={(e) => pon("valid_from", e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={v.valid_to} onChange={(e) => pon("valid_to", e.target.value)} /></Field>
          <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        </div>
        {comision && (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold">Tramos por lo cobrado en el mes (opcional)</p>
            {tramos.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Desde (S/)"><Input inputMode="decimal" value={t.from} disabled={usado} onChange={(e) => setTramos((ts) => ts.map((x, j) => j === i ? { ...x, from: e.target.value.replace(",", ".") } : x))} /></Field>
                <Field label="%"><Input inputMode="decimal" value={t.rate_pct} disabled={usado} onChange={(e) => setTramos((ts) => ts.map((x, j) => j === i ? { ...x, rate_pct: e.target.value.replace(",", ".") } : x))} /></Field>
                {!usado && <Button variant="ghost" icon={Trash2} aria-label="Quitar tramo" onClick={() => setTramos((ts) => ts.filter((_, j) => j !== i))} />}
              </div>
            ))}
            {!usado && <Button size="sm" icon={Plus} onClick={() => setTramos((ts) => [...ts, { from: ts.length ? "" : "0", rate_pct: "" }])}>Tramo</Button>}
          </div>
        )}
      </form>
    </Modal>
  );
}
