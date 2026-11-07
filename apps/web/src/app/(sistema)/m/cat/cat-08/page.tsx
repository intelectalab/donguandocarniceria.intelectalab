"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, CircleAlert, CircleCheck, PackageX, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, Field, Input, PageHeader, Select, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/cat/Dialogo";
import type { Combo, Variante } from "@/modulos/cat/tipos";

type Componente = Combo["componentes"][number];
const unidad = (modo: string) => (modo === "KG" ? "kg" : "u");

/** CAT-08 Combos (RN-CAT-08): componentes con cantidad, peso estimado y % del precio; el reparto suma 100 %. */
export default function Combos() {
  const { me, marca, can } = useSesion();
  const puedeEditar = can("cat.product.manage");
  const [datos, setDatos] = useState<Combo[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [dialogo, setDialogo] = useState<{ tipo: "nuevo" } | { tipo: "componente"; combo: Combo; comp: Componente | null } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Combo[]>(`/v1/cat/combos${marca !== "ALL" ? `?brand_id=${marca}` : ""}`)
      .then((d) => { if (vigente) { setDatos(d); setError(""); } }).catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [marca, version]);
  const recargar = () => setVersion((n) => n + 1);
  const combos = useMemo(() => datos ?? [], [datos]);

  async function quitar(combo: Combo, c: Componente) {
    const ok = await confirmAction({ title: `Quitar ${c.name}`, message: `Sale del combo ${combo.name}. El reparto del precio dejará de sumar 100 % hasta que lo ajustes.`, confirmLabel: "Quitar", danger: true });
    if (!ok) return;
    try {
      await api(`/v1/cat/combos/${combo.id}/componentes/${c.id}`, { method: "DELETE" });
      toast.ok("Componente quitado");
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Componentes con cantidad, peso estimado y porcentaje del precio. El reparto suma 100 % y se muestra cuántos combos alcanzan con el stock de cada componente; el stock y el comprobante salen por componente."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setDialogo({ tipo: "nuevo" })}>Nuevo combo</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Combos" icono={Boxes} destacada valor={datos ? numero(combos.length) : undefined} detalle="En las marcas seleccionadas" />
        <Cifra titulo="Con reparto válido" icono={CircleCheck} valor={datos ? numero(combos.filter((c) => c.revision.ok).length) : undefined} detalle="Suman 100 % (RN-CAT-08)" />
        <Cifra titulo="Sin stock de algún componente" icono={PackageX} valor={datos ? numero(combos.filter((c) => c.alcanza <= 0).length) : undefined} detalle="No alcanza para un combo" />
      </div>

      {error && <Alert tone="bad">{error}</Alert>}
      {datos && !combos.length && <Alert tone="info">No hay combos en las marcas seleccionadas.</Alert>}

      {combos.map((c) => (
        <section key={c.id} className="overflow-hidden rounded-[14px] border border-line bg-surface">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="text-[15px] font-semibold"><span className="font-mono">{c.sku}</span> · {c.name}</h2>
              <p className="text-[12.5px] text-muted">{c.brand_name} · <Link href={`/m/cat/cat-02?id=${c.product_id}`} className="text-primary underline">Ficha del producto</Link></p>
            </div>
            {puedeEditar && <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialogo({ tipo: "componente", combo: c, comp: null })}>Agregar componente</Button>}
          </header>
          <div className="space-y-3 p-4">
            {c.revision.ok
              ? <Alert tone={c.alcanza > 0 ? "ok" : "warn"}>Reparto 100 % · precio {c.precio_whatsapp ? soles(c.precio_whatsapp.price) : "sin precio (RN-CAT-05)"} · alcanza para {numero(c.alcanza)} combos con el stock disponible.</Alert>
              : <Alert tone="bad"><CircleAlert size={14} className="mr-1 inline" />RN-CAT-08: {c.revision.problemas.join(" ")}</Alert>}
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11.5px] uppercase tracking-wide text-muted"><tr className="border-b border-line">
                  <th className="py-2 pr-3">Componente</th><th className="py-2 pr-3 text-right">Cantidad</th><th className="py-2 pr-3 text-right">Peso est.</th>
                  <th className="py-2 pr-3 text-right">% del precio</th><th className="py-2 pr-3 text-right">Importe</th><th className="py-2 pr-3 text-right">Stock disp.</th>{puedeEditar && <th />}
                </tr></thead>
                <tbody>
                  {c.componentes.map((x) => (
                    <tr key={x.id} className={`border-b border-line ${puedeEditar ? "cursor-pointer hover:bg-surface-2" : ""}`}
                      onClick={() => puedeEditar && setDialogo({ tipo: "componente", combo: c, comp: x })}>
                      <td className="py-2 pr-3"><span className="font-mono text-[12px]">{x.sku}</span> · {x.name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{numero(x.qty, x.sale_mode === "KG" ? 3 : 0)} {unidad(x.sale_mode)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{x.est_weight_kg ? kg(x.est_weight_kg) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{porcentaje(x.price_share_pct, 1)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{x.importe !== null ? soles(x.importe) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{x.stock < x.qty ? <Badge tone="bad">{numero(x.stock, 1)}</Badge> : numero(x.stock, 1)}</td>
                      {puedeEditar && <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => quitar(c, x)} aria-label={`Quitar ${x.name}`} />
                      </td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="font-semibold"><tr>
                  <td className="py-2 pr-3">Total</td><td /><td />
                  <td className={`py-2 pr-3 text-right tabular-nums ${Math.abs(c.revision.suma - 100) > 0.001 ? "text-bad" : ""}`}>{porcentaje(c.revision.suma, 1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{c.precio_whatsapp ? soles(c.precio_whatsapp.price) : "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{numero(c.alcanza)} combos</td>{puedeEditar && <td />}
                </tr></tfoot>
              </table>
            </div>
          </div>
        </section>
      ))}

      {dialogo?.tipo === "nuevo" && <NuevoCombo marcas={me.brands} marca={marca !== "ALL" ? marca : (me.brands[0]?.id ?? "")}
        onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); recargar(); }} />}
      {dialogo?.tipo === "componente" && <ComponenteForm combo={dialogo.combo} comp={dialogo.comp}
        onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); recargar(); }} />}
    </div>
  );
}

function NuevoCombo({ marcas, marca, onClose, onHecho }: { marcas: { id: string; name: string }[]; marca: string; onClose: () => void; onHecho: () => void }) {
  const [v, setV] = useState({ brand_id: marca, code: "PACK-", name: "", price: "" });
  return (
    <Dialogo titulo="Nuevo combo" boton="Crear combo" onClose={onClose}
      aviso="Crea el producto combo, su variante por unidad y su precio en las listas generales activas de la marca (B2B con 10 % menos). Después agrega sus componentes."
      enviar={async () => {
        const r = await api<{ sku: string }>("/v1/cat/combos", { method: "POST", body: { ...v, price: Number(v.price) } });
        toast.ok(`Combo ${r.sku} creado: agrega sus componentes`);
        onHecho();
      }}>
      {(errores) => <>
        <Field label="Marca" required error={errores.brand_id}><Select value={v.brand_id} onChange={(e) => setV({ ...v, brand_id: e.target.value })} options={marcas.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Código" required error={errores.code}><Input value={v.code} maxLength={30} className="font-mono uppercase" onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })} /></Field>
        <Field label="Nombre" required error={errores.name}><Input value={v.name} maxLength={255} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Precio público (S/)" required error={errores.price}><Input type="number" step="0.01" min={0} value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

function ComponenteForm({ combo, comp, onClose, onHecho }: { combo: Combo; comp: Componente | null; onClose: () => void; onHecho: () => void }) {
  const falta = Math.round((100 - combo.revision.suma + (comp?.price_share_pct ?? 0)) * 1000) / 1000;
  const [variantes, setVariantes] = useState<Variante[]>([]);
  const [v, setV] = useState({
    component_variant_id: comp?.component_variant_id ?? "", qty: comp ? String(comp.qty) : "1",
    est_weight_kg: comp?.est_weight_kg ? String(comp.est_weight_kg) : "", price_share_pct: String(comp ? comp.price_share_pct : falta > 0 ? falta : 10),
  });

  useEffect(() => {
    if (comp) return;
    let vigente = true;
    const q = new URLSearchParams({ status: "ACTIVE", per_page: "100", brand_id: combo.brand_id });
    api<{ data: Variante[] }>(`/v1/cat/variantes?${q}`).then((d) => vigente && setVariantes(d.data.filter((x) => x.sellable && x.id !== combo.id))).catch(() => {});
    return () => { vigente = false; };
  }, [comp, combo.brand_id, combo.id]);

  return (
    <Dialogo titulo={comp ? `Editar ${comp.name}` : `Agregar componente · ${combo.name}`} boton={comp ? "Guardar" : "Agregar"} onClose={onClose}
      aviso={`Falta repartir ${porcentaje(Math.max(0, 100 - combo.revision.suma), 1)} del precio. Un combo no contiene otro combo (RN-CAT-08). Peso vacío: se calcula con el peso nominal.`}
      enviar={async () => {
        const body = { ...v, qty: Number(v.qty), price_share_pct: Number(v.price_share_pct), est_weight_kg: v.est_weight_kg === "" ? null : Number(v.est_weight_kg) };
        await api(comp ? `/v1/cat/combos/${combo.id}/componentes/${comp.id}` : `/v1/cat/combos/${combo.id}/componentes`, { method: comp ? "PUT" : "POST", body });
        toast.ok(comp ? "Componente actualizado" : "Componente agregado");
        onHecho();
      }}>
      {(errores) => <>
        {!comp && <Field label="Variante" required error={errores.component_variant_id} className="sm:col-span-2">
          <Select value={v.component_variant_id} onChange={(e) => setV({ ...v, component_variant_id: e.target.value })} placeholder="Elige la variante"
            options={variantes.map((x) => ({ value: x.id, label: `${x.sku} · ${x.name}` }))} />
        </Field>}
        <Field label="Cantidad" required error={errores.qty}><Input type="number" step="0.001" min={0} value={v.qty} onChange={(e) => setV({ ...v, qty: e.target.value })} /></Field>
        <Field label="Peso estimado (kg)" error={errores.est_weight_kg}><Input type="number" step="0.001" min={0} value={v.est_weight_kg} onChange={(e) => setV({ ...v, est_weight_kg: e.target.value })} /></Field>
        <Field label="% del precio" required error={errores.price_share_pct}><Input type="number" step="0.01" min={0} max={100} value={v.price_share_pct} onChange={(e) => setV({ ...v, price_share_pct: e.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}
