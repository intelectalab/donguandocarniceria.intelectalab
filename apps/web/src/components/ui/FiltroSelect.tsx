"use client";

type Opcion = { value: string; label: string };

type Props = {
  etiqueta: string;
  value: string;
  onChange: (v: string) => void;
  options: Opcion[];
  ancho?: number;
  todos?: string;
};

export function FiltroSelect({ etiqueta, value, onChange, options, ancho, todos }: Props) {
  return (
    <label className="flex flex-col gap-0.5" style={ancho ? { width: ancho } : undefined}>
      <span className="text-xs font-medium text-muted-foreground leading-none">{etiqueta}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {todos !== undefined && <option value="">{todos}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
