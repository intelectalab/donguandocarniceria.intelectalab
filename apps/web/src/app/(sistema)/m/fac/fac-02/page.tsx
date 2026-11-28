"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DataTable, DetailList, Field, FiltroSelect, Input, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Seccion, Vacio, useDatos } from "@/modulos/fac/comunes";
import { CANTIDAD, DOC_ID, ESTADO_PEDIDO, n, type Num } from "@/modulos/fac/tipos";

type FilaPedido = {
  id: string; number: string; status: string; channel: string; delivery_date: string | null; delivered_at: string | null; requested_doc_type: string; brand: string | null;
  total: Num; paid_amount: Num; customer_name: string; customer_doc_type: string | null; customer_doc_number: string | null; sin_pesar: number; atrasado: boolean;
};
type LineaVista = { description: string; qty: number; units: number; uom_code: string; unit_price: number; total: number; subtotal: number; igv: number; igv_affectation: string };
type Vista = {
  pedido: { id: string; number: string; status: string; channel: string; delivery_date: string | null; requested_doc_type: string; final_total: number; delivery_fee: number; brand: string | null; paid_amount: number; payment_method: string | null; credit: boolean };
  cliente: { id: string; doc_type: string; doc_number: string | null; full_name: string; fiscal_address: string | null };
  tipo: "INVOICE" | "RECEIPT"; series: { INVOICE: string | null; RECEIPT: string | null }; lineas: LineaVista[]; subtotal: number; igv: number; total: number;
  credit_days: number; factura_posible: boolean; tope_boleta: number;
};

const PIDIO: Record<string, string> = { INVOICE: "Factura", RECEIPT: "Boleta" };

/** FAC-02 Emitir desde el pedido: pedido listo o entregado con peso real; sugiere factura o boleta y emite con la serie de la marca y el local. */
export default function EmitirPedido() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader description="Pedidos listos o entregados que pidieron comprobante y aún no lo tienen. El importe sale del peso real; el comprobante toma la serie de la marca y el local del pedido." />
      {id ? <Emitir key={id} id={id} /> : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const { marca, local } = useSesion();
  const [estado, setEstado] = useState("");
  const lista = useListado<FilaPedido>("/v1/fac/pedidos", { orden: "delivery_date", filtros: { status: estado, brand: marca !== "ALL" ? marca : "", site: local !== "ALL" ? local : "" } });
  const columnas: Column<FilaPedido>[] = [
    { key: "number", header: "Pedido", sortable: true, cardTitle: true, render: (o) => (
      <div><div className="flex flex-wrap items-center gap-1.5"><span className="font-medium">{o.number}</span>{o.atrasado && <Badge tone="bad">+24 h sin comprobante</Badge>}</div>
        <div className="text-[12px] text-muted">{o.brand ?? "—"} · {o.channel}</div></div>
    ) },
    { key: "customer_name", header: "Cliente", sortable: true, render: (o) => <div><div>{o.customer_name}</div><div className="text-[12px] text-muted">{o.customer_doc_type && o.customer_doc_number ? `${o.customer_doc_type} ${o.customer_doc_number}` : "Sin documento"}</div></div> },
    { key: "requested_doc_type", header: "Pidió", render: (o) => PIDIO[o.requested_doc_type] ?? o.requested_doc_type },
    { key: "delivery_date", header: "Entrega", sortable: true, render: (o) => fecha(o.delivery_date) },
    { key: "status", header: "Estado", sortable: true, render: (o) => <div><StatusBadge status={o.status} labels={ESTADO_PEDIDO} />{o.sin_pesar > 0 && <div className="text-[11.5px] text-warn">{o.sin_pesar} línea(s) sin pesar</div>}</div> },
    { key: "total", header: "Total", sortable: true, align: "right", render: (o) => soles(o.total) },
  ];
  return (
    <DataTable {...lista.tabla} columns={columnas} onRowClick={(o) => router.push(`/m/fac/fac-02?id=${o.id}`)}
      search={{ ...lista.tabla.search, placeholder: "Pedido, cliente o documento…" }} empty="No hay pedidos por facturar."
      toolbar={<FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(ESTADO_PEDIDO).map(([value, [label]]) => ({ value, label }))} />} />
  );
}

