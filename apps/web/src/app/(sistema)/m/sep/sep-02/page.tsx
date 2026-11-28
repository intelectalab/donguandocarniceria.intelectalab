"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import { ProyectoSep, guardarIdSepActivo } from "@/modulos/sep/comun";

type MarcaDestinoSep = {
  id: string;
  code: string;
  name: string;
  status: string;
  company_id: string;
  company_name: string;
  company_ruc: string;
};

type EmpresaDestinoSep = {
  id: string;
  legal_name: string;
  trade_name: string;
  ruc: string;
  status: string;
  ose_status: string;
  ose_provider: string;
};

type VistaPreviaSep = {
  brand_name: string;
  origin_company_name: string | null;
  origin_ruc: string | null;
  destination_name: string | null;
  cutoff_date: string;
  effective_from: string | null;
  month_end: boolean;
  period_status: string | null;
  period_closed: boolean;
  active_separation: string | null;
  destination_coherent: boolean;
  open_orders_count: number;
  orders_in_process_count: number;
  stock_lots_count: number;
  warehouses_count: number;
};

type OpcionesSeparacionSep = {
  brands: MarcaDestinoSep[];
  companies: EmpresaDestinoSep[];
  dest_types: Record<string, string>;
};

type FormularioSeparacionSep = {
  brand_id: string;
  dest_type: string;
  dest_company_id: string;
  new_company_ruc: string;
  new_company_name: string;
  dest_tenant_name: string;
  dest_system_name: string;
  dest_legal_name: string;
  dest_ruc: string;
  cutoff_date: string;
  receivables_policy: "KEEP_ORIGIN" | "ASSIGN";
  simulation: boolean;
  notes: string;
};

function fechaCorteAnterior(): string {
  const hoy = new Date();
  const corte = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return `${corte.getFullYear()}-${String(corte.getMonth() + 1).padStart(2, "0")}-${String(corte.getDate()).padStart(2, "0")}`;
}

function esFinDeMes(fecha: string): boolean {
  if (!fecha) return false;
  const [year, month, day] = fecha.split("-").map(Number);
  return new Date(year, month, 0).getDate() === day;
}

