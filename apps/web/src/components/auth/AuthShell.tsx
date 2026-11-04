"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { ClipboardCheck, Truck, Receipt } from "lucide-react";
import { iniciales, legibleConBlanco, type Empresa } from "@/lib/empresa";

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

const FUNCIONES = [
  { icon: ClipboardCheck, title: "Pedidos completos", text: "Ninguno se confirma sin dirección con pin" },
  { icon: Truck, title: "Reparto con costo real", text: "Rutas, cobro contra entrega y entregas" },
  { icon: Receipt, title: "Comprobantes y caja", text: "SUNAT, cobros y conciliación al día" },
];

const css = (rgb: number[]) => `rgb(${rgb.map(Math.round).join(" ")})`;

/** Logo de la empresa o, sin logo, sus iniciales y su nombre. */
function LogoEmpresa({ empresa }: { empresa: Empresa }) {
  const nombre = empresa.trade_name ?? empresa.short;
  if (empresa.logo_url?.startsWith("data:") || empresa.logo_url?.startsWith("http")) {
    // eslint-disable-next-line @next/next/no-img-element -- logo subido por la empresa.
    return <img src={empresa.logo_url} alt={nombre} className="max-h-14 max-w-[220px] object-contain object-left" />;
  }
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-11 place-items-center rounded-xl bg-primary text-[15px] font-bold text-primary-ink">{iniciales(nombre)}</span>
      <strong className="font-display text-[17px] font-semibold text-ink">{nombre}</strong>
    </span>
  );
}

/**
 * Armazón de las pantallas de ingreso: panel a la izquierda (franja superior en celular) y el
 * formulario a la derecha. Con empresa (dominio por empresa), el panel lleva su nombre y su color;
 * en el ingreso general, la marca de Aycha.
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
  const panel = `linear-gradient(150deg, ${css(acento)} 0%, ${css(acento.map((v) => v * 0.8))} 45%, ${css(acento.map((v) => v * 0.6))} 100%)`;
  const marcas = empresa?.brands ?? [];

  return (
    <div className="grid min-h-screen w-full grid-rows-[auto_1fr] bg-bg lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:grid-rows-1">
      <aside
        className="relative flex flex-col justify-between gap-4 overflow-hidden px-[22px] py-[26px] text-white lg:gap-8 lg:px-12 lg:py-10"
        style={{
          background: [
            "radial-gradient(circle at 80% 15%, rgba(255,198,118,.28), transparent 40%)",
            "radial-gradient(circle at 10% 90%, rgba(255,255,255,.10), transparent 45%)",
            "repeating-linear-gradient(135deg, rgba(255,255,255,.04) 0 2px, transparent 2px 22px)",
            panel,
          ].join(", "),
        }}
      >
        {pending ? <span className="h-5" /> : (
          <span className="text-[13px] font-semibold tracking-[.08em] text-white/80 uppercase">
            {empresa?.general === false ? "Acceso de la empresa" : "Plataforma Aycha · Intelectalab"}
          </span>
        )}

        {pending ? <span /> : (
          <div>
            <h1 className="max-w-[18ch] text-[24px] leading-[1.12] font-bold tracking-[-0.02em] lg:text-[clamp(28px,3.2vw,40px)]">
              {empresa?.name ?? "Aycha Comercial"}
            </h1>
            <p className="mt-3.5 hidden max-w-[46ch] text-[14.5px] leading-relaxed text-white/90 lg:block">
              {empresa?.general === false
                ? "Pedidos de WhatsApp, web y redes, preparación, reparto, comprobantes y caja en un solo lugar."
                : "Para empresas de carnes y alimentos: pedidos de WhatsApp, web y redes, preparación, reparto, comprobantes y caja en un solo lugar."}
            </p>

            <div className="mt-6 hidden max-w-[620px] grid-cols-3 gap-3 lg:grid">
              {FUNCIONES.map(({ icon: Icon, title: t, text }) => (
                <div key={t} className="rounded-xl border border-white/20 bg-white/[.07] p-3 text-[12px] leading-[1.35]">
                  <Icon size={20} className="mb-1.5 text-gold" />
                  <strong className="block text-[12.5px]">{t}</strong>
                  <span className="text-white/85">{text}</span>
                </div>
              ))}
            </div>

            {marcas.length > 1 && (
              <ul className="mt-6 hidden flex-wrap gap-2 lg:flex">
                {marcas.map((b) => (
                  <li key={b.code} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[12px]">
                    <span className="size-2.5 rounded-full ring-1 ring-white/60" style={{ background: b.primary_color }} />
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="hidden text-[12px] text-white/70 lg:block">
          {pending ? " " : `© ${new Date().getFullYear()} · ${empresa?.name ?? "Aycha"}`}
        </p>
      </aside>

      <main className="flex flex-col items-center justify-center gap-[18px] px-6 pt-10 pb-6">
        <motion.div className="my-auto w-full max-w-[400px]" variants={container} initial="hidden" animate="show">
          <motion.div variants={item} className="mb-7">
            {pending || !empresa ? <span className="block h-11" /> : <LogoEmpresa empresa={empresa} />}
          </motion.div>

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

        <p className="text-[12px] text-muted">Aycha by Intelectalab</p>
      </main>
    </div>
  );
}
