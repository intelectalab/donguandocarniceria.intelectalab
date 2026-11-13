"use client";

// Ejemplos visuales de la página pública (ilustrativos, con datos de ejemplo), como en la página del
// prototipo: el tablero del día y una vista por cada módulo. No leen datos reales.
import { Beef, Bike, Check, Drumstick, Ham, MapPin, Navigation, Phone, Receipt, Refrigerator, Sandwich, Scale, Scissors, Store } from "lucide-react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Barra, Cifra, Latido } from "./Movimiento";

const marco = "rounded-2xl border border-line bg-surface p-4 shadow-[0_20px_50px_rgba(40,8,18,.10)]";
const chip = (tono: "ok" | "warn" | "bad" | "info" | "neutro") =>
  ({ ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-primary-soft text-primary", neutro: "bg-surface-2 text-muted" })[tono];

function Chip({ tono, children }: { tono: "ok" | "warn" | "bad" | "info" | "neutro"; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${chip(tono)}`}>{children}</span>;
}

/** Portada: el tablero del día de un local. */
export function VistaTablero() {
  const quieto = useReducedMotion();
  return (
    <div aria-hidden="true" className={`${marco} p-5`}>
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="size-2.5 rounded-full bg-[#e5534b]" /><span className="size-2.5 rounded-full bg-[#e3b341]" /><span className="size-2.5 rounded-full bg-[#3fb950]" />
        <span className="ml-2 text-[12px] font-medium text-muted">Tablero del día · Local principal</span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok"><Latido /> En línea</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {([["Ventas de hoy", <Cifra key="v" valor={8420.5} decimales={2} prefijo="S/ " />, "+14% vs. ayer", "text-ok"],
          ["Pedidos en ruta", <Cifra key="p" valor={18} sufijo=" pedidos" duracion={1} />, "4 motos activas", "text-muted"],
          ["Kilos despachados", <Cifra key="k" valor={642.8} decimales={2} sufijo=" kg" />, "Merma: 0.8% OK", "text-ok"]] as const).map(([t, v, d, c]) => (
          <div key={t} className="rounded-xl bg-surface-2 p-3">
            <span className="text-[11px] text-muted">{t}</span>
            <strong className="mt-0.5 block font-display text-[16px] text-primary">{v}</strong>
            <span className={`text-[10.5px] ${c}`}>{d}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-3">
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted uppercase"><span className="flex items-center gap-1.5"><Latido color="#922242" /> Despachos en vivo</span><span className="text-primary">14:28 hrs</span></div>
          {[["YP", "Restaurante El Asador", "14.2 kg Lomo fino · S/ 546.00", "Pagado Yape", "ok"], [<Bike key="b" size={13} />, "Sra. Patricia Mendoza", "3 Pollos brasa + 2 kg Chuleta", "En moto #3", "warn"], [<Scissors key="s" size={13} />, "Parrillas Los Leños", "8 Cuyes beneficiados vaciado", "Listo corte", "bad"]].map(([ico, n, d, e, t], i) => (
            <motion.div key={i} className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5"
              initial={quieto ? false : { opacity: 0, x: -14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.5 + i * 0.25, ease: [0.22, 1, 0.36, 1] }}>
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-[10px] font-bold text-primary">{ico}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-[11.5px]">{n}</strong><span className="block truncate text-[10.5px] text-muted">{d}</span></span>
              <Chip tono={t as "ok" | "warn" | "bad"}>{e}</Chip>
            </motion.div>
          ))}
        </div>
        <div className="flex flex-col rounded-xl border border-line p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted uppercase"><span>Ruta Lima Sur</span><span className="text-ok">GPS activo</span></div>
          <div className="relative mt-2 flex-1 rounded-lg bg-[repeating-linear-gradient(45deg,var(--surface-2)_0_8px,var(--bg)_8px_16px)]">
            <span className="absolute top-2 left-2 rounded bg-surface px-1.5 text-[10px] shadow">Surquillo</span>
            <span className="absolute top-2 right-2 rounded bg-surface px-1.5 text-[10px] shadow">San Borja</span>
            <span className="absolute right-2 bottom-2 rounded bg-surface px-1.5 text-[10px] shadow">Miraflores</span>
            <svg aria-hidden="true" viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 size-full">
              <path d="M8 46 C 30 40, 34 22, 55 26 S 82 18, 92 10" fill="none" stroke="#922242" strokeOpacity=".35" strokeWidth="1.4" strokeDasharray="3 3" />
            </svg>
            <motion.span className="absolute top-1/2 left-1/2 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-primary-ink shadow"
              style={{ translateX: "-50%", translateY: "-50%" }}
              animate={quieto ? undefined : { x: [-18, 14, -18], y: [6, -6, 6] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}>
              Moto #2 a 4 min
            </motion.span>
          </div>
          <div className="mt-2 flex justify-between text-[10.5px]"><span className="text-muted">Entrega 14 de 18</span><span className="font-semibold text-ok">78% completado</span></div>
          <div className="mt-1"><Barra porcentaje={78} color="var(--ok)" className="h-1.5 !bg-surface-2" /></div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#171210] px-4 py-3 font-mono text-white">
        <span className="grid size-8 place-items-center rounded-lg bg-ok/80"><Scale size={16} /></span>
        <span className="flex-1"><span className="block text-[10.5px] text-white/60">Mostrador 1 · venta por kilo</span><strong className="text-[13px] text-[#9be9a8]">Panceta de cerdo salmuera</strong></span>
        <span className="text-right"><strong className="block text-[18px]"><Cifra valor={2.45} decimales={3} sufijo=" kg" duracion={1.8} separador={false} /></strong><span className="text-[10.5px] text-[#9be9a8]">S/ 24.50/kg = S/ 60.03</span></span>
      </div>
    </div>
  );
}

// --- Vistas de los módulos, como en la página del prototipo (mismos colores y distribución) ---
// Tarjeta blanca con una franja crema arriba (título y etiqueta) y el contenido sobre crema.
const V = { vino: "#6E1423", tinta: "#1D1A16", gris: "#564242", crema: "#FAF2EB", verde: "#2E7D4F", oro: "#D4A72C", ocre: "#735700", rojo: "#BA1A1A" };

function Tarjeta({ titulo, icono, etiqueta, children, pie, angosta = false }: {
  titulo: string; icono?: ReactNode; etiqueta?: ReactNode; children: ReactNode; pie?: ReactNode; angosta?: boolean;
}) {
  return (
    <div aria-hidden="true" className={`overflow-hidden rounded-xl bg-white p-5 text-[#1D1A16] shadow-md ${angosta ? "mx-auto w-full max-w-md rounded-2xl shadow-lg" : ""}`}>
      <div className="-mx-5 -mt-5 mb-4 flex items-center justify-between gap-3 bg-[#FAF2EB] px-5 pt-3.5 pb-3">
        <span className="flex items-center gap-2 text-[15.5px] font-bold">{icono}{titulo}</span>
        {etiqueta}
      </div>
      {children}
      {pie && <div className="-mx-5 -mb-5 mt-4 rounded-b-xl bg-[#FAF2EB] px-5 py-3">{pie}</div>}
    </div>
  );
}

const verde = "rounded px-2.5 py-1 text-xs font-bold whitespace-nowrap bg-[#2E7D4F]/10 text-[#2E7D4F]";

/** Pedidos y canales: la bandeja de WhatsApp y la comanda. */
export function VistaBandeja() {
  return (
    <Tarjeta titulo="Bandeja omnicanal WhatsApp" etiqueta={<span className={`${verde} rounded-full`}>3 nuevos pedidos</span>}>
      <div className="grid gap-4 md:grid-cols-12">
        <div className="flex flex-col gap-2 md:col-span-5">
          {[["Don Fernando", "Hace 2 min", "«Quiero 3 kg de panceta y 1 cuy para el domingo...»", true], ["Cevichería El Puerto", "11:40 am", "«Confírmame el despacho de pechugas...»", false]].map(([n, h, m, activo]) => (
            <div key={String(n)} className={`rounded-lg p-2.5 ${activo ? "bg-[#FAF2EB]" : "bg-white"}`}>
              <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-bold">{n}</span><span className="text-[11px] whitespace-nowrap text-[#564242]">{h}</span></div>
              <p className="truncate text-xs text-[#564242]">{m}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-between rounded-xl bg-[#FAF2EB] p-3 md:col-span-7">
          <div>
            <div className="mb-2 flex items-center justify-between pb-2"><span className="text-[12.5px] font-bold">Comanda #A-1082</span><span className="font-mono text-sm font-bold text-[#6E1423]">S/ 145.00</span></div>
            <div className="space-y-1.5 text-xs">
              {[["Panceta de cerdo fresca (2.8 kg)", "S/ 68.60"], ["Cuy entero beneficiado (1 unidad 900 g)", "S/ 38.00"], ["Costillar de cerdo marinado (1.5 kg)", "S/ 38.40"]].map(([p, v]) => (
                <div key={p} className="flex justify-between gap-2 rounded bg-white p-2"><span>{p}</span><span className="font-bold whitespace-nowrap">{v}</span></div>
              ))}
            </div>
          </div>
          <div className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#6E1423] py-2 text-[13px] font-bold text-white"><Receipt size={17} /> Generar pedido y enviar al corte</div>
        </div>
      </div>
    </Tarjeta>
  );
}

/** Mostrador: venta por kilo con el peso de la balanza. */
export function VistaMostrador() {
  return (
    <Tarjeta titulo="Terminal mostrador táctil" icono={<Store size={19} className="text-[#6E1423]" />} etiqueta={<span className={verde}>Venta por kilo</span>}>
      <div className="grid gap-4 md:grid-cols-12">
        <div className="grid grid-cols-2 gap-2 md:col-span-7">
          {[[Beef, "Lomo fino res", "S/ 42.00 / kg"], [Drumstick, "Pechuga pollo", "S/ 16.50 / kg"], [Ham, "Chuleta cerdo", "S/ 21.00 / kg"], [Sandwich, "Carne molida", "S/ 18.00 / kg"]].map(([Icono, p, v]) => {
            const I = Icono as typeof Beef;
            return (
              <div key={String(p)} className="flex flex-col items-center justify-center rounded-lg bg-[#FAF2EB] p-3 text-center">
                <I size={24} className="mb-1 text-[#6E1423]" />
                <span className="text-[12.5px] font-bold">{String(p)}</span><span className="text-xs text-[#564242]">{String(v)}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col justify-between rounded-xl bg-[#1D1A16] p-4 text-white md:col-span-5">
          <div>
            <span className="text-xs font-bold tracking-wider text-[#DCC0C0] uppercase">Peso ingresado</span>
            <div className="mt-2 text-right">
              <span className="font-mono text-3xl font-extrabold text-[#FFDF98]">1.340 kg</span>
              <span className="block text-xs text-[#DCC0C0]">x S/ 28.00 / kg (Bife angosto)</span>
            </div>
            <div className="-mx-4 mt-4 bg-[#33302B] px-4 pt-3 pb-2">
              <span className="text-xs text-[#DCC0C0]">Total a cobrar</span>
              <div className="text-2xl font-extrabold text-[#A4F4BC]">S/ 37.52</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs font-bold">
            <span className="rounded bg-[#775A00] py-2">Yape / Plin</span>
            <span className="rounded bg-[#2E7D4F] py-2">Efectivo S/</span>
          </div>
        </div>
      </div>
    </Tarjeta>
  );
}

/** Reparto: la entrega en el celular del repartidor. */
export function VistaRepartidor() {
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-md rounded-2xl bg-white p-5 text-[#1D1A16] shadow-lg">
      <div className="-mx-5 -mt-5 mb-4 flex items-center justify-between rounded-t-2xl bg-[#FAF2EB] px-5 pt-4 pb-3">
        <div>
          <span className="text-[12.5px] text-[#564242]">Repartidor: Carlos Gómez (Moto 02)</span>
          <p className="text-[16px] font-bold">Entrega #05 de 12</p>
        </div>
        <span className="rounded bg-[#D4A72C]/20 px-2.5 py-1 text-xs font-bold text-[#735700]">En camino</span>
      </div>
      <div className="mb-4 rounded-xl bg-[#FAF2EB] p-3.5">
        <div className="flex items-start gap-2.5">
          <MapPin size={20} className="mt-0.5 shrink-0 text-[#6E1423]" />
          <div>
            <h4 className="text-[16px] font-bold">Av. Pardo 640 Dpto 402, Miraflores</h4>
            <p className="mt-0.5 text-xs text-[#564242]">Cliente: Sra. Elena Cornejo · Ref: frente al parque</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2 text-xs font-bold">
          <span className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-1.5 shadow-sm"><Navigation size={15} className="text-[#2E7D4F]" /> Ir con Maps</span>
          <span className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white py-1.5 shadow-sm"><Phone size={15} className="text-[#2E7D4F]" /> Llamar</span>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between rounded-xl bg-[#FAF2EB] p-3">
        <div><span className="text-xs text-[#564242]">Importe a cobrar:</span><p className="font-mono text-lg font-extrabold text-[#6E1423]">S/ 86.50</p></div>
        <span className={verde}>Por cobrar en efectivo</span>
      </div>
      <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2E7D4F] py-3 text-[15px] font-bold text-white shadow"><Check size={20} /> Confirmar entrega y cobro</div>
    </div>
  );
}

/** Cámara de frío: lotes con semáforo de vencimiento y rendimiento. */
export function VistaCamara() {
  const lotes: [string, string, string, string, string, string, boolean][] = [
    ["Lote VAC-2026-042 · Media canal vacuno", "Ingresado: ayer · Peso canal: 148.5 kg", "5 días restantes", "Estado óptimo", V.verde, V.verde, false],
    ["Lote PORC-2026-110 · Chuleta y costillar", "Stock: 34.2 kg en cortes empacados", "Consumir en 48 hrs", "Prioridad de salida", V.oro, V.ocre, false],
    ["Lote AV-998 · Pollo entero eviscerado", "Stock: 18 unidades (36.0 kg)", "Vence hoy 20:00", "Oferta / despachar ya", V.rojo, V.rojo, true],
  ];
  return (
    <Tarjeta titulo="Cámara frigorífica 01 · Control de lotes" icono={<Refrigerator size={19} className="text-[#6E1423]" />}
      etiqueta={<span className="text-xs font-semibold whitespace-nowrap text-[#564242]">Temperatura: -2.4 °C</span>}
      pie={<div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">Rendimiento última faena: 74.8% carne útil</span><span className="font-bold text-[#6E1423]">Merma grasa/hueso: 25.2%</span></div>}>
      <div className="space-y-3">
        {lotes.map(([l, d, v, e, punto, color, fuerte]) => (
          <div key={l} className="flex items-center justify-between gap-3 rounded-lg bg-[#FAF2EB] p-3">
            <div className="flex items-center gap-3">
              <span className="size-3.5 shrink-0 rounded-full" style={{ background: punto }} />
              <div><p className="text-[13px] font-bold">{l}</p><p className="text-xs text-[#564242]">{d}</p></div>
            </div>
            <div className="shrink-0 text-right">
              <span className="text-xs font-bold" style={{ color }}>{v}</span>
              <span className={`block text-[11px] ${fuerte ? "font-semibold" : ""}`} style={{ color: fuerte ? V.rojo : V.gris }}>{e}</span>
            </div>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/** Facturación: una boleta electrónica de ejemplo, como un ticket. */
export function VistaBoleta() {
  const fila = (a: string, b: string, negrita = false) => (
    <div className={`flex justify-between gap-3 ${negrita ? "font-bold" : ""}`}><span>{a}</span><span className="whitespace-nowrap">{b}</span></div>
  );
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-sm rounded-xl bg-white p-6 font-mono text-xs text-[#1D1A16] shadow-md">
      <div className="mb-4 border-b border-dashed border-[#E0D9D2] pb-4 text-center">
        <h4 className="text-sm font-bold">CARNICERÍA EL BUEN CORTE S.A.C.</h4>
        <p className="text-[11px] text-[#564242]">RUC: 20XXXXXXXXX</p>
        <p className="text-[11px] text-[#564242]">Av. Paseo de la República 1890 - Lima</p>
        <div className="my-2 rounded bg-[#FAF2EB] py-1 font-bold text-[#6E1423]">BOLETA DE VENTA ELECTRÓNICA B001-0004921</div>
      </div>
      <div className="mb-3 space-y-1.5 border-b border-dashed border-[#E0D9D2] pb-3">
        <div className="flex justify-between"><span>CLIENTE:</span><span className="font-bold">Juan Carlos Pérez</span></div>
        {fila("DNI:", "45892140")}
        {fila("FECHA:", "24/10/2026 10:14 AM")}
      </div>
      <div className="mb-3 space-y-2 border-b border-dashed border-[#E0D9D2] pb-3">
        {fila("DESCRIPCIÓN", "TOTAL", true)}
        {fila("Lomo fino (0.850 kg x S/ 45.00)", "S/ 38.25")}
        {fila("Pechuga desosada (1.200 kg x S/ 17.50)", "S/ 21.00")}
      </div>
      <div className="mb-4 space-y-1 border-b border-dashed border-[#E0D9D2] pb-4">
        {fila("OP. GRAVADA:", "S/ 50.21")}
        {fila("I.G.V. (18%):", "S/ 9.04")}
        <div className="flex justify-between text-sm font-bold"><span>IMPORTE TOTAL:</span><span>S/ 59.25</span></div>
      </div>
      <div className="flex items-center justify-between pt-2">
        <div className="grid size-16 place-items-center bg-[#1D1A16] p-1 text-center font-sans text-[10px] font-bold text-white">QR SUNAT</div>
        <div className="text-right font-sans">
          <span className="mb-1 block rounded bg-[#2E7D4F]/10 px-2 py-1 text-[11px] font-bold text-[#2E7D4F]">Aceptado por SUNAT</span>
          <span className="text-[10px] text-[#564242]">Comprobante de ejemplo</span>
        </div>
      </div>
    </div>
  );
}

/** Reportes: rentabilidad por categoría. */
export function VistaRentabilidad() {
  const filas: [string, string, number, string][] = [
    ["Vacuno / Res (margen promedio 34%)", "S/ 18,450 ganancia", 85, V.vino],
    ["Porcino / Cerdo (margen promedio 41%)", "S/ 12,300 ganancia", 62, V.oro],
    ["Avícola / Pollo fresco (margen promedio 18%)", "S/ 9,800 ganancia", 50, "#775A00"],
    ["Cuy beneficiado empacado (margen promedio 52%)", "S/ 7,420 ganancia", 38, V.verde],
  ];
  return (
    <Tarjeta titulo="Rentabilidad neta por categoría de carne" etiqueta={<span className="text-xs font-semibold whitespace-nowrap text-[#6E1423]">Mes actual (octubre)</span>}
      pie={<div className="grid grid-cols-2 gap-3"><div><span className="text-[11px] text-[#564242]">Ticket promedio</span><p className="text-sm font-bold">S/ 64.20 por cliente</p></div><div><span className="text-[11px] text-[#564242]">Vendedora top del mes</span><p className="text-sm font-bold text-[#2E7D4F]">Rosa Huamán (S/ 24,100)</p></div></div>}>
      <div className="space-y-4">
        {filas.map(([t, v, w, color]) => (
          <div key={t}>
            <div className="mb-1 flex justify-between gap-2 text-xs font-bold"><span>{t}</span><span className="whitespace-nowrap text-[#2E7D4F]">{v}</span></div>
            <Barra porcentaje={w} color={color} />
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/** Ventas B2B: liquidación de consignaciones. */
export function VistaConsignacion() {
  return (
    <Tarjeta titulo="Liquidación de consignaciones externas" etiqueta={<span className={verde}>Semana 42</span>}>
      <div className="space-y-3">
        {[["Minimarket Los Laureles (San Isidro)", "Entrega: 18 oct · 40 kg chorizo parrillero + 30 kg hamburguesa", "S/ 1,840 pendiente", V.vino, "Vendido: 52 kg (74%)", "Por liquidar este viernes"],
          ["Bodega Don Pepe (La Molina)", "Entrega: 20 oct · 25 pollos empacados al vacío", "S/ 0.00 (al día)", V.verde, "Liquidado por Yape el 23 oct", "Comprobante #B001-4421"]].map(([n, d, monto, color, izq, der]) => (
          <div key={n} className="rounded-lg bg-[#FAF2EB] p-3">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div><h4 className="text-sm font-bold">{n}</h4><span className="text-xs text-[#564242]">{d}</span></div>
              <span className="font-mono text-sm font-bold whitespace-nowrap" style={{ color }}>{monto}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 rounded bg-white p-2 text-xs text-[#564242]"><span>{izq}</span><span className="font-bold text-[#2E7D4F]">{der}</span></div>
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}
