"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, Plus, Printer, RefreshCw, Search, Trash2, Truck } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, FiltroSelect, IconButton, Input, PageHeader, Select, StatusBadge, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, kg, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { AlComprobante, EstadoSunat, Imprimible, Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { CANTIDAD, MOTIVOS_GUIA, SUNAT, hoyLima, type Num } from "@/modulos/fac/tipos";

type FilaGuia = {
  id: string; full_number: string; issue_date: string; start_date: string; transfer_reason_code: string; transport_mode: string; dest_address: string; gross_weight_kg: Num; packages: number;
  status: string; sunat_status: string; transfer_ref: string | null; send_attempts: number; origen: string | null; destino: string | null; plate: string | null; transportista: string | null; pedido: string | null;
};
type Opciones = {
  motivos: { code: string; name: string }[]; modalidades: Record<string, string>;
  locales: { id: string; name: string; short: string | null; address: string | null; ubigeo: string | null; company_id: string }[];
  destinos: { id: string; name: string; short: string | null; address: string | null; ubigeo: string | null }[];
  series: { id: string; series: string; establishment_id: string | null; all_sites: boolean; next_number: number }[];
  vehiculos: { id: string; plate: string; vehicle_type: string | null; ownership: string | null; establishment_id: string | null }[];
  conductores: { id: string; full_name: string; doc_number: string | null; position: string | null }[];
  transportistas: { id: string; legal_name: string; doc_number: string; supplier_type: string }[];
  transferencias: { id: string; number: string; from_site: string; to_site: string; origen: string; destino: string }[];
  hoy: string;
};
type LineaG = { key: number; variant_id: string; description: string; qty: string; uom_code: "KGM" | "NIU"; weight_kg: string; lot_id: string | null };
type Base = {
  establishment_id?: string; brand_id?: string | null; dest_establishment_id?: string; recipient_customer_id?: string | null; sales_document_id?: string | null; sales_document?: string | null;
  dest_address?: string | null; dest_ubigeo?: string | null; gross_weight_kg?: number | null; order?: { id: string; number: string; status: string };
  transfer?: { id: string; number: string };
  lines: { variant_id: string; description: string; qty: number; uom_code: string; weight_kg: number | null; lot_id: string | null }[];
};
type Detalle = {
  guia: FilaGuia & {
    company_id: string; series: string; number: number; origin_address: string; origin_ubigeo: string; dest_ubigeo: string; driver_license: string | null; issued_at: string | null; issued_by: string | null;
    sunat_message: string | null; sunat_code: string | null; void_reason: string | null; voided_at: string | null; notes: string | null; needs_review: boolean | null; next_retry_at: string | null;
    origen: string | null; destino: string | null; conductor: string | null; conductor_dni: string | null; transportista_ruc: string | null; destinatario: string | null; destinatario_doc_type: string | null;
    destinatario_doc: string | null; comprobante: string | null; sales_document_id: string | null;
  };
  motivo: string; modalidad: string; lineas: { id: string; description: string; qty: Num; uom_code: string; weight_kg: Num | null; lot: string | null }[];
  envios: { attempt_no: number; requested_at: string; result: string; response_code: string | null; message: string | null }[];
  empresa: { ruc: string; legal_name: string; fiscal_address: string | null } | null;
};

let clave = 1;

