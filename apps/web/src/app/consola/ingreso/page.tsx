"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Loader2, Smartphone } from "lucide-react";
import AuthShell, { authButton, authError, authInput, authInputIcon, authLabel, item } from "@/components/auth/AuthShell";
import { mensajeDe } from "@/lib/api";
import { apiConsola, setTokenConsola } from "@/lib/consola";

/** OPS-01 Ingreso a la consola: correo, contraseña y código de la app autenticadora (RN-OPS-01). */
function Ingreso() {
  const router = useRouter();
  const vencida = useSearchParams().get("vencida") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [codigo, setCodigo] = useState("");
  const [ver, setVer] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function ingresar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const r = await apiConsola<{ token: string }>("/ingreso", { method: "POST", body: { email, password, codigo } });
      setTokenConsola(r.token);
      router.push("/consola");
    } catch (err) {
      setError(mensajeDe(err, "No se pudo ingresar. Intenta de nuevo."));
      setCodigo("");
      setCargando(false);
    }
  }

  return (
    <AuthShell empresa={null} title="Consola de plataforma" subtitle="Solo para el personal de Intelectalab. Pide el código a tu app autenticadora."
      footer={<>¿Te invitaron y aún no activas tu cuenta? <Link href="/consola/activar" className="font-medium text-primary hover:underline">Activar mi cuenta</Link></>}>
      <form onSubmit={ingresar} noValidate className="grid gap-3.5">
        {vencida && !error && <div role="status" className="rounded-[9px] border border-info/25 bg-info-soft px-3 py-2.5 text-[13px] text-info">Tu sesión de la consola terminó. Vuelve a ingresar.</div>}
        <motion.div variants={item}>
          <label htmlFor="email" className={authLabel}>Correo</label>
          <div className="relative">
            <input id="email" type="email" required autoComplete="username" placeholder="nombre@intelectalab.com"
              value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
            <KeyRound size={17} className={authInputIcon} />
          </div>
        </motion.div>
        <motion.div variants={item}>
          <label htmlFor="password" className={authLabel}>Contraseña</label>
          <div className="relative">
            <input id="password" type={ver ? "text" : "password"} required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
            <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute top-1/2 right-1 flex size-[34px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:text-ink">
              {ver ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </motion.div>
        <motion.div variants={item}>
          <label htmlFor="codigo" className={authLabel}>Código de la app autenticadora</label>
          <div className="relative">
            <input id="codigo" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 dígitos"
              value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} className={`${authInput} font-mono tracking-[.3em]`} />
            <Smartphone size={17} className={authInputIcon} />
          </div>
        </motion.div>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} role="alert" className={authError}>{error}</motion.div>
        )}
        <motion.button variants={item} type="submit" disabled={cargando || codigo.length !== 6} aria-busy={cargando} className={authButton}>
          {cargando ? (<><Loader2 size={16} className="animate-spin" />Ingresando…</>) : "Ingresar a la consola"}
        </motion.button>
      </form>
    </AuthShell>
  );
}

export default function Page() {
  return <Suspense><Ingreso /></Suspense>;
}
