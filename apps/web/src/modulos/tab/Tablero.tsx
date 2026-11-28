"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Printer, RefreshCw, Snowflake } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, buttonClass, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import {
  Cambio, ErrorCarga, Extras, FiltroMes, OrigenBadge, Semaforo, Tarjeta, capital, consulta, hoyLima, rutaDetalle, valorDe,
  useDatos, type Extra, type Indicador,
} from "./comunes";

type Datos = {
  tablero: { code: string; name: string; screen: string; roles: string[] };
  mes: string; nombre_mes: string; desde: string; hasta: string; terminado: boolean; futuro: boolean;
  corrida: { run_no: number; finished_at: string; reason: string } | null;
  marca: string | null; local: string | null; nombre_marca: string; nombre_local: string; notas: string[]; modulos_apagados: string[];
  tarjetas: Indicador[]; tabla: Indicador[]; sin_datos: boolean; ultimo_congelado: string | null;
  meses: { value: string; label: string }[]; extras: Extra[]; puede: { exportar: boolean; congelar: boolean };
};

const NOMBRES_MODULO: Record<string, string> = { TEL: "Telefonía", ADS: "Publicidad", CRM: "Conversaciones", CTL: "Control fino", CNT: "Contabilidad" };

/** TAB-01 a TAB-06: un tablero por rol (D-TAB-02) con tarjetas, gráficos y la tabla de todos sus indicadores. */
export function Tablero({ codigo, descripcion, quienes }: { codigo: string; descripcion: string; quienes: string }) {
  return <Suspense><Pantalla codigo={codigo} descripcion={descripcion} quienes={quienes} /></Suspense>;
}

function Pantalla({ codigo, descripcion, quienes }: { codigo: string; descripcion: string; quienes: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const { marca, local } = useSesion();
  const [mes, setMes] = useState(sp.get("mes") ?? hoyLima().slice(0, 7));
  const [actualizando, setActualizando] = useState(false);
  const [bajando, setBajando] = useState(false);
  const q = consulta({ mes }, marca, local);
  const { datos: t, error, cargando, recargar } = useDatos<Datos>(`/v1/tab/tableros/${codigo}?${q}`);
  if (error) return <ErrorCarga error={error} que={quienes} />;

  function cambiarMes(m: string) {
    setMes(m);
    router.replace(`?mes=${m}`, { scroll: false });
  }
  async function actualizar() {
    setActualizando(true);
    try {
      await api("/v1/tab/actualizar", { method: "POST" });
      recargar();
      toast.ok("Valores en vivo recalculados");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setActualizando(false);
    }
  }
  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/tab/tableros/${codigo}/exportar?${q}`, `tablero-${codigo.toLowerCase()}-${mes}.xlsx`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  const columnas: Column<Indicador>[] = [
    { key: "name", header: "Indicador", cardTitle: true, render: (x) => (
      <span className="flex flex-col" title={x.formula}>
        <Link href={rutaDetalle(x.code, mes)} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{x.name}</Link>
        <span className="text-[12px] text-muted">{x.code} · {x.sentido.toLowerCase()}</span>
      </span>) },
    { key: "value", header: "Valor", align: "right", render: (x) => <span className="font-semibold tabular-nums">{x.value === null && x.nocalc ? "Sin cálculo" : valorDe(x.value, x.unit, x.decimals)}</span> },
    { key: "meta", header: "Meta", align: "right", render: (x) => valorDe(x.meta, x.unit, x.decimals) },
    { key: "semaforo", header: "Semáforo", render: (x) => <Semaforo luz={x.semaforo} /> },
    { key: "anterior", header: "Mes anterior", align: "right", hideOnMobile: true, render: (x) => <span className="flex flex-col items-end">{valorDe(x.anterior, x.unit, x.decimals)}<span className="text-[11.5px]"><Cambio x={x} /></span></span> },
    { key: "source", header: "Origen", hideOnMobile: true, render: (x) => <OrigenBadge x={x} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader description={descripcion}
        actions={<div className="flex flex-wrap gap-2 print:hidden">
          {t && !t.terminado && <Button icon={RefreshCw} loading={actualizando} onClick={actualizar}>Actualizar</Button>}
          {t?.puede.exportar && <Button icon={Download} loading={bajando} onClick={exportar}>Excel</Button>}
          <Button icon={Printer} onClick={() => window.print()}>Imprimir o PDF</Button>
        </div>} />
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <FiltroMes meses={t?.meses ?? []} value={mes} onChange={cambiarMes} />
        {t?.puede.congelar && <Link href="/m/tab/tab-09" className={buttonClass("secondary", "sm", "gap-1.5")}><Snowflake size={15} /> Cierre de indicadores</Link>}
      </div>
      {t && (
        <p className="text-[12.5px] text-muted">
          {capital(t.nombre_mes)} · {t.nombre_marca} · {t.nombre_local} ·{" "}
          {t.corrida ? `congelado el ${fechaHora(t.corrida.finished_at)} (corrida ${t.corrida.run_no})` : t.futuro ? "mes futuro" : t.terminado ? "mes terminado, aún sin congelar: valores en vivo" : "mes en curso: valores en vivo, se recalculan cada 15 minutos"}
        </p>)}
      {t?.notas.map((n) => <Alert key={n} tone="info">{n}</Alert>)}
      {t && t.sin_datos && !t.futuro && (
        <Alert tone="warn" title={`No hay movimientos en ${t.nombre_mes}`}>
          Los datos de prueba llegan hasta el 10 de octubre de 2026.{" "}
          {t.ultimo_congelado && <button type="button" className="font-medium underline" onClick={() => cambiarMes(t.ultimo_congelado!.slice(0, 7))}>Ver {t.ultimo_congelado.slice(0, 7) === "2026-10" ? "octubre de 2026" : "el último mes congelado"}</button>}
        </Alert>)}
      {t && t.modulos_apagados.length > 0 && (
        <p className="text-[12.5px] text-muted">No se muestran los indicadores de {t.modulos_apagados.map((m) => NOMBRES_MODULO[m] ?? m).join(", ")}: el módulo está apagado para tu empresa (RN-TAB-07).</p>)}

      {cargando && !t && <p className="text-[13px] text-muted">Calculando el tablero…</p>}
      {t && t.tarjetas.length > 0 && (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
          {t.tarjetas.map((x) => <Tarjeta key={x.code} x={x} mes={t.mes.slice(0, 7)} />)}
        </div>)}
      {t && <Extras extras={t.extras} />}
      {t && (
        <div className="space-y-2">
          <h2 className="text-[14.5px] font-semibold text-ink">Todos los indicadores del tablero</h2>
          <DataTable rows={t.tabla} columns={columnas} rowKey={(x) => x.code} loading={cargando}
            onRowClick={(x) => router.push(rutaDetalle(x.code, t.mes.slice(0, 7)))} empty="Este tablero no tiene indicadores activos." />
          <p className="text-[12px] text-muted">Pasa el cursor sobre un indicador para ver cómo se calcula; tócalo para ver el detalle que lo forma.</p>
        </div>)}
    </div>
  );
}
