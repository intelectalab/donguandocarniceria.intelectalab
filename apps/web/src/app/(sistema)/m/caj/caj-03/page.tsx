"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleDollarSign, Clock, Download, Plus, Receipt, Undo2 } from "lucide-react";
import { Badge, Button, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { DetalleCobro } from "@/modulos/caj/DetalleCobro";
import { CONCILIACION, ESTADO_COBRO, ORIGEN_COBRO, n, useDatos, type FilaCobro } from "@/modulos/caj/comunes";

type Opciones = {
  medios: { code: string; name: string }[]; cuentas: { id: string; code: string; name: string }[]; cobradores: { id: string; name: string }[];
};
type Totales = { n: number; vigente: number; por_conciliar: number; revertidos: number };

/** CAJ-03 Cobros: todos los cobros con filtros, totales, exportación y su detalle (reverso con motivo). */
export default function Cobros() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const inicial = useSearchParams().get("id");
  const { can, puede, marca } = useSesion();
  const [f, setF] = useState({ desde: "", hasta: "", medio: "", cuenta: "", estado: "", conciliacion: "", origen: "", cobrado_por: "" });
  const [abierto, setAbierto] = useState<string | null>(inicial);
  const [bajando, setBajando] = useState(false);
  const { datos: op } = useDatos<Opciones>("/v1/caj/cobros/opciones");
  const filtros = { ...f, marca: marca !== "ALL" ? marca : "" };
  const lista = useListado<FilaCobro>("/v1/caj/cobros", { orden: "-paid_at", filtros });
  // Los totales (según los filtros, sin la búsqueda) vienen con la lista: se piden con una sola fila.
  const pt = new URLSearchParams(Object.entries({ ...filtros, per_page: "1" }).filter(([, v]) => v));
  const { datos: resumen, recargar: recargarTotales } = useDatos<{ totales: Totales }>(`/v1/caj/cobros?${pt}`);
  const totales = resumen?.totales;
  const recargar = () => { lista.recargar(); recargarTotales(); };
  const poner = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function exportar() {
    setBajando(true);
    try {
      const p = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
      await apiDescargar(`/v1/caj/cobros/exportar?${p}`, "cobros.xlsx");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  function cerrar() {
    setAbierto(null);
    if (inicial) router.replace("/m/caj/caj-03");
  }

  const columnas: Column<FilaCobro>[] = [
    { key: "number", header: "Cobro", sortable: true, cardTitle: true, render: (p) => (
      <div className="min-w-0"><div className="font-medium">{p.number}</div><div className="text-[12px] text-muted">{fechaHora(p.paid_at)}</div></div>
    ) },
    { key: "cliente", header: "Cliente", render: (p) => <div className="min-w-0"><div className="truncate">{p.cliente ?? "—"}</div><div className="text-[12px] text-muted">{p.marca ?? ""}</div></div> },
    { key: "medio", header: "Medio y cuenta", render: (p) => (
      <div className="text-[13px]">{p.medio_nombre}{p.card_last4 ? ` •••• ${p.card_last4}` : ""}<div className="text-[12px] text-muted">{p.cuenta_code}{p.reference ? ` · op. ${p.reference}` : ""}</div></div>
    ) },
    { key: "origen", header: "Origen", hideOnMobile: true, render: (p) => (
      <div className="text-[13px]">{ORIGEN_COBRO[p.source ?? (p.pos_shift_id ? "POS" : "CAJ")] ?? "—"}<div className="text-[12px] text-muted">{p.cobrado_por ?? ""}</div></div>
    ) },
    { key: "reconciliation_status", header: "Conciliación", hideOnMobile: true, render: (p) => <StatusBadge status={p.reconciliation_status} labels={CONCILIACION} /> },
    { key: "amount", header: "Monto", sortable: true, align: "right", render: (p) => {
      const libre = p.status === "CONFIRMED" ? Math.max(0, n(p.amount) - n(p.aplicado) - n(p.to_balance)) : 0;
      return (
        <div className="text-right"><span className={`font-semibold tabular-nums ${p.status === "REVERSED" ? "text-muted line-through" : ""}`}>{soles(p.amount)}</span>
          {libre > 0.004 && <div className="text-[11.5px] text-warn">sin aplicar {soles(libre)}</div>}
          {n(p.to_balance) > 0 && <div className="text-[11.5px] text-muted">{soles(p.to_balance)} a favor</div>}</div>
      );
    } },
    { key: "status", header: "Estado", render: (p) => <StatusBadge status={p.status} labels={ESTADO_COBRO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Todos los cobros: los de caja, los del mostrador y los contra entrega. Un cobro no se borra: si se registró mal, se revierte con su motivo."
        actions={<>
          <Button icon={Download} loading={bajando} onClick={exportar}>Exportar</Button>
          {can("caj.payment.register") && puede("CAJ", "C") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/caj/caj-02")}>Registrar cobro</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cobrado vigente" icono={CircleDollarSign} destacada valor={totales ? soles(totales.vigente) : undefined} detalle="Con los filtros elegidos" />
        <Cifra titulo="Cobros" icono={Receipt} valor={totales ? numero(totales.n) : undefined} detalle="Vigentes y revertidos" />
        <Cifra titulo="Por conciliar" icono={Clock} tono={totales && totales.por_conciliar > 0 ? "warn" : undefined} valor={totales ? soles(totales.por_conciliar) : undefined} detalle="Falta verlo en el banco o el abono" />
        <Cifra titulo="Revertidos" icono={Undo2} valor={totales ? numero(totales.revertidos) : undefined} detalle="Con su motivo" />
      </div>
      {!f.desde && !f.hasta && <p className="text-[12.5px] text-muted">Se ven los últimos 30 días. Elige las fechas para ver otros.</p>}
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(p) => setAbierto(p.id)} empty="No hay cobros con estos filtros."
        search={{ ...lista.tabla.search, placeholder: "Cobro, operación, cliente o ticket…" }}
        toolbar={<>
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => poner("desde", v)} ancho={150} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => poner("hasta", v)} ancho={150} />
          <FiltroSelect etiqueta="Medio" value={f.medio} onChange={(v) => poner("medio", v)} options={(op?.medios ?? []).map((m) => ({ value: m.code, label: m.name }))} ancho={170} />
          <FiltroSelect etiqueta="Cuenta" todos="todas" value={f.cuenta} onChange={(v) => poner("cuenta", v)} options={(op?.cuentas ?? []).map((c) => ({ value: c.id, label: c.name }))} ancho={190} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => poner("estado", v)} options={Object.entries(ESTADO_COBRO).map(([value, [label]]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Conciliación" todos="todas" value={f.conciliacion} onChange={(v) => poner("conciliacion", v)} options={Object.entries(CONCILIACION).map(([value, [label]]) => ({ value, label }))} ancho={180} />
          <FiltroSelect etiqueta="Origen" value={f.origen} onChange={(v) => poner("origen", v)} options={["CAJ", "POS", "DEL"].map((value) => ({ value, label: ORIGEN_COBRO[value] }))} />
          {(op?.cobradores.length ?? 0) > 0 && (
            <FiltroSelect etiqueta="Cobrado por" value={f.cobrado_por} onChange={(v) => poner("cobrado_por", v)} options={(op?.cobradores ?? []).map((u) => ({ value: u.id, label: u.name }))} ancho={180} />
          )}
        </>} />
      {lista.total > 0 && <div className="flex justify-end"><Badge tone="neutral">{numero(lista.total)} cobros</Badge></div>}
      {abierto && <DetalleCobro id={abierto} onClose={cerrar} onCambio={recargar} />}
    </div>
  );
}
