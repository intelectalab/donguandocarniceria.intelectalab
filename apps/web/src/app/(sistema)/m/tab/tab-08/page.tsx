"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { ErrorCarga, Semaforo, capital, useDatos, valorDe, type Luz } from "@/modulos/tab/comunes";

type Meta = {
  id: string; code: string; name: string; module_code: string; unit: string; decimals: number; direction: string; sentido: string;
  brand_id: string | null; marca: string; establishment_id: string | null; local: string; target: number; tolerance_pct: number;
  valid_from: string; valid_to: string | null; vigente: boolean; created_by: string; note: string | null; valor: number | null; oculto: boolean; sin_calculo: boolean; semaforo: Luz;
};
type Def = { code: string; name: string; unit: string; direction: string; decimals: number };
type Datos = {
  filas: Meta[]; cifras: { vigentes: number; verde: number; ambar: number; rojo: number; tolerancia: number }; puede: { editar: boolean };
  marcas: { id: string; name: string }[]; locales: { id: string; name: string }[]; indicadores: Def[]; hoy: string;
};
type Propuestas = { mes: string | null; nombre?: string; filas: { code: string; name: string; unit: string; decimals: number; valor: number }[] };

/** TAB-08 Metas y semáforo: meta por indicador, marca y local con vigencia y tolerancia, sin solapes (RN-TAB-04 y 05), y vista previa del semáforo. */
export default function Metas() {
  const { marca } = useSesion();
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/tab/metas${marca && marca !== "ALL" ? `?marca=${marca}` : ""}`);
  const [ver, setVer] = useState("VIGENTES");
  const [luz, setLuz] = useState("");
  const [nueva, setNueva] = useState<Partial<{ code: string; target: string }> | null>(null);
  const [propuestas, setPropuestas] = useState<Propuestas | null>(null);
  if (error) return <ErrorCarga error={error} que="" />;
  const filas = (datos?.filas ?? []).filter((x) => (ver === "TODAS" || (ver === "VIGENTES" ? x.vigente : !x.vigente)) && (!luz || x.semaforo === luz));
  const c = datos?.cifras;

  async function cerrar(x: Meta) {
    const r = await confirmAction({ title: `¿Cerrar la meta de ${x.code}?`, message: `Deja de valer hoy. ${x.marca} · ${x.local} · meta ${valorDe(x.target, x.unit, x.decimals)}.`, confirmLabel: "Cerrar vigencia" });
    if (!r) return;
    try {
      await api(`/v1/tab/metas/${x.id}/cerrar`, { method: "POST", body: {} });
      toast.ok("Vigencia cerrada");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  async function verPropuestas() {
    try {
      setPropuestas(await api<Propuestas>("/v1/tab/metas/propuestas"));
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Meta>[] = [
    { key: "name", header: "Indicador", cardTitle: true, render: (x) => <span className="flex flex-col"><span className="font-medium">{x.name}</span><span className="text-[12px] text-muted">{x.code} · {x.sentido.toLowerCase()}</span></span> },
    { key: "dim", header: "Marca y local", render: (x) => `${x.marca} · ${x.local}` },
    { key: "target", header: "Meta", align: "right", render: (x) => <span className="flex flex-col items-end"><span className="font-semibold">{valorDe(x.target, x.unit, x.decimals)}</span><span className="text-[11.5px] text-muted">± {x.tolerance_pct} %</span></span> },
    { key: "vigencia", header: "Vigencia", render: (x) => <span>{fecha(x.valid_from)} – {x.valid_to ? fecha(x.valid_to) : "sin fin"}{!x.vigente && <> <Badge>No vigente</Badge></>}</span> },
    { key: "valor", header: "Este mes", align: "right", render: (x) => (x.oculto ? "Módulo apagado" : x.sin_calculo ? "Sin cálculo" : x.vigente ? valorDe(x.valor, x.unit, x.decimals) : "—") },
    { key: "semaforo", header: "Semáforo", render: (x) => (x.vigente ? <Semaforo luz={x.semaforo} /> : null) },
    ...(datos?.puede.editar ? [{ key: "acc", header: "", render: (x: Meta) => (x.vigente ? <Button size="sm" onClick={() => cerrar(x)}>Cerrar</Button> : null) } as Column<Meta>] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader description={`Cada indicador tiene una sola meta vigente por marca y local en cada fecha. El semáforo usa la meta y su tolerancia (por defecto ${c?.tolerancia ?? 10} %): más alto es mejor, más bajo es mejor u objetivo.`}
        actions={datos?.puede.editar ? <>
          <Button icon={Lightbulb} onClick={verPropuestas}>Proponer desde el real</Button>
          <Button variant="primary" icon={Plus} onClick={() => setNueva({})}>Nueva meta</Button>
        </> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Metas vigentes" valor={c ? String(c.vigentes) : undefined} detalle="hoy" destacada />
        <Cifra titulo="En verde" valor={c ? String(c.verde) : undefined} detalle="en el mes actual" tono="ok" />
        <Cifra titulo="En ámbar" valor={c ? String(c.ambar) : undefined} detalle="dentro de la tolerancia" tono="warn" />
        <Cifra titulo="En rojo" valor={c ? String(c.rojo) : undefined} detalle="fuera de la tolerancia" tono="bad" />
      </div>
      <Simulador tolerancia={c?.tolerancia ?? 10} />
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Ver" value={ver} onChange={(v) => setVer(v || "VIGENTES")} vacio="Vigentes" options={[{ value: "VIGENTES", label: "Vigentes" }, { value: "PASADAS", label: "No vigentes" }, { value: "TODAS", label: "Todas" }]} />
        <FiltroSelect etiqueta="Semáforo" value={luz} onChange={setLuz} options={[{ value: "GREEN", label: "Verde" }, { value: "AMBER", label: "Ámbar" }, { value: "RED", label: "Rojo" }]} />
      </div>
      <DataTable rows={filas} columns={columnas} rowKey={(x) => x.id} loading={cargando} empty="No hay metas con esos filtros." />
      {nueva && datos && <NuevaMeta datos={datos} inicial={nueva} onClose={() => setNueva(null)} onSaved={() => { setNueva(null); setPropuestas(null); recargar(); }} />}
      {propuestas && (
        <Modal open onClose={() => setPropuestas(null)} title="Metas propuestas desde el real" size="lg"
          description={propuestas.mes ? `Con ${propuestas.nombre} congelado: indicadores de los tableros sin meta, con su valor real como punto de partida (D-TAB-01). Solo se guarda lo que elijas.` : "Aún no hay un mes congelado."}>
          {propuestas.filas.length === 0 ? <Alert tone="info">Todos los indicadores de los tableros ya tienen meta general.</Alert> : (
            <ul className="divide-y divide-line">
              {propuestas.filas.map((p) => (
                <li key={p.code} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                  <span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="text-[12px] text-muted">{p.code} · real {valorDe(p.valor, p.unit, p.decimals)}</span></span>
                  <Button size="sm" onClick={() => setNueva({ code: p.code, target: String(p.valor) })}>Usar</Button>
                </li>))}
            </ul>)}
        </Modal>)}
    </div>
  );
}

/** Vista previa: con un valor, una meta y la tolerancia, qué color daría (RN-TAB-04). */
function Simulador({ tolerancia }: { tolerancia: number }) {
  const [s, setS] = useState({ sentido: "LOWER_BETTER", meta: "12", tol: String(tolerancia), valor: "12.90" });
  const [luz, setLuz] = useState<Luz>(null);
  useEffect(() => {
    const ok = [s.meta, s.valor, s.tol].every((v) => v !== "" && !Number.isNaN(Number(v)));
    if (!ok) return;
    const h = setTimeout(() => {
      api<{ semaforo: Luz }>("/v1/tab/metas/simular", { method: "POST", body: { valor: Number(s.valor), meta: Number(s.meta), sentido: s.sentido, tolerancia: Number(s.tol) } })
        .then((r) => setLuz(r.semaforo)).catch(() => setLuz(null));
    }, 250);
    return () => clearTimeout(h);
  }, [s]);
  const m = Number(s.meta), t = Number(s.tol) / 100;
  const bandas = s.sentido === "HIGHER_BETTER" ? `verde desde ${m}, ámbar desde ${(m * (1 - t)).toFixed(2)}, rojo por debajo`
    : s.sentido === "LOWER_BETTER" ? `verde hasta ${m}, ámbar hasta ${(m * (1 + t)).toFixed(2)}, rojo por encima`
      : `verde entre ${(m - Math.abs(m) * t).toFixed(2)} y ${(m + Math.abs(m) * t).toFixed(2)}, ámbar hasta el doble de distancia`;
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="mb-3 text-[14.5px] font-semibold">Vista previa del semáforo</h2>
      <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
        <Field label="Mejor si"><Select value={s.sentido} onChange={(e) => setS({ ...s, sentido: e.target.value })}
          options={[{ value: "HIGHER_BETTER", label: "Más alto" }, { value: "LOWER_BETTER", label: "Más bajo" }, { value: "TARGET", label: "Cerca de la meta" }]} /></Field>
        <Field label="Meta"><Input inputMode="decimal" value={s.meta} onChange={(e) => setS({ ...s, meta: e.target.value })} /></Field>
        <Field label="Tolerancia %"><Input inputMode="decimal" value={s.tol} onChange={(e) => setS({ ...s, tol: e.target.value })} /></Field>
        <Field label="Valor"><Input inputMode="decimal" value={s.valor} onChange={(e) => setS({ ...s, valor: e.target.value })} /></Field>
        <div className="pb-2"><Semaforo luz={luz} /></div>
      </div>
      <p className="mt-2 text-[12.5px] text-muted">{capital(bandas)}.</p>
    </section>
  );
}

function NuevaMeta({ datos, inicial, onClose, onSaved }: { datos: Datos; inicial: Partial<{ code: string; target: string }>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: inicial.code ?? "", target: inicial.target ?? "", tolerance_pct: String(datos.cifras.tolerancia), valid_from: `${datos.hoy.slice(0, 7)}-01`,
    valid_to: "", brand_id: "", establishment_id: "", note: "" });
  const [guardando, setGuardando] = useState(false);
  const def = datos.indicadores.find((d) => d.code === f.code);
  async function guardar() {
    setGuardando(true);
    try {
      await api("/v1/tab/metas", { method: "POST", body: { ...f, target: Number(f.target), tolerance_pct: f.tolerance_pct === "" ? null : Number(f.tolerance_pct),
        valid_to: f.valid_to || null, brand_id: f.brand_id || null, establishment_id: f.establishment_id || null, note: f.note || null } });
      toast.ok(`Meta de ${f.code} guardada`);
      onSaved();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Nueva meta" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!f.code || f.target === ""} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Indicador" required className="sm:col-span-2"><Select value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="Elige un indicador"
          options={datos.indicadores.map((d) => ({ value: d.code, label: `${d.code} · ${d.name}` }))} /></Field>
        <Field label="Meta" required hint={def ? `${def.unit === "PEN" ? "En soles" : def.unit === "PCT" ? "En %" : ""} ${def.direction === "LOWER_BETTER" ? "· más bajo es mejor" : def.direction === "HIGHER_BETTER" ? "· más alto es mejor" : "· cerca de la meta"}` : undefined}>
          <Input inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Tolerancia %"><Input inputMode="decimal" value={f.tolerance_pct} onChange={(e) => setF({ ...f, tolerance_pct: e.target.value })} /></Field>
        <Field label="Marca"><Select value={f.brand_id} onChange={(e) => setF({ ...f, brand_id: e.target.value })} options={[{ value: "", label: "Todas las marcas" }, ...datos.marcas.map((m) => ({ value: m.id, label: m.name }))]} /></Field>
        <Field label="Local"><Select value={f.establishment_id} onChange={(e) => setF({ ...f, establishment_id: e.target.value })} options={[{ value: "", label: "Todos los locales" }, ...datos.locales.map((l) => ({ value: l.id, label: l.name }))]} /></Field>
        <Field label="Vale desde" required><Input type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></Field>
        <Field label="Vale hasta" hint="Vacío: sin fin"><Input type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></Field>
        <Field label="Nota" className="sm:col-span-2"><Input maxLength={80} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
