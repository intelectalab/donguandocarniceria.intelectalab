"use client";

import { useMemo, useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, FiltroFecha, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Diferencia, ESTADO_ABONO, Linea, Seccion, TIPOS_CUENTA, Vacio, hoy, n, r2, useDatos } from "@/modulos/caj/comunes";

type Abono = {
  id: string; source_account_id: string; bank_account_id: string; deposit_date: string; reference: string; gross_amount: string; fee_amount: string; fee_igv: string; net_amount: string;
  status: string; kind: string; imported: boolean; created_by: string | null; difference_reason: string | null; closed_at: string | null; closed_by: string | null;
  origen: string; origen_tipo: string; banco: string; cobros: number; suma: string;
};
type Origen = { id: string; code: string; name: string; account_type: string; fee_pct: string | null; settlement_days: number | null };
type Respuesta = { abonos: Abono[]; origenes: Origen[]; bancos: { id: string; code: string; name: string }[]; igv: number };
type CobroAbono = { id: string; number: string; paid_at: string; amount: string; reference: string | null; status?: string; reconciliation_status?: string; fee_amount: string; medio: string; cliente: string | null; sugerido?: boolean };
type Detalle = Omit<Abono, "cobros" | "suma"> & { cobros: CobroAbono[]; suma: number; diferencia: number };

/** CAJ-08 Abonos: lo que la pasarela, el POS de tarjeta o la billetera depositó al banco, cuadrado contra los cobros que incluye. */
export default function Abonos() {
  const { can } = useSesion();
  const [f, setF] = useState({ desde: "", hasta: "", estado: "", cuenta: "" });
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { datos, error, cargando, recargar } = useDatos<Respuesta>(`/v1/caj/abonos?${p}`);
  const [nuevo, setNuevo] = useState(false);
  const [viendo, setViendo] = useState<string | null>(null);
  const gestiona = can("caj.reconciliation.manage");

  const columnas: Column<Abono>[] = [
    { key: "reference", header: "Abono", cardTitle: true, render: (a) => <div><div className="font-medium">{a.reference}</div><div className="text-[12px] text-muted">{fecha(a.deposit_date)} · {a.kind === "STATEMENT" ? "estado de cuenta" : "liquidación"}</div></div> },
    { key: "origen", header: "De → a", render: (a) => <div className="text-[13px]">{a.origen}<div className="text-[12px] text-muted">al {a.banco}</div></div> },
    { key: "gross_amount", header: "Bruto", align: "right", render: (a) => soles(a.gross_amount) },
    { key: "fee", header: "Comisión + IGV", align: "right", hideOnMobile: true, render: (a) => soles(n(a.fee_amount) + n(a.fee_igv)) },
    { key: "net_amount", header: "Neto al banco", align: "right", render: (a) => <span className="font-semibold">{soles(a.net_amount)}</span> },
    { key: "cobros", header: "Cobros", align: "right", render: (a) => (
      <div className="text-right">{a.cobros}<div className="text-[11.5px]"><Diferencia valor={r2(n(a.gross_amount) - n(a.suma))} /></div></div>
    ) },
    { key: "status", header: "Estado", render: (a) => <StatusBadge status={a.status} labels={ESTADO_ABONO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada abono de Mercado Pago, del POS de tarjeta o el estado de cuenta de Yape y Plin se cuadra contra los cobros que trae. Al cerrarlo, los cobros quedan conciliados, se registra la comisión real y el neto entra al banco."
        actions={gestiona && <Button variant="primary" icon={Plus} disabled={!datos} onClick={() => setNuevo(true)}>Nuevo abono</Button>} />
      <DataTable rows={datos?.abonos ?? []} columns={columnas} loading={cargando} error={error || undefined} onRetry={recargar} onRowClick={(a) => setViendo(a.id)}
        empty="No hay abonos en esas fechas." toolbar={<>
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} ancho={150} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} ancho={150} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={Object.entries(ESTADO_ABONO).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Origen" value={f.cuenta} onChange={(v) => setF({ ...f, cuenta: v })} options={(datos?.origenes ?? []).map((o) => ({ value: o.id, label: o.name }))} ancho={200} />
        </>} />
      {!f.desde && <p className="text-[12.5px] text-muted">Se ven los abonos abiertos y los de los últimos 60 días.</p>}
      {nuevo && datos && <NuevoAbono op={datos} onClose={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); recargar(); setViendo(id); }} />}
      {viendo && <VerAbono id={viendo} gestiona={gestiona} onClose={() => setViendo(null)} onCambio={recargar} />}
    </div>
  );
}

