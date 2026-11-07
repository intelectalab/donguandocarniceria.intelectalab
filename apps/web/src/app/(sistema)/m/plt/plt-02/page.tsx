"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import type { ResultadoBusqueda } from "@/components/layout/GlobalSearch";
import { api, mensajeDe } from "@/lib/api";

type Respuesta = {
  q: string; min: number; corta: boolean; total: number; resultados: ResultadoBusqueda[];
  por_tipo: Record<string, number>; tipos: Record<string, string>;
};

/** PLT-02 Búsqueda global: todos los resultados de una búsqueda, agrupados por tipo. */
export default function BusquedaGlobal() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("q") ?? "";
  const [texto, setTexto] = useState(inicial);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const q = texto.trim();

  useEffect(() => {
    if (q.length < 1) return;
    let vigente = true;
    const t = setTimeout(() => {
      api<Respuesta>(`/v1/plt/buscar?q=${encodeURIComponent(q)}`)
        .then((r) => { if (vigente) { setDatos(r); setError(""); } })
        .catch((err) => vigente && setError(mensajeDe(err)));
      // La búsqueda queda en la dirección, para volver a ella o compartirla.
      router.replace(`/m/plt/plt-02?q=${encodeURIComponent(q)}`, { scroll: false });
    }, 300);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, router]);

  const actual = datos && datos.q === q ? datos : null;
  const grupos = actual ? [...new Set(actual.resultados.map((r) => r.tipo))] : [];

  return (
    <div className="space-y-5">
      <PageHeader description={`Busca desde ${datos?.min ?? 3} letras en clientes, pedidos, comprobantes, productos, trabajadores, en los datos de Plataforma y en lo que publican los demás módulos. Solo salen los registros de los módulos encendidos que tu rol puede ver, y de tus marcas y locales.`} />

      <label className="relative block max-w-[640px]">
        <span className="sr-only">Buscar</span>
        <Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus maxLength={100}
          placeholder="Nombre, número de pedido, RUC, SKU, serie…"
          className="h-12 w-full rounded-xl border border-line bg-surface pr-4 pl-11 text-[15px] text-ink shadow-card outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]" />
      </label>

      {error && <p role="alert" className="text-[13.5px] text-bad">{error}</p>}

      {!q ? (
        <p className="text-[13.5px] text-muted">Escribe lo que buscas. Desde cualquier pantalla también puedes usar <kbd className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[11.5px]">Ctrl K</kbd> o <kbd className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[11.5px]">/</kbd>.</p>
      ) : !actual ? (
        <p className="text-[13.5px] text-muted">Buscando…</p>
      ) : actual.corta ? (
        <p className="text-[13.5px] text-muted">Escribe al menos {actual.min} letras.</p>
      ) : actual.total === 0 ? (
        <p className="text-[13.5px] text-muted">Sin resultados para «{q}».</p>
      ) : (<>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          <span>{actual.total} resultado{actual.total === 1 ? "" : "s"}{actual.resultados.length < actual.total ? `, se muestran ${actual.resultados.length}` : ""}:</span>
          {Object.entries(actual.por_tipo).map(([t, n]) => <Badge key={t} tone="neutral">{actual.tipos[t] ?? t} · {n}</Badge>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {grupos.map((t) => (
            <section key={t} className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
              <h2 className="border-b border-line px-4 py-2.5 text-[13.5px] font-semibold">{actual.tipos[t] ?? t}</h2>
              <ul className="divide-y divide-line">
                {actual.resultados.filter((r) => r.tipo === t).map((r) => (
                  <li key={`${r.modulo}-${r.id}`}>
                    <Link href={r.url} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft font-mono text-[10px] font-semibold text-primary">{r.modulo}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{r.titulo}</span>
                        {r.detalle && <span className="block truncate text-[12px] text-muted">{r.detalle}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </>)}
    </div>
  );
}
