"use client";

import { useEffect, useState } from "react";
import { Activity, CalendarDays, Headset, ShieldAlert } from "lucide-react";
import { Button, Cifra, DataTable, DetailList, Input, Modal, PageHeader, Select, type Column } from "@/components/ui";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Fila = { id: string; action: string; action_name: string; actor_name: string; tenant_short: string | null; entity: string | null;
  entity_id: string | null; reason: string | null; ip: string | null; detail: Record<string, unknown> | null; occurred_at: string };
type Cifras = { registradas: number; hoy: number; soporte: number; rechazados: number };
type Respuesta = { data: Fila[]; current_page: number; last_page: number; per_page: number; total: number; cifras: Cifras;
  acciones: { code: string; name: string }[]; usuarios: { id: string; full_name: string }[]; empresas: { id: string; short: string }[] };

/** Nombre en español de las claves del detalle; las que no estén se muestran sin guiones bajos. */
const ETIQUETAS: Record<string, string> = {
  email: "Correo", ruc: "RUC", plan: "Plan", role: "Rol", full_name: "Nombre", admin: "Administrador", antes: "Antes", despues: "Después",
  desde: "Desde", hasta: "Hasta", de: "De", to: "A", from: "De", dias: "Días", trial_days: "Días de prueba", estado: "Estado", nivel: "Nivel",
  modules: "Módulos", monto: "Monto", total: "Total", bruto: "Bruto", pct: "Porcentaje", price_pen: "Precio", publico: "Público", severidad: "Severidad",
  filas: "Filas", lista: "Lista", intento: "Intento", abono: "Abono", cobros: "Cobros", comprobantes: "Comprobantes", emitidos: "Emitidos", mrr: "MRR", ip: "IP",
};
const etiqueta = (k: string) => ETIQUETAS[k] ?? (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");

/** OPS-13 Bitácora de la consola: toda acción con quién, empresa, motivo, IP y detalle. Solo lectura (RN-OPS-05). */
export default function BitacoraConsola() {
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const vacio = { search: "", action: "", user: "", tenant: "", desde: "", hasta: "", page: 1, per_page: 25 };
  const [f, setF] = useState(vacio);
  const [visto, setVisto] = useState<Fila | null>(null);
  const filtrado = Boolean(f.search || f.action || f.user || f.tenant || f.desde || f.hasta);
  const c = r?.cifras;
  const num = (n: number) => n.toLocaleString("es-PE");

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v !== null).map(([k, v]) => [k, String(v)]));
    const t = setTimeout(() => apiConsola<Respuesta>(`/bitacora?${q}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e))), 250);
    return () => clearTimeout(t);
  }, [f]);
  const poner = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v, page: k === "page" ? Number(v) : 1 }));

  const columnas: Column<Fila>[] = [
    { key: "occurred_at", header: "Cuándo", render: (a) => <span className="whitespace-nowrap">{fechaHora(a.occurred_at)}</span> },
    { key: "action_name", header: "Acción", cardTitle: true, render: (a) => <span className="font-semibold text-ink">{a.action_name}</span> },
    { key: "actor_name", header: "Quién" },
    { key: "tenant_short", header: "Empresa", render: (a) => a.tenant_short ?? <span className="text-muted">—</span> },
    { key: "reason", header: "Motivo y detalle", render: (a) => (
      <div className="max-w-[420px]">
        {a.reason && <p className="text-[13px] text-ink">{a.reason}</p>}
        {a.detail && Object.keys(a.detail).length > 0 && (
          <p className="text-[12px] break-words text-muted">{Object.entries(a.detail).map(([k, v]) => `${etiqueta(k)}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</p>
        )}
      </div>
    ) },
    { key: "ip", header: "IP", hideOnMobile: true, render: (a) => <span className="font-mono text-[12px]">{a.ip ?? "—"}</span> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Todo lo que se hace en la consola: ingresos, altas y cambios de empresas, suscripciones, planes, usuarios, parámetros y catálogos, con quién, el motivo y la IP. Nadie la puede cambiar ni borrar." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Acciones registradas" valor={num(c.registradas)} icono={Activity} destacada />
          <Cifra titulo="Hoy" valor={num(c.hoy)} icono={CalendarDays} />
          <Cifra titulo="Acciones del soporte dentro de empresas" valor={num(c.soporte)} icono={Headset} />
          <Cifra titulo="Intentos rechazados" valor={num(c.rechazados)} tono={c.rechazados ? "warn" : undefined} icono={ShieldAlert} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Input type="search" aria-label="Buscar" placeholder="Buscar por persona, motivo, empresa o IP" value={f.search} onChange={(e) => poner("search", e.target.value)} />
        </div>
        <Select value={f.action} onChange={(e) => poner("action", e.target.value)} aria-label="Acción" placeholder="Todas las acciones"
          options={(r?.acciones ?? []).map((a) => ({ value: a.code, label: a.name }))} />
        <Select value={f.user} onChange={(e) => poner("user", e.target.value)} aria-label="Usuario" placeholder="Todos los usuarios"
          options={(r?.usuarios ?? []).map((u) => ({ value: u.id, label: u.full_name }))} />
        <Select value={f.tenant} onChange={(e) => poner("tenant", e.target.value)} aria-label="Empresa" placeholder="Todas las empresas"
          options={(r?.empresas ?? []).map((t) => ({ value: t.id, label: t.short }))} />
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-12 shrink-0">Desde</span>
          <Input type="date" value={f.desde} max={f.hasta || undefined} onChange={(e) => poner("desde", e.target.value)} aria-label="Desde" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-12 shrink-0">Hasta</span>
          <Input type="date" value={f.hasta} min={f.desde || undefined} onChange={(e) => poner("hasta", e.target.value)} aria-label="Hasta" />
        </label>
        <div className="flex items-center">
          {filtrado && <Button variant="ghost" onClick={() => setF({ ...vacio, per_page: f.per_page })}>Limpiar filtros</Button>}
        </div>
      </div>
      <DataTable columns={columnas} rows={r?.data ?? []} loading={!r && !error} error={error} empty="No hay acciones con esos filtros." onRowClick={setVisto}
        pagination={r ? { page: r.current_page, lastPage: r.last_page, total: r.total, perPage: r.per_page, onPageChange: (p) => poner("page", p),
          onPerPageChange: (n) => poner("per_page", n) } : undefined} />
      {visto && <DetalleAccion a={visto} onClose={() => setVisto(null)} />}
    </div>
  );
}

