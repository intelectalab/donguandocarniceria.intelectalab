"use client";

import { useEffect, useState } from "react";
import { CalendarDays, History, KeyRound, Users } from "lucide-react";
import { Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { ParametroEditor } from "@/modulos/plt/ParametroEditor";
import { AMBITOS_PARAMETRO, formatoParametro, type CambioParametro } from "@/modulos/plt/tipos";

type Extra = {
  resumen: { cambios: number; parametros: number; usuarios: number; ultimo: { key: string; changed_at: string } | null };
  filtros: { modulos: string[]; claves: string[]; usuarios: string[] };
};

/** PLT-11 Historial de parámetros: quién cambió qué, cuándo, el valor anterior y el nuevo, y por qué. */
export default function HistorialParametros() {
  const [modulo, setModulo] = useState("");
  const [clave, setClave] = useState("");
  const [usuario, setUsuario] = useState("");
  const [ambito, setAmbito] = useState("");
  const lista = useListado<CambioParametro>("/v1/plt/parametros/historial", {
    orden: "-changed_at", filtros: { module_code: modulo, key: clave, changed_by: usuario, scope: ambito },
  });
  const [extra, setExtra] = useState<Extra | null>(null);
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);

  // Cifras y opciones de los filtros (vienen con la lista; se piden una vez y al cambiar algo).
  useEffect(() => {
    let vigente = true;
    api<Extra>("/v1/plt/parametros/historial?per_page=1").then((r) => vigente && setExtra({ resumen: r.resumen, filtros: r.filtros })).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const r = extra?.resumen;
  const fmt = (c: CambioParametro, v: string | null) => formatoParametro(v, c.value_type, c.unit, c.options);

  const columnas: Column<CambioParametro>[] = [
    { key: "changed_at", header: "Fecha", sortable: true, render: (c) => <span className="whitespace-nowrap">{fechaHora(c.changed_at)}</span> },
    { key: "key", header: "Clave", sortable: true, cardTitle: true, render: (c) => <span className="font-mono text-[12.5px]">{c.key}</span> },
    { key: "module_code", header: "Módulo", sortable: true, hideOnMobile: true, render: (c) => <span className="font-mono">{c.module_code ?? "—"}</span> },
    { key: "scope", header: "Para", hideOnMobile: true, render: (c) => c.scope === "TENANT" ? "Empresa" : `${AMBITOS_PARAMETRO[c.scope]} ${c.ambito_nombre ?? ""}` },
    { key: "cambio", header: "Cambio", render: (c) => <span className="whitespace-nowrap"><span className="text-muted">{fmt(c, c.old_value)}</span> → <b>{fmt(c, c.new_value)}</b></span> },
    { key: "changed_by", header: "Por", sortable: true },
    { key: "reason", header: "Motivo", render: (c) => <span className="block max-w-[320px]">{c.reason}</span> },
  ];

  const opciones = (xs: string[] | undefined) => (xs ?? []).map((x) => ({ value: x, label: x }));

  return (
    <div className="space-y-5">
      <PageHeader description="Cada cambio de un parámetro: quién lo hizo, cuándo, el valor anterior y el nuevo, y el motivo. No se edita ni se borra. Lo que ya se calculó con el valor anterior no se recalcula." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cambios" icono={History} destacada valor={r ? numero(r.cambios) : undefined} detalle="" />
        <Cifra titulo="Parámetros distintos" icono={KeyRound} valor={r ? numero(r.parametros) : undefined} detalle="" />
        <Cifra titulo="Usuarios" icono={Users} valor={r ? numero(r.usuarios) : undefined} detalle="Que hicieron cambios" />
        <Cifra titulo="Último cambio" icono={CalendarDays} valor={r ? (r.ultimo ? fecha(r.ultimo.changed_at) : "—") : undefined} detalle={r?.ultimo?.key ?? ""} />
      </div>

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar clave, motivo o persona…" }}
        onRowClick={(c) => setAbierto(c.key)}
        empty="Todavía no hay cambios de parámetros."
        toolbar={<>
          <Filtro label="Módulo" value={modulo} onChange={setModulo} options={opciones(extra?.filtros.modulos)} />
          <Filtro label="Clave" value={clave} onChange={setClave} options={opciones(extra?.filtros.claves)} />
          <Filtro label="Persona" value={usuario} onChange={setUsuario} options={opciones(extra?.filtros.usuarios)} />
          <Filtro label="Para" value={ambito} onChange={setAmbito}
            options={[{ value: "TENANT", label: "Empresa" }, { value: "ESTABLISHMENT", label: "Un local" }, { value: "BRAND", label: "Una marca" }]} />
        </>} />

      {abierto && (
        <ParametroEditor clave={abierto} onClose={() => setAbierto(null)} onCambio={() => { lista.recargar(); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
