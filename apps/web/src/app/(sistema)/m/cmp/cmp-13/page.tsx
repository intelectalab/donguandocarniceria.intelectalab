"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Alert, Button, IconButton, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { fecha, numero } from "@/lib/formato";
import { Panel, Sub, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CAMPANA, type Opciones } from "@/modulos/cmp/tipos";

type Evento = { id: string; code: string; name: string; status: string; brand_id: string; brand_name: string; segment_code: string; effective_count: number | null; day: string };
type Resp = { data: Evento[]; overlaps: { week: string; campaigns: string[]; customers: number }[]; max_per_week: number; month: string };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const pad = (v: number) => String(v).padStart(2, "0");
const mover = (m: string, d: number) => { const [a, b] = m.split("-").map(Number); const x = new Date(Date.UTC(a, b - 1 + d, 1)); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}`; };
/** Semana ISO como la da el servidor: "2026-41". */
function semana(dia: string) {
  const [a, b, c] = dia.split("-").map(Number);
  const d = new Date(Date.UTC(a, b - 1, c));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const inicio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-${pad(Math.ceil(((d.getTime() - inicio.getTime()) / 86400000 + 1) / 7))}`;
}

/** CMP-13 Calendario de campañas: campañas del mes por día y marca, con aviso de clientes que caen en varias campañas la misma semana. */
export default function Calendario() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [mes, setMes] = useState<string | null>(null);
  const actual = mes ?? op?.today.slice(0, 7) ?? null;
  const r = useDatos<Resp>(actual ? `/v1/cmp/calendario?month=${actual}` : null);
  const d = r.datos?.month === actual ? r.datos : undefined;

  const porDia = new Map<string, Evento[]>();
  for (const e of d?.data ?? []) porDia.set(e.day, [...(porDia.get(e.day) ?? []), e]);
  const choques = new Map((d?.overlaps ?? []).map((o) => [o.week, o]));

  const celdas: (string | null)[] = [];
  if (actual) {
    const [a, m] = actual.split("-").map(Number);
    const primero = (new Date(Date.UTC(a, m - 1, 1)).getUTCDay() + 6) % 7;
    const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
    for (let i = 0; i < primero; i++) celdas.push(null);
    for (let i = 1; i <= dias; i++) celdas.push(`${actual}-${pad(i)}`);
    while (celdas.length % 7) celdas.push(null);
  }
  const titulo = actual ? `${MESES[Number(actual.slice(5)) - 1]} ${actual.slice(0, 4)}` : "";
  const ordenados = [...porDia.entries()].sort(([x], [y]) => x.localeCompare(y));

  return (
    <div className="space-y-5">
      <PageHeader description={`Cada campaña aparece el día en que se envió o está programada. Un cliente recibe como máximo ${d?.max_per_week ?? op?.params.max_per_week ?? 2} mensajes de promoción por semana: si dos campañas comparten clientes, la segunda se salta a esos clientes.`}
        actions={op?.can["cmp.campaign.manage"] && <Link href="/m/cmp/cmp-04" className={buttonClass("primary", "md", "gap-2")}><Plus size={16} aria-hidden="true" />Nueva campaña</Link>} />
      <Panel titulo={<span className="capitalize">{titulo}</span>} acciones={actual && <>
        <IconButton icon={ChevronLeft} label="Mes anterior" onClick={() => setMes(mover(actual, -1))} />
        <Button size="sm" variant="ghost" disabled={!op} onClick={() => setMes(op!.today.slice(0, 7))}>Hoy</Button>
        <IconButton icon={ChevronRight} label="Mes siguiente" onClick={() => setMes(mover(actual, 1))} />
      </>}>
        {r.error && <Alert tone="bad">{r.error}</Alert>}
        <div className="hidden sm:block">
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border text-[12.5px]">
            {DIAS.map((x) => <div key={x} className="bg-surface-2 px-2 py-1.5 font-medium text-muted">{x}</div>)}
            {celdas.map((dia, i) => {
              const ch = dia ? choques.get(semana(dia)) : undefined;
              return (
                <div key={dia ?? `v${i}`} className={`min-h-[96px] p-1.5 ${dia ? (ch ? "bg-warn-soft" : "bg-surface") : "bg-surface-2/60"}`}>
                  {dia && <p className={`mb-1 text-[12px] ${dia === op?.today ? "font-bold text-primary" : "text-muted"}`}>{Number(dia.slice(8))}</p>}
                  <div className="space-y-1">
                    {(dia ? porDia.get(dia) ?? [] : []).map((e) => (
                      <Link key={e.id} href={`/m/cmp/${e.status === "SENT" ? "cmp-06" : "cmp-05"}?id=${e.id}`} title={`${e.code} · ${e.name}`}
                        className="block rounded-md border border-border bg-surface-2 px-1.5 py-1 leading-tight hover:border-primary">
                        <span className="block truncate font-medium">{e.name}</span>
                        <span className="block truncate text-[11px] text-muted">{e.brand_name}{e.effective_count != null ? ` · ${numero(e.effective_count)}` : ""}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="space-y-3 sm:hidden">
          {ordenados.length === 0 && !r.cargando && <p className="text-muted">No hay campañas este mes.</p>}
          {ordenados.map(([dia, es]) => (
            <div key={dia}>
              <p className="mb-1 text-[12.5px] font-medium text-muted">{fecha(dia)}{choques.has(semana(dia)) ? " · semana con clientes repetidos" : ""}</p>
              {es.map((e) => (
                <Link key={e.id} href={`/m/cmp/${e.status === "SENT" ? "cmp-06" : "cmp-05"}?id=${e.id}`} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0"><p className="truncate font-medium">{e.name}</p><Sub>{e.brand_name} · {e.segment_code}{e.effective_count != null ? ` · ${numero(e.effective_count)} destinatarios` : ""}</Sub></div>
                  <StatusBadge status={e.status} labels={ESTADO_CAMPANA} />
                </Link>
              ))}
            </div>
          ))}
        </div>
        {d && d.data.length === 0 && <p className="mt-3 hidden text-muted sm:block">No hay campañas este mes.</p>}
      </Panel>
      {(d?.overlaps ?? []).length > 0 && (
        <Panel titulo="Clientes en más de una campaña la misma semana">
          <ul className="space-y-2">
            {d!.overlaps.map((o) => (
              <li key={o.week}><Alert tone="warn" title={`Semana ${Number(o.week.slice(5))}: ${o.campaigns.join(" y ")}`}>
                {numero(o.customers)} clientes están en {o.campaigns.length > 2 ? "varias" : "ambas"} campañas. Los que ya llegaron a su tope semanal no reciben la siguiente.
              </Alert></li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
