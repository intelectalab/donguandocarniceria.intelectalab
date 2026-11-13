"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Cookie } from "lucide-react";

// Google Analytics en la página pública, solo con permiso (ley peruana de protección de datos):
//  - El ID sale de NEXT_PUBLIC_GA_ID (G-XXXXXXXXXX). Sin él no hay aviso ni código de Google.
//  - Nada se carga ni se manda a Google hasta que la persona acepta. «Solo necesarias» no carga nada.
//  - La elección se recuerda en este navegador y se puede cambiar desde el pie («Preferencias de cookies»).
//  - Solo en la página pública: el sistema (pantallas internas, clientes, pedidos) nunca lo carga.
//  - Los eventos llevan solo datos generales (qué plan, qué rubro), nunca lo que la persona escribe.

const ID = (process.env.NEXT_PUBLIC_GA_ID ?? "").trim().toUpperCase();
export const conAnalitica = /^G-[A-Z0-9]{4,15}$/.test(ID);

const CLAVE = "aycha-cookies";
const EVENTO_CAMBIO = "aycha-cookies-cambio";
type Eleccion = "todas" | "necesarias" | null;

function leer(): Eleccion {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === "todas" || v === "necesarias" ? v : null;
  } catch {
    return null;
  }
}

function guardar(v: Exclude<Eleccion, null> | null) {
  try {
    if (v) localStorage.setItem(CLAVE, v); else localStorage.removeItem(CLAVE);
  } catch {
    // sin almacenamiento: vale mientras la página esté abierta
  }
  window.dispatchEvent(new Event(EVENTO_CAMBIO));
}

const suscribir = (fn: () => void) => {
  window.addEventListener(EVENTO_CAMBIO, fn);
  window.addEventListener("storage", fn);
  return () => { window.removeEventListener(EVENTO_CAMBIO, fn); window.removeEventListener("storage", fn); };
};

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag }
}

let cargado = false;

/** Carga Google Analytics una sola vez (solo después de aceptar). Sin anuncios ni señales de publicidad. */
function cargar() {
  if (cargado || !conAnalitica) return;
  cargado = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() { window.dataLayer!.push(arguments); } as Gtag; // eslint-disable-line prefer-rest-params
  window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
  window.gtag("js", new Date());
  window.gtag("config", ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
  document.head.appendChild(s);
}

/** Registra un evento si la persona aceptó la analítica; si no, no hace nada. Solo datos generales. */
export function evento(nombre: string, datos: Record<string, string | number | undefined> = {}) {
  if (!conAnalitica || leer() !== "todas" || !window.gtag) return;
  window.gtag("event", nombre, Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined && v !== "")));
}

/** Vuelve a mostrar el aviso para cambiar la elección (enlace del pie). */
export function abrirPreferencias() {
  guardar(null);
}

/** El aviso de cookies, abajo de la página. Solo si hay ID de Google Analytics y la persona aún no eligió. */
export function AvisoCookies() {
  const eleccion = useSyncExternalStore(suscribir, leer, () => "necesarias" as Eleccion);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    if (eleccion === "todas") cargar();
  }, [eleccion]);
  useEffect(() => { const t = setTimeout(() => setListo(true), 400); return () => clearTimeout(t); }, []);

  if (!conAnalitica || eleccion !== null || !listo) return null;
  return (
    <div role="region" aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 shadow-[0_-8px_30px_rgba(40,8,18,.10)] backdrop-blur">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Cookie size={18} className="shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13.5px] text-ink">
          Usamos cookies para medir las visitas y mejorar la página. Solo se activan si aceptas.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => guardar("necesarias")} className="cursor-pointer rounded-lg px-3 py-2 text-[13.5px] font-medium text-ink hover:bg-surface-2">
            Solo necesarias
          </button>
          <button type="button" onClick={() => guardar("todas")} className="cursor-pointer rounded-lg bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-ink hover:brightness-110">
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
