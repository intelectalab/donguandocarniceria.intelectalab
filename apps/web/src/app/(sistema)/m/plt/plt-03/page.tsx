"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Pencil, Plus } from "lucide-react";
import { Alert, Button, DetailList, PageHeader, StatusBadge, type Tone } from "@/components/ui";
import { rutaPantalla } from "@/lib/modulos";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { EmpresaForm } from "@/modulos/plt/EmpresaForm";
import { REGIMENES, etiqueta, type Empresa } from "@/modulos/plt/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"], PREPARING: ["En preparación", "warn"] };

/** PLT-03 Empresas: las razones sociales (RUC) con sus marcas, locales y series. */
export default function Empresas() {
  const { can } = useSesion();
  const lista = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100 });
  const [editando, setEditando] = useState<Empresa | null | undefined>(undefined);
  const puedeEditar = can("plt.company.manage");

  return (
    <div className="space-y-5">
      <PageHeader description="Las razones sociales con las que factura tu negocio. Varias marcas pueden facturar con la misma empresa."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)}>Nueva empresa</Button>} />

      {lista.error && <Alert tone="bad">{lista.error}</Alert>}
      {lista.cargando && !lista.filas.length && <div className="h-48 animate-pulse rounded-xl bg-surface-2" />}
      {!lista.cargando && !lista.error && !lista.filas.length && (
        <Alert tone="info" title="Sin empresas">Crea la primera con «Nueva empresa».</Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {lista.filas.map((e) => (
          <section key={e.id} className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 basis-[220px] items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Building2 size={19} /></span>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold break-words text-ink">{e.legal_name}</h2>
                  <p className="text-[13px] text-muted">{e.trade_name} · RUC <span className="font-mono text-ink">{e.ruc}</span></p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StatusBadge status={e.status} labels={ESTADOS} />
                {puedeEditar && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditando(e)}>Editar</Button>}
              </div>
            </div>

            <div className="mt-4">
              <DetailList items={[
                { label: "Régimen", value: etiqueta(REGIMENES, e.tax_regime) },
                { label: "Moneda", value: e.default_currency === "USD" ? "Dólares" : "Soles" },
                { label: "Domicilio fiscal", value: e.fiscal_address },
                { label: "Distrito", value: e.fiscal_district ?? e.fiscal_ubigeo ?? "—" },
              ]} />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <Conteo href={rutaPantalla("PLT", "PLT-05")} n={e.brands_count} texto="Marcas"
                detalle={e.brands_count ? `${e.active_brands_count} ${e.active_brands_count === 1 ? "activa" : "activas"}` : "Sin marcas"} />
              <Conteo href={rutaPantalla("PLT", "PLT-04")} n={e.establishments_count} texto="Locales"
                detalle={e.establishments.map((l) => l.short).join(", ") || "Sin locales"} />
              <Conteo href={rutaPantalla("PLT", "PLT-08")} n={e.series_count} texto="Series"
                detalle={e.series_count ? `${e.electronic_series_count} ${e.electronic_series_count === 1 ? "electrónica" : "electrónicas"}` : "Sin series"} />
            </div>

            {e.brands.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Marcas que facturan con esta empresa">
                {e.brands.map((b) => (
                  <li key={b.id} title={b.status === "ACTIVE" ? undefined : "Inactiva"}
                    className={`inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-ink ${b.status === "ACTIVE" ? "" : "opacity-55"}`}>
                    {/* El color es un dato de la marca (PLT-06), no del tema. */}
                    <span aria-hidden="true" className="size-3 rounded-[3px] border border-line" style={b.primary_color ? { background: b.primary_color } : undefined} />
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      {editando !== undefined && (
        <EmpresaForm empresa={editando} onClose={() => setEditando(undefined)} onGuardada={() => { setEditando(undefined); lista.recargar(); }} />
      )}
    </div>
  );
}

function Conteo({ href, n, texto, detalle }: { href: string; n: number; texto: string; detalle: string }) {
  return (
    <Link href={href} className="min-w-0 rounded-lg border border-line px-3 py-2 transition-colors hover:border-primary hover:bg-primary-soft/40">
      <span className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{texto}</span>
      <span className="block font-display text-[22px] leading-tight font-bold text-ink tabular-nums">{n}</span>
      <span className="block truncate text-[12px] text-muted" title={detalle}>{detalle}</span>
    </Link>
  );
}
