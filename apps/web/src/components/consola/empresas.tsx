import type { Tone } from "@/components/ui";

/** Una empresa en la lista de la consola (OPS-02). */
export type Empresa = {
  id: string; name: string; short: string; ruc: string | null; tenant_status: string;
  business_type: string | null; business_type_name: string | null; created_at: string;
  plan_code: string | null; plan_name: string | null;
  subscription_status: string | null; subscription_status_name: string; days_in_status: number | null; trial_ends_at: string | null;
  mrr: number; uso: Uso[]; modulos: number; last_login: string | null; tickets_abiertos: number; accesos_vigentes: number;
};
export type Uso = { clave: string; nombre: string; usado: number; limite: number | null; pct: number | null };

/** Estados de la suscripción (RN-SUS-04) con su color. Sin suscripción: piloto o interna. */
export const ESTADOS_SUSCRIPCION: Record<string, [string, Tone]> = {
  TRIAL: ["En prueba", "info"], ACTIVE: ["Activa", "ok"], PAST_DUE: ["Con deuda", "warn"], READ_ONLY: ["Solo lectura", "warn"],
  SUSPENDED: ["Suspendida", "bad"], CANCELLED: ["Cancelada", "neutral"],
};

/** Barra de uso de un límite del plan: verde, ámbar desde 80 % y rojo al llegar al límite. Sin límite, solo el número. */
export function BarraUso({ uso }: { uso: Uso }) {
  if (uso.limite === null) return <span className="text-[12.5px] text-muted">{uso.usado} · sin límite</span>;
  const pct = Math.min(100, uso.pct ?? 0);
  const color = pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-warn" : "bg-ok";
  return (
    <div className="grid min-w-[90px] gap-1">
      <span className="text-[12.5px] text-ink tabular-nums">{uso.usado} de {uso.limite}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={uso.limite} aria-valuenow={uso.usado} aria-label={uso.nombre}>
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
