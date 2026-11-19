"use client";

import { useEffect, useState } from "react";
import { DataTable, Input, PageHeader, Select, type Column } from "@/components/ui";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

type Fila = { id: string; action: string; action_name: string; actor_name: string; tenant_short: string | null; entity: string | null;
  entity_id: string | null; reason: string | null; ip: string | null; detail: Record<string, unknown> | null; occurred_at: string };
type Respuesta = { data: Fila[]; current_page: number; last_page: number; per_page: number; total: number;
  acciones: { code: string; name: string }[]; usuarios: { id: string; full_name: string }[]; empresas: { id: string; short: string }[] };

/** OPS-13 Bitácora de la consola: toda acción con quién, empresa, motivo, IP y detalle. Solo lectura (RN-OPS-05). */
export default function BitacoraConsola() {
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [f, setF] = useState({ search: "", action: "", user: "", tenant: "", desde: "", hasta: "", page: 1, per_page: 25 });

  useEffect(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v !== null).map(([k, v]) => [k, String(v)]));
    const t = setTimeout(() => apiConsola<Respuesta>(`/bitacora?${q}`).then((x) => { setR(x); setError(""); }).catch((e) => setError(mensajeDe(e))), 250);
    return () => clearTimeout(t);
  }, [f]);
  const poner = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v, page: k === "page" ? Number(v) : 1 }));

  const columnas: Column<Fila>[] = [
    { key: "occurred_at", header: "Cuándo", render: (a) => <span className="whitespace-nowrap">{fechaHora(a.occurred_at)}</span> },
    { key: "action_name", header: "Acción", cardTitle: true, render: (a) => <span className="font-semibold text-ink">{a.action_name}</span> },
    { key: "actor_name", header: "Quién" },
    { key: "tenant_short", header: "Empresa", render: (a) => a.tenant_short ?? <span className="text-muted">—</span> },
    { key: "reason", header: "Motivo y detalle", render: (a) => (
      <div className="max-w-[420px]">
        {a.reason && <p className="text-[13px] text-ink">{a.reason}</p>}
        {a.detail && Object.keys(a.detail).length > 0 && (
          <p className="text-[12px] break-words text-muted">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</p>
        )}
      </div>
    ) },
    { key: "ip", header: "IP", hideOnMobile: true, render: (a) => <span className="font-mono text-[12px]">{a.ip ?? "—"}</span> },
  ];

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-[22px] font-bold text-ink">Bitácora de la consola</h1>
      <PageHeader code="OPS-13" description="Todo lo que se hace en la consola: ingresos, altas y cambios de empresas, suscripciones, planes, usuarios, parámetros y catálogos, con quién, el motivo y la IP. Nadie la puede cambiar ni borrar." />
      <DataTable columns={columnas} rows={r?.data ?? []} loading={!r && !error} error={error} empty="No hay acciones con esos filtros."
        search={{ value: f.search, onChange: (v) => poner("search", v), placeholder: "Buscar por persona, motivo, empresa o IP" }}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Select value={f.action} onChange={(e) => poner("action", e.target.value)} aria-label="Acción"
              options={[{ value: "", label: "Todas las acciones" }, ...(r?.acciones ?? []).map((a) => ({ value: a.code, label: a.name }))]} />
            <Select value={f.user} onChange={(e) => poner("user", e.target.value)} aria-label="Usuario"
              options={[{ value: "", label: "Todos los usuarios" }, ...(r?.usuarios ?? []).map((u) => ({ value: u.id, label: u.full_name }))]} />
            <Select value={f.tenant} onChange={(e) => poner("tenant", e.target.value)} aria-label="Empresa"
              options={[{ value: "", label: "Todas las empresas" }, ...(r?.empresas ?? []).map((t) => ({ value: t.id, label: t.short }))]} />
            <Input type="date" value={f.desde} onChange={(e) => poner("desde", e.target.value)} aria-label="Desde" className="w-[150px]" />
            <Input type="date" value={f.hasta} onChange={(e) => poner("hasta", e.target.value)} aria-label="Hasta" className="w-[150px]" />
          </div>
        }
        pagination={r ? { page: r.current_page, lastPage: r.last_page, total: r.total, perPage: r.per_page, onPageChange: (p) => poner("page", p),
          onPerPageChange: (n) => poner("per_page", n) } : undefined} />
    </div>
  );
}
