"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Eye, EyeOff, Loader2, Users } from "lucide-react";
import AuthShell, { authButton, authError, authInput, authInputIcon, authLabel, item } from "./AuthShell";
import { ApiError, api } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";

type LoginResponse = { token: string; must_change_password: boolean };

/** Primer error de la respuesta de la API, o su mensaje. */
export function mensajeDe(err: unknown, porDefecto: string) {
  if (err instanceof ApiError) return (err.errors && Object.values(err.errors)[0]?.[0]) || err.message;
  return porDefecto;
}

/**
 * Ingreso. Como en erp-saas, en el ingreso general lleva «Volver al inicio» (la página pública) y
 * «Ver planes»; con el dominio de una empresa no, porque son de la página de Aycha.
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api<LoginResponse>("/v1/auth/login", { method: "POST", body: { email, password, remember } });
      setToken(data.token, remember);
      // Pendiente de SEG: el segundo factor. La contraseña vencida la maneja el armazón (lleva a Mi cuenta).
      // «volver» solo puede ser una dirección de este sitio: «//otro.com» o «/\otro.com» llevarían a otro sitio.
      router.push(volver && /^\/(?![/\\])/.test(volver) ? volver : "/inicio");
    } catch (err) {
      setError(mensajeDe(err, "Ocurrió un error. Intenta de nuevo."));
      setLoading(false);
    }
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
