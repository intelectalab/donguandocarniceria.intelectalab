"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Home, KeyRound, LogOut, Menu, Moon, RotateCcw, Sun, User as UserIcon } from "lucide-react";
import GlobalSearch, { type SearchScreen } from "./GlobalSearch";
import ChangePasswordModal from "./ChangePasswordModal";
import { api } from "@/lib/api";
import NotificationBell from "./NotificationBell";
import { iniciales } from "@/lib/empresa";

export type UserProfile = { name: string; email?: string; role?: string };

type HeaderProps = {
  open: boolean;
  currentSection: string;
  /** Migas después de la empresa: grupo y módulo de la pantalla actual. */
  crumbs?: string[];
  onToggle: () => void;
  user?: UserProfile | null;
  onLogout: () => void;
  tenantName?: string;
  screens: SearchScreen[];
  /** Sin sesión todavía: sin buscador, campana ni menú. */
  ready: boolean;
  /** Módulos del día a día de la persona (los de su menú corto), para las notificaciones importantes. */
  modulosDelDia?: string[];
};

// Botón de ícono de la barra: color de la marca, igual en tema claro y oscuro.
const ICON_BUTTON =
  "relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-primary transition-colors hover:bg-primary-soft active:scale-95";

export default function Header({ open, currentSection, crumbs = [], onToggle, user, onLogout, tenantName, screens, ready, modulosDelDia = [] }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const userName = user?.name ?? "Usuario";
  const userRole = user?.role ?? "";
  const avatar = (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-[12.5px] font-semibold text-primary-ink">
      {iniciales(userName)}
    </span>
  );

  // Cerrar el menú al hacer clic fuera o con Escape.
  useEffect(() => {
    const onDown = (event: MouseEvent) => dropdownRef.current && !dropdownRef.current.contains(event.target as Node) && setMenuOpen(false);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function toggleTheme() {
    const actual = document.documentElement.dataset.theme
      ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const nuevo = actual === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nuevo;
    try {
      localStorage.setItem("aycha-tema", nuevo);
    } catch {}
    // También en la cuenta (SEG-06), para que el modo siga a la persona en otros equipos.
    api("/v1/seg/mi-cuenta/preferencias", { method: "PUT", body: { ui_theme_mode: nuevo === "dark" ? "DARK" : "LIGHT" } }).catch(() => {});
  }

  const menuItem = "flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink transition-colors hover:bg-surface-2";

  return (
    <header className="sticky top-0 z-[100] flex h-16 w-full shrink-0 items-center gap-3.5 border-b border-line bg-surface px-3 sm:px-6">
      <button onClick={onToggle} aria-label={open ? "Cerrar menú" : "Abrir menú"} className={ICON_BUTTON}>
        <Menu size={21} />
      </button>

      <div className="mr-auto min-w-0">
        <nav aria-label="Ruta" className="flex items-center gap-[5px] overflow-hidden text-[11.5px] whitespace-nowrap text-muted">
          <Home size={13} className="shrink-0" />
          <span className="truncate">{tenantName ?? "Aycha"}</span>
          {/* La clave es la posición: un grupo y su módulo pueden llamarse igual («Plataforma»). */}
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-[5px]">
              <span aria-hidden="true">·</span>
              <span className="truncate">{c}</span>
            </span>
          ))}
        </nav>
        <h1 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{currentSection}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        {ready && <GlobalSearch screens={screens} />}

        <button type="button" onClick={toggleTheme} aria-label="Cambiar tema" title="Cambiar tema" className={ICON_BUTTON}>
          <Moon size={19} className="theme-moon-icon" />
          <Sun size={19} className="theme-sun-icon" />
        </button>

        {ready && <NotificationBell className={ICON_BUTTON} modulosDelDia={modulosDelDia} />}

        {ready && (
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setMenuOpen((v) => !v)} aria-haspopup="true" aria-expanded={menuOpen}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl py-1 pr-1.5 pl-2.5 transition-colors hover:bg-primary-soft">
              <span className="hidden text-right md:grid">
                <strong className="text-[13px] leading-tight font-medium text-ink">{userName}</strong>
                <small className="text-[11.5px] leading-tight text-muted">{userRole}</small>
              </span>
              {avatar}
              <ChevronDown size={15} className={`text-muted transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`} />
            </button>

            {menuOpen && (
              <div role="menu" className="absolute top-[calc(100%+8px)] right-0 z-[110] w-[290px] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
                <div className="flex items-center gap-3 border-b border-line bg-surface-2 p-3.5">
                  {avatar}
                  <div className="min-w-0">
                    <strong className="block truncate text-[13px] font-semibold text-ink">{userName}</strong>
                    <small className="block truncate text-[11.5px] text-muted">{user?.email}</small>
                    <small className="block truncate text-[11.5px] text-muted">{tenantName ? `${tenantName} · ${userRole}` : userRole}</small>
                  </div>
                </div>
                <Link href="/perfil" role="menuitem" onClick={() => setMenuOpen(false)} className={menuItem}>
                  <UserIcon size={16} className="shrink-0" />
                  Mi perfil y seguridad
                </Link>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setChangingPassword(true); }} className={menuItem}>
                  <KeyRound size={16} className="shrink-0" />
                  Cambiar contraseña
                </button>
                {/* Cierra esta sesión y vuelve al ingreso para entrar con otra cuenta. */}
                <button role="menuitem" onClick={() => { setMenuOpen(false); onLogout(); }} className={menuItem}>
                  <RotateCcw size={16} className="shrink-0" />
                  Cambiar de cuenta
                </button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); onLogout(); }}
                  className="flex w-full cursor-pointer items-center gap-2.5 border-t border-line px-3.5 py-2.5 text-left text-[13px] text-bad transition-colors hover:bg-surface-2">
                  <LogOut size={16} className="shrink-0" />
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </header>
  );
}
