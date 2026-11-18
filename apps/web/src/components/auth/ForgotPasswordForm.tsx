"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Send } from "lucide-react";
import AuthShell, { authButton, authError, authGhostButton, authInput, authInputIcon, authLabel, item } from "./AuthShell";
import { mensajeDe } from "./LoginForm";
import { api } from "@/lib/api";
import { useEmpresa } from "@/lib/empresa";

export default function ForgotPasswordForm() {
  const router = useRouter();
  const { empresa, listo } = useEmpresa();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/v1/auth/forgot", { method: "POST", body: { email } });
      // Siguiente paso: el código recibido y la nueva contraseña.
      router.push(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(mensajeDe(err, "No se pudo enviar el código."));
      setLoading(false);
    }
  }

  return (
    <AuthShell empresa={empresa} pending={!listo} title="Recuperar contraseña" subtitle="Escribe tu correo y te enviaremos un código para crear una nueva.">
      <form onSubmit={handleSubmit} noValidate className="grid gap-3.5">
        <motion.div variants={item}>
          <label htmlFor="email" className={authLabel}>Correo electrónico</label>
          <div className="relative">
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
            <Send size={17} className={authInputIcon} />
          </div>
        </motion.div>

        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} role="alert" className={authError}>{error}</motion.div>
        )}

        <motion.button variants={item} type="submit" disabled={loading} aria-busy={loading} className={authButton}>
          {loading ? (<><Loader2 size={16} className="animate-spin" />Enviando…</>) : "Enviar código"}
        </motion.button>
        <motion.div variants={item}>
          <Link href="/login" className={authGhostButton}>Volver al inicio de sesión</Link>
        </motion.div>
      </form>
    </AuthShell>
  );
}
