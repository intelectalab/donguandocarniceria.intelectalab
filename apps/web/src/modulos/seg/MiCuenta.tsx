"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, KeyRound, MonitorSmartphone, ShieldCheck, UserRound, XCircle } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DetailList, Field, Input, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora } from "@/lib/formato";
import { aplicarModo, type ModoColor } from "@/lib/modoColor";
import { useSesion } from "@/lib/sesion";

type Cuenta = {
  datos: { name: string; email: string; roles: string; alcance: string; trabajador: string | null; ultimo_ingreso: string | null; idioma: string; empresa: string };
  preferencias: { default_brand_id: string | null; ui_theme_mode: ModoColor; avisos_correo: boolean; avisos_push: boolean; resumen_diario: boolean };
  marcas: { id: string; name: string }[];
  seguridad: {
    exige_2fa: boolean; twofa_enabled: boolean; mfa_enrolled_at: string | null; codigos_disponibles: number; password_changed_at: string | null;
    password_vence_dias: number; sesiones_abiertas: number; max_sesiones: number; regla: string;
  };
};

const MODOS = [{ value: "LIGHT", label: "Claro" }, { value: "DARK", label: "Oscuro" }, { value: "SYSTEM", label: "El del sistema" }];

/**
 * SEG-06 Mi cuenta: tus datos, contraseña, segundo factor, marca por defecto, modo de color y avisos.
 * La cifra «Sesiones abiertas» lleva a Mis sesiones y dispositivos (/perfil/sesiones), como en el
 * prototipo. La ve cualquier persona (también desde «Mi perfil»). Todo queda en la bitácora.
 */
