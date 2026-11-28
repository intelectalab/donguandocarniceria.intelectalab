"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Wrench } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { AlVehiculo, ErrorCarga, Estado, FiltroVehiculo, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { PLAN, num, type Opciones } from "@/modulos/flo/tipos";

type Plan = {
  id: string; code: string; vehicle_id: string; vehiculo: string; task: string; interval_km: number | null; interval_days: number | null; last_done_km: number | null;
  last_done_on: string | null; next_due_km: number | null; next_due_on: string | null; status: string; notes: string | null; estado: string; km_restante: number | null;
  dias_restantes: number | null; odometro: number; aviso_km: number | null; aviso_fecha: string | null; orden_abierta: string | null;
};

/** FLO-07 Plan de mantenimiento: cada N km y/o N días, lo que ocurra primero, con aviso antes (RN-FLO-09) y bloqueo si se pasa de más (RN-FLO-11). */
export default function Planes() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const router = useRouter();
  const { datos: op } = useOpciones();
  const [vehiculo, setVehiculo] = useState(sp.get("vehiculo") ?? "");
  const [estado, setEstado] = useState("");
  const [editar, setEditar] = useState<Plan | "nuevo" | null>(null);
  const q = new URLSearchParams({ ...(vehiculo ? { vehiculo } : {}), ...(estado ? { estado } : {}) });
  const { datos, error, cargando, recargar } = useDatos<{ data: Plan[] }>(`/v1/flo/planes?${q}`);
  if (error) return <ErrorCarga error={error} que="Los planes de mantenimiento son del coordinador de delivery." />;
  const filas = datos?.data ?? [];
  const gestiona = Boolean(op?.permisos.mantenimiento);
  const cuenta = (e: string[]) => filas.filter((p) => e.includes(p.estado)).length;
  const columnas: Column<Plan>[] = [
    { key: "task", header: "Tarea", cardTitle: true, render: (p) => <span className="flex flex-col"><span className="font-medium">{p.task}</span><span className="text-[12px] text-muted">{p.code}</span></span> },
    { key: "vehiculo", header: "Vehículo", render: (p) => <AlVehiculo id={p.vehicle_id}>{p.vehiculo}</AlVehiculo> },
    { key: "cada", header: "Cada", render: (p) => [p.interval_km ? `${numero(p.interval_km, 0)} km` : null, p.interval_days ? `${p.interval_days} días` : null].filter(Boolean).join(" o ") },
    { key: "ultimo", header: "Último", hideOnMobile: true, render: (p) => p.last_done_on || p.last_done_km ? `${p.last_done_km !== null ? `${numero(p.last_done_km, 0)} km` : ""}${p.last_done_on ? ` · ${fecha(p.last_done_on)}` : ""}` : "—" },
    { key: "proximo", header: "Próximo", render: (p) => (
      <span className="flex flex-col">
        <span>{[p.next_due_km !== null ? `${numero(p.next_due_km, 0)} km` : null, p.next_due_on ? fecha(p.next_due_on) : null].filter(Boolean).join(" o ") || "—"}</span>
        <span className="text-[12px] text-muted">{[p.km_restante !== null ? `${p.km_restante < 0 ? "pasado por" : "faltan"} ${numero(Math.abs(p.km_restante), 0)} km` : null,
          p.dias_restantes !== null ? `${p.dias_restantes < 0 ? "vencido hace" : "faltan"} ${Math.abs(p.dias_restantes)} días` : null].filter(Boolean).join(" · ")}</span>
      </span>
    ) },
    { key: "aviso", header: "Aviso", hideOnMobile: true, render: (p) => [p.aviso_km !== null ? `${numero(p.aviso_km, 0)} km` : null, p.aviso_fecha ? fecha(p.aviso_fecha) : null].filter(Boolean).join(" o ") || "—" },
    { key: "acciones", header: "", render: (p) => gestiona && p.status === "ACTIVE" && (
      <span className="flex justify-end gap-1">
        {p.orden_abierta ? <span className="text-[12px] text-muted">Orden {p.orden_abierta}</span>
          : <Button size="sm" icon={Wrench} onClick={(e) => { e.stopPropagation(); router.push(`/m/flo/flo-08?nueva=${p.id}&vehiculo=${p.vehicle_id}`); }}>Orden</Button>}
      </span>
    ) },
    { key: "status", header: "Estado", render: (p) => <Estado s={p.estado} labels={PLAN} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description={`Vence lo que ocurra primero: los km o los días. Se avisa ${op?.parametros.aviso_km ?? 500} km o ${op?.parametros.aviso_dias ?? 7} días antes; pasado por más de ${numero(op?.parametros.bloqueo_km ?? 1000, 0)} km, el vehículo no sale (RN-FLO-11).`}
        actions={gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Plan</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Planes activos" valor={datos ? String(filas.filter((p) => p.status === "ACTIVE").length) : undefined} detalle="en la flota" destacada />
        <Cifra titulo="Por vencer" valor={datos ? String(cuenta(["DUE_SOON"])) : undefined} detalle="dentro del aviso" tono={cuenta(["DUE_SOON"]) ? "warn" : undefined} />
        <Cifra titulo="Vencidos" valor={datos ? String(cuenta(["OVERDUE"])) : undefined} detalle="hacerlos pronto" tono={cuenta(["OVERDUE"]) ? "bad" : undefined} />
        <Cifra titulo="Bloquean" valor={datos ? String(cuenta(["OVERDUE_BLOCK"])) : undefined} detalle="el vehículo no sale" tono={cuenta(["OVERDUE_BLOCK"]) ? "bad" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={[{ value: "ALERT", label: "Con aviso o vencidos" }, ...Object.entries(PLAN).map(([k, [l]]) => ({ value: k, label: l }))]} />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} onRowClick={gestiona ? (p) => setEditar(p) : undefined} empty={<Vacio>No hay planes con estos filtros.</Vacio>} />
      {editar && op && <Formulario op={op} p={editar === "nuevo" ? null : editar} vehiculo={vehiculo} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Formulario({ op, p, vehiculo, onClose, onListo }: { op: Opciones; p: Plan | null; vehiculo: string; onClose: () => void; onListo: () => void }) {
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const [v, setV] = useState({ vehicle_id: p?.vehicle_id ?? vehiculo, task: p?.task ?? "", interval_km: s(num(p?.interval_km)), interval_days: s(p?.interval_days),
    last_done_km: s(num(p?.last_done_km)), last_done_on: s(p?.last_done_on), status: p?.status ?? "ACTIVE", notes: s(p?.notes) });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const prox = [v.interval_km && v.last_done_km ? `${numero(Number(v.last_done_km) + Number(v.interval_km), 0)} km` : null,
    v.interval_days && v.last_done_on ? fecha(new Date(new Date(`${v.last_done_on}T12:00:00-05:00`).getTime() + Number(v.interval_days) * 86400000).toISOString().slice(0, 10)) : null].filter(Boolean).join(" o ");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const body = { vehicle_id: v.vehicle_id, task: v.task, interval_km: v.interval_km ? Number(v.interval_km) : null, interval_days: v.interval_days ? Number(v.interval_days) : null,
        last_done_km: v.last_done_km ? Number(v.last_done_km) : null, last_done_on: v.last_done_on || null, status: v.status, notes: v.notes || null };
      await api(p ? `/v1/flo/planes/${p.id}` : "/v1/flo/planes", { method: p ? "PUT" : "POST", body });
      toast.ok("Plan guardado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={p ? `${p.code} · ${p.task}` : "Nuevo plan"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-plan" loading={guardando}>Guardar</Button></>}>
      <form id="f-plan" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Vehículo" required><Select value={v.vehicle_id} disabled={Boolean(p)} onChange={(e) => pon("vehicle_id", e.target.value)} placeholder="Elige" options={op.vehiculos.map((x) => ({ value: x.id, label: x.etiqueta }))} /></Field>
        <Field label="Tarea" required><Input value={v.task} maxLength={120} placeholder="Cambio de aceite, llantas, frenos…" onChange={(e) => pon("task", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cada (km)"><Input type="number" step="1" value={v.interval_km} onChange={(e) => pon("interval_km", e.target.value)} /></Field>
          <Field label="Cada (días)"><Input type="number" step="1" value={v.interval_days} onChange={(e) => pon("interval_days", e.target.value)} /></Field>
          <Field label="Último hecho a los (km)"><Input type="number" step="0.1" value={v.last_done_km} onChange={(e) => pon("last_done_km", e.target.value)} /></Field>
          <Field label="Último hecho el"><Input type="date" value={v.last_done_on} onChange={(e) => pon("last_done_on", e.target.value)} /></Field>
        </div>
        {!v.interval_km && !v.interval_days && <Alert tone="info">Pon al menos un intervalo: por km, por días o ambos (RN-FLO-09).</Alert>}
        {prox && <Alert tone="ok">Próximo: {prox} (lo que ocurra primero).</Alert>}
        {p && <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>}
        <Field label="Notas"><Textarea value={v.notes} maxLength={1000} onChange={(e) => pon("notes", e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
