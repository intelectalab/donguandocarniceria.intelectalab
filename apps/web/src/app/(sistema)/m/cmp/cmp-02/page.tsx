"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Save, X } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { Panel, Sub, num, opciones, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Chips } from "@/modulos/cmp/Chips";
import { CANAL_PEDIDO, type Opciones, type Reglas, type Segmento } from "@/modulos/cmp/tipos";

type Previa = { size: number; consent: number; description: string; sample: { id: string; full_name: string; last: string | null; n: number; rfm: string | null; consent: boolean }[] };
type Ficha = Segmento & { members: { id: string; full_name: string; phone: string | null; last: string | null; n: number; avg: number; rfm: string | null; consent: boolean }[] };

/** CMP-02 Constructor de segmento: reglas sobre marca, recencia, productos, zona, canal, ticket y RFM, con vista previa en vivo. */
export default function Constructor() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [id, setId] = useState<string | null>(null);
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const ficha = useDatos<Ficha>(id ? `/v1/cmp/segmentos/${id}` : null);
  const [f, setF] = useState<{ code: string; name: string; brand_id: string; refresh_hours: string; status: string } | null>(null);
  const [reglas, setReglas] = useState<Reglas>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  if (id === "" && f === null) setF({ code: "", name: "", brand_id: "", refresh_hours: "24", status: "ACTIVE" });
  if (ficha.datos && f === null) {
    const s = ficha.datos;
    setF({ code: s.code, name: s.name, brand_id: s.brand_id ?? "", refresh_hours: String(s.refresh_hours), status: s.status });
    setReglas(s.rules ?? {});
  }

  const clave = JSON.stringify({ reglas, b: f?.brand_id });
  useEffect(() => {
    if (!f) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Previa>("/v1/cmp/segmentos/vista-previa", { method: "POST", body: { rules: reglas, brand_id: f.brand_id || null } }).then((x) => vigente && setPrevia(x)).catch(() => {});
    }, 450);
    return () => { vigente = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la clave resume reglas y marca
  }, [clave]);

  if (!f || !op) return <p className="text-sm text-muted">{ficha.error ?? "Cargando…"}</p>;
  const set = <K extends keyof Reglas>(k: K, v: Reglas[K]) => setReglas({ ...reglas, [k]: v });
  const gestiona = Boolean(op.can["cmp.segment.manage"]);
  const productos = op.products.filter((p) => !reglas.brands?.length || reglas.brands.includes(p.brand_id));

  async function guardar() {
    setGuardando(true); setErrores({});
    try {
      await api(id ? `/v1/cmp/segmentos/${id}` : "/v1/cmp/segmentos", { method: id ? "PUT" : "POST", body: { ...f, brand_id: f!.brand_id || null, refresh_hours: Number(f!.refresh_hours), segment_type: "DYNAMIC", rules: reglas } });
      toast.ok("Segmento guardado"); router.push("/m/cmp/cmp-01");
    } catch (e) { const x = erroresDe(e); setErrores(x); if (!Object.keys(x).length) toast.error(mensajeDe(e)); } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-5">
      <PageHeader code={id ? f.code : "Nuevo segmento"} description="Cada regla que marques achica el segmento. La vista previa cuenta a los clientes que cumplen todas y cuántos aceptan promociones de la marca."
        actions={gestiona && <><Button icon={X} onClick={() => router.push("/m/cmp/cmp-01")}>Cancelar</Button><Button variant="primary" icon={Save} loading={guardando} onClick={guardar}>Guardar</Button></>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel titulo="Datos">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Código" required error={errores.code} hint="Mayúsculas, números y guiones."><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="SEG-DG-CUY" /></Field>
              <Field label="Nombre" required error={errores.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Marca de la audiencia" error={errores.brand_id} hint="El consentimiento se cuenta para esta marca."><Select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value })} placeholder="Todas las marcas" options={op.brands.map((b) => ({ value: b.id, label: b.name }))} /></Field>
              <Field label="Actualizar cada (horas)" error={errores.refresh_hours}><Input inputMode="numeric" value={f.refresh_hours} onChange={(e) => setF({ ...f, refresh_hours: e.target.value })} /></Field>
            </div>
          </Panel>
          <Panel titulo="Qué compró">
            <div className="space-y-4">
              <Field label="Compró de la marca"><Chips etiqueta="Marcas" opciones={op.brands.map((b) => ({ value: b.id, label: b.name }))} valor={reglas.brands ?? []} onChange={(v) => set("brands", v)} /></Field>
              <Field label="Líneas de producto"><Chips etiqueta="Líneas" opciones={op.lines.map((l) => ({ value: l, label: l.charAt(0) + l.slice(1).toLowerCase() }))} valor={reglas.lines ?? []} onChange={(v) => set("lines", v)} /></Field>
              <Field label="Productos">
                <Select value="" onChange={(e) => e.target.value && set("products", [...(reglas.products ?? []), e.target.value])} placeholder="Agregar producto"
                  options={productos.filter((p) => !reglas.products?.includes(p.id)).map((p) => ({ value: p.id, label: p.name }))} />
                {reglas.products?.length ? <div className="mt-2"><Chips etiqueta="Productos elegidos" opciones={op.products.filter((p) => reglas.products!.includes(p.id)).map((p) => ({ value: p.id, label: `${p.name} ✕` }))}
                  valor={reglas.products} onChange={(v) => set("products", v)} /></div> : null}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ticket promedio desde"><Input inputMode="decimal" prefix="S/" value={reglas.min_avg_ticket ?? ""} onChange={(e) => set("min_avg_ticket", num(e.target.value))} /></Field>
                <Field label="Pedidos desde"><Input inputMode="numeric" value={reglas.min_orders ?? ""} onChange={(e) => set("min_orders", num(e.target.value))} /></Field>
              </div>
            </div>
          </Panel>
          <Panel titulo="Cuándo compró">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Última compra hace al menos (días)"><Input inputMode="numeric" value={reglas.last_purchase_days?.min ?? ""} onChange={(e) => set("last_purchase_days", { ...reglas.last_purchase_days, min: num(e.target.value) })} /></Field>
                <Field label="Y como mucho (días)"><Input inputMode="numeric" value={reglas.last_purchase_days?.max ?? ""} onChange={(e) => set("last_purchase_days", { ...reglas.last_purchase_days, max: num(e.target.value) })} /></Field>
              </div>
              <Checkbox checked={Boolean(reglas.inactive)} onChange={(v) => set("inactive", v)} label={`Inactivos: ${op.params.inactive_days} días o más sin comprar`} />
              <Checkbox checked={Boolean(reglas.never_bought)} onChange={(v) => set("never_bought", v)} label="Nunca compraron (contactos sin pedidos)" />
              <Checkbox checked={Boolean(reglas.rebuy_due)} onChange={(v) => set("rebuy_due", v)} label="Les toca recomprar según su frecuencia" hint="Usa la recompra esperada de cada cliente y producto." />
              {reglas.rebuy_due && <Field label="Recompra de un producto"><Select value={reglas.rebuy_product ?? ""} onChange={(e) => set("rebuy_product", e.target.value)} placeholder="Cualquier producto" options={productos.map((p) => ({ value: p.id, label: p.name }))} /></Field>}
              <Field label="Grupo RFM (recencia, frecuencia y monto)"><Chips etiqueta="RFM" opciones={opciones(op.rfm)} valor={reglas.rfm ?? []} onChange={(v) => set("rfm", v)} /></Field>
            </div>
          </Panel>
          <Panel titulo="Dónde y cómo">
            <div className="space-y-4">
              <Field label="Zonas de reparto"><Chips etiqueta="Zonas" opciones={op.zones.map((z) => ({ value: z.id, label: z.name }))} valor={reglas.zones ?? []} onChange={(v) => set("zones", v)} /></Field>
              <Field label="Canal por el que compró"><Chips etiqueta="Canales" opciones={op.order_channels.map((c) => ({ value: c, label: CANAL_PEDIDO[c] ?? c }))} valor={reglas.channels ?? []} onChange={(v) => set("channels", v)} /></Field>
              <Field label="Clientes empresa"><Select value={reglas.b2b ?? ""} onChange={(e) => set("b2b", e.target.value as Reglas["b2b"])} placeholder="Personas y empresas"
                options={[{ value: "ONLY", label: "Solo empresas y restaurantes" }, { value: "EXCLUDE", label: "Solo personas" }]} /></Field>
            </div>
          </Panel>
        </div>
        <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <Panel titulo="Vista previa">
            {!previa ? <p className="text-[13px] text-muted">Calculando…</p> : <>
              <p className="text-[28px] font-bold leading-none">{numero(previa.size)}</p><Sub>clientes cumplen la regla</Sub>
              <p className="mt-3 text-[18px] font-semibold text-ok">{numero(previa.consent)} <span className="text-[13px] font-normal text-muted">aceptan promociones ({previa.size ? porcentaje((previa.consent / previa.size) * 100, 0) : "—"})</span></p>
              <p className="mt-3 rounded-lg bg-surface-2 p-2 text-[12.5px]">{previa.description}</p>
              <ul className="mt-3 divide-y divide-line text-[12.5px]">{previa.sample.map((c) => <li key={c.id} className="flex justify-between gap-2 py-1">
                <span>{c.full_name}<Sub>{c.n} pedidos · última {fecha(c.last)}</Sub></span>{c.consent ? <Badge tone="ok">Acepta</Badge> : <Badge tone="neutral">No acepta</Badge>}</li>)}</ul>
            </>}
          </Panel>
          {ficha.datos && <Panel titulo={`Miembros guardados (${numero(ficha.datos.member_count)})`}>
            <ul className="max-h-[300px] divide-y divide-line overflow-y-auto text-[12.5px]">{ficha.datos.members.map((m) => <li key={m.id} className="flex justify-between gap-2 py-1">
              <span>{m.full_name}<Sub>{m.n} pedidos · ticket {soles(m.avg)}</Sub></span>{m.rfm && <Badge tone="info">{op.rfm[m.rfm] ?? m.rfm}</Badge>}</li>)}</ul>
          </Panel>}
          {!gestiona && <Alert tone="info">Puedes ver el segmento, pero no cambiarlo.</Alert>}
        </div>
      </div>
    </div>
  );
}
