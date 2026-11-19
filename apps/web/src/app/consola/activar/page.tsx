"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CheckCircle2, Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import qrcode from "qrcode-generator";
import AuthShell, { authButton, authError, authInput, authLabel, item } from "@/components/auth/AuthShell";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";

type Preparada = { secreto: string; enlace: string; nombre: string };

/** Contraseña con el botón del ojo para mostrarla u ocultarla, como en el ingreso. */
function CampoClave({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={ver ? "text" : "password"} required autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} className={authInput} />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute top-1/2 right-1 flex size-[34px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:text-ink">
        {ver ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

/** Código QR como trazos SVG (sin imágenes externas: el secreto no sale del navegador). */
function Qr({ texto }: { texto: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    const m = q.getModuleCount();
    let ruta = "";
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (q.isDark(y, x)) ruta += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d: ruta, n: m + 4 };
  }, [texto]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label="Código QR para la app autenticadora" className="size-48 rounded-lg bg-white p-1" shapeRendering="crispEdges">
      <path d={d} fill="#1b1b1b" />
    </svg>
  );
}

/**
 * Activación de una cuenta de la consola (parte de OPS-01 y OPS-12): con el código de la invitación crea su
 * contraseña y configura la app autenticadora. Sin segundo factor la cuenta no se activa (RN-OPS-01).
 */
export default function ActivarCuenta() {
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [totp, setTotp] = useState("");
  const [preparada, setPreparada] = useState<Preparada | null>(null);
  const [lista, setLista] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  async function preparar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirmar) return setError("Las dos contraseñas no coinciden.");
    setCargando(true);
    try {
      setPreparada(await apiConsola<Preparada>("/activar/preparar", { method: "POST", body: { email, codigo, password, password_confirmation: confirmar } }));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando(false);
    }
  }

  async function activar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      await apiConsola("/activar", { method: "POST", body: { email, codigo, password, password_confirmation: confirmar, totp } });
      setLista(true);
    } catch (err) {
      setError(mensajeDe(err));
      setTotp("");
    } finally {
      setCargando(false);
    }
  }

  if (lista) {
    return (
      <AuthShell empresa={null} title="Cuenta activa" subtitle="Ya puedes ingresar a la consola con tu correo, tu contraseña y el código de tu app.">
        <div className="grid gap-4">
          <div className="flex items-center gap-2.5 rounded-[9px] border border-ok/25 bg-ok-soft px-3 py-3 text-[13.5px] text-ok">
            <CheckCircle2 size={18} /> Contraseña y segundo factor configurados.
          </div>
          <Link href="/consola/ingreso" className={authButton}>Ir al ingreso de la consola</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell empresa={null} title="Activar mi cuenta de la consola"
      subtitle={preparada ? "Escanea el código con tu app autenticadora y escribe el número que muestra." : "Usa el código que te llegó por correo y crea tu contraseña."}
      footer={<>¿Ya activaste tu cuenta? <Link href="/consola/ingreso" className="font-medium text-primary hover:underline">Ingresar</Link></>}>
      {!preparada ? (
        <form onSubmit={preparar} noValidate className="grid gap-3.5">
          <motion.div variants={item}>
            <label htmlFor="email" className={authLabel}>Correo</label>
            <input id="email" type="email" required autoComplete="username" placeholder="nombre@intelectalab.com" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
          </motion.div>
          <motion.div variants={item}>
            <label htmlFor="codigo" className={authLabel}>Código de la invitación</label>
            <input id="codigo" required autoComplete="off" maxLength={12} placeholder="8 caracteres" value={codigo}
              onChange={(e) => setCodigo(e.target.value.toUpperCase())} className={`${authInput} font-mono tracking-[.2em]`} />
          </motion.div>
          <motion.div variants={item}>
            <label htmlFor="password" className={authLabel}>Contraseña nueva</label>
            <CampoClave id="password" value={password} onChange={setPassword} />
            <p className="mt-1 text-[12px] text-muted">12 caracteres o más, con mayúsculas, minúsculas y un número, sin tu correo ni tu nombre.</p>
          </motion.div>
          <motion.div variants={item}>
            <label htmlFor="confirmar" className={authLabel}>Repite la contraseña</label>
            <CampoClave id="confirmar" value={confirmar} onChange={setConfirmar} />
          </motion.div>
          {error && <div role="alert" className={authError}>{error}</div>}
          <motion.button variants={item} type="submit" disabled={cargando || !email || !codigo || !password} aria-busy={cargando} className={authButton}>
            {cargando ? (<><Loader2 size={16} className="animate-spin" />Revisando…</>) : "Continuar"}
          </motion.button>
        </form>
      ) : (
        <form onSubmit={activar} noValidate className="grid gap-3.5">
          <div className="grid justify-items-center gap-2.5">
            <Qr texto={preparada.enlace} />
            <p className="text-center text-[12.5px] text-muted">
              ¿No puedes escanear? Escribe esta clave en la app:
            </p>
            <button type="button" onClick={() => navigator.clipboard?.writeText(preparada.secreto)}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-mono text-[12px] break-all text-ink hover:bg-line/40" title="Copiar clave">
              {preparada.secreto.match(/.{1,4}/g)?.join(" ")} <Copy size={13} className="shrink-0 text-muted" />
            </button>
          </div>
          <div>
            <label htmlFor="totp" className={authLabel}>Código que muestra la app</label>
            <input id="totp" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 dígitos" value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} className={`${authInput} font-mono tracking-[.3em]`} />
          </div>
          {error && <div role="alert" className={authError}>{error}</div>}
          <button type="submit" disabled={cargando || totp.length !== 6} aria-busy={cargando} className={authButton}>
            {cargando ? (<><Loader2 size={16} className="animate-spin" />Activando…</>) : "Activar mi cuenta"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
