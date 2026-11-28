"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, FiltroSelect, Modal, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Plantilla = {
  id: string;
  code: string;
  version: number;
  name: string;
  description: string;
  status: string;
};

type ItemPlantilla = {
  id: string;
  seq: number;
  item_type: string;
  item_type_name: string;
  item_code: string;
  name: string;
  requires_module: string | null;
  requires_module_name: string | null;
  module_enabled: boolean;
  payload: Record<string, any>;
};

type Aplicacion = {
  id: string;
  template_code: string;
  template_name: string;
  template_version: number;
  brand_id: string;
  brand_name: string;
  status: string;
  items_created: number;
  items_skipped: number;
  items_failed: number;
  applied_at: string;
  applied_by: string | null;
  detail: { item_type: string; item_type_name: string; item_code: string; name: string; result: string; reason?: string }[];
};

type RespuestaPlantillas = {
  templates: Plantilla[];
  selected: Plantilla | null;
  items: ItemPlantilla[];
  brands: { id: string; code: string; name: string }[];
  applications: Aplicacion[];
  step: PasoAlta | null;
};

export default function Onb10PlantillaRubroPage() {
  const [datos, setDatos] = useState<RespuestaPlantillas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tplCode, setTplCode] = useState("");
  const [brandId, setBrandId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [detalleApp, setDetalleApp] = useState<Aplicacion | null>(null);

  function cargar(code?: string) {
    setCargando(true);
    api<RespuestaPlantillas>(`/v1/onb/plantillas${code ? `?code=${code}` : ""}`)
      .then((r) => {
        setDatos(r);
        if (r.selected) setTplCode(r.selected.code);
        if (!brandId && r.brands[0]) setBrandId(r.brands[0].id);
      })
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function aplicar() {
    if (!brandId) {
      toast.error("Registra primero una marca (ONB-04).");
      return;
    }
    setAplicando(true);
    try {
      const app = await api<Aplicacion>("/v1/onb/plantillas/aplicar", {
        method: "POST",
        body: JSON.stringify({ template_code: tplCode, brand_id: brandId }),
      });
      toast.ok(`Plantilla aplicada: ${app.items_created} creados, ${app.items_skipped} omitidos, ${app.items_failed} fallidos.`);
      cargar(tplCode);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setAplicando(false);
    }
  }

  const porTipo = (datos?.items ?? []).reduce<Record<string, ItemPlantilla[]>>((acc, it) => {
    (acc[it.item_type] ??= []).push(it);
    return acc;
  }, {});

  const itemsFiltrados = (datos?.items ?? []).filter((it) => !filtroTipo || it.item_type === filtroTipo);

  return (
    <div className="space-y-5">
      <PageHeader description="Vista previa de lo que crea la plantilla por tipo y módulo requerido; se aplica una vez por marca y es idempotente." />
      <CabeceraPaso step={datos?.step} />

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-[12px] font-medium text-muted">Plantilla publicada</label>
            <Select
              value={tplCode}
              onChange={(e) => {
                setTplCode(e.target.value);
                cargar(e.target.value);
              }}
            >
              {datos?.templates.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.name} · v{t.version}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[200px]">
            <label className="mb-1 block text-[12px] font-medium text-muted">Marca destino</label>
            <Select value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {datos?.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </div>
          <Button icon={Sparkles} loading={aplicando} disabled={!datos?.brands.length} onClick={aplicar}>
            Aplicar a la marca
          </Button>
        </div>

        {datos?.selected && <p className="text-[13px] text-muted">{datos.selected.description}</p>}
        <Alert tone="info" title="Valores de referencia">
          Los rendimientos de despiece y las fórmulas se crean como borrador de ejemplo para ajustarlos con las pesadas propias de la empresa.
        </Alert>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(porTipo).map(([t, arr]) => (
          <Cifra
            key={t}
            titulo={arr[0].item_type_name}
            valor={String(arr.length)}
            detalle={
              arr[0].requires_module
                ? `Requiere ${arr[0].requires_module}${arr[0].module_enabled ? "" : " (apagado: se omitirá)"}`
                : "Núcleo"
            }
            tono={arr[0].requires_module && !arr[0].module_enabled ? "warn" : undefined}
          />
        ))}
      </div>

      <DataTable<ItemPlantilla>
        rows={itemsFiltrados}
        loading={cargando}
        rowKey={(r) => r.id}
        toolbar={
          <FiltroSelect
            etiqueta="Tipo"
            value={filtroTipo}
            onChange={setFiltroTipo}
            options={Object.entries(porTipo).map(([t, arr]) => ({ value: t, label: arr[0].item_type_name }))}
            todos="Todos los tipos"
          />
        }
        columns={[
          { key: "seq", header: "#", align: "right", render: (r) => r.seq },
          { key: "item_type_name", header: "Tipo", render: (r) => r.item_type_name },
          { key: "item_code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.item_code}</span> },
          { key: "name", header: "Qué crea", render: (r) => r.name },
          {
            key: "requires_module",
            header: "Módulo",
            render: (r) =>
              r.requires_module ? (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[12px]">{r.requires_module}</span>
                  <Badge tone={r.module_enabled ? "ok" : "warn"}>{r.module_enabled ? "Encendido" : "Apagado"}</Badge>
                </div>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            key: "detalle",
            header: "Detalle",
            render: (r) => {
              const p = r.payload;
              if (r.item_type === "PRODUCT") {
                return `${p.mode === "UNIT" ? "Por unidad" : p.mode === "KG" ? "Por kg" : "Peso variable"} · ${soles(p.price)}${p.mode === "UNIT" ? "" : "/kg"}`;
              }
              if (r.item_type === "KPI_TARGET") return `Meta ${p.target}`;
              if (r.item_type === "BREAKDOWN" && Array.isArray(p.lines)) {
                return p.lines.map((l: any) => `${l[0]} ${l[1]} %`).join(", ");
              }
              if (r.item_type === "CHECKLIST" && Array.isArray(p.items)) return `${p.items.length} puntos`;
              return "";
            },
          },
        ]}
      />

      <div className="space-y-3">
        <h2 className="text-[15px] font-semibold">Aplicaciones realizadas</h2>
        <DataTable<Aplicacion>
          rows={datos?.applications ?? []}
          loading={cargando}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDetalleApp(r)}
          empty="La plantilla aún no se aplicó a ninguna marca."
          columns={[
            { key: "applied_at", header: "Fecha", render: (r) => fechaHora(r.applied_at) },
            { key: "template_name", header: "Plantilla", render: (r) => r.template_name || r.template_code },
            { key: "brand_name", header: "Marca", render: (r) => r.brand_name },
            { key: "items_created", header: "Creados", align: "right", render: (r) => r.items_created },
            { key: "items_skipped", header: "Omitidos", align: "right", render: (r) => r.items_skipped },
            { key: "items_failed", header: "Fallidos", align: "right", render: (r) => r.items_failed },
            {
              key: "status",
              header: "Estado",
              render: (r) => (
                <Badge tone={r.status === "APPLIED" ? "ok" : r.status === "PARTIAL" ? "warn" : "bad"}>
                  {r.status === "APPLIED" ? "Aplicada" : r.status === "PARTIAL" ? "Parcial" : "Fallida"}
                </Badge>
              ),
            },
          ]}
        />
      </div>

      <Modal open={Boolean(detalleApp)} onClose={() => setDetalleApp(null)} title="Resultado de la plantilla" size="lg">
        {detalleApp && (
          <div className="space-y-4">
            <DetailList
              items={[
                { label: "Plantilla", value: `${detalleApp.template_name || detalleApp.template_code} v${detalleApp.template_version}` },
                { label: "Marca", value: detalleApp.brand_name },
                { label: "Aplicada", value: `${fechaHora(detalleApp.applied_at)} · ${detalleApp.applied_by || ""}` },
                {
                  label: "Resultado",
                  value: `${detalleApp.items_created} creados · ${detalleApp.items_skipped} omitidos · ${detalleApp.items_failed} fallidos`,
                },
              ]}
            />
            <DataTable
              rows={detalleApp.detail ?? []}
              rowKey={(r) => `${r.item_type}-${r.item_code}`}
              columns={[
                { key: "item_type_name", header: "Tipo", render: (r) => r.item_type_name || r.item_type },
                { key: "item_code", header: "Código", render: (r) => <span className="font-mono">{r.item_code}</span> },
                { key: "name", header: "Nombre", render: (r) => r.name },
                {
                  key: "result",
                  header: "Resultado",
                  render: (r) => (
                    <Badge tone={r.result === "CREATED" ? "ok" : r.result === "SKIPPED" ? "warn" : "bad"}>
                      {r.result === "CREATED" ? "Creado" : r.result === "SKIPPED" ? "Omitido" : "Fallido"}
                    </Badge>
                  ),
                },
                { key: "reason", header: "Motivo", render: (r) => r.reason || "—" },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
