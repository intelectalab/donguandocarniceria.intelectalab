"use client";

import { useState } from "react";
import Link from "next/link";
import { RefreshCw, Snowflake } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { ErrorCarga, Seccion, capital, useDatos } from "@/modulos/tab/comunes";

type Mes = { mes: string; nombre: string; terminado: boolean; estado: "FROZEN" | "OPEN" | "CURRENT"; corrida: number | null; congelado: string | null; indicadores: number | null;
  motivo: string | null; corridas: number; dias: number | null };
type Corrida = { id: string; period: string; nombre: string; run_no: number; status: "RUNNING" | "OK" | "FAILED"; kpis_count: number; started_at: string; finished_at: string | null;
  user: string | null; reason: string | null; error: string | null };
type Datos = { meses: Mes[]; corridas: Corrida[]; dia: number };

const ESTADOS: Record<string, [string, Tone]> = { FROZEN: ["Congelado", "ok"], OPEN: ["Terminado, sin congelar", "warn"], CURRENT: ["En curso", "info"] };
const CORRIDAS: Record<string, [string, Tone]> = { OK: ["Correcta", "ok"], FAILED: ["Falló", "bad"], RUNNING: ["Congelando", "info"] };

/** TAB-09 Cierre de indicadores: meses con su corrida vigente; congelar un mes terminado o recalcularlo con motivo (RN-TAB-03 y 10). */
export default function Cierre() {
  const { can } = useSesion();
  const puede = can("tab.snapshot.run");
  const { datos, error, cargando, recargar } = useDatos<Datos>("/v1/tab/cierre");
  const [trabajando, setTrabajando] = useState("");
  if (error) return <ErrorCarga error={error} que="" />;

  async function congelar(m: Mes) {
    const recalcular = m.estado === "FROZEN";
    const r = await confirmAction({
      title: recalcular ? `¿Recalcular ${m.nombre}?` : `¿Congelar ${m.nombre}?`,
      message: recalcular
        ? `Se crea la corrida ${m.corridas + 1} con los datos de hoy y el tablero pasa a usarla. La corrida ${m.corrida} se conserva.`
        : "Se guardan los valores de todos los indicadores del mes, para toda la empresa, cada marca y cada local. Tarda unos segundos.",
      confirmLabel: recalcular ? "Recalcular" : "Congelar",
      ...(recalcular ? { reason: { label: "Motivo (al menos 10 caracteres)", min: 10 } } : {}),
    });
    if (!r) return;
    setTrabajando(m.mes);
    try {
      const x = await api<{ mensaje: string }>("/v1/tab/cierre/congelar", { method: "POST", body: { mes: m.mes.slice(0, 7), motivo: r.reason ?? null } });
      toast.ok(x.mensaje);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTrabajando("");
      recargar();
    }
  }

  const meses = datos?.meses ?? [];
  const ultimo = meses.find((m) => m.estado === "FROZEN");
  const abiertos = meses.filter((m) => m.estado === "OPEN").length;
  const fallidas = (datos?.corridas ?? []).filter((c) => c.status === "FAILED").length;

  const columnas: Column<Mes>[] = [
    { key: "nombre", header: "Mes", cardTitle: true, render: (m) => <Link href={`/m/tab/tab-01?mes=${m.mes.slice(0, 7)}`} className="font-medium text-primary hover:underline">{capital(m.nombre)}</Link> },
    { key: "estado", header: "Estado", render: (m) => <StatusBadge status={m.estado} labels={ESTADOS} /> },
    { key: "corrida", header: "Corrida vigente", render: (m) => (m.corrida ? <span>Corrida {m.corrida}{m.corridas > 1 && <span className="text-muted"> de {m.corridas}</span>}</span> : m.corridas ? <span className="text-muted">{m.corridas} sin éxito</span> : "—") },
    { key: "congelado", header: "Congelado", render: (m) => (m.congelado ? fechaHora(m.congelado) : "—") },
    { key: "indicadores", header: "Valores", align: "right", hideOnMobile: true, render: (m) => m.indicadores ?? "—" },
    { key: "dias", header: "Días al cierre", align: "right", hideOnMobile: true, render: (m) => (m.dias === null ? "—" : <span className={m.dias > (datos?.dia ?? 3) ? "text-warn" : ""}>{m.dias}</span>) },
    { key: "motivo", header: "Motivo", hideOnMobile: true, render: (m) => <span className="line-clamp-2 max-w-[22rem] text-[12.5px] text-muted">{m.motivo ?? ""}</span> },
    ...(puede ? [{ key: "acc", header: "", render: (m: Mes) => (m.estado === "CURRENT" ? null : (
      <Button size="sm" icon={m.estado === "FROZEN" ? RefreshCw : Snowflake} variant={m.estado === "OPEN" ? "primary" : "secondary"} loading={trabajando === m.mes} disabled={Boolean(trabajando)}
        onClick={() => congelar(m)}>{m.estado === "FROZEN" ? "Recalcular" : "Congelar"}</Button>)) } as Column<Mes>] : []),
  ];
  const columnasCorridas: Column<Corrida>[] = [
    { key: "nombre", header: "Mes", cardTitle: true, render: (c) => `${capital(c.nombre)} · corrida ${c.run_no}` },
    { key: "status", header: "Resultado", render: (c) => <StatusBadge status={c.status} labels={CORRIDAS} /> },
    { key: "started_at", header: "Inicio", render: (c) => fechaHora(c.started_at) },
    { key: "kpis_count", header: "Valores", align: "right", render: (c) => c.kpis_count },
    { key: "user", header: "Por", hideOnMobile: true, render: (c) => c.user ?? "—" },
    { key: "reason", header: "Motivo o error", render: (c) => <span className="text-[12.5px]">{c.reason}{c.error && <span className="block text-bad">{c.error}</span>}</span> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader description={`Un mes terminado se congela solo el día ${datos?.dia ?? 3} del mes siguiente a las 02:00 (hora de Lima). Un mes congelado se lee de su última corrida correcta; recalcularlo crea una corrida nueva con motivo y la anterior se conserva.`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Último mes congelado" valor={ultimo ? capital(ultimo.nombre) : cargando ? undefined : "Ninguno"} detalle={ultimo ? `corrida ${ultimo.corrida}` : ""} destacada />
        <Cifra titulo="Días al cierre" valor={ultimo?.dias !== null && ultimo?.dias !== undefined ? String(ultimo.dias) : "—"} detalle="KPI-TAB-02: del fin de mes a la primera corrida" />
        <Cifra titulo="Meses sin congelar" valor={datos ? String(abiertos) : undefined} detalle="ya terminados" tono={abiertos ? "warn" : "ok"} />
        <Cifra titulo="Corridas fallidas" valor={datos ? String(fallidas) : undefined} detalle="no reemplazan a la anterior" tono={fallidas ? "bad" : undefined} />
      </div>
      {!puede && <Alert tone="info">Congelar o recalcular un mes lo hacen Gerencia y Administración. Aquí puedes ver el estado de cada mes.</Alert>}
      <DataTable rows={meses} columns={columnas} rowKey={(m) => m.mes} loading={cargando} empty="Sin meses." />
      <Seccion titulo={<>Todas las corridas <Badge>{datos?.corridas.length ?? 0}</Badge></>}>
        <DataTable rows={datos?.corridas ?? []} columns={columnasCorridas} rowKey={(c) => c.id} loading={cargando} empty="Aún no hay corridas." />
      </Seccion>
    </div>
  );
}
