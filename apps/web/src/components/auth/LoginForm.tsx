"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Eye, EyeOff, Loader2, ShieldCheck, Users } from "lucide-react";
import AuthShell, { authButton, authError, authInput, authInputIcon, authLabel, item } from "./AuthShell";
import { ApiError, api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { CodigosRecuperacion, PasoQr, soloCodigo, type Preparado } from "@/modulos/seg/SegundoFactor";

type Sesion = { token: string; must_change_password: boolean; codigos?: string[] };
/** Con el segundo factor, el ingreso devuelve un desafío en vez de la sesión (SEG-02 verificar, SEG-03 activar). */
type LoginResponse = Sesion | { mfa: "VERIFY" | "ENROLL"; desafio: string; vence_en_minutos: number };

/** Primer error de la respuesta de la API, o su mensaje. */
export function mensajeDe(err: unknown, porDefecto: string) {
  if (err instanceof ApiError) return (err.errors && Object.values(err.errors)[0]?.[0]) || err.message;
  return porDefecto;
}

/**
 * Ingreso. Como en erp-saas, en el ingreso general lleva «Volver al inicio» (la página pública) y
 * «Ver planes»; con el dominio de una empresa no, porque son de la página de GestionCarnica.
 * Con el segundo factor activo, después de la contraseña se pide el código de la app o uno de recuperación (SEG-02);
 * si es obligatorio para su rol y no lo tiene, se activa aquí mismo (SEG-03) antes de entrar.
 */
export default function LoginForm({ inicioUrl = "/", planesUrl = "/#precios" }: { inicioUrl?: string; planesUrl?: string }) {
  const router = useRouter();
  const volver = useSearchParams().get("volver");
  const { empresa, error: errorEmpresa, listo } = useEmpresa();
  const deEmpresa = empresa?.general === false;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Segundo factor: el paso en que va, el desafío del ingreso, el código y, al activarlo, el QR y los códigos.
  const [paso, setPaso] = useState<"login" | "verificar" | "activar" | "codigos">("login");
  const [desafio, setDesafio] = useState("");
  const [codigo, setCodigo] = useState("");
  const [recuperacion, setRecuperacion] = useState(false);
  const [qr, setQr] = useState<Preparado | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);

  /** Guarda la sesión y entra. La contraseña vencida la maneja el armazón (lleva a Mi cuenta). */
  function entrar(data: Sesion) {
    setToken(data.token, remember);
    // «volver» solo puede ser una dirección de este sitio: «//otro.com» o «/\otro.com» llevarían a otro sitio.
    router.push(volver && /^\/(?![/\\])/.test(volver) ? volver : "/inicio");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/v1/auth/login", { method: "POST", body: { email, password, remember } });
      if ("mfa" in data) {
        setDesafio(data.desafio);
        setCodigo("");
        setPassword("");
        if (data.mfa === "ENROLL") {
          setQr(await api<Preparado>("/v1/auth/mfa/preparar", { method: "POST", body: { desafio: data.desafio } }));
          setPaso("activar");
        } else {
          setPaso("verificar");
        }
        setLoading(false);
        return;
      }
      entrar(data);
    } catch (err) {
      setError(mensajeDe(err, "Ocurrió un error. Intenta de nuevo."));
      setLoading(false);
    }
  }

  /** SEG-02 (verificar) o SEG-03 (activar): el código del paso del segundo factor. */
  async function enviarCodigo(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (paso === "activar") {
        const data = await api<Sesion>("/v1/auth/mfa/activar", { method: "POST", body: { desafio, codigo } });
        setSesion(data);
        setPaso("codigos");
        setLoading(false);
        return;
      }
      entrar(await api<Sesion>("/v1/auth/mfa/verificar", { method: "POST", body: { desafio, codigo } }));
    } catch (err) {
      const msg = mensajeDe(err, "Ocurrió un error. Intenta de nuevo.");
      setError(msg);
      setLoading(false);
      // Venció o se agotaron los intentos: vuelve a pedir correo y contraseña.
      if (/Vuelve a escribir tu correo/.test(msg)) volverAlIngreso(msg);
    }
  }

  function volverAlIngreso(msg = "") {
    setPaso("login");
    setDesafio("");
    setCodigo("");
    setQr(null);
    setRecuperacion(false);
    setError(msg);
  }

  if (paso !== "login") {
    const titulo = paso === "verificar" ? "Verificación en dos pasos" : paso === "activar" ? "Activa el segundo factor" : "Tus códigos de recuperación";
    const sub = paso === "verificar"
      ? (recuperacion ? "Escribe uno de tus códigos de recuperación." : "Escribe el código de 6 dígitos de tu app autenticadora.")
      : paso === "activar" ? "Tu rol lo exige: vincula tu cuenta con una app autenticadora antes de entrar."
        : "Guárdalos antes de entrar: no se vuelven a mostrar.";
    return (
      <AuthShell empresa={empresa} pending={!listo} title={titulo} subtitle={sub}>
        {paso === "codigos" && sesion?.codigos ? (
          <CodigosRecuperacion codigos={sesion.codigos} cuenta={email} boton="Ya los guardé, entrar" onListo={() => entrar(sesion)} />
        ) : (
          <form onSubmit={enviarCodigo} noValidate className="grid gap-3.5">
            {paso === "activar" && qr ? <PasoQr p={qr} codigo={codigo} onCodigo={setCodigo} /> : (
              <motion.div variants={item}>
                <label htmlFor="codigo" className={authLabel}>{recuperacion ? "Código de recuperación" : "Código de la app"}</label>
                <div className="relative">
                  <input id="codigo" required autoFocus autoComplete="one-time-code" inputMode={recuperacion ? "text" : "numeric"}
                    placeholder={recuperacion ? "ABCD-EFGH" : "123456"} maxLength={recuperacion ? 12 : 6} value={codigo}
                    onChange={(e) => setCodigo(recuperacion ? e.target.value.toUpperCase() : soloCodigo(e.target.value))}
                    className={`${authInput} font-mono tracking-[0.3em]`} />
                  <ShieldCheck size={17} className={authInputIcon} />
                </div>
              </motion.div>
            )}
            {paso === "verificar" && (
              <button type="button" onClick={() => { setRecuperacion((r) => !r); setCodigo(""); setError(""); }}
                className="cursor-pointer justify-self-start text-[12.5px] font-medium text-primary hover:underline">
                {recuperacion ? "Usar el código de la app" : "¿No tienes tu celular? Usa un código de recuperación"}
              </button>
            )}
            {error && <div role="alert" className={authError}>{error}</div>}
            <button type="submit" disabled={loading || (recuperacion ? codigo.replace(/[^A-Z0-9]/g, "").length < 8 : codigo.length !== 6)} aria-busy={loading} className={authButton}>
              {loading ? (<><Loader2 size={16} className="animate-spin" />Verificando…</>) : paso === "activar" ? "Activar y continuar" : "Verificar"}
            </button>
            <button type="button" onClick={() => volverAlIngreso()} className="flex cursor-pointer items-center justify-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
              <ArrowLeft size={14} aria-hidden="true" />Volver al ingreso
            </button>
          </form>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell empresa={empresa} pending={!listo} title="Iniciar sesión" subtitle="Hola de nuevo. Ingresa con el correo que te registró tu empresa."
      volver={deEmpresa || !listo ? undefined : { href: inicioUrl, label: "Volver al inicio" }}
      footer={deEmpresa || !listo ? undefined : <>¿Aún no tienes cuenta? <a href={planesUrl} className="font-medium text-primary hover:underline">Ver planes</a></>}>
      <form onSubmit={handleSubmit} noValidate className="grid gap-3.5">
        {errorEmpresa && <div role="alert" className={authError}>{errorEmpresa}</div>}

        <motion.div variants={item}>
          <label htmlFor="email" className={authLabel}>Correo</label>
          <div className="relative">
            <input id="email" type="email" required autoComplete="username" placeholder="nombre@empresa.pe"
              value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
            <Users size={17} className={authInputIcon} />
          </div>
        </motion.div>

        <motion.div variants={item}>
          <label htmlFor="password" className={authLabel}>Contraseña</label>
          <div className="relative">
            <input id="password" type={showPassword ? "text" : "password"} required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
            <button type="button" onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-1/2 right-1 flex size-[34px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:text-ink">
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </motion.div>

        <motion.div variants={item} className="flex flex-wrap items-center justify-between gap-2.5 text-[12.5px]">
          <button type="button" role="checkbox" aria-checked={remember} onClick={() => setRemember((r) => !r)} className="flex cursor-pointer items-center gap-2">
            <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${remember ? "border-primary bg-primary" : "border-line bg-transparent"}`}>
              {remember && <Check size={12} className="text-primary-ink" strokeWidth={3} />}
            </span>
            <span className="text-muted">Recordarme</span>
          </button>
          <Link href="/forgot-password" className="font-medium text-primary hover:underline">¿Olvidaste tu contraseña?</Link>
        </motion.div>

        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} role="alert" className={authError}>
            {error}
          </motion.div>
        )}

        <motion.button variants={item} type="submit" disabled={loading || Boolean(errorEmpresa)} aria-busy={loading} className={authButton}>
          {loading ? (<><Loader2 size={16} className="animate-spin" />Ingresando…</>) : "Ingresar"}
        </motion.button>
      </form>
    </AuthShell>
  );
}
