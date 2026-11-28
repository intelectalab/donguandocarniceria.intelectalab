"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge, Select } from "@/modulos/sep/ui";
import { api } from "@/modulos/sep/ui";

export type DocumentoTransferenciaSep = {
  document_id?: string | null;
  full_number: string;
  guide_number: string;
  guide_reason?: string | null;
  issue_date: string;
  customer_name?: string | null;
  customer_ruc?: string | null;
  subtotal: number;
  igv: number;
  total: number;
};

export type ArchivoExportacionSep = {
  code: string;
  name: string;
  title: string;
  rows: number;
  personal_data: boolean;
  sha256: string;
  csv: string;
};

export type ExportacionSep = {
  export_number: string;
  export_id?: string;
  file_name: string;
  total_rows: number;
  sha256: string;
  size_bytes?: number;
  download_available?: boolean;
  status: string;
  expires_at: string | null;
  approved_by_name: string | null;
  files: ArchivoExportacionSep[];
};

export type SeccionActaSep = {
  item_type: string;
  title: string;
  total: number;
  done: number;
  excluded: number;
  amount_pen: number;
};

export type ActaSep = {
  act_number: string;
  simulation: boolean;
  generated_at: string;
  brand_code: string;
  brand_name: string;
  origin_legal_name: string;
  origin_ruc: string;
  dest_type_name: string;
  dest_legal_name: string | null;
  dest_ruc: string | null;
  cutoff_date: string;
  effective_from: string;
  prepared_by_name: string | null;
  prepared_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_note: string | null;
  stock_value_pen: number;
  receivables_pen: number;
  transfer_docs: DocumentoTransferenciaSep[];
  export_number: string | null;
  export_sha256: string | null;
  file_id?: string;
  file_name?: string;
  size_bytes?: number;
  generated_by_name?: string;
  sections: SeccionActaSep[];
  sha256: string;
};

export type ProyectoSep = {
  id: string;
  number: string;
  brand_id: string;
  brand_code: string;
  brand_name: string;
  brand_color?: string;
  brand_status?: string;
  origin_company_id: string;
  origin_company_name: string;
  origin_ruc: string;
  dest_type: "OTHER_RUC" | "OTHER_TENANT" | "OTHER_SYSTEM";
  dest_type_name: string;
  dest_company_id: string | null;
  dest_tenant_name: string | null;
  dest_system_name: string | null;
  dest_legal_name: string | null;
  dest_ruc: string | null;
  dest_display: string;
  cutoff_date: string;
  effective_from: string;
  simulation: boolean;
  receivables_policy: "KEEP_ORIGIN" | "ASSIGN";
  notes: string | null;
  status: "DRAFT" | "VALIDATED" | "APPROVED" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED";
  status_name: string;
  prepared_by: string | null;
  prepared_by_name: string | null;
  prepared_at: string | null;
  checks_run_at: string | null;
  validated_at: string | null;
  warn_note: string | null;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_note: string | null;
  executed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  period_closed: boolean;
  progress: {
    total: number;
    done: number;
    excluded: number;
    failed: number;
    pending: number;
    pct: number;
  };
  export: ExportacionSep | null;
  act: ActaSep | null;
  transfer_docs: DocumentoTransferenciaSep[];
  history: { at: string; by?: string; by_name?: string; status: string; note?: string }[];
};

export type ChequeoSep = {
  id: string;
  seq: number;
  code: string;
  title: string;
  rule: string;
  result: "PASS" | "WARN" | "FAIL";
  detail: string;
  count: number;
  run_at: string;
  run_by: string;
};

export type ClienteMarcaSep = {
  id: string;
  trade_name: string | null;
  full_name: string;
  doc_type: string | null;
  doc_number: string | null;
  phone: string | null;
  last_order_at: string | null;
  has_consent: boolean;
};

export type ParticipacionAlmacenSep = {
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  establishment_id: string | null;
  establishment_code: string | null;
  establishment_name: string | null;
  brand_value: number;
  other_value: number;
  brand_lots: number;
  share_pct: number;
  dedicated: boolean;
};

export type LocalSep = {
  id: string;
  code: string;
  name: string;
};

export type ItemSep = {
  id: string;
  separation_id: string;
  item_type: string;
  item_type_name: string;
  seq: number;
  status: "PENDING" | "DONE" | "FAILED" | "EXCLUDED";
  attempts: number;
  refs: Record<string, unknown>;
  error: string | null;
  executed_at: string | null;
  result: string | null;
  ref_table: string | null;
  ref_id: string | null;
  label: string;
  qty: number;
  qty_at_cutoff: number | null;
  qty_available: number | null;
  reserved_qty: number;
  received_qty: number | null;
  uom: string;
  unit_cost: number | null;
  total_cost: number | null;
  action: string;
  action_name: string;
  variant_id: string | null;
  variant_sku: string | null;
  variant_name: string | null;
  lot_id: string | null;
  lot_code: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  establishment_id: string | null;
  establishment_code: string | null;
  establishment_name: string | null;
  expiry_date: string | null;
  document_id: string | null;
  guide_number: string | null;
  amount: number | null;
  delivery_date: string | null;
  due_date: string | null;
  kind: string | null;
  platform: string | null;
  source_status: string | null;
  only_brand: boolean | null;
  role: string | null;
  brands_in_scope: string[];
  code: string | null;
  doc_type: string | null;
  applies_to: string | null;
  exclude_reason: string | null;
  note: string | null;
  line: string | null;
  order_status: string | null;
};

