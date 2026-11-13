"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Calculator, Check, Minus, Plus } from "lucide-react";
import { MarcoPublico, useMarco } from "./MarcoPublico";
import { Planes, type PlanPublico } from "./Planes";

// Página de precios, como la del prototipo: los planes, «¿Qué plan necesitas?», la tabla para comparar y
// las preguntas sobre precios y pagos. Todo sale de los planes de la API (lo que incluye cada uno).

/** Filas de la tabla: cada una se marca según los módulos que la API dice que tiene el plan. */
const TABLA: { grupo: string; filas: { texto: string; modulos: string[] }[] }[] = [
  {
    grupo: "Vender", filas: [
      { texto: "Pedidos de todos los canales (WhatsApp, teléfono, web)", modulos: ["PED"] },
      { texto: "Mostrador con venta por peso y balanza", modulos: ["POS"] },
      { texto: "Clientes, direcciones con pin y zonas de reparto", modulos: ["CLI"] },
      { texto: "Catálogo, cortes, peso variable y listas de precio", modulos: ["CAT"] },
      { texto: "CRM: bandeja, leads de la web y control de vendedoras", modulos: ["CRM"] },
      { texto: "Tienda WooCommerce y pasarela Mercado Pago", modulos: ["WEB"] },
      { texto: "Venta a negocios (B2B)", modulos: ["B2B"] },
      { texto: "Consignación", modulos: ["CON"] },
      { texto: "Campañas y fidelización", modulos: ["CMP"] },
      { texto: "Gasto de anuncios y atribución a ventas", modulos: ["ADS"] },
      { texto: "Telefonía con grabación", modulos: ["TEL"] },
    ],
  },
  {
    grupo: "Operar", filas: [
      { texto: "Preparación con escaneo y bolsas numeradas", modulos: ["PRE"] },
      { texto: "Reparto: rutas, app del repartidor y costo por entrega", modulos: ["DEL"] },
      { texto: "Almacenes, lotes y vencimientos (primero lo que vence)", modulos: ["ALM"] },
      { texto: "Compras y cuentas por pagar", modulos: ["COM"] },
      { texto: "Despiece y costeo", modulos: ["DES"] },
      { texto: "Órdenes de producción y recetas", modulos: ["PRO", "REC"] },
      { texto: "Calidad, etiquetas y trazabilidad de lotes", modulos: ["CAL", "ETQ"] },
      { texto: "Equipos, calibración y mantenimiento", modulos: ["EQU"] },
      { texto: "Flota avanzada", modulos: ["FLO"] },
    ],
  },
  {
    grupo: "Administrar", filas: [
      { texto: "Comprobantes electrónicos y guía de remisión", modulos: ["FAC"] },
      { texto: "Cajas, cobros y conciliación", modulos: ["CAJ"] },
      { texto: "Gastos, centros de costo y caja chica", modulos: ["GAS"] },
      { texto: "Tablero e indicadores", modulos: ["TAB"] },
      { texto: "Usuarios, roles, permisos y auditoría", modulos: ["SEG", "AUD"] },
      { texto: "Contabilidad", modulos: ["CNT"] },
      { texto: "Personal", modulos: ["PER"] },
      { texto: "Presupuesto", modulos: ["PRS"] },
      { texto: "API pública y webhooks", modulos: ["API"] },
      { texto: "Separación de una marca a otro RUC", modulos: ["SEP"] },
    ],
  },
];

const PREGUNTAS = [
  { p: "¿Los precios incluyen IGV?", r: "No. Los precios se muestran sin IGV; el comprobante lo detalla." },
  { p: "¿Puedo cambiar de plan después?", r: "Sí. Puedes subir o bajar de plan cuando quieras desde la misma app. Tus datos se mantienen." },
  { p: "¿Qué incluye la prueba gratis?", r: "Todos los módulos durante la prueba, para que conozcas el sistema completo. No pedimos tarjeta. Al terminar eliges el plan que te conviene." },
  { p: "¿Cómo se paga?", r: "Con tarjeta de crédito o débito, en un cobro mensual automático a través de Mercado Pago. Puedes cancelarlo cuando quieras." },
  { p: "¿Cobran comisión por venta?", r: "No. Pagas solo el plan, vendas lo que vendas." },
];

