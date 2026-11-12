"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { MapPin, Scale, ShieldCheck, type LucideIcon } from "lucide-react";
import { iniciales, legibleConBlanco, type Empresa } from "@/lib/empresa";
import { Franja } from "@/components/ui/Franja";

/** Estilos de formulario compartidos por las pantallas de ingreso (como erp-saas). */
export const authLabel = "mb-1.5 block text-[12.5px] font-medium text-muted";
export const authInput =
  "min-h-[42px] w-full rounded-[9px] border border-line bg-surface px-3 py-2 pr-[42px] text-[14px] text-ink transition-[border-color,box-shadow] placeholder:text-muted/70 focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)] focus:outline-none";
export const authInputIcon = "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted";
export const authGhostButton =
  "flex h-9 w-full items-center justify-center rounded-[9px] text-[13.5px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink";
export const authButton =
  "flex h-[46px] w-full cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-primary text-[14px] font-semibold text-primary-ink transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
export const authError = "rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad";

export const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

export const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

// Lo que la persona gana, en pocas palabras: los puntos del panel, cada uno con su ícono.
const PUNTOS: { icono: LucideIcon; texto: string }[] = [
  { icono: MapPin, texto: "Ningún pedido se confirma sin dirección con pin" },
  { icono: Scale, texto: "Peso real, lote y vencimiento en cada venta" },
  { icono: ShieldCheck, texto: "Cada empresa ve solo sus datos" },
];

const SUBTITULO = "Ventas, reparto, producción y facturación";
// Lo que hace el sistema, después del «quién» (el general o el de la empresa).
const QUE_HACE = "Pedidos de WhatsApp, web y mostrador, despiece con costo real, cadena de frío, reparto y comprobantes electrónicos en un solo lugar.";

const css = (rgb: number[]) => `rgb(${rgb.map(Math.round).join(" ")})`;

/** Logo de la empresa (solo de la propia API, data: o https) o, sin logo, sus iniciales en el círculo dorado. */
function Sello({ nombre, logo }: { nombre: string; logo: string | null | undefined }) {
  if (logo?.startsWith("/api/v1/tenant/logo") || logo?.startsWith("data:image/") || logo?.startsWith("https://")) {
    return (
      <span className="grid h-12 max-w-[180px] shrink-0 place-items-center rounded-xl bg-white px-2.5 shadow-[0_0_0_4px_rgba(255,198,118,.2)] lg:h-20 lg:max-w-[260px] lg:rounded-2xl lg:px-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo subido por la empresa. */}
        <img src={logo} alt={nombre} className="max-h-9 max-w-[160px] object-contain lg:max-h-14 lg:max-w-[232px]" />
      </span>
    );
  }
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#ffe0a8] to-gold font-display text-[17px] font-extrabold shadow-[0_0_0_4px_rgba(255,198,118,.18),0_10px_30px_rgba(255,198,118,.25)] lg:size-20 lg:text-[28px] lg:shadow-[0_0_0_6px_rgba(255,198,118,.18),0_14px_44px_rgba(255,198,118,.3)]"
      style={{ color: "var(--franja-base)" }}>
      {iniciales(nombre)}
    </span>
  );
}

/**
 * Armazón de las pantallas de ingreso, como el prototipo: a la izquierda el panel de la empresa
 * (color liso, su sello, su nombre, qué hace el sistema y sus marcas; en celular, una franja arriba
 * solo con el sello y el nombre) y a la derecha el formulario en una tarjeta. Con dominio por
 * empresa, el panel lleva su nombre, su logo y su color; en el ingreso general, la marca de Aycha.
 */
