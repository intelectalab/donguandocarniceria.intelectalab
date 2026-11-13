// Ejemplos visuales de la página pública (ilustrativos, con datos de ejemplo), como en la página del
// prototipo: el tablero del día y una vista por cada módulo. No leen datos reales.
import { Bike, Check, Kanban, MapPin, Navigation, Phone, Receipt, Scale, Scissors, Snowflake } from "lucide-react";
import type { ReactNode } from "react";

const marco = "rounded-2xl border border-line bg-surface p-4 shadow-[0_20px_50px_rgba(40,8,18,.10)]";
const chip = (tono: "ok" | "warn" | "bad" | "info" | "neutro") =>
  ({ ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-primary-soft text-primary", neutro: "bg-surface-2 text-muted" })[tono];

function Chip({ tono, children }: { tono: "ok" | "warn" | "bad" | "info" | "neutro"; children: ReactNode }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${chip(tono)}`}>{children}</span>;
}

/** Portada: el tablero del día de un local. */
export function VistaTablero() {
  return (
    <div aria-hidden="true" className={`${marco} p-5`}>
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="size-2.5 rounded-full bg-[#e5534b]" /><span className="size-2.5 rounded-full bg-[#e3b341]" /><span className="size-2.5 rounded-full bg-[#3fb950]" />
        <span className="ml-2 text-[12px] font-medium text-muted">Tablero del día · Local principal</span>
        <span className="ml-auto"><Chip tono="ok">En línea</Chip></span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {[["Ventas de hoy", "S/ 8,420.50", "+14% vs. ayer", "text-ok"], ["Pedidos en ruta", "18 pedidos", "4 motos activas", "text-muted"], ["Kilos despachados", "642.80 kg", "Merma: 0.8% OK", "text-ok"]].map(([t, v, d, c]) => (
          <div key={t} className="rounded-xl bg-surface-2 p-3">
            <span className="text-[11px] text-muted">{t}</span>
            <strong className="mt-0.5 block font-display text-[16px] text-primary">{v}</strong>
            <span className={`text-[10.5px] ${c}`}>{d}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[1.3fr_1fr] gap-3">
        <div className="rounded-xl border border-line p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted uppercase"><span>Despachos en vivo</span><span className="text-primary">14:28 hrs</span></div>
          {[["YP", "Restaurante El Asador", "14.2 kg Lomo fino · S/ 546.00", "Pagado Yape", "ok"], [<Bike key="b" size={13} />, "Sra. Patricia Mendoza", "3 Pollos brasa + 2 kg Chuleta", "En moto #3", "warn"], [<Scissors key="s" size={13} />, "Parrillas Los Leños", "8 Cuyes beneficiados vaciado", "Listo corte", "bad"]].map(([ico, n, d, e, t], i) => (
            <div key={i} className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-[10px] font-bold text-primary">{ico}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate text-[11.5px]">{n}</strong><span className="block truncate text-[10.5px] text-muted">{d}</span></span>
              <Chip tono={t as "ok" | "warn" | "bad"}>{e}</Chip>
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-xl border border-line p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted uppercase"><span>Ruta Lima Sur</span><span className="text-ok">GPS activo</span></div>
          <div className="relative mt-2 flex-1 rounded-lg bg-[repeating-linear-gradient(45deg,var(--surface-2)_0_8px,var(--bg)_8px_16px)]">
            <span className="absolute top-2 left-2 rounded bg-surface px-1.5 text-[10px] shadow">Surquillo</span>
            <span className="absolute top-2 right-2 rounded bg-surface px-1.5 text-[10px] shadow">San Borja</span>
            <span className="absolute right-2 bottom-2 rounded bg-surface px-1.5 text-[10px] shadow">Miraflores</span>
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-ink">Moto #2 a 4 min</span>
          </div>
          <div className="mt-2 flex justify-between text-[10.5px]"><span className="text-muted">Entrega 14 de 18</span><span className="font-semibold text-ok">78% completado</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-full w-[78%] rounded-full bg-ok" /></div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#171210] px-4 py-3 font-mono text-white">
        <span className="grid size-8 place-items-center rounded-lg bg-ok/80"><Scale size={16} /></span>
        <span className="flex-1"><span className="block text-[10.5px] text-white/60">Mostrador 1 · venta por kilo</span><strong className="text-[13px] text-[#9be9a8]">Panceta de cerdo salmuera</strong></span>
        <span className="text-right"><strong className="block text-[18px]">2.450 kg</strong><span className="text-[10.5px] text-[#9be9a8]">S/ 24.50/kg = S/ 60.03</span></span>
      </div>
    </div>
  );
}

/** Pedidos y canales: la bandeja de WhatsApp y la comanda. */
export function VistaBandeja() {
  return (
    <div aria-hidden="true" className={marco}>
      <div className="flex items-center justify-between"><strong className="text-[13.5px]">Bandeja omnicanal WhatsApp</strong><Chip tono="ok">3 nuevos pedidos</Chip></div>
      {[["Don Fernando", "Hace 2 min", "«Quiero 3 kg de panceta y 1 cuy para el domingo...»"], ["Cevichería El Puerto", "11:40 am", "«Confírmame el despacho de pechugas...»"]].map(([n, h, m]) => (
        <div key={n} className="mt-2.5 rounded-xl bg-surface-2 p-3">
          <div className="flex justify-between text-[12px]"><strong>{n}</strong><span className="text-muted">{h}</span></div>
          <p className="mt-0.5 text-[12px] text-muted">{m}</p>
        </div>
      ))}
      <div className="mt-3 rounded-xl border border-line p-3">
        <div className="flex justify-between text-[12.5px]"><strong>Comanda #A-1082</strong><strong className="text-primary">S/ 145.00</strong></div>
        {[["Panceta de cerdo fresca (2.8 kg)", "S/ 68.60"], ["Cuy entero beneficiado (1 unidad 900 g)", "S/ 38.00"], ["Costillar de cerdo marinado (1.5 kg)", "S/ 38.40"]].map(([p, v]) => (
          <div key={p} className="mt-1.5 flex justify-between text-[11.5px] text-muted"><span>{p}</span><span>{v}</span></div>
        ))}
        <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-primary py-2 text-[12px] font-semibold text-primary-ink"><Receipt size={14} /> Generar pedido y enviar al corte</div>
      </div>
    </div>
  );
}

/** Mostrador: venta por kilo con el peso de la balanza. */
export function VistaMostrador() {
  return (
    <div aria-hidden="true" className={marco}>
      <div className="flex items-center justify-between"><strong className="text-[13.5px]">Terminal mostrador táctil</strong><Chip tono="info">Venta por kilo</Chip></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {[["Lomo fino res", "S/ 42.00 / kg"], ["Pechuga pollo", "S/ 16.50 / kg"], ["Chuleta cerdo", "S/ 21.00 / kg"], ["Carne molida", "S/ 18.00 / kg"]].map(([p, v]) => (
          <div key={p} className="rounded-xl border border-line p-2.5"><strong className="block text-[12px]">{p}</strong><span className="text-[11px] text-muted">{v}</span></div>
        ))}
      </div>
      <div className="mt-3 rounded-xl bg-[#171210] p-3 text-white">
        <span className="text-[10.5px] tracking-wide text-white/60 uppercase">Peso ingresado</span>
        <strong className="block font-mono text-[26px] text-[#9be9a8]">1.340 kg</strong>
        <span className="text-[11px] text-white/70">x S/ 28.00 / kg (Bife angosto)</span>
      </div>
      <div className="mt-3 flex items-center justify-between"><span className="text-[12px] text-muted">Total a cobrar</span><strong className="font-display text-[20px] text-primary">S/ 37.52</strong></div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center text-[12px] font-semibold"><span className="rounded-lg bg-primary py-2 text-primary-ink">Yape / Plin</span><span className="rounded-lg border border-line py-2">Efectivo S/</span></div>
    </div>
  );
}

/** Reparto: la entrega en el celular del repartidor. */
export function VistaRepartidor() {
  return (
    <div aria-hidden="true" className={`${marco} mx-auto max-w-[380px]`}>
      <div className="flex items-center justify-between text-[12px]"><span><strong className="block text-[13px]">Repartidor: Carlos Gómez (Moto 02)</strong><span className="text-muted">Entrega #05 de 12</span></span><Chip tono="warn">En camino</Chip></div>
      <div className="mt-3 rounded-xl bg-surface-2 p-3">
        <div className="flex gap-2 text-[12.5px]"><MapPin size={16} className="mt-0.5 shrink-0 text-primary" /><span><strong className="block">Av. Pardo 640 Dpto 402, Miraflores</strong><span className="text-[11.5px] text-muted">Cliente: Sra. Elena Cornejo · Ref: frente al parque</span></span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold">
          <span className="flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-primary-ink"><Navigation size={14} /> Ir con Maps</span>
          <span className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface py-2"><Phone size={14} /> Llamar</span>
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between"><span className="text-[12px] text-muted">Importe a cobrar<span className="block text-[11px]">Por cobrar en efectivo</span></span><strong className="font-display text-[22px]">S/ 86.50</strong></div>
      <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-ok py-2.5 text-[12.5px] font-semibold text-white"><Check size={15} /> Confirmar entrega y cobro</div>
    </div>
  );
}

/** Cámara de frío: lotes con semáforo de vencimiento y rendimiento. */
export function VistaCamara() {
  return (
    <div aria-hidden="true" className={marco}>
      <div className="flex items-center justify-between"><strong className="flex items-center gap-1.5 text-[13.5px]"><Snowflake size={15} className="text-primary" /> Cámara frigorífica 01 · Control de lotes</strong><Chip tono="info">-2.4 °C</Chip></div>
      {[["Lote VAC-2026-042 · Media canal vacuno", "Ingresado: ayer · Peso canal: 148.5 kg", "5 días restantes", "Estado óptimo", "ok"],
        ["Lote PORC-2026-110 · Chuleta y costillar", "Stock: 34.2 kg en cortes empacados", "Consumir en 48 hrs", "Prioridad de salida", "warn"],
        ["Lote AV-998 · Pollo entero eviscerado", "Stock: 18 unidades (36.0 kg)", "Vence hoy 20:00", "Oferta / despachar ya", "bad"]].map(([l, d, v, e, t]) => (
        <div key={l} className="mt-2.5 flex items-center gap-3 rounded-xl bg-surface-2 p-3">
          <span className="min-w-0 flex-1"><strong className="block text-[12px]">{l}</strong><span className="text-[11px] text-muted">{d}</span></span>
          <span className="text-right"><span className="block text-[11px] font-semibold">{v}</span><Chip tono={t as "ok" | "warn" | "bad"}>{e}</Chip></span>
        </div>
      ))}
      <div className="mt-3 flex justify-between rounded-xl border border-line px-3 py-2 text-[11.5px]"><span>Rendimiento última faena: <strong className="text-ok">74.8% carne útil</strong></span><span className="text-muted">Merma grasa/hueso: 25.2%</span></div>
    </div>
  );
}

/** Facturación: una boleta electrónica de ejemplo. */
export function VistaBoleta() {
  return (
    <div aria-hidden="true" className={`${marco} mx-auto max-w-[400px] font-mono`}>
      <div className="text-center text-[11.5px]"><strong className="block text-[12.5px]">CARNICERÍA EL BUEN CORTE S.A.C.</strong><span className="text-muted">RUC: 20XXXXXXXXX · Av. Paseo de la República 1890 · Lima</span></div>
      <div className="mt-3 rounded-lg bg-primary-soft py-1.5 text-center text-[11.5px] font-bold text-primary">BOLETA DE VENTA ELECTRÓNICA B001-0004921</div>
      <div className="mt-3 space-y-0.5 text-[11px]"><div className="flex justify-between"><span className="text-muted">Cliente:</span><span>Juan Carlos Pérez</span></div><div className="flex justify-between"><span className="text-muted">Fecha:</span><span>24/10/2026 10:14 AM</span></div></div>
      <div className="mt-3 border-y border-dashed border-line py-2 text-[11px]">
        <div className="flex justify-between"><span>Lomo fino (0.850 kg x S/ 45.00)</span><span>S/ 38.25</span></div>
        <div className="mt-1 flex justify-between"><span>Pechuga desosada (1.200 kg x S/ 17.50)</span><span>S/ 21.00</span></div>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]"><div className="flex justify-between"><span className="text-muted">Op. gravada:</span><span>S/ 50.21</span></div><div className="flex justify-between"><span className="text-muted">I.G.V. (18%):</span><span>S/ 9.04</span></div><div className="flex justify-between text-[12.5px] font-bold"><span>Importe total:</span><span>S/ 59.25</span></div></div>
      <div className="mt-3 flex items-center justify-between"><span className="grid size-12 place-items-center rounded border border-line text-[9px] text-muted">QR</span><Chip tono="ok">Aceptado por SUNAT</Chip></div>
      <p className="mt-2 text-center text-[10px] text-muted">Comprobante de ejemplo</p>
    </div>
  );
}

/** Reportes: rentabilidad por categoría. */
export function VistaRentabilidad() {
  const filas: [string, string, number][] = [["Vacuno / Res (margen 34%)", "S/ 18,450", 82], ["Porcino / Cerdo (margen 41%)", "S/ 12,300", 64], ["Avícola / Pollo fresco (margen 18%)", "S/ 9,800", 48], ["Cuy beneficiado empacado (margen 52%)", "S/ 7,420", 38]];
  return (
    <div aria-hidden="true" className={marco}>
      <div className="flex items-center justify-between"><strong className="text-[13.5px]">Rentabilidad neta por categoría de carne</strong><span className="text-[11px] text-muted">Mes actual</span></div>
      {filas.map(([t, v, w]) => (
        <div key={t} className="mt-3">
          <div className="flex justify-between text-[11.5px]"><span>{t}</span><strong>{v} ganancia</strong></div>
          <div className="mt-1 h-2 rounded-full bg-surface-2"><div className="h-full rounded-full bg-primary" style={{ width: `${w}%` }} /></div>
        </div>
      ))}
      <div className="mt-4 grid grid-cols-2 gap-2 text-[11.5px]">
        <div className="rounded-xl bg-surface-2 p-2.5"><span className="text-muted">Ticket promedio</span><strong className="block text-[13px]">S/ 64.20 por cliente</strong></div>
        <div className="rounded-xl bg-surface-2 p-2.5"><span className="text-muted">Vendedora top del mes</span><strong className="block text-[13px]">Rosa Huamán (S/ 24,100)</strong></div>
      </div>
    </div>
  );
}

/** Ventas B2B: liquidación de consignaciones. */
export function VistaConsignacion() {
  return (
    <div aria-hidden="true" className={marco}>
      <div className="flex items-center justify-between"><strong className="flex items-center gap-1.5 text-[13.5px]"><Kanban size={15} className="text-primary" /> Liquidación de consignaciones externas</strong><span className="text-[11px] text-muted">Semana 42</span></div>
      <div className="mt-3 rounded-xl bg-surface-2 p-3">
        <div className="flex justify-between gap-2 text-[12px]"><strong>Minimarket Los Laureles (San Isidro)</strong><Chip tono="warn">S/ 1,840 pendiente</Chip></div>
        <p className="mt-0.5 text-[11px] text-muted">Entrega: 18 oct · 40 kg chorizo parrillero + 30 kg hamburguesa</p>
        <div className="mt-2 h-2 rounded-full bg-surface"><div className="h-full w-[74%] rounded-full bg-warn" /></div>
        <div className="mt-1 flex justify-between text-[11px]"><span>Vendido: 52 kg (74%)</span><span className="text-muted">Por liquidar este viernes</span></div>
      </div>
      <div className="mt-2.5 rounded-xl bg-surface-2 p-3">
        <div className="flex justify-between gap-2 text-[12px]"><strong>Bodega Don Pepe (La Molina)</strong><Chip tono="ok">S/ 0.00 (al día)</Chip></div>
        <p className="mt-0.5 text-[11px] text-muted">Entrega: 20 oct · 25 pollos empacados al vacío</p>
        <p className="mt-1 text-[11px]">Liquidado por Yape el 23 oct · Comprobante B001-4421</p>
      </div>
    </div>
  );
}
