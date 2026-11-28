"use client";

import { useState } from "react";
import { PiggyBank, Undo2 } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Seccion, Vacio, n, r2, useDatos, type Pendientes } from "@/modulos/caj/comunes";

type Fila = { id: string; full_name: string; doc_type: string; doc_number: string | null; phone: string | null; saldo: string; ultimo: string; movimientos: number };
type Extra = { saldo_total: number; cuentas_devolucion: { id: string; code: string; name: string }[] };
type Mov = { id: string; movement_type: string; amount: string; reason: string | null; at: string; user: string | null; refund_reference: string | null; pedido: string | null; cobro: string | null; comprobante: string | null; cuenta: string | null; tipo: string };
type Detalle = { cliente: { id: string; full_name: string; doc_type: string; doc_number: string | null; phone: string | null }; saldo: number; movimientos: Mov[] };

/** CAJ-10 Saldos a favor: lo que un cliente pagó de más; se usa en otro pedido o comprobante, o se le devuelve. */
export default function SaldosAFavor() {
  const [abierto, setAbierto] = useState<string | null>(null);
  const lista = useListado<Fila>("/v1/caj/saldos", { orden: "-saldo" });
  const { datos: extra, recargar: recargarExtra } = useDatos<Extra>("/v1/caj/saldos?per_page=1");
  const columnas: Column<Fila>[] = [
    { key: "full_name", header: "Cliente", sortable: true, cardTitle: true, render: (c) => (
      <div className="min-w-0"><div className="font-medium">{c.full_name}</div><div className="text-[12px] text-muted">{c.doc_type !== "NONE" ? `${c.doc_type} ${c.doc_number ?? ""}` : "Sin documento"}{c.phone ? ` · ${c.phone}` : ""}</div></div>
    ) },
    { key: "ultimo", header: "Último movimiento", sortable: true, render: (c) => <span className="text-[13px]">{fechaHora(c.ultimo)}<span className="block text-[12px] text-muted">{c.movimientos} movimientos</span></span> },
    { key: "saldo", header: "Saldo a favor", sortable: true, align: "right", render: (c) => <span className="font-semibold tabular-nums text-ok">{soles(c.saldo)}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Clientes con saldo a favor: pagaron más que el peso real o tienen una nota de crédito. El saldo se usa en otro pedido o comprobante, o se devuelve por transferencia, Yape o Plin, con la operación y el motivo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Saldo a favor total" icono={PiggyBank} destacada valor={extra ? soles(extra.saldo_total) : undefined} detalle={`${lista.total} clientes`} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(c) => setAbierto(c.id)} empty="Ningún cliente tiene saldo a favor."
        search={{ ...lista.tabla.search, placeholder: "Nombre, documento o celular…" }} />
      {abierto && <VerSaldo id={abierto} cuentas={extra?.cuentas_devolucion ?? []} onClose={() => setAbierto(null)} onCambio={() => { lista.recargar(); recargarExtra(); }} />}
    </div>
  );
}

function VerSaldo({ id, cuentas, onClose, onCambio }: { id: string; cuentas: Extra["cuentas_devolucion"]; onClose: () => void; onCambio: () => void }) {
  const { can, puede } = useSesion();
  const { datos: d, error, recargar } = useDatos<Detalle>(`/v1/caj/saldos/${id}`);
  const usa = can("caj.payment.register") && puede("CAJ", "C");
  const devuelve = can("caj.balance.refund");
  const [pestana, setPestana] = useState<"mov" | "usar" | "devolver">("mov");
  const listo = () => { recargar(); onCambio(); setPestana("mov"); };

  const pestanas = [{ key: "mov" as const, label: "Movimientos" }, ...(usa ? [{ key: "usar" as const, label: "Usar" }] : []), ...(devuelve ? [{ key: "devolver" as const, label: "Devolver" }] : [])];
  return (
    <Modal open onClose={onClose} title={d?.cliente.full_name ?? "Saldo a favor"} description={d ? `Saldo a favor ${soles(d.saldo)}` : undefined} size="lg"
      footer={<Button variant="primary" onClick={onClose}>Cerrar</Button>}>
      {error && <Alert tone="bad">{error}</Alert>}
      {!d ? <Vacio>Cargando…</Vacio> : (
        <div className="space-y-4">
          {pestanas.length > 1 && <Tabs tabs={pestanas} value={pestana} onChange={setPestana} />}
          {pestana === "mov" && (
            <ul className="divide-y divide-line">
              {d.movimientos.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0">
                    <div>{m.tipo}{m.pedido ? ` · pedido ${m.pedido}` : ""}{m.comprobante ? ` · ${m.comprobante}` : ""}{m.cobro ? ` · ${m.cobro}` : ""}</div>
                    <div className="text-[12px] text-muted">{fechaHora(m.at)} · {m.user ?? "—"}{m.cuenta ? ` · ${m.cuenta}` : ""}{m.refund_reference ? ` · op. ${m.refund_reference}` : ""}</div>
                    {m.reason && <div className="text-[12px] text-muted">{m.reason}</div>}
                  </div>
                  <span className={`shrink-0 tabular-nums ${n(m.amount) < 0 ? "text-bad" : "text-ok"}`}>{n(m.amount) < 0 ? "−" : "+"}{soles(Math.abs(n(m.amount)))}</span>
                </li>
              ))}
            </ul>
          )}
          {pestana === "usar" && <Usar clienteId={id} saldo={d.saldo} onListo={listo} />}
          {pestana === "devolver" && <Devolver clienteId={id} saldo={d.saldo} cuentas={cuentas} onListo={listo} />}
        </div>
      )}
    </Modal>
  );
}

