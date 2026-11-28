"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Badge, Button, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { CabeceraPaso, descargarCsv } from "@/modulos/onb/comun";

type CampoDef = { key: string; label: string; required: boolean };
type TipoDef = {
  code: string;
  label: string;
  step: string | null;
  perm: string;
  needs: string[];
  fields: CampoDef[];
};

type CatalogoImp = {
  types: TipoDef[];
  max_rows: number;
  brands: { id: string; code: string; name: string }[];
  warehouses: { id: string; code: string; name: string }[];
  companies: { id: string; legal_name: string; ruc: string }[];
  planned_go_live: string;
  default_cutover: string;
};

function parsePreviewCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/)[0] || "";
  const sep = [";", "\t", ","]
    .map((s) => [s, first.split(s).length] as const)
    .sort((a, b) => b[1] - a[1])[0][0];
  return clean
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
}

function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export default function Onb11ImportarSubirPage() {
  const router = useRouter();
  const [cat, setCat] = useState<CatalogoImp | null>(null);
  const [type, setType] = useState("PRODUCTS");
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [mode, setMode] = useState("INSERT_ONLY");
  const [brandId, setBrandId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [cutoverDate, setCutoverDate] = useState("");
  const [cargandoEjemplo, setCargandoEjemplo] = useState(false);
  const [validando, setValidando] = useState(false);

  useEffect(() => {
    api<CatalogoImp>("/v1/onb/importaciones")
      .then((r) => {
        setCat(r);
        if (r.brands[0]) setBrandId(r.brands[0].id);
        if (r.warehouses[0]) setWarehouseId(r.warehouses[0].id);
        if (r.companies[0]) setCompanyId(r.companies[0].id);
        setCutoverDate(r.default_cutover);
      })
      .catch((e) => toast.error(mensajeDe(e)));
  }, []);

  const def = cat?.types.find((t) => t.code === type) ?? cat?.types[0];
  const parsed = file ? parsePreviewCsv(file.content) : [];
  const headers = parsed[0] ?? [];
  const sampleRow = parsed[1] ?? [];

  function autoMapearArchivo(tCode: string, content: string) {
    const tDef = cat?.types.find((t) => t.code === tCode);
    if (!tDef) return;
    const rows = parsePreviewCsv(content);
    const hdrs = rows[0] ?? [];
    const hn = hdrs.map(normKey);
    const nextMap: Record<string, string> = {};
    for (const f of tDef.fields) {
      let i = hn.indexOf(f.key);
      if (i < 0) i = hn.indexOf(normKey(f.label));
      if (i < 0) i = hn.findIndex((x) => x.startsWith(f.key) || (x.length > 3 && f.key.startsWith(x)));
      if (i >= 0) nextMap[f.key] = String(i);
    }
    setMap(nextMap);
  }

  async function bajarPlantilla() {
    try {
      const r = await api<{ file_name: string; csv: string }>(`/v1/onb/importaciones/plantilla/${type}`);
      descargarCsv(r.file_name, r.csv);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function usarArchivoEjemplo() {
    setCargandoEjemplo(true);
    try {
      const r = await api<{ file_name: string; csv: string }>(`/v1/onb/importaciones/ejemplo/${type}`, {
        method: "POST",
        body: JSON.stringify({ brand_id: brandId, cutover: cutoverDate }),
      });
      setFile({ name: r.file_name, content: r.csv });
      autoMapearArchivo(type, r.csv);
      toast.ok("Archivo de ejemplo cargado.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCargandoEjemplo(false);
    }
  }

  function alSubirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || "");
      setFile({ name: f.name, content });
      autoMapearArchivo(type, content);
    };
    reader.readAsText(f);
  }

  async function validarArchivo(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setValidando(true);
    try {
      const numMap: Record<string, number> = {};
      for (const [k, v] of Object.entries(map)) {
        if (v !== "") numMap[k] = Number(v);
      }
      const r = await api<{ import: { id: string; valid_rows: number; warning_rows: number; error_rows: number } }>(
        "/v1/onb/importaciones",
        {
          method: "POST",
          body: JSON.stringify({
            type,
            content: file.content,
            file_name: file.name,
            mode,
            brand_id: def?.needs.includes("brand") ? brandId : null,
            warehouse_id: def?.needs.includes("warehouse") ? warehouseId : null,
            company_id: def?.needs.includes("company") ? companyId : null,
            cutover_date: def?.needs.includes("cutover") ? cutoverDate : null,
            map: numMap,
          }),
        }
      );
      toast.ok(
        `Validación completada: ${r.import.valid_rows} válidas, ${r.import.warning_rows} con advertencia, ${r.import.error_rows} con error.`
      );
      router.push(`/m/onb/onb-12?imp=${r.import.id}`);
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setValidando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Descarga la plantilla del tipo, sube el archivo (CSV guardado desde Excel), asocia columnas y elige el modo y los datos de corte." />
      <CabeceraPaso />

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">1. Tipo de importación y archivo</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-[12px] font-medium text-muted">Tipo de datos a importar</label>
            <Select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setFile(null);
                setMap({});
              }}
            >
              {cat?.types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="secondary" icon={Download} onClick={bajarPlantilla}>
            Descargar plantilla de Excel
          </Button>
          <Button variant="ghost" icon={FileSpreadsheet} loading={cargandoEjemplo} onClick={usarArchivoEjemplo}>
            Usar archivo de ejemplo
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium hover:bg-surface">
            <Upload size={15} />
            <span>Elegir archivo CSV…</span>
            <input type="file" accept=".csv,.txt,.tsv" onChange={alSubirArchivo} className="hidden" />
          </label>
          {file ? (
            <Badge tone="info">
              {file.name} · {numero(Math.max(0, parsed.length - 1))} filas
            </Badge>
          ) : (
            <span className="text-[13px] text-muted">Ningún archivo cargado</span>
          )}
        </div>

        {def && (
          <p className="text-[12.5px] text-muted">
            Columnas: {def.fields.map((f) => f.key + (f.required ? "*" : "")).join(", ")}. Máximo {numero(cat?.max_rows ?? 20000)} filas por archivo. El mismo archivo no se importa dos veces.
          </p>
        )}
      </div>

      {file && def && (
        <form onSubmit={validarArchivo} className="space-y-5">
          <div className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">2. Asociar columnas</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[12px] text-muted">
                    <th className="py-2 pr-4">Campo del sistema</th>
                    <th className="py-2 pr-4">Columna del archivo</th>
                    <th className="py-2">Ejemplo (fila 2)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {def.fields.map((f) => {
                    const colIdx = map[f.key] ?? "";
                    const ej = colIdx !== "" && sampleRow[Number(colIdx)] !== undefined ? sampleRow[Number(colIdx)] : "—";
                    return (
                      <tr key={f.key}>
                        <td className="py-2 pr-4 font-medium">
                          {f.label} {f.required && <span className="text-bad">*</span>}
                        </td>
                        <td className="py-2 pr-4">
                          <Select
                            value={colIdx}
                            onChange={(e) => setMap((prev) => ({ ...prev, [f.key]: e.target.value }))}
                            className="max-w-xs"
                          >
                            <option value="">— sin asociar —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={String(i)}>
                                {h}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-2 font-mono text-[12px] text-muted">{ej}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">3. Modo y datos de corte</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Modo de importación">
                <Select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="INSERT_ONLY">Solo nuevos</option>
                  <option value="UPSERT">Nuevos y actualizar existentes</option>
                </Select>
              </Field>
              {def.needs.includes("brand") && (
                <Field label="Marca" required>
                  <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
                    {cat?.brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {def.needs.includes("warehouse") && (
                <Field label="Almacén por defecto" required>
                  <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                    {cat?.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {def.needs.includes("company") && (
                <Field label="Empresa" required>
                  <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)} required>
                    {cat?.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.legal_name} · {c.ruc}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {def.needs.includes("cutover") && (
                <Field label="Fecha de corte" required hint={`Anterior al primer día de operación (${cat?.planned_go_live}).`}>
                  <Input type="date" value={cutoverDate} onChange={(e) => setCutoverDate(e.target.value)} required />
                </Field>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" icon={CheckCircle2} loading={validando}>
                Validar archivo
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
