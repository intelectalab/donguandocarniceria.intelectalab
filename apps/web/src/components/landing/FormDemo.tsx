"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { evento } from "./Analitica";
import type { PlanPublico } from "./Planes";

const TIPOS = [
  { value: "CARNICERIA", label: "Carnicería o puesto de mercado" },
  { value: "DISTRIBUIDORA", label: "Distribuidora de carne" },
  { value: "AVICOLA", label: "Avícola" },
  { value: "GRANJA", label: "Granja (cerdo, cuy, res)" },
  { value: "PLANTA", label: "Planta de desposte o camal" },
  { value: "OTRO", label: "Otro" },
];

const INTERESES = [
  { value: "PEDIDOS", label: "Pedidos por WhatsApp" },
  { value: "MOSTRADOR", label: "Mostrador" },
  { value: "REPARTO", label: "Reparto" },
  { value: "COMPROBANTES", label: "Boletas SUNAT" },
  { value: "DESPIECE", label: "Despiece" },
  { value: "CONSIGNACION", label: "Consignación" },
];

const campo = "min-h-[44px] w-full rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[14.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:bg-surface focus:shadow-[0_0_0_3px_var(--primary-soft)] focus:outline-none";
const etiqueta = "mb-1.5 block text-[13px] font-semibold text-ink";

/**
 * Pedido de demo, con los campos de la página del prototipo: nombre, WhatsApp, correo (opcional), rubro,
 * qué quiere ver (en la ventana) y el consentimiento. La API valida todo de nuevo, limita los envíos por IP
 * y guarda el pedido sin que la app lo pueda leer. «sitio_web» es una trampa para robots: no se ve ni se enfoca.
 */
export function FormDemo({ planes, plan, onPlan, conIntereses = false }: { planes: PlanPublico[]; plan: string; onPlan: (p: string) => void; conIntereses?: boolean }) {
  const [v, setV] = useState({ name: "", phone: "", email: "", business_type: "", sitio_web: "" });
  const [intereses, setIntereses] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const elegido = planes.find((p) => p.code === plan);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setError("");
    setEnviando(true);
    try {
      const telefono = v.phone.trim() && !v.phone.trim().startsWith("+") ? `+51 ${v.phone.trim()}` : v.phone.trim();
      const r = await api<{ message: string }>("/v1/publico/demo", {
        method: "POST",
        body: { ...v, phone: telefono, email: v.email || null, interests: intereses, plan_code: plan || null, consent,
          source: `${window.location.pathname}${window.location.search}`.slice(0, 200) },
      });
      setListo(r.message);
      // Para medir cuántos piden demo: solo el rubro, el plan y cuántos intereses, nunca lo que escribió.
      evento("enviar_demo", { rubro: v.business_type, plan: plan || undefined, intereses: intereses.length });
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) setError(mensajeDe(err, "No pudimos enviar tu pedido. Intenta de nuevo en un momento."));
    } finally {
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="py-6 text-center">
        <CheckCircle2 size={46} className="mx-auto text-ok" />
        <h3 className="mt-4 font-display text-[21px] font-bold">¡Listo, recibimos tu pedido!</h3>
        <p className="mt-2 text-[15px] text-muted">{listo}</p>
      </div>
    );
  }

  const err = (k: string) => errores[k] && <p className="mt-1 text-[12.5px] text-bad">{errores[k]}</p>;
  return (
    <form onSubmit={enviar} noValidate className="grid gap-4">
      {elegido && (
        <p className="flex items-center justify-between rounded-xl bg-primary-soft px-3.5 py-2 text-[13px] text-primary">
          <span>Plan elegido: <strong>{elegido.name}</strong></span>
          <button type="button" onClick={() => onPlan("")} className="cursor-pointer text-[12.5px] underline">Quitar</button>
        </p>
      )}
      <div>
        <label htmlFor={`demo-nombre-${conIntereses}`} className={etiqueta}>Tu nombre</label>
        <input id={`demo-nombre-${conIntereses}`} className={campo} value={v.name} onChange={set("name")} maxLength={80} autoComplete="name" placeholder="Ej. Carlos Ramos" required />
        {err("name")}
      </div>
      <div>
        <label htmlFor={`demo-whatsapp-${conIntereses}`} className={etiqueta}>WhatsApp</label>
        <div className="flex">
          <span className="grid min-h-[44px] place-items-center rounded-l-xl border border-r-0 border-line bg-surface-2 px-3 text-[14px] text-muted">+51</span>
          <input id={`demo-whatsapp-${conIntereses}`} type="tel" inputMode="tel" className={`${campo} rounded-l-none`} value={v.phone} onChange={set("phone")} maxLength={20} autoComplete="tel-national" placeholder="987 654 321" required />
        </div>
        {err("phone")}
      </div>
      <div>
        <label htmlFor={`demo-correo-${conIntereses}`} className={etiqueta}>Correo <span className="font-normal text-muted">(opcional)</span></label>
        <input id={`demo-correo-${conIntereses}`} type="email" className={campo} value={v.email} onChange={set("email")} maxLength={120} autoComplete="email" />
        {err("email")}
      </div>
      <div>
        <label htmlFor={`demo-tipo-${conIntereses}`} className={etiqueta}>Tipo de negocio</label>
        <select id={`demo-tipo-${conIntereses}`} className={campo} value={v.business_type} onChange={set("business_type")} required>
          <option value="">Elige tu rubro</option>
          {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {err("business_type")}
      </div>
      {conIntereses && (
        <fieldset>
          <legend className={etiqueta}>¿Qué te interesa ver?</legend>
          <div className="flex flex-wrap gap-2">
            {INTERESES.map((i) => {
              const on = intereses.includes(i.value);
              return (
                <button key={i.value} type="button" aria-pressed={on} onClick={() => setIntereses((x) => (on ? x.filter((y) => y !== i.value) : [...x, i.value]))}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors ${on ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface-2 text-ink hover:border-primary"}`}>
                  {i.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      <label className="flex items-start gap-2.5 text-[12.5px] leading-snug text-muted">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
        Acepto que Aycha me escriba por WhatsApp o correo sobre esta solicitud.
      </label>
      {err("consent")}
      {/* Trampa para robots: fuera de la vista y del teclado. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`demo-sitio-${conIntereses}`}>No llenar</label>
        <input id={`demo-sitio-${conIntereses}`} tabIndex={-1} autoComplete="off" value={v.sitio_web} onChange={set("sitio_web")} />
      </div>
      {error && <p className="rounded-xl border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13.5px] text-bad">{error}</p>}
      <button type="submit" disabled={enviando}
        className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold text-[15px] font-bold transition-[filter] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ color: "var(--franja-base)" }}>
        {enviando ? <><Loader2 size={17} className="animate-spin" /> Enviando…</> : <>Quiero mi demo <ArrowRight size={17} /></>}
      </button>
    </form>
  );
}
