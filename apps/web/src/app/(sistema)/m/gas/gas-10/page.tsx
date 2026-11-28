"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Alert, Button, DataTable, Field, IconButton, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Monto, Seccion, SinPermiso, Vacio, columnasGasto, useDatos, useOpciones, usePermisosGas } from "@/modulos/gas/comunes";
import { lista, type FichaGasto, type FilaGasto, type LineaReparto, type Opciones } from "@/modulos/gas/tipos";

type Linea = { cost_center_id: string; brand_id: string; sales_channel: string; pct: string };

/** GAS-10 Reparto entre centros de costo (RN-GAS-04): un gasto compartido se divide por porcentaje entre centros, marcas y canales. */
export default function Reparto() {
  return <Suspense fallback={<Vacio>Cargando…</Vacio>}><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const abrir = (x: string | null) => router.replace(x ? `/m/gas/gas-10?id=${x}` : "/m/gas/gas-10", { scroll: false });
  return id ? <Editor id={id} onVolver={() => abrir(null)} /> : <Elegir onAbrir={abrir} />;
}

function Elegir({ onAbrir }: { onAbrir: (id: string) => void }) {
  const p = usePermisosGas();
  const todos = p.aprueba || p.contadora;
  const [vista, setVista] = useState<"mios" | "todos">(todos ? "todos" : "mios");
  const l = useListado<FilaGasto>("/v1/gas/gastos", { filtros: { vista, abiertos: 1 }, orden: "-created_at" });
  if (!p.crea && !todos) return <SinPermiso que="El reparto lo define quien registra el gasto, quien lo aprueba o la contadora." />;
  return (
    <div className="space-y-4">
      <PageHeader description="Elige el gasto a repartir. Solo se reparte antes de aprobarlo: en borrador, enviado o rechazado. Al aprobarse, el reporte cuenta cada parte en su centro de costo, marca y canal." />
      {todos && (
        <div className="flex flex-wrap gap-2">
          <Button variant={vista === "todos" ? "primary" : "secondary"} onClick={() => setVista("todos")}>Todos los que veo</Button>
          {p.crea && <Button variant={vista === "mios" ? "primary" : "secondary"} onClick={() => setVista("mios")}>Mis gastos</Button>}
        </div>
      )}
      <DataTable {...l.tabla} columns={columnasGasto([{ key: "repartido", header: "Reparto", render: (g) => (g.repartido ? "Repartido" : "—") }], vista === "mios" ? ["registro"] : [])}
        onRowClick={(g) => onAbrir(g.id)} search={{ ...l.tabla.search, placeholder: "Buscar gasto" }} empty="No hay gastos sin aprobar para repartir." />
    </div>
  );
}

