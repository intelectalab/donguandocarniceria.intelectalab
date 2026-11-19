"use client";

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent as EventoMouse, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2, ChevronDown, CreditCard, Database, Inbox, Layers, Loader2, LogOut, Menu, Moon, ScrollText, Settings2, ShieldCheck, Sun, Users, type LucideIcon,
} from "lucide-react";
import { UiHost } from "@/components/ui";
import { Franja } from "@/components/ui/Franja";
import { SesionConsola } from "@/components/consola/sesion";
import { iniciales } from "@/lib/empresa";
import { apiConsola, clearTokenConsola, type UsuarioConsola } from "@/lib/consola";

type Item = { href: string; label: string; icon: LucideIcon };

// Menú de la consola por grupos, como el del sistema.
const GRUPOS: { name: string; items: Item[] }[] = [
  { name: "Clientes", items: [
    { href: "/consola/empresas", label: "Empresas", icon: Building2 },
    { href: "/consola/suscripciones", label: "Suscripciones", icon: CreditCard },
    { href: "/consola/registros", label: "Registros y demos", icon: Inbox },
  ] },
  { name: "Producto", items: [
    { href: "/consola/planes", label: "Catálogo de planes", icon: Layers },
    { href: "/consola/catalogos", label: "Catálogos globales", icon: Database },
  ] },
  { name: "Plataforma", items: [
    { href: "/consola/usuarios", label: "Usuarios de plataforma", icon: Users },
    { href: "/consola/parametros", label: "Parámetros de plataforma", icon: Settings2 },
    { href: "/consola/bitacora", label: "Bitácora de la consola", icon: ScrollText },
  ] },
];

// Títulos de las páginas que no están en el menú.
const OTRAS: Record<string, [string, string]> = {
  "/consola/empresas/nueva": ["Nueva empresa", "Clientes"],
  "/consola/empresas/ficha": ["Ficha de la empresa", "Clientes"],
};

// Fondo propio de la consola (distinto del vino de las empresas, para que nunca se confundan).
const FONDO = "#1d1418";

// Barra desplegada o en modo íconos: se recuerda en el navegador.
const CLAVE_BARRA = "gc-consola-barra-abierta";

