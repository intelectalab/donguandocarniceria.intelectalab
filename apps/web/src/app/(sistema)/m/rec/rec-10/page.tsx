"use client";

import { Printer } from "lucide-react";
import { Alert, Badge, Button, PageHeader, StatusBadge } from "@/components/ui";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { NavVersion, SelectorVersion, useDatos, useVersion, useVersionElegida } from "@/modulos/rec/comunes";
import { CONSERVACION, FUNCION, VARIABLE, VERSION, type Num } from "@/modulos/rec/tipos";

type Ficha = {
  version: number; status: string; recipe_code: string; recipe_name: string; product_name: string; brand: { name: string; legal_footer: string | null }; company_name: string | null;
  ingredients: { name: string; pct: string; is_additive: boolean; sin_code: string | null; function_class: string | null; ppm: string | null; max_ppm: Num }[];
  allergens: string[]; shelf_life_days: number | null; storage: string; presentations: string[];
  control_points: { code: string; variable: string; min_value: Num; max_value: Num; unit: string; is_critical: boolean }[];
  sanitary: { number: string | null; authority: string | null; expires_on: string | null }; approved_at: string | null; approved_by_name: string | null;
};

/** REC-10 Ficha técnica por versión: ingredientes en orden decreciente, aditivos con SIN, alérgenos, vida útil, conservación y registro sanitario. */
export default function FichaTecnica() {
  const { can } = useSesion();
  const sel = useVersionElegida();
  const v = useVersion(sel.id);
  const { datos: f, error } = useDatos<Ficha>(sel.id ? `/v1/rec/versiones/${sel.id}/ficha` : null);
  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = f?.sanitary.expires_on ? f.sanitary.expires_on.slice(0, 10) < hoy : false;
  return (
    <div className="space-y-5">
      <div className="print:hidden space-y-5">
        <PageHeader description="La ficha técnica de la versión, lista para imprimir o guardar en PDF: ingredientes de mayor a menor, aditivos con su código SIN, alérgenos, vida útil, conservación y registro sanitario."
          actions={<Button variant="primary" icon={Printer} disabled={!f} onClick={() => window.print()}>Imprimir o PDF</Button>} />
        <SelectorVersion id={sel.id} lista={sel.lista} onChange={sel.elegir} version={v.datos} />
        {v.datos && <NavVersion v={v.datos} actual="rec-10" costos={can("rec.cost.view")} />}
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {f && (
        <article className="max-w-[860px] space-y-4 rounded-xl border border-line border-t-[6px] border-t-primary bg-surface p-5 shadow-card print:border-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[12px] text-muted">{f.brand.name}{f.company_name ? ` · ${f.company_name}` : ""}</p>
              <h2 className="text-[20px] font-semibold">{f.product_name}</h2>
              <p className="text-[13px]">Ficha técnica {f.recipe_code} · versión {f.version} · <StatusBadge status={f.status} labels={VERSION} /></p>
            </div>
            <div className="text-right text-[13px]">
              <p>Registro sanitario: {f.sanitary.number ?? "no aplica"}{f.sanitary.authority && f.sanitary.number ? ` (${f.sanitary.authority})` : ""}</p>
              {f.sanitary.expires_on && <p>Vence: {fecha(f.sanitary.expires_on)} {vencido && <Badge tone="bad">Vencido</Badge>}</p>}
            </div>
          </header>
          <section>
            <h3 className="text-[14px] font-semibold">Ingredientes</h3>
            <p className="text-[13.5px]">{f.ingredients.map((i) => `${i.name}${i.is_additive && i.sin_code ? ` (SIN ${i.sin_code})` : ""} ${numero(i.pct, Number(i.pct) < 1 ? 2 : 1)} %`).join(", ")}.</p>
          </section>
          <section>
            <h3 className="text-[14px] font-semibold">Aditivos</h3>
            {f.ingredients.some((i) => i.is_additive) ? (
              <ul className="list-disc pl-5 text-[13.5px]">
                {f.ingredients.filter((i) => i.is_additive).map((i, n) => (
                  <li key={n}>{i.function_class ? FUNCION[i.function_class] : "Aditivo"}: {i.name}{i.sin_code ? ` (SIN ${i.sin_code})` : ""} · {numero(i.ppm, 0)} ppm{i.max_ppm !== null ? ` (límite ${numero(i.max_ppm, 0)} ppm)` : ""}</li>
                ))}
              </ul>
            ) : <p className="text-[13.5px]">Sin aditivos.</p>}
          </section>
          <section>
            <h3 className="text-[14px] font-semibold">Alérgenos</h3>
            <p className="text-[13.5px]">{f.allergens.length ? <b>Contiene: {f.allergens.join(", ").toLowerCase()}.</b> : "No contiene alérgenos declarables."}</p>
          </section>
          <dl className="grid gap-3 text-[13.5px] sm:grid-cols-3">
            <div><dt className="text-[12px] text-muted">Vida útil</dt><dd>{f.shelf_life_days ? `${f.shelf_life_days} días` : "Sin definir"}</dd></div>
            <div><dt className="text-[12px] text-muted">Conservación</dt><dd>{CONSERVACION[f.storage] ?? f.storage}</dd></div>
            <div><dt className="text-[12px] text-muted">Presentaciones</dt><dd>{f.presentations.join(" · ") || "—"}</dd></div>
          </dl>
          <section>
            <h3 className="text-[14px] font-semibold">Controles del proceso</h3>
            {f.control_points.length ? (
              <ul className="list-disc pl-5 text-[13.5px]">
                {f.control_points.map((c) => <li key={c.code}>{c.code} {(VARIABLE[c.variable] ?? c.variable).toLowerCase()} {numero(c.min_value, 2)}–{numero(c.max_value, 2)} {c.unit}{c.is_critical ? " (crítico)" : ""}</li>)}
              </ul>
            ) : <p className="text-[13.5px]">Sin puntos de control.</p>}
          </section>
          <p className="text-[12px] text-muted">
            {f.approved_at ? `Aprobada el ${fecha(f.approved_at)} por ${f.approved_by_name ?? "—"}.` : "Versión no aprobada: borrador de ficha."}
            {f.brand.legal_footer ? ` ${f.brand.legal_footer}` : ""}
          </p>
        </article>
      )}
    </div>
  );
}