export type DetalleSep = {
  separation: ProyectoSep;
  brand: Record<string, unknown> | null;
  origin_company: Record<string, unknown> | null;
  dest_company: Record<string, unknown> | null;
  checks: ChequeoSep[];
  checks_summary: { total: number; pass: number; warn: number; fail: number };
  customers: {
    months: number;
    from: string;
    all: ClienteMarcaSep[];
    with_consent_count: number;
  };
  warehouse_share: ParticipacionAlmacenSep[];
  establishments: LocalSep[];
  items: ItemSep[];
  items_by_type: Record<string, ItemSep[]>;
  progress: ProyectoSep["progress"];
  period_closed: boolean;
  kpis: {
    stock_sent_pen: number;
    stock_received_pen: number;
    stock_diff_pen: number;
    completed_count: number;
    completed_with_act: number;
    act_coverage_pct: number;
  };
  all_separations: {
    id: string;
    number: string;
    status: string;
    dest_type: string;
    cutoff_date: string;
    simulation: boolean;
    brand_code: string;
    brand_name: string;
  }[];
};

const CLAVE_SEP = "sep_active_id";

export function obtenerIdSepActivo(): string | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  return sp.get("id") || window.localStorage.getItem(CLAVE_SEP);
}

export function guardarIdSepActivo(id: string) {
  if (typeof window !== "undefined" && id) {
    window.localStorage.setItem(CLAVE_SEP, id);
  }
}

async function obtenerDetalleSep(id?: string | null): Promise<DetalleSep> {
  const target = id ?? obtenerIdSepActivo();
  const url = target ? `/sep/proyectos/${target}` : "/sep/proyectos/actual";
  const res = await api.get<DetalleSep>(url);
  if (res?.separation?.id) guardarIdSepActivo(res.separation.id);
  return res;
}

export function useProyectoSep(initialId?: string | null) {
  const [data, setData] = useState<DetalleSep | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async (id?: string | null, mostrarCarga = true) => {
    if (mostrarCarga) setLoading(true);
    try {
      setData(await obtenerDetalleSep(id));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    async function cargarInicial() {
      try {
        const res = await obtenerDetalleSep(initialId);
        if (vigente) setData(res);
      } finally {
        if (vigente) setLoading(false);
      }
    }

    void cargarInicial();
    return () => {
      vigente = false;
    };
  }, [initialId]);

  return { data, setData, loading, recargar: cargar, cambiarProyecto: (id: string) => cargar(id) };
}

export const TONO_ESTADO_SEP: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  DRAFT: "warn",
  VALIDATED: "info",
  APPROVED: "info",
  EXECUTING: "warn",
  COMPLETED: "ok",
  FAILED: "bad",
  CANCELLED: "neutral",
};

export const TONO_ITEM_SEP: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "info" }> = {
  PENDING: { label: "Pendiente", tone: "warn" },
  DONE: { label: "Ejecutado", tone: "ok" },
  FAILED: { label: "Con error", tone: "bad" },
  EXCLUDED: { label: "Excluido", tone: "neutral" },
};

const NOMBRE_ESTADO_SEP: Record<string, string> = {
  DRAFT: "Borrador",
  VALIDATED: "Validada",
  APPROVED: "Aprobada",
  EXECUTING: "En ejecución",
  COMPLETED: "Completada",
  FAILED: "Con error",
  CANCELLED: "Cancelada",
};

export function BadgeEstadoSep({ status, label }: { status: string; label?: string }) {
  return <Badge tone={TONO_ESTADO_SEP[status] ?? "neutral"}>{label ?? NOMBRE_ESTADO_SEP[status] ?? "Estado no reconocido"}</Badge>;
}

export function BadgeItemSep({ status }: { status: string }) {
  const cfg = TONO_ITEM_SEP[status] ?? { label: "Estado no reconocido", tone: "neutral" as const };
  return <Badge tone={cfg.tone}>{cfg.label}</Badge>;
}

export function BarraProyectoSep({
  data,
  onSelect,
}: {
  data: DetalleSep | null;
  onSelect: (id: string) => void;
}) {
  if (!data) return null;
  const s = data.separation;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/m/sep/sep-01" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline">
          <ArrowLeft size={14} /> Proyectos
        </Link>
        <span className="text-line">|</span>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-mono font-semibold">{s.number}</span>
          <span>·</span>
          <span className="font-semibold">{s.brand_name} ({s.brand_code})</span>
          <span>→</span>
          <span className="text-muted">{s.dest_display}</span>
          <BadgeEstadoSep status={s.status} label={s.status_name} />
          {s.simulation && <Badge tone="info">Simulación</Badge>}
          <Badge tone={s.period_closed ? "ok" : "warn"}>
            Corte {s.cutoff_date} ({s.period_closed ? "período cerrado" : "período abierto"})
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">Proyecto activo:</span>
        <Select
          value={s.id}
          onChange={(e) => onSelect(e.target.value)}
          className="min-w-[240px]"
        >
          {data.all_separations.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number} · {p.brand_name} ({NOMBRE_ESTADO_SEP[p.status] ?? "Estado no reconocido"}){p.simulation ? " · Simulación" : ""}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

export function soles(n?: number | null): string {
  return "S/ " + Number(n ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function descargarArchivoTexto(nombre: string, contenido: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\uFEFF" + contenido], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
