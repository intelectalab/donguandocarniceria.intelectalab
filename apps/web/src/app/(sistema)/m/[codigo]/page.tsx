"use client";

import { use } from "react";
import Link from "next/link";
import { grupoDe, moduloPorCodigo, pantallasDelMenu, rutaPantalla } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";

const ACCIONES: Record<string, string> = { C: "Crear", L: "Leer", E: "Editar", A: "Aprobar o anular" };

/**
 * Ficha de un módulo mientras su dueño construye las pantallas: objetivo de la spec, acceso del
 * rol y la lista de pantallas por hacer. Si el rol no tiene el módulo o está apagado, el armazón
 * (AppShell) no llega a montar esta pantalla. Cada pantalla tiene su dirección (/m/ped/ped-02); cuando
 * el módulo tenga una portada propia, su dueño crea app/(sistema)/m/<modulo>/page.tsx.
 */
export default function FichaModulo({ params }: PageProps<"/m/[codigo]">) {
  const { codigo } = use(params);
  const { me } = useSesion();
  const modulo = moduloPorCodigo(codigo);
  const acceso = me.modules.find((m) => m.code === modulo?.code);
  // Las pantallas que este rol ve en el menú, en el orden de la spec.
  const visibles = modulo ? pantallasDelMenu(modulo.code, me.modules, me.roles, me.permissions) : [];

  if (!modulo || !acceso) {
    return (
      <div className="space-y-2">
        <h1 className="text-xl font-bold">Sin acceso</h1>
        <p className="text-sm text-muted">Tu rol no tiene acceso a este módulo. <Link href="/inicio" className="text-primary underline">Volver al inicio</Link></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs text-accent">{modulo.code} · {grupoDe(modulo.code)}</p>
        <h2 className="text-2xl font-bold">{modulo.name}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{modulo.title}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(ACCIONES).map(([k, v]) => (
          <span key={k} className={`rounded-full px-2.5 py-1 text-xs ${acceso.actions.includes(k) ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted line-through"}`}>
            {v}
          </span>
        ))}
      </div>

      <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <h2 className="text-sm font-semibold">Objetivo</h2>
        <p className="mt-1 text-sm whitespace-pre-line">{modulo.objective.replaceAll("**", "")}</p>
      </section>

      <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
        <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">
          Pantallas de la especificación para tu rol ({visibles.length}{visibles.length < modulo.screens.length ? ` de ${modulo.screens.length}` : ""})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {visibles.map((p) => (
                <tr key={p.code} className="border-b border-line last:border-0 align-top hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-accent">{p.code}</td>
                  <td className="px-4 py-2">
                    <Link href={rutaPantalla(modulo.code, p.code)} className="font-semibold hover:text-primary hover:underline">{p.name}</Link>
                    {p.desc && <p className="text-xs text-muted">{p.desc}</p>}
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-muted">{p.roles?.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
