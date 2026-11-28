"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FiltroFecha } from "@/components/ui";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Cifra,
  DataTable,
  FiltroSelect,
  Modal,
  PageHeader,
  confirmAction,
  type Column,
  toast,
} from "@/modulos/sep/ui";
import { api, ApiError } from "@/modulos/sep/ui";
import {
  BadgeEstadoSep,
  DetalleSep,
  ProyectoSep,
  guardarIdSepActivo,
  soles,
} from "@/modulos/sep/comun";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { usePaginaLocal } from "@/lib/paginas";

type RespuestaHistorial = {
  brands: {
    id: string;
    code: string;
    name: string;
    status: string;
    company_id: string;
    separated_at: string | null;
    separation_id: string | null;
    current_company_name: string;
    current_ruc: string;
  }[];
  history: {
    id: string;
    brand_id: string;
    brand_code: string;
    brand_name: string;
    company_id: string;
    company_name: string;
    ruc: string;
    valid_from: string;
    valid_to: string | null;
    separation_id: string | null;
    separation_number: string | null;
    reason: string | null;
    status: string;
  }[];
  sales_by_company: {
    brand_id: string;
    brand_code: string;
    brand_name: string;
    company_id: string;
    company_name: string;
    ruc: string;
    period: string;
    docs_count: number;
    subtotal_pen: number;
    total_pen: number;
  }[];
  separations: ProyectoSep[];
};

type VentaEmisora = RespuestaHistorial["sales_by_company"][number];
type SeleccionPeriodo = "all" | "3" | "6" | "12" | "year" | "custom";
type RangoPeriodo = { desde: string | null; hasta: string };

const COLORES_GRAFICO = ["#7b2035", "#287a51", "#2563eb", "#d97706", "#7c3aed", "#0891b2"];

function mesConDesfase(desfase: number): string {
  const hoy = new Date();
  const mes = new Date(hoy.getFullYear(), hoy.getMonth() + desfase, 1);
  return `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, "0")}`;
}

function rangoPeriodo(seleccion: SeleccionPeriodo, desde: string, hasta: string): RangoPeriodo {
  const mesActual = mesConDesfase(0);
  if (seleccion === "all") return { desde: null, hasta: mesActual };
  if (seleccion === "custom") return { desde, hasta };
  if (seleccion === "year") return { desde: `${mesActual.slice(0, 4)}-01`, hasta: mesActual };
  return { desde: mesConDesfase(1 - Number(seleccion)), hasta: mesActual };
}