function Editor({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { datos: g, error, cargando } = useDatos<FichaGasto>(`/v1/gas/gastos/${id}`);
  const { datos: op } = useOpciones();
  if (cargando || (!op && !error)) return <Vacio>Cargando…</Vacio>;
  if (error || !g || !op) return <div className="space-y-3"><Button icon={ArrowLeft} onClick={onVolver}>Elegir otro gasto</Button><Alert tone="bad">{error || "No se encontró el gasto."}</Alert></div>;
  return <Formulario key={g.id} g={g} op={op} onVolver={onVolver} />;
}

const aLinea = (l: LineaReparto): Linea => ({ cost_center_id: l.cost_center_id, brand_id: l.brand_id, sales_channel: l.sales_channel ?? "", pct: String(l.pct) });

function Formulario({ g, op, onVolver }: { g: FichaGasto; op: Opciones; onVolver: () => void }) {
  const router = useRouter();
  const inicial = g.reparto.length ? g.reparto.map(aLinea) : [
    { cost_center_id: g.cost_center_id, brand_id: g.brand_id, sales_channel: g.sales_channel ?? "", pct: "50" },
    { cost_center_id: "", brand_id: g.brand_id, sales_channel: "", pct: "50" },
  ];
  const [lineas, setLineas] = useState<Linea[]>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [errorG, setErrorG] = useState("");
  const suma = Math.round(lineas.reduce((s, l) => s + (Number(l.pct) || 0), 0) * 10000) / 10000;
  const cuadra = Math.abs(suma - 100) < 0.0001;
  const puede = g.puede.repartir;
  const pon = (i: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const centros = op.centros.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }));
  const marcas = op.marcas.map((m) => ({ value: m.id, label: m.name }));
  // Igual que la API: cada línea redondeada y la última con lo que falta para el total.
  const montos = lineas.map((l) => Math.round(g.amount_pen * (Number(l.pct) || 0)) / 100);
  if (cuadra && montos.length) montos[montos.length - 1] = Math.round((g.amount_pen - montos.slice(0, -1).reduce((s, m) => s + m, 0)) * 100) / 100;

  async function guardar(nuevas: Linea[]) {
    setGuardando(true);
    setErrorG("");
    try {
      await api(`/v1/gas/gastos/${g.id}/reparto`, { method: "PUT", body: { lineas: nuevas.map((l) => ({ ...l, sales_channel: l.sales_channel || null, pct: Number(l.pct) })) } });
      toast.ok(nuevas.length ? "Reparto guardado." : "Reparto quitado.");
      router.push(`/m/gas/gas-02?id=${g.id}`);
    } catch (x) {
      setErrorG(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div><Button variant="ghost" icon={ArrowLeft} onClick={onVolver}>Elegir otro gasto</Button></div>
      <PageHeader description={<><span className="font-semibold text-ink">{g.number}</span> · {g.description} · <Monto g={g} /></>} />
      {!puede && <Alert tone="info">Este gasto ya no se puede repartir: el reparto se define antes de aprobarlo, y lo hace quien lo registró, quien lo aprueba o la contadora.</Alert>}
      {errorG && <Alert tone="bad">{errorG}</Alert>}
      <Seccion titulo="Partes del gasto" acciones={puede && <Button icon={Plus} disabled={lineas.length >= 30} onClick={() => setLineas((ls) => [...ls, { cost_center_id: "", brand_id: g.brand_id, sales_channel: "", pct: "" }])}>Línea</Button>}>
        <div className="space-y-3">
          {lineas.map((l, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_90px_110px_auto] sm:items-end">
              <Field label="Centro de costo" required><Select value={l.cost_center_id} disabled={!puede} onChange={(e) => pon(i, "cost_center_id", e.target.value)} placeholder="Elige" options={centros} /></Field>
              <Field label="Marca" required><Select value={l.brand_id} disabled={!puede} onChange={(e) => pon(i, "brand_id", e.target.value)} placeholder="Elige" options={marcas} /></Field>
              <Field label="Canal"><Select value={l.sales_channel} disabled={!puede} onChange={(e) => pon(i, "sales_channel", e.target.value)} placeholder="Sin canal" options={lista(op.canales)} /></Field>
              <div className="grid grid-cols-[90px_minmax(0,1fr)_auto] items-end gap-2 sm:contents">
                <Field label="%" required><Input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={l.pct} disabled={!puede} onChange={(e) => pon(i, "pct", e.target.value)} /></Field>
                <p className="pb-2 text-right text-[13.5px] font-medium text-ink">{soles(montos[i] ?? 0)}</p>
                {puede && <IconButton icon={Trash2} label="Quitar línea" className="mb-1" disabled={lineas.length <= 2} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} />}
              </div>
            </div>
          ))}
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13.5px] ${cuadra ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
            <span>Suma: <b>{suma.toLocaleString("es-PE", { maximumFractionDigits: 4 })} %</b>{cuadra ? "" : " · debe ser 100 %"}</span>
            <span>Total {soles(g.amount_pen)}</span>
          </div>
        </div>
      </Seccion>
      {puede && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={guardando} disabled={!cuadra || lineas.some((l) => !l.cost_center_id || !l.brand_id || !(Number(l.pct) > 0))} onClick={() => guardar(lineas)}>Guardar reparto</Button>
          {g.reparto.length > 0 && <Button variant="ghost" disabled={guardando} onClick={() => guardar([])}>Quitar reparto</Button>}
        </div>
      )}
    </div>
  );
}
