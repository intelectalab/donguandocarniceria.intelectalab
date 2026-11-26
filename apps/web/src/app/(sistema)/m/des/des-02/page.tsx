"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Field, Input, PageHeader, Select, StatusBadge, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, accion, num, useAlAbrir, useDatos, useOpcionesPro } from "@/modulos/pro/comunes";
import { ESPECIE, ESTADO_PLANTILLA, ROL_SALIDA, opciones, type Num } from "@/modulos/pro/tipos";

type Linea = { seq: number; name: string; role: string; output_variant_id: string | null; standard_yield_pct: Num; nrv_cost_per_kg: Num; notes: string | null };
type Plantilla = { id: string; code: string; name: string; species: string; version: number; status: string; input_variant_id: string; mass_balance_tolerance_pct: Num;
  notes: string | null; lines: Linea[]; history: { at: string; user: string; action: string; detail: string }[] | null; orders?: number };
type Fila = { seq: string; name: string; role: string; output_variant_id: string; standard_yield_pct: string; nrv_cost_per_kg: string; notes: string };

const aFila = (l: Linea): Fila => ({ seq: String(l.seq), name: l.name, role: l.role, output_variant_id: l.output_variant_id ?? "", standard_yield_pct: l.standard_yield_pct != null ? String(Number(l.standard_yield_pct)) : "",
  nrv_cost_per_kg: l.nrv_cost_per_kg != null && Number(l.nrv_cost_per_kg) ? String(Number(l.nrv_cost_per_kg)) : "", notes: l.notes ?? "" });

