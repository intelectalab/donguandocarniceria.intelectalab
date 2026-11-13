"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BarChart3, ChevronDown, Inbox, Menu, Receipt, Scale, Snowflake, Store, Truck, X, type LucideIcon } from "lucide-react";

/** El menú «Funciones», como en el prototipo: cada módulo con su línea y su fila en la página. */
export const FUNCIONES: { id: string; icono: LucideIcon; titulo: string; texto: string }[] = [
  { id: "pedidos", icono: Inbox, titulo: "Pedidos por WhatsApp", texto: "Catálogo, comanda y pago en un chat" },
  { id: "mostrador", icono: Scale, titulo: "Mostrador con peso variable", texto: "Cobro por kilo, Yape, Plin y efectivo" },
  { id: "reparto", icono: Truck, titulo: "Reparto con rutas", texto: "Mapa, Google Maps o Waze y cobro validado" },
  { id: "almacen", icono: Snowflake, titulo: "Almacén, lotes y despiece", texto: "Vencimientos, primero lo que vence y rendimiento" },
  { id: "facturacion", icono: Receipt, titulo: "Boletas, facturas y caja", texto: "Formato SUNAT, cuentas por cobrar" },
  { id: "reportes", icono: BarChart3, titulo: "Análisis de ventas", texto: "Comparativos por categoría y vendedora" },
  { id: "multicanal", icono: Store, titulo: "Tienda web y consignación", texto: "WooCommerce, bodegas y minimarkets" },
];

const ENLACES = [
  { href: "/#como-funciona", label: "Cómo funciona", clave: "" },
  { href: "/precios", label: "Precios", clave: "precios" },
];

/** «Blog» está en el menú, como en el prototipo, pero todavía no deja entrar. */
function Blog({ movil = false }: { movil?: boolean }) {
  return (
    <span aria-disabled="true" title="Muy pronto"
      className={`flex cursor-default items-center gap-1.5 rounded-lg font-medium text-ink/45 ${movil ? "px-2 py-2.5 text-[15px]" : "px-3 py-2 text-[15px]"}`}>
      Blog <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">Pronto</span>
    </span>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-[10px] bg-primary font-display text-[15px] font-extrabold text-primary-ink">A</span>
      <strong className="font-display text-[20px] font-bold tracking-[-0.01em]">Aycha</strong>
    </span>
  );
}

/**
 * Cabecera fija de la página pública, como la del prototipo: logo a la izquierda, el menú al centro
 * («Funciones» se despliega con los módulos) e «Ingresar» y «Pruébalo gratis» a la derecha. En celular,
 * un botón abre el mismo menú.
 */
export function Cabecera({ conSesion, actual, onProbar }: { conSesion: boolean; actual: "inicio" | "precios"; onProbar: () => void }) {
  const [funciones, setFunciones] = useState(false);
  const [movil, setMovil] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!funciones) return;
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setFunciones(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setFunciones(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", tecla); };
  }, [funciones]);

  const cerrar = () => { setFunciones(false); setMovil(false); };
  const ingresar = conSesion ? "/inicio" : "/login";

  return (
    <header className="sticky top-0 z-40 bg-surface/95 shadow-[0_1px_0_var(--line),0_8px_24px_rgba(40,8,18,.06)] backdrop-blur-md">
      {/* Línea fina vino y dorado: separa la cabecera del resto de la página. */}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-primary via-[#c0536e] to-gold opacity-70" />
      <div className="mx-auto grid h-20 max-w-[1200px] grid-cols-[auto_1fr_auto] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Aycha, página de inicio"><Logo /></Link>

        <nav className="hidden items-center justify-center gap-1 lg:flex" aria-label="Secciones">
          <div ref={caja} className="relative">
            <button type="button" aria-expanded={funciones} aria-haspopup="true" onClick={() => setFunciones((v) => !v)}
              className={`flex cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-[15px] font-medium transition-colors hover:bg-surface-2 ${funciones ? "text-primary" : "text-ink/85"}`}>
              Funciones <ChevronDown size={16} className={`transition-transform ${funciones ? "rotate-180" : ""}`} />
            </button>
            {funciones && (
              <div className="absolute top-[calc(100%+12px)] left-1/2 grid w-[620px] -translate-x-1/2 grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-3 shadow-[0_24px_60px_rgba(40,8,18,.16)]">
                {FUNCIONES.map(({ id, icono: Icono, titulo, texto }) => (
                  <Link key={id} href={`/#${id}`} onClick={cerrar} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-surface-2">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><Icono size={18} /></span>
                    <span><strong className="block text-[14px] font-semibold">{titulo}</strong><span className="text-[12.5px] leading-snug text-muted">{texto}</span></span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          {ENLACES.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.clave === actual ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-[15px] font-medium transition-colors hover:bg-surface-2 ${n.clave === actual ? "text-primary" : "text-ink/85 hover:text-ink"}`}>{n.label}</Link>
          ))}
          <Blog />
          <Link href="/#preguntas" className="rounded-lg px-3 py-2 text-[15px] font-medium text-ink/85 transition-colors hover:bg-surface-2 hover:text-ink">Preguntas</Link>
        </nav>

        <div className="col-start-3 flex items-center gap-2 sm:gap-3">
          <Link href={ingresar} className="hidden rounded-[10px] px-3 py-2 text-[15px] font-medium text-ink hover:bg-surface-2 sm:block">{conSesion ? "Ir a mi sistema" : "Ingresar"}</Link>
          <button type="button" onClick={onProbar}
            className="cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-[14.5px] font-semibold text-primary-ink shadow-[0_8px_20px_rgba(110,20,35,.22)] transition-[filter] hover:brightness-110 sm:px-6 sm:py-3 sm:text-[15px]">
            Pruébalo gratis
          </button>
          <button type="button" onClick={() => setMovil((v) => !v)} aria-expanded={movil} aria-label={movil ? "Cerrar menú" : "Abrir menú"}
            className="grid size-10 cursor-pointer place-items-center rounded-lg hover:bg-surface-2 lg:hidden">
            {movil ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {movil && (
        <nav aria-label="Menú" className="max-h-[calc(100vh-80px)] overflow-y-auto border-t border-line bg-surface px-4 pb-6 lg:hidden">
          <p className="pt-4 pb-2 text-[12px] font-semibold tracking-[.08em] text-muted uppercase">Funciones</p>
          {FUNCIONES.map(({ id, icono: Icono, titulo }) => (
            <Link key={id} href={`/#${id}`} onClick={cerrar} className="flex items-center gap-3 rounded-xl px-2 py-2.5 text-[15px] hover:bg-surface-2">
              <Icono size={18} className="text-primary" />{titulo}
            </Link>
          ))}
          <div className="mt-2 border-t border-line pt-2">
            {ENLACES.map((n) => <Link key={n.href} href={n.href} onClick={cerrar} className="block rounded-xl px-2 py-2.5 text-[15px] font-medium hover:bg-surface-2">{n.label}</Link>)}
            <Blog movil />
            <Link href="/#preguntas" onClick={cerrar} className="block rounded-xl px-2 py-2.5 text-[15px] font-medium hover:bg-surface-2">Preguntas</Link>
            <Link href={ingresar} className="block rounded-xl px-2 py-2.5 text-[15px] font-medium hover:bg-surface-2">{conSesion ? "Ir a mi sistema" : "Ingresar"}</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