export default function AuthShell({ title, subtitle, children, footer, empresa, pending = false }: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  empresa: Empresa | null;
  /** Mientras se consulta la empresa: panel sin textos, para no mostrar otra marca un instante. */
  pending?: boolean;
}) {
  const acento = legibleConBlanco(empresa?.primary_color ?? "#922242");
  // Fondo del panel: el color de la empresa en degradado (más claro arriba, profundo abajo) con un brillo
  // dorado arriba a la derecha y uno rosado abajo a la izquierda.
  const fondo = [
    "radial-gradient(900px 520px at 88% -8%, rgba(255,198,118,.24), transparent 62%)",
    "radial-gradient(760px 620px at -12% 108%, rgba(255,128,160,.16), transparent 60%)",
    `linear-gradient(158deg, ${css(acento.map((v) => v * 0.95))} 0%, ${css(acento.map((v) => v * 0.72))} 48%, ${css(acento.map((v) => v * 0.5))} 100%)`,
  ].join(", ");
  const deEmpresa = empresa?.general === false;
  const nombre = deEmpresa ? (empresa.trade_name ?? empresa.short ?? empresa.name) : "Aycha";
  const marcas = empresa?.brands ?? [];
  const frase = deEmpresa
    ? `${marcas.length > 1 ? `${nombre} y sus ${marcas.length} marcas.` : `Todo ${nombre}, en orden.`} ${QUE_HACE}`
    : `El sistema para empresas cárnicas: carnicerías, avícolas, distribuidoras y plantas de proceso. ${QUE_HACE}`;

  return (
    <div className="grid min-h-screen w-full grid-rows-[auto_1fr] bg-bg lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="relative isolate flex flex-col overflow-hidden px-[22px] pt-7 pb-6 text-white lg:px-[clamp(48px,6vw,104px)] lg:py-12" style={{ background: fondo }}>
        <Franja className="absolute inset-x-0 top-0 z-10 h-2 w-full" />
        {/* Trama de puntos suave que se desvanece hacia los bordes, y dos luces difusas para dar profundidad. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-80"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,.10) 1px, transparent 1.3px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(ellipse 70% 60% at 35% 45%, #000 15%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 35% 45%, #000 15%, transparent 75%)",
          }} />
        <span aria-hidden="true" className="pointer-events-none absolute -top-32 -right-24 -z-10 hidden size-[440px] rounded-full bg-[rgba(255,198,118,.22)] blur-[110px] lg:block" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-40 left-[10%] -z-10 hidden size-[420px] rounded-full bg-[rgba(255,110,150,.16)] blur-[120px] lg:block" />

        {/* En escritorio, el contenido va centrado en el alto del panel y crece con la pantalla. */}
        <div className="relative flex flex-col gap-4 lg:my-auto lg:max-w-[min(780px,100%)] lg:gap-[clamp(26px,2.4vw,40px)]">
          {pending ? <span className="h-16 lg:h-20" /> : (
            <>
              <div className="flex items-center gap-4 lg:block">
                <Sello nombre={nombre} logo={deEmpresa ? empresa.logo_url : null} />
                <div className="min-w-0 lg:mt-7">
                  <h1 className="font-display text-[26px] leading-none font-bold tracking-[-0.02em] text-white lg:text-[clamp(2.7rem,4.4vw,5.2rem)] lg:drop-shadow-[0_2px_18px_rgba(0,0,0,.18)]">{nombre}</h1>
                  <p className="mt-2 flex items-center gap-3 text-[11px] font-semibold tracking-[.14em] text-gold uppercase lg:mt-4 lg:text-[clamp(12.5px,0.85vw,16px)]">
                    <span aria-hidden="true" className="hidden h-px w-10 bg-gold/70 lg:block" />
                    {SUBTITULO}
                  </p>
                </div>
              </div>

              <p className="hidden max-w-[48ch] text-[clamp(17px,1.3vw,24px)] leading-[1.6] text-white/90 lg:block">{frase}</p>

              <ul className="hidden gap-3 lg:grid xl:grid-cols-3">
                {PUNTOS.map(({ icono: Icono, texto }) => (
                  <li key={texto} className="flex items-start gap-3 rounded-2xl border border-white/[.14] bg-white/[.07] p-4 shadow-[0_8px_24px_rgba(0,0,0,.12)] backdrop-blur-sm xl:flex-col">
                    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold ring-1 ring-gold/30">
                      <Icono size={18} />
                    </span>
                    <span className="text-[clamp(14.5px,0.95vw,17px)] leading-snug text-white/95">{texto}</span>
                  </li>
                ))}
              </ul>

              {marcas.length > 1 && (
                <ul className="hidden flex-wrap gap-2 lg:flex" aria-label="Marcas">
                  {marcas.map((b) => (
                    <li key={b.code} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.07] px-3 py-1 text-[13px]">
                      <span className="size-2.5 rounded-full ring-1 ring-white/60" style={{ background: b.primary_color }} />
                      {b.name}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <p className="relative hidden pt-6 text-[12.5px] text-white/60 lg:block">
          Aycha by Intelectalab{deEmpresa && !pending ? ` · ${empresa.name}` : ""} · © {new Date().getFullYear()}
        </p>
      </aside>

      <main className="relative isolate flex flex-col items-center justify-center gap-[18px] px-4 pt-8 pb-6 sm:px-6">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: "radial-gradient(620px 420px at 50% 42%, var(--primary-soft), transparent 70%)" }} />
        <motion.div className="my-auto w-full max-w-[440px] rounded-[14px] border border-line bg-surface p-6 shadow-[0_12px_34px_rgba(40,8,18,.10)] sm:p-8"
          variants={container} initial="hidden" animate="show">
          <motion.div variants={item}>
            <h2 className="text-[24px] font-bold tracking-[-0.01em] text-ink">{title}</h2>
            <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
          </motion.div>

          <div className="mt-[18px]">{children}</div>

          {footer && (
            <motion.p variants={item} className="mt-3.5 text-[12.5px] text-muted">
              {footer}
            </motion.p>
          )}
        </motion.div>

        <p className="text-[12px] text-muted lg:hidden">Aycha by Intelectalab</p>
      </main>
    </div>
  );
}
