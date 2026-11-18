"use client";

import { useState } from "react";
import { CalendarCheck, CalendarX, DollarSign, TrendingUp } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { SelectorMes } from "@/modulos/mae/SelectorMes";
import { mesesEntre, nombreMes, tc, useDatos } from "@/modulos/mae/tipos";

type Fila = { id: string; buy: number; sell: number; loaded_via: string | null; loaded_by: string | null; edit_reason: string | null; edited_by: string | null };
type Dia = { date: string; habil: boolean; feriado: string | null; futuro: boolean; fila: Fila | null; respaldo: { sell: number; fecha_usada: string } | null };
type Aplicable = { buy: number; sell: number; fecha_usada: string; respaldo: boolean } | { error: string };
type Manual = { id: string; date: string; buy: string | number; sell: string | number; loaded_via: string | null; loaded_by: string | null; edited_by: string | null; edit_reason: string | null; updated_at: string | null };
type Datos = {
  mes: string; moneda: string; dias: Dia[]; hoy: string; aplicable_hoy: Aplicable; meses_desde: string; fuente: string;
  cobertura: { valor: number; cargados: number; habiles: number; faltan: string[] };
  parametros: { dias_respaldo: number; hora_carga: string };
};

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORIGEN: Record<string, string> = { SUNAT: "SUNAT", MANUAL: "Manual", IMPORT: "Importado" };
const diaSemana = (d: string) => new Date(`${d}T12:00:00`).getDay();

/**
 * MAE-05 Tipo de cambio: calendario de compra y venta por día, con su origen (SUNAT, manual, importado), los días hábiles
 * sin carga resaltados y el que se usa en su lugar (RN-MAE-07). Corregir exige motivo y el permiso mae.exchange_rate.edit
 * (RN-MAE-08). La contadora entra por ese permiso aunque no tenga el resto de MAE.
 */
