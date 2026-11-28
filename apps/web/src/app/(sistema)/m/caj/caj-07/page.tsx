"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, HandCoins } from "lucide-react";
import { Alert, Button, DataTable, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Diferencia, ESTADO_LIQUIDACION, Linea, Seccion, Vacio, hoy, n, r2, useDatos } from "@/modulos/caj/comunes";

type Esperado = {
  cobrado_efectivo: number; gastos_ruta: number; efectivo: number; digital: number; por_reembolsar: number;
  cobros: { id: string; number: string; amount: string; reference: string | null; medio: string; medio_nombre: string; seq: number | null }[];
  gastos: { id: string; number: string; category: string; amount: number; paid_with: string; note: string | null }[];
};
type PorLiquidar = { id: string; code: string; route_date: string; returned_at: string | null; establishment_id: string; driver_user_id: string | null; repartidor: string | null; local: string | null; esperado: Esperado };
type Liquidacion = {
  id: string; number: string; settlement_date: string; expected_cash: string; expected_digital: string; delivered_cash: string; difference: string; difference_reason: string | null;
  status: string; settled_at: string; approved_at: string | null; driver_user_id: string | null; settled_by: string | null; ruta: string | null; repartidor: string | null;
  recibido_por: string | null; aprobado_por: string | null; caja: string | null;
};
type Respuesta = { por_liquidar: PorLiquidar[]; liquidaciones: Liquidacion[]; tolerancia: number };
type Ruta = { ruta: { id: string; code: string; route_date: string; repartidor: string | null; driver_user_id: string | null }; esperado: Esperado; tolerancia: number;
  cajas: { id: string; code: string; name: string; account_type: string }[] };

const hace = (dias: number) => { const d = new Date(`${hoy()}T12:00:00`); d.setDate(d.getDate() - dias); return d.toISOString().slice(0, 10); };

