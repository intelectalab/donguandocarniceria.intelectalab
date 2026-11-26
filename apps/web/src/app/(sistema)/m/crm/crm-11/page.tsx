"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Coins, Gift, Megaphone, ReceiptText, TrendingUp } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, Input, PageHeader, Tabs, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { tarifa } from "@/modulos/crm/conversacion";
import { sinTildes } from "@/modulos/mae/tipos";

type Opcion = { value: string; label: string };
type Fila = { id: string; nombre: string; mensajes: number; servicio: number; utilidad: number; marketing: number; gratis_anuncio: number; cobrados: number; costo: number; usadas?: number; cuota?: number; cliente?: string | null };
type Resumen = {
  mes: string; meses: Opcion[]; marcas: Opcion[];
  cifras: { total: number; mensajes: number; cobrados: number; proyeccion: number; dias: number; transcurridos: number; gratis_anuncio: number; ahorro_anuncio: number; gratis_cuota: number; gratis_utilidad: number; pedidos: number; por_pedido: number | null };
  por_numero: Fila[]; por_marca: Fila[]; por_vendedora: Fila[]; por_pedido: Fila[];
  tarifas: { marketing: number; utilidad: number; servicio: number; autenticacion: number; cuota: number; desde: string };
};
type Vista = "numero" | "marca" | "vendedora" | "pedido" | "simulador";

/**
 * CRM-11 Costo de WhatsApp: el mes por número, marca, vendedora y pedido; la cuota de respuestas gratis de cada número,
 * lo ahorrado por las ventanas de anuncio, la proyección y un simulador con las mismas tarifas.
 */
export default function CostoWhatsApp() {
  const { can, marca } = useSesion();
  const permitido = Boolean(can("crm.cost.view"));
  const [f, setF] = useState({ mes: "", marca: "" });
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>("numero");
  const filtroMarca = f.marca || (marca !== "ALL" ? marca : "");

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries({ ...f, marca: filtroMarca }).filter(([, v]) => v)).toString();
    api<Resumen>(`/v1/crm/costos${q ? `?${q}` : ""}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, filtroMarca, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no ve el costo de WhatsApp.</Alert>;
  const c = r?.cifras;
  const t = r?.tarifas;
  return (
    <div className="grid gap-5">
      <PageHeader description="Lo que cuesta WhatsApp en el mes, mensaje a mensaje: cada número tiene 1000 respuestas de servicio gratis al mes; dentro de la ventana de 24 h la utilidad es gratis; con un anuncio de clic a WhatsApp, todo es gratis por 72 h; lo respondido desde la app del celular no se cobra. Cada costo queda con la tarifa con que se cobró." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[220px]"><FiltroSelect etiqueta="Mes" ancho={220} vacio={r ? `Mes: ${r.meses.find((m) => m.value === r.mes)?.label ?? r.mes}` : "Mes"} value={f.mes} onChange={(v) => setF({ ...f, mes: v })} options={r?.meses ?? []} /></div>
        <div className="w-[220px]"><FiltroSelect etiqueta="Marca" todos="todas" ancho={220} value={f.marca} onChange={(v) => setF({ ...f, marca: v })} options={r?.marcas ?? []} /></div>
        {t && <p className="text-[12px] text-muted">Tarifas de Perú desde el {fecha(t.desde)}: marketing {tarifa(t.marketing)} · utilidad {tarifa(t.utilidad)} · servicio {tarifa(t.servicio)} desde la respuesta {numero(t.cuota + 1)} · autenticación {tarifa(t.autenticacion)} (por confirmar con Meta).</p>}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Cifra titulo="Costo del mes" valor={soles(c.total)} icono={Coins} destacada detalle={`${numero(c.cobrados)} cobrados de ${numero(c.mensajes)} mensajes`} />
          <Cifra titulo="Proyección del mes" valor={soles(c.proyeccion)} icono={TrendingUp} detalle={`${c.transcurridos} de ${c.dias} días`} />
          <Cifra titulo="Gratis por anuncio" valor={numero(c.gratis_anuncio)} icono={Megaphone} tono="ok" detalle={`Ahorro de ${soles(c.ahorro_anuncio)}`} />
          <Cifra titulo="Gratis por la cuota" valor={numero(c.gratis_cuota)} icono={Gift} detalle={`Más ${numero(c.gratis_utilidad)} de utilidad en ventana`} />
          <Cifra titulo="Costo por pedido" valor={c.por_pedido === null ? "—" : tarifa(c.por_pedido)} icono={ReceiptText} detalle={`${numero(c.pedidos)} pedidos de WhatsApp entregados`} />
        </div>
      )}
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "numero", label: "Por número" }, { key: "marca", label: "Por marca" }, { key: "vendedora", label: "Por vendedora" }, { key: "pedido", label: "Por pedido" }, { key: "simulador", label: "Simulador" }]} />
      {r && vista !== "simulador" && <Desglose vista={vista} filas={vista === "numero" ? r.por_numero : vista === "marca" ? r.por_marca : vista === "vendedora" ? r.por_vendedora : r.por_pedido} />}
      {vista === "simulador" && t && <Simulador cuota={t.cuota} />}
    </div>
  );
}

function Desglose({ vista, filas }: { vista: Exclude<Vista, "simulador">; filas: Fila[] }) {
  const [buscar, setBuscar] = useState("");
  const visibles = useMemo(() => {
    const q = sinTildes(buscar.trim());
    return filas.filter((x) => !q || sinTildes(`${x.nombre} ${x.cliente ?? ""}`).includes(q));
  }, [filas, buscar]);
  const ord = useOrdenLocal(visibles, { nombre: (x) => x.nombre, servicio: (x) => x.servicio, utilidad: (x) => x.utilidad, marketing: (x) => x.marketing, gratis_anuncio: (x) => x.gratis_anuncio, costo: (x) => x.costo, usadas: (x) => x.usadas ?? 0 });
  const pagina = usePaginaLocal(ord.filas, `${vista}|${buscar}|${ord.orden.sort}`);
  const titulo = { numero: "Número", marca: "Marca", vendedora: "Vendedora", pedido: "Pedido" }[vista];
  const columnas: Column<Fila>[] = [
    { key: "nombre", sortable: true, header: titulo, cardTitle: true, render: (x) => <div><p className={`font-semibold text-ink ${vista === "pedido" ? "font-mono" : ""}`}>{x.nombre}</p>{x.cliente && <p className="text-[12px] text-muted">{x.cliente}</p>}</div> },
    ...(vista === "numero" ? [{ key: "usadas", sortable: true, header: "Respuestas gratis usadas", render: (x: Fila) => {
      const pct = Math.min(100, ((x.usadas ?? 0) / Math.max(1, x.cuota ?? 1000)) * 100);
      return <div className="min-w-[130px]"><p className="text-[12px] tabular-nums">{numero(x.usadas ?? 0)} de {numero(x.cuota ?? 1000)}</p><span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} /></span></div>;
    } }] : []),
    { key: "servicio", sortable: true, header: "Servicio", align: "right", render: (x) => numero(x.servicio) },
    { key: "utilidad", sortable: true, header: "Utilidad", align: "right", render: (x) => numero(x.utilidad) },
    { key: "marketing", sortable: true, header: "Marketing", align: "right", render: (x) => numero(x.marketing) },
    { key: "gratis_anuncio", sortable: true, header: "Gratis por anuncio", align: "right", hideOnMobile: true, render: (x) => numero(x.gratis_anuncio) },
    { key: "costo", sortable: true, header: "Costo", align: "right", render: (x) => <span className="font-semibold tabular-nums">{tarifa(x.costo)}</span> },
  ];
  const total = visibles.reduce((s, x) => s + x.costo, 0);
  return (
    <>
      {vista === "marca" && filas.length > 0 && (
        <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
          {filas.map((x) => {
            const max = Math.max(...filas.map((y) => y.costo), 0.0001);
            return (
              <div key={x.id} className="grid grid-cols-[minmax(0,160px)_1fr_90px] items-center gap-3 text-[12.5px]">
                <span className="truncate text-ink">{x.nombre}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-primary" style={{ width: `${(x.costo / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums">{soles(x.costo)}</span>
              </div>
            );
          })}
        </section>
      )}
      <DataTable {...ord.orden} rowKey={(x) => x.id} columns={columnas} rows={pagina.filas} pagination={pagina.props} empty="Sin mensajes cobrados en este mes."
        search={{ value: buscar, onChange: setBuscar, placeholder: `Buscar ${titulo.toLowerCase()}${vista === "pedido" ? " o cliente" : ""}…` }}
        toolbar={<span className="text-[12.5px] text-muted">Total: <b className="text-ink">{tarifa(total)}</b></span>} />
    </>
  );
}

