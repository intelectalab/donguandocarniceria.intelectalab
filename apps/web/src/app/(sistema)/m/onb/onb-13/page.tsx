"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CheckCircle2, Download, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, Modal, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { CabeceraPaso, descargarCsv } from "@/modulos/onb/comun";

type LoteEjecucion = {
  n: number;
  rows: number;
  imported: number;
  skipped: number;
  failed: number;
  status: string;
  error?: string | null;
};

type ResumenImp = {
  id: string;
  import_type: string;
  type_label: string;
  file_name: string;
  status: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_rows: number;
  batches: LoteEjecucion[];
  started_at: string | null;
  finished_at: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  revert_reason: string | null;
  created_at: string;
};

type DetalleImp = {
  import: ResumenImp;
  stock_summary: {
    total_lots: number;
    quarantine_lots: number;
    released_lots: number;
    inventory_value: number;
  } | null;
};

function ContenidoOnb13() {
  const sp = useSearchParams();
  const impParam = sp.get("imp") || "";

  const [lista, setLista] = useState<ResumenImp[]>([]);
  const [impId, setImpId] = useState(impParam);
  const [detalle, setDetalle] = useState<DetalleImp | null>(null);
  const [cargando, setCargando] = useState(true);
  const [liberando, setLiberando] = useState(false);

  const [modalRevertir, setModalRevertir] = useState(false);
  const [motivoReversion, setMotivoReversion] = useState("");
  const [revirtiendo, setRevirtiendo] = useState(false);

  function cargarLista(preferId?: string) {
    setCargando(true);
    api<{ imports: ResumenImp[] }>("/v1/onb/importaciones")
      .then((r) => {
        setLista(r.imports);
        const target = preferId || impId || r.imports[0]?.id || "";
        if (target) {
          setImpId(target);
          cargarDetalle(target);
        } else {
          setCargando(false);
        }
      })
      .catch((e) => {
        toast.error(mensajeDe(e));
        setCargando(false);
      });
  }

  function cargarDetalle(id: string) {
    setCargando(true);
    api<DetalleImp>(`/v1/onb/importaciones/${id}`)
      .then(setDetalle)
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargarLista(impParam);
  }, [impParam]);

  async function bajarErrores() {
    if (!detalle) return;
    try {
      const r = await api<{ file_name: string; csv: string }>(`/v1/onb/importaciones/${detalle.import.id}/errores`);
      descargarCsv(r.file_name, r.csv);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function liberarStock() {
    if (!detalle) return;
    setLiberando(true);
    try {
      const r = await api<DetalleImp & { released_lots: number }>(`/v1/onb/importaciones/${detalle.import.id}/liberar-stock`, {
        method: "POST",
      });
      setDetalle(r);
      toast.ok(`${r.released_lots} lotes liberados por Calidad.`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setLiberando(false);
    }
  }

  async function revertir(e: React.FormEvent) {
    e.preventDefault();
    if (!detalle) return;
    setRevirtiendo(true);
    try {
      const r = await api<DetalleImp>(`/v1/onb/importaciones/${detalle.import.id}/revertir`, {
        method: "POST",
        body: JSON.stringify({ reason: motivoReversion }),
      });
      setDetalle(r);
      setModalRevertir(false);
      setMotivoReversion("");
      toast.ok("Importación revertida: puedes volver a subir el archivo.");
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setRevirtiendo(false);
    }
  }

  const imp = detalle?.import;
  const tot = Math.max(1, imp?.total_rows ?? 1);
  const pct = imp ? Math.round(((imp.imported_rows + (imp.skipped_rows || 0)) / tot) * 100) : 0;
  const stStock = detalle?.stock_summary;

  return (
    <div className="space-y-5">
      <PageHeader
        description="Avance por lotes de 500 filas en transacción: importadas, omitidas y fallidas, liberación del stock inicial y reversión."
        actions={
          <Link
            href="/m/onb/onb-11"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-2"
          >
            Nueva importación (ONB-11)
          </Link>
        }
      />
      <CabeceraPaso />

      {lista.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <label className="text-[13px] font-medium text-muted">Importación:</label>
          <Select
            value={impId}
            onChange={(e) => {
              setImpId(e.target.value);
              cargarDetalle(e.target.value);
            }}
            className="max-w-xl flex-1"
          >
            {lista.map((i) => (
              <option key={i.id} value={i.id}>
                {fechaHora(i.created_at)} · {i.type_label} · {i.file_name} ({i.status})
              </option>
            ))}
          </Select>
        </div>
      )}

      {imp && !["COMPLETED", "CANCELLED", "IMPORTING"].includes(imp.status) && (
        <Alert tone="warn" title="Importación aún sin ejecutar">
          La importación está en estado {imp.status}: revísala y ejecútala en{" "}
          <Link href={`/m/onb/onb-12?imp=${imp.id}`} className="font-semibold underline">
            ONB-12 Validación
          </Link>
          .
        </Alert>
      )}

      {imp && ["COMPLETED", "CANCELLED", "IMPORTING"].includes(imp.status) && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cifra titulo="Importadas" valor={numero(imp.imported_rows)} tono="ok" />
            <Cifra
              titulo="Omitidas (duplicados)"
              valor={numero(imp.skipped_rows || 0)}
              tono={imp.skipped_rows > 0 ? "warn" : undefined}
            />
            <Cifra titulo="Fallidas" valor={numero(imp.error_rows)} tono={imp.error_rows > 0 ? "bad" : undefined} />
            <Cifra titulo="Lotes procesados" valor={String(imp.batches?.length ?? 0)} detalle="de 500 filas" />
          </div>

          <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="mt-1.5 text-[12.5px] text-muted">
              {porcentaje(pct, 0)} de las filas procesadas · {fechaHora(imp.started_at)} → {fechaHora(imp.finished_at)}
            </div>
          </div>

          {imp.status === "CANCELLED" && (
            <Alert tone="warn" title="Importación revertida o cancelada">
              {imp.reverted_at ? `Revertida el ${fechaHora(imp.reverted_at)} por ${imp.reverted_by || ""}: ` : "Cancelada: "}
              {imp.revert_reason || "—"}
            </Alert>
          )}

          {stStock && (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
              <div className="grid gap-3 sm:grid-cols-2">
                <Cifra
                  titulo="Valor del inventario inicial"
                  valor={soles(stStock.inventory_value)}
                  detalle="Σ cantidad × costo unitario del archivo"
                />
                <Cifra
                  titulo="Lotes en cuarentena"
                  valor={`${stStock.quarantine_lots} de ${stStock.total_lots}`}
                  detalle="Esperando liberación de Calidad"
                  tono={stStock.quarantine_lots > 0 ? "warn" : "ok"}
                />
              </div>
              {stStock.quarantine_lots > 0 && imp.status === "COMPLETED" && (
                <div>
                  <Button icon={CheckCircle2} loading={liberando} onClick={liberarStock}>
                    Liberar {stStock.quarantine_lots} lotes (Calidad)
                  </Button>
                </div>
              )}
            </div>
          )}

          <DataTable<LoteEjecucion>
            rows={imp.batches ?? []}
            rowKey={(r) => String(r.n)}
            empty="Sin lotes registrados."
            columns={[
              { key: "n", header: "Lote", align: "right", render: (r) => r.n },
              { key: "rows", header: "Filas", align: "right", render: (r) => numero(r.rows) },
              { key: "imported", header: "Importadas", align: "right", render: (r) => numero(r.imported) },
              { key: "skipped", header: "Omitidas", align: "right", render: (r) => numero(r.skipped) },
              { key: "failed", header: "Fallidas", align: "right", render: (r) => numero(r.failed) },
              {
                key: "status",
                header: "Resultado",
                render: (r) => (
                  <Badge tone={r.status === "OK" ? "ok" : "bad"}>{r.status === "OK" ? "Confirmado" : "Revertido"}</Badge>
                ),
              },
              { key: "error", header: "Detalle", render: (r) => r.error || "—" },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={Download} disabled={imp.error_rows === 0} onClick={bajarErrores}>
              Descargar Excel con errores
            </Button>
            {imp.status === "COMPLETED" && (
              <Button variant="danger" icon={RotateCcw} onClick={() => setModalRevertir(true)}>
                Revertir importación
              </Button>
            )}
          </div>
        </>
      )}

      <Modal open={modalRevertir} onClose={() => setModalRevertir(false)} title="Revertir importación">
        <form onSubmit={revertir} className="space-y-4">
          <Field label="Motivo de la reversión" required>
            <Textarea
              rows={3}
              value={motivoReversion}
              onChange={(e) => setMotivoReversion(e.target.value)}
              placeholder="Indica por qué se revierte la importación…"
              required
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalRevertir(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" loading={revirtiendo}>
              Revertir
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function Onb13ImportarEjecucionPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-surface-2" />}>
      <ContenidoOnb13 />
    </Suspense>
  );
}
