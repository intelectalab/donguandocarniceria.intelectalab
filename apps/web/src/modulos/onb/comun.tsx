"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Clock } from "lucide-react";
import { Alert, Badge } from "@/components/ui";

export type PasoAlta = {
  id: string;
  seq: number;
  step_code: string;
  name: string;
  screen: string;
  url: string;
  is_required: boolean;
  is_fixed_required: boolean;
  status: "PENDING" | "DONE" | "SKIPPED" | "BLOCKED";
  blocked_reason: string | null;
  completed_at: string | null;
  completed_by: string | null;
  owner_role: string;
  owner_role_name: string;
  prerequisites: { code: string; name: string; missing: boolean }[];
  missing_prerequisites: string[];
};

export const ESTADOS_PASO: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "info" }> = {
  DONE: { label: "Hecho", tone: "ok" },
  PENDING: { label: "Pendiente", tone: "warn" },
  SKIPPED: { label: "Omitido", tone: "neutral" },
  BLOCKED: { label: "Bloqueado", tone: "bad" },
};

export const ESTADOS_IMPORTACION: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "info" }> = {
  UPLOADED: { label: "Subida", tone: "info" },
  VALIDATING: { label: "Validando", tone: "info" },
  VALIDATED: { label: "Validada", tone: "ok" },
  FAILED_VALIDATION: { label: "Con errores", tone: "bad" },
  IMPORTING: { label: "Importando", tone: "info" },
  COMPLETED: { label: "Completada", tone: "ok" },
  CANCELLED: { label: "Cancelada", tone: "neutral" },
};

export function EstadoPasoBadge({ status }: { status: string }) {
  const cfg = ESTADOS_PASO[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

export function EstadoImportacionBadge({ status }: { status: string }) {
  const cfg = ESTADOS_IMPORTACION[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

export function CabeceraPaso({ step, secondStep }: { step?: PasoAlta | null; secondStep?: PasoAlta | null }) {
  const faltan = [...(step?.missing_prerequisites ?? []), ...(secondStep?.missing_prerequisites ?? [])].filter(
    (v, i, a) => a.indexOf(v) === i
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-card">
        <Link href="/m/onb/onb-02" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <ArrowLeft size={14} /> Volver a la lista de pasos (ONB-02)
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {step && (
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="text-muted">Paso {step.seq} · {step.name}:</span>
              <EstadoPasoBadge status={step.status} />
              <Badge tone={step.is_required ? "warn" : "neutral"}>
                {step.is_required ? "Obligatorio" : "Opcional"}
              </Badge>
            </div>
          )}
          {secondStep && (
            <div className="flex items-center gap-1.5 text-[13px]">
              <span className="text-muted">Paso {secondStep.seq} · {secondStep.name}:</span>
              <EstadoPasoBadge status={secondStep.status} />
              <Badge tone={secondStep.is_required ? "warn" : "neutral"}>
                {secondStep.is_required ? "Obligatorio" : "Opcional"}
              </Badge>
            </div>
          )}
        </div>
      </div>
      {faltan.length > 0 && (
        <Alert tone="warn" title="Prerrequisitos pendientes">
          Este paso requiere completar antes: <b>{faltan.join(", ")}</b>.
        </Alert>
      )}
    </div>
  );
}

export function IconoPaso({ status }: { status: string }) {
  if (status === "DONE") return <CheckCircle2 size={16} className="shrink-0 text-ok" />;
  if (status === "SKIPPED") return <Circle size={16} className="shrink-0 text-muted" />;
  return <Clock size={16} className="shrink-0 text-warn" />;
}

export function descargarCsv(nombre: string, contenido: string) {
  const blob = new Blob(["\uFEFF" + contenido], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 500);
}