const tiene = (p: PlanPublico, modulos: string[]) => modulos.every((m) => p.modulos.some((x) => x.code === m));
const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: 0 })}`;

export default function PaginaPrecios() {
  return <MarcoPublico actual="precios"><Contenido /></MarcoPublico>;
}

function Contenido() {
  const { planes, pruebaDias, cargando, pedirDemo } = useMarco();
  return (
    <>
      <section className="mx-auto max-w-[1200px] px-4 pt-14 pb-16 sm:px-6">
        <div className="mx-auto max-w-[760px] text-center">
          <span className="rounded-full bg-primary-soft px-3 py-1 text-[11.5px] font-semibold tracking-[.08em] text-primary uppercase">Precios</span>
          <h1 className="mt-4 font-display text-[clamp(2.1rem,4vw,3.2rem)] leading-[1.08] font-bold tracking-[-0.025em]">Un plan para cada tamaño de negocio</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            Prueba {pruebaDias} días gratis con todos los módulos. Sin tarjeta, sin contrato de permanencia y sin comisiones por venta.
          </p>
        </div>
        <div className="mt-14"><Planes planes={planes} cargando={cargando} pruebaDias={pruebaDias} onElegir={pedirDemo} /></div>
        <p className="mt-8 text-center text-[13.5px] text-muted">Precios en soles, sin IGV. El cobro es recurrente y lo puedes cancelar cuando quieras.</p>
      </section>

      {planes.length > 0 && <Calculadora planes={planes} onProbar={pedirDemo} />}
      {planes.length > 0 && <Comparar planes={planes} />}

      <section className="mx-auto max-w-[860px] px-4 py-20 sm:px-6">
        <div className="text-center">
          <span className="rounded-full bg-primary-soft px-3 py-1 text-[11.5px] font-semibold tracking-[.08em] text-primary uppercase">Pagos</span>
          <h2 className="mt-4 font-display text-[clamp(1.8rem,3vw,2.4rem)] font-bold tracking-[-0.02em]">Preguntas sobre precios y pagos</h2>
        </div>
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-surface shadow-card">
          {PREGUNTAS.map((q) => (
            <details key={q.p} className="group px-6 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold">
                {q.p}
                <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[18px] text-primary transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{q.r}</p>
            </details>
          ))}
        </div>
        <p className="mt-10 text-center">
          <Link href="/#preguntas" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary hover:underline">Más preguntas frecuentes <ArrowRight size={16} /></Link>
        </p>
      </section>
    </>
  );
}

function Contador({ etiqueta, ayuda, valor, onCambio, min = 1, max = 99 }: { etiqueta: string; ayuda?: string; valor: number; onCambio: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4">
      <div><strong className="block text-[14.5px]">{etiqueta}</strong>{ayuda && <span className="text-[12.5px] text-muted">{ayuda}</span>}</div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`Menos ${etiqueta.toLowerCase()}`} disabled={valor <= min} onClick={() => onCambio(Math.max(min, valor - 1))}
          className="grid size-9 cursor-pointer place-items-center rounded-full border border-line hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><Minus size={16} /></button>
        <output aria-live="polite" className="w-8 text-center font-display text-[20px] font-bold">{valor}</output>
        <button type="button" aria-label={`Más ${etiqueta.toLowerCase()}`} disabled={valor >= max} onClick={() => onCambio(Math.min(max, valor + 1))}
          className="grid size-9 cursor-pointer place-items-center rounded-full border border-line hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} /></button>
      </div>
    </div>
  );
}

function Interruptor({ etiqueta, ayuda, valor, onCambio }: { etiqueta: string; ayuda: string; valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={valor} onClick={() => onCambio(!valor)}
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4 text-left">
      <span><strong className="block text-[14.5px]">{etiqueta}</strong><span className="text-[12.5px] text-muted">{ayuda}</span></span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${valor ? "bg-primary" : "bg-line"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${valor ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** «¿Qué plan necesitas?»: el plan más económico que cubre locales, personas, marcas y lo que se necesita. */
function Calculadora({ planes, onProbar }: { planes: PlanPublico[]; onProbar: (plan: string) => void }) {
  const [locales, setLocales] = useState(1);
  const [personas, setPersonas] = useState(3);
  const [marcas, setMarcas] = useState(1);
  const [canales, setCanales] = useState(false);
  const [avanzado, setAvanzado] = useState(false);

  const ordenados = [...planes].sort((a, b) => a.price_pen - b.price_pen);
  const elegido = ordenados.find((p) => p.sites_max >= locales && p.users_max >= personas && p.brands_max >= marcas
    && (!canales || tiene(p, ["CRM", "WEB", "B2B", "CON"])) && (!avanzado || tiene(p, ["API", "TEL", "FLO"])));

  return (
    <section className="border-y border-line bg-surface-2/70">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-[11.5px] font-semibold tracking-[.08em] text-primary uppercase"><Calculator size={13} /> ¿Qué plan necesitas?</span>
          <h2 className="mt-4 font-display text-[clamp(1.8rem,3vw,2.4rem)] font-bold tracking-[-0.02em]">Encuentra tu plan en 30 segundos</h2>
          <p className="mt-2 text-[15.5px] text-muted">Responde y te mostramos el plan más económico que cubre tu negocio.</p>
          <div className="mt-6 grid gap-3">
            <Contador etiqueta="Locales o puntos de venta" valor={locales} onCambio={setLocales} max={20} />
            <Contador etiqueta="Personas que usarán el sistema" ayuda="Cajeros, vendedoras, repartidores, almacén…" valor={personas} onCambio={setPersonas} max={200} />
            <Contador etiqueta="Marcas" ayuda="Si vendes con más de un nombre comercial" valor={marcas} onCambio={setMarcas} max={20} />
            <Interruptor etiqueta="Vendo por la web, a negocios o en consignación" ayuda="CRM, WooCommerce, B2B, consignación, compras, producción" valor={canales} onCambio={setCanales} />
            <Interruptor etiqueta="Necesito API, telefonía con grabación o flota avanzada" ayuda="Integraciones propias y operación grande" valor={avanzado} onCambio={setAvanzado} />
          </div>
        </div>
        <div aria-live="polite" className="rounded-3xl bg-[#6e1423] p-8 text-white shadow-[0_30px_70px_rgba(110,20,35,.3)]">
          <p className="text-[12px] font-semibold tracking-[.08em] text-gold uppercase">Te recomendamos</p>
          {elegido ? (
            <>
              <h3 className="mt-2 font-display text-[32px] font-bold">Plan {elegido.name}</h3>
              <p className="mt-1 text-[16px] text-white/85">{soles(elegido.price_pen)} al mes, más IGV</p>
              <ul className="mt-5 space-y-2 text-[15px]">
                <li className="flex gap-2"><Check size={18} className="text-gold" />Hasta {elegido.users_max} usuarios</li>
                <li className="flex gap-2"><Check size={18} className="text-gold" />{elegido.sites_max} {elegido.sites_max === 1 ? "local" : "locales"} y {elegido.brands_max} {elegido.brands_max === 1 ? "marca" : "marcas"}</li>
              </ul>
              <button type="button" onClick={() => onProbar(elegido.code)}
                className="mt-7 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold py-3.5 text-[15px] font-bold hover:brightness-105" style={{ color: "var(--franja-base)" }}>
                Probar el plan {elegido.name} gratis <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <>
              <h3 className="mt-2 font-display text-[28px] font-bold">Un plan a tu medida</h3>
              <p className="mt-2 text-[15.5px] text-white/85">Tu operación es más grande que nuestros planes. Escríbenos y armamos uno para ti.</p>
              <button type="button" onClick={() => onProbar("")}
                className="mt-7 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold py-3.5 text-[15px] font-bold hover:brightness-105" style={{ color: "var(--franja-base)" }}>
                Hablar con nosotros <ArrowRight size={17} />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** «Compara todo lo que incluye»: los límites de cada plan y lo que incluye, desde sus módulos. */
function Comparar({ planes }: { planes: PlanPublico[] }) {
  const marca = (si: boolean) => si
    ? <Check size={18} className="mx-auto text-ok" aria-label="Incluido" />
    : <span className="text-muted" aria-label="No incluido">—</span>;
  return (
    <section className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
      <h2 className="text-center font-display text-[clamp(1.8rem,3vw,2.4rem)] font-bold tracking-[-0.02em]">Compara todo lo que incluye</h2>
      <div className="mt-10 overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead className="sticky top-0">
            <tr className="bg-surface-2">
              <th scope="col" className="px-5 py-4 text-left text-[13px] font-semibold text-muted">Módulo</th>
              {planes.map((p) => <th key={p.code} scope="col" className={`px-4 py-4 text-center text-[15px] font-bold ${p.is_featured ? "text-primary" : ""}`}>{p.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {[["Usuarios", "users_max"], ["Marcas", "brands_max"], ["Locales", "sites_max"]].map(([t, k]) => (
              <tr key={t} className="border-t border-line">
                <th scope="row" className="px-5 py-3 text-left font-medium">{t}</th>
                {planes.map((p) => <td key={p.code} className="px-4 py-3 text-center font-semibold">{p[k as "users_max"]}</td>)}
              </tr>
            ))}
            {TABLA.map((g) => (
              <FilasGrupo key={g.grupo} grupo={g.grupo} filas={g.filas} planes={planes} marca={marca} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FilasGrupo({ grupo, filas, planes, marca }: { grupo: string; filas: { texto: string; modulos: string[] }[]; planes: PlanPublico[]; marca: (si: boolean) => React.ReactNode }) {
  return (
    <>
      <tr className="border-t border-line bg-primary-soft/50">
        <th scope="colgroup" colSpan={planes.length + 1} className="px-5 py-2.5 text-left text-[12px] font-bold tracking-[.1em] text-primary uppercase">{grupo}</th>
      </tr>
      {filas.map((f) => (
        <tr key={f.texto} className="border-t border-line">
          <th scope="row" className="px-5 py-3 text-left font-normal">{f.texto}</th>
          {planes.map((p) => <td key={p.code} className="px-4 py-3 text-center">{marca(tiene(p, f.modulos))}</td>)}
        </tr>
      ))}
    </>
  );
}