function Simulador({ cuota }: { cuota: number }) {
  const [d, setD] = useState({ pedidos: "1000", numeros: "2", respuestas: "10", utilidades: "2", por_anuncio: "0" });
  const [res, setRes] = useState<{ servicio: number; utilidad: number; total: number } | null>(null);
  const [error, setError] = useState("");
  async function calcular() {
    setError("");
    try {
      setRes(await api(`/v1/crm/costos/simular?${new URLSearchParams(d)}`));
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-[13px] text-muted">Calcula un mes con las mismas tarifas, mensaje a mensaje: {numero(cuota)} respuestas gratis por número, utilidad fuera de la ventana y la ventana gratuita de 72 h por anuncio de clic a WhatsApp.</p>
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Pedidos al mes"><Input type="number" min={0} value={d.pedidos} onChange={(e) => setD({ ...d, pedidos: e.target.value })} /></Field>
        <Field label="Números"><Input type="number" min={1} max={20} value={d.numeros} onChange={(e) => setD({ ...d, numeros: e.target.value })} /></Field>
        <Field label="Respuestas por pedido"><Input type="number" min={0} value={d.respuestas} onChange={(e) => setD({ ...d, respuestas: e.target.value })} /></Field>
        <Field label="Utilidad fuera de ventana por pedido"><Input type="number" min={0} max={5} value={d.utilidades} onChange={(e) => setD({ ...d, utilidades: e.target.value })} /></Field>
        <Field label="Parte por anuncio (0 a 1)"><Input type="number" min={0} max={1} step={0.05} value={d.por_anuncio} onChange={(e) => setD({ ...d, por_anuncio: e.target.value })} /></Field>
      </div>
      <div><Button variant="primary" icon={Calculator} onClick={calcular}>Calcular</Button></div>
      {res && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Cifra titulo="Servicio" valor={soles(res.servicio)} icono={Coins} />
          <Cifra titulo="Utilidad" valor={soles(res.utilidad)} icono={ReceiptText} />
          <Cifra titulo="Total del mes" valor={soles(res.total)} icono={TrendingUp} destacada />
        </div>
      )}
    </section>
  );
}
