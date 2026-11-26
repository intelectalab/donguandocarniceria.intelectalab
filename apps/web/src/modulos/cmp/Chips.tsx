"use client";

/** Varias opciones como botones que se marcan y desmarcan. */
export function Chips({ opciones, valor, onChange, etiqueta }: { opciones: { value: string; label: string }[]; valor: string[]; onChange: (v: string[]) => void; etiqueta: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={etiqueta}>
      {opciones.map((o) => {
        const on = valor.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? valor.filter((x) => x !== o.value) : [...valor, o.value])}
            className={`min-h-8 cursor-pointer rounded-full border px-3 text-[12.5px] font-medium ${on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-muted hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