export function MiCuenta() {
  const { me, recargar } = useSesion();
  const [c, setC] = useState<Cuenta | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    api<Cuenta>("/v1/seg/mi-cuenta").then(setC).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  const s = c?.seguridad;

  return (
    <div className="space-y-6">
      {me.user.must_change_password && (
        <Alert tone="warn">
          {me.user.password_vencida
            ? "Tu contraseña venció. Crea una nueva abajo para seguir usando el sistema."
            : "Debes crear una contraseña nueva antes de seguir usando el sistema."}
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Rol" valor={c ? c.datos.roles : undefined} detalle={s?.exige_2fa ? "Exige segundo factor" : "Sin segundo factor"} icono={UserRound} destacada />
        <Cifra titulo="Segundo factor" valor={s ? (s.twofa_enabled ? "Activo" : "No activo") : undefined} icono={ShieldCheck}
          detalle={s ? (s.twofa_enabled ? `Desde ${fecha(s.mfa_enrolled_at)}` : s.exige_2fa ? "Tu rol lo exige" : "Tu rol no lo exige") : undefined}
          tono={s ? (s.twofa_enabled ? "ok" : s.exige_2fa ? "warn" : undefined) : undefined} />
        <Link href="/perfil/sesiones" title="Ver mis sesiones y dispositivos" className="block min-w-0 rounded-xl transition hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-primary">
          <Cifra titulo="Sesiones abiertas" valor={s ? String(s.sesiones_abiertas) : undefined} detalle={s ? `Máximo ${s.max_sesiones} · Ver mis sesiones` : undefined} icono={MonitorSmartphone} />
        </Link>
        <Cifra titulo="Contraseña cambiada" valor={s ? (s.password_changed_at ? fecha(s.password_changed_at) : "Nunca") : undefined} icono={KeyRound}
          detalle={s ? (s.password_vence_dias ? `Vence a los ${s.password_vence_dias} días` : "No vence") : undefined} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Mis datos</h2>
          {c ? (
            <DetailList items={[
              { label: "Nombre", value: c.datos.name },
              { label: "Correo", value: c.datos.email },
              { label: "Empresa", value: c.datos.empresa },
              { label: "Rol", value: c.datos.roles },
              { label: "Alcance", value: c.datos.alcance },
              { label: "Trabajador", value: c.datos.trabajador ?? "—" },
              { label: "Último ingreso", value: c.datos.ultimo_ingreso ? fechaHora(c.datos.ultimo_ingreso) : "Nunca" },
              { label: "Idioma", value: c.datos.idioma === "es-PE" ? "Español (Perú)" : c.datos.idioma },
            ]} />
          ) : <div className="h-40 animate-pulse rounded bg-surface-2" />}
        </section>
        {c ? <Preferencias c={c} onGuardado={(x) => { setC(x); recargar(); }} /> : <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <CambiarClave regla={s?.regla} onCambio={() => { cargar(); recargar(); }} />
        <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="mb-3 text-[14px] font-semibold">Segundo factor</h2>
          {s ? (
            <>
              <DetailList items={[
                { label: "Estado", value: s.twofa_enabled ? <Badge tone="ok">Activo</Badge> : <Badge tone={s.exige_2fa ? "warn" : "neutral"}>{s.exige_2fa ? "Lo exige tu rol y no está activo" : "No activo"}</Badge> },
                { label: "Activado", value: s.mfa_enrolled_at ? fechaHora(s.mfa_enrolled_at) : "—" },
                { label: "Códigos de recuperación disponibles", value: String(s.codigos_disponibles) },
              ]} />
              <p className="mt-3 text-[12.5px] text-muted">Activarlo y generar códigos de recuperación llegará con el segundo factor. Si necesitas reiniciarlo, pídelo al administrador del sistema.</p>
            </>
          ) : <div className="h-24 animate-pulse rounded bg-surface-2" />}
        </section>
      </div>
    </div>
  );
}

/** Marca por defecto, modo de color y avisos. */
function Preferencias({ c, onGuardado }: { c: Cuenta; onGuardado: (c: Cuenta) => void }) {
  const [v, setV] = useState(c.preferencias);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    try {
      const r = await api<Cuenta>("/v1/seg/mi-cuenta/preferencias", { method: "PUT", body: { ...v, default_brand_id: v.default_brand_id || null } });
      aplicarModo(r.preferencias.ui_theme_mode);
      toast.ok("Preferencias guardadas");
      onGuardado(r);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="text-[14px] font-semibold">Preferencias</h2>
      <Field label="Marca por defecto" error={errores.default_brand_id} hint="La que se elige sola al entrar.">
        <Select value={v.default_brand_id ?? ""} onChange={(e) => setV((x) => ({ ...x, default_brand_id: e.target.value || null }))} placeholder="Todas mis marcas"
          options={c.marcas.map((m) => ({ value: m.id, label: m.name }))} />
      </Field>
      <Field label="Modo de color" required error={errores.ui_theme_mode}>
        <Select value={v.ui_theme_mode} onChange={(e) => setV((x) => ({ ...x, ui_theme_mode: e.target.value as ModoColor }))} options={MODOS} />
      </Field>
      <div className="space-y-2">
        <Checkbox label="Avisos por correo" checked={v.avisos_correo} onChange={(m) => setV((x) => ({ ...x, avisos_correo: m }))} />
        <Checkbox label="Notificaciones en el celular" checked={v.avisos_push} onChange={(m) => setV((x) => ({ ...x, avisos_push: m }))} />
        <Checkbox label="Resumen diario" checked={v.resumen_diario} onChange={(m) => setV((x) => ({ ...x, resumen_diario: m }))} />
      </div>
      <div className="flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={guardando}>Guardar preferencias</Button>
      </div>
    </form>
  );
}

/** Cambiar la contraseña con la política a la vista. Al cambiarla se cierran tus otras sesiones. */
function CambiarClave({ regla, onCambio }: { regla?: string; onCambio: () => void }) {
  const [v, setV] = useState({ actual: "", nueva: "", repite: "" });
  const [checks, setChecks] = useState<{ etiqueta: string; ok: boolean }[]>([]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const nueva = v.nueva;

  useEffect(() => {
    let vigente = true;
    const t = setTimeout(() => {
      api<{ checks: { etiqueta: string; ok: boolean }[] }>("/v1/seg/mi-cuenta/probar-clave", { method: "POST", body: { password: nueva } })
        .then((r) => vigente && setChecks(r.checks)).catch(() => {});
    }, nueva ? 400 : 0);
    return () => { vigente = false; clearTimeout(t); };
  }, [nueva]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setErrores({});
    if (v.nueva !== v.repite) { setErrores({ password_confirmation: "No coincide con la nueva contraseña." }); return; }
    setGuardando(true);
    try {
      await api("/v1/me/password", { method: "POST", body: { current_password: v.actual, password: v.nueva, password_confirmation: v.repite } });
      toast.ok("Contraseña cambiada. Se cerraron tus otras sesiones.");
      setV({ actual: "", nueva: "", repite: "" });
      onCambio();
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} noValidate className="min-w-0 space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
      <div>
        <h2 className="text-[14px] font-semibold">Cambiar contraseña</h2>
        {regla && <p className="mt-0.5 text-[12.5px] text-muted">{regla}</p>}
      </div>
      <Field label="Contraseña actual" required error={errores.current_password}>
        <Input type="password" value={v.actual} onChange={(e) => setV((x) => ({ ...x, actual: e.target.value }))} autoComplete="current-password" maxLength={200} />
      </Field>
      <Field label="Nueva contraseña" required error={errores.password}>
        <Input type="password" value={v.nueva} onChange={(e) => setV((x) => ({ ...x, nueva: e.target.value }))} autoComplete="new-password" maxLength={200} />
      </Field>
      <ul className="space-y-1">
        {checks.map((x) => (
          <li key={x.etiqueta} className="flex items-center gap-2 text-[12.5px]">
            {nueva && x.ok ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : nueva ? <XCircle size={15} className="shrink-0 text-bad" /> : <Circle size={15} className="shrink-0 text-muted" />}
            <span className={nueva && !x.ok ? "text-ink" : "text-muted"}>{x.etiqueta}</span>
          </li>
        ))}
      </ul>
      <Field label="Repite la nueva" required error={errores.password_confirmation}>
        <Input type="password" value={v.repite} onChange={(e) => setV((x) => ({ ...x, repite: e.target.value }))} autoComplete="new-password" maxLength={200} />
      </Field>
      <div className="flex justify-end border-t border-line pt-4">
        <Button type="submit" variant="primary" loading={guardando} disabled={!v.actual || !v.nueva || !v.repite}>Cambiar contraseña</Button>
      </div>
    </form>
  );
}
