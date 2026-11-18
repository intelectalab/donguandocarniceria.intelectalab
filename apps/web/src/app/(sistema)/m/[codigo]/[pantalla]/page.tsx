"use client";

import { use } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { moduloPorCodigo, pantallaVisible, rutaPantalla } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";

/**
 * Ficha de una pantalla de la spec mientras no está construida. Al construirla, su dueño crea
 * app/(sistema)/m/<modulo>/<pantalla>/page.tsx (p. ej. m/ped/ped-02/page.tsx): una ruta fija
 * tiene prioridad sobre esta y el menú ya apunta ahí. El armazón (AppShell) no monta esta
 * pantalla si el rol no la ve o el módulo está apagado.
 */
export default function FichaPantalla({ params }: PageProps<"/m/[codigo]/[pantalla]">) {
  const { codigo, pantalla } = use(params);
  const { me } = useSesion();
  const modulo = moduloPorCodigo(codigo);
  const visibles = modulo ? modulo.screens.filter((p) => pantallaVisible(modulo.code, p, me.roles)) : [];
  const i = visibles.findIndex((p) => p.code === pantalla.toUpperCase());
  const p = visibles[i];

  if (!modulo || !p) {
    return <p className="text-sm text-muted">No existe esa pantalla. <Link href="/" className="text-primary underline">Volver al inicio</Link></p>;
  }

  const anterior = visibles[i - 1];
  const siguiente = visibles[i + 1];

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <p className="font-mono text-xs text-accent">{p.code} · {modulo.name}</p>
        <h2 className="text-2xl font-bold">{p.name}</h2>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-semibold">Qué hace (spec)</h3>
        <p className="mt-1 text-sm">{p.desc || "Sin descripción en la especificación."}</p>
        {p.roles && <p className="mt-3 text-xs text-muted">Solo para: {p.roles.join(", ")} (además de gerencia y auditoría).</p>}
      </section>

      <p className="rounded-lg border border-dashed border-line px-4 py-3 text-[13px] text-muted">
        Pantalla por construir. Su dueño la crea en{" "}
        <code className="font-mono text-ink">app/(sistema)/m/{modulo.code.toLowerCase()}/{p.code.toLowerCase()}/page.tsx</code>.
      </p>

      <nav className="flex items-center justify-between gap-3 text-[13px]">
        {anterior ? (
          <Link href={rutaPantalla(modulo.code, anterior.code)} className="flex min-w-0 items-center gap-1 text-primary hover:underline">
            <ChevronLeft size={15} className="shrink-0" /><span className="truncate">{anterior.code} · {anterior.name}</span>
          </Link>
        ) : <span />}
        {siguiente && (
          <Link href={rutaPantalla(modulo.code, siguiente.code)} className="flex min-w-0 items-center gap-1 text-primary hover:underline">
            <span className="truncate">{siguiente.code} · {siguiente.name}</span><ChevronRight size={15} className="shrink-0" />
          </Link>
        )}
      </nav>
    </div>
  );
}
