"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Copy, GitMerge, ScanSearch, XCircle } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, StatusBadge, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ESTADOS_DUPLICADO, celular, type Duplicado } from "@/modulos/cli/tipos";

type Vista = "OPEN" | "DONE" | "ALL";
type Resumen = { abiertos: number; fusionados: number; descartados: number; fusiones: number };

/** CLI-10 Duplicados: pares de posibles duplicados con su motivo y puntaje, para fusionarlos o descartarlos con motivo (RN-CLI-07). */
export default function Duplicados() {
  const router = useRouter();
  const { can } = useSesion();
  const puede = can("cli.customer.merge");
  const [vista, setVista] = useState<Vista>("OPEN");
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [version, setVersion] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const lista = useListado<Duplicado>("/v1/cli/duplicados", { orden: "-score", filtros: { vista } });

  useEffect(() => {
    let vigente = true;
    api<Resumen>("/v1/cli/duplicados/resumen").then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => { lista.recargar(); setVersion((n) => n + 1); };

  async function buscar() {
    setBuscando(true);
    try {
      const r = await api<{ nuevos: number }>("/v1/cli/duplicados/buscar", { method: "POST" });
      toast.ok(r.nuevos ? `Se encontraron ${r.nuevos} par(es) nuevos.` : "No hay duplicados nuevos.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }

  async function descartar(d: Duplicado) {
    const r = await confirmAction({ title: "¿No son el mismo cliente?", message: `${d.cliente_nombre} y ${d.original_nombre} quedan como clientes distintos y el par no vuelve a aparecer.`,
      confirmLabel: "Descartar", reason: { label: "Motivo (por ejemplo: hermanos que comparten celular)", min: 5 } });
    if (!r) return;
    try {
      await api(`/v1/cli/duplicados/${d.id}/descartar`, { method: "POST", body: { nota: r.reason } });
      toast.ok("Par descartado");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const lado = (nombre: string, phone: string | null, wa: string | null, pedidos: number, id: string) => (
    <div className="min-w-0">
      <Link href={`/m/cli/cli-02?id=${id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-primary">{nombre}</Link>
      <div className="text-[12px] text-muted"><span className="font-mono">{celular(phone)}</span> · {numero(pedidos)} pedido(s){wa ? ` · WA ${wa}` : ""}</div>
    </div>
  );

  const columnas: Column<Duplicado>[] = [
    { key: "cliente", header: "Cliente nuevo", cardTitle: true, render: (d) => lado(d.cliente_nombre, d.cliente_phone, d.cliente_wa, d.cliente_pedidos, d.customer_id) },
    { key: "original", header: "Parece ser", render: (d) => lado(d.original_nombre, d.original_phone, d.original_wa, d.original_pedidos, d.duplicate_of_id) },
    { key: "match_reason", header: "Motivo", sortable: true, render: (d) => <Badge tone="warn">{d.motivo}</Badge> },
    { key: "score", header: "Puntaje", sortable: true, align: "right", render: (d) => <span className="font-mono">{numero(d.score, 2)}</span> },
    {
      key: "status", header: "Estado", hideOnMobile: vista === "OPEN",
      render: (d) => <div><StatusBadge status={d.status} labels={ESTADOS_DUPLICADO} />{d.resolution_note && <div className="mt-1 text-[12px] text-muted">{d.resolution_note}</div>}</div>,
    },
    { key: "created_at", header: "Detectado", sortable: true, hideOnMobile: true, render: (d) => d.resolved_at ? <div><div>{fechaHora(d.created_at)}</div><div className="text-[12px] text-muted">Resuelto {fechaHora(d.resolved_at)}{d.resuelto_por ? ` · ${d.resuelto_por}` : ""}</div></div> : fechaHora(d.created_at) },
    {
      key: "acciones", header: "", align: "right",
      render: (d) => d.status === "OPEN" && puede ? (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="primary" icon={GitMerge} onClick={(e) => { e.stopPropagation(); router.push(`/m/cli/cli-11?a=${d.duplicate_of_id}&b=${d.customer_id}`); }}>Fusionar</Button>
          <Button size="sm" variant="ghost" icon={XCircle} onClick={(e) => { e.stopPropagation(); descartar(d); }}>Descartar</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Posibles duplicados por celular, documento, correo o nombre parecido. Fusiónalos si son la misma persona o descártalos con el motivo."
        actions={puede && <Button icon={ScanSearch} loading={buscando} onClick={buscar}>Buscar en toda la base</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por revisar" icono={Copy} destacada valor={resumen ? numero(resumen.abiertos) : undefined} tono={resumen?.abiertos ? "warn" : "ok"} detalle="Pares abiertos" />
        <Cifra titulo="Fusionados" icono={GitMerge} valor={resumen ? numero(resumen.fusionados) : undefined} detalle="Pares resueltos con fusión" />
        <Cifra titulo="Descartados" icono={XCircle} valor={resumen ? numero(resumen.descartados) : undefined} detalle="No eran la misma persona" />
        <button type="button" onClick={() => router.push("/m/cli/cli-11")} className="h-full cursor-pointer text-left [&>div]:h-full">
          <Cifra titulo="Fusiones registradas" icono={CheckCircle2} valor={resumen ? numero(resumen.fusiones) : undefined} detalle="Ver el historial" />
        </button>
      </div>

      <Tabs value={vista} onChange={setVista} tabs={[
        { key: "OPEN", label: "Por revisar", count: resumen?.abiertos }, { key: "DONE", label: "Resueltos" }, { key: "ALL", label: "Todos" },
      ]} />
      <DataTable {...lista.tabla} search={undefined} columns={columnas}
        onRowClick={(d) => d.status === "OPEN" && puede && router.push(`/m/cli/cli-11?a=${d.duplicate_of_id}&b=${d.customer_id}`)}
        empty={vista === "OPEN" ? "No hay duplicados por revisar." : "No hay pares con ese filtro."} />
    </div>
  );
}
