"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Layers, Lock, ShieldCheck } from "lucide-react";
import { DataTable, Modal, PageHeader, StatusBadge, buttonClass, type Column } from "@/components/ui";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Cant, CifraLink, Dias, FiltroSelect, qs, useAlAbrir, useDatos, useOpciones } from "@/modulos/alm/comunes";
import { LoteFicha } from "@/modulos/alm/LoteFicha";
import { ESTADOS_LOTE, LOTE, type Lote } from "@/modulos/alm/tipos";

type Cifras = { with_stock: number; quarantine: number; blocked: number; expiring: number; expired: number };
const ORIGEN_LOTE: Record<string, string> = { PURCHASE: "Compra", FARM: "Granja", PRODUCTION: "Producción", CUTTING: "Despiece", OPENING: "Carga inicial", RETURN: "Devolución" };

/** ALM-05 Lotes: estado, vencimiento, stock por almacén y pedidos que lo usaron. */
export default function Lotes() {
  const { marca, puede, can } = useSesion();
  const op = useOpciones();
  const [estado, setEstado] = useState("");
  const [marcaF, setMarcaF] = useState("");
  const [linea, setLinea] = useState("");
  const [stock, setStock] = useState("WITH");
  const [porVencer, setPorVencer] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  useAlAbrir((p) => setAbierto(p.get("lote")));
  const lista = useListado<Lote>("/v1/alm/lotes", { orden: "expiry_date", filtros: { qc_status: estado, brand: marca, brand_id: marcaF, line: linea, stock, expiring: porVencer ? 1 : "" } });
  const c = useDatos<Cifras>(`/v1/alm/cifras/05${qs({ brand: marca })}`).datos;
  const costos = can("alm.stock.view_cost");
  const filtrar = (e: string, v = false) => { setEstado(e); setPorVencer(v); setStock("WITH"); };

  const columnas: Column<Lote>[] = [
    { key: "code", header: "Lote", sortable: true, cardTitle: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    { key: "sku", header: "Producto", sortable: true, render: (l) => <div className="min-w-[160px]"><p>{l.variant_name}</p><p className="font-mono text-[12px] text-muted">{l.sku}{l.line ? ` · ${l.line}` : ""}</p></div> },
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (l) => l.brand_name ?? "—" },
    { key: "origin", header: "Origen", hideOnMobile: true, render: (l) => <div><p>{ORIGEN_LOTE[l.origin ?? ""] ?? l.origin ?? "—"}</p>{l.supplier_name && <p className="text-[12px] text-muted">{l.supplier_name}</p>}</div> },
    { key: "qc_status", header: "Estado", sortable: true, render: (l) => <StatusBadge status={l.qc_status} labels={LOTE} /> },
    { key: "production_date", header: "Producción", sortable: true, hideOnMobile: true, render: (l) => fecha(l.production_date) },
    { key: "expiry_date", header: "Vence", sortable: true, render: (l) => <div><p>{fecha(l.expiry_date)}</p><Dias d={l.days_left} /></div> },
    { key: "stock_qty", header: "Stock", sortable: true, align: "right", render: (l) => <div><Cant v={l.stock_qty} modo={l.sale_mode} />{Number(l.reserved_qty) > 0 && <p className="text-[12px] text-muted">{numero(l.reserved_qty, 3)} reservado</p>}</div> },
    { key: "stock_by_warehouse", header: "Por almacén", hideOnMobile: true, render: (l) => <span className="font-mono text-[12px]">{l.stock_by_warehouse ?? "—"}</span> },
    ...(costos ? [{ key: "value", header: "Valor", sortable: true, align: "right", render: (l: Lote) => soles(l.value) }] as Column<Lote>[] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cada lote con su estado de calidad y su vencimiento. Solo un lote liberado y vigente se vende o se reserva." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CifraLink titulo="Lotes con stock" valor={c ? numero(c.with_stock) : undefined} icono={Layers} onClick={() => filtrar("")} />
        <CifraLink titulo="En cuarentena" valor={c ? numero(c.quarantine) : undefined} detalle="Por liberar" icono={ShieldCheck} tono={c?.quarantine ? "warn" : undefined} onClick={() => filtrar("QUARANTINE")} />
        <CifraLink titulo="Bloqueados" valor={c ? numero(c.blocked) : undefined} detalle="No se venden" icono={Lock} tono={c?.blocked ? "bad" : undefined} onClick={() => filtrar("BLOCKED")} />
        <CifraLink titulo="Vencen en 7 días" valor={c ? numero(c.expiring) : undefined} detalle={c ? `${c.expired} ya vencidos con stock` : undefined} icono={CalendarClock}
          tono={c?.expired ? "bad" : c?.expiring ? "warn" : undefined} onClick={() => filtrar("", true)} />
      </div>
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(l) => setAbierto(l.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar lote, SKU, producto o proveedor…" }} empty="No hay lotes con esos filtros."
        toolbar={<>
          <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={ESTADOS_LOTE} />
          <FiltroSelect label="Marca" value={marcaF} onChange={setMarcaF} options={(op?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))} />
          <FiltroSelect label="Línea" value={linea} onChange={setLinea} options={(op?.lines ?? []).map((l) => ({ value: l, label: l }))} />
          <FiltroSelect label="Stock" value={stock} onChange={(v) => setStock(v || "ANY")}
            options={[{ value: "WITH", label: "Con stock" }, { value: "WITHOUT", label: "Sin stock" }]} />
          {porVencer && <button type="button" onClick={() => setPorVencer(false)} className="cursor-pointer rounded-full bg-warn-soft px-3 text-[12.5px] font-semibold text-warn">Vencen en 7 días ✕</button>}
        </>} />
      {abierto && (
        <Modal open onClose={() => setAbierto(null)} size="lg" title="Ficha del lote"
          footer={puede("ALM", "E") && <Link href={`/m/alm/alm-06?lote=${abierto}`} className={buttonClass("primary")}>Liberar o bloquear</Link>}>
          <LoteFicha id={abierto} />
        </Modal>
      )}
    </div>
  );
}
