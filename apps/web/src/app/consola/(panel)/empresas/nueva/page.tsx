"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, Copy, Loader2 } from "lucide-react";
import { Alert, Button, Field, Input, PageHeader, Select, buttonClass, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { ApiError, erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { soles } from "@/lib/formato";

type Plan = { code: string; name: string; description: string; price_pen: number; users_max: number; brands_max: number; sites_max: number; is_featured: boolean; modulos: number };
type Opciones = { planes: Plan[]; regimenes: { code: string; name: string }[]; rubros: { code: string; name: string }[]; prueba_dias: number; prueba_max: number };
type Resultado = { id: string; codigo: string; admin_email: string };

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-[15px] font-bold text-ink">{titulo}</h2>
      {ayuda && <p className="mt-0.5 text-[13px] text-muted">{ayuda}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Alta de una empresa desde la consola: crea la empresa con su razón social, roles y permisos, enciende los
 * módulos de su plan, invita a su administrador y abre la suscripción de prueba (RN-ONB-17, RN-SUS-08 y 15).
 */
export default function NuevaEmpresa() {
  const yo = useUsuarioConsola();
  const [op, setOp] = useState<Opciones | null>(null);
  const [v, setV] = useState({ ruc: "", legal_name: "", trade_name: "", tax_regime: "MYPE", fiscal_address: "", business_type: "DISTRIBUIDORA",
    plan_code: "", trial_days: "", admin_name: "", admin_email: "", admin_phone: "", hostname: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [hecho, setHecho] = useState<Resultado | null>(null);
  const campo = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value })) });

  useEffect(() => {
    apiConsola<Opciones>("/empresas/opciones").then((o) => {
      setOp(o);
      setV((x) => ({ ...x, plan_code: o.planes.find((p) => p.is_featured)?.code ?? o.planes[0]?.code ?? "", trial_days: String(o.prueba_dias) }));
    }).catch((e) => setGeneral(mensajeDe(e)));
  }, []);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    setGeneral("");
    setGuardando(true);
    try {
      setHecho(await apiConsola<Resultado>("/empresas", { method: "POST", body: { ...v, trial_days: Number(v.trial_days) || undefined,
        admin_phone: v.admin_phone || undefined, hostname: v.hostname || undefined } }));
      window.scrollTo({ top: 0 });
    } catch (err) {
      // Las reglas de negocio de un campo se muestran junto a él (RUC, días de prueba, dominio).
      const deRegla: Record<string, string> = { "RN-ONB-01": "ruc", "RN-ONB-02": "ruc", "RN-SUS-15": "trial_days", "RN-PLT-15": "hostname", "RN-SUS-05": "plan_code" };
      const regla = err instanceof ApiError && err.code ? deRegla[err.code] : undefined;
      const porCampo = regla ? { [regla]: mensajeDe(err) } : erroresDe(err);
      setErrores(porCampo);
      setGeneral(Object.keys(porCampo).length ? "Revisa los campos marcados." : mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const volver = <Link href="/consola/empresas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"><ArrowLeft size={14} />Empresas</Link>;

  if (!yo.puede["tenant.create"]) {
    return <div className="grid gap-4">{volver}<Alert tone="warn">Solo un administrador de plataforma da de alta empresas.</Alert></div>;
  }

  if (hecho) {
    return (
      <div className="grid max-w-[720px] gap-5">
        {volver}
        <div className="rounded-xl border border-ok/30 bg-ok-soft p-5">
          <p className="flex items-center gap-2 font-display text-[17px] font-bold text-ok"><CheckCircle2 size={20} /> {v.trade_name} ya tiene su cuenta</p>
          <p className="mt-2 text-[13.5px] text-ink">
            Se creó la empresa con sus roles y los módulos del plan, y la suscripción de prueba. A <b>{hecho.admin_email}</b> le llegó un correo para crear su contraseña.
          </p>
        </div>
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="font-display text-[15px] font-bold text-ink">Código de la invitación</h2>
          <p className="mt-1 text-[13px] text-muted">Por si el correo no le llega: en el ingreso del sistema elige «Olvidé mi contraseña», luego «Ya tengo un código», y usa este código con su correo. Vence en 48 horas y solo se muestra ahora.</p>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(hecho.codigo); toast.ok("Código copiado"); }}
            className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[20px] tracking-[.3em] text-ink hover:bg-line/40">
            {hecho.codigo} <Copy size={16} className="text-muted" />
          </button>
        </section>
        <div className="flex flex-wrap gap-2">
          <Link href={`/consola/empresas/ficha?id=${hecho.id}`} className={buttonClass("primary")}>Ver la ficha de la empresa</Link>
          <Link href="/consola/empresas" className={buttonClass("secondary")}>Volver a la lista</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {volver}
      <PageHeader
        description="Crea la empresa con su RUC, le enciende los módulos del plan elegido, invita a su administrador y abre su prueba gratuita. Las marcas, locales y lo demás los registra la empresa con su asistente." />
      {!op ? (general ? <Alert tone="bad">{general}</Alert> : <div className="grid place-items-center py-16 text-muted"><Loader2 className="animate-spin" /></div>) : (
        <form onSubmit={guardar} className="grid gap-5" noValidate>
          <Seccion titulo="Empresa" ayuda="Datos fiscales como figuran en SUNAT. Un RUC solo puede tener una empresa en la plataforma.">
            <Field label="RUC" required error={errores.ruc} hint="11 dígitos, con su dígito verificador">
              <Input {...campo("ruc")} inputMode="numeric" maxLength={11} onChange={(e) => setV((x) => ({ ...x, ruc: e.target.value.replace(/\D/g, "").slice(0, 11) }))} />
            </Field>
            <Field label="Razón social" required error={errores.legal_name}><Input {...campo("legal_name")} maxLength={200} /></Field>
            <Field label="Nombre comercial" required error={errores.trade_name} hint="Como la conocen sus clientes"><Input {...campo("trade_name")} maxLength={80} /></Field>
            <Field label="Rubro" required error={errores.business_type}>
              <Select {...campo("business_type")} options={op.rubros.map((r) => ({ value: r.code, label: r.name }))} />
            </Field>
            <Field label="Régimen tributario" required error={errores.tax_regime}>
              <Select {...campo("tax_regime")} options={op.regimenes.map((r) => ({ value: r.code, label: r.name }))} />
            </Field>
            <Field label="Domicilio fiscal" required error={errores.fiscal_address}><Input {...campo("fiscal_address")} maxLength={250} /></Field>
          </Seccion>

          <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="font-display text-[15px] font-bold text-ink">Plan y prueba gratuita</h2>
            <p className="mt-0.5 text-[13px] text-muted">El plan enciende sus módulos y define los límites. Precios mensuales más IGV.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Plan">
              {op.planes.map((p) => {
                const elegido = v.plan_code === p.code;
                return (
                  <button key={p.code} type="button" role="radio" aria-checked={elegido} onClick={() => setV((x) => ({ ...x, plan_code: p.code }))}
                    className={`relative grid cursor-pointer gap-1 rounded-xl border p-4 text-left transition-colors ${elegido ? "border-primary bg-primary-soft" : "border-line hover:bg-surface-2"}`}>
                    {elegido && <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-primary text-primary-ink"><Check size={13} strokeWidth={3} /></span>}
                    <span className="font-display text-[15px] font-bold text-ink">{p.name}</span>
                    <span className="text-[13px] font-semibold text-ink">{soles(p.price_pen)} <span className="font-normal text-muted">al mes</span></span>
                    <span className="text-[12.5px] text-muted">{p.users_max} usuarios · {p.brands_max} marcas · {p.sites_max} locales · {p.modulos} módulos</span>
                    <span className="text-[12.5px] text-muted">{p.description}</span>
                  </button>
                );
              })}
            </div>
            {errores.plan_code && <p role="alert" className="mt-2 text-[12px] text-bad">{errores.plan_code}</p>}
            <div className="mt-4 max-w-[220px]">
              <Field label="Días de prueba" required error={errores.trial_days} hint={`Entre 1 y ${op.prueba_max}`}>
                <Input type="number" min={1} max={op.prueba_max} {...campo("trial_days")} />
              </Field>
            </div>
          </section>

          <Seccion titulo="Administrador de la empresa" ayuda="Recibe un correo con un código para crear su contraseña. Entra como Gerencia: ve todo y aprueba.">
            <Field label="Nombre completo" required error={errores.admin_name}><Input {...campo("admin_name")} maxLength={120} /></Field>
            <Field label="Correo" required error={errores.admin_email}><Input type="email" {...campo("admin_email")} maxLength={80} autoComplete="off" /></Field>
            <Field label="Celular" error={errores.admin_phone} hint="Opcional, 9 dígitos"><Input {...campo("admin_phone")} inputMode="tel" maxLength={15} /></Field>
            <Field label="Dominio propio" error={errores.hostname} hint="Opcional, por ejemplo sistema.carnesdelnorte.pe"><Input {...campo("hostname")} maxLength={120} placeholder="sin dominio propio" /></Field>
          </Seccion>

          {general && <Alert tone="bad">{general}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            <Link href="/consola/empresas" className={buttonClass("secondary")}>Cancelar</Link>
            <Button variant="primary" type="submit" loading={guardando}>Crear empresa</Button>
          </div>
        </form>
      )}
    </div>
  );
}
