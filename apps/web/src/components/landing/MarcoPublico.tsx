"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { getToken } from "@/lib/auth";
import { AvisoCookies, abrirPreferencias, conAnalitica, evento } from "./Analitica";
import { Cabecera, Logo } from "./Cabecera";
import { FormDemo } from "./FormDemo";
import { usePlanes, type PlanPublico } from "./Planes";
import { BotonWhatsApp, BotonWhatsAppFlotante } from "./WhatsApp";

type Marco = {
  planes: PlanPublico[]; pruebaDias: number; cargando: boolean; conSesion: boolean;
  plan: string; setPlan: (p: string) => void;
  /** Abre el pedido de demo (opcional: con un plan ya elegido). */
  pedirDemo: (plan?: string) => void;
};

const Contexto = createContext<Marco | null>(null);

export function useMarco() {
  const m = useContext(Contexto);
  if (!m) throw new Error("useMarco fuera de MarcoPublico");
  return m;
}

const sinSuscripcion = () => () => undefined;

/**
 * Lo común de las páginas públicas (inicio y precios): la cabecera, el pie, la ventana del pedido de demo,
 * WhatsApp y el aviso de cookies. Los planes se piden a la API una vez.
 */
export function MarcoPublico({ actual, children }: { actual: "inicio" | "precios"; children: ReactNode }) {
  const { planes, pruebaDias, cargando } = usePlanes();
  // Con sesión, «Ingresar» lleva al sistema; en el servidor no hay cookie que leer.
  const conSesion = useSyncExternalStore(sinSuscripcion, () => Boolean(getToken()), () => false);
  const [plan, setPlan] = useState("");
  const [modal, setModal] = useState(false);

  // Desplazamiento suave al ir a una sección (menú, «Ver planes»…), solo en las páginas públicas y no para
  // quien pidió menos movimiento en su sistema. Al salir se deja como estaba (el sistema no lo usa).
  useEffect(() => {
    const html = document.documentElement;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) html.style.scrollBehavior = "smooth";
    return () => { html.style.scrollBehavior = ""; };
  }, []);

  function pedirDemo(codigo?: string) {
    if (codigo) setPlan(codigo);
    setModal(true);
    evento("abrir_demo", { plan: codigo, pagina: actual });   // solo si la persona aceptó la analítica
  }

  return (
    <Contexto.Provider value={{ planes, pruebaDias: pruebaDias ?? 14, cargando, conSesion, plan, setPlan, pedirDemo }}>
      <div className="min-h-screen overflow-x-clip bg-bg text-ink">
        <Cabecera conSesion={conSesion} actual={actual} onProbar={() => pedirDemo()} />
        {children}
        <Pie conSesion={conSesion} />
        <BotonWhatsAppFlotante />
        <AvisoCookies />
        {modal && <ModalDemo planes={planes} plan={plan} onPlan={setPlan} onCerrar={() => setModal(false)} />}
      </div>
    </Contexto.Provider>
  );
}

function Pie({ conSesion }: { conSesion: boolean }) {
  return (
    <footer className="bg-[#171210] text-[#e9e1da]">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <span className="text-white"><Logo /></span>
          <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed text-[#e9e1da]/75">El sistema para vender, repartir y facturar en carnicerías, avícolas y distribuidoras de carne del Perú.</p>
          <div className="mt-5"><BotonWhatsApp /></div>
        </div>
        <div>
          <h2 className="text-[13px] font-semibold tracking-[.08em] text-white uppercase">Producto</h2>
          <ul className="mt-4 space-y-2.5 text-[14px] text-[#e9e1da]/75">
            {[["Pedidos por WhatsApp", "/#pedidos"], ["Mostrador con peso variable", "/#mostrador"], ["Reparto con rutas", "/#reparto"], ["Almacén, lotes y despiece", "/#almacen"], ["Boletas, facturas y caja", "/#facturacion"], ["Planes y precios", "/precios"]].map(([t, h]) => (
              <li key={t}><Link href={h} className="hover:text-white">{t}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[13px] font-semibold tracking-[.08em] text-white uppercase">Recursos</h2>
          <ul className="mt-4 space-y-2.5 text-[14px] text-[#e9e1da]/75">
            <li><Link href="/#preguntas" className="hover:text-white">Preguntas frecuentes</Link></li>
            <li><Link href="/#como-funciona" className="hover:text-white">Cómo funciona</Link></li>
            <li><span aria-disabled="true" title="Muy pronto" className="cursor-default text-[#e9e1da]/45">Blog <span className="ml-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-gold">Pronto</span></span></li>
          </ul>
        </div>
        <div>
          <h2 className="text-[13px] font-semibold tracking-[.08em] text-white uppercase">Empresa</h2>
          <ul className="mt-4 space-y-2.5 text-[14px] text-[#e9e1da]/75">
            <li><Link href="/#contacto" className="hover:text-white">Contacto</Link></li>
            <li><Link href={conSesion ? "/inicio" : "/login"} className="hover:text-white">{conSesion ? "Ir a mi sistema" : "Ingresar"}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-5 text-[13px] text-[#e9e1da]/60 sm:px-6">
          <span>© {new Date().getFullYear()} Aycha · Intelectalab</span>
          {conAnalitica && <button type="button" onClick={abrirPreferencias} className="cursor-pointer hover:text-white">Preferencias de cookies</button>}
        </div>
      </div>
    </footer>
  );
}

/** El pedido de demo en una ventana, como en el prototipo: se abre desde «Pruébalo gratis» y «Agenda una demo». */
function ModalDemo({ planes, plan, onPlan, onCerrar }: { planes: PlanPublico[]; plan: string; onPlan: (p: string) => void; onCerrar: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-demo-titulo" onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      onClick={(e) => e.target === e.currentTarget && onCerrar()} className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-[2px]">
      <div className="relative w-full max-w-[520px] overflow-hidden rounded-3xl bg-surface text-ink shadow-[0_30px_80px_rgba(0,0,0,.35)]">
        <div className="flex items-center justify-between bg-[#6e1423] px-6 py-3 text-white">
          <span className="text-[12px] font-semibold tracking-[.08em] text-gold uppercase">Demo en vivo · 20 minutos</span>
          <button type="button" autoFocus onClick={onCerrar} aria-label="Cerrar" className="grid size-8 cursor-pointer place-items-center rounded-full bg-white/10 hover:bg-white/20"><X size={16} /></button>
        </div>
        <div className="p-6 sm:p-7">
          <h2 id="modal-demo-titulo" className="font-display text-[24px] leading-tight font-bold">¿Quieres verlo con tus propios cortes?</h2>
          <p className="mt-1.5 text-[14px] text-muted">Agenda una demo por videollamada o WhatsApp. Te mostramos pedidos, mostrador y reparto con productos como los tuyos.</p>
          <div className="mt-5"><FormDemo planes={planes} plan={plan} onPlan={onPlan} conIntereses /></div>
        </div>
      </div>
    </div>
  );
}
