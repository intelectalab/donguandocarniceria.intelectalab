"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { Building2, ChevronRight, Layers, Lock, LogOut, UserRound, X } from "lucide-react";
import { iniciales } from "@/lib/empresa";

type MenuIcon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export type MenuItem = {
  href: string;
  label: string;
  /** Código del módulo (PED, CAJ…), para el buscador y las migas. */
  code?: string;
  group: string;
  /** Módulo apagado para la empresa (RN-PLT-07): sale con candado y no navega. */
  locked?: boolean;
  /** Pantallas del módulo que ve el rol (tercer nivel del menú). */
  children?: { href: string; label: string; code: string }[];
};

type SidebarProps = {
  items: MenuItem[];
  compact?: boolean;
  loading: boolean;
  onNavigate: () => void;
  onLogout: () => void;
  loggingOut: boolean;
  /** Ícono de cada grupo del menú. */
  groupIcons: Record<string, MenuIcon>;
  user?: { name: string; role?: string } | null;
  tenantName?: string;
  /** Imagen del logo del cliente (URL local); sin ella, sus iniciales. */
  tenantLogo?: string | null;
  /** Selectores de marca y local, bajo la empresa (solo con la barra desplegada). */
  context?: ReactNode;
  /** Abre Plataforma → Módulos desde el aviso de módulo apagado (solo si el rol puede encenderlo). */
  modulesHref?: string | null;
};

// Grupos que la persona dejó plegados (true) o desplegados (false). Se recuerda en su navegador;
// todas las barras abiertas (escritorio, celular, otra pestaña) leen lo mismo.
const GROUPS_KEY = "aycha-sidebar-grupos";
const GROUPS_EVENT = "aycha-sidebar-grupos-cambio";

