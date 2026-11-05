"use client";

import { createContext, useContext, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";

type Ctx = { id: string; invalid: boolean; describedBy?: string; required?: boolean };
const FieldContext = createContext<Ctx | null>(null);

const CONTROL =
  "w-full min-h-[40px] rounded-[9px] border bg-surface px-3 py-2 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted/70 focus:border-primary focus:shadow-[0_0_0_3px_var(--primary-soft)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted";

function useControl(id?: string) {
  const ctx = useContext(FieldContext);
  return {
    id: id ?? ctx?.id,
    "aria-invalid": ctx?.invalid || undefined,
    "aria-describedby": ctx?.describedBy,
    required: ctx?.required,
    border: ctx?.invalid ? "border-bad" : "border-line",
  };
}

type FieldProps = {
  label: string;
  /** Mensaje de error del campo (p. ej. erroresDe(err).ruc). */
  error?: string;
  /** Ayuda bajo el campo: formato esperado, regla, unidad… */
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * Etiqueta, ayuda y error de un campo. El control de adentro (Input, Select, Textarea) se enlaza solo.
 *   <Field label="RUC" required error={errores.ruc} hint="11 dígitos">
 *     <Input value={ruc} onChange={(e) => setRuc(e.target.value)} inputMode="numeric" maxLength={11} />
 *   </Field>
 */
export function Field({ label, error, hint, required, className = "", children }: FieldProps) {
  const id = useId();
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id, invalid: Boolean(error), describedBy, required }}>
      <div className={`grid content-start gap-1.5 ${className}`}>
        <label htmlFor={id} className="text-[12.5px] font-medium text-muted">
          {label}{required && <span className="text-bad" aria-hidden="true"> *</span>}
        </label>
        {children}
        {hint && !error && <small id={`${id}-hint`} className="text-[12px] text-muted">{hint}</small>}
        {error && <small id={`${id}-error`} role="alert" className="text-[12px] text-bad">{error}</small>}
      </div>
    </FieldContext.Provider>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Texto fijo a la izquierda o derecha: «S/», «kg», «%». */
  prefix?: string;
  suffix?: string;
};

export function Input({ id, className = "", prefix, suffix, ...rest }: InputProps) {
  const { border, ...a11y } = useControl(id);
  const input = <input {...a11y} {...rest}
    className={`${CONTROL} ${border} ${prefix ? "pl-9" : ""} ${suffix ? "pr-10" : ""} ${className}`} />;
  if (!prefix && !suffix) return input;
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-muted">{prefix}</span>}
      {input}
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-muted">{suffix}</span>}
    </div>
  );
}

export function Textarea({ id, className = "", rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { border, ...a11y } = useControl(id);
  return <textarea rows={rows} {...a11y} {...rest} className={`${CONTROL} ${border} resize-y ${className}`} />;
}

type Opcion = { value: string; label: string; disabled?: boolean };

/**
 *   <Select value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Elige un tipo"
 *     options={[{ value: "STORE", label: "Tienda" }, …]} />
 */
export function Select({ id, className = "", options, placeholder, children, ...rest }:
  SelectHTMLAttributes<HTMLSelectElement> & { options?: Opcion[]; placeholder?: string }) {
  const { border, ...a11y } = useControl(id);
  return (
    <div className="relative">
      <select {...a11y} {...rest} className={`${CONTROL} ${border} cursor-pointer appearance-none pr-9 ${className}`}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        {children}
      </select>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </div>
  );
}

/** Casilla con su texto al lado. */
export function Checkbox({ checked, onChange, label, disabled, hint }:
  { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  return (
    <label className={`flex items-start gap-2.5 text-[13.5px] ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary ${checked ? "border-primary bg-primary" : "border-line bg-surface"}`}>
        {checked && <Check size={12} strokeWidth={3} className="text-primary-ink" />}
      </span>
      <span>
        <span className="text-ink">{label}</span>
        {hint && <small className="block text-[12px] text-muted">{hint}</small>}
      </span>
    </label>
  );
}

/** Interruptor encendido / apagado (activo, publicado, módulo encendido…). */
export function Switch({ checked, onChange, label, disabled }:
  { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-primary" : "bg-line"}`}>
      <span className={`inline-block size-5 rounded-full bg-surface shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}