/** CAJ-07 Liquidación del repartidor: efectivo esperado contra contado, diferencia con motivo y aprobación por otra persona. */
export default function LiquidacionRepartidor() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const rutaInicial = useSearchParams().get("ruta");
  const { me, can, puede } = useSesion();
  const [f, setF] = useState({ desde: hace(14), hasta: hoy(), estado: "" });
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { datos, error, cargando, recargar } = useDatos<Respuesta>(`/v1/caj/liquidaciones?${p}`);
  const [liquidando, setLiquidando] = useState<string | null>(rutaInicial);
  const puedeLiquidar = can("caj.driver.settle");
  const puedeAprobar = puedeLiquidar && puede("CAJ", "A");

  async function aprobar(l: Liquidacion) {
    const r = await confirmAction({ title: `¿Aprobar la diferencia de ${l.number}?`, message: `${l.repartidor ?? ""}: ${l.difference_reason ?? ""}`, confirmLabel: "Aprobar",
      reason: { label: "Nota", optional: true } });
    if (!r) return;
    try {
      await api(`/v1/caj/liquidaciones/${l.id}/aprobar`, { method: "POST", body: { note: r.reason || null } });
      toast.ok(`Liquidación ${l.number} aprobada.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  function cerrar() {
    setLiquidando(null);
    if (rutaInicial) router.replace("/m/caj/caj-07");
  }

  const columnas: Column<Liquidacion>[] = [
    { key: "number", header: "Liquidación", cardTitle: true, render: (l) => <div><div className="font-medium">{l.number}</div><div className="text-[12px] text-muted">{fecha(l.settlement_date)}{l.ruta ? ` · ruta ${l.ruta}` : ""}</div></div> },
    { key: "repartidor", header: "Repartidor", render: (l) => <div>{l.repartidor ?? "—"}<div className="text-[12px] text-muted">Recibió {l.recibido_por ?? "—"}{l.caja ? ` en ${l.caja}` : ""}</div></div> },
    { key: "expected_cash", header: "Esperado", align: "right", render: (l) => soles(l.expected_cash) },
    { key: "delivered_cash", header: "Entregó", align: "right", render: (l) => soles(l.delivered_cash) },
    { key: "difference", header: "Diferencia", align: "right", render: (l) => (
      <div className="text-right"><Diferencia valor={l.difference} />{l.difference_reason && <div className="max-w-[260px] truncate text-[11.5px] text-muted" title={l.difference_reason}>{l.difference_reason}</div>}</div>
    ) },
    { key: "status", header: "Estado", render: (l) => (
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={l.status} labels={ESTADO_LIQUIDACION} />
        {l.status === "APPROVED" && l.aprobado_por && <span className="text-[11.5px] text-muted">por {l.aprobado_por}</span>}
        {l.status === "WITH_DIFFERENCE" && puedeAprobar && l.settled_by !== me.user.id && l.driver_user_id !== me.user.id && (
          <Button size="sm" icon={CheckCheck} onClick={(e) => { e.stopPropagation(); void aprobar(l); }}>Aprobar</Button>
        )}
      </div>
    ) },
  ];

  const pend = datos?.por_liquidar ?? [];
  return (
    <div className="space-y-5">
      <PageHeader description="Cuando el repartidor vuelve, entrega el efectivo cobrado menos los gastos que pagó con él. Si lo contado no cuadra, la diferencia queda con su motivo y la aprueba otra persona: ni el repartidor ni quien recibió." />
      {error && <Alert tone="bad">{error}</Alert>}
      <Seccion titulo={`Rutas por liquidar${pend.length ? ` (${pend.length})` : ""}`}>
        {cargando && !datos ? <Vacio>Cargando…</Vacio> : !pend.length ? <Vacio>No hay rutas de vuelta esperando liquidación.</Vacio> : (
          <ul className="divide-y divide-line">
            {pend.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium">{r.repartidor ?? "Sin repartidor"} · ruta {r.code}</div>
                  <div className="text-[12px] text-muted">{fecha(r.route_date)}{r.returned_at ? ` · volvió ${fechaHora(r.returned_at)}` : ""}{r.local ? ` · ${r.local}` : ""}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right text-[13px]"><span className="text-muted">Debe entregar </span><b className="tabular-nums">{soles(r.esperado.efectivo)}</b></span>
                  {puedeLiquidar && <Button variant="primary" size="sm" icon={HandCoins} disabled={r.driver_user_id === me.user.id} onClick={() => setLiquidando(r.id)}>Liquidar</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <DataTable rows={datos?.liquidaciones ?? []} columns={columnas} loading={cargando} error={error || undefined} onRetry={recargar} empty="No hay liquidaciones en esas fechas."
        toolbar={<>
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} ancho={150} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} ancho={150} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={Object.entries(ESTADO_LIQUIDACION).map(([value, [label]]) => ({ value, label }))} ancho={180} />
        </>} />
      <p className="text-[12.5px] text-muted">Se ven las liquidaciones de esas fechas y, siempre, las que esperan aprobación.</p>
      {liquidando && <Liquidar key={liquidando} rutaId={liquidando} onClose={cerrar} onListo={() => { cerrar(); recargar(); }} />}
    </div>
  );
}

function Liquidar({ rutaId, onClose, onListo }: { rutaId: string; onClose: () => void; onListo: () => void }) {
  const { me } = useSesion();
  const { datos: d, error } = useDatos<Ruta & { liquidacion: Liquidacion | null }>(`/v1/caj/rutas/${rutaId}/liquidacion`);
  const [contado, setContado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [caja, setCaja] = useState("");
  const [enviando, setEnviando] = useState(false);

  const esperado = d?.esperado.efectivo ?? 0;
  const dif = contado === "" ? 0 : r2(Number(contado) - esperado);
  const fuera = contado !== "" && Math.abs(dif) > (d?.tolerancia ?? 0) + 0.004;
  const propia = d?.ruta.driver_user_id === me.user.id;

  async function liquidar() {
    setEnviando(true);
    try {
      const l = await api<{ number: string; status: string }>(`/v1/caj/rutas/${rutaId}/liquidar`, { method: "POST",
        body: { counted_cash: Number(contado), reason: motivo.trim() || null, receiving_account_id: caja || d?.cajas[0]?.id || null } });
      toast.ok(l.status === "WITH_DIFFERENCE" ? `Liquidación ${l.number} registrada con diferencia: falta que otra persona la apruebe.` : `Liquidación ${l.number} registrada.`);
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={d ? `Liquidar ruta ${d.ruta.code}` : "Liquidar ruta"} description={d ? `${d.ruta.repartidor ?? "Sin repartidor"} · ${fecha(d.ruta.route_date)}` : undefined} size="lg"
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={enviando} disabled={!d || !!d.liquidacion || propia || contado === "" || Number(contado) < 0 || (fuera && motivo.trim().length < 5) || !d.cajas.length}
          onClick={liquidar}>Registrar liquidación</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!d ? <Vacio>Cargando…</Vacio> : d.liquidacion ? <Alert tone="info">Esta ruta ya se liquidó ({d.liquidacion.number}).</Alert> : (
        <div className="space-y-4">
          {propia && <Alert tone="bad">No puedes liquidar tu propia ruta: la recibe otra persona.</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Seccion titulo="Lo que debe entregar">
              <Linea t="Cobrado en efectivo" v={soles(d.esperado.cobrado_efectivo)} />
              <Linea t="Gastos pagados con ese efectivo" v={`−${soles(d.esperado.gastos_ruta)}`} />
              <Linea t="Efectivo esperado" v={soles(esperado)} fuerte />
              <Linea t="Cobrado en digital (no se entrega)" v={soles(d.esperado.digital)} />
              {d.esperado.por_reembolsar > 0 && <Linea t="Gastos que pagó de su bolsillo" v={soles(d.esperado.por_reembolsar)} tono="warn" />}
            </Seccion>
            <Seccion titulo="Lo que entrega">
              <div className="space-y-3">
                <Field label="Efectivo contado (S/)" required>
                  <Input type="number" inputMode="decimal" min={0} step="0.01" value={contado} onChange={(e) => setContado(e.target.value)} autoFocus className="text-right text-[16px] tabular-nums" />
                </Field>
                <div className="flex items-baseline justify-between text-[13.5px]"><span className="text-muted">Diferencia</span>{contado === "" ? <span className="text-muted">—</span> : <Diferencia valor={dif} />}</div>
                {d.cajas.length > 1 && (
                  <Field label="Lo recibe la caja">
                    <Select value={caja || d.cajas[0].id} onChange={(e) => setCaja(e.target.value)} options={d.cajas.map((c) => ({ value: c.id, label: c.name }))} />
                  </Field>
                )}
                {d.cajas.length === 1 && <p className="text-[12.5px] text-muted">Lo recibe: {d.cajas[0].name}</p>}
                {!d.cajas.length && <Alert tone="bad">El local no tiene una caja de efectivo activa para recibir el dinero.</Alert>}
              </div>
            </Seccion>
          </div>
          {fuera && (
            <Field label="Motivo de la diferencia" required hint={`Pasa la tolerancia de ${soles(d.tolerancia)}. Otra persona deberá aprobarla.`}>
              <Textarea rows={2} maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Qué pasó con la diferencia…" />
            </Field>
          )}
          {(d.esperado.cobros.length > 0 || d.esperado.gastos.length > 0) && (
            <Seccion titulo="Detalle de la ruta">
              <ul className="divide-y divide-line text-[13px]">
                {d.esperado.cobros.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{c.seq ? `${c.seq}. ` : ""}{c.number} · {c.medio_nombre}{c.reference ? ` · op. ${c.reference}` : ""}</span>
                    <span className={`shrink-0 tabular-nums ${c.medio === "CASH" ? "" : "text-muted"}`}>{soles(c.amount)}</span>
                  </li>
                ))}
                {d.esperado.gastos.map((g) => (
                  <li key={g.id} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">Gasto {g.number} · {g.category}{g.paid_with === "OWN" ? " (de su bolsillo)" : ""}{g.note ? ` · ${g.note}` : ""}</span>
                    <span className="shrink-0 tabular-nums text-bad">−{soles(n(g.amount))}</span>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </div>
      )}
    </Modal>
  );
}
