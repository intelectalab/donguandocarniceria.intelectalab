"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ScanBarcode } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Ean13 } from "@/modulos/cat/Ean13";
import { MODOS_VENTA, etiqueta, type FormatoBalanza, type LecturaBalanza } from "@/modulos/cat/tipos";

type VarPlu = { id: string; scale_plu: string; sku: string; name: string; sale_mode: string; brand_name: string | null };
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-[14px] border border-line bg-surface p-4">
      <h2 className="text-[15px] font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

/** CAT-11 Etiquetas de balanza (RN-CAT-12): formato EAN-13 prefijo 2, prueba de lectura y etiqueta de prueba. */
export default function EtiquetasDeBalanza() {
  const { can } = useSesion();
  const puedeEditar = can("cat.product.manage");
  const [formato, setFormato] = useState<FormatoBalanza | null>(null);
  const [variantes, setVariantes] = useState<VarPlu[]>([]);
  const [version, setVersion] = useState(0);
  const [codigo, setCodigo] = useState("2012345012509");
  const [lectura, setLectura] = useState<LecturaBalanza | null>(null);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    let vigente = true;
    api<{ formato: FormatoBalanza; variantes: VarPlu[] }>("/v1/cat/etiquetas").then((d) => {
      if (vigente) { setFormato(d.formato); setVariantes(d.variantes); }
    }).catch((err) => toast.error(mensajeDe(err)));
    return () => { vigente = false; };
  }, [version]);

  const leer = useCallback(async (c: string) => {
    try {
      setLectura(await api<LecturaBalanza>("/v1/cat/etiquetas/leer", { method: "POST", body: { codigo: c } }));
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    api<LecturaBalanza>("/v1/cat/etiquetas/leer", { method: "POST", body: { codigo: "2012345012509" } }).then((l) => vigente && setLectura(l)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const q = buscar.trim().toLowerCase();
  const filas = variantes.filter((v) => !q || v.scale_plu.includes(q) || v.sku.toLowerCase().includes(q) || v.name.toLowerCase().includes(q));
  const columnas: Column<VarPlu>[] = [
    { key: "plu", header: "PLU", render: (v) => <span className="font-mono font-semibold">{v.scale_plu}</span> },
    { key: "sku", header: "SKU", render: (v) => <span className="whitespace-nowrap font-mono">{v.sku}</span> },
    { key: "name", header: "Variante", cardTitle: true, render: (v) => v.name },
    { key: "modo", header: "Modo", hideOnMobile: true, render: (v) => etiqueta(MODOS_VENTA, v.sale_mode) },
    { key: "marca", header: "Marca", hideOnMobile: true, render: (v) => v.brand_name ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Formato EAN-13 con prefijo 2: posición del PLU y del valor (peso en gramos o precio en céntimos) y prueba de lectura de una etiqueta (RN-CAT-12). D-CAT-02: peso en gramos y PLU de 5 dígitos (provisional)." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Formato vigente">
          {formato && <FormatoForm key={JSON.stringify(formato)} formato={formato} puedeEditar={puedeEditar} onGuardado={() => setVersion((n) => n + 1)} />}
        </Tarjeta>

        <Tarjeta titulo="Prueba de lectura">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); leer(codigo); }}>
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} maxLength={13} inputMode="numeric" className="font-mono" aria-label="Código de la etiqueta" />
            <Button type="submit" variant="primary" icon={ScanBarcode}>Leer</Button>
          </form>
          {lectura && (!lectura.ok ? <Alert tone="bad">{lectura.error}</Alert> : <>
            <Alert tone="ok">Lectura válida · dígito de control EAN-13 correcto.</Alert>
            <DetailList items={[
              { label: "PLU", value: <span className="font-mono">{lectura.plu}</span> },
              { label: "Variante", value: lectura.variant ? `${lectura.variant.sku} · ${lectura.variant.name}` : "Ningún producto activo tiene este PLU" },
              { label: lectura.value_type === "WEIGHT_G" ? "Peso" : "Importe en la etiqueta", value: lectura.value_type === "WEIGHT_G" ? kg(lectura.weight_kg) : soles(lectura.amount) },
              { label: "Precio mostrador", value: lectura.precio ? `${soles(lectura.precio.price)}${lectura.precio.basis === "KG" ? "/kg" : ""}` : "—" },
              { label: "Importe", value: lectura.importe !== null ? soles(lectura.importe) : "—" },
              { label: "Rango de peso", value: lectura.variant?.min_weight_kg ? `${kg(lectura.variant.min_weight_kg)} – ${kg(lectura.variant.max_weight_kg)} por unidad (RN-CAT-03)` : "—" },
            ]} />
            {lectura.fuera_de_rango && <Alert tone="warn">RN-CAT-03: {kg(lectura.weight_kg)} está fuera del rango por unidad: el mostrador pide confirmación (RN-POS-04).</Alert>}
          </>)}
        </Tarjeta>
      </div>

      <Tarjeta titulo="Generar etiqueta de prueba">
        <Generar variantes={variantes} formato={formato} onCodigo={(c) => { setCodigo(c); leer(c); }} />
      </Tarjeta>

      <div>
        <h2 className="mb-2 text-[15px] font-semibold">Variantes con PLU de balanza</h2>
        <DataTable columns={columnas} rows={filas} rowKey={(v) => v.id} loading={!formato}
          search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar PLU, SKU o nombre…" }} empty="No hay variantes activas con PLU." />
      </div>
    </div>
  );
}

