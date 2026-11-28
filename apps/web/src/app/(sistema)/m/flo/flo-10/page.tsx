"use client";

import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, VerArchivo, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { CamposGasto, GASTO_VACIO, cuerpoGasto, type GastoForm } from "@/modulos/flo/Gasto";
import { MULTA, hoyLima, type Opciones } from "@/modulos/flo/tipos";

type Multa = {
  id: string; ballot_number: string; fine_date: string; entity: string; entidad: string; infraction_code: string | null; infraction: string; vehicle_id: string; vehiculo: string;
  conductor: string | null; amount: string; early_discount_pct: string; early_discount_until: string | null; discount_amount: string; paid_amount: string | null; paid_on: string | null;
  status: string; charged_to_driver: boolean; acknowledgment_file_id: string | null; aprobo: string | null; gasto: string | null; notes: string | null; appeal_note: string | null;
  a_pagar: number; a_cargo_empresa: boolean;
};
type Lista = { data: Multa[]; resumen: { pendientes: number; por_pagar: number; empresa: number; descontadas: number } };

/** FLO-10 Multas: papeleta, entidad, infracción, conductor, importe, pronto pago, pago y descuento al conductor con acta firmada (RN-FLO-15). */
export default function Multas() {
  const { datos: op } = useOpciones();
  const [estado, setEstado] = useState("");
  const [vehiculo, setVehiculo] = useState("");
  const [nueva, setNueva] = useState(false);
  const [pagar, setPagar] = useState<Multa | null>(null);
  const [descontar, setDescontar] = useState<Multa | null>(null);
  const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(vehiculo ? { vehiculo } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/multas?${q}`);
  if (error) return <ErrorCarga error={error} que="Las multas las registran el coordinador y administración; el descuento lo aprueba RR. HH." />;
  const gestiona = Boolean(op?.permisos.multas);
  async function cambiar(m: Multa, accion: "apelar" | "reactivar" | "anular") {
    const t = { apelar: ["Apelar", "Mientras se resuelve, la multa no cuenta en el costo."], reactivar: ["Reactivar", "Vuelve a pendiente (la apelación no prosperó)."], anular: ["Anular", "La multa queda anulada con su motivo."] }[accion];
    const r = await confirmAction({ title: `${t[0]} ${m.ballot_number}`, message: t[1], confirmLabel: t[0], danger: accion === "anular", reason: { label: "Motivo", min: 10 } });
    if (!r) return;
    try {
      await api(`/v1/flo/multas/${m.id}/estado`, { method: "POST", body: { accion, note: r.reason } });
      toast.ok("Listo.");
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  const r = datos?.resumen;
  const columnas: Column<Multa>[] = [
    { key: "ballot_number", header: "Papeleta", cardTitle: true, render: (m) => <span className="flex flex-col"><span className="font-medium">{m.ballot_number}</span><span className="text-[12px] text-muted">{fecha(m.fine_date)} · {m.entidad}</span></span> },
    { key: "infraction", header: "Infracción", render: (m) => <span className="line-clamp-2">{m.infraction_code ? `${m.infraction_code} · ` : ""}{m.infraction}</span> },
    { key: "vehiculo", header: "Vehículo", render: (m) => <AlVehiculo id={m.vehicle_id}>{m.vehiculo}</AlVehiculo> },
    { key: "conductor", header: "Conductor", hideOnMobile: true, render: (m) => m.conductor ?? "—" },
    { key: "amount", header: "Importe", align: "right", render: (m) => (
      <span className="flex flex-col items-end"><span>{soles(m.amount)}</span>
        {m.status === "PENDING" && m.a_pagar < Number(m.amount) && <span className="text-[11.5px] text-ok">{soles(m.a_pagar)} hasta {fecha(m.early_discount_until)}</span>}
        {m.status === "PAID" && <span className="text-[11.5px] text-muted">pagó {soles(m.paid_amount)} el {fecha(m.paid_on)}</span>}</span>
    ) },
    { key: "cargo", header: "A cargo de", render: (m) => m.charged_to_driver ? <Badge tone="info">Conductor</Badge> : <Badge>Empresa</Badge> },
    { key: "acciones", header: "", render: (m) => (
      <span className="flex flex-wrap justify-end gap-1">
        <VerArchivo id={m.acknowledgment_file_id} texto="Acta" />
        {m.gasto && <Badge tone="ok">{m.gasto}</Badge>}
        {gestiona && m.status === "PENDING" && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); setPagar(m); }}>Pagar</Button>}
        {op?.permisos.descuento && !m.charged_to_driver && ["PENDING", "PAID"].includes(m.status) && <Button size="sm" onClick={(e) => { e.stopPropagation(); setDescontar(m); }}>Descontar</Button>}
        {gestiona && m.status === "PENDING" && !m.charged_to_driver && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); cambiar(m, "apelar"); }}>Apelar</Button>}
        {gestiona && m.status === "APPEALED" && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); cambiar(m, "reactivar"); }}>Reactivar</Button>}
        {gestiona && ["PENDING", "APPEALED"].includes(m.status) && !m.charged_to_driver && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); cambiar(m, "anular"); }}>Anular</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (m) => <Estado s={m.status} labels={MULTA} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Una multa descontada al conductor exige el acta de reconocimiento firmada y la aprobación de RR. HH. o gerencia; no se descuenta más de una vez (RN-FLO-15). Las demás son costo de la empresa."
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)}>Multa</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por pagar" valor={r ? soles(r.por_pagar) : undefined} detalle={r ? `${r.pendientes} pendientes` : ""} tono={r?.pendientes ? "warn" : undefined} destacada />
        <Cifra titulo="Costo de la empresa" valor={r ? soles(r.empresa) : undefined} detalle="multas pagadas" />
        <Cifra titulo="Descontadas" valor={r ? String(r.descontadas) : undefined} detalle="al conductor" />
        <Cifra titulo="Multas" valor={datos ? String(datos.data.length) : undefined} detalle="con estos filtros" />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} vacio="Todas" options={Object.entries(MULTA).map(([k, [l]]) => ({ value: k, label: l }))} />
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} empty={<Vacio>No hay multas.</Vacio>} />
      {nueva && op && <Nueva op={op} onClose={() => setNueva(false)} onListo={() => { setNueva(false); recargar(); }} />}
      {pagar && op && <Pagar op={op} m={pagar} onClose={() => setPagar(null)} onListo={() => { setPagar(null); recargar(); }} />}
      {descontar && <Descontar m={descontar} onClose={() => setDescontar(null)} onListo={() => { setDescontar(null); recargar(); }} />}
    </div>
  );
}

function useEnvio(onListo: () => void) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function enviar(fn: () => Promise<unknown>, ok: string) {
    setGuardando(true);
    setError("");
    try {
      await fn();
      toast.ok(ok);
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return { guardando, error, enviar };
}

function Nueva({ op, onClose, onListo }: { op: Opciones; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({ ballot_number: "", fine_date: hoyLima(), entity: "SAT", infraction_code: "", infraction: "", vehicle_id: "", driver_user_id: "", amount: "", early_discount_pct: "", early_discount_until: "", notes: "" });
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const { guardando, error, enviar } = useEnvio(onListo);
  function guardar(e: FormEvent) {
    e.preventDefault();
    enviar(() => api("/v1/flo/multas", { method: "POST", body: { ...v, amount: Number(v.amount), early_discount_pct: v.early_discount_pct ? Number(v.early_discount_pct) : null,
      early_discount_until: v.early_discount_until || null, driver_user_id: v.driver_user_id || null, infraction_code: v.infraction_code || null, notes: v.notes || null } }), "Multa registrada.");
  }
  return (
    <Modal open onClose={onClose} title="Registrar multa" dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-multa" loading={guardando}>Guardar</Button></>}>
      <form id="f-multa" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Papeleta" required><Input value={v.ballot_number} maxLength={30} onChange={(e) => pon("ballot_number", e.target.value.toUpperCase())} /></Field>
          <Field label="Fecha" required><Input type="date" value={v.fine_date} max={hoyLima()} onChange={(e) => pon("fine_date", e.target.value)} /></Field>
          <Field label="Entidad" required><Select value={v.entity} onChange={(e) => pon("entity", e.target.value)} options={Object.entries(op.entidades).map(([k, l]) => ({ value: k, label: l }))} /></Field>
          <Field label="Código de infracción"><Input value={v.infraction_code} maxLength={20} placeholder="G58, M20…" onChange={(e) => pon("infraction_code", e.target.value.toUpperCase())} /></Field>
        </div>
        <Field label="Infracción" required><Input value={v.infraction} maxLength={255} onChange={(e) => pon("infraction", e.target.value)} /></Field>
        <Field label="Vehículo" required><Select value={v.vehicle_id} onChange={(e) => pon("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>
        <Field label="Conductor" hint="Vacío: el de la jornada de ese día en ese vehículo."><Select value={v.driver_user_id} onChange={(e) => pon("driver_user_id", e.target.value)} placeholder="El de la jornada" options={op.conductores.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Importe (S/)" required><Input type="number" step="0.01" value={v.amount} onChange={(e) => pon("amount", e.target.value)} /></Field>
          <Field label="Pronto pago (%)"><Input type="number" step="0.01" value={v.early_discount_pct} onChange={(e) => pon("early_discount_pct", e.target.value)} /></Field>
          <Field label="Hasta"><Input type="date" value={v.early_discount_until} min={v.fine_date} onChange={(e) => pon("early_discount_until", e.target.value)} /></Field>
        </div>
        <Field label="Notas"><Textarea value={v.notes} maxLength={1000} onChange={(e) => pon("notes", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}

function Pagar({ op, m, onClose, onListo }: { op: Opciones; m: Multa; onClose: () => void; onListo: () => void }) {
  const [dia, setDia] = useState(hoyLima());
  const [g, setG] = useState<GastoForm>({ ...GASTO_VACIO, doc_type: "SIMPLE_RECEIPT" });
  const { guardando, error, enviar } = useEnvio(onListo);
  const monto = m.early_discount_until && dia <= m.early_discount_until ? Number(m.amount) * (1 - Number(m.early_discount_pct) / 100) : Number(m.amount);
  return (
    <Modal open onClose={onClose} title={`Pagar ${m.ballot_number}`} description={`${m.entidad} · ${m.infraction}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-pagar" loading={guardando}>Registrar pago</Button></>}>
      <form id="f-pagar" className="space-y-3" onSubmit={(e) => { e.preventDefault(); enviar(() => api(`/v1/flo/multas/${m.id}/pagar`, { method: "POST", body: { paid_on: dia, ...cuerpoGasto(g) } }), "Pago registrado."); }}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Pagada el" required><Input type="date" value={dia} min={m.fine_date} max={hoyLima()} onChange={(e) => setDia(e.target.value)} /></Field>
        <Alert tone={monto < Number(m.amount) ? "ok" : "info"}>A pagar: {soles(monto)}{monto < Number(m.amount) ? ` (con ${Number(m.early_discount_pct)} % de pronto pago)` : ""}.</Alert>
        <CamposGasto g={g} onChange={setG} tipo="FINE" vehiculo={m.vehicle_id} puedeCrear={op.permisos.gastos} />
      </form>
    </Modal>
  );
}

function Descontar({ m, onClose, onListo }: { m: Multa; onClose: () => void; onListo: () => void }) {
  const [acta, setActa] = useState<File | null>(null);
  const { guardando, error, enviar } = useEnvio(onListo);
  function guardar(e: FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    if (acta) fd.append("acta", acta);
    enviar(() => api(`/v1/flo/multas/${m.id}/descontar`, { method: "POST", body: fd }), "Descuento aprobado.");
  }
  return (
    <Modal open onClose={onClose} title={`Descontar ${m.ballot_number} a ${m.conductor ?? "el conductor"}`} dismissable={!guardando} placement="center"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-desc" loading={guardando}>Aprobar descuento</Button></>}>
      <form id="f-desc" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Alert tone="warn">Se descuenta {soles(m.paid_amount ?? m.a_pagar)} en el pago del personal. Se hace una sola vez y no se puede deshacer aquí.</Alert>
        <Field label="Acta de reconocimiento firmada" required>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setActa(e.target.files?.[0] ?? null)} className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-[9px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
        </Field>
      </form>
    </Modal>
  );
}
