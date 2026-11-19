"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Building2, CreditCard, Loader2, LogOut, ScrollText, Settings2, ShieldCheck, Users } from "lucide-react";
import { UiHost } from "@/components/ui";
import { SesionConsola } from "@/components/consola/sesion";
import { apiConsola, clearTokenConsola, type UsuarioConsola } from "@/lib/consola";

// Lo que ya existe de la consola; lo demás aparece en la tanda que le toca.
const MENU = [
  { href: "/consola/usuarios", label: "Usuarios de plataforma", code: "OPS-12", icon: Users },
];
const PROXIMAMENTE = [
  { label: "Empresas", icon: Building2 },
  { label: "Planes y suscripciones", icon: CreditCard },
  { label: "Bitácora de la consola", icon: ScrollText },
  { label: "Parámetros de plataforma", icon: Settings2 },
];

/** Armazón de la consola de Intelectalab: menú propio, sin empresa ni marca (OPS). */
export default function PanelConsola({ children }: { children: ReactNode }) {
  const router = useRouter();
  const ruta = usePathname();
  const [usuario, setUsuario] = useState<UsuarioConsola | null>(null);

  useEffect(() => {
    apiConsola<UsuarioConsola>("/yo").then(setUsuario).catch(() => router.replace("/consola/ingreso"));
  }, [router]);

  async function salir() {
    await apiConsola("/salir", { method: "POST" }).catch(() => {});
    clearTokenConsola();
    router.replace("/consola/ingreso");
  }

  if (!usuario) {
    return <div className="grid min-h-screen place-items-center bg-bg text-muted"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <SesionConsola.Provider value={usuario}>
      <div className="flex min-h-screen flex-col bg-bg md:flex-row">
        <aside className="flex shrink-0 flex-col bg-[#1d1418] text-white md:sticky md:top-0 md:h-screen md:w-64">
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4">
            <span className="grid size-9 place-items-center rounded-lg bg-primary font-display text-[17px] font-extrabold">G</span>
            <div className="min-w-0">
              <p className="font-display text-[15px] leading-tight font-bold">Consola</p>
              <p className="text-[11.5px] text-white/60">GestionCarnica · Intelectalab</p>
            </div>
          </div>
          <nav aria-label="Consola" className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-visible">
            {MENU.map((m) => {
              const activa = ruta.startsWith(m.href);
              return (
                <Link key={m.href} href={m.href} aria-current={activa ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${activa ? "bg-white/12 font-semibold text-white" : "text-white/75 hover:bg-white/8 hover:text-white"}`}>
                  <m.icon size={17} /> {m.label}
                </Link>
              );
            })}
            <p className="mt-3 hidden px-3 text-[10.5px] font-semibold tracking-wider text-white/40 uppercase md:block">Próximas tandas</p>
            {PROXIMAMENTE.map((m) => (
              <span key={m.label} className="hidden items-center gap-2.5 px-3 py-2 text-[13px] text-white/35 md:flex" aria-disabled="true">
                <m.icon size={16} /> {m.label}
              </span>
            ))}
          </nav>
          <div className="hidden border-t border-white/10 p-3 md:block">
            <p className="truncate text-[13px] font-semibold">{usuario.full_name}</p>
            <p className="flex items-center gap-1 text-[11.5px] text-white/60"><ShieldCheck size={12} /> {usuario.role_name}</p>
            <button type="button" onClick={salir} className="mt-2.5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/15 py-1.5 text-[12.5px] text-white/85 hover:bg-white/8">
              <LogOut size={14} /> Cerrar sesión
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-10">
          <div className="mb-4 flex items-center justify-between gap-3 md:hidden">
            <p className="text-[13px] text-muted">{usuario.full_name} · {usuario.role_name}</p>
            <button type="button" onClick={salir} className="flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-primary"><LogOut size={14} /> Salir</button>
          </div>
          {children}
        </main>
      </div>
      <UiHost />
    </SesionConsola.Provider>
  );
}
