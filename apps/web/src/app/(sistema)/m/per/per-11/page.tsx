"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Modal, PageHeader, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroMes, OCULTO, Vacio, useDatos, useOpciones } from "@/modulos/per/comunes";
import { ESTADO_PAGO, hora, inicioMes, hoyLima } from "@/modulos/per/tipos";

type Persona = { employee_id: string; trabajador: string; cobros: number; entregas: number; base: number | null; comision: number | null; reversos: number | null; neta: number | null; bonos: number | null; total: number | null; pago: string | null };
type Linea = { id: string; source_type: string; plan: string; plan_type: string; pedido: string | null; cobro: string | null; marca: string | null; earned_at: string; base: number | null; rate_pct: number | null; amount: number | null; reason: string | null };
type Periodo = { periodo: string; nombre: string; cierre: string; cerrado: boolean; abierto: string; personas: Persona[]; detalle: Linea[];
  resumen: { comision: number; reversos: number; neta: number; base: number; bonos: number; entregas: number; n: number; kpi_pct: number | null } };

const s = (v: number | null) => (v === null ? OCULTO : soles(v));

/** PER-11 Comisiones y bonos del período: por cobro asignado o entrega, con reversos, totales por persona y estado de cierre (RN-PER-10 a 13). */
export default function ComisionesPeriodo() {
  const { datos: op } = useOpciones();
  const [mes, setMes] = useState(inicioMes(hoyLima()));
  const [persona, setPersona] = useState<Persona | null>(null);
  const [procesando, setProcesando] = useState(false);
  const { datos, error, cargando, recargar } = useDatos<Periodo>(`/v1/per/comisiones?mes=${mes}`);
  if (error) return <ErrorCarga error={error} que="Cada vendedora y repartidor ve lo suyo; RR. HH. ve todo." />;
  const r = datos?.resumen;
  async function procesar() {
    setProcesando(true);
    try {
      const x = await api<{ comisiones: number; reversos: number; bonos: number }>("/v1/per/comisiones/procesar", { method: "POST" });
      toast.ok(`Procesado: ${x.comisiones} comisiones, ${x.reversos} reversos y ${x.bonos} bonos nuevos.`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setProcesando(false);
    }
  }
  const columnas: Column<Persona>[] = [
    { key: "trabajador", header: "Persona", cardTitle: true, render: (p) => <span className="font-medium">{p.trabajador}</span> },
    { key: "cobros", header: "Cobros / entregas", render: (p) => [p.cobros ? `${p.cobros} cobros` : "", p.entregas ? `${p.entregas} entregas` : ""].filter(Boolean).join(" · ") || "—" },
    { key: "base", header: "Cobrado sin IGV", align: "right", hideOnMobile: true, render: (p) => p.cobros ? s(p.base) : "—" },
    { key: "comision", header: "Comisión", align: "right", render: (p) => p.cobros ? s(p.comision) : "—" },
    { key: "reversos", header: "Reversos", align: "right", render: (p) => p.reversos ? <span className="text-bad">{s(p.reversos)}</span> : "—" },
    { key: "bonos", header: "Bonos", align: "right", render: (p) => p.entregas ? s(p.bonos) : "—" },
    { key: "total", header: "Total", align: "right", render: (p) => <span className="font-semibold">{s(p.total)}</span> },
    { key: "pago", header: "Pago", render: (p) => p.pago ? <Estado s={p.pago} labels={ESTADO_PAGO} /> : <span className="text-muted">—</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Cada cobro confirmado de un pedido asignado a la vendedora genera su comisión (una sola vez por cobro) y cada pedido entregado el bono del repartidor. Si un cobro se anula, el reverso entra en el período abierto."
        actions={op?.permisos.comisiones && <Button icon={RefreshCw} loading={procesando} onClick={procesar}>Procesar cobros y entregas</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <FiltroMes value={mes} onChange={setMes} etiqueta="Período" />
        {datos && (datos.cerrado ? <Badge tone="neutral">Cerrado el {fecha(datos.cierre)}</Badge> : <Badge tone="ok">Abierto · cierra el {fecha(datos.cierre)}</Badge>)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Comisión neta" valor={r ? soles(r.neta) : undefined} detalle={r ? `${r.n} registros${r.kpi_pct !== null ? ` · ${numero(r.kpi_pct, 2)} % de lo cobrado` : ""}` : ""} destacada />
        <Cifra titulo="Cobrado sin IGV" valor={r ? soles(r.base) : undefined} />
        <Cifra titulo="Reversos" valor={r ? soles(r.reversos) : undefined} tono={r?.reversos ? "bad" : undefined} />
        <Cifra titulo="Bonos por entrega" valor={r ? soles(r.bonos) : undefined} detalle={r ? `${r.entregas} entregas` : ""} />
      </div>
      <DataTable rows={datos?.personas ?? []} rowKey={(p) => p.employee_id} columns={columnas} loading={cargando} onRowClick={setPersona}
        empty={<Vacio>{datos?.nombre ? `Sin comisiones ni bonos en ${datos.nombre}.` : "Sin datos."}</Vacio>} />
      {persona && <Detalle mes={mes} persona={persona} onClose={() => setPersona(null)} />}
    </div>
  );
}

function Detalle({ mes, persona, onClose }: { mes: string; persona: Persona; onClose: () => void }) {
  const { datos, error } = useDatos<Periodo>(`/v1/per/comisiones?mes=${mes}&trabajador=${persona.employee_id}`);
  const columnas: Column<Linea>[] = [
    { key: "earned_at", header: "Fecha", render: (l) => `${fecha(l.earned_at)} ${hora(l.earned_at)}` },
    { key: "pedido", header: "Pedido / cobro", cardTitle: true, render: (l) => <span className="flex flex-col"><span className="font-medium">{l.pedido ?? "—"}</span><span className="text-[12px] text-muted">{l.cobro ?? l.plan}{l.marca ? ` · ${l.marca}` : ""}</span></span> },
    { key: "base", header: "Base", align: "right", render: (l) => l.base === null ? (l.plan_type === "DRIVER_DELIVERY" ? "—" : OCULTO) : soles(l.base) },
    { key: "rate_pct", header: "%", align: "right", hideOnMobile: true, render: (l) => l.rate_pct === null ? "—" : `${numero(l.rate_pct, 2)} %` },
    { key: "amount", header: "Monto", align: "right", render: (l) => <span className={(l.amount ?? 0) < 0 ? "text-bad" : ""}>{s(l.amount)}{l.reason && <span className="block text-[11.5px] text-muted">{l.reason}</span>}</span> },
  ];
  return (
    <Modal open onClose={onClose} size="xl" title={persona.trabajador} description={`${datos?.nombre ?? ""} · total ${s(persona.total)}`}>
      {error ? <Alert tone="bad">{error}</Alert> : <DataTable rows={datos?.detalle ?? []} columns={columnas} loading={!datos} empty={<Vacio>Sin detalle.</Vacio>} />}
    </Modal>
  );
}
