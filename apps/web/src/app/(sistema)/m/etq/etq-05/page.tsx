"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Siren } from "lucide-react";
import { Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { fechaHora, kg, porcentaje } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Avance, ESTADO_RETIRO, FiltroSelect, RIESGO, useOpcionesEtq } from "@/modulos/etq/comunes";
import { opcionesDe } from "@/modulos/pro/tipos";

type Retiro = { id: string; number: string; reason: string; risk_class: string; status: string; initiated_at: string; closed_at: string | null; include_descendants: boolean;
  initiated_by_name: string | null; lot_codes: string | null; lots: number; customers: number; contacts: number; contacts_done: number; sold_kg: string; recovered_kg: string };

/** ETQ-05 Retiros de lote: estado, lotes, clientes afectados y avance del contacto. */
export default function Retiros() {
  const router = useRouter();
  const op = useOpcionesEtq();
  const [estado, setEstado] = useState("");
  const lista = useListado<Retiro>("/v1/etq/retiros", { orden: "-initiated_at", filtros: { status: estado } });
  const columnas: Column<Retiro>[] = [
    { key: "number", header: "Número", sortable: true, render: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.number}</span> },
    { key: "reason", header: "Motivo", cardTitle: true, render: (r) => <div className="min-w-[220px]"><p className="line-clamp-2">{r.reason}</p><p className="text-[12px] text-muted">{RIESGO[r.risk_class] ?? r.risk_class}</p></div> },
    { key: "lot_codes", header: "Lotes", render: (r) => <span className="font-mono text-[12.5px]">{r.lot_codes ?? "—"}</span> },
    { key: "initiated_at", header: "Iniciado", sortable: true, render: (r) => <span className="whitespace-nowrap">{fechaHora(r.initiated_at)}<span className="block text-[12px] text-muted">{r.initiated_by_name ?? ""}</span></span> },
    { key: "customers", header: "Contacto", sortable: true, render: (r) => <Avance hechos={r.contacts_done} total={r.contacts} /> },
    { key: "recovered_kg", header: "Recuperado", align: "right", hideOnMobile: true, render: (r) => <span>{kg(r.recovered_kg)}<span className="block text-[12px] text-muted">de {kg(r.sold_kg)} ({Number(r.sold_kg) ? porcentaje(Number(r.recovered_kg) / Number(r.sold_kg) * 100, 0) : "—"})</span></span> },
    { key: "status", header: "Estado", render: (r) => <StatusBadge status={r.status} labels={ESTADO_RETIRO} /> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Un retiro bloquea el stock de los lotes y arma la lista de clientes que compraron. Se cierra cuando todos tienen su resultado de contacto."
        actions={op?.can.start_recall && <Button variant="danger" icon={Siren} onClick={() => router.push("/m/etq/etq-06")}>Nuevo retiro</Button>} />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(r) => router.push(`/m/etq/etq-07?id=${r.id}`)} search={{ ...lista.tabla.search, placeholder: "Buscar número, motivo o lote…" }}
        empty="No hay retiros." toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_RETIRO)} />} />
    </div>
  );
}

