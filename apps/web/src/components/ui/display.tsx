import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "info" | "primary";

const BADGE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  primary: "bg-primary-soft text-primary",
};

/** Etiqueta corta de color: <Badge tone="ok">Activo</Badge> */
export function Badge({ tone = "neutral", dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap ${BADGE[tone]}`}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

// Estados que se repiten en la base. Un módulo con estados propios pasa `labels`.
const ESTADOS: Record<string, [string, Tone]> = {
  ACTIVE: ["Activo", "ok"],
  INACTIVE: ["Inactivo", "neutral"],
  DRAFT: ["Borrador", "neutral"],
  PENDING: ["Pendiente", "warn"],
  APPROVED: ["Aprobado", "ok"],
  REJECTED: ["Rechazado", "bad"],
  CANCELLED: ["Anulado", "bad"],
  OPEN: ["Abierto", "ok"],
  CLOSING: ["En cierre", "warn"],
  CLOSED: ["Cerrado", "neutral"],
  LOCKED: ["Bloqueado", "bad"],
  BLOCKED: ["Bloqueado", "bad"],
  SUSPENDED: ["Suspendido", "warn"],
  ERROR: ["Con error", "bad"],
  SEPARATED: ["Separada", "info"],
};

/** <StatusBadge status={empresa.status} />, o con estados propios: labels={{ RELEASED: ["Liberado", "ok"] }} */
export function StatusBadge({ status, labels }: { status: string | null | undefined; labels?: Record<string, [string, Tone]> }) {
  if (!status) return <span className="text-muted">—</span>;
  const [texto, tono] = labels?.[status] ?? ESTADOS[status] ?? [status, "neutral" as Tone];
  return <Badge tone={tono} dot>{texto}</Badge>;
}

const ALERT: Record<Exclude<Tone, "neutral" | "primary">, { clase: string; Icono: LucideIcon }> = {
  ok: { clase: "border-ok/30 bg-ok-soft", Icono: CheckCircle2 },
  warn: { clase: "border-warn/30 bg-warn-soft", Icono: AlertTriangle },
  bad: { clase: "border-bad/30 bg-bad-soft", Icono: XCircle },
  info: { clase: "border-info/30 bg-info-soft", Icono: Info },
};
const ICON_TONE = { ok: "text-ok", warn: "text-warn", bad: "text-bad", info: "text-info" };

/** Mensaje en la pantalla: un error al guardar, una regla que aplica, un aviso del período. */
export function Alert({ tone = "info", title, children }: { tone?: keyof typeof ALERT; title?: string; children?: ReactNode }) {
  const { clase, Icono } = ALERT[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`flex gap-2.5 rounded-[9px] border px-3.5 py-3 text-[13.5px] ${clase}`}>
      <Icono size={17} className={`mt-px shrink-0 ${ICON_TONE[tone]}`} aria-hidden="true" />
      <div className="min-w-0 text-ink">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Inicio de una pantalla, bajo la cabecera (que ya muestra el título): su código, qué hace y
 * sus botones principales.
 *   <PageHeader code="PLT-03" description="Razón social, RUC…" actions={<Button …>Nueva empresa</Button>} />
 */
export function PageHeader({ code, description, actions }: { code?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 max-w-[70ch]">
        {code && <p className="font-mono text-[11.5px] text-accent">{code}</p>}
        {description && <p className="text-[13.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Pestañas controladas: <Tabs value={tab} onChange={setTab} tabs={[{ key: "datos", label: "Datos" }, …]} /> */
export function Tabs<K extends string>({ tabs, value, onChange }:
  { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => {
        const activa = t.key === value;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={activa} onClick={() => onChange(t.key)}
            className={`-mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium whitespace-nowrap transition-colors ${activa ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-surface-2 px-1.5 text-[11.5px] text-muted">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Lista de dato: valor, para fichas de solo lectura. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-[12px] text-muted">{it.label}</dt>
          <dd className="text-[13.5px] break-words text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
