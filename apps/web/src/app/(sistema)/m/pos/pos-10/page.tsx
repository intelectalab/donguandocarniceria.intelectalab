"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Printer, Receipt, RefreshCw, Undo2 } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, IconButton, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { SUNAT, TIPOS_DOC, ESTADOS_TURNO, type FilaVenta } from "@/modulos/pos/tipos";

type Respuesta = {
  turno: { id: string; number: string; status: string; cashier_name: string; opened_at: string } | null;
  turnos: { id: string; number: string; status: string; cashier_name: string; opened_at: string; caja: string }[];
  filas: FilaVenta[];
  cifras: { tickets: number; ventas: number; promedio: number; notas: number; pendientes: number } | null;
};

/** POS-10 Ventas del turno: tickets con medio, comprobante y estado SUNAT; reimpresión y reintento al OSE. */
export default function VentasDelTurno() {
  const router = useRouter();
  const [turno, setTurno] = useState("");
  const [version, setVersion] = useState(0);
  const [datos, setDatos] = useState<{ clave: string; r?: Respuesta; error?: string } | null>(null);
  const [q, setQ] = useState("");
  const [reintentando, setReintentando] = useState("");
  const clave = `${turno}|${version}`;

  useEffect(() => {
    let vigente = true;
    const [id] = clave.split("|");
    api<Respuesta>(`/v1/pos/ventas${id ? `?shift_id=${id}` : ""}`)
      .then((r) => vigente && setDatos({ clave, r }))
      .catch((e) => vigente && setDatos({ clave, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [clave]);

  const actual = datos?.clave === clave ? datos : null;
  const r = actual?.r ?? datos?.r;
  const t = q.trim().toLowerCase();
  const filas = (r?.filas ?? []).filter((f) => !t || [f.full_number, f.pos_ticket, f.customer_name, f.medio].some((x) => x?.toLowerCase().includes(t)));

  async function reintentar(f: FilaVenta) {
    setReintentando(f.id);
    try {
      const c = await api<{ documento: { sunat_status: string } }>(`/v1/pos/comprobantes/${f.id}/reenviar`, { method: "POST" });
      toast[c.documento.sunat_status === "ACCEPTED" ? "ok" : "info"](c.documento.sunat_status === "ACCEPTED" ? `${f.full_number} aceptado por el OSE.` : `${f.full_number} sigue en la cola de reintento.`);
      setVersion((v) => v + 1);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setReintentando("");
    }
  }

  const columnas: Column<FilaVenta>[] = [
    {
      key: "full_number", header: "Comprobante", cardTitle: true,
      render: (f) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{f.full_number}</span>
            {f.doc_type === "CREDIT_NOTE" && <Badge tone="bad">Nota de crédito</Badge>}
            {f.needs_review && <Badge tone="bad">Revisar</Badge>}
          </div>
          <div className="text-[12px] text-muted">{TIPOS_DOC[f.doc_type] ?? f.doc_type} · {f.pos_ticket ?? "—"} · {f.brand_name}</div>
        </div>
      ),
    },
    { key: "issued_at", header: "Hora", render: (f) => fechaHora(f.issued_at) },
    { key: "customer_name", header: "Cliente", hideOnMobile: true },
    { key: "medio", header: "Medio", render: (f) => f.medio ?? "—" },
    { key: "total", header: "Total", align: "right", render: (f) => <span className={f.doc_type === "CREDIT_NOTE" ? "text-bad" : ""}>{f.doc_type === "CREDIT_NOTE" ? "− " : ""}{soles(f.total)}</span> },
    {
      key: "sunat_status", header: "SUNAT",
      render: (f) => <div><StatusBadge status={f.sunat_status} labels={SUNAT} />{f.sunat_status === "PENDING" && <div className="text-[11.5px] text-muted">intento {numero(f.send_attempts)}</div>}</div>,
    },
    {
      key: "acciones", header: "", align: "right",
      render: (f) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {f.sunat_status === "PENDING" && <IconButton icon={RefreshCw} label="Reintentar envío al OSE" disabled={reintentando === f.id} onClick={() => reintentar(f)} />}
          <IconButton icon={Printer} label="Reimprimir" onClick={() => router.push(`/m/pos/pos-05?id=${f.id}`)} />
          {f.doc_type !== "CREDIT_NOTE" && <IconButton icon={Undo2} label="Devolución" onClick={() => router.push(`/m/pos/pos-09?id=${f.id}`)} />}
        </div>
      ),
    },
  ];

  const c = r?.cifras;
  return (
    <div className="space-y-4">
      <PageHeader code="POS-10" description="Los tickets del turno con su medio de pago, comprobante y estado en SUNAT. Reimprime o reintenta el envío de los que quedaron en cola." />
      {r && r.turnos.length > 0 && (
        <div className="max-w-[460px]">
          <Field label="Turno">
            <Select value={turno || r.turno?.id || ""} onChange={(e) => setTurno(e.target.value)} placeholder={r.turno ? undefined : "Elige un turno"}
              options={r.turnos.map((x) => ({ value: x.id, label: `${x.number} · ${x.caja} · ${x.cashier_name} · ${ESTADOS_TURNO[x.status]?.[0] ?? x.status}` }))} />
          </Field>
        </div>
      )}
      {actual?.error && <Alert tone="bad">{actual.error}</Alert>}
      {r && !r.turno && <Alert tone="info">No tienes un turno abierto. Elige un turno para ver sus ventas.</Alert>}
      {r?.turno && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Ventas del turno" icono={Receipt} destacada valor={c ? soles(c.ventas) : undefined} detalle={r.turno.number} />
            <Cifra titulo="Tickets" valor={c ? numero(c.tickets) : undefined} detalle={c ? `promedio ${soles(c.promedio)}` : ""} />
            <Cifra titulo="Notas de crédito" valor={c ? soles(c.notas) : undefined} tono={c && c.notas > 0 ? "warn" : undefined} />
            <Cifra titulo="En cola de reintento" icono={AlertTriangle} valor={c ? numero(c.pendientes) : undefined} tono={c ? (c.pendientes ? "warn" : "ok") : undefined} detalle="Comprobantes sin respuesta del OSE" />
          </div>
          <DataTable rows={filas} columns={columnas} loading={!actual} search={{ value: q, onChange: setQ, placeholder: "Número, ticket, cliente o medio…" }}
            onRowClick={(f) => router.push(`/m/pos/pos-05?id=${f.id}`)} empty="Todavía no hay ventas en este turno." />
          {c && c.pendientes > 0 && <Button icon={RefreshCw} onClick={() => setVersion((v) => v + 1)}>Actualizar</Button>}
        </>
      )}
    </div>
  );
}