function NuevoAbono({ op, onClose, onCreado }: { op: Respuesta; onClose: () => void; onCreado: (id: string) => void }) {
  const [origen, setOrigen] = useState(op.origenes[0]?.id ?? "");
  const [banco, setBanco] = useState(op.bancos[0]?.id ?? "");
  const [dia, setDia] = useState(hoy());
  const [ref, setRef] = useState("");
  const [bruto, setBruto] = useState("");
  const [comision, setComision] = useState("");
  const [igv, setIgv] = useState("");
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const o = op.origenes.find((x) => x.id === origen);
  const billetera = o?.account_type === "WALLET";
  const { datos: cand } = useDatos<{ cobros: CobroAbono[] }>(origen ? `/v1/caj/abonos/candidatos?cuenta=${origen}&hasta=${dia}` : null);
  const cobros = useMemo(() => cand?.cobros ?? [], [cand]);
  // Sin tocar las casillas, van marcados los sugeridos (los que ya debieron abonarse según los días de abono).
  const elegidos = marcados ?? cobros.filter((c) => c.sugerido).map((c) => c.id);
  const suma = r2(cobros.filter((c) => elegidos.includes(c.id)).reduce((s, c) => s + n(c.amount), 0));
  const comEst = r2(cobros.filter((c) => elegidos.includes(c.id)).reduce((s, c) => s + n(c.fee_amount), 0));
  const igvAuto = comision === "" ? 0 : r2(Number(comision) * op.igv);
  const igvUsado = billetera ? 0 : igv === "" ? igvAuto : Number(igv);
  const neto = r2(Number(bruto || 0) - (billetera ? 0 : Number(comision || 0)) - igvUsado);

  function cambiarOrigen(v: string) {
    setOrigen(v);
    setMarcados(null);
  }
  const marcar = (id: string, si: boolean) => setMarcados(si ? [...elegidos, id] : elegidos.filter((x) => x !== id));

  async function crear() {
    setEnviando(true);
    setErrores({});
    try {
      const a = await api<{ id: string; reference: string }>("/v1/caj/abonos", { method: "POST", body: {
        source_account_id: origen, bank_account_id: banco, deposit_date: dia, reference: ref.trim(), gross_amount: Number(bruto),
        fee_amount: billetera ? 0 : Number(comision || 0), fee_igv: billetera ? 0 : igvUsado, payment_ids: elegidos,
      } });
      toast.ok(`Abono ${a.reference} registrado.`);
      onCreado(a.id);
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nuevo abono" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} disabled={!origen || !banco || !ref.trim() || !(Number(bruto) > 0)} onClick={crear}>Registrar abono</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Origen" required error={errores.source_account_id}>
            <Select value={origen} onChange={(e) => cambiarOrigen(e.target.value)} options={op.origenes.map((x) => ({ value: x.id, label: `${x.name} (${TIPOS_CUENTA[x.account_type] ?? x.account_type})` }))} />
          </Field>
          <Field label="Banco que recibe" required error={errores.bank_account_id}>
            <Select value={banco} onChange={(e) => setBanco(e.target.value)} options={op.bancos.map((b) => ({ value: b.id, label: b.name }))} />
          </Field>
          <Field label="Fecha del abono" required error={errores.deposit_date}><Input type="date" value={dia} max={hoy()} onChange={(e) => setDia(e.target.value)} /></Field>
          <Field label={billetera ? "Referencia del estado de cuenta" : "Referencia de la liquidación"} required error={errores.reference}>
            <Input value={ref} maxLength={80} onChange={(e) => setRef(e.target.value)} placeholder={billetera ? "EECC-YAPE-2026-11" : "LIQ-MP-20261125"} />
          </Field>
          <Field label="Bruto (S/)" required error={errores.gross_amount} hint={suma ? `Los cobros marcados suman ${soles(suma)}.` : undefined}>
            <Input type="number" inputMode="decimal" step="0.01" min={0} value={bruto} onChange={(e) => setBruto(e.target.value)} className="text-right tabular-nums" />
          </Field>
          {!billetera && (<>
            <Field label="Comisión real (S/)" error={errores.fee_amount} hint={comEst ? `Estimada en los cobros: ${soles(comEst)}.` : undefined}>
              <Input type="number" inputMode="decimal" step="0.01" min={0} value={comision} onChange={(e) => setComision(e.target.value)} className="text-right tabular-nums" />
            </Field>
            <Field label="IGV de la comisión (S/)" error={errores.fee_igv} hint={`Vacío: ${Math.round(op.igv * 100)} % de la comisión (${soles(igvAuto)}).`}>
              <Input type="number" inputMode="decimal" step="0.01" min={0} value={igv} onChange={(e) => setIgv(e.target.value)} className="text-right tabular-nums" />
            </Field>
          </>)}
          <div className="self-end rounded-lg bg-surface-2 px-3 py-2">
            <Linea t="Neto al banco" v={soles(neto)} fuerte />
          </div>
        </div>
        <Seccion titulo={`Cobros que incluye (${elegidos.length})`} acciones={bruto !== "" && <span className="text-[12.5px]">Diferencia con el bruto: <Diferencia valor={r2(Number(bruto) - suma)} /></span>}>
          {!cand ? <Vacio>Cargando…</Vacio> : !cobros.length ? <Vacio>No hay cobros por conciliar en esta cuenta hasta esa fecha.</Vacio> : (
            <ul className="max-h-80 divide-y divide-line overflow-auto">
              {cobros.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <Checkbox checked={elegidos.includes(c.id)} onChange={(v) => marcar(c.id, v)} label={`${c.number} · ${c.cliente ?? "—"}`}
                      hint={`${fechaHora(c.paid_at)}${c.reference ? ` · op. ${c.reference}` : ""}`} />
                  </div>
                  <span className="shrink-0 text-[13px] tabular-nums">{soles(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    </Modal>
  );
}

function VerAbono({ id, gestiona, onClose, onCambio }: { id: string; gestiona: boolean; onClose: () => void; onCambio: () => void }) {
  const { datos: a, error, recargar } = useDatos<Detalle>(`/v1/caj/abonos/${id}`);
  const abierto = a?.status === "OPEN";
  const { datos: cand } = useDatos<{ cobros: CobroAbono[] }>(a && abierto && gestiona ? `/v1/caj/abonos/candidatos?cuenta=${a.source_account_id}&hasta=${a.deposit_date}` : null);
  const [agregar, setAgregar] = useState<string[]>([]);
  const [trabajando, setTrabajando] = useState(false);

  async function hacer(fn: () => Promise<unknown>, ok: string) {
    setTrabajando(true);
    try {
      await fn();
      toast.ok(ok);
      setAgregar([]);
      recargar();
      onCambio();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setTrabajando(false);
    }
  }

  async function cerrar() {
    if (!a) return;
    const cuadra = Math.abs(a.diferencia) < 0.005;
    const r = await confirmAction({ title: `¿Cerrar el abono ${a.reference}?`, confirmLabel: "Cerrar abono", danger: !cuadra,
      message: cuadra ? "Los cobros quedan conciliados y el neto entra al banco." : `Los cobros suman distinto que el bruto (diferencia ${soles(a.diferencia)}). Queda cerrado con diferencia.`,
      reason: cuadra ? undefined : { label: "Motivo de la diferencia", min: 5 } });
    if (!r) return;
    await hacer(() => api(`/v1/caj/abonos/${id}/cerrar`, { method: "POST", body: { reason: r.reason ?? null } }), `Abono ${a.reference} cerrado.`);
  }

  return (
    <Modal open onClose={onClose} title={a ? `Abono ${a.reference}` : "Abono"} description={a ? `${a.origen} → ${a.banco} · ${fecha(a.deposit_date)}` : undefined} size="lg"
      footer={<>
        {a && abierto && gestiona && <Button icon={Lock} loading={trabajando} disabled={!a.cobros.length} onClick={cerrar}>Cerrar abono</Button>}
        <Button variant="primary" onClick={onClose}>Listo</Button>
      </>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!a ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={a.status} labels={ESTADO_ABONO} />{a.imported && <Badge tone="neutral">Importado</Badge>}</div>
          {a.difference_reason && <Alert tone="warn" title="Cerrado con diferencia">{a.difference_reason}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Seccion titulo="Montos">
              <Linea t="Bruto" v={soles(a.gross_amount)} />
              <Linea t="Comisión" v={`−${soles(a.fee_amount)}`} />
              <Linea t="IGV de la comisión" v={`−${soles(a.fee_igv)}`} />
              <Linea t="Neto al banco" v={soles(a.net_amount)} fuerte />
            </Seccion>
            <Seccion titulo="Cuadre">
              <Linea t="Suma de los cobros" v={soles(a.suma)} />
              <Linea t="Diferencia con el bruto" v={<Diferencia valor={a.diferencia} />} fuerte />
              <DetailList items={[{ label: "Registró", value: a.created_by ?? "—" }, ...(a.closed_at ? [{ label: "Cerró", value: `${a.closed_by ?? "—"} · ${fechaHora(a.closed_at)}` }] : [])]} />
            </Seccion>
          </div>
          <Seccion titulo={`Cobros (${a.cobros.length})`}>
            {!a.cobros.length ? <Vacio>Todavía no tiene cobros.</Vacio> : (
              <ul className="max-h-72 divide-y divide-line overflow-auto">
                {a.cobros.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                    <span className="min-w-0 flex-1"><span className="block truncate">{c.number} · {c.cliente ?? "—"}</span>
                      <span className="block text-[12px] text-muted">{fechaHora(c.paid_at)}{c.reference ? ` · op. ${c.reference}` : ""}</span></span>
                    <span className="shrink-0 tabular-nums">{soles(c.amount)}</span>
                    {abierto && gestiona && (
                      <button type="button" disabled={trabajando} aria-label={`Quitar ${c.number}`} className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-bad"
                        onClick={() => void hacer(() => api(`/v1/caj/abonos/${id}/cobros/${c.id}`, { method: "DELETE" }), `${c.number} quitado del abono.`)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          {abierto && gestiona && (cand?.cobros.length ?? 0) > 0 && (
            <Seccion titulo="Agregar cobros por conciliar" acciones={<Button size="sm" disabled={!agregar.length || trabajando}
              onClick={() => void hacer(() => api(`/v1/caj/abonos/${id}/cobros`, { method: "POST", body: { payment_ids: agregar } }), `${agregar.length} cobro(s) agregados.`)}>Agregar {agregar.length || ""}</Button>}>
              <ul className="max-h-60 divide-y divide-line overflow-auto">
                {cand!.cobros.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <Checkbox checked={agregar.includes(c.id)} onChange={(v) => setAgregar(v ? [...agregar, c.id] : agregar.filter((x) => x !== c.id))}
                        label={`${c.number} · ${c.cliente ?? "—"}`} hint={fecha(c.paid_at)} />
                    </div>
                    <span className="shrink-0 tabular-nums">{soles(c.amount)}</span>
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