export default function TipoDeCambio() {
  const { can } = useSesion();
  const [mes, setMes] = useState("");
  const { datos, error, recargar } = useDatos<Datos>(`/v1/mae/tipo-cambio${mes ? `?mes=${mes}` : ""}`);
  const [dia, setDia] = useState<Dia | null>(null);
  const [registrar, setRegistrar] = useState<{ fecha: string; fila: Fila | null } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState({ tipo: "", desde: "", hasta: "" });
  const registros = useListado<Manual>("/v1/mae/tipo-cambio/registros", { orden: "-date", porPagina: 10, filtros: filtro });
  const actualizar = () => { recargar(); registros.recargar(); };
  const edita = can("mae.exchange_rate.edit");
  const ap = datos?.aplicable_hoy;
  const apOk = ap && !("error" in ap) ? ap : null;
  const c = datos?.cobertura;

  async function cargarDeFuente(f: string) {
    setCargando(true);
    try {
      const r = await api<{ cargado: boolean; mensaje: string }>("/v1/mae/tipo-cambio/cargar", { method: "POST", body: { date: f } });
      if (r.cargado) toast.ok(r.mensaje); else toast.info(r.mensaje);
      setDia(null);
      actualizar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }

  const huecos = datos ? (diaSemana(datos.dias[0].date) + 6) % 7 : 0;
  const columnas: Column<Manual>[] = [
    { key: "date", header: "Fecha", cardTitle: true, sortable: true, render: (x) => fecha(x.date) },
    { key: "buy", header: "Compra", align: "right", sortable: true, render: (x) => <span className="font-mono">{tc(Number(x.buy))}</span> },
    { key: "sell", header: "Venta", align: "right", sortable: true, render: (x) => <span className="font-mono">{tc(Number(x.sell))}</span> },
    { key: "loaded_via", header: "Origen", sortable: true, render: (x) => ORIGEN[x.loaded_via ?? ""] ?? x.loaded_via ?? "—" },
    { key: "por", header: "Cargó o corrigió", hideOnMobile: true, render: (x) => x.edited_by ?? x.loaded_by ?? "—" },
    { key: "edit_reason", header: "Motivo de corrección", render: (x) => x.edit_reason ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Compra y venta diarias desde SUNAT (carga automática a las ${datos?.parametros.hora_carga ?? "09:00"}) o a mano. Sin publicación se usa el último publicado.`}
        actions={edita ? <>
          <Button onClick={() => datos && cargarDeFuente(datos.hoy)} loading={cargando} disabled={!datos}>Cargar de SUNAT hoy</Button>
          <Button variant="primary" onClick={() => datos && setRegistrar({ fecha: datos.hoy, fila: null })} disabled={!datos}>Registrar a mano</Button>
        </> : undefined} />

      <Alert tone="info">
        Se usa la venta SUNAT del día o el último publicado dentro de {datos?.parametros.dias_respaldo ?? 7} días (valor a confirmar por la contadora).
        {datos && datos.fuente === "Sin conector" && " Todavía no hay conector con SUNAT: por ahora se registra a mano."}
      </Alert>
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Venta aplicable hoy" valor={datos ? (apOk ? tc(apOk.sell) : "—") : undefined} icono={DollarSign} destacada
          detalle={datos ? (apOk ? (apOk.respaldo ? `del ${fecha(apOk.fecha_usada)} (último publicado)` : "publicado hoy") : "Sin tipo de cambio: los documentos no se graban") : undefined}
          tono={apOk?.respaldo ? "warn" : !apOk && datos ? "bad" : undefined} />
        <Cifra titulo="Compra aplicable hoy" valor={datos ? (apOk ? tc(apOk.buy) : "—") : undefined} icono={TrendingUp} />
        <Cifra titulo="Días hábiles con carga" valor={c ? `${c.valor.toLocaleString("es-PE", { maximumFractionDigits: 1 })} %` : undefined} icono={CalendarCheck}
          detalle={c ? `${c.cargados} de ${c.habiles} en ${nombreMes(datos!.mes)}` : undefined} tono={c ? (c.valor < 100 ? "warn" : "ok") : undefined} />
        <Cifra titulo="Días hábiles sin carga" valor={c ? String(c.faltan.length) : undefined} icono={CalendarX}
          detalle={c ? (c.faltan.map((d) => d.slice(8)).join(", ") || "ninguno") : undefined} tono={c?.faltan.length ? "bad" : undefined} />
      </div>

      {datos && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold first-letter:uppercase">{nombreMes(datos.mes)} · {datos.moneda} (compra / venta)</h2>
            <SelectorMes meses={mesesEntre(datos.meses_desde < datos.mes ? datos.meses_desde : datos.mes, datos.hoy.slice(0, 7))} actual={datos.mes} onChange={setMes} />
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {DIAS.map((d) => <div key={d} className="text-center text-[11.5px] text-muted">{d}</div>)}
            {Array.from({ length: huecos }, (_, i) => <div key={`h${i}`} />)}
            {datos.dias.map((d) => <Celda key={d.date} dia={d} onClick={() => setDia(d)} />)}
          </div>
          <p className="mt-3 text-[12px] text-muted">Clic en un día para ver o corregir. En rojo, los días hábiles sin carga; en ámbar, los corregidos. La flecha indica la venta que se usa ese día.</p>
        </section>
      )}

      {datos && <Consulta hoy={datos.hoy} />}

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">Cargas manuales y correcciones</h2>
        <DataTable {...registros.tabla} columns={columnas} empty="Sin cargas manuales ni correcciones con esos filtros."
          search={{ ...registros.tabla.search, placeholder: "Buscar quién cargó o el motivo…" }}
          toolbar={<>
            <div className="w-full sm:w-[170px]">
              <Select aria-label="Tipo" value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })} placeholder="Tipo: todos"
                className="!min-h-9 h-9 py-1.5 text-[13px]" options={[{ value: "MANUAL", label: "Cargas manuales" }, { value: "CORREGIDO", label: "Correcciones" }]} />
            </div>
            <div className="w-full sm:w-[150px]">
              <Input type="date" aria-label="Desde" title="Desde" value={filtro.desde} max={filtro.hasta || undefined} className="!min-h-9 h-9 py-1.5 text-[13px]"
                onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} />
            </div>
            <div className="w-full sm:w-[150px]">
              <Input type="date" aria-label="Hasta" title="Hasta" value={filtro.hasta} min={filtro.desde || undefined} className="!min-h-9 h-9 py-1.5 text-[13px]"
                onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} />
            </div>
          </>} />
      </section>

      {dia && datos && (
        <Modal open title={`Tipo de cambio del ${fecha(dia.date)}`} onClose={() => setDia(null)}
          footer={edita && !dia.futuro ? <>
            {dia.habil && !dia.fila && <Button onClick={() => cargarDeFuente(dia.date)} loading={cargando}>Cargar de SUNAT</Button>}
            <Button variant="primary" onClick={() => { setRegistrar({ fecha: dia.date, fila: dia.fila }); setDia(null); }}>{dia.fila ? "Corregir" : "Registrar a mano"}</Button>
          </> : undefined}>
          <div className="space-y-4">
            <DetailList items={[
              { label: "Día", value: `${DIA_LARGO[diaSemana(dia.date)]} ${fecha(dia.date)}${dia.feriado ? ` · feriado: ${dia.feriado}` : ""}` },
              { label: "Hábil", value: dia.habil ? "Sí" : "No" },
              ...(dia.fila ? [
                { label: "Compra", value: tc(dia.fila.buy) }, { label: "Venta", value: tc(dia.fila.sell) },
                { label: "Origen", value: ORIGEN[dia.fila.loaded_via ?? ""] ?? dia.fila.loaded_via ?? "—" }, { label: "Cargado por", value: dia.fila.loaded_by ?? "—" },
                ...(dia.fila.edit_reason ? [{ label: "Corrección", value: `${dia.fila.edit_reason}${dia.fila.edited_by ? ` (${dia.fila.edited_by})` : ""}` }] : []),
              ] : []),
            ]} />
            {!dia.fila && !dia.futuro && (dia.respaldo
              ? <Alert tone="warn">Sin publicación: los documentos de este día usan la venta {tc(dia.respaldo.sell)} del {fecha(dia.respaldo.fecha_usada)}.</Alert>
              : <Alert tone="bad">Sin tipo de cambio ese día ni en los {datos.parametros.dias_respaldo} anteriores: los documentos en dólares de esa fecha no se graban.</Alert>)}
            {dia.futuro && <p className="text-[13px] text-muted">Es una fecha futura: todavía no hay tipo de cambio.</p>}
            {!edita && <Alert tone="info">Registrar o corregir el tipo de cambio exige el permiso de editarlo.</Alert>}
          </div>
        </Modal>
      )}

      {registrar && (
        <Registrar fecha={registrar.fecha} fila={registrar.fila} hoy={datos?.hoy ?? ""} onClose={() => setRegistrar(null)}
          onGuardado={() => { setRegistrar(null); actualizar(); }} />
      )}
    </div>
  );
}

function Celda({ dia, onClick }: { dia: Dia; onClick: () => void }) {
  const f = dia.fila;
  const fondo = f ? (f.edit_reason ? "bg-warn-soft" : "bg-surface") : dia.futuro ? "bg-transparent" : dia.habil ? "bg-bad-soft" : "bg-surface-2";
  return (
    <button type="button" onClick={onClick} title={dia.feriado ?? undefined}
      className={`min-h-[58px] min-w-0 cursor-pointer overflow-hidden rounded-md border border-line p-1 text-left hover:border-primary sm:p-1.5 ${fondo}`}>
      <div className="flex items-start justify-between gap-0.5">
        <b className="text-[12px]">{Number(dia.date.slice(8))}</b>
        {f && <span className="hidden text-[10px] text-muted sm:inline">{f.loaded_via === "SUNAT" ? "SUNAT" : f.loaded_via === "MANUAL" ? "manual" : "import."}</span>}
      </div>
      {f ? (
        <div className="font-mono text-[10.5px] leading-tight sm:text-[11.5px]">{tc(f.buy)}<br /><b>{tc(f.sell)}</b></div>
      ) : !dia.futuro && (
        <div className={`text-[10.5px] leading-tight sm:text-[11.5px] ${dia.habil ? "text-bad" : "text-muted"}`}>
          {dia.habil ? "Sin carga" : dia.feriado ? "Feriado" : "No publica"}
          {dia.respaldo && <div className="font-mono text-[10px]">→ {tc(dia.respaldo.sell)}</div>}
        </div>
      )}
    </button>
  );
}

/** RN-MAE-07: qué tipo de cambio usa un documento de una fecha y cuánto da en soles. */
function Consulta({ hoy }: { hoy: string }) {
  const [v, setV] = useState({ fecha: hoy, monto: "250" });
  const [r, setR] = useState<{ ok: true; sell: number; fecha_usada: string; respaldo: boolean; soles: number } | { ok: false; texto: string } | null>(null);
  async function calcular() {
    try {
      const x = await api<{ sell: number; fecha_usada: string; respaldo: boolean; soles: number }>(`/v1/mae/tipo-cambio/para?date=${v.fecha}&amount=${Number(v.monto) || 0}`);
      setR({ ok: true, ...x });
    } catch (e) {
      setR({ ok: false, texto: mensajeDe(e) });
    }
  }
  const monto = (Number(v.monto) || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">¿Qué tipo de cambio usa un documento?</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end [&>*]:min-w-0">
        <Field label="Fecha del documento"><Input type="date" value={v.fecha} onChange={(e) => { setV({ ...v, fecha: e.target.value }); setR(null); }} /></Field>
        <Field label="Monto en US$"><Input type="number" min={0} step="0.01" value={v.monto} onChange={(e) => { setV({ ...v, monto: e.target.value }); setR(null); }} /></Field>
        <Button variant="primary" onClick={calcular} disabled={!v.fecha}>Calcular</Button>
      </div>
      {r && <div className="mt-3">{r.ok
        ? <Alert tone={r.respaldo ? "warn" : "ok"}>Se usa la venta {tc(r.sell)} del {fecha(r.fecha_usada)}{r.respaldo ? " (último publicado)" : ""}: US$ {monto} = {soles(r.soles)}.</Alert>
        : <Alert tone="bad">{r.texto}</Alert>}</div>}
    </section>
  );
}

/** Registrar a mano o corregir (RN-MAE-06 y 08): corregir pide un motivo de al menos 10 caracteres y queda en la auditoría. */
function Registrar({ fecha: f, fila, hoy, onClose, onGuardado }: { fecha: string; fila: Fila | null; hoy: string; onClose: () => void; onGuardado: () => void }) {
  const [v, setV] = useState({ date: f, buy: fila ? String(fila.buy) : "", sell: fila ? String(fila.sell) : "", reason: "" });
  return (
    <Dialogo titulo={fila ? `Corregir el tipo de cambio del ${fecha(f)}` : "Registrar tipo de cambio"} boton={fila ? "Guardar corrección" : "Registrar"} onClose={onClose}
      aviso={fila ? "La corrección queda en la auditoría con tu nombre y el motivo." : "Si ese día ya tiene tipo de cambio, se pedirá corregirlo con motivo."}
      enviar={async () => {
        await api("/v1/mae/tipo-cambio", { method: "POST", body: { date: v.date, buy: Number(v.buy), sell: Number(v.sell), reason: v.reason.trim() || null } });
        toast.ok(fila ? "Tipo de cambio corregido" : "Tipo de cambio registrado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Fecha" required error={e.date} className="sm:col-span-2">
          <Input type="date" value={v.date} max={hoy} disabled={!!fila} onChange={(x) => setV({ ...v, date: x.target.value })} />
        </Field>
        <Field label="Compra" required error={e.buy}><Input type="number" min={0} step="0.001" value={v.buy} onChange={(x) => setV({ ...v, buy: x.target.value })} /></Field>
        <Field label="Venta" required error={e.sell}><Input type="number" min={0} step="0.001" value={v.sell} onChange={(x) => setV({ ...v, sell: x.target.value })} /></Field>
        <Field label={fila ? "Motivo de la corrección (mínimo 10 caracteres)" : "Nota (opcional)"} required={!!fila} error={e.reason} className="sm:col-span-2">
          <Textarea value={v.reason} maxLength={255} onChange={(x) => setV({ ...v, reason: x.target.value })} />
        </Field>
        {fila && <div className="sm:col-span-2"><Badge tone="warn">Antes: compra {tc(fila.buy)} · venta {tc(fila.sell)}</Badge></div>}
      </>}
    </Dialogo>
  );
}