function periodosEntre(desde: string, hasta: string): string[] {
  const [anioInicio, mesInicio] = desde.split("-").map(Number);
  const [anioFin, mesFin] = hasta.split("-").map(Number);
  const periodos: string[] = [];
  let anio = anioInicio;
  let mes = mesInicio;

  while (anio < anioFin || (anio === anioFin && mes <= mesFin)) {
    periodos.push(`${anio}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }

  return periodos;
}

function nombrePeriodo(periodo: string): string {
  const [anio, mes] = periodo.split("-").map(Number);
  return new Date(anio, mes - 1, 1, 12).toLocaleDateString("es-PE", {
    month: "short",
    year: "2-digit",
  }).replace(/\./g, "");
}

function etiquetaRangoPeriodos(desde: string, hasta: string): string {
  const inicio = nombrePeriodo(desde);
  return desde === hasta ? inicio : `${inicio} – ${nombrePeriodo(hasta)}`;
}

function etiquetaEstadoMarca(estado: string): string {
  if (estado === "SEPARATED") return "Separada";
  if (estado === "ACTIVE") return "Activa";
  return "Inactiva";
}

function GraficoVentas({ ventas, periodos }: { ventas: VentaEmisora[]; periodos: string[] }) {
  const empresas = Array.from(new Map(
    ventas.map((venta) => [venta.company_id, venta.company_name] as const),
  ));

  if (!empresas.length) {
    return <p className="py-12 text-center text-[13px] text-muted">Sin ventas de la marca en el período seleccionado.</p>;
  }

  const datosGrafico = periodos.map((periodo) => {
    const fila: Record<string, string | number> = { periodo };
    empresas.forEach(([companyId]) => {
      fila[`empresa_${companyId}`] = ventas.find(
        (venta) => venta.period === periodo && venta.company_id === companyId,
      )?.total_pen ?? 0;
    });
    return fila;
  });
  const anchoMinimo = Math.max(480, periodos.length * 64);

  return (
    <div className="w-full min-w-0 overflow-x-auto">
      <div className="h-[280px] w-full" style={{ minWidth: `${anchoMinimo}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={datosGrafico} stackOffset="sign" margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 4" vertical={false} />
            <XAxis
              dataKey="periodo"
              tickFormatter={nombrePeriodo}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(value) => numero(Number(value), 0)}
              tickLine={false}
              axisLine={false}
              width={68}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              labelFormatter={(label) => nombrePeriodo(String(label))}
              formatter={(value, name) => [soles(Number(value)), String(name)]}
              contentStyle={{ borderRadius: 8, borderColor: "var(--line)", backgroundColor: "var(--surface)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            {empresas.map(([companyId, companyName], indice) => (
              <Bar
                key={companyId}
                dataKey={`empresa_${companyId}`}
                name={companyName}
                stackId="ventas"
                fill={COLORES_GRAFICO[indice % COLORES_GRAFICO.length]}
                radius={2}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function Sep12MarcasSeparadasEHistorial() {
  const [data, setData] = useState<RespuestaHistorial | null>(null);
  const [loading, setLoading] = useState(true);
  const [fBrand, setFBrand] = useState("");
  const [seleccionPeriodo, setSeleccionPeriodo] = useState<SeleccionPeriodo>("3");
  const [mesDesde, setMesDesde] = useState(() => mesConDesfase(-2));
  const [mesHasta, setMesHasta] = useState(() => mesConDesfase(0));
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [selected, setSelected] = useState<ProyectoSep | null>(null);
  const [detail, setDetail] = useState<DetalleSep | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const rangoVentas = rangoPeriodo(seleccionPeriodo, mesDesde, mesHasta);

  useEffect(() => {
    let vigente = true;

    async function cargar() {
      setLoading(true);
      try {
        if (!fBrand) {
          const brandFromUrl = new URLSearchParams(window.location.search).get("brand_id");
          if (brandFromUrl) {
            setFBrand(brandFromUrl);
            return;
          }
        }

        const params = new URLSearchParams();
        if (rangoVentas.desde) {
          params.set("from", rangoVentas.desde);
          params.set("to", rangoVentas.hasta);
        } else {
          params.set("all", "1");
        }
        if (fBrand) params.set("brand_id", fBrand);
        const res = await api.get<RespuestaHistorial>(`/sep/historial?${params.toString()}`);
        if (!vigente) return;

        if (!fBrand && res.brands.length) {
          const activeSeparation = res.separations.find((separation) =>
            !separation.simulation && ["DRAFT", "VALIDATED", "APPROVED", "EXECUTING", "FAILED"].includes(separation.status),
          );
          const brandId = activeSeparation?.brand_id
            ?? res.brands.find((brand) => brand.status !== "SEPARATED")?.id
            ?? res.brands[0].id;
          setFBrand(brandId);
          return;
        }
        if (fBrand && res.brands.length && !res.brands.some((brand) => brand.id === fBrand)) {
          setFBrand(res.brands[0].id);
          return;
        }

        setData(res);
      } catch (e) {
        if (vigente) toast.error(e instanceof ApiError ? e.message : "No se pudo cargar el historial.");
      } finally {
        if (vigente) setLoading(false);
      }
    }

    void cargar();
    return () => {
      vigente = false;
    };
  }, [fBrand, refreshVersion, rangoVentas.desde, rangoVentas.hasta]);

  const marcas = data?.brands ?? [];
  const marca = marcas.find((brand) => brand.id === fBrand);
  const historial = data?.history ?? [];
  const ventas = data?.sales_by_company ?? [];
  const separaciones = data?.separations ?? [];
  const primerPeriodoDisponible = ventas.reduce(
    (primero, venta) => venta.period < primero ? venta.period : primero,
    rangoVentas.hasta,
  );
  const periodos = periodosEntre(rangoVentas.desde ?? primerPeriodoDisponible, rangoVentas.hasta);
  const ventasRecientes = ventas.filter((venta) => periodos.includes(venta.period));
  const etiquetaPeriodo = seleccionPeriodo === "all"
    ? "Todo el historial"
    : etiquetaRangoPeriodos(rangoVentas.desde ?? rangoVentas.hasta, rangoVentas.hasta);
  const separacionesEjecutadas = separaciones.filter((separation) => separation.status === "COMPLETED" && !separation.simulation).length;
  const paginaVentas = usePaginaLocal(ventasRecientes, `${fBrand}|ventas|${rangoVentas.desde ?? "all"}|${rangoVentas.hasta}`);
  const paginaSeparaciones = usePaginaLocal(separaciones, `${fBrand}|separaciones`);

  const columnasVentas: Column<VentaEmisora>[] = [
    { key: "period", header: "Mes", cardTitle: true, render: (row) => nombrePeriodo(row.period) },
    { key: "company_name", header: "Empresa emisora" },
    { key: "ruc", header: "RUC" },
    { key: "docs_count", header: "Comprobantes", align: "right" },
    { key: "subtotal_pen", header: "Valor venta", align: "right", render: (row) => soles(row.subtotal_pen) },
    { key: "total_pen", header: "Total", align: "right", render: (row) => <span className="font-semibold">{soles(row.total_pen)}</span> },
  ];

  const columnasSeparaciones: Column<ProyectoSep>[] = [
    {
      key: "number",
      header: "Número",
      cardTitle: true,
      className: "font-mono font-semibold",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 font-mono font-semibold">
          {row.number}
          {row.simulation && <Badge tone="info">Simulación</Badge>}
        </span>
      ),
    },
    { key: "dest_display", header: "Destino" },
    { key: "cutoff_date", header: "Corte", render: (row) => fecha(row.cutoff_date) },
    { key: "status", header: "Estado", render: (row) => <BadgeEstadoSep status={row.status} label={row.status_name} /> },
    { key: "completed_at", header: "Completada", render: (row) => fechaHora(row.completed_at) },
  ];

  async function abrirDetalle(separation: ProyectoSep) {
    setSelected(separation);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await api.get<DetalleSep>(`/sep/proyectos/${separation.id}`);
      setDetail(res);
      setSelected(res.separation);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cargar el detalle de la separación.");
    } finally {
      setDetailLoading(false);
    }
  }

  function cerrarDetalle() {
    setSelected(null);
    setDetail(null);
  }

  async function cancelarSeleccionada() {
    if (!selected) return;
    const confirmacion = await confirmAction({
      title: `Cancelar ${selected.number}`,
      message: `Se cancelará el proyecto de separación de ${selected.brand_name}. Los datos de la marca no habrán cambiado.`,
      confirmLabel: "Cancelar proyecto",
      danger: true,
      reason: { label: "Motivo de cancelación", min: 5 },
    });
    if (!confirmacion) return;

    setBusy(true);
    try {
      const res = await api.post<DetalleSep>(`/sep/proyectos/${selected.id}/cancelar`, {
        reason: confirmacion.reason ?? "",
      });
      setDetail(res);
      setSelected(res.separation);
      setRefreshVersion((version) => version + 1);
      toast.ok(`Proyecto ${res.separation.number} cancelado.`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "No se pudo cancelar el proyecto.");
    } finally {
      setBusy(false);
    }
  }

  const periodosLabel = periodos;
  const detailSeparation = detail?.separation;
  const puedeCancelar = selected && ["DRAFT", "VALIDATED", "APPROVED"].includes(selected.status);

  return (
    <div className="space-y-4">
      <PageHeader
        description="Empresas emisoras de la marca por vigencia y separaciones ejecutadas; los meses anteriores siguen mostrando la empresa de entonces."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <FiltroSelect
              etiqueta="Marca"
              vacio="Selecciona una marca"
              value={fBrand}
              onChange={setFBrand}
              options={marcas.map((brand) => ({ value: brand.id, label: brand.name }))}
              ancho={220}
            />
            <FiltroSelect
              etiqueta="Período"
              vacio="Todos los períodos"
              value={seleccionPeriodo === "all" ? "" : seleccionPeriodo}
              onChange={(value) => {
                if (value === "") {
                  setSeleccionPeriodo("all");
                } else if (value === "3" || value === "6" || value === "12" || value === "year" || value === "custom") {
                  setSeleccionPeriodo(value);
                }
              }}
              options={[
                { value: "3", label: "Últimos 3 meses" },
                { value: "6", label: "Últimos 6 meses" },
                { value: "12", label: "Últimos 12 meses" },
                { value: "year", label: "Año actual" },
                { value: "custom", label: "Rango personalizado" },
              ]}
              ancho={200}
            />
            {seleccionPeriodo === "custom" && (
              <>
                <FiltroFecha
                  etiqueta="Desde"
                  tipo="month"
                  visible
                  value={mesDesde}
                  max={mesHasta}
                  onChange={(value) => {
                    if (value) setMesDesde(value);
                  }}
                  ancho={155}
                />
                <FiltroFecha
                  etiqueta="Hasta"
                  tipo="month"
                  visible
                  value={mesHasta}
                  min={mesDesde}
                  max={mesConDesfase(0)}
                  onChange={(value) => {
                    if (value) setMesHasta(value);
                  }}
                  ancho={155}
                />
              </>
            )}
            <Button variant="secondary" onClick={() => setRefreshVersion((version) => version + 1)} disabled={loading}>
              <RefreshCw size={14} /> Actualizar
            </Button>
          </div>
        }
      />

      {marca ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Cifra
              titulo="Marca"
              valor={marca.name}
              detalle={etiquetaEstadoMarca(marca.status)}
              tono={marca.status === "SEPARATED" ? "warn" : "ok"}
            />
            <Cifra
              titulo="Empresa vigente hoy"
              valor={marca.current_company_name || "Fuera del tenant"}
              detalle={marca.current_ruc ? `RUC ${marca.current_ruc}` : ""}
            />
            <Cifra titulo="Vigencias" valor={String(historial.length)} detalle="Sin superposición de fechas" tono="ok" />
            <Cifra
              titulo="Separaciones"
              valor={String(separaciones.length)}
              detalle={`${separacionesEjecutadas} ejecutadas`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <Card>
              <CardHeader
                title="Empresas emisoras por vigencia"
                subtitle="Razón social que emitió para la marca en cada período"
              />
              <CardBody>
                {historial.length ? (
                  <div id="historial-vigencias" className="relative space-y-5 border-l border-line pl-5">
                    {historial.slice().reverse().map((row) => (
                      <div key={row.id} className="relative">
                        <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary" />
                        <div className="text-[11.5px] text-muted">{fecha(row.valid_from)}</div>
                        <div className="mt-0.5 text-[13px] font-semibold">{row.company_name}</div>
                        <div className="text-[11.5px] text-muted">
                          RUC {row.ruc} · {fecha(row.valid_from)} – {row.valid_to ? fecha(row.valid_to) : "vigente"}
                        </div>
                        {row.reason && <div className="mt-1 text-[12px]">{row.reason}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-[13px] text-muted">Sin vigencias registradas.</div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Ventas por empresa emisora"
                subtitle={`Total facturado por empresa · ${etiquetaPeriodo}`}
              />
              <CardBody>
                <GraficoVentas ventas={ventasRecientes} periodos={periodosLabel} />
                <p className="mt-3 text-[11.5px] text-muted">
                  Cada comprobante conserva la razón social con la que fue emitido.
                </p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Ventas por mes y empresa"
              subtitle={`Comprobantes de ${etiquetaPeriodo}, agrupados por empresa emisora`}
            />
            <DataTable
              rowKey={(row) => `${row.brand_id}|${row.company_id}|${row.period}`}
              columns={columnasVentas}
              rows={paginaVentas.filas}
              pagination={paginaVentas.props}
              loading={loading}
              empty="Sin ventas de la marca en el período seleccionado."
            />
          </Card>

          <Card>
            <CardHeader
              title="Separaciones de la marca"
              subtitle="Selecciona una fila para consultar el detalle"
            />
            <DataTable
              rowKey={(row) => row.id}
              columns={columnasSeparaciones}
              rows={paginaSeparaciones.filas}
              pagination={paginaSeparaciones.props}
              loading={loading}
              onRowClick={abrirDetalle}
              empty="Esta marca no tiene separaciones."
            />
          </Card>
        </>
      ) : (
        <Card>
          <CardBody className="py-10 text-center text-[13px] text-muted">
            {loading ? "Cargando historial…" : "No hay marcas disponibles para consultar."}
          </CardBody>
        </Card>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={cerrarDetalle}
        title={selected ? `${selected.number} · ${selected.brand_name}` : "Detalle de separación"}
        size="xl"
        placement="right"
        dismissable={!busy}
        footer={<Button variant="secondary" onClick={cerrarDetalle} disabled={busy}>Cerrar</Button>}
      >
        {detailLoading ? (
          <div className="py-10 text-center text-[13px] text-muted">Cargando detalle…</div>
        ) : detail && detailSeparation ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/m/sep/${detailSeparation.status === "DRAFT" ? "sep-03" : "sep-09"}?id=${detailSeparation.id}`}
                onClick={() => guardarIdSepActivo(detailSeparation.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12.5px] font-semibold text-white"
              >
                Abrir asistente <ArrowRight size={14} />
              </Link>
              <Button
                variant="secondary"
                onClick={() => {
                  setFBrand(detailSeparation.brand_id);
                  cerrarDetalle();
                  document.getElementById("historial-vigencias")?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                Historial de la marca
              </Button>
              {puedeCancelar && (
                <Button variant="danger" onClick={cancelarSeleccionada} disabled={busy}>
                  Cancelar
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Marca</dt>
                <dd className="mt-0.5 text-[13px]">{detailSeparation.brand_name}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Empresa de origen</dt>
                <dd className="mt-0.5 text-[13px]">{detailSeparation.origin_company_name} · RUC {detailSeparation.origin_ruc}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Destino</dt>
                <dd className="mt-0.5 text-[13px]">{detailSeparation.dest_type_name} · {detailSeparation.dest_display}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Fecha de corte</dt>
                <dd className="mt-0.5 text-[13px]">{fecha(detailSeparation.cutoff_date)} · desde {fecha(detailSeparation.effective_from)} rige el destino</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Estado</dt>
                <dd className="mt-0.5"><BadgeEstadoSep status={detailSeparation.status} label={detailSeparation.status_name} /></dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Simulación</dt>
                <dd className="mt-0.5 text-[13px]">{detailSeparation.simulation ? "Sí" : "No"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Validaciones</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detail.checks_summary.pass} correctas · {detail.checks_summary.warn} advertencias · {detail.checks_summary.fail} requieren atención
                  {detailSeparation.checks_run_at ? ` · ${fechaHora(detailSeparation.checks_run_at)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Elementos</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detail.progress.total} ({detail.progress.done} hechos, {detail.progress.excluded} excluidos, {detail.progress.failed} fallidos)
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Cuentas por cobrar</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detailSeparation.receivables_policy === "KEEP_ORIGIN" ? "Quedan en el origen" : "Se ceden al destino"}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Preparó</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detailSeparation.prepared_by_name || "—"}{detailSeparation.prepared_at ? ` · ${fechaHora(detailSeparation.prepared_at)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Aprobó</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detailSeparation.approved_by_name || "—"}{detailSeparation.approved_at ? ` · ${fechaHora(detailSeparation.approved_at)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Paquete</dt>
                <dd className="mt-0.5 break-all text-[13px]">{detailSeparation.export?.export_number || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-semibold uppercase text-muted">Acta</dt>
                <dd className="mt-0.5 text-[13px]">{detailSeparation.act?.act_number || "—"}</dd>
              </div>
              {detailSeparation.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-[11.5px] font-semibold uppercase text-muted">Notas</dt>
                  <dd className="mt-0.5 text-[13px]">{detailSeparation.notes}</dd>
                </div>
              )}
            </dl>

            <div>
              <h3 className="mb-3 text-[13px] font-semibold">Historial</h3>
              {detailSeparation.history.length ? (
                <div className="space-y-2">
                  {detailSeparation.history.slice().reverse().map((event, index) => (
                    <div key={`${event.at}-${index}`} className="flex flex-wrap items-center gap-2 border-l-2 border-line py-1 pl-3">
                      <span className="text-[11.5px] text-muted">{fechaHora(event.at)}</span>
                      <BadgeEstadoSep status={event.status} />
                      <span className="text-[12.5px]">{event.by_name || ""}</span>
                      {event.note && <span className="text-[12.5px] text-muted">· {event.note}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12.5px] text-muted">Sin movimientos registrados.</div>
              )}
            </div>
          </div>
        ) : (
          <Alert tone="warn" title="Detalle no disponible">
            No se pudo cargar la información completa de esta separación.
          </Alert>
        )}
      </Modal>
    </div>
  );
}
