"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";

type Check = { label: string; ok: boolean; detalle: string | null };
type Paso = { key: string; titulo: string; url: string; checks: Check[]; listos: number; total: number; ok: boolean };
type Respuesta = { pasos: Paso[]; listos: number; total: number; pct: number };

/**
 * PLT-14 Asistente de configuración inicial: lista guiada para poner en marcha al cliente. No
 * guarda nada: cada comprobación se marca sola cuando el dato existe y es válido.
 */
export default function Asistente() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [version, setVersion] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    api<Respuesta>("/v1/plt/asistente")
      .then((r) => vigente && setDatos(r))
      .catch((err) => toast.error(mensajeDe(err)))
      .finally(() => vigente && setCargando(false));
    return () => { vigente = false; };
  }, [version]);

  const siguiente = datos?.pasos.findIndex((p) => !p.ok) ?? -1;

  return (
    <div className="space-y-5">
      <PageHeader description="Lista guiada para poner en marcha el sistema: empresa, marcas y colores, locales, centros de costo, series, usuarios, medios de pago y módulos. No se llena aquí: cada casilla se marca sola cuando el dato está en su pantalla y es válido."
        actions={<Button icon={RefreshCw} loading={cargando} onClick={() => { setCargando(true); setVersion((v) => v + 1); }}>Volver a revisar</Button>} />

      <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <b className="font-display text-[22px]">{datos ? `${datos.pct} %` : "…"} <span className="text-[14px] font-semibold text-muted">listo</span></b>
          <span className="text-[13px] text-muted">
            {datos ? `${datos.listos} de ${datos.total} comprobaciones · ${datos.pasos.filter((p) => p.ok).length} de ${datos.pasos.length} pasos completos` : ""}
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={datos?.pct ?? 0} aria-label="Avance de la configuración">
          <div className={`h-full rounded-full transition-[width] ${datos?.pct === 100 ? "bg-ok" : "bg-primary"}`} style={{ width: `${datos?.pct ?? 0}%` }} />
        </div>
        {datos && (
          <ol className="mt-4 flex flex-wrap gap-2">
            {datos.pasos.map((p, i) => (
              <li key={p.key}>
                <a href={`#paso-${p.key}`} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium ${p.ok
                  ? "border-ok/30 bg-ok-soft text-ok" : i === siguiente ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}>
                  {p.ok ? <CheckCircle2 size={14} aria-hidden="true" /> : <span className="tabular-nums">{i + 1}.</span>}
                  {p.titulo}
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {!datos && [1, 2, 3, 4].map((n) => <div key={n} className="h-56 animate-pulse rounded-xl bg-surface-2" />)}
        {datos?.pasos.map((p, i) => (
          <section key={p.key} id={`paso-${p.key}`} className={`min-w-0 scroll-mt-24 rounded-xl border bg-surface shadow-card ${i === siguiente ? "border-primary/50" : "border-line"}`}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-semibold">{i + 1}. {p.titulo}</h2>
              <Badge tone={p.ok ? "ok" : "warn"}>{p.listos} de {p.total}</Badge>
            </div>
            <ul className="grid gap-2.5 px-4 py-3">
              {p.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2.5 text-[13.5px]">
                  {c.ok ? <CheckCircle2 size={17} className="mt-px shrink-0 text-ok" aria-label="Listo" />
                    : <Circle size={17} className="mt-px shrink-0 text-warn" aria-label="Pendiente" />}
                  <div className="min-w-0">
                    <span className={c.ok ? "" : "font-medium"}>{c.label}</span>
                    {c.detalle && <p className="text-[12px] break-words text-muted">{c.detalle}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2.5">
              <Link href={p.url} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
                {p.ok ? "Ver" : "Completar"} en su pantalla <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
