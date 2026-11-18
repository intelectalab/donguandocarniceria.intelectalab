"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, Percent, Plus, Scale, ShoppingBag } from "lucide-react";
import { Badge, Button, Cifra, DataTable, Input, PageHeader, Select, StatusBadge, Tabs, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { CANALES, ENTREGAS, ESTADOS, ORDEN_ESTADOS, etiqueta, franjaTexto, type Opciones, type PedidoFila } from "@/modulos/ped/tipos";

type Vista = "ACTIVOS" | "HOY" | "BORRADORES" | "INCOMPLETOS" | "AVISO_PESO" | "CERRADOS" | "CANCELADOS" | "TODOS";
type Resumen = { por_estado: Record<string, number>; alertas: { faltan: number; aviso_peso: number; descuento: number; sin_stock: number }; opciones: Opciones };

/** PED-01 Pedidos: lista por estado, fecha de entrega, franja, marca, canal, zona, vendedora y local; contadores y alertas. */
export default function Pedidos() {
  const router = useRouter();
  const { can, puede, marca: marcaSup, local: localSup } = useSesion();
  const [vista, setVista] = useState<Vista>("ACTIVOS");
  const [estado, setEstado] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [canal, setCanal] = useState("");
  const [zona, setZona] = useState("");
  const [vendedora, setVendedora] = useState("");
  const [entrega, setEntrega] = useState("");
  const [franja, setFranja] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [exportando, setExportando] = useState(false);

  const filtros = { vista, status: estado, desde, hasta, channel: canal, zone_id: zona, seller_id: vendedora, fulfillment: entrega, slot_id: franja, brand: marcaSup, site: localSup };
  const lista = useListado<PedidoFila>("/v1/ped/pedidos", { orden: "-created_at", filtros });
  const claveResumen = JSON.stringify({ ...filtros, status: "" });

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams(Object.entries(JSON.parse(claveResumen) as Record<string, string>).filter(([, v]) => v));
    api<Resumen>(`/v1/ped/pedidos/resumen?${p}`).then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [claveResumen]);

  async function exportar() {
    setExportando(true);
    try {
      const p = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v) as [string, string][]);
      await apiDescargar(`/v1/ped/pedidos/exportar?${p}`, "pedidos.xlsx");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setExportando(false);
    }
  }

  const op = resumen?.opciones;
  const al = resumen?.alertas;
  const columnas: Column<PedidoFila>[] = [
    {
      key: "number", header: "Pedido", sortable: true, cardTitle: true,
      render: (o) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{o.number}</span>
            {o.faltan_datos && <Badge tone="warn">Faltan datos</Badge>}
            {o.weight_diff_status === "NOTICE_REQUIRED" && <Badge tone="bad">Aviso de peso</Badge>}
            {o.franja_llena && o.status === "DRAFT" && <Badge tone="bad">Franja llena</Badge>}
            {o.discount_status === "PENDING_APPROVAL" && <Badge tone="warn">Descuento por aprobar</Badge>}
            {o.needs_stock && ["CONFIRMED", "IN_PREPARATION"].includes(o.status) && <Badge tone="warn">Sin stock</Badge>}
          </div>
          <div className="text-[12px] text-muted">{o.marca} · {etiqueta(CANALES, o.channel)}</div>
        </div>
      ),
    },
    { key: "cliente", header: "Cliente", sortable: true, render: (o) => <div><div>{o.cliente}</div><div className="text-[12px] text-muted">{o.zona ?? etiqueta(ENTREGAS, o.fulfillment)}</div></div> },
    {
      key: "delivery_date", header: "Entrega", sortable: true,
      render: (o) => <div className="whitespace-nowrap"><div>{fecha(o.delivery_date)}</div><div className="text-[12px] text-muted">{franjaTexto(o.slot_from, o.slot_to)}</div></div>,
    },
    { key: "vendedora", header: "Vendedora", hideOnMobile: true, render: (o) => o.vendedora ?? <span className="text-muted">—</span> },
    {
      key: "estimated_total", header: "Total", align: "right", sortable: true,
      render: (o) => <div><div>{soles(o.final_total ?? o.estimated_total)}</div><div className="text-[11.5px] text-muted">{o.final_total ? "final" : "estimado"}</div></div>,
    },
    { key: "status", header: "Estado", sortable: true, render: (o) => <StatusBadge status={o.status} labels={ESTADOS} /> },
  ];

  const pe = resumen?.por_estado ?? {};
  return (
    <div className="space-y-5">
      <PageHeader description="Todos los pedidos de los canales. Un pedido no se confirma sin sus datos obligatorios."
        actions={<>
          <Button icon={Download} loading={exportando} onClick={exportar}>Exportar</Button>
          {puede("PED", "C") && can("ped.order.create") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/ped/ped-02")}>Nuevo pedido</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Pedidos en la vista" icono={ShoppingBag} destacada valor={resumen ? numero(Object.values(pe).reduce((a, b) => a + Number(b), 0)) : undefined}
          detalle={resumen ? `${numero(pe.CONFIRMED ?? 0)} confirmados · ${numero(pe.DRAFT ?? 0)} borradores` : ""} />
        <button type="button" onClick={() => setVista("BORRADORES")} className="h-full cursor-pointer text-left [&>div]:h-full">
          <Cifra titulo="Borradores con datos faltantes" icono={AlertTriangle} valor={al ? numero(al.faltan) : undefined} tono={al ? (al.faltan ? "warn" : "ok") : undefined} detalle="No se pueden confirmar aún" />
        </button>
        <button type="button" onClick={() => router.push("/m/ped/ped-07")} className="h-full cursor-pointer text-left [&>div]:h-full">
          <Cifra titulo="Aviso de peso pendiente" icono={Scale} valor={al ? numero(al.aviso_peso) : undefined} tono={al ? (al.aviso_peso ? "bad" : "ok") : undefined} detalle="Abre Diferencia de peso" />
        </button>
        <button type="button" onClick={() => router.push("/m/ped/ped-10")} className="h-full cursor-pointer text-left [&>div]:h-full">
          <Cifra titulo="Descuentos por aprobar" icono={Percent} valor={al ? numero(al.descuento) : undefined} tono={al && al.descuento ? "warn" : undefined} detalle="Abre Aprobación de descuentos" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ORDEN_ESTADOS.filter((s) => pe[s]).map((s) => (
          <button key={s} type="button" onClick={() => setEstado(estado === s ? "" : s)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] ${estado === s ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
            {ESTADOS[s][0]} <b>{pe[s]}</b>
          </button>
        ))}
      </div>

      <Tabs value={vista} onChange={(v) => { setVista(v); setEstado(""); }} tabs={[
        { key: "ACTIVOS", label: "Activos" }, { key: "HOY", label: "Para hoy" }, { key: "BORRADORES", label: "Borradores" },
        { key: "AVISO_PESO", label: "Aviso de peso" }, { key: "INCOMPLETOS", label: "Importados incompletos" },
        { key: "CERRADOS", label: "Cerrados" }, { key: "CANCELADOS", label: "Cancelados" }, { key: "TODOS", label: "Todos" },
      ]} />

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Número, cliente o celular…" }}
        onRowClick={(o) => router.push(o.status === "DRAFT" ? `/m/ped/ped-02?id=${o.id}` : `/m/ped/ped-03?id=${o.id}`)}
        empty="No hay pedidos con esos filtros."
        toolbar={<>
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="Entrega desde" value={desde} onChange={(e) => setDesde(e.target.value)} className="!h-9 w-[140px] text-[13px]" />
            <span className="text-muted">–</span>
            <Input type="date" aria-label="Entrega hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} className="!h-9 w-[140px] text-[13px]" />
          </div>
          <Filtro label="Canal" value={canal} onChange={setCanal} options={CANALES} />
          <Filtro label="Entrega" value={entrega} onChange={setEntrega} options={ENTREGAS} />
          <Filtro label="Zona" value={zona} onChange={setZona} options={(op?.zonas ?? []).map((z) => ({ value: z.id, label: z.name }))} />
          <Filtro label="Franja" value={franja} onChange={setFranja} options={(op?.franjas ?? []).map((f) => ({ value: f.id, label: `${f.name} · ${op?.locales.find((l) => l.id === f.establishment_id)?.short ?? ""}` }))} />
          <Filtro label="Vendedora" value={vendedora} onChange={setVendedora} options={(op?.vendedoras ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        </>} />
    </div>
  );
}

function Filtro({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options} className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
