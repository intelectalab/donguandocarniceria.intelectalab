"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, DataTable, FiltroSelect, PageHeader, type Column } from "@/components/ui";
import { soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { ERRORES, FichaBandeja } from "@/modulos/web/FichaBandeja";
import { cuando } from "@/modulos/web/comunes";

type Fila = { id: string; external_order_id: string; received_at: string; tienda: string; customer_name: string | null; total: number; status: string; error_code: string | null; warning_code: string | null; attempts: number };
/** WEB-05 Resolver error: qué falló en un pedido web y la acción que lo arregla; después se reprocesa (sin duplicar, RN-WEB-02). */
export default function Resolver() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id");
  return id ? <FichaBandeja key={id} id={id} /> : <Pendientes />;
}

function Pendientes() {
  const router = useRouter();
  const [que, setQue] = useState("ERROR");
  const lista = useListado<Fila>("/v1/web/bandeja", { filtros: que === "PIN" ? { sin_pin: "1" } : { estado: "ERROR" } });
  const columnas: Column<Fila>[] = [
    { key: "external_order_id", header: "Pedido web", cardTitle: true, render: (b) => (
      <div className="min-w-0"><div className="font-medium">#{b.external_order_id}</div><div className="text-[12px] text-muted">{cuando(b.received_at)} · {b.tienda}</div></div>
    ) },
    { key: "customer_name", header: "Cliente", render: (b) => <span className="truncate">{b.customer_name ?? "—"}</span> },
    { key: "total", header: "Total", align: "right", render: (b) => <span className="tabular-nums">{soles(b.total)}</span> },
    { key: "error_code", header: "Qué falta", render: (b) => (
      <div className="flex flex-wrap gap-1">
        {b.error_code && <Badge tone="bad">{ERRORES[b.error_code] ?? b.error_code}</Badge>}
        {b.warning_code === "ADDRESS_NO_PIN" && <Badge tone="warn">Sin pin</Badge>}
      </div>
    ) },
    { key: "attempts", header: "Intentos", align: "right", hideOnMobile: true, render: (b) => <span className="tabular-nums">{b.attempts}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader description="Los pedidos web que no crearon su pedido (o que lo dejaron en borrador por falta de pin). Abre uno para ver qué falló y arreglarlo." />
      <DataTable {...lista.tabla} columns={columnas} onRowClick={(b) => router.push(`/m/web/web-05?id=${b.id}`)}
        empty={que === "PIN" ? "No hay pedidos web esperando el pin." : "No hay pedidos web con error. Todo entró solo."}
        search={{ ...lista.tabla.search, placeholder: "N.º de pedido o cliente…" }}
        toolbar={<FiltroSelect etiqueta="Ver" vacio="Con error" value={que === "ERROR" ? "" : que} onChange={(v) => setQue(v || "ERROR")} options={[{ value: "PIN", label: "Sin pin" }]} />} />
    </div>
  );
}

