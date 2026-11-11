"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, KeyRound, Lock, ShieldAlert, Timer, XCircle } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, Field, Input, PageHeader, Select, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ParametroEditor } from "@/modulos/plt/ParametroEditor";
import { formatoParametro, sinCodigos, type Parametro } from "@/modulos/plt/tipos";

type Cambio = { id: string; key: string; old_value: string | null; new_value: string | null; reason: string; changed_by: string; changed_at: string; scope: string; description: string | null };

type Politica = {
  parametros: Omit<Parametro, "module_code" | "allowed_scopes">[];
  regla: string;
  mes: { desde: string; bloqueos: number; fallidos: number; intentos: number; tasa_fallidos: number };
};

/** Grupos de la política, como el prototipo. */
const GRUPOS: { titulo: string; icono: typeof Lock; re: RegExp }[] = [
  { titulo: "Contraseñas", icono: KeyRound, re: /password/ },
  { titulo: "Bloqueo", icono: Lock, re: /failed|lockout/ },
  { titulo: "Sesiones", icono: Timer, re: /session|concurrent/ },
  { titulo: "Segundo factor y recuperación", icono: ShieldAlert, re: /totp|recovery|reset/ },
  { titulo: "Dispositivos y revisión", icono: Circle, re: /mobile_device|inactive/ },
];

/**
 * SEG-14 Política de contraseñas y sesiones: los parámetros de Seguridad con su valor vigente y su
 * historial. Cambiarlos exige el permiso de la política (o el de parámetros) y un motivo.
 */
