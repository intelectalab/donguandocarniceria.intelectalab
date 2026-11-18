"use client";

import Link from "next/link";
import { menuDe, rutaPantalla } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";

/**
 * Inicio: los módulos del rol por grupo, en el mismo orden del menú, con las pantallas que ve.
 * Cada tarjeta abre la primera pantalla del módulo.
 */
export default function Inicio() {
  const { me } = useSesion();
  const menu = menuDe(me.modules, me.roles);
  const total = menu.reduce((n, g) => n + g.modulos.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Hola, {me.user.name.split(" ")[0]}</h2>
        <p className="text-sm text-muted">{me.tenant.name} · {total} módulos disponibles para tu rol</p>
      </div>

      {menu.map((g) => (
        <section key={g.name} className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-sm font-semibold">{g.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {g.modulos.map((m) => (
              <Link key={m.code} href={m.enabled ? rutaPantalla(m.code, m.visibles[0].code) : `/m/${m.code.toLowerCase()}`}
                className="grid gap-1 rounded-lg border border-line bg-bg px-3.5 py-3 hover:border-primary">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted">{m.code}</span>
                  {!m.enabled && <span className="rounded-full bg-warn-soft px-2 text-[11px] text-warn">Apagado</span>}
                </div>
                <p className="font-display font-semibold">{m.name}</p>
                <p className="text-xs text-muted">{m.visibles.length} pantallas</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