function Usar({ clienteId, saldo, onListo }: { clienteId: string; saldo: number; onListo: () => void }) {
  const { datos: p } = useDatos<Pendientes>(`/v1/caj/clientes/${clienteId}/pendientes`);
  const [destino, setDestino] = useState("");
  const [monto, setMonto] = useState("");
  const [enviando, setEnviando] = useState(false);
  if (!p) return <Vacio>Cargando…</Vacio>;
  const opciones = [
    ...p.comprobantes.map((c) => ({ value: `d:${c.id}`, label: `${c.full_number} · falta ${soles(c.saldo)}`, falta: c.saldo })),
    ...p.pedidos.map((o) => ({ value: `o:${o.id}`, label: `Pedido ${o.number} · falta ${soles(o.pendiente)}`, falta: n(o.pendiente) })),
  ];
  if (!opciones.length) return <Vacio>El cliente no tiene pedidos ni comprobantes por pagar.</Vacio>;
  const elegido = opciones.find((o) => o.value === destino);
  const tope = elegido ? r2(Math.min(saldo, elegido.falta)) : saldo;

  async function usar() {
    setEnviando(true);
    try {
      const body = { amount: Number(monto), ...(destino.startsWith("d:") ? { document_id: destino.slice(2) } : { order_id: destino.slice(2) }) };
      await api(`/v1/caj/saldos/${clienteId}/usar`, { method: "POST", body });
      toast.ok(`Se usaron ${soles(Number(monto))} del saldo a favor.`);
      onListo();
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <Seccion>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field label="Pagar con el saldo"><Select value={destino} placeholder="Elige el pedido o comprobante" options={opciones} onChange={(e) => {
          setDestino(e.target.value);
          const o = opciones.find((x) => x.value === e.target.value);
          if (o) setMonto(r2(Math.min(saldo, o.falta)).toFixed(2));
        }} /></Field>
        <Field label="Monto (S/)" hint={`Hasta ${soles(tope)}`}><Input type="number" inputMode="decimal" min={0} step="0.01" max={tope} value={monto} onChange={(e) => setMonto(e.target.value)} className="text-right tabular-nums" /></Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="primary" loading={enviando} disabled={!destino || !(Number(monto) > 0) || Number(monto) > tope + 0.004} onClick={usar}>Usar {monto ? soles(Number(monto)) : ""}</Button>
      </div>
    </Seccion>
  );
}

function Devolver({ clienteId, saldo, cuentas, onListo }: { clienteId: string; saldo: number; cuentas: Extra["cuentas_devolucion"]; onListo: () => void }) {
  const [f, setF] = useState({ amount: saldo.toFixed(2), refund_account_id: cuentas[0]?.id ?? "", refund_reference: "", reason: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const poner = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function devolver() {
    setEnviando(true);
    setErrores({});
    try {
      await api(`/v1/caj/saldos/${clienteId}/devolver`, { method: "POST", body: { ...f, amount: Number(f.amount), refund_reference: f.refund_reference.trim(), reason: f.reason.trim() } });
      toast.ok(`Devolución de ${soles(Number(f.amount))} registrada.`);
      onListo();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <Seccion>
      <p className="mb-3 text-[12.5px] text-muted">Registra la devolución después de hacer la transferencia o el Yape al cliente. Sale de la cuenta elegida.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monto (S/)" required error={errores.amount} hint={`Saldo ${soles(saldo)}`}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" max={saldo} value={f.amount} onChange={(e) => poner("amount", e.target.value)} className="text-right tabular-nums" />
        </Field>
        <Field label="Sale de" required error={errores.refund_account_id}>
          <Select value={f.refund_account_id} options={cuentas.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => poner("refund_account_id", e.target.value)} />
        </Field>
        <Field label="Número de operación" required error={errores.refund_reference}><Input value={f.refund_reference} maxLength={40} onChange={(e) => poner("refund_reference", e.target.value)} /></Field>
        <Field label="Motivo" required error={errores.reason} className="sm:col-span-2"><Textarea rows={2} maxLength={200} value={f.reason} onChange={(e) => poner("reason", e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="danger" icon={Undo2} loading={enviando} disabled={!(Number(f.amount) > 0) || Number(f.amount) > saldo + 0.004 || !f.refund_account_id || !f.refund_reference.trim() || f.reason.trim().length < 5}
          onClick={devolver}>Registrar devolución</Button>
      </div>
    </Seccion>
  );
}
