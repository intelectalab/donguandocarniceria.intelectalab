"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Download, Play, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, FiltroSelect, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje } from "@/lib/formato";
import { CabeceraPaso, descargarCsv, EstadoImportacionBadge } from "@/modulos/onb/comun";

type ResumenImp = {
  id: string;
  import_type: string;
  type_label: string;
  file_name: string;
  file_hash: string;
  mode: string;
  allow_partial: boolean;
  status: string;
  file_error: string | null;
  cutover_date: string | null;
  brand_name: string | null;
  warehouse_name: string | null;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  imported_rows: number;
  error_pct: number;
  created_at: string;
};

type FilaImp = {
  id: string;
  row_no: number;
  status: string;
  raw: Record<string, string>;
  errors: { col: string; msg: string; level: string }[];
};

type DetalleImp = {
  import: ResumenImp;
  fields: { key: string; label: string; required: boolean }[];
  rows: FilaImp[];
};

function ContenidoOnb12() {
  const router = useRouter();
  const sp = useSearchParams();
  const impParam = sp.get("imp") || "";

  const [lista, setLista] = useState<ResumenImp[]>([]);
  const [impId, setImpId] = useState(impParam);
  const [detalle, setDetalle] = useState<DetalleImp | null>(null);
  const [filtroEstado, setFiltroEstado] = useState("");
  const [aceptarParcial, setAceptarParcial] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [procesando, setProcesando] = useState(false);

  function cargarLista(preferId?: string) {
    setCargando(true);
    api<{ imports: ResumenImp[] }>("/v1/onb/importaciones")
      .then((r) => {
        setLista(r.imports);
        const target = preferId || impId || r.imports[0]?.id || "";
        if (target) {
          setImpId(target);
          cargarDetalle(target, filtroEstado);
        } else {
          setCargando(false);
        }
      })
      .catch((e) => {
        toast.error(mensajeDe(e));
        setCargando(false);
      });
  }

  function cargarDetalle(id: string, st = "") {
    setCargando(true);
    api<DetalleImp>(`/v1/onb/importaciones/${id}${st ? `?status=${st}` : ""}`)
      .then((r) => {
        setDetalle(r);
        setAceptarParcial(Boolean(r.import.allow_partial));
      })
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

  async function revalidar() {
    if (!detalle) return;
    setProcesando(true);
    try {
      const r = await api<DetalleImp>(`/v1/onb/importaciones/${detalle.import.id}/validar`, { method: "POST" });
      setDetalle(r);
      toast.ok("Validación actualizada.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function cancelar() {
    if (!detalle) return;
    setProcesando(true);
    try {
      const r = await api<DetalleImp>(`/v1/onb/importaciones/${detalle.import.id}/cancelar`, { method: "POST" });
      setDetalle(r);
      toast.ok("Importación cancelada.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  async function ejecutar() {
    if (!detalle) return;
    setProcesando(true);
    try {
      const r = await api<DetalleImp>(`/v1/onb/importaciones/${detalle.import.id}/ejecutar`, {
        method: "POST",
        body: JSON.stringify({ allow_partial: aceptarParcial }),
      });
      toast.ok(`Importación terminada: ${r.import.imported_rows} filas importadas.`);
      router.push(`/m/onb/onb-13?imp=${r.import.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }

  const imp = detalle?.import;
  const colsPreview = (detalle?.fields ?? []).slice(0, 4);

  return (
    <div className="space-y-5">
      <PageHeader
        description="Resultado por fila con errores por columna; descarga del Excel con la columna de errores; aceptar importar solo las filas válidas."
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
              cargarDetalle(e.target.value, filtroEstado);
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

      {!imp && !cargando && (
        <Alert tone="info" title="No hay importaciones">
          Sube primero un archivo CSV en <Link href="/m/onb/onb-11" className="underline">ONB-11</Link>.
        </Alert>
      )}

      {imp && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Cifra titulo="Filas leídas" valor={numero(imp.total_rows)} />
            <Cifra titulo="Válidas" valor={numero(imp.valid_rows)} tono="ok" />
            <Cifra titulo="Con advertencia" valor={numero(imp.warning_rows)} tono={imp.warning_rows > 0 ? "warn" : undefined} />
            <Cifra titulo="Con error" valor={numero(imp.error_rows)} tono={imp.error_rows > 0 ? "bad" : undefined} />
            <Cifra titulo="Filas con error" valor={porcentaje(imp.error_pct, 1)} tono={imp.error_pct > 0 ? "warn" : "ok"} />
          </div>

          {imp.file_error && (
            <Alert tone="bad" title="Error en el archivo">
              {imp.file_error}
            </Alert>
          )}

          <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">Decisión</h2>
            <DetailList
              items={[
                { label: "Archivo", value: `${imp.file_name} · huella ${imp.file_hash.slice(0, 16)}…` },
                { label: "Tipo", value: imp.type_label },
                { label: "Modo", value: imp.mode === "UPSERT" ? "Nuevos y actualizar" : "Solo nuevos" },
                { label: "Estado", value: <EstadoImportacionBadge status={imp.status} /> },
                ...(imp.cutover_date ? [{ label: "Fecha de corte", value: fecha(imp.cutover_date) }] : []),
                ...(imp.warehouse_name ? [{ label: "Almacén", value: imp.warehouse_name }] : []),
              ]}
            />

            {imp.error_rows > 0 && imp.status === "VALIDATED" && (
              <Checkbox
                checked={aceptarParcial}
                onChange={(v) => setAceptarParcial(v)}
                label={`Acepto importar solo las ${numero(imp.valid_rows + imp.warning_rows)} filas válidas; las ${numero(imp.error_rows)} con error quedan fuera.`}
              />
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button variant="secondary" icon={Download} disabled={imp.error_rows === 0} onClick={bajarErrores}>
                Descargar Excel con errores
              </Button>
              {imp.status === "VALIDATED" && (
                <Button icon={Play} loading={procesando} onClick={ejecutar}>
                  Ejecutar importación
                </Button>
              )}
              {["UPLOADED", "VALIDATED", "FAILED_VALIDATION"].includes(imp.status) && (
                <>
                  <Button variant="ghost" icon={RefreshCw} loading={procesando} onClick={revalidar}>
                    Volver a validar
                  </Button>
                  <Button variant="danger" icon={Trash2} loading={procesando} onClick={cancelar}>
                    Cancelar importación
                  </Button>
                </>
              )}
            </div>
          </div>

          <DataTable<FilaImp>
            rows={detalle?.rows ?? []}
            loading={cargando}
            rowKey={(r) => r.id}
            toolbar={
              <FiltroSelect
                etiqueta="Estado de fila"
                value={filtroEstado}
                onChange={(v) => {
                  setFiltroEstado(v);
                  cargarDetalle(imp.id, v);
                }}
                options={[
                  { value: "VALID", label: "Válida" },
                  { value: "WARNING", label: "Advertencia" },
                  { value: "ERROR", label: "Error" },
                  { value: "IMPORTED", label: "Importada" },
                  { value: "SKIPPED", label: "Omitida" },
                ]}
                todos="Todas las filas"
              />
            }
            columns={[
              { key: "row_no", header: "Fila", align: "right", render: (r) => r.row_no },
              {
                key: "status",
                header: "Estado",
                render: (r) => (
                  <Badge
                    tone={
                      r.status === "VALID" || r.status === "IMPORTED"
                        ? "ok"
                        : r.status === "WARNING" || r.status === "SKIPPED"
                        ? "warn"
                        : "bad"
                    }
                  >
                    {r.status === "VALID"
                      ? "Válida"
                      : r.status === "WARNING"
                      ? "Advertencia"
                      : r.status === "ERROR"
                      ? "Error"
                      : r.status === "IMPORTED"
                      ? "Importada"
                      : "Omitida"}
                  </Badge>
                ),
              },
              ...colsPreview.map((c) => ({
                key: c.key,
                header: c.label.split(" (")[0],
                render: (r: FilaImp) => r.raw[c.key] || "—",
              })),
              {
                key: "errors",
                header: "Errores y advertencias",
                render: (r) =>
                  r.errors.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <div className="space-y-1 text-[12px]">
                      {r.errors.map((e, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <Badge tone={e.level === "ERROR" ? "bad" : "warn"}>{e.col || "fila"}</Badge>
                          <span>{e.msg}</span>
                        </div>
                      ))}
                    </div>
                  ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

export default function Onb12ImportarValidacionPage() {
  return (
    <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-surface-2" />}>
      <ContenidoOnb12 />
    </Suspense>
  );
}
