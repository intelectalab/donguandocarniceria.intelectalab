"use client";

import { Suspense, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { evento } from "./Analitica";
import { MarcoPublico, useMarco } from "./MarcoPublico";

const RUBROS = [
  ["CARNICERIA", "Carnicería o puesto de mercado"], ["DISTRIBUIDORA", "Distribuidora de carne"], ["AVICOLA", "Avícola"],
  ["CHARCUTERIA", "Charcutería"], ["GOURMET", "Tienda gourmet"], ["PLANTA", "Planta de desposte o camal"], ["OTRO", "Otro"],
];
const REGIMENES = [["MYPE", "Régimen MYPE Tributario"], ["RER", "Régimen Especial (RER)"], ["GENERAL", "Régimen General"], ["NRUS", "Nuevo RUS"]];

const campo = "min-h-[44px] w-full rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-[14.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:bg-surface focus:shadow-[0_0_0_3px_var(--primary-soft)] focus:outline-none";
const etiqueta = "mb-1.5 block text-[13px] font-semibold text-ink";

/** ONB-01 Registro: la empresa crea su cuenta con su RUC, verifica su correo con un código y empieza su prueba gratis. */
export default function PaginaRegistro() {
  return (
    <MarcoPublico actual="registro">
      <Suspense><Registro /></Suspense>
    </MarcoPublico>
  );
}

function Campo({ label, error, children, ayuda, className = "" }: { label: string; error?: string; ayuda?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className={etiqueta}>{label}</label>
      {children}
      {ayuda && !error && <p className="mt-1 text-[12.5px] text-muted">{ayuda}</p>}
      {error && <p role="alert" className="mt-1 text-[12.5px] text-bad">{error}</p>}
    </div>
  );
}

function Clave({ value, onChange, autoComplete = "new-password" }: { value: string; onChange: (v: string) => void; autoComplete?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <input type={ver ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className={`${campo} pr-11`} />
      <button type="button" onClick={() => setVer((x) => !x)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted hover:text-ink">
        {ver ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function Registro() {
  const { planes, pruebaDias } = useMarco();
  const planInicial = useSearchParams().get("plan") ?? "";
  const [paso, setPaso] = useState<"datos" | "codigo" | "listo">("datos");
  const [v, setV] = useState({ ruc: "", legal_name: "", trade_name: "", business_type: "", tax_regime: "MYPE", fiscal_address: "", plan_code: planInicial,
    contact_name: "", email: "", phone: "", password: "", password_confirmation: "", sitio_web: "" });
  const [terminos, setTerminos] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ trade_name: string; dias: number } | null>(null);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  // Sin plan elegido (ni en la dirección): el destacado.
  const planCode = v.plan_code || planes.find((p) => p.is_featured)?.code || planes[0]?.code || "";

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setError("");
    setEnviando(true);
    try {
      await api("/v1/publico/registro", { method: "POST", body: { ...v, plan_code: planCode, phone: v.phone.replace(/\D/g, ""), terms: terminos,
        source: typeof window !== "undefined" ? window.location.search.slice(0, 200) : null } });
      evento("registro_enviado", { plan: planCode });
      setPaso("codigo");
      window.scrollTo({ top: 0 });
    } catch (err) {
      const c = erroresDe(err);
      setErrores(c);
      setError(Object.keys(c).length ? "Revisa los campos marcados." : mensajeDe(err));
    } finally {
      setEnviando(false);
    }
  }

  async function verificar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setError("");
    setEnviando(true);
    try {
      setListo(await api<{ trade_name: string; dias: number }>("/v1/publico/registro/verificar", { method: "POST", body: { email: v.email, codigo } }));
      evento("registro_verificado", { plan: planCode });
      setPaso("listo");
    } catch (err) {
      setError(mensajeDe(err));
      setCodigo("");
    } finally {
      setEnviando(false);
    }
  }

  const err = (k: string) => errores[k];
  return (
    <section className="mx-auto grid max-w-[1100px] gap-10 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[1fr_1.35fr] [&>*]:min-w-0">
      <div className="lg:pt-6">
        <p className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-[12.5px] font-semibold text-primary">Prueba gratis de {pruebaDias} días</p>
        <h1 className="mt-4 font-display text-[34px] leading-tight font-bold text-ink sm:text-[40px]">Crea la cuenta de tu empresa</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-muted">En unos minutos tienes tu sistema listo para cargar tus productos, tus clientes y tu equipo.</p>
        <ul className="mt-6 space-y-2.5 text-[15px] text-ink">
          {["Sin tarjeta ni contrato de permanencia", "Los módulos de tu plan, encendidos desde el primer día", "Un asistente te guía para registrar tus marcas y locales", "Tus datos son solo tuyos: ninguna otra empresa los ve"].map((t) => (
            <li key={t} className="flex gap-2.5"><Check size={18} className="mt-0.5 shrink-0 text-ok" />{t}</li>
          ))}
        </ul>
        <p className="mt-8 text-[14px] text-muted">¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-primary hover:underline">Ingresar</Link></p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        {paso === "datos" && (
          <form onSubmit={registrar} noValidate className="relative grid gap-4 sm:grid-cols-2">
            <h2 className="font-display text-[19px] font-bold text-ink sm:col-span-2">Tu empresa</h2>
            <Campo label="RUC" error={err("ruc")} ayuda="11 dígitos">
              <input inputMode="numeric" maxLength={11} value={v.ruc} onChange={(e) => setV((x) => ({ ...x, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) }))} className={campo} />
            </Campo>
            <Campo label="Razón social" error={err("legal_name")}><input value={v.legal_name} onChange={set("legal_name")} maxLength={200} className={campo} /></Campo>
            <Campo label="Nombre comercial" error={err("trade_name")} ayuda="Como te conocen tus clientes"><input value={v.trade_name} onChange={set("trade_name")} maxLength={80} className={campo} /></Campo>
            <Campo label="Rubro" error={err("business_type")}>
              <select value={v.business_type} onChange={set("business_type")} className={campo}>
                <option value="">Elige tu rubro</option>
                {RUBROS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </Campo>
            <Campo label="Régimen tributario" error={err("tax_regime")}>
              <select value={v.tax_regime} onChange={set("tax_regime")} className={campo}>
                {REGIMENES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
              </select>
            </Campo>
            <Campo label="Domicilio fiscal" error={err("fiscal_address")}><input value={v.fiscal_address} onChange={set("fiscal_address")} maxLength={250} className={campo} /></Campo>

            <Campo label="Plan" error={err("plan_code")} className="sm:col-span-2">
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Plan">
                {planes.map((p) => {
                  const elegido = planCode === p.code;
                  return (
                    <button key={p.code} type="button" role="radio" aria-checked={elegido} onClick={() => setV((x) => ({ ...x, plan_code: p.code }))}
                      className={`relative cursor-pointer rounded-xl border p-3 text-left transition-colors ${elegido ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2"}`}>
                      {elegido && <Check size={15} className="absolute top-3 right-3 text-primary" strokeWidth={3} />}
                      <span className="block font-display text-[15px] font-bold text-ink">{p.name}</span>
                      <span className="block text-[13px] text-muted">S/ {p.price_pen} al mes, después de la prueba</span>
                    </button>
                  );
                })}
              </div>
            </Campo>

            <h2 className="mt-2 font-display text-[19px] font-bold text-ink sm:col-span-2">Tus datos de acceso</h2>
            <Campo label="Tu nombre" error={err("contact_name")}><input value={v.contact_name} onChange={set("contact_name")} maxLength={120} autoComplete="name" className={campo} /></Campo>
            <Campo label="Celular" error={err("phone")}><input inputMode="tel" value={v.phone} onChange={set("phone")} maxLength={15} autoComplete="tel" placeholder="987654321" className={campo} /></Campo>
            <Campo label="Correo" error={err("email")} ayuda="Ahí te llega el código para activar tu cuenta" className="sm:col-span-2">
              <input type="email" value={v.email} onChange={set("email")} maxLength={120} autoComplete="email" className={campo} />
            </Campo>
            <Campo label="Contraseña" error={err("password")} ayuda="10 caracteres o más, con mayúsculas, minúsculas y un número">
              <Clave value={v.password} onChange={(x) => setV((y) => ({ ...y, password: x }))} />
            </Campo>
            <Campo label="Repite la contraseña" error={err("password_confirmation")}>
              <Clave value={v.password_confirmation} onChange={(x) => setV((y) => ({ ...y, password_confirmation: x }))} />
            </Campo>

            <label className="flex items-start gap-2.5 text-[13.5px] text-muted sm:col-span-2">
              <input type="checkbox" checked={terminos} onChange={(e) => setTerminos(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
              <span>Acepto los términos del servicio y la política de privacidad de GestionCarnica.</span>
            </label>
            {err("terms") && <p role="alert" className="-mt-2 text-[12.5px] text-bad sm:col-span-2">{err("terms")}</p>}
            {/* Trampa para robots: las personas no la ven. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="registro-sitio">Sitio web</label>
              <input id="registro-sitio" tabIndex={-1} autoComplete="off" value={v.sitio_web} onChange={set("sitio_web")} />
            </div>
            {error && <p role="alert" className="rounded-xl border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13.5px] text-bad sm:col-span-2">{error}</p>}
            <button type="submit" disabled={enviando}
              className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-[15.5px] font-semibold text-primary-ink hover:brightness-110 disabled:opacity-60 sm:col-span-2">
              {enviando ? <><Loader2 size={17} className="animate-spin" />Creando…</> : <>Crear mi cuenta <ArrowRight size={18} /></>}
            </button>
          </form>
        )}

        {paso === "codigo" && (
          <form onSubmit={verificar} className="grid gap-4">
            <MailCheck size={34} className="text-primary" />
            <h2 className="font-display text-[22px] font-bold text-ink">Revisa tu correo</h2>
            <p className="text-[15px] text-muted">Te enviamos un código de 6 caracteres a <b className="text-ink">{v.email}</b>. Escríbelo aquí para activar tu cuenta.</p>
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} autoComplete="one-time-code"
              aria-label="Código" placeholder="ABC123" className={`${campo} max-w-[220px] text-center font-mono text-[20px] tracking-[.35em]`} />
            {error && <p role="alert" className="rounded-xl border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13.5px] text-bad">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={enviando || codigo.length !== 6}
                className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-ink hover:brightness-110 disabled:opacity-60">
                {enviando ? <><Loader2 size={17} className="animate-spin" />Activando…</> : "Activar mi cuenta"}
              </button>
              <button type="button" onClick={() => { setPaso("datos"); setError(""); }} className="cursor-pointer text-[14px] font-medium text-primary hover:underline">Cambiar mis datos o pedir otro código</button>
            </div>
            <p className="text-[13px] text-muted">¿No te llegó? Revisa la carpeta de spam. El código vence en 48 horas.</p>
          </form>
        )}

        {paso === "listo" && listo && (
          <div className="grid gap-4">
            <CheckCircle2 size={36} className="text-ok" />
            <h2 className="font-display text-[22px] font-bold text-ink">¡{listo.trade_name} ya tiene su cuenta!</h2>
            <p className="text-[15px] text-muted">Tu prueba gratis de {listo.dias} días empezó hoy. Ingresa con tu correo y la contraseña que elegiste; el asistente te guía para registrar tus marcas y locales.</p>
            <Link href="/login" className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-6 py-3 text-[15px] font-semibold text-primary-ink hover:brightness-110">
              Ingresar a mi sistema <ArrowRight size={18} />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
