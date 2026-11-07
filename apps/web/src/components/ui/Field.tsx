"use client";

import {
  createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ChangeEvent, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";

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

/** Desde cuántas opciones el desplegable trae buscador. */
const CON_BUSCADOR = 10;

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  options?: Opcion[];
  placeholder?: string;
  /** Buscador dentro del desplegable. Por defecto, solo con más de 10 opciones. */
  searchable?: boolean;
};

/**
 *   <Select value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Elige un tipo"
 *     options={[{ value: "STORE", label: "Tienda" }, …]} />
 * Con más de 10 opciones muestra un buscador (sin distinguir mayúsculas ni tildes). onChange se
 * usa igual: e.target.value trae el valor elegido.
 */
export function Select({ id, className = "", options, placeholder, children, searchable, ...rest }: SelectProps) {
  const { border, ...a11y } = useControl(id);
  if (options && !children && (searchable ?? options.length > CON_BUSCADOR)) {
    return <SelectConBuscador {...a11y} border={border} className={className} options={options} placeholder={placeholder}
      value={String(rest.value ?? "")} disabled={rest.disabled} onChange={rest.onChange} ariaLabel={rest["aria-label"]} />;
  }
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

const sinTildes = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Desplegable con buscador. La lista se dibuja en el body (para que un modal no la recorte) y se
 * abre hacia arriba si abajo no hay espacio. Teclado: flechas, Enter, Escape; escribir abre y busca.
 */
function SelectConBuscador({ id, border, className, options, placeholder, value, disabled, onChange, ariaLabel, ...a11y }: {
  id?: string; border: string; className: string; options: Opcion[]; placeholder?: string; value: string; disabled?: boolean;
  onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"]; ariaLabel?: string;
  "aria-invalid"?: boolean; "aria-describedby"?: string; required?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [activo, setActivo] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; alto: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const listaId = useId();

  const todas: Opcion[] = placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options;
  const q = sinTildes(texto.trim());
  const visibles = q ? todas.filter((o) => o.value !== "" && sinTildes(o.label).includes(q)) : todas;
  const elegida = todas.find((o) => o.value === value);

  function abrir(inicial = "") {
    if (disabled) return;
    setTexto(inicial);
    const i = todas.findIndex((o) => o.value === value);
    setActivo(inicial ? 0 : Math.max(i, 0));
    setAbierto(true);
  }
  function cerrar(volverFoco = true) {
    setAbierto(false);
    if (volverFoco) boton.current?.focus();
  }
  function elegir(o: Opcion) {
    if (o.disabled) return;
    // Mismo uso que un <select>: onChange(e) con e.target.value.
    onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>);
    cerrar();
  }

  // Ubicación de la lista junto al botón; se recalcula al hacer scroll o cambiar el tamaño.
  useLayoutEffect(() => {
    if (!abierto) return;
    const ubicar = () => {
      const r = boton.current?.getBoundingClientRect();
      if (!r) return;
      const abajo = window.innerHeight - r.bottom - 8;
      const arriba = r.top - 8;
      const haciaArriba = abajo < 260 && arriba > abajo;
      const alto = Math.min(320, Math.max(haciaArriba ? arriba : abajo, 160));
      const width = Math.max(r.width, 220);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos(haciaArriba ? { left, width, bottom: window.innerHeight - r.top + 4, alto } : { left, width, top: r.bottom + 4, alto });
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => { window.removeEventListener("resize", ubicar); window.removeEventListener("scroll", ubicar, true); };
  }, [abierto]);

  // Clic fuera del botón y de la lista: se cierra sin elegir.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boton.current?.contains(t) && !lista.current?.contains(t)) cerrar(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  // La opción activa queda a la vista al moverse con las flechas.
  useEffect(() => {
    if (abierto) lista.current?.querySelector(`[data-i="${activo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activo, abierto]);

  function teclaBoton(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); abrir(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); abrir(e.key); }
  }
  function teclaBuscar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => Math.min(i + 1, visibles.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const o = visibles[activo]; if (o) elegir(o); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrar(); } // no cierra el modal de afuera
    else if (e.key === "Tab") cerrar(false);
  }

  return (
    <>
      <button ref={boton} id={id} type="button" disabled={disabled} onClick={() => (abierto ? cerrar() : abrir())} onKeyDown={teclaBoton}
        role="combobox" aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? listaId : undefined} aria-label={ariaLabel}
        aria-invalid={a11y["aria-invalid"]} aria-describedby={a11y["aria-describedby"]} aria-required={a11y.required}
        className={`${CONTROL} ${border} relative flex cursor-pointer items-center pr-9 text-left disabled:cursor-not-allowed ${className}`}>
        <span className={`min-w-0 flex-1 truncate ${elegida && elegida.value !== "" ? "" : "text-muted"}`}>{elegida?.label ?? placeholder ?? "Elegir…"}</span>
        <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
      </button>
      {abierto && pos && createPortal(
        <div ref={lista} style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.alto }}
          className="fixed z-[350] flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_20px_50px_rgba(40,8,18,0.28)]">
          <div className="relative border-b border-line p-2">
            <Search size={14} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-muted" />
            <input autoFocus value={texto} onChange={(e) => { setTexto(e.target.value); setActivo(0); }} onKeyDown={teclaBuscar}
              type="search" aria-controls={listaId} aria-activedescendant={visibles[activo] ? `${listaId}-${activo}` : undefined}
              aria-label="Buscar en la lista" placeholder="Buscar…"
              className="h-8 w-full rounded-lg border border-line bg-bg pr-2 pl-8 text-[13px] text-ink outline-none focus:border-primary" />
          </div>
          <ul id={listaId} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
            {visibles.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Ninguna coincide.</li>}
            {visibles.map((o, i) => (
              <li key={o.value || "_vacio"} id={`${listaId}-${i}`} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(o)} onMouseMove={() => setActivo(i)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] ${i === activo ? "bg-surface-2" : ""} ${o.disabled ? "cursor-not-allowed opacity-50" : ""} ${o.value === "" ? "text-muted" : "text-ink"}`}>
                <span className="min-w-0 flex-1 truncate" title={o.label}>{o.label}</span>
                {o.value === value && <Check size={14} aria-hidden="true" className="shrink-0 text-primary" />}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
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
