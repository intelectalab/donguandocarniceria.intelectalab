"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Database, Play, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, FiltroSelect, Input, Modal, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { InsigniaPlataforma, TONO_ESTADO, type Opcion } from "@/modulos/ads/comun";

type Corrida = {
  id: string; account_id: string; account_name: string; platform: string; plataforma: string; brand_name: string;
  date_from: string; date_to: string; rows_read: number; rows_upserted: number;
  status: string; estado: string; error: string | null; started_at: string; finished_at: string | null; user: string;
};

type RespImportaciones = Pagina<Corrida> & {
  cifras: { total: number; ok: number; fallidas: number; filas_gasto: number; ultimo_dia: string | null };
  hora_importacion: string;
  dias_ventana: number;
  opciones: { cuentas: Opcion[] };
  ayer: string;
  hace_3_dias: string;
  puede: boolean;
};

/** ADS-04 Importaciones: corridas diarias por cuenta con filas leídas y actualizadas, errores y botón para reimportar un rango. */
export default function ImportacionesDeGasto() {
  const [f, setF] = useState({ estado: "", cuenta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [res, setRes] = useState<RespImportaciones | null>(null);
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<Corrida | null>(null);
  const [modalRango, setModalRango] = useState(false);
  const [rango, setRango] = useState({ account_id: "", from: "", to: "" });
  const [procesando, setProcesando] = useState(false);
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<RespImportaciones>(`/v1/ads/importaciones?${q}${q ? "&" : ""}${pag.qs}`).then((r) => {
      setRes(r);
      setError("");
      if (!rango.account_id && r.opciones.cuentas[0]) {
        setRango({ account_id: r.opciones.cuentas[0].value, from: r.hace_3_dias, to: r.ayer });
      }
    }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, rango.account_id]);
  useEffect(() => cargar(), [cargar]);

  async function correrDiaria() {
    setProcesando(true);
    try {
      const r = await api<{ ok: number; desde: string; hasta: string }>("/v1/ads/importaciones/diaria", { method: "POST" });
      toast.ok(`${r.ok} cuentas importadas (${fecha(r.desde)} al ${fecha(r.hasta)})`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function reimportar(account_id: string, from: string, to: string) {
    setProcesando(true);
    try {
      const r = await api<{ rows_read: number; rows_upserted: number }>("/v1/ads/importaciones/reimportar", {
        method: "POST",
        body: { account_id, from, to },
      });
      toast.ok(`Reimportado: ${r.rows_read} filas leídas, ${r.rows_upserted} actualizadas`);
      setModalRango(false);
      setDetalle(null);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  const c = res?.cifras;
  const cols: Column<Corrida>[] = [
    { key: "started_at", header: "Inicio", render: (r) => fechaHora(r.started_at) },
    { key: "account_name", header: "Cuenta", cardTitle: true, render: (r) => <span className="font-semibold text-ink">{r.account_name}</span> },
    { key: "platform", header: "Plataforma", render: (r) => <InsigniaPlataforma p={r.platform} label={r.plataforma} /> },
    { key: "range", header: "Rango importado", render: (r) => `${fecha(r.date_from)} – ${fecha(r.date_to)}` },
    { key: "rows_read", header: "Leídas", align: "right", render: (r) => numero(r.rows_read) },
    { key: "rows_upserted", header: "Actualizadas", align: "right", render: (r) => numero(r.rows_upserted) },
    { key: "status", header: "Estado", render: (r) => <Badge tone={TONO_ESTADO[r.status]}>{r.estado}</Badge> },
    {
      key: "error", header: "Detalle / error", hideOnMobile: true,
      render: (r) => r.error ? <span className="max-w-[260px] truncate text-[12px] text-bad" title={r.error}>{r.error}</span> : <span className="text-[12px] text-muted">{r.user}</span>,
    },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description={`Corridas diarias a las ${res?.hora_importacion ?? "06:00"} (Lima) con los últimos ${res?.dias_ventana ?? 3} días de cada cuenta activa: filas leídas y actualizadas, errores y reimportación de un rango.`}
        actions={
          res?.puede ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" icon={Play} loading={procesando} onClick={correrDiaria}>Correr importación diaria</Button>
              <Button variant="primary" icon={RefreshCw} onClick={() => setModalRango(true)}>Reimportar un rango</Button>
            </div>
          ) : undefined
        }
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Corridas exitosas" valor={numero(c.ok)} icono={CheckCircle2} destacada detalle={`de ${numero(c.total)} corridas`} />
          <Cifra titulo="Con error" valor={numero(c.fallidas)} icono={AlertTriangle} tono={c.fallidas ? "bad" : "ok"} />
          <Cifra titulo="Filas de gasto" valor={numero(c.filas_gasto)} icono={Database} detalle="una por campaña, anuncio y día" />
          <Cifra titulo="Último día importado" valor={c.ultimo_dia ? fecha(c.ultimo_dia) : "—"} icono={CalendarClock} />
        </div>
      )}

      <DataTable
        rowKey={(r) => r.id}
        columns={cols}
        rows={res?.data ?? []}
        loading={!res && !error}
        pagination={pag.props(res)}
        onRowClick={setDetalle}
        empty="No hay corridas de importación para los filtros seleccionados."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar cuenta, usuario o error…" }}
        toolbar={
          <>
            <FiltroSelect etiqueta="Estado" todos="todos" ancho={160} value={f.estado} onChange={(v) => setF({ ...f, estado: v })}
              options={[{ value: "OK", label: "OK" }, { value: "FAILED", label: "Fallida" }, { value: "PARTIAL", label: "Parcial" }]} />
            <FiltroSelect etiqueta="Cuenta" todos="todas" ancho={220} value={f.cuenta} onChange={(v) => setF({ ...f, cuenta: v })}
              options={res?.opciones.cuentas ?? []} />
          </>
        }
      />

      {detalle && (
        <Modal
          open
          onClose={() => setDetalle(null)}
          title={`Corrida · ${detalle.account_name}`}
          description={`${fecha(detalle.date_from)} al ${fecha(detalle.date_to)}`}
          footer={
            <div className="flex justify-between gap-2 w-full">
              <div>
                {res?.puede && (
                  <Button variant="primary" size="sm" icon={RefreshCw} loading={procesando} onClick={() => reimportar(detalle.account_id, detalle.date_from, detalle.date_to)}>
                    Reimportar este rango
                  </Button>
                )}
              </div>
              <Button variant="ghost" onClick={() => setDetalle(null)}>Cerrar</Button>
            </div>
          }
        >
          <div className="grid gap-4">
            {detalle.error && <Alert tone="bad">{detalle.error}</Alert>}
            <DetailList
              items={[
                { label: "Cuenta", value: detalle.account_name },
                { label: "Plataforma", value: <InsigniaPlataforma p={detalle.platform} label={detalle.plataforma} /> },
                { label: "Rango", value: `${fecha(detalle.date_from)} – ${fecha(detalle.date_to)}` },
                { label: "Filas leídas", value: numero(detalle.rows_read) },
                { label: "Filas actualizadas", value: numero(detalle.rows_upserted) },
                { label: "Inicio", value: fechaHora(detalle.started_at) },
                { label: "Fin", value: fechaHora(detalle.finished_at) },
                { label: "Ejecutó", value: detalle.user },
                { label: "Estado", value: <Badge tone={TONO_ESTADO[detalle.status]}>{detalle.estado}</Badge> },
              ]}
            />
          </div>
        </Modal>
      )}

      {modalRango && res && (
        <Modal
          open
          onClose={() => setModalRango(false)}
          title="Reimportar un rango de fechas"
          description="Reimportar un día reemplaza el valor de ese día por campaña y anuncio sin duplicar filas."
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalRango(false)}>Cancelar</Button>
              <Button variant="primary" loading={procesando} disabled={!rango.account_id || !rango.from || !rango.to} onClick={() => reimportar(rango.account_id, rango.from, rango.to)}>
                Reimportar
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cuenta publicitaria" required className="sm:col-span-2">
              <Select value={rango.account_id} onChange={(e) => setRango({ ...rango, account_id: e.target.value })} options={res.opciones.cuentas} />
            </Field>
            <Field label="Desde" required>
              <Input type="date" max={res.ayer} value={rango.from} onChange={(e) => setRango({ ...rango, from: e.target.value })} />
            </Field>
            <Field label="Hasta (días cerrados)" required>
              <Input type="date" max={res.ayer} value={rango.to} onChange={(e) => setRango({ ...rango, to: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
