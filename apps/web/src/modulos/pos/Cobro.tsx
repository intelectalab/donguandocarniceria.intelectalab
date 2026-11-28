"use client";

import { useState } from "react";
import { Banknote, CreditCard, Smartphone, Trash2, Wallet } from "lucide-react";
import { Alert, Button, Field, IconButton, Input, Select } from "@/components/ui";
import { soles } from "@/lib/formato";
import { r2, type Medio, type Pago } from "./tipos";

type Fila = { key: number; method: string; amount: string; reference: string; card_brand: string; card_last4: string };

const ICONOS: Record<string, typeof Banknote> = { CASH: Banknote, CARD: CreditCard, WALLET: Smartphone, INTERNAL: Wallet };

/**
 * POS-04 Cobro: medios mezclados. Efectivo con vuelto, tarjeta (operación, marca y 4 dígitos), Yape
 * o Plin (operación) y saldo a favor del cliente identificado. Solo el efectivo puede pasar del total.
 */
export function Cobro({ total, medios, marcasTarjeta, saldoCliente, clienteIdentificado, enviando, textoBoton = "Cobrar y emitir", onCobrar }: {
  total: number; medios: { code: string; name: string; kind: string; requires_reference: boolean }[] | Medio[]; marcasTarjeta: Record<string, string>;
  saldoCliente: number; clienteIdentificado: boolean; enviando?: boolean; textoBoton?: string; onCobrar: (pagos: Pago[]) => void;
}) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [sig, setSig] = useState(1);

  const medio = (code: string) => medios.find((m) => m.code === code);
  const suma = r2(filas.reduce((s, f) => s + (Number(f.amount) || 0), 0));
  const noEfectivo = r2(filas.filter((f) => medio(f.method)?.kind !== "CASH").reduce((s, f) => s + (Number(f.amount) || 0), 0));
  const falta = r2(Math.max(0, total - suma));
  const vuelto = r2(Math.max(0, suma - total));
  const hayEfectivo = filas.some((f) => medio(f.method)?.kind === "CASH");

  const problemas: string[] = [];
  if (noEfectivo > total + 0.005) problemas.push("Tarjeta, Yape, Plin y saldo a favor no pueden pasar del total: el vuelto solo sale del efectivo.");
  if (vuelto > 0 && !hayEfectivo) problemas.push("Hay más pagado que el total y no hay efectivo para dar vuelto.");
  for (const f of filas) {
    const m = medio(f.method);
    if (!m) continue;
    if (!(Number(f.amount) > 0)) problemas.push(`${m.name}: escribe el monto.`);
    if (m.requires_reference && !f.reference.trim()) problemas.push(`${m.name}: escribe el número de operación.`);
    if (m.kind === "CARD" && !/^\d{4}$/.test(f.card_last4)) problemas.push(`${m.name}: escribe los 4 últimos dígitos de la tarjeta.`);
    if (f.method === "BALANCE" && Number(f.amount) > saldoCliente + 0.005) problemas.push(`El cliente tiene ${soles(saldoCliente)} de saldo a favor.`);
  }
  const listo = filas.length > 0 && falta === 0 && problemas.length === 0;

  function agregar(code: string) {
    const m = medio(code);
    if (!m) return;
    const resto = code === "BALANCE" ? Math.min(falta, saldoCliente) : falta;
    setFilas((fs) => [...fs, { key: sig, method: code, amount: resto > 0 ? resto.toFixed(2) : "", reference: "", card_brand: "VISA", card_last4: "" }]);
    setSig((x) => x + 1);
  }
  const cambiar = (key: number, p: Partial<Fila>) => setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));

  function cobrar() {
    onCobrar(filas.map((f) => {
      const m = medio(f.method)!;
      const p: Pago = { method: f.method, amount: r2(Number(f.amount)) };
      if (m.requires_reference) p.reference = f.reference.trim();
      if (m.kind === "CARD") Object.assign(p, { card_brand: f.card_brand, card_last4: f.card_last4 });
      return p;
    }));
  }

  const visibles = medios.filter((m) => m.code !== "BALANCE" || (clienteIdentificado && saldoCliente > 0));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between rounded-xl bg-primary-soft px-4 py-3 text-primary">
        <span className="text-[14px] font-medium">Total a cobrar</span>
        <span className="text-[26px] font-semibold tabular-nums">{soles(total)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {visibles.map((m) => {
          const Icono = ICONOS[m.kind] ?? Wallet;
          return (
            <button key={m.code} type="button" onClick={() => agregar(m.code)} disabled={m.code === "BALANCE" && filas.some((f) => f.method === "BALANCE")}
              className="flex h-12 cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-[13.5px] font-medium text-ink shadow-card hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50">
              <Icono size={18} className="shrink-0 text-primary" />
              <span className="min-w-0 truncate">{m.code === "BALANCE" ? `Saldo a favor (${soles(saldoCliente)})` : m.name}</span>
            </button>
          );
        })}
      </div>
      {!clienteIdentificado && <p className="text-[12px] text-muted">El saldo a favor solo se usa con un cliente identificado.</p>}

      {filas.length === 0 && <p className="text-[13px] text-muted">Elige uno o más medios de pago.</p>}
      <div className="space-y-2">
        {filas.map((f) => {
          const m = medio(f.method);
          if (!m) return null;
          return (
            <div key={f.key} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{m.code === "BALANCE" ? "Saldo a favor" : m.name}</span>
                <IconButton icon={Trash2} label={`Quitar ${m.name}`} onClick={() => setFilas((fs) => fs.filter((x) => x.key !== f.key))} />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label={m.kind === "CASH" ? "Recibido" : "Monto"}>
                  <Input prefix="S/" inputMode="decimal" value={f.amount} onChange={(e) => cambiar(f.key, { amount: e.target.value.replace(/[^\d.]/g, "") })} />
                </Field>
                {m.requires_reference && (
                  <Field label={m.kind === "CARD" ? "N.° de operación del POS" : "N.° de operación"}>
                    <Input value={f.reference} maxLength={40} onChange={(e) => cambiar(f.key, { reference: e.target.value })} />
                  </Field>
                )}
                {m.kind === "CARD" && (
                  <>
                    <Field label="Marca de la tarjeta">
                      <Select value={f.card_brand} onChange={(e) => cambiar(f.key, { card_brand: e.target.value })}
                        options={Object.entries(marcasTarjeta).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    <Field label="4 últimos dígitos">
                      <Input inputMode="numeric" maxLength={4} value={f.card_last4} onChange={(e) => cambiar(f.key, { card_last4: e.target.value.replace(/\D/g, "") })} />
                    </Field>
                  </>
                )}
              </div>
              {m.kind === "CASH" && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[r2(total - (suma - (Number(f.amount) || 0))), 20, 50, 100, 200].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => (
                    <button key={v} type="button" onClick={() => cambiar(f.key, { amount: v.toFixed(2) })}
                      className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-[12.5px] text-ink hover:bg-surface-2">{soles(v)}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-1 rounded-xl border border-line px-4 py-3 text-[14px]">
        <div className="flex justify-between"><span className="text-muted">Pagado</span><span className="tabular-nums">{soles(suma)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Falta</span><span className={`tabular-nums ${falta > 0 ? "font-semibold text-bad" : ""}`}>{soles(falta)}</span></div>
        <div className="flex justify-between text-[16px] font-semibold"><span>Vuelto</span><span className="tabular-nums text-ok">{soles(vuelto)}</span></div>
      </div>

      {problemas.length > 0 && filas.length > 0 && <Alert tone="warn">{problemas[0]}</Alert>}
      <Button variant="primary" className="h-12 w-full text-[15px]" loading={enviando} disabled={!listo} onClick={cobrar}>{textoBoton}</Button>
    </div>
  );
}
