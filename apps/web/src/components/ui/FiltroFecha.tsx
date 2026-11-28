"use client";

type Props = {
  etiqueta: string;
  value: string;
  onChange: (v: string | null) => void;
  tipo?: "date" | "month";
  ancho?: number;
};

export function FiltroFecha({ etiqueta, value, onChange, tipo = "date", ancho }: Props) {
  return (
    <label className="flex flex-col gap-0.5" style={ancho ? { width: ancho } : undefined}>
      <span className="text-xs font-medium text-muted-foreground leading-none">{etiqueta}</span>
      <input
        type={tipo}
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}