function fechaSiguiente(fecha: string): string {
  if (!fecha) return "—";
  const date = new Date(`${fecha}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Sep02NuevaSeparacion() {
  const router = useRouter();
  const [opciones, setOpciones] = useState<OpcionesSeparacionSep | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<(VistaPreviaSep & { key: string }) | null>(null);
  const [previewError, setPreviewError] = useState<{ key: string; message: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [form, setForm] = useState<FormularioSeparacionSep>({
    brand_id: "",
    dest_type: "OTHER_RUC",
    dest_company_id: "",
    new_company_ruc: "",
    new_company_name: "",
    dest_tenant_name: "",
    dest_system_name: "",
    dest_legal_name: "",
    dest_ruc: "",
    cutoff_date: "",
    receivables_policy: "KEEP_ORIGIN",
    simulation: false,
    notes: "",
  });

  const previewPayload = useMemo(() => ({
    brand_id: form.brand_id,
    dest_type: form.dest_type,
    dest_company_id: form.dest_type === "OTHER_RUC" ? form.dest_company_id || null : null,
    new_company_ruc: form.dest_type === "OTHER_RUC" && !form.dest_company_id ? form.new_company_ruc : null,
    new_company_name: form.dest_type === "OTHER_RUC" && !form.dest_company_id ? form.new_company_name : null,
    dest_tenant_name: form.dest_type === "OTHER_TENANT" ? form.dest_tenant_name : null,
    dest_system_name: form.dest_type === "OTHER_SYSTEM" ? form.dest_system_name : null,
    dest_ruc: form.dest_type === "OTHER_RUC" ? null : form.dest_ruc,
    cutoff_date: form.cutoff_date,
  }), [
    form.brand_id,
    form.cutoff_date,
    form.dest_company_id,
    form.dest_ruc,
    form.dest_system_name,
    form.dest_tenant_name,
    form.dest_type,
    form.new_company_name,
    form.new_company_ruc,
  ]);
  const previewKey = JSON.stringify(previewPayload);

  useEffect(() => {
    let vigente = true;
    api.get<OpcionesSeparacionSep>("/sep/proyectos?per_page=1")
      .then((res) => {
        if (!vigente) return;
        setOpciones(res);
        const marca = res.brands.find((brand) => brand.status !== "SEPARATED") ?? res.brands[0];
        const empresaDestino = res.companies.find((company) => company.id !== marca?.company_id);
        setForm((actual) => ({
          ...actual,
          brand_id: actual.brand_id || marca?.id || "",
          dest_company_id: actual.dest_company_id || empresaDestino?.id || "",
          cutoff_date: actual.cutoff_date || fechaCorteAnterior(),
        }));
      })
      .catch((error) => {
        if (vigente) toast.error(error instanceof ApiError ? error.message : "No se pudieron cargar las opciones.");
      })
      .finally(() => {
        if (vigente) setLoading(false);
      });
    return () => {
      vigente = false;
    };
  }, []);

  useEffect(() => {
    if (!previewPayload.brand_id || !previewPayload.cutoff_date) return;
    let vigente = true;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true);
      api.post<VistaPreviaSep>("/sep/preview", previewPayload)
        .then((res) => {
          if (!vigente) return;
          setPreview({ ...res, key: previewKey });
          setPreviewError(null);
        })
        .catch((error) => {
          if (vigente) {
            setPreviewError({
              key: previewKey,
              message: error instanceof ApiError ? error.message : "No se pudo actualizar el resumen.",
            });
          }
        })
        .finally(() => {
          if (vigente) setPreviewLoading(false);
        });
    }, 250);
    return () => {
      vigente = false;
      window.clearTimeout(timer);
    };
  }, [previewKey, previewPayload]);

  const marca = opciones?.brands.find((item) => item.id === form.brand_id);
  const origen = opciones?.companies.find((item) => item.id === marca?.company_id);
  const destino = opciones?.companies.find((item) => item.id === form.dest_company_id);
  const vistaPrevia = preview?.key === previewKey ? preview : null;
  const errorVistaPrevia = previewError?.key === previewKey ? previewError.message : null;
  const destinoTexto = form.dest_type === "OTHER_RUC"
    ? destino?.legal_name || form.new_company_name || "Selecciona una empresa o registra una nueva"
    : form.dest_type === "OTHER_TENANT"
      ? form.dest_tenant_name || "Indica la empresa en la plataforma"
      : form.dest_system_name || "Indica el sistema externo";
  const corteValido = esFinDeMes(form.cutoff_date);
  const destinoValido = form.dest_type === "OTHER_RUC"
    ? Boolean(
      (form.dest_company_id && form.dest_company_id !== marca?.company_id)
      || (!form.dest_company_id
        && !form.simulation
        && /^\d{11}$/.test(form.new_company_ruc)
        && form.new_company_name.trim().length >= 3
        && form.new_company_name.trim().length <= 80),
    )
    : form.dest_type === "OTHER_TENANT"
      ? form.dest_tenant_name.trim().length >= 3
      : form.dest_system_name.trim().length >= 2;

  function cambiarMarca(brandId: string) {
    const seleccionada = opciones?.brands.find((item) => item.id === brandId);
    const empresaDestino = opciones?.companies.find((company) => company.id !== seleccionada?.company_id);
    setForm((actual) => ({
      ...actual,
      brand_id: brandId,
      dest_company_id: actual.dest_company_id === seleccionada?.company_id ? "" : actual.dest_company_id || empresaDestino?.id || "",
      new_company_ruc: "",
      new_company_name: "",
    }));
  }

  function cambiarDestino(destType: string) {
    setForm((actual) => ({
      ...actual,
      dest_type: destType,
      dest_company_id: destType === "OTHER_RUC" ? actual.dest_company_id : "",
      new_company_ruc: destType === "OTHER_RUC" ? actual.new_company_ruc : "",
      new_company_name: destType === "OTHER_RUC" ? actual.new_company_name : "",
      dest_tenant_name: destType === "OTHER_TENANT" ? actual.dest_tenant_name : "",
      dest_system_name: destType === "OTHER_SYSTEM" ? actual.dest_system_name : "",
      dest_legal_name: destType === "OTHER_RUC" ? "" : actual.dest_legal_name,
      dest_ruc: destType === "OTHER_RUC" ? "" : actual.dest_ruc,
    }));
  }

  async function crearProyecto() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        dest_company_id: form.dest_type === "OTHER_RUC" ? form.dest_company_id : null,
        new_company_ruc: form.dest_type === "OTHER_RUC" && !form.dest_company_id ? form.new_company_ruc : null,
        new_company_name: form.dest_type === "OTHER_RUC" && !form.dest_company_id ? form.new_company_name : null,
        dest_tenant_name: form.dest_type === "OTHER_TENANT" ? form.dest_tenant_name : null,
        dest_system_name: form.dest_type === "OTHER_SYSTEM" ? form.dest_system_name : null,
        dest_legal_name: form.dest_type === "OTHER_RUC" ? null : form.dest_legal_name || null,
        dest_ruc: form.dest_type === "OTHER_RUC" ? null : form.dest_ruc || null,
      };
      const res = await api.post<{ separation: ProyectoSep }>("/sep/proyectos", payload);
      guardarIdSepActivo(res.separation.id);
      toast.ok(`Proyecto ${res.separation.number} creado.`);
      router.push(`/m/sep/sep-03?id=${res.separation.id}`);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "No se pudo crear el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        description="Elige la marca, el destino y la fecha de corte. La separación conserva el historial y prepara las decisiones para validar antes de ejecutar."
        actions={
          <Link
            href="/m/sep/sep-01"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] font-medium hover:bg-surface-alt"
          >
            <ArrowLeft size={14} /> Volver a separaciones
          </Link>
        }
      />

      <Alert tone="info" title="Fecha de corte">
        Debe ser el último día de un mes. Para aprobar una separación real, el período contable correspondiente también debe estar cerrado.
      </Alert>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <Card>
          <CardHeader title="Datos de la nueva separación" subtitle="Completa el destino y las condiciones del corte" />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Marca">
                <Select value={form.brand_id} disabled={loading} onChange={(event) => cambiarMarca(event.target.value)}>
                  <option value="">Selecciona una marca</option>
                  {(opciones?.brands ?? []).filter((item) => item.status !== "SEPARATED").map((item) => (
                    <option key={item.id} value={item.id}>{item.name} · {item.company_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Destino">
                <Select value={form.dest_type} onChange={(event) => cambiarDestino(event.target.value)}>
                  {Object.entries(opciones?.dest_types ?? {}).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Select>
              </Field>

              {form.dest_type === "OTHER_RUC" && (
                <>
                  <Field label="Empresa destino existente">
                    <Select
                      value={form.dest_company_id}
                      onChange={(event) => setForm({
                        ...form,
                        dest_company_id: event.target.value,
                        new_company_ruc: "",
                        new_company_name: "",
                      })}
                    >
                      <option value="">Selecciona una razón social existente</option>
                      {(opciones?.companies ?? []).filter((company) => company.id !== marca?.company_id).map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.legal_name} · RUC {company.ruc}{company.status === "PREPARING" ? " · En preparación" : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="O crea la empresa destino · RUC">
                    <Input
                      inputMode="numeric"
                      maxLength={11}
                      value={form.new_company_ruc}
                      onChange={(event) => setForm({
                        ...form,
                        dest_company_id: "",
                        new_company_ruc: event.target.value.replace(/\D/g, ""),
                      })}
                      placeholder="RUC de 11 dígitos"
                    />
                  </Field>
                  <Field label="Razón social de la nueva empresa">
                    <Input
                      maxLength={80}
                      value={form.new_company_name}
                      onChange={(event) => setForm({
                        ...form,
                        dest_company_id: "",
                        new_company_name: event.target.value,
                      })}
                      placeholder="Razón social"
                    />
                  </Field>
                  <p className="sm:col-span-2 -mt-2 text-[12px] text-muted">
                    Al completar estos datos se registrará la empresa en preparación y se usará como destino.
                  </p>
                </>
              )}
              {form.dest_type === "OTHER_TENANT" && (
                <Field label="Empresa en la plataforma">
                  <Input
                    value={form.dest_tenant_name}
                    onChange={(event) => setForm({ ...form, dest_tenant_name: event.target.value })}
                    placeholder="Nombre de la empresa receptora"
                  />
                </Field>
              )}
              {form.dest_type === "OTHER_SYSTEM" && (
                <Field label="Sistema externo">
                  <Input
                    value={form.dest_system_name}
                    onChange={(event) => setForm({ ...form, dest_system_name: event.target.value })}
                    placeholder="Nombre del sistema externo"
                  />
                </Field>
              )}
              {form.dest_type !== "OTHER_RUC" && (
                <>
                  <Field label="Razón social receptora">
                    <Input
                      value={form.dest_legal_name}
                      onChange={(event) => setForm({ ...form, dest_legal_name: event.target.value })}
                      placeholder="Razón social del destino"
                    />
                  </Field>
                  <Field label="RUC receptor (opcional)">
                    <Input
                      value={form.dest_ruc}
                      onChange={(event) => setForm({ ...form, dest_ruc: event.target.value })}
                      placeholder="RUC de 11 dígitos"
                    />
                  </Field>
                </>
              )}

              <Field label="Fecha de corte (último día del mes)">
                <Input
                  type="date"
                  value={form.cutoff_date}
                  onChange={(event) => setForm({ ...form, cutoff_date: event.target.value })}
                />
              </Field>
              <Field label="Cuentas por cobrar anteriores al corte">
                <Select
                  value={form.receivables_policy}
                  onChange={(event) => setForm({ ...form, receivables_policy: event.target.value as FormularioSeparacionSep["receivables_policy"] })}
                >
                  <option value="KEEP_ORIGIN">Cobrar en la empresa origen</option>
                  <option value="ASSIGN">Ceder la cobranza a la empresa destino</option>
                </Select>
              </Field>
            </div>
            <Checkbox
              checked={form.simulation}
              onChange={(checked) => setForm({ ...form, simulation: checked })}
              label="Simulación: revisar el alcance sin modificar datos operativos"
            />
            <Field label="Notas">
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Motivo o información relevante para la separación"
              />
            </Field>
            {form.cutoff_date && !corteValido && (
              <p className="text-[13px] text-bad">La fecha elegida no corresponde al último día del mes.</p>
            )}
            {form.dest_type === "OTHER_RUC" && form.dest_company_id && !destinoValido && (
              <p className="text-[13px] text-bad">La empresa destino debe ser distinta de la empresa actual de la marca.</p>
            )}
            {form.dest_type === "OTHER_RUC" && form.simulation && !form.dest_company_id && (form.new_company_ruc || form.new_company_name) && (
              <p className="text-[13px] text-bad">Desactiva la simulación para registrar una empresa destino.</p>
            )}
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={crearProyecto}
                disabled={loading || saving || !form.brand_id || !destinoValido || !corteValido}
              >
                <CheckCircle2 size={14} /> {saving ? "Creando…" : "Crear separación"}
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Resumen" subtitle="Vista previa del destino y la vigencia" />
          <CardBody className="space-y-3 text-[13px]">
            <div>
              <div className="text-muted">Marca</div>
              <div className="font-medium">{marca?.name || "Selecciona una marca"}</div>
            </div>
            <div>
              <div className="text-muted">Empresa de origen</div>
              <div className="font-medium">{origen?.legal_name || marca?.company_name || "—"}</div>
              {origen?.ruc && <div className="font-mono text-[12px] text-muted">RUC {origen.ruc}</div>}
            </div>
            <div>
              <div className="text-muted">Destino</div>
              <div className="font-medium">{destinoTexto}</div>
              {(destino?.ruc || form.new_company_ruc) && (
                <div className="font-mono text-[12px] text-muted">RUC {destino?.ruc || form.new_company_ruc}</div>
              )}
            </div>
            <div>
              <div className="text-muted">Hasta la fecha de corte</div>
              <div className="font-medium">{form.cutoff_date || "—"}</div>
            </div>
            <div>
              <div className="text-muted">Vigencia en destino desde</div>
              <div className="font-medium">{vistaPrevia?.effective_from || (corteValido ? fechaSiguiente(form.cutoff_date) : "—")}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-line pt-3">
              <div>
                <div className="text-muted">Cierre de mes</div>
                <div className="font-medium">{vistaPrevia ? (vistaPrevia.month_end ? "Correcto" : "Revisar fecha") : "—"}</div>
              </div>
              <div>
                <div className="text-muted">Período contable</div>
                <div className="font-medium">
                  {vistaPrevia
                    ? (vistaPrevia.period_closed ? "Cerrado" : vistaPrevia.period_status === "OPEN" ? "Abierto" : "En revisión")
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted">Separación vigente</div>
                <div className="font-medium">{vistaPrevia ? vistaPrevia.active_separation || "No hay" : "—"}</div>
              </div>
              <div>
                <div className="text-muted">Coherencia del destino</div>
                <div className="font-medium">
                  {vistaPrevia ? (vistaPrevia.destination_coherent ? "Correcta" : "Revisar datos") : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted">Pedidos abiertos</div>
                <div className="font-medium">{vistaPrevia?.open_orders_count ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted">En preparación o reparto</div>
                <div className="font-medium">{vistaPrevia?.orders_in_process_count ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted">Lotes con stock</div>
                <div className="font-medium">{vistaPrevia?.stock_lots_count ?? "—"}</div>
              </div>
              <div>
                <div className="text-muted">Almacenes con stock</div>
                <div className="font-medium">{vistaPrevia?.warehouses_count ?? "—"}</div>
              </div>
            </div>
            {previewLoading && <p className="text-[12px] text-muted">Actualizando resumen…</p>}
            {errorVistaPrevia && <p className="text-[12px] text-bad">{errorVistaPrevia}</p>}
            {form.simulation && <div className="rounded-lg bg-primary-soft px-3 py-2 font-medium text-primary">Simulación sin cambios operativos</div>}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
