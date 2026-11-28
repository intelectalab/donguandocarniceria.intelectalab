"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { Vacio } from "@/modulos/pos/Seccion";
import { Tickets } from "@/modulos/pos/Ticket";
import { SUNAT, TIPOS_DOC, type Comprobante, type FilaVenta } from "@/modulos/pos/tipos";

/** POS-05 Comprobante: boleta o factura del mostrador para imprimir (80 mm) o enviar por WhatsApp o correo. */
export default function ComprobantePos() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const id = sp.get("id") ?? "";
  const ticket = sp.get("ticket") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader code="POS-05" description="Boleta o factura con la serie de la caja y el logo de la marca. Imprime en la ticketera de 80 mm o envíala por WhatsApp o correo." />
      {id || ticket ? <Ver key={id || ticket} id={id} ticket={ticket} /> : <Elegir />}
    </div>
  );
}

function Ver({ id, ticket }: { id: string; ticket: string }) {
  const router = useRouter();
  const [lista, setLista] = useState<Comprobante[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vigente = true;
    const pedido = id ? api<Comprobante>(`/v1/pos/comprobantes/${id}`).then((c) => [c]) : api<Comprobante[]>(`/v1/pos/tickets/${encodeURIComponent(ticket)}`);
    pedido.then((r) => vigente && setLista(r)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id, ticket]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-05")}>Otro comprobante</Button>
      {error && <Alert tone="bad">{error}</Alert>}
      {!lista && !error && <Vacio>Cargando el comprobante…</Vacio>}
      {lista && <Tickets lista={lista} onCambio={(c) => setLista((l) => l?.map((x) => (x.documento.id === c.documento.id ? c : x)) ?? null)} />}
    </div>
  );
}

function Elegir() {
  const router = useRouter();
  const [filas, setFilas] = useState<FilaVenta[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    let vigente = true;
    api<{ filas: FilaVenta[] }>("/v1/pos/ventas").then((r) => vigente && setFilas(r.filas)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, []);

  const t = q.trim().toLowerCase();
  const vistas = (filas ?? []).filter((f) => !t || [f.full_number, f.pos_ticket, f.customer_name].some((x) => x?.toLowerCase().includes(t)));
  const columnas: Column<FilaVenta>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (f) => <div><div className="font-medium">{f.full_number}</div><div className="text-[12px] text-muted">{TIPOS_DOC[f.doc_type] ?? f.doc_type} · {f.pos_ticket ?? "—"}</div></div> },
    { key: "customer_name", header: "Cliente" },
    { key: "issued_at", header: "Hora", render: (f) => fechaHora(f.issued_at) },
    { key: "total", header: "Total", align: "right", render: (f) => soles(f.total) },
    { key: "sunat_status", header: "SUNAT", render: (f) => <StatusBadge status={f.sunat_status} labels={SUNAT} /> },
  ];
  return (
    <DataTable rows={vistas} columns={columnas} loading={!filas && !error} error={error}
      search={{ value: q, onChange: setQ, placeholder: "Número, ticket o cliente…" }}
      onRowClick={(f) => router.push(`/m/pos/pos-05?id=${f.id}`)}
      empty="No hay comprobantes en tu turno. Para otro turno, búscalo en Ventas del turno." />
  );
}