/** FAC-09 Guía de remisión remitente: motivo (catálogo 20), modalidad, transporte, partida, llegada, peso, bultos y bienes; desde el pedido, la transferencia o directa. */
export default function GuiaRemision() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const pedido = sp.get("pedido") ?? "";
  const transferencia = sp.get("transferencia") ?? "";
  const nueva = sp.get("nueva") === "1";
  return (
    <div className="space-y-4">
      <PageHeader description="Sustenta el traslado de la mercadería: por venta (con el pedido o el comprobante), entre locales de la empresa (con la transferencia de Almacén) u otros motivos." />
      {id ? <VerGuia key={id} id={id} />
        : pedido ? <ConBase key={pedido} url={`/v1/fac/guias/pedido/${pedido}`} motivo="01" />
        : transferencia ? <ConBase key={transferencia} url={`/v1/fac/guias/transferencia/${transferencia}`} motivo="04" />
        : nueva ? <Formulario base={{ lines: [] }} motivoInicial="13" />
        : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const { local, can } = useSesion();
  const [f, setF] = useState({ reason: "", sunat_status: "" });
  const lista = useListado<FilaGuia>("/v1/fac/guias", { orden: "-full_number", filtros: { ...f, site: local !== "ALL" ? local : "" } });
  const { datos: o } = useDatos<Opciones>("/v1/fac/guias/opciones");
  const columnas: Column<FilaGuia>[] = [
    { key: "full_number", header: "Guía", sortable: true, cardTitle: true, render: (g) => <div><div className="font-medium">{g.full_number}</div><div className="text-[12px] text-muted">{MOTIVOS_GUIA[g.transfer_reason_code] ?? g.transfer_reason_code}</div></div> },
    { key: "issue_date", header: "Fecha", sortable: true, render: (g) => fecha(g.issue_date) },
    { key: "dest_address", header: "Trayecto", render: (g) => <div className="min-w-0"><div>{g.origen ?? "—"} → {g.destino ?? g.dest_address}</div><div className="text-[12px] text-muted">{g.pedido ?? g.transfer_ref ?? ""}</div></div> },
    { key: "transport_mode", header: "Transporte", hideOnMobile: true, render: (g) => (g.transport_mode === "01" ? g.transportista ?? "Público" : `Privado · ${g.plate ?? ""}`) },
    { key: "gross_weight_kg", header: "Peso", sortable: true, align: "right", render: (g) => <div>{kg(g.gross_weight_kg)}<div className="text-[12px] text-muted">{g.packages} bulto(s)</div></div> },
    { key: "sunat_status", header: "SUNAT", render: (g) => <EstadoSunat sunat={g.sunat_status} status={g.status} /> },
  ];
  return (
    <div className="space-y-4">
      {can("fac.guide.issue") && o && o.transferencias.length > 0 && (
        <Seccion titulo="Transferencias que esperan su guía">
          <ul className="divide-y divide-line">
            {o.transferencias.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13.5px]">
                <span><span className="font-medium">{t.number}</span> · {t.origen} → {t.destino}</span>
                <Button size="sm" icon={Truck} onClick={() => router.push(`/m/fac/fac-09?transferencia=${t.id}`)}>Emitir guía</Button>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(g) => router.push(`/m/fac/fac-09?id=${g.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Número, destino, pedido o placa…" }} empty="Aún no hay guías."
        toolbar={<>
          <FiltroSelect etiqueta="Motivo" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} options={Object.entries(MOTIVOS_GUIA).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} ancho={200} />
          <FiltroSelect etiqueta="SUNAT" value={f.sunat_status} onChange={(v) => setF({ ...f, sunat_status: v })} options={["PENDING", "ACCEPTED", "REJECTED", "VOIDED"].map((k) => ({ value: k, label: SUNAT[k][0] }))} />
          {can("fac.guide.issue") && <Button icon={Plus} onClick={() => router.push("/m/fac/fac-09?nueva=1")}>Guía directa</Button>}
        </>} />
    </div>
  );
}

function ConBase({ url, motivo }: { url: string; motivo: string }) {
  const { datos, error, cargando } = useDatos<Base>(url);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !datos) return <Alert tone="bad">{error || "No se encontraron los datos."}</Alert>;
  return <Formulario base={datos} motivoInicial={motivo} />;
}

function Formulario({ base, motivoInicial }: { base: Base; motivoInicial: string }) {
  const router = useRouter();
  const { can, local: localSup } = useSesion();
  const { datos: o, error } = useDatos<Opciones>("/v1/fac/guias/opciones");
  const desdeTransferencia = Boolean(base.transfer);
  const [v, setV] = useState({
    establishment_id: base.establishment_id ?? "", series_id: "", transfer_reason_code: motivoInicial, transport_mode: "02", start_date: "",
    carrier_supplier_id: "", vehicle_id: "", driver_employee_id: "", driver_license: "", dest_establishment_id: base.dest_establishment_id ?? "",
    dest_address: base.dest_address ?? "", dest_ubigeo: base.dest_ubigeo ?? "", gross_weight_kg: base.gross_weight_kg ? String(base.gross_weight_kg) : "", packages: "1", notes: "",
  });
  const [lineas, setLineas] = useState<LineaG[]>(() => base.lines.map((l) => ({ key: clave++, variant_id: l.variant_id, description: l.description, qty: String(l.qty),
    uom_code: l.uom_code === "KGM" ? "KGM" : "NIU", weight_kg: l.weight_kg !== null ? String(l.weight_kg) : "", lot_id: l.lot_id })));
  const [enviando, setEnviando] = useState(false);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!o) return <Vacio>Cargando…</Vacio>;
  const local = v.establishment_id || (localSup !== "ALL" && o.locales.some((l) => l.id === localSup) ? localSup : o.locales[0]?.id ?? "");
  const series = o.series.filter((s) => s.all_sites || !s.establishment_id || s.establishment_id === local);
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const venta = v.transfer_reason_code === "01";
  const entreLocales = v.transfer_reason_code === "04";
  const pesoLineas = lineas.reduce((s, l) => s + Number(l.weight_kg || (l.uom_code === "KGM" ? l.qty : 0) || 0), 0);

  async function emitir() {
    setEnviando(true);
    try {
      const g = await api<{ id: string; full_number: string }>("/v1/fac/guias", { method: "POST", body: {
        establishment_id: local, series_id: v.series_id || undefined, brand_id: base.brand_id ?? undefined, transfer_reason_code: v.transfer_reason_code, transport_mode: v.transport_mode,
        start_date: v.start_date || undefined, carrier_supplier_id: v.transport_mode === "01" ? v.carrier_supplier_id || undefined : undefined,
        vehicle_id: v.transport_mode === "02" ? v.vehicle_id || undefined : undefined, driver_employee_id: v.transport_mode === "02" ? v.driver_employee_id || undefined : undefined,
        driver_license: v.transport_mode === "02" ? v.driver_license.trim() || undefined : undefined,
        recipient_customer_id: base.recipient_customer_id ?? undefined, dest_establishment_id: v.dest_establishment_id || undefined,
        dest_address: v.dest_address.trim() || undefined, dest_ubigeo: v.dest_ubigeo.trim() || undefined,
        gross_weight_kg: Number(v.gross_weight_kg), packages: Number(v.packages), order_id: base.order?.id, sales_document_id: base.sales_document_id ?? undefined,
        transfer_id: base.transfer?.id, notes: v.notes.trim() || undefined,
        lines: lineas.map((l) => ({ variant_id: l.variant_id, description: l.description, qty: Number(l.qty), uom_code: l.uom_code, weight_kg: l.weight_kg === "" ? undefined : Number(l.weight_kg), lot_id: l.lot_id ?? undefined })),
      } });
      toast.ok(`Se emitió la guía ${g.full_number}.`);
      router.push(`/m/fac/fac-09?id=${g.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-09")}>Guías</Button>
      {base.order && <Alert tone="info">Guía por venta del pedido {base.order.number}{base.sales_document ? ` · comprobante ${base.sales_document}` : " (aún sin comprobante)"}.</Alert>}
      {base.transfer && <Alert tone="info">Guía de la transferencia {base.transfer.number}: al emitirla, Almacén la registra en la transferencia.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Traslado">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Motivo (catálogo 20)">
              <Select value={v.transfer_reason_code} disabled={Boolean(base.order) || desdeTransferencia} onChange={(e) => set("transfer_reason_code", e.target.value)}
                options={o.motivos.map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` }))} />
            </Field>
            <Field label="Local de partida">
              <Select value={local} disabled={Boolean(base.establishment_id)} onChange={(e) => setV({ ...v, establishment_id: e.target.value, series_id: "" })} options={o.locales.map((l) => ({ value: l.id, label: l.name }))} />
            </Field>
            <Field label="Serie">
              <Select value={v.series_id} onChange={(e) => set("series_id", e.target.value)} placeholder="La del local" options={series.map((s) => ({ value: s.id, label: `${s.series} · sigue ${s.next_number}` }))} />
            </Field>
            <Field label="Inicio del traslado">
              <Input type="date" min={hoyLima()} value={v.start_date || o.hoy} onChange={(e) => set("start_date", e.target.value === o.hoy ? "" : e.target.value)} />
            </Field>
            {entreLocales || desdeTransferencia ? (
              <Field label="Local de llegada" className="sm:col-span-2">
                <Select value={v.dest_establishment_id} disabled={desdeTransferencia} onChange={(e) => set("dest_establishment_id", e.target.value)}
                  options={o.destinos.filter((d) => d.id !== local).map((d) => ({ value: d.id, label: `${d.name}${d.address ? ` · ${d.address}` : ""}` }))} />
              </Field>
            ) : (
              <>
                <Field label="Punto de llegada" className="sm:col-span-2"><Input value={v.dest_address} onChange={(e) => set("dest_address", e.target.value)} placeholder="Dirección de llegada" /></Field>
                <Field label="Ubigeo de llegada" hint="6 dígitos (opcional)"><Input inputMode="numeric" maxLength={6} value={v.dest_ubigeo} onChange={(e) => set("dest_ubigeo", e.target.value.replace(/\D/g, ""))} /></Field>
              </>
            )}
            {venta && !base.order && <div className="sm:col-span-2"><Alert tone="warn">La guía por venta se emite desde el pedido o el comprobante (botón «Guía de remisión» en el detalle).</Alert></div>}
          </div>
        </Seccion>

        <Seccion titulo="Transporte">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modalidad" className="sm:col-span-2">
              <Select value={v.transport_mode} onChange={(e) => set("transport_mode", e.target.value)} options={Object.entries(o.modalidades).map(([value, label]) => ({ value, label: `${value} · ${label}` }))} />
            </Field>
            {v.transport_mode === "01" ? (
              <Field label="Transportista (RUC)" className="sm:col-span-2">
                <Select value={v.carrier_supplier_id} onChange={(e) => set("carrier_supplier_id", e.target.value)} placeholder="Elige el transportista"
                  options={o.transportistas.map((t) => ({ value: t.id, label: `${t.legal_name} · ${t.doc_number}` }))} />
              </Field>
            ) : (
              <>
                <Field label="Vehículo">
                  <Select value={v.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} placeholder="Placa" options={o.vehiculos.map((x) => ({ value: x.id, label: x.plate }))} />
                </Field>
                <Field label="Conductor">
                  <Select value={v.driver_employee_id} onChange={(e) => set("driver_employee_id", e.target.value)} placeholder="Conductor"
                    options={o.conductores.map((x) => ({ value: x.id, label: `${x.full_name}${x.doc_number ? ` · ${x.doc_number}` : ""}` }))} />
                </Field>
                <Field label="Licencia de conducir" hint="Una letra y 8 números, por ejemplo Q40143565.">
                  <Input value={v.driver_license} maxLength={9} onChange={(e) => set("driver_license", e.target.value.toUpperCase())} />
                </Field>
              </>
            )}
            <Field label="Peso bruto (kg)" hint={pesoLineas > 0 ? `Los bienes suman ${numero(pesoLineas, 3)} kg.` : undefined}>
              <Input type="number" inputMode="decimal" min={0} step="0.001" value={v.gross_weight_kg} onChange={(e) => set("gross_weight_kg", e.target.value)} />
            </Field>
            <Field label="Bultos">
              <Input type="number" inputMode="numeric" min={1} value={v.packages} onChange={(e) => set("packages", e.target.value)} />
            </Field>
          </div>
        </Seccion>

        <Seccion titulo="Bienes" className="lg:col-span-2">
          {!base.order && !desdeTransferencia && <BuscarBien onElegir={(p) => setLineas((ls) => [...ls, { key: clave++, variant_id: p.id, description: p.name, qty: "1", uom_code: p.sale_mode === "KG" ? "KGM" : "NIU", weight_kg: "", lot_id: null }])} />}
          <div className="mt-3 space-y-2">
            {!lineas.length && <Vacio>Agrega los bienes que se trasladan.</Vacio>}
            {lineas.map((l) => (
              <div key={l.key} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-end">
                <p className="min-w-0 text-[13.5px] font-medium">{l.description}</p>
                <Field label={l.uom_code === "KGM" ? "Kilos" : "Unidades"}>
                  <Input type="number" inputMode="decimal" min={0} step={l.uom_code === "KGM" ? "0.001" : "1"} value={l.qty} disabled={desdeTransferencia}
                    onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value } : x)))} />
                </Field>
                <Field label="Peso (kg)">
                  <Input type="number" inputMode="decimal" min={0} step="0.001" value={l.weight_kg} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, weight_kg: e.target.value } : x)))} />
                </Field>
                {!desdeTransferencia ? <IconButton icon={Trash2} label="Quitar" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} /> : <span />}
              </div>
            ))}
          </div>
          <div className="mt-3"><Field label="Observaciones"><Textarea rows={2} maxLength={500} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></Field></div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" icon={Truck} loading={enviando} disabled={!can("fac.guide.issue") || !lineas.length || !Number(v.gross_weight_kg) || !Number(v.packages)} onClick={emitir}>Emitir guía</Button>
          </div>
        </Seccion>
      </div>
    </div>
  );
}

function BuscarBien({ onElegir }: { onElegir: (p: { id: string; name: string; sku: string; sale_mode: string }) => void }) {
  const { marca: marcaSup } = useSesion();
  const { datos: op } = useDatos<{ marcas: { id: string; name: string }[] }>("/v1/fac/emision/opciones");
  const [marca, setMarca] = useState("");
  const [q, setQ] = useState("");
  const m = marca || (marcaSup !== "ALL" ? marcaSup : op?.marcas[0]?.id ?? "");
  const url = m && q.trim().length >= 2 ? `/v1/fac/emision/productos?brand=${m}&q=${encodeURIComponent(q.trim())}` : null;
  const { datos: filas } = useDatos<{ id: string; name: string; sku: string; sale_mode: string }[]>(url);
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
        <Select aria-label="Marca" value={m} onChange={(e) => setMarca(e.target.value)} options={(op?.marcas ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o SKU" aria-label="Buscar producto" className="pl-9" />
        </div>
      </div>
      {url && filas && filas.length > 0 && (
        <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {filas.map((p) => (
            <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-[13.5px] hover:bg-surface-2" onClick={() => { onElegir(p); setQ(""); }}>{p.name} <span className="text-muted">· {p.sku}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerGuia({ id }: { id: string }) {
  const router = useRouter();
  const { can } = useSesion();
  const { datos: d, error, cargando, recargar } = useDatos<Detalle>(`/v1/fac/guias/${id}`);
  const [ocupado, setOcupado] = useState("");
  if (cargando) return <Vacio>Cargando la guía…</Vacio>;
  if (error || !d) return <Alert tone="bad">{error || "No se encontró la guía."}</Alert>;
  const g = d.guia;

  async function correr(que: string, fn: () => Promise<void>) {
    setOcupado(que);
    try { await fn(); recargar(); } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(""); }
  }
  const reenviar = () => correr("r", async () => {
    const r = await api<{ sunat_status: string }>(`/v1/fac/guias/${g.id}/reenviar`, { method: "POST" });
    toast.ok(r.sunat_status === "ACCEPTED" ? `${g.full_number} aceptada por SUNAT.` : `${g.full_number}: sin respuesta, queda en la cola.`);
  });
  const anular = () => correr("a", async () => {
    const r = await confirmAction({ title: `Anular la guía ${g.full_number}`, danger: true, confirmLabel: "Anular", reason: { label: "Motivo", min: 5 } });
    if (!r) return;
    await api(`/v1/fac/guias/${g.id}/anular`, { method: "POST", body: { reason: r.reason } });
    toast.ok(`Guía ${g.full_number} anulada.`);
  });

  const items = [
    { label: "Motivo", value: `${g.transfer_reason_code} · ${d.motivo}` },
    { label: "Emisión / inicio", value: `${fecha(g.issue_date)} · traslado desde ${fecha(g.start_date)}` },
    { label: "Partida", value: `${g.origen ?? ""} · ${g.origin_address} (${g.origin_ubigeo})` },
    { label: "Llegada", value: `${g.destino ? `${g.destino} · ` : ""}${g.dest_address} (${g.dest_ubigeo})` },
    { label: "Destinatario", value: g.destinatario ? `${g.destinatario}${g.destinatario_doc ? ` · ${g.destinatario_doc_type} ${g.destinatario_doc}` : ""}` : d.empresa?.legal_name ?? "—" },
    { label: "Modalidad", value: d.modalidad },
    ...(g.transport_mode === "01" ? [{ label: "Transportista", value: `${g.transportista ?? "—"} · RUC ${g.transportista_ruc ?? ""}` }]
      : [{ label: "Vehículo y conductor", value: `${g.plate ?? "—"} · ${g.conductor ?? "—"}${g.conductor_dni ? ` (DNI ${g.conductor_dni})` : ""} · licencia ${g.driver_license ?? "—"}` }]),
    { label: "Peso bruto y bultos", value: `${kg(g.gross_weight_kg)} · ${g.packages} bulto(s)` },
    ...(g.pedido ? [{ label: "Pedido", value: g.pedido }] : []),
    ...(g.comprobante && g.sales_document_id ? [{ label: "Comprobante", value: <AlComprobante id={g.sales_document_id}>{g.comprobante}</AlComprobante> }] : []),
    ...(g.transfer_ref ? [{ label: "Transferencia", value: g.transfer_ref }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="print:hidden"><Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-09")}>Guías</Button></div>
      <Seccion className="print:hidden" titulo={<span className="flex flex-wrap items-center gap-2">{g.full_number} <EstadoSunat sunat={g.sunat_status} status={g.status} revision={g.needs_review} /></span>}
        acciones={<>
          <Button size="sm" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
          {g.status === "ISSUED" && g.sunat_status === "PENDING" && can("fac.document.resend") && <Button size="sm" variant="primary" icon={RefreshCw} loading={ocupado === "r"} onClick={reenviar}>Reenviar a SUNAT</Button>}
          {g.status === "ISSUED" && can("fac.guide.issue") && <Button size="sm" variant="danger" icon={Ban} loading={ocupado === "a"} onClick={anular}>Anular</Button>}
        </>}>
        <DetailList items={items} />
        {g.sunat_status === "REJECTED" && <div className="mt-3"><Alert tone="bad">{g.sunat_code} · {g.sunat_message}</Alert></div>}
        {g.status === "VOIDED" && <div className="mt-3"><Alert tone="warn" title="Guía anulada">{g.void_reason} · {fechaHora(g.voided_at)}</Alert></div>}
      </Seccion>
      <Seccion className="print:hidden" titulo="Bienes">
        <ul className="divide-y divide-line text-[13.5px]">
          {d.lineas.map((l) => <li key={l.id} className="flex justify-between gap-2 py-2"><span>{l.description}{l.lot ? <span className="text-muted"> · lote {l.lot}</span> : null}</span><span className="shrink-0 tabular-nums">{CANTIDAD(l.qty, l.uom_code)}{l.weight_kg ? ` · ${kg(l.weight_kg)}` : ""}</span></li>)}
        </ul>
      </Seccion>
      <Seccion className="print:hidden" titulo="Envíos">
        {d.envios.length ? <ul className="divide-y divide-line text-[13.5px]">{d.envios.map((e) => <li key={e.attempt_no} className="py-2">#{Number(e.attempt_no)} · {fechaHora(e.requested_at)} · <StatusBadge status={e.result} labels={{ ACCEPTED: ["Aceptado", "ok"], REJECTED: ["Rechazado", "bad"], TIMEOUT: ["Sin respuesta", "warn"], ERROR: ["Error", "warn"], OBSERVED: ["Observado", "info"] }} /> {e.message}</li>)}</ul> : <Vacio>Aún no se envió.</Vacio>}
      </Seccion>
      <Imprimible ancho="A4">
        <div className="space-y-3 text-[12px] text-black">
          <div className="flex justify-between gap-4">
            <div><p className="text-[15px] font-bold">{d.empresa?.legal_name}</p><p>{d.empresa?.fiscal_address}</p></div>
            <div className="rounded border-2 border-black px-4 py-2 text-center"><p className="font-semibold">RUC {d.empresa?.ruc}</p><p className="font-bold">GUÍA DE REMISIÓN ELECTRÓNICA REMITENTE</p><p className="text-[15px] font-bold">{g.full_number}</p></div>
          </div>
          {items.map((i) => <p key={i.label}><span className="font-semibold">{i.label}: </span>{typeof i.value === "string" ? i.value : g.comprobante}</p>)}
          <table className="w-full border-collapse"><thead><tr className="border-b border-black text-left"><th className="py-1">Bien</th><th className="py-1 text-right">Cantidad</th><th className="py-1 text-right">Peso</th></tr></thead>
            <tbody>{d.lineas.map((l) => <tr key={l.id} className="border-b border-black/30"><td className="py-1">{l.description}</td><td className="py-1 text-right">{CANTIDAD(l.qty, l.uom_code)}</td><td className="py-1 text-right">{l.weight_kg ? kg(l.weight_kg) : ""}</td></tr>)}</tbody></table>
          {g.notes && <p>Observaciones: {g.notes}</p>}
          <p className="text-[10px]">Representación impresa de la guía de remisión electrónica remitente.</p>
        </div>
      </Imprimible>
    </div>
  );
}
