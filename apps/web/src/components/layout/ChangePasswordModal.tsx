"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, EyeOff, Loader2, X } from "lucide-react";
import { ApiError, api } from "@/lib/api";

const FIELD =
  "w-full min-h-[40px] rounded-[9px] border border-line bg-surface px-3 py-2 pr-10 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)]";

/** Se monta solo mientras está abierto, así el formulario arranca siempre vacío. */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [regla, setRegla] = useState("");

  useEffect(() => {
    api<{ rule: string }>("/v1/auth/password-rule").then((r) => setRegla(r.rule)).catch(() => undefined);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      // La API valida la política de la empresa (largo, mayúsculas, minúsculas, número e historial).
      await api("/v1/me/password", { method: "POST", body: { current_password: current, password } });
      setDone(true);
    } catch (err) {
      const first = err instanceof ApiError && err.errors ? Object.values(err.errors)[0]?.[0] : undefined;
      setError(first || (err instanceof Error ? err.message : "No se pudo actualizar la contraseña."));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[var(--overlay)] p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="change-password-title"
        className="w-full max-w-[420px] rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="change-password-title" className="text-[16px] font-semibold text-ink">Cambiar contraseña</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar"
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2">
            <X size={17} />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 text-center">
            <CheckCircle2 size={32} className="mx-auto text-ok" />
            <p className="mt-3 text-[14px] font-medium text-ink">Contraseña actualizada</p>
            <p className="mt-1 text-[12.5px] text-muted">Úsala la próxima vez que inicies sesión. Se cerraron tus sesiones en otros equipos.</p>
            <button type="button" onClick={onClose}
              className="mt-5 h-10 cursor-pointer rounded-[9px] bg-primary px-5 text-[13.5px] font-semibold text-primary-ink hover:brightness-110">
              Entendido
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="grid gap-3.5 px-5 py-5">
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">Contraseña actual</span>
              <input type={show ? "text" : "password"} required autoFocus autoComplete="current-password"
                value={current} onChange={(e) => setCurrent(e.target.value)} className={FIELD} />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[12.5px] font-medium text-muted">Nueva contraseña</span>
              <span className="relative block">
                <input type={show ? "text" : "password"} required autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseñas" : "Mostrar contraseñas"}
                  className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {regla && <small className="text-[12px] text-muted">{regla}</small>}
            </label>

            {error && <p role="alert" className="rounded-[9px] border border-bad/25 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">{error}</p>}

            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={onClose}
                className="h-10 cursor-pointer rounded-[9px] border border-line px-4 text-[13.5px] font-medium text-ink hover:bg-surface-2">
                Cancelar
              </button>
              <button type="submit" disabled={saving || !current || !password}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-[9px] bg-primary px-4 text-[13.5px] font-semibold text-primary-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
                {saving && <Loader2 size={15} className="animate-spin" />}
                Actualizar contraseña
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
