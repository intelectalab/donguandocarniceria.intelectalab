"use client";

import { useState } from "react";
import { Thermometer } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Seccion, accion, grados, num, qs, useDatos, useOpcionesCal } from "@/modulos/cal/comunes";
import { TIPO_PUNTO, type Num, type Punto } from "@/modulos/cal/tipos";

type Lectura = { id: string; point_id: string; read_at: string; value_c: Num; source: string; context: string | null; in_range: boolean; excursion_id: string | null; approved_at: string | null;
  point_code: string; point_name: string; point_type: string; min_c: Num; max_c: Num; read_by_name: string | null; approved_by_name: string | null };
type Resultado = { reading: { in_range: boolean }; opened: boolean; needs_approval: boolean };

/** CAL-05 Registro de temperaturas: lectura rápida desde el celular; fuera de rango abre o sigue la excursión (RN-CAL-13). */
export default function Temperaturas() {
  const { local } = useSesion();
  const op = useOpcionesCal();
  const pts = useDatos<{ data: Punto[] }>(`/v1/cal/puntos${qs({ site: local })}`);
  const lista = useListado<Lectura>("/v1/cal/lecturas", { orden: "-read_at", filtros: { site: local } });
  const [f, setF] = useState({ point_id: "", value_c: "", context: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const p = pts.datos?.data.find((x) => x.id === f.point_id);
  const v = num(f.value_c);
  const fuera = p && v !== null && (v < Number(p.min_c) || v > Number(p.max_c));
  async function leer() {
    setEnviando(true); setError("");
    try {
      const r = await api<Resultado>("/v1/cal/lecturas", { method: "POST", body: { point_id: f.point_id, value_c: v, context: f.context || null } });
      if (r.reading.in_range) toast.ok(`${p?.code}: ${grados(v)} dentro del rango`);
      else toast.error(`${p?.code}: ${grados(v)} fuera de rango${r.opened ? " · se abrió una excursión" : ""}${r.needs_approval ? " · la carga necesita aprobación de Calidad" : ""}`);
      setF({ ...f, value_c: "", context: "" }); lista.recargar(); pts.recargar();
    } catch (e) { const c = erroresDe(e); setError(Object.values(c)[0] ?? mensajeDe(e)); } finally { setEnviando(false); }
  }
  const columnas: Column<Lectura>[] = [
    { key: "read_at", header: "Hora", sortable: true, render: (l) => fechaHora(l.read_at) },
    { key: "point_name", header: "Punto", cardTitle: true, render: (l) => <div><p className="font-medium">{l.point_name}</p><p className="font-mono text-[12px] text-muted">{l.point_code}</p></div> },
    { key: "value_c", header: "Temperatura", align: "right", render: (l) => <Badge tone={l.in_range ? "ok" : "bad"}>{grados(l.value_c)}</Badge> },
    { key: "range", header: "Rango", hideOnMobile: true, render: (l) => `${grados(l.min_c)} a ${grados(l.max_c)}` },
    { key: "read_by_name", header: "Leyó", render: (l) => `${l.read_by_name ?? "—"}${l.source === "SENSOR" ? " (sensor)" : ""}` },
    { key: "acc", header: "", render: (l) => l.point_type === "VEHICLE" && !l.in_range ? (l.approved_at ? <span className="text-[12px] text-muted">Aprobó {l.approved_by_name}</span>
      : op?.can.release ? <Button size="sm" onClick={(e) => { e.stopPropagation(); void accion({ title: "¿Aprobar la carga del vehículo?", message: "La temperatura está fuera de rango: queda registrado que Calidad lo aprobó.", confirmLabel: "Aprobar" },
        () => api(`/v1/cal/lecturas/${l.id}/aprobar`, { method: "POST" }), "Carga aprobada", lista.recargar); }}>Aprobar carga</Button> : <Badge tone="warn">Por aprobar</Badge>) : null },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Elige el punto y escribe la temperatura. Una lectura fuera de rango abre la excursión y avisa; un vehículo fuera de rango no carga sin la aprobación de Calidad." />
      <Seccion titulo="Nueva lectura" className="max-w-xl">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void leer(); }}>
          {error && <Alert tone="bad">{error}</Alert>}
          <Field label="Punto" required>
            <Select value={f.point_id} searchable placeholder="Elegir" onChange={(e) => setF({ ...f, point_id: e.target.value })}
              options={(pts.datos?.data ?? []).filter((x) => x.status === "ACTIVE").map((x) => ({ value: x.id, label: `${x.code} · ${x.name}${x.overdue ? " · atrasado" : ""}` }))} />
          </Field>
          {p && <p className="text-[12.5px] text-muted">{TIPO_PUNTO[p.point_type]} · rango {grados(p.min_c)} a {grados(p.max_c)} · última {grados(p.last_value_c)} {p.last_read_at ? `(${fechaHora(p.last_read_at)})` : ""}</p>}
          <Field label="Temperatura" required><Input inputMode="decimal" suffix="°C" className="text-[20px]" value={f.value_c} onChange={(e) => setF({ ...f, value_c: e.target.value })} /></Field>
          {fuera && <Alert tone="bad">Fuera de rango: al guardar se abre la excursión.</Alert>}
          <Field label="Comentario"><Input value={f.context} placeholder="Puerta abierta por carga, descongelamiento…" onChange={(e) => setF({ ...f, context: e.target.value })} /></Field>
          <Button type="submit" variant="primary" icon={Thermometer} loading={enviando} disabled={!f.point_id || v === null} className="w-full">Registrar lectura</Button>
        </form>
      </Seccion>
      <DataTable {...lista.tabla} columns={columnas} search={{ ...lista.tabla.search, placeholder: "Buscar punto…" }} empty="Sin lecturas." />
    </div>
  );
}