/** Armazón de la consola de Intelectalab: misma estructura que el sistema (barra lateral y cabecera), con colores propios. */
export default function PanelConsola({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const [usuario, setUsuario] = useState<UsuarioConsola | null>(null);
  const [abierta, setAbierta] = useState(true);
  const [movil, setMovil] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    apiConsola<UsuarioConsola>("/yo").then((u) => {
      try {
        if (localStorage.getItem(CLAVE_BARRA) === "false") setAbierta(false);
      } catch {}
      setUsuario(u);
    }).catch(() => router.replace("/consola/ingreso"));
  }, [router]);

  async function salir() {
    setSaliendo(true);
    await apiConsola("/salir", { method: "POST" }).catch(() => {});
    clearTokenConsola();
    router.replace("/consola/ingreso");
  }

  function alternar() {
    if (window.matchMedia("(max-width: 767px)").matches) return setMovil((v) => !v);
    setAbierta((v) => {
      try {
        localStorage.setItem(CLAVE_BARRA, String(!v));
      } catch {}
      return !v;
    });
  }

  if (!usuario) {
    return <div className="grid min-h-screen place-items-center bg-bg text-muted"><Loader2 className="animate-spin" /></div>;
  }

  const actual = GRUPOS.flatMap((g) => g.items.map((i) => ({ ...i, grupo: g.name }))).find((i) => ruta === i.href);
  const [titulo, grupo] = OTRAS[ruta] ?? (actual ? [actual.label, actual.grupo] : ["Consola", ""]);
  const barra = (compacta: boolean) => (
    <BarraLateral compacta={compacta} ruta={ruta} usuario={usuario} saliendo={saliendo} onSalir={salir} onNavegar={() => setMovil(false)} />
  );

  return (
    <SesionConsola.Provider value={usuario}>
      <div className="flex h-screen min-h-0 overflow-hidden bg-bg">
        <aside className={`hidden h-full min-h-0 shrink-0 overflow-visible border-r border-line transition-[width] duration-300 md:block ${abierta ? "w-64" : "w-16"}`}>
          {barra(!abierta)}
        </aside>
        {movil && (
          <div className="fixed inset-0 z-[200] md:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMovil(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 shadow-xl">{barra(false)}</aside>
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Cabecera abierta={abierta || movil} titulo={titulo} grupo={grupo} usuario={usuario} onAlternar={alternar} onSalir={salir} />
          <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">{children}</main>
        </div>
      </div>
      <UiHost />
    </SesionConsola.Provider>
  );
}

function BarraLateral({ compacta, ruta, usuario, saliendo, onSalir, onNavegar }: {
  compacta: boolean; ruta: string; usuario: UsuarioConsola; saliendo: boolean; onSalir: () => void; onNavegar: () => void;
}) {
  const titulo = "px-[22px] pt-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-white/55 uppercase";
  // Barra en íconos: el nombre aparece en una burbuja flotante (fuera del menú, para que su scroll no la corte).
  const [tip, setTip] = useState<{ texto: string; top: number; left: number } | null>(null);
  const mostrar = (texto: string) => (e: EventoMouse<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (!compacta) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ texto, top: r.top + r.height / 2, left: r.right + 10 });
  };
  const ocultar = () => setTip(null);
  return (
    <div className="relative flex h-full flex-col text-white" style={{ background: FONDO }}>
      <Franja className="h-2 w-full shrink-0" />
      <div className={`flex h-14 shrink-0 items-center ${compacta ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary font-display text-[16px] font-extrabold text-primary-ink">G</span>
        {!compacta && (
          <span className="min-w-0">
            <strong className="block truncate font-display text-[15px] leading-tight">Consola</strong>
            <small className="block text-[11px] text-white/60">GestionCarnica · Intelectalab</small>
          </span>
        )}
      </div>

      {!compacta && (
        <div className="mx-3.5 mt-1 mb-2 flex items-center gap-2.5 rounded-[10px] bg-white/[.09] px-3 py-2.5">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-white/70 bg-white/15 text-[12px] font-semibold">
            {iniciales(usuario.full_name)}
            <span title="Sesión activa" className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-[#3DDC84]" style={{ borderColor: FONDO }} />
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-[13px] font-semibold">{usuario.full_name}</strong>
            <small className="block truncate text-[11.5px] text-white/60">{usuario.role_name}</small>
          </div>
        </div>
      )}

      <nav aria-label="Consola" className={`min-h-0 flex-1 overflow-y-auto pb-2.5 [scrollbar-color:rgba(255,255,255,.2)_transparent] [scrollbar-width:thin] ${compacta ? "space-y-1 px-2 pt-1" : ""}`}>
        {GRUPOS.map((g) => (
          <div key={g.name}>
            {!compacta && <div className={titulo}>{g.name}</div>}
            {g.items.map((it) => {
              const activa = ruta === it.href || ruta.startsWith(`${it.href}/`);
              return (
                <Link key={it.href} href={it.href} onClick={() => { ocultar(); onNavegar(); }} aria-current={activa ? "page" : undefined} aria-label={compacta ? it.label : undefined}
                  onMouseEnter={mostrar(it.label)} onMouseLeave={ocultar} onFocus={mostrar(it.label)} onBlur={ocultar}
                  className={`group relative flex w-full items-center text-[13.5px] font-medium transition-colors ${compacta ? "h-10 justify-center rounded-lg" : "gap-3 px-[22px] py-2.5"} ${
                    activa ? "bg-white/[.14] text-white" : "text-white/85 hover:bg-white/[.07] hover:text-white"}`}>
                  {activa && !compacta && <span className="absolute inset-y-0 left-0 w-1 bg-primary" />}
                  <it.icon size={18} strokeWidth={2} className="shrink-0 opacity-90" />
                  {!compacta && <span className="min-w-0 break-words">{it.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={`shrink-0 border-t border-white/[0.12] ${compacta ? "p-2" : "pt-1 pb-2.5"}`}>
        {!compacta && <div className={titulo}>Cuenta</div>}
        <button onClick={onSalir} disabled={saliendo} aria-label={compacta ? "Cerrar sesión" : undefined}
          onMouseEnter={mostrar("Cerrar sesión")} onMouseLeave={ocultar} onFocus={mostrar("Cerrar sesión")} onBlur={ocultar}
          className={`group relative flex w-full cursor-pointer items-center text-[13.5px] font-medium text-white/85 transition-colors hover:bg-white/[.07] hover:text-white disabled:opacity-60 ${compacta ? "h-10 justify-center rounded-lg" : "gap-3 px-[22px] py-2"}`}>
          <LogOut size={18} className="shrink-0 opacity-90" />
          {!compacta && (saliendo ? "Saliendo…" : "Cerrar sesión")}
        </button>
        {!compacta && (
          <div className="mx-3.5 mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-black/[0.25] px-2.5 py-1.5 text-[10.5px] text-white/70">
            <ShieldCheck size={12} /> <span>Consola de plataforma</span>
            <strong className="font-semibold tracking-wide text-white/90">· Intelectalab</strong>
          </div>
        )}
      </div>
      {compacta && tip && <Burbuja {...tip} />}
    </div>
  );
}

const BOTON_ICONO = "relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-primary transition-colors hover:bg-primary-soft active:scale-95";

function Cabecera({ abierta, titulo, grupo, usuario, onAlternar, onSalir }: {
  abierta: boolean; titulo: string; grupo: string; usuario: UsuarioConsola; onAlternar: () => void; onSalir: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  function tema() {
    const actual = document.documentElement.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nuevo = actual === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nuevo;
    try {
      localStorage.setItem("aycha-tema", nuevo);
    } catch {}
  }

  const avatar = (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[12.5px] font-semibold text-primary-ink">{iniciales(usuario.full_name)}</span>
  );
  return (
    <header className="sticky top-0 z-[100] flex h-16 w-full shrink-0 items-center gap-3.5 border-b border-line bg-surface px-3 sm:px-6">
      <button onClick={onAlternar} aria-label={abierta ? "Cerrar menú" : "Abrir menú"} className={BOTON_ICONO}><Menu size={21} /></button>
      <div className="mr-auto min-w-0">
        <nav aria-label="Ruta" className="flex items-center gap-[5px] overflow-hidden text-[11.5px] whitespace-nowrap text-muted">
          <ShieldCheck size={13} className="shrink-0" />
          <span className="truncate">Consola</span>
          {grupo && <><span aria-hidden="true">·</span><span className="truncate">{grupo}</span></>}
        </nav>
        <h1 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{titulo}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <button type="button" onClick={tema} aria-label="Cambiar tema" title="Cambiar tema" className={BOTON_ICONO}>
          <Moon size={19} className="theme-moon-icon" />
          <Sun size={19} className="theme-sun-icon" />
        </button>
        <div className="relative" ref={caja}>
          <button onClick={() => setMenu((v) => !v)} aria-haspopup="true" aria-expanded={menu}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1 pr-1.5 pl-2.5 transition-colors hover:bg-primary-soft">
            <span className="hidden text-right md:grid">
              <strong className="text-[13px] leading-tight font-medium text-ink">{usuario.full_name}</strong>
              <small className="text-[11.5px] leading-tight text-muted">{usuario.role_name}</small>
            </span>
            {avatar}
            <ChevronDown size={15} className={`text-muted transition-transform duration-200 ${menu ? "rotate-180" : ""}`} />
          </button>
          {menu && (
            <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-[110] w-[290px] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
              <div className="flex items-center gap-3 border-b border-line bg-surface-2 p-3.5">
                {avatar}
                <div className="min-w-0">
                  <strong className="block truncate text-[13px] font-semibold text-ink">{usuario.full_name}</strong>
                  <small className="block truncate text-[11.5px] text-muted">{usuario.email}</small>
                  <small className="block truncate text-[11.5px] text-muted">Consola · {usuario.role_name}</small>
                </div>
              </div>
              <button role="menuitem" onClick={() => { setMenu(false); onSalir(); }}
                className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-bad transition-colors hover:bg-surface-2">
                <LogOut size={16} className="shrink-0" /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** Burbuja con el nombre de la opción cuando la barra está en íconos (como la del sistema). */
function Burbuja({ texto, top, left }: { texto: string; top: number; left: number }) {
  return createPortal(
    <span role="tooltip" className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-tooltip px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-tooltip-text shadow-lg" style={{ top, left }}>
      <span className="absolute top-1/2 right-full -translate-y-1/2 border-[5px] border-transparent" style={{ borderRightColor: "var(--tooltip)" }} />
      {texto}
    </span>,
    document.body,
  );
}
