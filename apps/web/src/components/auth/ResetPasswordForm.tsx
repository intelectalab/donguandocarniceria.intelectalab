"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Loader2, Mail } from "lucide-react";
import AuthShell, { authButton, authError, authGhostButton, authInput, authInputIcon, authLabel, item } from "./AuthShell";
import { mensajeDe } from "./LoginForm";
import { api } from "@/lib/api";
import { useEmpresa } from "@/lib/empresa";

export default function ResetPasswordForm() {
  const router = useRouter();
  const { empresa, listo } = useEmpresa();
  const [email, setEmail] = useState(useSearchParams().get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [regla, setRegla] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ rule: string }>("/v1/auth/password-rule").then((r) => setRegla(r.rule)).catch(() => undefined);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/v1/auth/reset", { method: "POST", body: { email, code, password } });
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo actualizar la contraseña."));
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell empresa={empresa} title="Contraseña actualizada" subtitle="Te estamos redirigiendo para que inicies sesión.">
        <Link href="/login" className={authButton}>Ir al inicio de sesión</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell empresa={empresa} pending={!listo} title="Crear nueva contraseña" subtitle="Ingrese el código recibido y su nueva contraseña.">
      <form onSubmit={handleSubmit} noValidate className="grid gap-3.5">
        <motion.p variants={item} className="rounded-[9px] bg-info-soft px-3 py-2.5 text-[12.5px] text-info">
          Si el correo existe, enviamos un código de 6 caracteres.
        </motion.p>

        <motion.div variants={item}>
          <label htmlFor="email" className={authLabel}>Correo electrónico</label>
          <div className="relative">
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
            <Mail size={17} className={authInputIcon} />
          </div>
        </motion.div>

        <motion.div variants={item}>
          <label htmlFor="code" className={authLabel}>Código de verificación</label>
          <div className="relative">
            <input id="code" required maxLength={6} autoComplete="one-time-code" placeholder="••••••" value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className={`${authInput} font-mono tracking-[0.4em]`} />
            <KeyRound size={17} className={authInputIcon} />
          </div>
        </motion.div>

        <motion.div variants={item}>
          <label htmlFor="password" className={authLabel}>Nueva contraseña</label>
          <div className="relative">
            <input id="password" type={showPassword ? "text" : "password"} required autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
            <button type="button" onClick={() => setShowPassword((s) => !s)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-1/2 right-1 flex size-[34px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted hover:text-ink">
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {regla && <small className="mt-1 block text-[12px] text-muted">{regla}</small>}
        </motion.div>

        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} role="alert" className={authError}>{error}</motion.div>
        )}

        <motion.button variants={item} type="submit" disabled={loading || code.length !== 6 || !password} aria-busy={loading} className={authButton}>
          {loading ? (<><Loader2 size={16} className="animate-spin" />Guardando…</>) : "Guardar contraseña"}
        </motion.button>
        <motion.div variants={item}>
          <Link href="/forgot-password" className={authGhostButton}>Pedir otro código</Link>
        </motion.div>
      </form>
    </AuthShell>
  );
}
