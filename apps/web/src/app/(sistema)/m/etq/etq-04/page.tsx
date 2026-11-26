"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpLeft, FileDown, Siren } from "lucide-react";
import { Alert, Badge, Button, DetailList, PageHeader, StatusBadge } from "@/components/ui";
import { fecha, kg, numero } from "@/lib/formato";
import { BuscarLote, ESTADO_LOTE, ESTADO_RETIRO, ORIGEN_LOTE, Seccion, Tabla, useAlAbrir, useDatos, useOpcionesEtq, type Num } from "@/modulos/etq/comunes";

type Nodo = { lot_id: string; code: string; origin: string; qc_status: string; product: string; sku: string; production_date: string | null; expiry_date: string | null; supplier: string | null;
  order: string | null; farm_origin: string | null; level?: number; kg?: Num; via_order?: string | null; child_id?: string; parent_id?: string };
type Venta = { type: string; lot_code: string; reference: string; doc_type: string | null; date: string; customer_name: string | null; phone: string | null; kg: Num };
type Traza = { lot: Nodo; backward: Nodo[]; forward: Nodo[]; sales: Venta[]; descendants: string[]; recalls: { id: string; number: string; status: string; initiated_at: string }[];
  prints: { prints: number; labels: number } };

const DOC: Record<string, string> = { RECEIPT: "Boleta", INVOICE: "Factura", ORDER: "Pedido", CONSIGNMENT: "Consignación" };

/** ETQ-04 Trazabilidad de un lote: hacia atrás (insumos, proveedor, granja) y hacia adelante (lotes derivados y ventas), con kg, documentos y fechas (RN-ETQ-05). */
export default function Trazabilidad() {
  const op = useOpcionesEtq();
  const router = useRouter();
  const [id, setId] = useState("");
  useAlAbrir((p) => setId(p.get("lot") ?? ""));
  const { datos: t, error, cargando } = useDatos<Traza>(id ? `/v1/etq/lotes/${id}/trazabilidad` : null);
  const kgVendidos = (t?.sales ?? []).reduce((s, v) => s + Number(v.kg ?? 0), 0);
  return (
    <div className="space-y-5 print:space-y-3">
      <PageHeader description="Busca un lote para ver de dónde vino y a dónde fue: insumos y proveedores hacia atrás, lotes derivados y clientes hacia adelante."
        actions={t && <div className="flex gap-2 print:hidden">
          <Button icon={FileDown} onClick={() => window.print()}>Exportar PDF</Button>
          {op?.can.start_recall && <Button variant="danger" icon={Siren} onClick={() => router.push(`/m/etq/etq-06?lot=${t.lot.lot_id}`)}>Iniciar retiro</Button>}
        </div>} />
      <div className="max-w-xl print:hidden"><BuscarLote onElegir={(l) => setId(l.id)} /></div>
      {error && <Alert tone="bad">{error}</Alert>}
      {!id && <p className="text-[13px] text-muted">Escribe al menos dos letras del código del lote o del producto.</p>}
      {cargando && <p className="text-[13px] text-muted">Trazando…</p>}
      {t && <>
        <Seccion titulo={`Lote ${t.lot.code}`}>
          <DetailList items={[
            { label: "Producto", value: `${t.lot.product} (${t.lot.sku})` }, { label: "Estado", value: <StatusBadge status={t.lot.qc_status} labels={ESTADO_LOTE} /> },
            { label: "Origen", value: `${ORIGEN_LOTE[t.lot.origin] ?? t.lot.origin}${t.lot.supplier ? ` · ${t.lot.supplier}` : ""}${t.lot.farm_origin ? ` · ${t.lot.farm_origin}` : ""}` },
            { label: "Orden de producción", value: t.lot.order ?? "—" },
            { label: "Producción", value: fecha(t.lot.production_date) }, { label: "Vencimiento", value: fecha(t.lot.expiry_date) },
            { label: "Etiquetas impresas", value: <Link href={`/m/etq/etq-03?lot_id=${t.lot.lot_id}`} className="text-primary hover:underline">{numero(t.prints.labels)} en {numero(t.prints.prints)} impresiones</Link> },
            { label: "Retiros", value: t.recalls.length ? <span className="flex flex-wrap gap-1">{t.recalls.map((r) => <Link key={r.id} href={`/m/etq/etq-07?id=${r.id}`}><StatusBadge status={r.status} labels={ESTADO_RETIRO} /> <span className="font-mono text-[12.5px]">{r.number}</span></Link>)}</span> : "Ninguno" },
          ]} />
        </Seccion>
        <div className="grid gap-4 lg:grid-cols-2">
          <Seccion titulo="Hacia atrás · de dónde vino">
            <Arbol nodos={t.backward} icono={<ArrowUpLeft className="size-3.5 text-muted" />} vacio={t.lot.origin === "PURCHASE" ? `Lote comprado${t.lot.supplier ? ` a ${t.lot.supplier}` : ""}: no tiene insumos propios.` : "No hay insumos registrados."} onIr={setId} />
          </Seccion>
          <Seccion titulo="Hacia adelante · lotes derivados">
            <Arbol nodos={t.forward} icono={<ArrowDownRight className="size-3.5 text-muted" />} vacio="Este lote no se usó para producir otros." onIr={setId} />
          </Seccion>
        </div>
        <Seccion titulo={`Ventas · ${kg(kgVendidos)} a ${new Set(t.sales.map((v) => v.customer_name)).size} cliente(s)`}>
          <Tabla cabeza={["Fecha", "Documento", "Cliente", "Teléfono", "Lote", "Kg"]} filas={t.sales.map((v) => [fecha(v.date), `${DOC[v.doc_type ?? v.type] ?? v.type} ${v.reference}`, v.customer_name ?? "Sin identificar",
            v.phone ?? "—", <span key="l" className="font-mono">{v.lot_code}</span>, kg(v.kg)])} vacio="No hay ventas registradas de este lote ni de sus derivados." />
        </Seccion>
      </>}
    </div>
  );
}

function Arbol({ nodos, icono, vacio, onIr }: { nodos: Nodo[]; icono: React.ReactNode; vacio: string; onIr: (id: string) => void }) {
  if (!nodos.length) return <p className="text-[13px] text-muted">{vacio}</p>;
  return (
    <ul className="space-y-1.5">
      {nodos.map((n) => (
        <li key={`${n.lot_id}-${n.level}`} style={{ paddingLeft: `${((n.level ?? 1) - 1) * 18}px` }}>
          <button type="button" onClick={() => onIr(n.lot_id)} className="flex w-full items-start gap-2 rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2">
            <span className="mt-1">{icono}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">{n.code}</span><StatusBadge status={n.qc_status} labels={ESTADO_LOTE} />
                {n.via_order && <Badge>{n.via_order}</Badge>}</span>
              <span className="block truncate text-[12.5px] text-muted">{n.product}{n.supplier ? ` · ${n.supplier}` : ""}{n.farm_origin ? ` · ${n.farm_origin}` : ""} · {fecha(n.production_date)}</span>
            </span>
            <span className="text-[13px] font-medium whitespace-nowrap">{n.kg !== null && n.kg !== undefined ? kg(n.kg) : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
