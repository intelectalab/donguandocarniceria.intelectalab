"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Coins, PackageX, Plus, UserX } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Vacio, useDatos } from "@/modulos/pre/comunes";
import { cuando, hoyLima } from "@/modulos/pre/tipos";

type ErrorFila = {
  id: string; order_id: string; error_type: string; detected_at_stage: string; responsible_employee_id: string | null; description: string;
  cost_amount: string; corrective_action: string | null; status: string; detected_at: string; closed_at: string | null;
  pedido: string; responsable: string | null; detectado_por: string | null; cliente: string | null;
};
type Opciones = { tipos: Record<string, string>; etapas: Record<string, string>; llegaron_al_cliente: string[]; empleados: { id: string; full_name: string; position: string | null }[] };
type Resumen = { mes: string; total: number; abiertos: number; llegaron: number; costo: number; error_pct: number; entregados: number; con_error: number; por_tipo: { tipo: string; n: number }[] };
type PedidoHallado = { id: string; number: string; status: string; delivery_date: string | null; cliente: string | null };

const ESTADO: Record<string, [string, "warn" | "ok"]> = { OPEN: ["Abierto", "warn"], CLOSED: ["Cerrado", "ok"] };
const opciones = (r: Record<string, string> | undefined) => Object.entries(r ?? {}).map(([value, label]) => ({ value, label }));

