"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, CheckCircle2, Pencil, Send, Split, Undo2, Wallet, X, XCircle } from "lucide-react";
import { Alert, Badge, Button, Field, buttonClass, Input, Modal, Select, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { Foto } from "@/modulos/del/Captura";
import { Bandera, EstadoGasto, Monto, useDatos } from "./comunes";
import { NIVELES, hoyLima, type FichaGasto } from "./tipos";

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 text-[13.5px] last:border-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-right font-medium text-ink">{children}</span>
    </div>
  );
}

/** Foto del comprobante con su enlace temporal (se pide al abrir la ficha). */
export function FotoComprobante({ id, hay }: { id: string; hay: boolean }) {
  const [url, setUrl] = useState<{ id: string; url?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!hay) return;
    let vigente = true;
    api<{ url: string }>(`/v1/gas/gastos/${id}/foto`, { method: "POST" })
      .then((r) => vigente && setUrl({ id, url: r.url }))
      .catch((e) => vigente && setUrl({ id, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [id, hay]);
  if (!hay) return <p className="rounded-lg border border-dashed border-line p-3 text-center text-[12.5px] text-muted">Sin foto del comprobante</p>;
  const actual = url?.id === id ? url : null;
  if (!actual) return <p className="text-[12.5px] text-muted">Cargando la foto…</p>;
  if (actual.error) return <p className="rounded-lg border border-dashed border-line p-3 text-center text-[12.5px] text-muted">{actual.error}</p>;
  return (
    <a href={actual.url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={actual.url} alt="Foto del comprobante" className="max-h-72 w-full rounded-lg border border-line bg-surface-2 object-contain" />
    </a>
  );
}

type Cuenta = { id: string; name: string; account_type: string };

/** Ficha del gasto en un panel, con lo que el usuario puede hacer según su rol y el estado. */
export function Ficha({ id, onClose, onCambio }: { id: string | null; onClose: () => void; onCambio?: () => void }) {
  const { datos: g, error, cargando, recargar } = useDatos<FichaGasto>(id ? `/v1/gas/gastos/${id}` : null);
  const [ocupado, setOcupado] = useState("");
  const [modo, setModo] = useState<"" | "pagar" | "corregir">("");

  async function accion(clave: string, ruta: string, body?: unknown, ok?: string) {
    setOcupado(clave);
    try {
      await api(`/v1/gas/gastos/${id}/${ruta}`, { method: "POST", body });
      toast.ok(ok ?? "Listo.");
      setModo("");
      recargar();
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }
  const conMotivo = async (clave: string, ruta: string, titulo: string, campo: string, ok: string, etiqueta = "Motivo", peligro = true) => {
    const r = await confirmAction({ title: titulo, danger: peligro, confirmLabel: titulo.split(" ")[0], reason: { label: etiqueta, min: 5 } });
    if (r) await accion(clave, ruta, { [campo]: r.reason }, ok);
  };

  return (
    <Modal open={Boolean(id)} onClose={onClose} title={g ? `Gasto ${g.number}` : "Gasto"} size="lg"
      description={g ? <span className="inline-flex flex-wrap items-center gap-1.5"><EstadoGasto s={g.status} /><Bandera f={g.accounting_flag} />{g.de_ruta && <Badge tone="info">De la app del repartidor</Badge>}</span> : undefined}>
      {cargando ? <p className="text-[13px] text-muted">Cargando…</p> : error || !g ? <Alert tone="bad">{error || "No se encontró el gasto."}</Alert> : (
        <div className="space-y-4">
          {g.status === "REJECTED" && g.rejection_reason && <Alert tone="bad" title="Rechazado">{g.rejection_reason}</Alert>}
          {g.accounting_flag === "OBSERVED" && g.accounting_note && (
            <Alert tone="warn" title={g.corregido ? "Observado por la contadora · ya corregido" : "La contadora pide corregir"}>{g.accounting_note}</Alert>
          )}
          {g.status === "VOIDED" && <Alert tone="info" title="Anulado">{g.void_reason}</Alert>}

          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="mb-2 text-[15px] font-semibold text-ink">{g.description}</p>
              <Dato label="Monto"><Monto g={g} /></Dato>
              {g.currency !== "PEN" && <Dato label="Tipo de cambio">{numero(g.exchange_rate, 4)}</Dato>}
              <Dato label="Subtotal · IGV">{soles(g.subtotal)} · {soles(g.igv)}</Dato>
              {g.other_taxes > 0 && <Dato label="Otros tributos">{soles(g.other_taxes)}</Dato>}
              {g.withholding_amount > 0 && <Dato label="Retención 4.ª categoría">{soles(g.withholding_amount)}</Dato>}
              <Dato label="Fecha">{fecha(g.issue_date)}</Dato>
              <Dato label="Comprobante">{g.documento}{g.comprobante ? ` ${g.comprobante}` : ""}</Dato>
              <Dato label="Proveedor">{g.proveedor ? `${g.proveedor}${g.supplier_doc ? ` · ${g.supplier_doc}` : ""}` : "—"}</Dato>
              <Dato label="Categoría">{g.categoria ?? "—"}</Dato>
              <Dato label="Centro de costo">{g.centro ?? "—"}</Dato>
              <Dato label="Local · marca">{g.local} · {g.marca}</Dato>
              {g.canal && <Dato label="Canal">{g.canal}</Dato>}
              {g.vehiculo && <Dato label="Vehículo">{g.vehiculo}</Dato>}
              {g.ruta && <Dato label="Ruta">{g.ruta}</Dato>}
              {g.trabajador && <Dato label="Trabajador">{g.trabajador}</Dato>}
              {g.fuel_gallons !== null && <Dato label="Galones">{numero(g.fuel_gallons, 3)}{g.fuel_voucher_no ? ` · vale ${g.fuel_voucher_no}` : ""}</Dato>}
              {g.campana && <Dato label="Campaña">{g.campana}</Dato>}
              <Dato label="Se paga">{g.pay_source === "PETTY" ? `Caja chica${g.rendicion ? ` · ${g.rendicion.number} (${g.rendicion.estado.toLowerCase()})` : ""}` : g.pay_source === "PAYABLE" ? "Por tesorería" : "Efectivo de la ruta"}</Dato>
              {g.required_level && <Dato label="Aprobación">{NIVELES[g.required_level]}</Dato>}
              {g.paid_at && <Dato label="Pago">{fechaHora(g.paid_at)}{g.paid_amount !== null ? ` · ${soles(g.paid_amount)}` : ""}{g.cuenta_pago ? ` · ${g.cuenta_pago}` : ""}{g.payment_reference ? ` · ${g.payment_reference}` : ""}</Dato>}
              <Dato label="Registró">{g.registro ?? "—"}</Dato>
            </div>
            <div className="min-w-0 space-y-3">
              <FotoComprobante id={g.id} hay={g.foto} />
              {g.costo_reparto && (
                <Alert tone="ok" title="En los costos de Delivery">{g.costo_reparto.tipo}: {soles(g.costo_reparto.amount)} sin IGV{g.costo_reparto.fuel_gallons ? ` · ${numero(g.costo_reparto.fuel_gallons, 3)} gal` : ""}.</Alert>
              )}
              {g.reparto.length > 0 && (
                <div className="rounded-lg border border-line p-3">
                  <p className="mb-1 text-[12.5px] font-semibold text-ink">Reparto entre centros de costo</p>
                  {g.reparto.map((l) => (
                    <div key={l.id} className="flex justify-between gap-2 text-[12.5px]">
                      <span className="min-w-0 truncate">{l.centro} · {l.marca}{l.canal ? ` · ${l.canal}` : ""}</span>
                      <span className="shrink-0 font-medium">{numero(l.pct, 2)} % · {soles(l.amount ?? 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Acciones g={g} ocupado={ocupado} modo={modo} setModo={setModo} accion={accion} conMotivo={conMotivo} />

          {modo === "pagar" && <Pagar g={g} ocupado={ocupado === "pagar"} onPagar={(b) => accion("pagar", "pagar", b, "Pago registrado.")} onCancelar={() => setModo("")} />}
          {modo === "corregir" && <Corregir g={g} onListo={() => { setModo(""); recargar(); onCambio?.(); }} onCancelar={() => setModo("")} />}

          {(g.aprobaciones.length > 0 || g.historia.length > 0) && (
            <div className="space-y-1">
              <p className="text-[12.5px] font-semibold text-ink">Historial</p>
              <ol className="space-y-1.5 border-l border-line pl-3">
                {g.historia.map((h, i) => (
                  <li key={i} className="text-[12.5px]">
                    <span className="text-muted">{h.at.replace("T", " ")} · {h.user}</span> — <span className="text-ink">{h.action}</span>
                    {h.note && <span className="block text-muted">{h.note}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Acciones({ g, ocupado, modo, setModo, accion, conMotivo }: {
  g: FichaGasto; ocupado: string; modo: string; setModo: (m: "" | "pagar" | "corregir") => void;
  accion: (clave: string, ruta: string, body?: unknown, ok?: string) => Promise<void>;
  conMotivo: (clave: string, ruta: string, titulo: string, campo: string, ok: string, etiqueta?: string, peligro?: boolean) => Promise<void>;
}) {
  const p = g.puede;
  const hay = Object.values(p).some(Boolean);
  if (!hay) return null;
  return (
    <div className="flex flex-wrap gap-2 border-t border-line pt-3">
      {p.aprobar && <Button variant="primary" icon={Check} loading={ocupado === "aprobar"} onClick={async () => {
        const r = await confirmAction({ title: `Aprobar ${g.number} por ${soles(g.amount_pen)}`, confirmLabel: "Aprobar", reason: { label: "Comentario (opcional)", optional: true } });
        if (r) await accion("aprobar", "aprobar", { comentario: r.reason }, "Gasto aprobado.");
      }}>Aprobar</Button>}
      {p.aprobar && <Button variant="danger" icon={X} loading={ocupado === "rechazar"} onClick={() => conMotivo("rechazar", "rechazar", "Rechazar el gasto", "comentario", "Gasto rechazado.", "Qué hay que corregir")}>Rechazar</Button>}
      {p.editar && <Link href={`/m/gas/gas-01?id=${g.id}`} className={buttonClass("secondary")}><Pencil className="size-4" aria-hidden="true" />Corregir y reenviar</Link>}
      {p.enviar && <Button variant="primary" icon={Send} loading={ocupado === "enviar"} onClick={() => accion("enviar", "enviar", undefined, "Enviado a aprobación.")}>Enviar a aprobación</Button>}
      {p.pagar && modo !== "pagar" && <Button variant="primary" icon={Wallet} onClick={() => setModo("pagar")}>Registrar pago</Button>}
      {p.revertir && <Button icon={Undo2} loading={ocupado === "revertir"} onClick={() => conMotivo("revertir", "revertir-pago", "Revertir el pago", "motivo", "Pago revertido: el gasto vuelve a por pagar.")}>Revertir pago</Button>}
      {p.repartir && <Link href={`/m/gas/gas-10?id=${g.id}`} className={buttonClass("secondary")}><Split className="size-4" aria-hidden="true" />Repartir</Link>}
      {p.corregir && modo !== "corregir" && <Button variant="primary" icon={Pencil} onClick={() => setModo("corregir")}>Corregir lo observado</Button>}
      {p.revisar && g.accounting_flag !== "OK" && g.doc_type !== "NONE" && <Button icon={CheckCircle2} loading={ocupado === "valido"} onClick={() => accion("valido", "clasificar", { accounting_flag: "OK" }, "Marcado como comprobante válido.")}>Comprobante válido</Button>}
      {p.revisar && (g.accounting_flag === "NO_VALID_RECEIPT" || g.accounting_flag === "OBSERVED") && !g.revisado && <Button icon={XCircle} loading={ocupado === "novalido"} onClick={() => accion("novalido", "clasificar", { accounting_flag: "NO_VALID_RECEIPT" }, "Confirmado sin comprobante válido.")}>Confirmar sin comprobante válido</Button>}
      {p.revisar && <Button loading={ocupado === "observar"} onClick={() => conMotivo("observar", "observar", "Pedir corrección", "nota", "Se pidió la corrección.", "Qué hay que corregir", false)}>Pedir corrección</Button>}
      {p.anular && <Button variant="ghost" icon={Ban} loading={ocupado === "anular"} onClick={() => conMotivo("anular", "anular", "Anular el gasto", "motivo", "Gasto anulado.")}>Anular</Button>}
    </div>
  );
}

function Pagar({ g, ocupado, onPagar, onCancelar }: { g: FichaGasto; ocupado: boolean; onPagar: (b: unknown) => void; onCancelar: () => void }) {
  const { datos: cuentas } = useDatos<Cuenta[]>("/v1/gas/cuentas");
  const [cuenta, setCuenta] = useState("");
  const [ref, setRef] = useState("");
  const [dia, setDia] = useState(hoyLima());
  const validas = (cuentas ?? []).filter((c) => !["PETTY_CASH", "DRIVER_CASH", "GATEWAY", "CARD_ACQUIRER"].includes(c.account_type));
  const tipo = validas.find((c) => c.id === cuenta)?.account_type;
  const monto = g.amount_pen - g.withholding_amount * g.exchange_rate;
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-[13px] text-ink">Pagar <b>{soles(monto)}</b>{g.withholding_amount > 0 ? ` (total menos la retención de ${soles(g.withholding_amount)})` : ""}.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cuenta" required><Select value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="Elige la cuenta" options={validas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="N.º de operación" required={tipo === "BANK" || tipo === "WALLET"}><Input value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label="Fecha"><Input type="date" value={dia} max={hoyLima()} onChange={(e) => setDia(e.target.value)} /></Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" loading={ocupado} disabled={!cuenta} onClick={() => onPagar({ cash_account_id: cuenta, referencia: ref || null, fecha: dia })}>Confirmar pago</Button>
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  );
}

function Corregir({ g, onListo, onCancelar }: { g: FichaGasto; onListo: () => void; onCancelar: () => void }) {
  const [doc, setDoc] = useState(g.doc_type);
  const [serie, setSerie] = useState(g.doc_series ?? "");
  const [num, setNum] = useState(g.doc_number ?? "");
  const [ruc, setRuc] = useState(g.supplier_doc ?? "");
  const [nombre, setNombre] = useState(g.proveedor ?? "");
  const [foto, setFoto] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const docs: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta", TICKET: "Ticket", FEES_RECEIPT: "Recibo por honorarios", FOREIGN_INVOICE: "Factura del exterior", SIMPLE_RECEIPT: "Recibo simple", MOBILITY_SHEET: "Planilla de movilidad", NONE: "Sin comprobante" };
  async function guardar() {
    setGuardando(true);
    try {
      const f = new FormData();
      f.set("doc_type", doc); f.set("doc_series", serie); f.set("doc_number", num); f.set("supplier_doc", ruc); f.set("supplier_name", nombre);
      if (foto) f.set("foto_data", foto);
      await api(`/v1/gas/gastos/${g.id}/corregir`, { method: "POST", body: f });
      toast.ok("Corrección enviada a la contadora.");
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-[13px] text-ink">Corrige los datos del comprobante. Los montos, la categoría y el centro de costo no cambian.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Comprobante"><Select value={doc} onChange={(e) => setDoc(e.target.value)} options={Object.entries(docs).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Serie"><Input value={serie} maxLength={20} onChange={(e) => setSerie(e.target.value.toUpperCase())} /></Field>
        <Field label="Número"><Input value={num} maxLength={20} onChange={(e) => setNum(e.target.value)} /></Field>
        <Field label="RUC del proveedor"><Input value={ruc} inputMode="numeric" maxLength={11} onChange={(e) => setRuc(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Razón social" className="sm:col-span-2"><Input value={nombre} maxLength={160} onChange={(e) => setNombre(e.target.value)} /></Field>
      </div>
      <Field label="Nueva foto del comprobante"><Foto valor={foto} onChange={setFoto} texto="Tomar o elegir foto" /></Field>
      <div className="flex gap-2">
        <Button variant="primary" loading={guardando} onClick={guardar}>Enviar corrección</Button>
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  );
}
