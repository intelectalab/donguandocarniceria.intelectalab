"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Badge, Input, type Tone } from "@/components/ui";
import { moduloPorCodigo } from "@/lib/modulos";

export { useDatos } from "@/modulos/mae/tipos";

export type Conector = {
  id: string; code: string; name: string; kind: string; kind_name: string; provider: string; adapter_name: string; fake: boolean; environment: "PRODUCTION" | "SANDBOX";
  owner_module: string | null; module_on: boolean; brand_id: string | null; brand_name: string | null; establishment_id: string | null; establishment_name: string | null;
  status: string; status_name: string; status_reason: string | null; consecutive_failures: number; last_ok_at: string | null; last_error_at: string | null;
  last_error: string | null; latency_ms: number | null; simulate_down: boolean; credenciales?: number;
};
export type Credencial = {
  id: string; connector_id: string; connector_name: string | null; name: string; version: number; value: string; expires_at: string | null;
  dias_para_vencer: number | null; status: string; status_name: string; created_by: string; created_at: string; revoked_at: string | null; revoked_reason: string | null;
};

export const TONO_CONECTOR: Record<string, Tone> = { ACTIVE: "ok", ERROR: "bad", DISABLED: "neutral", PENDING: "warn" };
export const ESTADOS_CREDENCIAL: Record<string, [string, Tone]> = { ACTIVE: ["Vigente", "ok"], REVOKED: ["Revocada", "neutral"] };

export function EstadoConector({ c }: { c: Pick<Conector, "status" | "status_name"> }) {
  return <Badge tone={TONO_CONECTOR[c.status] ?? "neutral"} dot>{c.status_name}</Badge>;
}

export function Entorno({ e }: { e: Conector["environment"] }) {
  return e === "SANDBOX" ? <Badge tone="info">Prueba</Badge> : <Badge>Producción</Badge>;
}

/** Nombre corto del módulo dueño (nunca su código). */
export const nombreModulo = (code: string | null) => (code ? moduloPorCodigo(code)?.name ?? code : "Empresa");

/** «phone_number_id» → «Phone number id»: las claves de la configuración, legibles. */
export const claveLegible = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");

/** Vence en N días, en palabras. */
export const venceEn = (d: number | null) => (d === null ? "" : d < 0 ? `venció hace ${-d} ${-d === 1 ? "día" : "días"}` : d === 0 ? "vence hoy" : `en ${d} ${d === 1 ? "día" : "días"}`);

/** Campo de secreto con el botón para mostrarlo u ocultarlo. */
export function CampoSecreto({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      {/* new-password: el navegador no debe ofrecer la contraseña guardada del sistema; es un secreto del proveedor. */}
      <Input id={id} type={ver ? "text" : "password"} autoComplete="new-password" data-1p-ignore data-lpignore="true" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? "Ocultar el secreto" : "Mostrar el secreto"} title={ver ? "Ocultar" : "Mostrar"}
        className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted hover:text-ink">
        {ver ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