export default function PoliticaSeguridad() {
  const { can } = useSesion();
  const [p, setP] = useState<Politica | null>(null);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [clave, setClave] = useState("");
  const historial = useListado<Cambio>("/v1/seg/politica/historial", { orden: "-changed_at", porPagina: 10, filtros: { key: clave } });
  const puede = can("seg.policy.edit") || can("plt.parameter.edit");
  const recargarHistorial = historial.recargar;

  const cargar = useCallback(() => {
    api<Politica>("/v1/seg/politica").then(setP).catch((e) => setError(mensajeDe(e)));
    recargarHistorial();
  }, [recargarHistorial]);
  useEffect(() => { cargar(); }, [cargar]);

  const porClave = new Map((p?.parametros ?? []).map((x) => [x.key, x]));
  const fmt = (key: string, v: string | null) => {
    const d = porClave.get(key);
    return d ? formatoParametro(v, d.value_type, d.unit, d.options) : v ?? "—";
  };

  const colHistorial: Column<Cambio>[] = [
    { key: "changed_at", header: "Fecha", sortable: true, cardTitle: true, render: (h) => fechaHora(h.changed_at) },
    { key: "key", header: "Parámetro", sortable: true, render: (h) => sinCodigos(h.description) || <span className="font-mono text-[12px]">{h.key}</span> },
    { key: "cambio", header: "Cambio", render: (h) => <span>{fmt(h.key, h.old_value)} → <b>{fmt(h.key, h.new_value)}</b></span> },
    { key: "changed_by", header: "Usuario", sortable: true, hideOnMobile: true },
    { key: "reason", header: "Motivo", hideOnMobile: true },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los parámetros de Seguridad con su valor vigente y su historial. Cambiarlos exige el permiso de la política y un motivo; rigen desde el siguiente inicio de sesión o la siguiente petición." />
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Bloqueos del mes" valor={p ? numero(p.mes.bloqueos) : undefined} detalle="Cuentas bloqueadas por intentos" icono={Lock} tono={p?.mes.bloqueos ? "warn" : "ok"} destacada />
        <Cifra titulo="Inicios fallidos" valor={p ? porcentaje(p.mes.tasa_fallidos, 1) : undefined} detalle={p ? `${numero(p.mes.fallidos)} de ${numero(p.mes.intentos)} intentos del mes` : undefined} icono={XCircle} />
        <Cifra titulo="Largo mínimo" valor={p ? fmt("seg_password_min_length", porClave.get("seg_password_min_length")?.value ?? null) : undefined} detalle="De la contraseña" icono={KeyRound} />
        <Cifra titulo="Sesiones a la vez" valor={p ? fmt("seg_max_concurrent_sessions", porClave.get("seg_max_concurrent_sessions")?.value ?? null) : undefined} detalle="Por usuario" icono={Timer} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
        {GRUPOS.map((g) => {
          const filas = (p?.parametros ?? []).filter((x) => g.re.test(x.key));
          return (
            <section key={g.titulo} className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
              <h2 className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13.5px] font-semibold"><g.icono size={15} className="text-primary" />{g.titulo}</h2>
              <ul className="divide-y divide-line">
                {!p && <li className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-surface-2" /></li>}
                {filas.map((x) => (
                  <li key={x.key}>
                    <button type="button" onClick={() => setEditando(x.key)}
                      className="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                      <span className="min-w-0 text-[13px]">{sinCodigos(x.description)}</span>
                      <span className="shrink-0 text-right">
                        <b className="text-[13.5px]">{formatoParametro(x.value, x.value_type, x.unit, x.options)}</b>
                        {x.source === "TENANT" && <span className="block"><Badge tone="primary">Propio</Badge></span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {!puede && <p className="text-[12.5px] text-muted">Solo lectura: cambiar la política exige su permiso.</p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <ProbarPolitica regla={p?.regla} />
        <section className="min-w-0 space-y-2">
          <h2 className="text-[14px] font-semibold">Historial de la política</h2>
          <DataTable {...historial.tabla} columns={colHistorial}
            search={{ ...historial.tabla.search, placeholder: "Buscar parámetro, motivo o usuario…" }}
            empty={clave || historial.tabla.search.value ? "Sin cambios con esos filtros." : "Sin cambios: rigen los valores por defecto."}
            toolbar={
              <div className="w-full sm:w-[230px]">
                <Select aria-label="Parámetro" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Parámetro: todos"
                  options={(p?.parametros ?? []).map((x) => ({ value: x.key, label: sinCodigos(x.description) }))} className="!min-h-9 h-9 py-1.5 text-[13px]" />
              </div>
            } />
        </section>
      </div>

      {editando && <ParametroEditor clave={editando} onClose={() => setEditando(null)} onCambio={cargar} />}
    </div>
  );
}

/** Prueba una contraseña contra la política con tu usuario. No se guarda ni se registra. */
function ProbarPolitica({ regla }: { regla?: string }) {
  const [clave, setClave] = useState("");
  const [checks, setChecks] = useState<{ etiqueta: string; ok: boolean }[] | null>(null);

  useEffect(() => {
    let vigente = true;
    const t = setTimeout(() => {
      api<{ checks: { etiqueta: string; ok: boolean }[] }>("/v1/seg/politica/probar", { method: "POST", body: { password: clave } })
        .then((r) => vigente && setChecks(r.checks)).catch(() => {});
    }, clave ? 400 : 0);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]);

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
      <h2 className="mb-1 text-[14px] font-semibold">Probar la política con tu usuario</h2>
      {regla && <p className="mb-3 text-[12.5px] text-muted">{regla}</p>}
      <Field label="Contraseña de prueba" hint="No se guarda ni queda registrada.">
        <Input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" maxLength={200} />
      </Field>
      <ul className="mt-3 space-y-1.5">
        {(checks ?? []).map((c) => (
          <li key={c.etiqueta} className="flex items-center gap-2 text-[13px]">
            {clave && c.ok ? <CheckCircle2 size={16} className="shrink-0 text-ok" /> : clave ? <XCircle size={16} className="shrink-0 text-bad" /> : <Circle size={16} className="shrink-0 text-muted" />}
            <span className={clave && !c.ok ? "text-ink" : "text-muted"}>{c.etiqueta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