function subscribeToGroups(onChange: () => void) {
  window.addEventListener(GROUPS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(GROUPS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Si el navegador no deja guardar, el menú se sigue abriendo y cerrando; solo no se recuerda.
const unsavedGroups: { text: string | null } = { text: null };

function storedGroupsText() {
  if (unsavedGroups.text !== null) return unsavedGroups.text;
  try {
    return window.localStorage.getItem(GROUPS_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function saveGroups(text: string) {
  try {
    window.localStorage.setItem(GROUPS_KEY, text);
    unsavedGroups.text = null;
  } catch {
    unsavedGroups.text = text;
  }
  window.dispatchEvent(new Event(GROUPS_EVENT));
}

function parseGroups(text: string): Record<string, boolean> {
  try {
    const stored: unknown = JSON.parse(text);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

// Los nombres largos del menú no se cortan con "…": pasan a la línea siguiente.
const WRAP = "min-w-0 leading-snug [overflow-wrap:anywhere]";

function LockBadge() {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 rounded-[5px] bg-white/15 px-1.5 text-[10px] leading-[18px] font-semibold text-white">
      <Lock size={10} />
      Apagado
    </span>
  );
}

function Tooltip({ top, left, children }: { top: number; left: number; children: ReactNode }) {
  return createPortal(
    <span className="pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-tooltip px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-tooltip-text shadow-lg" style={{ top, left }}>
      <span className="absolute top-1/2 right-full -translate-y-1/2 border-[5px] border-transparent" style={{ borderRightColor: "var(--tooltip)" }} />
      {children}
    </span>,
    document.body,
  );
}

export default function Sidebar({
  items, compact = false, loading, onNavigate, onLogout, loggingOut, groupIcons, user, tenantName, tenantLogo, context, modulesHref,
}: SidebarProps) {
  const pathname = usePathname();
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);
  const [apagado, setApagado] = useState<string | null>(null);
  // Modo íconos: grupo cuyo panel de pantallas está abierto junto a su ícono.
  const [flyout, setFlyout] = useState<{ group: string; left: number; top?: number; bottom?: number } | null>(null);
  const flyoutPanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!flyout) return;
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!flyoutPanel.current?.contains(target) && !target.closest("[data-group-icon]")) setFlyout(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFlyout(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [flyout]);

  // Al desplegar la barra, el panel del modo íconos ya no aplica.
  const openFlyout = compact ? flyout : null;

  function toggleFlyout(event: { currentTarget: HTMLElement }, group: string) {
    if (flyout?.group === group) {
      setFlyout(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // En la mitad inferior de la pantalla el panel crece hacia arriba para no salirse.
    const below = rect.top < window.innerHeight / 2;
    setTooltip(null);
    setFlyout({
      group,
      left: rect.right + 10,
      ...(below ? { top: Math.max(8, rect.top - 6) } : { bottom: Math.max(8, window.innerHeight - rect.bottom - 6) }),
    });
  }

  const isActive = (href: string) => pathname === href || Boolean(pathname?.startsWith(`${href}/`));

  const grouped = useMemo(() => {
    const acc: Record<string, MenuItem[]> = {};
    for (const it of items) (acc[it.group] ??= []).push(it);
    return acc;
  }, [items]);

  // Plegados por defecto, salvo el grupo de la pantalla abierta; lo que la persona abrió o
  // cerró a mano manda. En el servidor no hay nada guardado: el navegador lo ajusta al cargar.
  const storedText = useSyncExternalStore(subscribeToGroups, storedGroupsText, () => "{}");
  const stored = useMemo(() => parseGroups(storedText), [storedText]);
  const activeGroup = items.find((it) => isActive(it.href))?.group;
  const isCollapsed = (group: string) => stored[group] ?? group !== activeGroup;
  const toggleGroup = (group: string) => saveGroups(JSON.stringify({ ...parseGroups(storedGroupsText()), [group]: !isCollapsed(group) }));
  // Módulos: plegados salvo el de la pantalla abierta (misma memoria que los grupos, clave «mod:PED»).
  const isModuleCollapsed = (it: MenuItem) => stored[`mod:${it.code}`] ?? !isActive(it.href);
  const toggleModule = (it: MenuItem) =>
    saveGroups(JSON.stringify({ ...parseGroups(storedGroupsText()), [`mod:${it.code}`]: !isModuleCollapsed(it) }));

  function showTooltip(event: { currentTarget: HTMLElement }, label: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 12 });
  }

  /** Un módulo: fila que se despliega (o candado si está apagado) y, debajo, sus pantallas. */
  function itemLink(it: MenuItem, inFlyout: boolean) {
    const active = isActive(it.href);
    const collapsed = isModuleCollapsed(it);
    const pad = inFlyout ? "px-4" : "pr-[18px] pl-[52px]";
    return (
      <div key={it.href}>
        <button
          type="button"
          role={inFlyout ? "menuitem" : undefined}
          onClick={() => (it.locked ? (setFlyout(null), setApagado(it.label)) : toggleModule(it))}
          aria-expanded={it.locked ? undefined : !collapsed}
          className={`relative flex w-full cursor-pointer items-center gap-2 py-2 text-left text-[12.8px] transition-colors hover:bg-white/[.07] ${pad} ${
            active ? "font-semibold text-white" : it.locked ? "text-white/60 hover:text-white" : "text-white/80 hover:text-white"
          }`}
        >
          <span className={WRAP}>{it.label}</span>
          {it.locked ? <LockBadge /> : (
            <ChevronRight size={13} className={`ml-auto shrink-0 opacity-70 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`} />
          )}
        </button>
        {!it.locked && !collapsed && (
          <div className="pb-1">
            {(it.children ?? []).map((p) => {
              const on = pathname === p.href;
              return (
                <Link key={p.href} href={p.href} role={inFlyout ? "menuitem" : undefined} title={p.code}
                  onClick={() => { setFlyout(null); onNavigate(); }} aria-current={on ? "page" : undefined}
                  className={`relative flex items-center gap-2 py-1.5 text-[12.3px] transition-colors ${inFlyout ? "pr-4 pl-7" : "pr-[18px] pl-[64px]"} ${
                    on ? "bg-[var(--side-active)] font-semibold text-white" : "text-white/70 hover:text-white"
                  }`}>
                  {on && <span className="absolute inset-y-0 left-0 w-1 bg-white" />}
                  <span className={WRAP}>{p.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col text-white" style={{ background: "var(--side-bg)" }}>
      <span aria-hidden="true" className="franja h-2 w-full shrink-0" />
      <div className={`flex h-14 shrink-0 items-center ${compact ? "justify-center px-2" : "gap-2.5 px-5"}`}>
        {tenantLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo subido por el cliente (URL local del navegador).
          <img src={tenantLogo} alt={tenantName ?? "Logo"} className="size-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold font-display text-[13px] font-extrabold text-[#6d102b]">
            {iniciales(tenantName ?? "Aycha")}
          </span>
        )}
        {!compact && (
          <span className="min-w-0">
            <strong className="block truncate font-display text-[15px] leading-tight">{tenantName ?? "Aycha"}</strong>
            <small className="block text-[11px] text-white/60">Comercial</small>
          </span>
        )}
      </div>

      {!compact && user && (
        <div className="relative mx-3.5 mt-1 mb-2 flex items-center gap-2.5 rounded-[10px] bg-white/[.09] px-3 py-2.5">
          <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-white/70 bg-white/15 text-[12px] font-semibold">
            {iniciales(user.name)}
            <span title="Sesión activa" className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 bg-[#3DDC84]" style={{ borderColor: "var(--side-ring)" }} />
          </span>
          <div className="min-w-0">
            <strong className="block truncate text-[13px] font-semibold">{user.name}</strong>
            {user.role && <small className="block truncate text-[11.5px] text-white/60">{user.role}</small>}
          </div>
        </div>
      )}

      {!compact && tenantName && (
        <div title="Empresa de tu usuario: solo ves sus datos" className="mx-4 mb-1.5 flex items-center gap-1.5 text-[11.5px] text-white/60">
          <Building2 size={13} className="shrink-0" />
          <span className="truncate">{tenantName}</span>
        </div>
      )}

      {!compact && context && <div className="mx-3.5 mb-1 grid gap-1.5">{context}</div>}

      {!compact && <div className="px-[22px] pt-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-white/55 uppercase">Menú</div>}

      <nav
        className={`min-h-0 flex-1 overflow-y-auto pb-2.5 [scrollbar-color:rgba(255,255,255,.2)_transparent] [scrollbar-width:thin] ${compact ? "space-y-1 px-2 pt-1" : ""}`}
        aria-label="Navegación principal"
        onScroll={() => {
          setTooltip(null);
          setFlyout(null);
        }}
      >
        {loading ? (
          /* Esqueleto de carga: evita el parpadeo y los saltos visuales */
          <div className={`space-y-3 pt-2 ${compact ? "" : "px-[22px]"}`}>
            {[1, 2, 3, 4].map((n) => <div key={n} className="h-8 w-full animate-pulse rounded-lg bg-white/15" />)}
          </div>
        ) : (
          Object.entries(grouped).map(([group, groupItems]) => {
            const GroupIcon = groupIcons[group] ?? Layers;
            const hasActive = groupItems.some((it) => isActive(it.href));
            // Un solo enlace en el grupo (Inicio): sin plegar.
            const single = groupItems.length === 1 && groupItems[0].label === group;

            if (compact) {
              const open = openFlyout?.group === group;
              const onIcon = single
                ? undefined
                : (event: React.MouseEvent<HTMLButtonElement>) => toggleFlyout(event, group);
              const className = `relative flex h-10 w-full cursor-pointer items-center justify-center rounded-lg transition-colors ${
                hasActive || open ? "bg-[var(--side-group-active)] text-white" : "text-white/85 hover:bg-white/10 hover:text-white"
              }`;
              const content = (
                <>
                  {hasActive && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-white" />}
                  <GroupIcon size={18} strokeWidth={2} />
                </>
              );
              const tip = {
                onMouseEnter: (e: React.MouseEvent<HTMLElement>) => !openFlyout && showTooltip(e, group),
                onMouseLeave: () => setTooltip(null),
                onFocus: (e: React.FocusEvent<HTMLElement>) => !openFlyout && showTooltip(e, group),
                onBlur: () => setTooltip(null),
              };
              return single ? (
                <Link key={group} href={groupItems[0].href} onClick={onNavigate} aria-label={group} className={className} {...tip}>{content}</Link>
              ) : (
                <button key={group} type="button" data-group-icon onClick={onIcon} aria-label={group} aria-haspopup="menu" aria-expanded={open} className={className} {...tip}>
                  {content}
                </button>
              );
            }

            if (single) {
              const it = groupItems[0];
              const active = isActive(it.href);
              return (
                <Link key={group} href={it.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={`relative flex w-full items-center gap-3 px-[22px] py-2.5 text-[13.5px] font-medium transition-colors ${active ? "bg-[var(--side-active)] text-white" : "text-white/85 hover:bg-white/[.07] hover:text-white"}`}>
                  {active && <span className="absolute inset-y-0 left-0 w-1 bg-white" />}
                  <GroupIcon size={18} strokeWidth={2} className="shrink-0 opacity-90" />
                  <span className={WRAP}>{group}</span>
                </Link>
              );
            }

            const collapsed = isCollapsed(group);
            return (
              <div key={group}>
                <button
                  onClick={() => toggleGroup(group)}
                  aria-expanded={!collapsed}
                  className={`flex w-full cursor-pointer items-center gap-3 px-[22px] py-2.5 text-left text-[13.5px] font-medium transition-colors hover:bg-white/[.07] hover:text-white ${hasActive ? "text-white" : "text-white/85"}`}
                >
                  <GroupIcon size={18} strokeWidth={2} className="shrink-0 opacity-90" />
                  <span className={WRAP}>{group}</span>
                  <ChevronRight size={15} className={`ml-auto shrink-0 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`} />
                </button>
                {!collapsed && <div className="bg-black/[0.14] py-1">{groupItems.map((it) => itemLink(it, false))}</div>}
              </div>
            );
          })
        )}

        {!loading && items.length === 0 && <p className="px-[22px] py-2 text-sm text-white/70">No hay módulos disponibles.</p>}
      </nav>

      {openFlyout && createPortal(
        <div ref={flyoutPanel} role="menu" aria-label={openFlyout.group}
          className="fixed z-50 flex max-h-[80vh] w-[236px] flex-col overflow-hidden rounded-[10px] text-white shadow-[0_14px_34px_rgba(40,8,18,.35)]"
          style={{ left: openFlyout.left, top: openFlyout.top, bottom: openFlyout.bottom, background: "var(--side-flyout)" }}>
          <div className="px-4 pt-3 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-white/60 uppercase">{openFlyout.group}</div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-1.5 [scrollbar-color:rgba(255,255,255,.2)_transparent] [scrollbar-width:thin]">
            {(grouped[openFlyout.group] ?? []).map((it) => itemLink(it, true))}
          </div>
        </div>,
        document.body,
      )}

      {compact && tooltip && !openFlyout && <Tooltip top={tooltip.top} left={tooltip.left}>{tooltip.label}</Tooltip>}

      {apagado && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Módulo apagado"
          onClick={(event) => event.target === event.currentTarget && setApagado(null)}
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--overlay)] p-4">
          <div className="relative w-full max-w-md space-y-5 rounded-2xl border border-line bg-surface p-6 text-ink shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
            <button type="button" aria-label="Cerrar" onClick={() => setApagado(null)}
              className="absolute top-4 right-4 cursor-pointer rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
              <X size={18} />
            </button>
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary"><Lock size={22} /></div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold">Módulo apagado</h3>
              <p className="text-[13px] leading-relaxed text-muted">
                <strong className="text-ink">{apagado}</strong> está incluido, pero apagado para tu empresa (RN-PLT-07).
                El administrador del sistema puede encenderlo en Plataforma → Módulos.
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setApagado(null)}
                className="flex-1 cursor-pointer rounded-[9px] border border-line bg-surface py-2.5 text-[13px] font-medium hover:border-primary hover:bg-surface-2">
                Entendido
              </button>
              {modulesHref && (
                <Link href={modulesHref} onClick={() => { setApagado(null); onNavigate(); }}
                  className="flex-1 rounded-[9px] bg-primary py-2.5 text-center text-[13px] font-semibold text-primary-ink hover:brightness-110">
                  Ir a Plataforma
                </Link>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      <div className={`shrink-0 border-t border-white/[0.12] ${compact ? "p-2" : "pt-1 pb-2.5"}`}>
        {!compact && <div className="px-[22px] pt-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.1em] text-white/55 uppercase">Cuenta</div>}
        <Link href="/perfil" onClick={onNavigate} aria-label={compact ? "Mi perfil" : undefined} aria-current={isActive("/perfil") ? "page" : undefined}
          className={`group relative flex w-full items-center text-[13.5px] font-medium transition-colors hover:text-white ${compact ? "h-10 justify-center rounded-lg" : "gap-3 px-[22px] py-2"} ${
            isActive("/perfil") ? "bg-[var(--side-active)] text-white" : "text-white/85 hover:bg-white/[.07]"}`}>
          {isActive("/perfil") && !compact && <span className="absolute inset-y-0 left-0 w-1 bg-white" />}
          <UserRound size={18} className="shrink-0 opacity-90" />
          {!compact && "Mi perfil"}
          {compact && <HoverTip>Mi perfil</HoverTip>}
        </Link>
        <button onClick={onLogout} disabled={loggingOut} aria-label={compact ? "Salir" : undefined}
          className={`group relative flex w-full cursor-pointer items-center text-[13.5px] font-medium text-white/85 transition-colors hover:bg-white/[.07] hover:text-white disabled:opacity-60 ${compact ? "h-10 justify-center rounded-lg" : "gap-3 px-[22px] py-2"}`}>
          <LogOut size={18} className="shrink-0 opacity-90" />
          {!compact && (loggingOut ? "Saliendo…" : "Salir")}
          {compact && <HoverTip>Salir</HoverTip>}
        </button>
        {!compact && (
          <div className="mx-3.5 mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-black/[0.16] px-2.5 py-1.5 text-[10.5px] text-white/70">
            <span>Powered by</span>
            <strong className="font-semibold tracking-wide text-white/90">Aycha · Intelectalab</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function HoverTip({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none invisible absolute top-1/2 left-full z-50 ml-3 -translate-x-2 -translate-y-1/2 rounded-lg bg-tooltip px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-tooltip-text opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100">
      <span className="absolute top-1/2 right-full -translate-y-1/2 border-[5px] border-transparent" style={{ borderRightColor: "var(--tooltip)" }} />
      {children}
    </span>
  );
}
