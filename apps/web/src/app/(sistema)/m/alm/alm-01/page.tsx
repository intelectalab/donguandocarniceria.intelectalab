"use client";

import { useState } from "react";
import { Plus, Snowflake, Store, Truck, Warehouse } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, PageHeader, Select, StatusBadge, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { FiltroSelect, num, olvidarOpciones, qs, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { TIPOS_ALMACEN, etiqueta, type Almacen, type Opciones } from "@/modulos/alm/tipos";

const ICONO: Record<string, typeof Warehouse> = { COLD_ROOM: Snowflake, FREEZER: Snowflake, STORE: Store, VEHICLE: Truck, TRANSIT: Truck };

/** ALM-01 Almacenes y ubicaciones: árbol por local con tipo, temperatura, si vende y prioridad de salida. */
export default function Almacenes() {
  const { local, puede, can } = useSesion();
  const [estado, setEstado] = useState("ACTIVE");
  const { datos, cargando, error, recargar } = useDatos<{ data: Almacen[] }>(`/v1/alm/almacenes${qs({ status: estado, site: local })}`);
  const op = useOpciones();
  const [editando, setEditando] = useState<Almacen | null | undefined>(undefined);
  const puedeEditar = can("alm.warehouse.manage") && puede("ALM", "E");
  const filas = datos?.data ?? [];
  const grupos = new Map<string, Almacen[]>();
  for (const w of filas) {
    const k = w.establishment_name ?? "Sin local (tránsito y vehículos)";
    grupos.set(k, [...(grupos.get(k) ?? []), w]);
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Cada local con sus almacenes, cámaras, congeladoras y mostrador. La prioridad de salida decide de dónde sale primero la mercadería al despachar."
        actions={puedeEditar && puede("ALM", "C") && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)}>Nuevo almacén</Button>} />
      <div className="flex flex-wrap gap-2">
        <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" }]} />
      </div>
      {error && <Alert tone="bad" title="No se pudo cargar">{error}</Alert>}
      {cargando && !filas.length && <p className="text-[13px] text-muted">Cargando…</p>}
      {!cargando && !filas.length && !error && <p className="text-[13px] text-muted">No hay almacenes con ese filtro.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {[...grupos].map(([nombre, ws]) => (
          <section key={nombre} className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="mb-3 text-[15px] font-semibold">{nombre}</h2>
            <ul className="divide-y divide-line">
              {ws.map((w) => {
                const Icono = ICONO[w.wh_type] ?? Warehouse;
                const hijo = Boolean(w.parent_id);
                return (
                  <li key={w.id} className={hijo ? "pl-6" : ""}>
                    <button type="button" disabled={!puedeEditar} onClick={() => setEditando(w)}
                      className="flex w-full items-start gap-3 py-2.5 text-left enabled:cursor-pointer enabled:hover:bg-surface-2 rounded-lg px-1">
                      <span className="mt-0.5 rounded-lg bg-primary-soft p-1.5 text-primary"><Icono size={16} aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12.5px] font-semibold">{w.code}</span>
                          <span className="text-[13.5px]">{w.name}</span>
                          {w.status !== "ACTIVE" && <StatusBadge status={w.status} />}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-muted">
                          <Badge>{etiqueta(TIPOS_ALMACEN, w.wh_type)}</Badge>
                          {(w.min_temp_c !== null || w.max_temp_c !== null) && <Badge tone="info">{w.min_temp_c ?? "—"} a {w.max_temp_c ?? "—"} °C</Badge>}
                          {w.allows_sale && <Badge tone="ok">Vende</Badge>}
                          {w.vehicle_plate && <Badge>{w.vehicle_plate}</Badge>}
                          <span>Prioridad {w.pick_priority ?? "—"}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[12px] text-muted">
                        <span className="block">{w.balances} saldos</span>
                        {w.stock_value !== null && <span className="block font-medium text-ink">{soles(w.stock_value)}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {editando !== undefined && op && (
        <AlmacenForm almacen={editando} op={op} todos={filas} onClose={() => setEditando(undefined)}
          onGuardado={() => { setEditando(undefined); olvidarOpciones(); recargar(); }} />
      )}
    </div>
  );
}

function AlmacenForm({ almacen, op, todos, onClose, onGuardado }:
  { almacen: Almacen | null; op: Opciones; todos: Almacen[]; onClose: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    code: almacen?.code ?? "", name: almacen?.name ?? "", wh_type: almacen?.wh_type ?? "COLD_ROOM", establishment_id: almacen?.establishment_id ?? "",
    min_temp_c: almacen?.min_temp_c?.toString() ?? "", max_temp_c: almacen?.max_temp_c?.toString() ?? "", allows_sale: almacen?.allows_sale ?? false,
    pick_priority: almacen?.pick_priority?.toString() ?? "10", parent_id: almacen?.parent_id ?? "", vehicle_id: almacen?.vehicle_id ?? "",
    status: almacen?.status ?? "ACTIVE",
  });
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const padres = todos.filter((w) => w.id !== almacen?.id && !w.parent_id && w.establishment_id === (f.establishment_id || null));
  return (
    <Dialogo titulo={almacen ? `Editar ${almacen.code}` : "Nuevo almacén"} boton="Guardar" onClose={onClose}
      enviar={async () => {
        await api(almacen ? `/v1/alm/almacenes/${almacen.id}` : "/v1/alm/almacenes", {
          method: almacen ? "PUT" : "POST",
          body: { ...f, establishment_id: f.establishment_id || null, parent_id: f.parent_id || null, vehicle_id: f.vehicle_id || null,
            min_temp_c: num(f.min_temp_c), max_temp_c: num(f.max_temp_c), pick_priority: num(f.pick_priority) },
        });
        toast.ok("Almacén guardado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Código" required error={e.code}><Input value={f.code} onChange={(x) => set("code")(x.target.value.toUpperCase())} maxLength={40} /></Field>
        <Field label="Nombre" required error={e.name}><Input value={f.name} onChange={(x) => set("name")(x.target.value)} maxLength={120} /></Field>
        <Field label="Tipo" required error={e.wh_type}><Select value={f.wh_type} onChange={(x) => set("wh_type")(x.target.value)} options={TIPOS_ALMACEN} /></Field>
        <Field label="Local" error={e.establishment_id}>
          <Select value={f.establishment_id} onChange={(x) => set("establishment_id")(x.target.value)} placeholder="Sin local (tránsito o vehículo)"
            options={op.establishments.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label="Temperatura mínima (°C)" error={e.min_temp_c}><Input inputMode="decimal" value={f.min_temp_c} onChange={(x) => set("min_temp_c")(x.target.value)} /></Field>
        <Field label="Temperatura máxima (°C)" error={e.max_temp_c}><Input inputMode="decimal" value={f.max_temp_c} onChange={(x) => set("max_temp_c")(x.target.value)} /></Field>
        <Field label="Prioridad de salida" hint="Menor sale primero" error={e.pick_priority}><Input inputMode="numeric" value={f.pick_priority} onChange={(x) => set("pick_priority")(x.target.value)} /></Field>
        <Field label="Dentro de" error={e.parent_id}>
          <Select value={f.parent_id} onChange={(x) => set("parent_id")(x.target.value)} placeholder="Ninguno" options={padres.map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }))} />
        </Field>
        {f.wh_type === "VEHICLE" && (
          <Field label="Vehículo" error={e.vehicle_id}>
            <Select value={f.vehicle_id} onChange={(x) => set("vehicle_id")(x.target.value)} placeholder="Elegir" options={op.vehicles.map((v) => ({ value: v.id, label: v.plate }))} />
          </Field>
        )}
        <Field label="Estado" error={e.status}><Select value={f.status} onChange={(x) => set("status")(x.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
        <div className="sm:col-span-2"><Checkbox checked={f.allows_sale} onChange={(v) => set("allows_sale")(v)} label="Vende (se reserva y despacha desde aquí)" /></div>
      </>}
    </Dialogo>
  );
}
