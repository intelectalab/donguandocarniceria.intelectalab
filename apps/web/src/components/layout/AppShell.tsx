"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Cloud, Coins, Factory, Gauge, Home, Lock, Megaphone, ShieldCheck, ShoppingCart, Store, Truck } from "lucide-react";
import Header from "./Header";
import Sidebar, { type MenuItem } from "./Sidebar";
import ContextSelectors from "./ContextSelectors";
import { UiHost } from "@/components/ui";
import { api, apiImagen } from "@/lib/api";
import { clearToken } from "@/lib/auth";
import { MODULOS, menuDe, rutaPantalla } from "@/lib/modulos";
import { useEstadoSesion } from "@/lib/sesion";
import { aplicarTema, cssDeTema } from "@/lib/temaMarca";

// Ícono de cada grupo del menú (los nombres deben coincidir con los de lib/menu.json).
const GROUP_ICONS = {
  Inicio: Home,
  Plataforma: ShieldCheck,
  "Ventas y canales": ShoppingCart,
  "Atención y marketing": Megaphone,
  "Almacén y reparto": Truck,
  "Finanzas e indicadores": Coins,
  "Producción y calidad": Factory,
  "Abastecimiento y contabilidad": BookOpen,
  "Nuevos canales": Store,
  "Control fino": Gauge,
  "Producto SaaS": Cloud,
};

const CUENTA = [
  { href: "/perfil", label: "Mi perfil" },
  { href: "/notificaciones", label: "Notificaciones" },
];
// Páginas fuera del menú y del buscador, solo para el título de la cabecera.
const OTRAS = [...CUENTA, { href: "/componentes", label: "Componentes" }];

// Barra desplegada o en modo íconos: se recuerda en el navegador.
const SIDEBAR_KEY = "aycha-sidebar-abierta";
const SIDEBAR_EVENT = "aycha-sidebar-abierta-cambio";
const leerSidebar = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
};
const suscribirSidebar = (fn: () => void) => {
  window.addEventListener(SIDEBAR_EVENT, fn);
  return () => window.removeEventListener(SIDEBAR_EVENT, fn);
};

