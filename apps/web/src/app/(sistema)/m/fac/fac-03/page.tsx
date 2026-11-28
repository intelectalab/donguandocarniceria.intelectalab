"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, PenLine, Plus, Search, Trash2, X } from "lucide-react";
import { Alert, Button, Field, IconButton, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { DOC_ID, hoyLima } from "@/modulos/fac/tipos";

type Opciones = {
  marcas: { id: string; name: string; code: string }[]; locales: { id: string; name: string; short: string | null; code: string }[];
  series: { id: string; series: string; doc_type: string; brand_id: string; establishment_id: string | null; all_sites: boolean; next_number: number }[];
  tope_boleta: number; igv: number; dias_credito: number; hoy: string;
};
type Cliente = { id: string; full_name: string; doc_type: string | null; doc_number: string | null; phone: string | null; fiscal_address: string | null; customer_type: string | null; ruc_valido: boolean };
type Producto = { id: string; sku: string; name: string; sale_mode: string; igv_affectation: string | null; price: string | null; basis: string | null };
type Linea = { key: number; variant_id: string | null; description: string; qty: string; unit_price: string; uom_code: "KGM" | "NIU" | "ZZ"; igv_affectation: "10" | "20" | "30" };

let siguiente = 1;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** FAC-03 Emisión directa: comprobante sin pedido (servicio, ajuste) con productos del catálogo o líneas libres. */
export default function EmisionDirecta() {
  const router = useRouter();
  const { marca: marcaSup, local: localSup, can, puede } = useSesion();
  const { datos: o, error } = useDatos<Opciones>("/v1/fac/emision/opciones");
  const [tipo, setTipo] = useState<"INVOICE" | "RECEIPT">("INVOICE");
  const [marcaSel, setMarca] = useState("");
  const [localSel, setLocal] = useState("");
  const [serieSel, setSerie] = useState("");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [pago, setPago] = useState<"CASH" | "CREDIT">("CASH");
  const [dias, setDias] = useState("");
  const [emision, setEmision] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!o) return <Vacio>Cargando…</Vacio>;

  const marca = marcaSel || (marcaSup !== "ALL" && o.marcas.some((m) => m.id === marcaSup) ? marcaSup : o.marcas[0]?.id ?? "");
  const local = localSel || (localSup !== "ALL" && o.locales.some((l) => l.id === localSup) ? localSup : o.locales[0]?.id ?? "");
  const series = o.series.filter((s) => s.doc_type === tipo && s.brand_id === marca && (s.all_sites || s.establishment_id === local));
  const serie = series.find((s) => s.id === serieSel) ?? series[0];
  const tasa = o.igv;

  const calculadas = lineas.map((l) => {
    const total = r2(Number(l.qty || 0) * Number(l.unit_price || 0));
    const base = l.igv_affectation === "10" ? r2(total / (1 + tasa)) : total;
    return { ...l, total, base, igv: r2(total - base) };
  });
  const total = r2(calculadas.reduce((s, l) => s + l.total, 0));
  const gravado = r2(calculadas.filter((l) => l.igv_affectation === "10").reduce((s, l) => s + l.total, 0));
  const igv = r2(gravado - r2(gravado / (1 + tasa)));
  const facturaSinRuc = tipo === "INVOICE" && cliente && !cliente.ruc_valido;
  const boletaSinDoc = tipo === "RECEIPT" && cliente && !cliente.doc_number && total > o.tope_boleta;
  const listo = Boolean(cliente && serie && lineas.length && total > 0 && !facturaSinRuc && !boletaSinDoc);
  const puedeEmitir = puede("FAC", "C") && can("fac.document.issue");

  function poner(k: number, cambio: Partial<Linea>) {
    setLineas((ls) => ls.map((l) => (l.key === k ? { ...l, ...cambio } : l)));
  }
  function agregarProducto(p: Producto) {
    const kg = p.sale_mode === "KG" || p.basis === "KG";
    setLineas((ls) => [...ls, { key: siguiente++, variant_id: p.id, description: p.name, qty: kg ? "1.000" : "1", unit_price: p.price ? String(Number(p.price)) : "",
      uom_code: kg ? "KGM" : "NIU", igv_affectation: (["10", "20", "30"].includes(p.igv_affectation ?? "") ? p.igv_affectation : "10") as Linea["igv_affectation"] }]);
  }
  function agregarLibre() {
    setLineas((ls) => [...ls, { key: siguiente++, variant_id: null, description: "", qty: "1", unit_price: "", uom_code: "ZZ", igv_affectation: "10" }]);
  }

  async function emitir() {
    if (!cliente || !serie) return;
    setEnviando(true);
    setErrores({});
    try {
      const d = await api<{ id: string; full_number: string }>("/v1/fac/comprobantes", { method: "POST", body: {
        doc_type: tipo, brand_id: marca, establishment_id: local, customer_id: cliente.id, series_id: serie.id, payment_terms: pago,
        credit_days: pago === "CREDIT" && dias ? Number(dias) : undefined, issue_date: emision || undefined,
        lines: lineas.map((l) => ({ variant_id: l.variant_id, description: l.description.trim() || undefined, qty: Number(l.qty), unit_price: Number(l.unit_price), uom_code: l.uom_code, igv_affectation: l.igv_affectation })),
      } });
      toast.ok(`Se emitió ${d.full_number}.`);
      router.push(`/m/fac/fac-04?id=${d.id}`);
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader description="Comprobante sin pedido: venta de un servicio, un ajuste o una venta que no pasó por el mostrador. La serie es la de la marca y el local." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Seccion titulo="Emisor">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo">
                <Select value={tipo} onChange={(e) => { setTipo(e.target.value as "INVOICE" | "RECEIPT"); setSerie(""); }} options={[{ value: "INVOICE", label: "Factura" }, { value: "RECEIPT", label: "Boleta" }]} />
              </Field>
              <Field label="Marca">
                <Select value={marca} onChange={(e) => { setMarca(e.target.value); setSerie(""); setLineas([]); }} options={o.marcas.map((m) => ({ value: m.id, label: m.name }))} />
              </Field>
              <Field label="Local">
                <Select value={local} onChange={(e) => { setLocal(e.target.value); setSerie(""); }} options={o.locales.map((l) => ({ value: l.id, label: l.name }))} />
              </Field>
              <Field label="Serie" error={!serie ? "No hay serie activa para esta marca y local." : undefined}>
                <Select value={serie?.id ?? ""} onChange={(e) => setSerie(e.target.value)} disabled={!series.length}
                  options={series.map((s) => ({ value: s.id, label: `${s.series} · sigue ${s.next_number}` }))} placeholder="Sin serie" />
              </Field>
            </div>
          </Seccion>

          <Seccion titulo="Cliente">
            {cliente ? (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{cliente.full_name}</p>
                  <p className="text-[12.5px] text-muted">{cliente.doc_number ? `${DOC_ID[cliente.doc_type ?? ""] ?? cliente.doc_type} ${cliente.doc_number}` : "Sin documento"}{cliente.fiscal_address ? ` · ${cliente.fiscal_address}` : ""}</p>
                </div>
                <IconButton icon={X} label="Cambiar cliente" onClick={() => setCliente(null)} />
              </div>
            ) : <BuscarCliente onElegir={setCliente} />}
            {facturaSinRuc && <div className="mt-2"><Alert tone="bad">La factura exige un RUC válido de 11 dígitos. Corrige el RUC en Clientes o emite boleta.</Alert></div>}
            {boletaSinDoc && <div className="mt-2"><Alert tone="warn">La boleta pasa de {soles(o.tope_boleta)}: SUNAT pide el documento del comprador.</Alert></div>}
          </Seccion>

          <Seccion titulo="Líneas" acciones={<Button size="sm" icon={PenLine} onClick={agregarLibre}>Línea libre</Button>}>
            {marca && <BuscarProducto marca={marca} onElegir={agregarProducto} />}
            {errores.lines && <p className="mt-2 text-[12.5px] text-bad">{errores.lines}</p>}
            <div className="mt-3 space-y-2">
              {!lineas.length && <Vacio>Busca un producto del catálogo o agrega una línea libre (servicio o ajuste).</Vacio>}
              {calculadas.map((l, i) => (
                <div key={l.key} className="rounded-lg border border-line p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      {l.variant_id ? <p className="text-[13.5px] font-medium">{l.description}</p> : (
                        <Input aria-label="Descripción" value={l.description} onChange={(e) => poner(l.key, { description: e.target.value })} placeholder="Descripción del servicio o ajuste" />
                      )}
                      {errores[`lines.${i}.description`] && <p className="mt-1 text-[12px] text-bad">{errores[`lines.${i}.description`]}</p>}
                    </div>
                    <IconButton icon={Trash2} label="Quitar línea" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={l.uom_code === "KGM" ? "Kilos" : "Cantidad"} error={errores[`lines.${i}.qty`]}>
                      <Input type="number" inputMode="decimal" min={0} step={l.uom_code === "KGM" ? "0.001" : "1"} value={l.qty} onChange={(e) => poner(l.key, { qty: e.target.value })} />
                    </Field>
                    <Field label={l.uom_code === "KGM" ? "Precio por kg" : "Precio unit."} error={errores[`lines.${i}.unit_price`]}>
                      <Input type="number" inputMode="decimal" min={0} step="0.01" value={l.unit_price} onChange={(e) => poner(l.key, { unit_price: e.target.value })} />
                    </Field>
                    <Field label="IGV">
                      <Select value={l.igv_affectation} onChange={(e) => poner(l.key, { igv_affectation: e.target.value as Linea["igv_affectation"] })}
                        options={[{ value: "10", label: "Gravado" }, { value: "20", label: "Exonerado" }, { value: "30", label: "Inafecto" }]} />
                    </Field>
                    <div className="flex flex-col justify-end pb-2 text-right">
                      <span className="text-[11.5px] text-muted">Importe</span>
                      <span className="font-semibold tabular-nums">{soles(l.total)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Seccion>
        </div>

        <Seccion titulo="Resumen" className="h-fit">
          <div className="space-y-3">
            <Field label="Fecha de emisión" hint="Hoy, o un día anterior de un período abierto.">
              <Input type="date" value={emision || o.hoy} max={hoyLima()} onChange={(e) => setEmision(e.target.value === o.hoy ? "" : e.target.value)} />
            </Field>
            <Field label="Forma de pago">
              <Select value={pago} onChange={(e) => setPago(e.target.value as "CASH" | "CREDIT")} options={[{ value: "CASH", label: "Contado" }, { value: "CREDIT", label: "Crédito" }]} />
            </Field>
            {pago === "CREDIT" && (
              <Field label="Días de crédito" hint={`Por defecto ${o.dias_credito} días.`}>
                <Input type="number" inputMode="numeric" min={1} max={180} value={dias} placeholder={String(o.dias_credito)} onChange={(e) => setDias(e.target.value)} />
              </Field>
            )}
            <div className="space-y-1 border-t border-line pt-3 text-[13.5px]">
              <div className="flex justify-between"><span className="text-muted">Valor de venta</span><span className="tabular-nums">{soles(total - igv)}</span></div>
              <div className="flex justify-between"><span className="text-muted">IGV ({Math.round(tasa * 100)} %)</span><span className="tabular-nums">{soles(igv)}</span></div>
              <div className="flex items-baseline justify-between pt-1"><span className="font-semibold">Total</span><span className="text-[20px] font-bold tabular-nums">{soles(total)}</span></div>
            </div>
            {puedeEmitir
              ? <Button variant="primary" icon={FileCheck2} className="w-full" disabled={!listo} loading={enviando} onClick={emitir}>Emitir {tipo === "INVOICE" ? "factura" : "boleta"}{serie ? ` ${serie.series}` : ""}</Button>
              : <Alert tone="warn">Tu rol no emite comprobantes.</Alert>}
            {!cliente && <p className="text-[12px] text-muted">Elige el cliente para emitir.</p>}
          </div>
        </Seccion>
      </div>
    </div>
  );
}

function BuscarCliente({ onElegir }: { onElegir: (c: Cliente) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; filas: Cliente[] } | null>(null);
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Cliente[]>(`/v1/fac/emision/clientes?q=${encodeURIComponent(texto)}`).then((filas) => vigente && setRes({ q: texto, filas })).catch(() => vigente && setRes({ q: texto, filas: [] }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);
  const filas = q.trim().length >= 2 && res?.q === q.trim() ? res.filas : [];
  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, RUC, DNI o celular" aria-label="Buscar cliente" className="pl-9" />
      </div>
      {filas.length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {filas.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onElegir(c)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2">
                <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium">{c.full_name}</span>
                  <span className="text-[12px] text-muted">{c.doc_number ? `${c.doc_type} ${c.doc_number}` : "Sin documento"}{c.doc_type === "RUC" && !c.ruc_valido ? " · RUC no válido" : ""}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && res?.q === q.trim() && !filas.length && <p className="mt-2 text-[12.5px] text-muted">Sin clientes con esa búsqueda. Regístralo en Clientes.</p>}
    </div>
  );
}

function BuscarProducto({ marca, onElegir }: { marca: string; onElegir: (p: Producto) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ clave: string; filas: Producto[] } | null>(null);
  const clave = `${marca}|${q.trim()}`;
  useEffect(() => {
    const [m, texto] = clave.split("|");
    if (!texto) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Producto[]>(`/v1/fac/emision/productos?brand=${m}&q=${encodeURIComponent(texto)}`).then((filas) => vigente && setRes({ clave, filas })).catch(() => vigente && setRes({ clave, filas: [] }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]);
  const filas = q.trim() && res?.clave === clave ? res.filas : [];
  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto del catálogo o SKU" aria-label="Buscar producto" className="pl-9" />
      </div>
      {filas.length > 0 && (
        <ul className="mt-2 max-h-60 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {filas.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onElegir(p); setQ(""); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-2">
                <span className="min-w-0"><span className="block truncate text-[13.5px]">{p.name}</span><span className="text-[12px] text-muted">{p.sku}</span></span>
                <span className="flex shrink-0 items-center gap-1 text-[13px] tabular-nums">{p.price ? `${soles(p.price)}${p.sale_mode === "KG" ? "/kg" : ""}` : "sin precio"}<Plus size={14} aria-hidden="true" /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