/** DES-02 Editor de plantilla: cortes con su rol y rendimiento estándar (suman 100 %, RN-DES-02), VNR de subproductos y tolerancia del balance. */
export default function EditorPlantilla() {
  const { puede } = useSesion();
  const router = useRouter();
  const op = useOpcionesPro();
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id")));
  const { datos: t, recargar } = useDatos<Plantilla>(id ? `/v1/des/plantillas/${id}` : null);
  return (
    <div className="space-y-5">
      <PageHeader description="La suma de los rendimientos estándar debe dar 100 %. Los subproductos llevan su valor neto de realización (VNR) y no reciben costo conjunto." />
      {op && (id === null || (t && t.id === id)) && <Editor key={t?.id ?? "nueva"} t={id ? t ?? null : null} edita={Boolean(op.can.template) && puede("DES", "E")}
        variantes={op.variants.map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}` }))}
        onGuardado={(nuevo) => { if (nuevo !== id) { setId(nuevo); router.replace(`/m/des/des-02?id=${nuevo}`); } else recargar(); }} />}
    </div>
  );
}

function Editor({ t, edita, variantes, onGuardado }: { t: Plantilla | null; edita: boolean; variantes: { value: string; label: string }[]; onGuardado: (id: string) => void }) {
  const [f, setF] = useState({ code: t?.code ?? "", name: t?.name ?? "", species: t?.species ?? "CERDO", input_variant_id: t?.input_variant_id ?? "",
    mass_balance_tolerance_pct: t ? String(Number(t.mass_balance_tolerance_pct)) : "2", notes: t?.notes ?? "" });
  const [filas, setFilas] = useState<Fila[]>(t ? t.lines.map(aFila) : [{ seq: "10", name: "", role: "CO_PRODUCT", output_variant_id: "", standard_yield_pct: "", nrv_cost_per_kg: "", notes: "" }]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const borrador = !t || t.status === "DRAFT";
  const puedeEditar = edita && borrador;
  const suma = filas.reduce((s, x) => s + (num(x.standard_yield_pct) ?? 0), 0);
  const setFila = (i: number, k: keyof Fila, v: string) => setFilas(filas.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  async function guardar() {
    setGuardando(true); setError(""); setErrores({});
    try {
      const body = { ...f, mass_balance_tolerance_pct: num(f.mass_balance_tolerance_pct), notes: f.notes || null,
        lines: filas.map((x, i) => ({ seq: Number(x.seq) || (i + 1) * 10, name: x.name, role: x.role, output_variant_id: x.output_variant_id || null, standard_yield_pct: num(x.standard_yield_pct),
          nrv_cost_per_kg: num(x.nrv_cost_per_kg), notes: x.notes || null })) };
      const r = await api<{ id: string }>(t ? `/v1/des/plantillas/${t.id}` : "/v1/des/plantillas", { method: t ? "PUT" : "POST", body });
      toast.ok("Plantilla guardada"); onGuardado(r.id);
    } catch (e) { const c = erroresDe(e); setErrores(c); if (!Object.keys(c).length) setError(mensajeDe(e)); } finally { setGuardando(false); }
  }

  return (
    <>
      {t && <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[15px] font-semibold">{t.code}</span><span className="text-muted">v{t.version}</span><StatusBadge status={t.status} labels={ESTADO_PLANTILLA} />
        <div className="ml-auto flex flex-wrap gap-2">
          {edita && t.status === "DRAFT" && <Button variant="primary" onClick={() => accion({ title: `¿Activar ${t.code} v${t.version}?`, message: "Si hay otra versión activa, queda retirada.", confirmLabel: "Activar" },
            () => api(`/v1/des/plantillas/${t.id}/activar`, { method: "POST" }), "Plantilla activa", () => onGuardado(t.id))}>Activar</Button>}
          {edita && t.status !== "DRAFT" && <Button onClick={async () => { try { const r = await api<{ id: string }>(`/v1/des/plantillas/${t.id}/version`, { method: "POST" }); toast.ok("Nueva versión en borrador"); onGuardado(r.id); } catch (e) { toast.error(mensajeDe(e)); } }}>Crear nueva versión</Button>}
          {edita && t.status === "ACTIVE" && <Button variant="danger" onClick={() => accion({ title: `¿Retirar ${t.code}?`, confirmLabel: "Retirar", danger: true },
            () => api(`/v1/des/plantillas/${t.id}/retirar`, { method: "POST" }), "Plantilla retirada", () => onGuardado(t.id))}>Retirar</Button>}
        </div>
      </div>}
      {t && !borrador && <Alert tone="info">Esta versión está {t.status === "ACTIVE" ? "activa" : "retirada"} y no se edita. Para cambiar cortes o rendimientos, crea su nueva versión.</Alert>}
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo="Datos">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Código" required error={errores.code}><Input value={f.code} disabled={!puedeEditar || Boolean(t)} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Nombre" required error={errores.name}><Input value={f.name} disabled={!puedeEditar} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Especie" required error={errores.species}><Select value={f.species} disabled={!puedeEditar} options={opciones(ESPECIE)} onChange={(e) => setF({ ...f, species: e.target.value })} /></Field>
          <Field label="Lo que entra" required error={errores.input_variant_id} className="lg:col-span-2"><Select value={f.input_variant_id} disabled={!puedeEditar} searchable placeholder="Elegir" options={variantes} onChange={(e) => setF({ ...f, input_variant_id: e.target.value })} /></Field>
          <Field label="Tolerancia del balance de masa" error={errores.mass_balance_tolerance_pct}><Input inputMode="decimal" suffix="%" disabled={!puedeEditar} value={f.mass_balance_tolerance_pct} onChange={(e) => setF({ ...f, mass_balance_tolerance_pct: e.target.value })} /></Field>
          <Field label="Notas" error={errores.notes} className="sm:col-span-2 lg:col-span-3"><Textarea rows={2} disabled={!puedeEditar} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Seccion>
      <Seccion titulo="Cortes" acciones={<Badge tone={Math.abs(suma - 100) < 0.001 ? "ok" : "bad"}>Suma {porcentaje(suma, 3)}</Badge>}>
        <div className="space-y-3">
          {filas.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-[9px] border border-line p-3 sm:grid-cols-[60px_minmax(0,1.2fr)_150px_minmax(0,1.5fr)_100px_100px_auto] sm:items-end sm:border-0 sm:p-0">
              <Field label="Orden"><Input inputMode="numeric" disabled={!puedeEditar} value={x.seq} onChange={(e) => setFila(i, "seq", e.target.value)} /></Field>
              <Field label="Corte" error={errores[`lines.${i}.name`]}><Input disabled={!puedeEditar} value={x.name} onChange={(e) => setFila(i, "name", e.target.value)} /></Field>
              <Field label="Rol"><Select value={x.role} disabled={!puedeEditar} options={["CO_PRODUCT", "BY_PRODUCT", "WASTE"].map((k) => ({ value: k, label: ROL_SALIDA[k] }))} onChange={(e) => setFila(i, "role", e.target.value)} /></Field>
              <Field label="Producto que sale"><Select value={x.output_variant_id} disabled={!puedeEditar || x.role === "WASTE"} searchable placeholder={x.role === "WASTE" ? "No aplica" : "Elegir"} options={variantes} onChange={(e) => setFila(i, "output_variant_id", e.target.value)} /></Field>
              <Field label="Estándar" error={errores[`lines.${i}.standard_yield_pct`]}><Input inputMode="decimal" suffix="%" disabled={!puedeEditar} value={x.standard_yield_pct} onChange={(e) => setFila(i, "standard_yield_pct", e.target.value)} /></Field>
              <Field label="VNR por kg"><Input inputMode="decimal" prefix="S/" disabled={!puedeEditar || x.role !== "BY_PRODUCT"} value={x.nrv_cost_per_kg} onChange={(e) => setFila(i, "nrv_cost_per_kg", e.target.value)} /></Field>
              {puedeEditar && <button type="button" aria-label="Quitar corte" className="cursor-pointer justify-self-end p-2 text-muted hover:text-bad" onClick={() => setFilas(filas.filter((_, j) => j !== i))}><Trash2 size={16} /></button>}
            </div>
          ))}
          {puedeEditar && <Button size="sm" variant="ghost" icon={Plus} onClick={() => setFilas([...filas, { seq: String((filas.length + 1) * 10), name: "", role: "CO_PRODUCT", output_variant_id: "", standard_yield_pct: "", nrv_cost_per_kg: "", notes: "" }])}>Agregar corte</Button>}
        </div>
      </Seccion>
      {puedeEditar && <div><Button variant="primary" loading={guardando} onClick={() => void guardar()}>Guardar {t ? "cambios" : "borrador"}</Button></div>}
      {t?.history && t.history.length > 0 && <Seccion titulo="Historial">
        <ol className="space-y-2 text-[13px]">{t.history.map((h, i) => <li key={i} className="border-l-2 border-line pl-3"><p><b>{h.action}</b> · {h.detail}</p><p className="text-[12px] text-muted">{fechaHora(h.at)} · {h.user}</p></li>)}</ol>
      </Seccion>}
    </>
  );
}