function FormatoForm({ formato, puedeEditar, onGuardado }: { formato: FormatoBalanza; puedeEditar: boolean; onGuardado: () => void }) {
  const [v, setV] = useState({ ...formato, plu_start: String(formato.plu_start), plu_len: String(formato.plu_len), value_start: String(formato.value_start), value_len: String(formato.value_len), reason: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const num = (k: "plu_start" | "plu_len" | "value_start" | "value_len", label: string, max: number) => (
    <Field label={label} required error={errores[k]}><Input type="number" min={1} max={max} value={v[k]} disabled={!puedeEditar} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true); setError(""); setErrores({});
    try {
      await api("/v1/cat/etiquetas/formato", { method: "PUT", body: { ...v, plu_start: Number(v.plu_start), plu_len: Number(v.plu_len), value_start: Number(v.value_start), value_len: Number(v.value_len) } });
      toast.ok("Formato guardado");
      onGuardado();
    } catch (err) {
      const p = erroresDe(err);
      setErrores(p);
      if (!Object.keys(p).length) setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="grid grid-cols-2 gap-3">
      {error && <p role="alert" className="col-span-2 rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">{error}</p>}
      <Field label="Prefijo" required error={errores.prefix}><Input value={v.prefix} maxLength={2} disabled={!puedeEditar} className="font-mono" onChange={(e) => setV({ ...v, prefix: e.target.value.replace(/\D/g, "") })} /></Field>
      <Field label="Valor" required error={errores.value_type}>
        <Select value={v.value_type} disabled={!puedeEditar} onChange={(e) => setV({ ...v, value_type: e.target.value as FormatoBalanza["value_type"] })}
          options={[{ value: "WEIGHT_G", label: "Peso en gramos" }, { value: "PRICE_CENTS", label: "Precio en céntimos" }]} />
      </Field>
      {num("plu_start", "PLU: posición (desde 1)", 12)}
      {num("plu_len", "PLU: largo", 6)}
      {num("value_start", "Valor: posición", 12)}
      {num("value_len", "Valor: largo", 6)}
      {puedeEditar ? <>
        <Field label="Motivo del cambio" required error={errores.reason} className="col-span-2"><Input value={v.reason} maxLength={255} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <div className="col-span-2 flex justify-end"><Button type="submit" variant="primary" loading={guardando}>Guardar formato</Button></div>
      </> : <p className="col-span-2 text-[12.5px] text-muted">Cambiar el formato pide el permiso cat.product.manage.</p>}
    </form>
  );
}

function Generar({ variantes, formato, onCodigo }: { variantes: VarPlu[]; formato: FormatoBalanza | null; onCodigo: (c: string) => void }) {
  const [id, setId] = useState("");
  const [valor, setValor] = useState("0.965");
  const [hecho, setHecho] = useState<{ codigo: string; v: VarPlu; valor: number } | null>(null);
  const elegida = variantes.find((x) => x.id === (id || variantes[0]?.id));
  const porPeso = formato?.value_type !== "PRICE_CENTS";

  async function generar(e: FormEvent) {
    e.preventDefault();
    if (!elegida) return;
    try {
      const r = await api<{ codigo: string }>("/v1/cat/etiquetas/generar", { method: "POST", body: { variant_id: elegida.id, valor: Number(valor) } });
      setHecho({ codigo: r.codigo, v: elegida, valor: Number(valor) });
      onCodigo(r.codigo);
    } catch (err) {
      toast.error(mensajeDe(err));
    }
  }

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <form onSubmit={generar} className="grid grid-cols-2 gap-3">
        <Field label="Variante con PLU" required className="col-span-2">
          <Select value={elegida?.id ?? ""} onChange={(e) => setId(e.target.value)} options={variantes.map((x) => ({ value: x.id, label: `${x.scale_plu} · ${x.name}` }))} />
        </Field>
        <Field label={porPeso ? "Peso (kg)" : "Importe (S/)"} required>
          <Input type="number" step={porPeso ? "0.001" : "0.01"} min={0} value={valor} onChange={(e) => setValor(e.target.value)} />
        </Field>
        <div className="flex items-end"><Button type="submit" variant="primary">Generar</Button></div>
      </form>
      {hecho && (
        <div className="max-w-[300px] space-y-1 rounded-[10px] border border-line bg-surface-2 p-3">
          <b className="block">{hecho.v.name}</b>
          <div className="text-[12px] text-muted">{hecho.v.brand_name} · PLU {hecho.v.scale_plu}</div>
          <div className="flex justify-between text-[13px]"><span>{porPeso ? kg(hecho.valor) : soles(hecho.valor)}</span><span className="text-muted">envasado {fecha(hoy())}</span></div>
          <Ean13 codigo={hecho.codigo} />
          <div className="text-[11.5px] text-muted">Valor en {formato?.value_len ?? 5} dígitos · {numero(hecho.codigo.length)} dígitos en total</div>
        </div>
      )}
    </div>
  );
}