/** Detalle de una acción (como el panel del prototipo): los datos de la fila y, abajo, el detalle completo tal como se guardó. */
function DetalleAccion({ a, onClose }: { a: Fila; onClose: () => void }) {
  const detalle = a.detail && Object.keys(a.detail).length > 0 ? a.detail : null;
  return (
    <Modal open onClose={onClose} size="lg" title={a.action_name} description={fechaHora(a.occurred_at)}>
      <div className="grid gap-5">
        <DetailList items={[
          { label: "Quién", value: a.actor_name },
          { label: "Empresa", value: a.tenant_short ?? "—" },
          { label: "Motivo", value: a.reason ?? "—" },
          { label: "IP", value: <span className="font-mono text-[12.5px]">{a.ip ?? "—"}</span> },
        ]} />
        {detalle && (
          <div className="grid gap-2">
            <p className="text-[13px] font-semibold text-ink">Detalle</p>
            <DetailList items={Object.entries(detalle).map(([k, v]) => ({ label: etiqueta(k), value: typeof v === "object" && v !== null ? JSON.stringify(v) : String(v) }))} />
            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-muted">Ver el registro completo</summary>
              <pre className="max-h-[50vh] overflow-auto border-t border-line bg-surface-2 p-3 text-[12px] text-ink">{JSON.stringify({ accion: a.action_name, cuando: a.occurred_at, quien: a.actor_name,
                empresa: a.tenant_short, motivo: a.reason, ip: a.ip, detalle }, null, 2)}</pre>
            </details>
          </div>
        )}
      </div>
    </Modal>
  );
}
