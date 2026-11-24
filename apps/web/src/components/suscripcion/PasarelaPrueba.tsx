"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input } from "@/components/ui";

export type TarjetaTokenizada = { gateway: "FAKE"; token: string; brand: string; last4: string; exp_month: number; exp_year: number };

/** Luhn: el número es de una tarjeta válida. */
const luhn = (n: string) => {
  let s = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    s += d;
  }
  return n.length >= 13 && s % 10 === 0;
};
const marca = (n: string) => (/^4/.test(n) ? "Visa" : /^(5[1-5]|2[2-7])/.test(n) ? "Mastercard" : /^3[47]/.test(n) ? "American Express" : /^3(0|6|8)/.test(n) ? "Diners Club" : null);
const aleatorio = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Formulario de la pasarela de prueba (RN-SUS-20). Simula el formulario seguro que da la pasarela real: el número de
 * la tarjeta se convierte en un token aquí, en el navegador, y al sistema solo llegan el token, la marca, los 4 últimos
 * dígitos y el vencimiento. Tarjetas de prueba: termina en 0002 → la rechaza el banco; en 9995 → fondos insuficientes.
 */
export function PasarelaPrueba({ correo, onTokenizada, guardando }: {
  correo?: string | null; guardando: boolean; onTokenizada: (t: TarjetaTokenizada, extra: { auto_pay: boolean; billing_email: string }) => void;
}) {
  const [f, setF] = useState({ numero: "", nombre: "", vence: "", cvv: "", auto_pay: true, billing_email: correo ?? "" });
  const [error, setError] = useState("");

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const numero = f.numero.replace(/\D/g, "");
    const [mm, aa] = f.vence.split("/").map((x) => Number(x.trim()));
    const tipo = marca(numero);
    if (!luhn(numero) || !tipo) return setError("Revisa el número de la tarjeta.");
    if (!mm || mm > 12 || !aa) return setError("El vencimiento va como MM/AA.");
    if (!/^\d{3,4}$/.test(f.cvv)) return setError("Revisa el código de seguridad.");
    setError("");
    const resultado = numero.endsWith("0002") ? "declined" : numero.endsWith("9995") ? "insufficient" : "ok";
    onTokenizada({ gateway: "FAKE", token: `fake_tok_${resultado}_${aleatorio()}`, brand: tipo, last4: numero.slice(-4), exp_month: mm, exp_year: 2000 + (aa % 100) },
      { auto_pay: f.auto_pay, billing_email: f.billing_email });
  }

  return (
    <form onSubmit={enviar} className="grid gap-4 rounded-xl border border-line p-4">
      <p className="flex items-center gap-2 text-[13px] text-muted"><Lock size={14} aria-hidden="true" />Pasarela de prueba: la tarjeta no se guarda en GestionCarnica, solo el código que da la pasarela.</p>
      {error && <Alert tone="bad">{error}</Alert>}
      <Field label="Número de la tarjeta">
        <Input inputMode="numeric" autoComplete="cc-number" placeholder="4242 4242 4242 4242" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
      </Field>
      <Field label="Nombre en la tarjeta"><Input autoComplete="cc-name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Vence (MM/AA)"><Input autoComplete="cc-exp" placeholder="12/30" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} /></Field>
        <Field label="Código de seguridad"><Input inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={f.cvv} onChange={(e) => setF({ ...f, cvv: e.target.value })} /></Field>
      </div>
      <Field label="Correo para los comprobantes"><Input type="email" value={f.billing_email} onChange={(e) => setF({ ...f, billing_email: e.target.value })} /></Field>
      <Checkbox checked={f.auto_pay} onChange={(v) => setF({ ...f, auto_pay: v })} label="Cobrar automáticamente cada mes" />
      <Button type="submit" variant="primary" loading={guardando} className="justify-self-start">Guardar tarjeta</Button>
    </form>
  );
}
