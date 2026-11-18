"use client";

import { use, useEffect, useState } from "react";
import { CalendarClock, History, Percent, TrendingUp } from "lucide-react";
import { Badge, Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import type { CambioPrecio, ListaPrecio } from "@/modulos/cat/tipos";

type Resumen = { cambios: number; este_mes: number; programados: number; variacion_promedio: number | null };

/** CAT-12 Historial de precios: cambios por variante y lista con usuario, fecha y precio anterior. ?variant_id= filtra. */
export default function HistorialDePrecios({ searchParams }: PageProps<"/m/cat/cat-12">) {
  const params = use(searchParams);
  const variante = typeof params.variant_id === "string" ? params.variant_id : "";
  const { marca } = useSesion();
  const [listas, setListas] = useState<ListaPrecio[]>([]);
  const [lista, setLista] = useState("");
  const [tipo, setTipo] = useState("");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const filtros = { list_id: lista, tipo, variant_id: variante };
  const historial = useListado<CambioPrecio>("/v1/cat/historial", { orden: "-valid_from", filtros });

  useEffect(() => {
    let vigente = true;
    api<ListaPrecio[]>(`/v1/cat/listas${marca !== "ALL" ? `?brand_id=${marca}` : ""}`).then((l) => vigente && setListas(l)).catch(() => {});
    return () => { vigente = false; };
  }, [marca]);

  useEffect(() => {
    let vigente = true;
    const q = new URLSearchParams();
    if (lista) q.set("list_id", lista);
    if (tipo) q.set("tipo", tipo);
    if (variante) q.set("variant_id", variante);
    api<Resumen>(`/v1/cat/historial/resumen?${q}`).then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [lista, tipo, variante]);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const columnas: Column<CambioPrecio>[] = [
    { key: "valid_from", header: "Vigente desde", sortable: true, render: (x) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">{fecha(x.valid_from)}{x.valid_from.slice(0, 10) > hoy && <Badge tone="info">Programado</Badge>}</span>
    ) },
    { key: "sku", header: "SKU", sortable: true, render: (x) => <span className="whitespace-nowrap font-mono">{x.sku}</span> },
    { key: "variant_name", header: "Variante", cardTitle: true, render: (x) => <div className="min-w-[160px]">{x.variant_name}{x.min_qty ? <div className="text-[12px] text-muted">Tramo desde {numero(x.min_qty, 2)}</div> : null}</div> },
    { key: "list", header: "Lista", hideOnMobile: true, render: (x) => <div className="min-w-[170px] text-[12.5px]">{x.list_name}</div> },
    { key: "anterior", header: "Precio anterior", align: "right", render: (x) => x.precio_anterior !== null ? <span className="whitespace-nowrap tabular-nums text-muted">{soles(x.precio_anterior)}</span> : <span className="text-muted">—</span> },
    { key: "price", header: "Precio", align: "right", sortable: true, render: (x) => <b className="whitespace-nowrap tabular-nums">{soles(x.price)}{x.basis === "KG" ? "/kg" : ""}</b> },
    { key: "cambio_pct", header: "Cambio", align: "right", sortable: true, render: (x) => x.cambio_pct === null ? <span className="text-muted">Inicial</span>
      : <Badge tone={x.cambio_pct > 0 ? "warn" : x.cambio_pct < 0 ? "ok" : "neutral"}>{x.cambio_pct > 0 ? "+" : ""}{numero(x.cambio_pct, 1)} %</Badge> },
    { key: "valid_to", header: "Hasta", hideOnMobile: true, render: (x) => x.valid_to ? <span className="whitespace-nowrap">{fecha(x.valid_to)}</span> : <span className="text-muted">Sin fin</span> },
    { key: "created_at", header: "Registró", sortable: true, hideOnMobile: true, render: (x) => (
      <div className="min-w-[150px] text-[12.5px]"><div>{x.created_by ?? "—"}</div><div className="text-muted">{fechaHora(x.created_at)}</div>{x.reason && <div className="text-muted">{x.reason}</div>}</div>
    ) },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Cambios de precio por variante y lista con usuario, fecha y precio anterior. Cada vigencia cerrada queda como historia; nada se sobreescribe (RN-CAT-06)." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cambios registrados" icono={History} destacada valor={resumen ? numero(resumen.cambios) : undefined} detalle="Con precio anterior" />
        <Cifra titulo="Cambios este mes" icono={TrendingUp} valor={resumen ? numero(resumen.este_mes) : undefined} detalle="Por fecha de vigencia" />
        <Cifra titulo="Programados" icono={CalendarClock} valor={resumen ? numero(resumen.programados) : undefined} detalle="Vigencia futura" />
        <Cifra titulo="Variación promedio" icono={Percent} valor={resumen ? (resumen.variacion_promedio === null ? "—" : porcentaje(resumen.variacion_promedio, 1)) : undefined} detalle="De los cambios" />
      </div>

      <DataTable {...historial.tabla} columns={columnas}
        search={{ ...historial.tabla.search, placeholder: "Buscar SKU, variante, lista o usuario…" }}
        empty="No hay cambios de precio con esos filtros."
        toolbar={<>
          <div className="w-64"><Select value={lista} onChange={(e) => setLista(e.target.value)} placeholder="Lista: todas" options={listas.map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} /></div>
          <div className="w-44"><Select value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo: todos" options={[{ value: "CHANGE", label: "Cambio de precio" }, { value: "FIRST", label: "Precio inicial" }]} /></div>
        </>} />
    </div>
  );
}