/** Armazón del sistema (como erp-saas): barra lateral, cabecera y la pantalla, con su control de acceso. */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sesion, cargando, error, reintentar } = useEstadoSesion();
  const sidebarOpen = useSyncExternalStore(suscribirSidebar, leerSidebar, () => true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  function toggleSidebar() {
    // En celular abre el cajón; en escritorio pliega o despliega la barra.
    if (window.matchMedia("(min-width: 768px)").matches) {
      try {
        localStorage.setItem(SIDEBAR_KEY, String(!sidebarOpen));
      } catch {}
      window.dispatchEvent(new Event(SIDEBAR_EVENT));
    } else {
      setMobileOpen((v) => !v);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      // Si falla la llamada, igual se limpia la sesión aquí.
    } finally {
      clearToken();
      router.push("/login");
    }
  }

  // Colores de la marca elegida arriba (o de la empresa) en todo el sistema (PLT-06).
  const temas = sesion?.me.themes;
  const marcaActual = sesion?.marca;
  useEffect(() => {
    if (!temas) return;
    const propias = Array.isArray(temas.brands) ? {} : temas.brands;
    const tema = (marcaActual && marcaActual !== "ALL" ? propias[marcaActual] : undefined) ?? temas.empresa;
    aplicarTema(cssDeTema(tema));
  }, [temas, marcaActual]);

  // Menú en el orden de sus grupos: solo los módulos que el rol ve; los apagados, con candado.
  const items = useMemo<MenuItem[]>(() => {
    if (!sesion) return [];
    const modulos = menuDe(sesion.me.modules, sesion.me.roles).flatMap((g) => g.modulos.map((m) => ({
      href: `/m/${m.code.toLowerCase()}`, label: m.name, code: m.code, group: g.name, locked: !m.enabled,
      children: m.visibles.map((p) => ({ href: rutaPantalla(m.code, p.code), label: p.name, code: p.code })),
    })));
    return [{ href: "/", label: "Inicio", group: "Inicio" }, ...modulos];
  }, [sesion]);

  const currentItem = items.find((it) => (it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`)));
  const currentScreen = currentItem?.children?.find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  const cuenta = OTRAS.find((c) => pathname.startsWith(c.href));
  // Título: la pantalla (o el módulo, en su ficha); migas: grupo · módulo.
  const currentSection = currentScreen?.label ?? currentItem?.label ?? cuenta?.label ?? "Inicio";
  const crumbs = currentItem && currentItem.group !== "Inicio"
    // Si el módulo se llama igual que su grupo (Plataforma · Plataforma), va una sola vez.
    ? currentScreen && currentItem.label !== currentItem.group ? [currentItem.group, currentItem.label] : [currentItem.group]
    : cuenta && CUENTA.includes(cuenta) ? ["Cuenta"] : [];
  const tenantName = sesion?.me.tenant.short;
  // Logo del cliente: la imagen pide sesión, así que se trae con el token y se muestra como URL local.
  const urlLogo = sesion?.me.tenant.logo_url;
  const [logo, setLogo] = useState<{ url: string; src: string } | null>(null);
  useEffect(() => {
    if (!urlLogo) return;
    let vigente = true;
    let src: string | null = null;
    apiImagen(urlLogo.replace(/^\/api/, "")).then((s) => { src = s; if (vigente && s) setLogo({ url: urlLogo, src: s }); });
    return () => { vigente = false; if (src) URL.revokeObjectURL(src); };
  }, [urlLogo]);
  const tenantLogo = urlLogo && logo?.url === urlLogo ? logo.src : null;

  useEffect(() => {
    document.title = `${currentSection} · ${tenantName ?? "Aycha"}`;
  }, [currentSection, tenantName]);

  // Un módulo o una pantalla abiertos por su dirección sin acceso del rol, o un módulo apagado,
  // no se montan: se dice por qué.
  const [, codigoMod, codigoPantalla] = /^\/m\/([a-z]+)(?:\/([a-z]+-\d+))?/.exec(pathname) ?? [];
  const codigoRuta = codigoMod?.toUpperCase();
  const itemRuta = codigoRuta ? items.find((it) => it.code === codigoRuta) : undefined;
  const pantallaDenegada = Boolean(itemRuta && codigoPantalla && !itemRuta.children?.some((p) => p.code === codigoPantalla.toUpperCase()));
  const denegado = sesion && codigoRuta && MODULOS.some((m) => m.code === codigoRuta)
    ? !itemRuta || pantallaDenegada ? "rol" : itemRuta.locked ? "apagado" : null
    : null;

  // Buscador: módulos y sus pantallas (por nombre o código, p. ej. «PED-02»).
  const searchScreens = [
    ...items.filter((it) => !it.locked).flatMap((it) => [
      { label: it.label, href: it.href, group: it.group === "Inicio" ? undefined : it.group, code: it.code },
      ...(it.children ?? []).map((p) => ({ label: p.label, href: p.href, group: it.label, code: p.code })),
    ]),
    ...CUENTA.map((c) => ({ ...c, group: "Cuenta" })),
  ];

  const user = sesion ? { name: sesion.me.user.name, email: sesion.me.user.email, role: sesion.me.roles.join(", ") } : null;
  const modulesHref = sesion?.puede("PLT", "E") ? "/m/plt" : null;

  // Marca y local van bajo la empresa, en la barra lateral desplegada (en la cabecera quitaban
  // espacio al título y a las migas).
  const sidebar = (compact: boolean) => (
    <Sidebar items={items} compact={compact} loading={cargando} onNavigate={() => setMobileOpen(false)} onLogout={handleLogout}
      loggingOut={loggingOut} groupIcons={GROUP_ICONS} user={user} tenantName={tenantName} tenantLogo={tenantLogo} modulesHref={modulesHref}
      context={sesion ? <ContextSelectors variant="sidebar" /> : undefined} />
  );

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-bg">
      <aside className={`hidden h-full min-h-0 shrink-0 overflow-visible border-r border-line transition-[width] duration-300 md:block ${sidebarOpen ? "w-64" : "w-16"}`}>
        {sidebar(!sidebarOpen)}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-[200] md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar(false)}</aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header open={sidebarOpen || mobileOpen} currentSection={currentSection} crumbs={crumbs} onToggle={toggleSidebar}
          user={user} onLogout={handleLogout} tenantName={tenantName} screens={searchScreens} ready={Boolean(sesion)} />

        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">
          {error ? (
            <Aviso titulo="No se pudo cargar tu sesión" texto={`${error} El servidor no respondió.`}>
              <button onClick={reintentar} className="rounded-[9px] bg-primary px-4 py-2 text-[13px] font-semibold text-primary-ink hover:brightness-110">Reintentar</button>
            </Aviso>
          ) : !sesion ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => <div key={n} className="h-24 animate-pulse rounded-xl bg-surface-2" />)}
            </div>
          ) : denegado ? (
            <Aviso titulo={MODULOS.find((m) => m.code === codigoRuta)?.name ?? codigoRuta!}
              texto={denegado === "apagado"
                ? "RN-PLT-07: este módulo está apagado en tu empresa. El administrador del sistema puede encenderlo en Plataforma → Módulos."
                : "Tu rol no tiene permiso para abrir esta pantalla. Si la necesitas, pídeselo al administrador de tu empresa."}>
              <Link href="/" className="rounded-[9px] border border-line bg-surface px-4 py-2 text-[13px] font-medium hover:bg-surface-2">Ir al inicio</Link>
            </Aviso>
          ) : children}
        </main>
      </div>
      <UiHost />
    </div>
  );
}

function Aviso({ titulo, texto, children }: { titulo: string; texto: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <Lock size={28} className="mb-2 text-muted" aria-hidden="true" />
        <p className="font-semibold text-ink">{titulo}</p>
        <p className="mt-1 max-w-[52ch] text-[13.5px] text-muted">{texto}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