/** PRE-10 Errores de armado: registro con tipo, etapa en que se detectó, responsable, costo y acción correctiva. */
export default function ErroresDeArmado() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const previo = sp.get("pedido") ? { id: sp.get("pedido")!, number: sp.get("numero") ?? "", etapa: sp.get("etapa") ?? "" } : null;
  const { can } = useSesion();
  const [mes, setMes] = useState(hoyLima().slice(0, 7));
  const [estado, setEstado] = useState("");
  const [etapa, setEtapa] = useState("");
  const [tipo, setTipo] = useState("");
  const [nuevo, setNuevo] = useState(Boolean(previo));
  const [cerrar, setCerrar] = useState<ErrorFila | null>(null);
  const op = useDatos<Opciones>("/v1/pre/errores/opciones").datos;
  const resumen = useDatos<Resumen>(`/v1/pre/errores/resumen?mes=${mes}`);
  const lista = useListado<ErrorFila>("/v1/pre/errores", { filtros: { mes, status: estado, stage: etapa, type: tipo } });
  const registra = can("pre.error.manage") || can("pre.task.verify");
  const gestiona = can("pre.error.manage");
  const r = resumen.datos;

  const columnas: Column<ErrorFila>[] = [
    {
      key: "pedido", header: "Pedido", sortable: true, sortKey: "t.number", cardTitle: true,
      render: (e) => <div><div className="font-medium">{e.pedido}</div><div className="text-[12px] text-muted">{e.cliente}</div></div>,
    },
    {
      key: "error_type", header: "Error",
      render: (e) => <div className="min-w-0 max-w-[340px]"><div>{op?.tipos[e.error_type] ?? e.error_type}</div><div className="truncate text-[12px] text-muted" title={e.description}>{e.description}</div></div>,
    },
    { key: "detected_at_stage", header: "Etapa", render: (e) => op?.etapas[e.detected_at_stage] ?? e.detected_at_stage },
    { key: "responsable", header: "Responsable", hideOnMobile: true, render: (e) => e.responsable ?? <span className="text-muted">—</span> },
    { key: "cost_amount", header: "Costo", align: "right", sortable: true, sortKey: "e.cost_amount", render: (e) => soles(e.cost_amount) },
    { key: "detected_at", header: "Detectado", sortable: true, sortKey: "e.detected_at", hideOnMobile: true, render: (e) => <div className="whitespace-nowrap">{cuando(e.detected_at)}<div className="text-[12px] text-muted">{e.detectado_por}</div></div> },
    { key: "status", header: "Estado", render: (e) => <StatusBadge status={e.status} labels={ESTADO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada error de armado con la etapa en que se detectó. Si llegó al cliente, se indica el responsable; se cierra con la acción correctiva."
        actions={registra && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Registrar error</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Pedidos con error" icono={PackageX} destacada valor={r ? porcentaje(r.error_pct, 2) : undefined} detalle={r ? `${r.con_error} de ${numero(r.entregados)} entregados` : ""} />
        <Cifra titulo="Errores del mes" icono={AlertTriangle} valor={r ? numero(r.total) : undefined} detalle={r ? `${r.abiertos} abiertos en total` : ""} tono={r && r.abiertos ? "warn" : undefined} />
        <Cifra titulo="Llegaron al cliente" icono={UserX} valor={r ? numero(r.llegaron) : undefined} detalle="Entrega o reclamo" tono={r && r.llegaron ? "bad" : undefined} />
        <Cifra titulo="Costo" icono={Coins} valor={r ? soles(r.costo) : undefined} detalle={r?.por_tipo[0] ? `Más frecuente: ${r.por_tipo[0].tipo}` : ""} />
      </div>

      <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Pedido, descripción o responsable…" }}
        onRowClick={(e) => gestiona && e.status === "OPEN" ? setCerrar(e) : undefined}
        empty="No hay errores de armado con esos filtros."
        toolbar={<>
          <FiltroFecha etiqueta="Mes" tipo="month" value={mes} onChange={(v) => setMes(v || hoyLima().slice(0, 7))} ancho={150} />
          <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={opciones({ OPEN: "Abiertos", CLOSED: "Cerrados" })} ancho={140} />
          <FiltroSelect etiqueta="Etapa" todos="todas" value={etapa} onChange={setEtapa} options={opciones(op?.etapas)} ancho={170} />
          <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={opciones(op?.tipos)} ancho={170} />
        </>} />

      {nuevo && op && <Nuevo op={op} previo={previo} onClose={() => setNuevo(false)} onListo={() => { setNuevo(false); lista.recargar(); resumen.recargar(); }} />}
      {cerrar && op && <Cerrar e={cerrar} op={op} onClose={() => setCerrar(null)} onListo={() => { setCerrar(null); lista.recargar(); resumen.recargar(); }} />}
    </div>
  );
}

function Nuevo({ op, previo, onClose, onListo }: { op: Opciones; previo: { id: string; number: string; etapa: string } | null; onClose: () => void; onListo: () => void }) {
  const [pedido, setPedido] = useState<{ id: string; number: string } | null>(previo);
  const [buscar, setBuscar] = useState("");
  const [f, setF] = useState({ error_type: "", detected_at_stage: previo?.etapa && op.etapas[previo.etapa] ? previo.etapa : "", description: "", responsible_employee_id: "", cost_amount: "", corrective_action: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const hallados = useDatos<PedidoHallado[]>(!pedido && buscar.trim().length >= 2 ? `/v1/pre/errores/pedidos?q=${encodeURIComponent(buscar.trim())}` : null);
  const llego = op.llegaron_al_cliente.includes(f.detected_at_stage);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!pedido) return;
    setGuardando(true);
    setErrores({});
    try {
      await api("/v1/pre/errores", {
        method: "POST",
        body: { ...f, order_id: pedido.id, responsible_employee_id: f.responsible_employee_id || null, cost_amount: f.cost_amount ? Number(f.cost_amount) : null, corrective_action: f.corrective_action || null },
      });
      toast.ok("Error registrado");
      onListo();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Registrar error de armado" dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-error" loading={guardando}
        disabled={!pedido || !f.error_type || !f.detected_at_stage || !f.description.trim() || (llego && !f.responsible_employee_id)}>Registrar</Button></>}>
      <form id="f-error" onSubmit={guardar} className="space-y-4">
        <Field label="Pedido" required error={errores.order_id}>
          {pedido ? (
            <div className="flex items-center justify-between gap-2 rounded-[9px] border border-line bg-surface-2 px-3 py-2 text-[13.5px]">
              <b className="text-ink">{pedido.number}</b>
              <Button size="sm" variant="ghost" onClick={() => setPedido(null)}>Cambiar</Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Número del pedido (P-001045 o 1045)" autoFocus />
              {hallados.datos && (hallados.datos.length === 0 ? <Vacio>No se encontró el pedido.</Vacio> : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {hallados.datos.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setPedido(p)} className="w-full cursor-pointer px-3 py-2 text-left text-[13px] hover:bg-surface-2">
                        <b>{p.number}</b> · {p.cliente}
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo" required error={errores.error_type}>
            <Select value={f.error_type} onChange={(e) => setF({ ...f, error_type: e.target.value })} placeholder="Elige" options={opciones(op.tipos)} />
          </Field>
          <Field label="Etapa en que se detectó" required error={errores.detected_at_stage}>
            <Select value={f.detected_at_stage} onChange={(e) => setF({ ...f, detected_at_stage: e.target.value })} placeholder="Elige" options={opciones(op.etapas)} />
          </Field>
        </div>
        <Field label="Qué pasó" required error={errores.description}>
          <Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} rows={3} />
        </Field>
        <Field label="Responsable" required={llego} hint={llego ? "Llegó al cliente: el responsable es obligatorio" : undefined} error={errores.responsible_employee_id}>
          <Select value={f.responsible_employee_id} onChange={(e) => setF({ ...f, responsible_employee_id: e.target.value })} placeholder="Sin indicar"
            options={op.empleados.map((x) => ({ value: x.id, label: `${x.full_name}${x.position ? ` · ${x.position}` : ""}` }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Costo" error={errores.cost_amount}>
            <Input value={f.cost_amount} onChange={(e) => setF({ ...f, cost_amount: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" prefix="S/" placeholder="0.00" />
          </Field>
          <Field label="Acción correctiva" error={errores.corrective_action}>
            <Input value={f.corrective_action} onChange={(e) => setF({ ...f, corrective_action: e.target.value })} maxLength={255} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function Cerrar({ e, op, onClose, onListo }: { e: ErrorFila; op: Opciones; onClose: () => void; onListo: () => void }) {
  const [accion, setAccion] = useState(e.corrective_action ?? "");
  const [resp, setResp] = useState(e.responsible_employee_id ?? "");
  const [guardando, setGuardando] = useState(false);
  const llego = op.llegaron_al_cliente.includes(e.detected_at_stage);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      await api(`/v1/pre/errores/${e.id}/cerrar`, { method: "POST", body: { corrective_action: accion, responsible_employee_id: resp || null } });
      toast.ok("Error cerrado");
      onListo();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Cerrar error de ${e.pedido}`} description={`${op.tipos[e.error_type] ?? e.error_type} · ${op.etapas[e.detected_at_stage] ?? e.detected_at_stage}`} dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-cerrar" loading={guardando} disabled={!accion.trim() || (llego && !resp)}>Cerrar error</Button></>}>
      <form id="f-cerrar" onSubmit={guardar} className="space-y-4">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink">{e.description}</p>
        <Field label="Acción correctiva" required>
          <Textarea value={accion} onChange={(x) => setAccion(x.target.value)} maxLength={255} rows={3} autoFocus />
        </Field>
        <Field label="Responsable" required={llego} hint={llego ? "Llegó al cliente: el responsable es obligatorio" : undefined}>
          <Select value={resp} onChange={(x) => setResp(x.target.value)} placeholder="Sin indicar" options={op.empleados.map((x) => ({ value: x.id, label: x.full_name }))} />
        </Field>
        {llego && !resp && <Alert tone="warn">Indica quién fue responsable antes de cerrar.</Alert>}
      </form>
    </Modal>
  );
}
