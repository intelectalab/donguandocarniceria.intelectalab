"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Boxes, History, PencilLine, Search, SlidersHorizontal } from "lucide-react";
import { Badge, Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { ParametroEditor } from "@/modulos/plt/ParametroEditor";
import { formatoParametro, sinCodigos, type Parametro } from "@/modulos/plt/tipos";

type Respuesta = {
  parametros: Parametro[];
  modulos: { code: string; name: string; total: number; enabled: boolean }[];
  resumen: { total: number; modulos: number; con_valor_propio: number; cambios: number };
};

/** PLT-10 Parámetros: valor que rige, rango y descripción de cada parámetro, por módulo. */
export default function Parametros() {
  const [modulo, setModulo] = useState("PLT");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [datos, setDatos] = useState<{ clave: string } & Respuesta | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);
  const clave = `${modulo}|${q}|${version}`;

  useEffect(() => {
    const t = setTimeout(() => setQ(busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams(q ? { q } : { module: modulo });
    api<Respuesta>(`/v1/plt/parametros?${p}`)
      .then((r) => { if (vigente) { setDatos({ clave, ...r }); setError(""); } })
      .catch((err) => vigente && setError(mensajeDe(err)));
    return () => { vigente = false; };
  }, [modulo, q, clave]);

  const r = datos?.resumen;
  const mod = datos?.modulos.find((m) => m.code === modulo);

  const columnas: Column<Parametro>[] = [
    { key: "key", header: "Clave", render: (p) => <span className="font-mono text-[12.5px]">{p.key}</span> },
    { key: "description", header: "Para qué", cardTitle: true, render: (p) => <span className="block max-w-[420px]">{sinCodigos(p.description)}</span> },
    ...(q ? [{ key: "module_code", header: "Módulo", render: (p: Parametro) => <span className="font-mono">{p.module_code}</span> }] : []),
    { key: "value", header: "Valor", render: (p) => <b className="whitespace-nowrap">{formatoParametro(p.value, p.value_type, p.unit, p.options)}</b> },
    {
      key: "source", header: "Sale de", render: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {p.source === "TENANT" ? <Badge tone="primary">Empresa</Badge> : <span className="text-muted">Por defecto</span>}
          {p.overrides ? <Badge tone="info">{p.overrides === 1 ? "1 local o marca" : `${p.overrides} locales o marcas`}</Badge> : null}
        </span>
      ),
    },
    { key: "rango", header: "Rango", hideOnMobile: true, render: (p) => p.min_value !== null || p.max_value !== null ? `${p.min_value ?? "—"} a ${p.max_value ?? "—"}` : <span className="text-muted">—</span> },
    { key: "default_value", header: "Por defecto", hideOnMobile: true, render: (p) => <span className="text-muted">{formatoParametro(p.default_value, p.value_type, p.unit, p.options)}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los valores que ajustan cómo funciona cada módulo. Rige el más específico: el de una marca o un local, después el de la empresa y, si no hay, el valor por defecto. Cada cambio pide motivo y queda en el historial." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Parámetros" icono={SlidersHorizontal} destacada valor={r ? numero(r.total) : undefined} detalle={r ? `${r.modulos} módulos` : ""} />
        <Cifra titulo="Con valor propio" icono={PencilLine} valor={r ? numero(r.con_valor_propio) : undefined} detalle="Distintos del valor por defecto" />
        <Cifra titulo="Cambios registrados" icono={History} valor={r ? numero(r.cambios) : undefined} detalle="En el historial de cambios" />
        <Cifra titulo="Del módulo elegido" icono={Boxes} valor={mod ? numero(mod.total) : undefined} detalle={mod ? `${mod.code} · ${mod.name}` : ""} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid gap-1.5 sm:w-[340px]">
          <span className="text-[12.5px] font-medium text-muted">Módulo</span>
          <Select value={modulo} onChange={(e) => { setModulo(e.target.value); setBusqueda(""); }}
            options={(datos?.modulos ?? []).map((m) => ({ value: m.code, label: `${m.code} · ${m.name} (${m.total})${m.enabled ? "" : " · apagado"}` }))} />
        </label>
        <label className="relative flex-1 sm:max-w-[360px]">
          <span className="sr-only">Buscar en todos los módulos</span>
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar clave o descripción en todos los módulos…"
            className="h-10 w-full rounded-[9px] border border-line bg-surface pr-3 pl-9 text-[13.5px] text-ink outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]" />
        </label>
        <Link href="/m/plt/plt-11" className="text-[13px] font-medium text-primary hover:underline sm:ml-auto">Ver historial de cambios</Link>
      </div>

      <DataTable columns={columnas} rows={datos?.parametros ?? []} rowKey={(p) => p.key}
        loading={!datos || datos.clave !== clave} error={error || undefined} onRetry={() => setVersion((v) => v + 1)}
        onRowClick={(p) => setAbierto(p.key)}
        empty={q ? "Ningún parámetro coincide con la búsqueda." : "Este módulo no tiene parámetros."} />

      {abierto && <ParametroEditor clave={abierto} onClose={() => setAbierto(null)} onCambio={() => setVersion((v) => v + 1)} />}
    </div>
  );
}