function Emitir({ id }: { id: string }) {
  const router = useRouter();
  const { can, puede } = useSesion();
  const { datos: v, error, cargando } = useDatos<Vista>(`/v1/fac/pedidos/${id}`);
  const [tipo, setTipo] = useState<"" | "INVOICE" | "RECEIPT">("");
  const [pago, setPago] = useState<"" | "CASH" | "CREDIT">("");
  const [dias, setDias] = useState("");
  const [otro, setOtro] = useState(false);
  const [buyer, setBuyer] = useState({ doc_type: "DNI", doc_number: "", name: "" });
  const [enviando, setEnviando] = useState(false);

  if (cargando) return <Vacio>Cargando el pedido…</Vacio>;
  if (error || !v) return <><Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-02")}>Pedidos</Button><Alert tone="bad">{error || "No se encontró el pedido."}</Alert></>;

  const t = tipo || v.tipo;
  const p = pago || (v.pedido.credit ? "CREDIT" : "CASH");
  const serie = v.series[t];
  const sinDoc = t === "RECEIPT" && !otro && (!v.cliente.doc_number || v.cliente.doc_type === "NONE") && v.total > v.tope_boleta;
  const puedeEmitir = puede("FAC", "C") && can("fac.document.issue");

  async function emitir() {
    setEnviando(true);
    try {
      const body: Record<string, unknown> = { doc_type: t, payment_terms: p };
      if (p === "CREDIT" && dias) body.credit_days = Number(dias);
      if (otro && t === "RECEIPT") body.buyer = { doc_type: buyer.doc_type, doc_number: buyer.doc_number.trim() || null, name: buyer.name.trim() || undefined };
      const d = await api<{ id: string; full_number: string; sunat_status: string }>(`/v1/fac/pedidos/${id}/emitir`, { method: "POST", body });
      toast.ok(`Se emitió ${d.full_number}.`);
      router.push(`/m/fac/fac-04?id=${d.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
      setEnviando(false);
    }
  }

  const columnas: Column<LineaVista>[] = [
    { key: "description", header: "Descripción", cardTitle: true },
    { key: "qty", header: "Cantidad", align: "right", render: (l) => CANTIDAD(l.qty, l.uom_code) },
    { key: "unit_price", header: "P. unit.", align: "right", render: (l) => soles(l.unit_price) },
    { key: "total", header: "Importe", align: "right", render: (l) => soles(l.total) },
  ];

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/fac/fac-02")}>Pedidos</Button>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="min-w-0 space-y-4">
          <Seccion titulo={`Pedido ${v.pedido.number}`} acciones={<StatusBadge status={v.pedido.status} labels={ESTADO_PEDIDO} />}>
            <DetailList items={[
              { label: "Cliente", value: v.cliente.full_name },
              { label: "Documento", value: v.cliente.doc_number ? `${DOC_ID[v.cliente.doc_type] ?? v.cliente.doc_type} ${v.cliente.doc_number}` : "Sin documento" },
              { label: "Dirección", value: v.cliente.fiscal_address ?? "—" },
              { label: "Marca", value: v.pedido.brand ?? "—" },
              { label: "Pidió", value: PIDIO[v.pedido.requested_doc_type] ?? v.pedido.requested_doc_type },
              { label: "Pago del pedido", value: `${v.pedido.payment_method ?? "—"} · cobrado ${soles(v.pedido.paid_amount)}` },
            ]} />
          </Seccion>
          <Seccion titulo="Líneas con peso real">
            <DataTable rows={v.lineas} columns={columnas} rowKey={(l) => l.description + l.total} empty="Sin líneas." />
            <div className="mt-3 ml-auto max-w-xs space-y-1 text-[13.5px]">
              <div className="flex justify-between"><span className="text-muted">Valor de venta</span><span className="tabular-nums">{soles(v.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-muted">IGV</span><span className="tabular-nums">{soles(v.igv)}</span></div>
              <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{soles(v.total)}</span></div>
            </div>
          </Seccion>
        </div>

        <Seccion titulo="Comprobante" className="h-fit">
          <div className="space-y-3">
            <Field label="Tipo">
              <Select value={t} onChange={(e) => setTipo(e.target.value as "INVOICE" | "RECEIPT")}
                options={[{ value: "INVOICE", label: `Factura${v.factura_posible ? "" : " (el cliente no tiene RUC válido)"}` }, { value: "RECEIPT", label: "Boleta" }]} />
            </Field>
            {t === "INVOICE" && !v.factura_posible && <Alert tone="bad">La factura exige un RUC válido de 11 dígitos. Corrige el RUC del cliente en Clientes o emite boleta.</Alert>}
            <p className="text-[13px] text-muted">Serie: <span className="font-semibold text-ink">{serie ?? "sin serie vigente"}</span> · {v.pedido.brand}</p>
            {!serie && <Alert tone="bad">No hay una serie activa de {t === "INVOICE" ? "factura" : "boleta"} para la marca y el local del pedido. Créala en Series (FAC-10).</Alert>}
            <Field label="Forma de pago">
              <Select value={p} onChange={(e) => setPago(e.target.value as "CASH" | "CREDIT")} options={[{ value: "CASH", label: "Contado" }, { value: "CREDIT", label: "Crédito" }]} />
            </Field>
            {p === "CREDIT" && (
              <Field label="Días de crédito" hint={`Por defecto ${v.credit_days} días: la fecha de vencimiento se calcula sola.`}>
                <Input type="number" inputMode="numeric" min={1} max={180} value={dias} placeholder={String(v.credit_days)} onChange={(e) => setDias(e.target.value)} />
              </Field>
            )}
            {t === "RECEIPT" && (
              <Checkbox checked={otro} onChange={setOtro} label="Boleta a nombre de otra persona" />
            )}
            {otro && t === "RECEIPT" && (
              <div className="grid gap-2 sm:grid-cols-[110px_1fr]">
                <Select aria-label="Tipo de documento" value={buyer.doc_type} onChange={(e) => setBuyer({ ...buyer, doc_type: e.target.value })}
                  options={[{ value: "DNI", label: "DNI" }, { value: "CE", label: "C. E." }, { value: "PAS", label: "Pasaporte" }, { value: "NONE", label: "Sin doc." }]} />
                <Input aria-label="Número de documento" value={buyer.doc_number} disabled={buyer.doc_type === "NONE"} onChange={(e) => setBuyer({ ...buyer, doc_number: e.target.value })} placeholder="Número" />
                <Input aria-label="Nombre" className="sm:col-span-2" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="Nombre completo" />
              </div>
            )}
            {sinDoc && <Alert tone="warn">La boleta pasa de {soles(v.tope_boleta)}: SUNAT pide el documento del comprador.</Alert>}
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-muted">Total</span><span className="text-[20px] font-bold tabular-nums">{soles(v.total)}</span>
            </div>
            {puedeEmitir
              ? <Button variant="primary" icon={FileCheck2} className="w-full" loading={enviando} disabled={!serie || (t === "INVOICE" && !v.factura_posible) || n(v.total) <= 0} onClick={emitir}>
                  Emitir {t === "INVOICE" ? "factura" : "boleta"}
                </Button>
              : <Alert tone="warn">Tu rol no emite comprobantes.</Alert>}
          </div>
        </Seccion>
      </div>
    </div>
  );
}
