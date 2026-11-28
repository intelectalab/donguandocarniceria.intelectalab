"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, KeyRound, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, DetailList, PageHeader, Tabs, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles, numero } from "@/lib/formato";
import { ConsolaApi, TONO_ESTADO, type OperacionDoc } from "@/modulos/api/comun";

type ClaveTest = { id: string; name: string; prefix: string; expires_at: string; status: string; estado: string; scopes: string[] };
type PedidoSbx = {
  number: string; status: string; brand: string; channel: string; customer: { id: string; name: string };
  external_ref: string | null; estimated_total: number; created_at: string; api_key: string | null;
};
type DocSbx = {
  full_number: string; doc_type: string; issue_date: string; customer: { name: string; doc_number: string };
  total: number; ose: string; cdr_code: string; sent_to_sunat: boolean; sunat_status: string;
};
type MsgSbx = { at: string; to: string; template: string; ref: string; note: string };
type ClienteSbx = { id: string; name: string; doc_type: string; doc_number: string; addresses: { id: string; address_line: string }[] };
type ProdSbx = { sku: string; name: string; price: number; basis: string; stock: number };

type SandboxPanel = {
  id: string;
  paired_tenant: string;
  status: string;
  estado: string;
  ose_provider: string;
  messaging_provider: string;
  payments_provider: string;
  host: string;
  last_reset_at: string;
  next_reset_at: string;
  reset_count: number;
  reset_by_name: string;
  dias_reinicio: number;
  claves: ClaveTest[];
  cifras: { claves_activas: number; claves_total: number; pedidos: number; comprobantes: number; mensajes: number; clientes: number; productos: number };
  orders: PedidoSbx[];
  documents: DocSbx[];
  messages: MsgSbx[];
  customers: ClienteSbx[];
  products: ProdSbx[];
  ejemplo_pedido: Record<string, unknown>;
  puede_reiniciar: boolean;
};

/** API-09 Sandbox: entorno de pruebas emparejado para las claves ak_test_, con OSE y mensajería FAKE, reinicio y consola. */
export default function SandboxDeLaApi() {
  const [sbx, setSbx] = useState<SandboxPanel | null>(null);
  const [ops, setOps] = useState<OperacionDoc[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("orders");
  const [reiniciando, setReiniciando] = useState(false);

  const cargar = () => {
    api<SandboxPanel>("/v1/api/sandbox").then((r) => { setSbx(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  };

  useEffect(() => {
    cargar();
    api<{ operaciones: OperacionDoc[] }>("/v1/api/documentacion").then((r) => setOps(r.operaciones)).catch(() => {});
  }, []);

  async function reiniciar() {
    const ok = await confirmAction({
      title: "Reiniciar el sandbox",
      message: "Se borran los pedidos, comprobantes y clientes creados en pruebas y se restauran los datos de demostración. Las claves de prueba siguen vigentes.",
      confirmLabel: "Reiniciar sandbox",
      danger: true,
    });
    if (!ok) return;
    setReiniciando(true);
    try {
      const r = await api<SandboxPanel>("/v1/api/sandbox/reiniciar", { method: "POST" });
      setSbx(r);
      toast.ok("Sandbox reiniciado con datos de demostración");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setReiniciando(false);
    }
  }

  const colClaves: Column<ClaveTest>[] = [
    { key: "name", header: "Nombre", cardTitle: true, render: (k) => <Link href={`/m/api/api-03?id=${k.id}`} className="font-semibold text-ink hover:text-primary">{k.name}</Link> },
    { key: "prefix", header: "Prefijo", render: (k) => <span className="font-mono text-[12px] text-muted">{k.prefix}…</span> },
    { key: "expires_at", header: "Vence", render: (k) => fecha(k.expires_at) },
    { key: "status", header: "Estado", render: (k) => <Badge tone={TONO_ESTADO[k.status]}>{k.estado}</Badge> },
  ];

  const colPedidos: Column<PedidoSbx>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (o) => <span className="font-mono font-semibold text-ink">{o.number}</span> },
    { key: "created_at", header: "Creado", render: (o) => fechaHora(o.created_at) },
    { key: "customer", header: "Cliente", render: (o) => o.customer?.name || "—" },
    { key: "external_ref", header: "Ref. externa", render: (o) => <span className="font-mono text-[12px] text-muted">{o.external_ref || "—"}</span> },
    { key: "estimated_total", header: "Total", align: "right", render: (o) => soles(o.estimated_total) },
    { key: "api_key", header: "Clave", render: (o) => <span className="font-mono text-[12px] text-muted">{o.api_key || "demostración"}</span> },
    {
      key: "status", header: "Estado",
      render: (o) => (
        <Badge tone={o.status === "DELIVERED" ? "ok" : o.status === "CANCELLED" ? "bad" : o.status === "IN_ROUTE" ? "warn" : "info"}>
          {o.status}
        </Badge>
      ),
    },
  ];

  const colDocs: Column<DocSbx>[] = [
    { key: "full_number", header: "Número", cardTitle: true, render: (d) => <span className="font-mono font-semibold text-ink">{d.full_number}</span> },
    { key: "issue_date", header: "Fecha", render: (d) => fecha(d.issue_date) },
    { key: "customer", header: "Cliente", render: (d) => d.customer?.name || "—" },
    { key: "total", header: "Total", align: "right", render: (d) => soles(d.total) },
    { key: "ose", header: "OSE", render: (d) => <Badge tone="info">{d.ose} · CDR {d.cdr_code}</Badge> },
    { key: "sent_to_sunat", header: "SUNAT", render: (d) => d.sent_to_sunat ? "Enviado" : <Badge tone="neutral">No se envía</Badge> },
    { key: "sunat_status", header: "Estado", render: (d) => <Badge tone="ok">{d.sunat_status}</Badge> },
  ];

  const colMsgs: Column<MsgSbx>[] = [
    { key: "at", header: "Fecha", render: (m) => fechaHora(m.at) },
    { key: "to", header: "Para", render: (m) => <span className="font-mono text-[12px]">{m.to}</span> },
    { key: "template", header: "Plantilla", render: (m) => <span className="font-mono text-[12px]">{m.template}</span> },
    { key: "ref", header: "Pedido", render: (m) => <span className="font-mono text-[12px] font-semibold">{m.ref}</span> },
    { key: "note", header: "Proveedor", render: (m) => m.note },
  ];

  const colClientes: Column<ClienteSbx>[] = [
    { key: "id", header: "ID", render: (c) => <span className="font-mono text-[12px] font-semibold">{c.id}</span> },
    { key: "name", header: "Nombre", cardTitle: true, render: (c) => c.name },
    { key: "doc_number", header: "Documento", render: (c) => <span className="font-mono text-[12px]">{c.doc_type} {c.doc_number}</span> },
    { key: "addresses", header: "Direcciones", render: (c) => <span className="font-mono text-[12px] text-muted">{c.addresses.map((a) => a.id).join(", ") || "—"}</span> },
  ];

  const colProductos: Column<ProdSbx>[] = [
    { key: "sku", header: "SKU", cardTitle: true, render: (p) => <span className="font-mono text-[12px] font-semibold">{p.sku}</span> },
    { key: "name", header: "Producto", render: (p) => p.name },
    { key: "price", header: "Precio", align: "right", render: (p) => `${soles(p.price)}${p.basis === "KG" ? "/kg" : ""}` },
    { key: "stock", header: "Stock", align: "right", render: (p) => numero(p.stock) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Entorno de pruebas emparejado: las claves ak_test_ operan solo aquí, con datos de demostración; los comprobantes van al OSE FAKE (sin tocar SUNAT) y los mensajes al proveedor FAKE."
        actions={
          sbx && (
            <Button variant="danger" icon={RotateCcw} loading={reiniciando} disabled={!sbx.puede_reiniciar} onClick={reiniciar}>
              Reiniciar sandbox
            </Button>
          )
        }
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {sbx && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Cifra titulo="Estado" valor={sbx.estado} icono={CheckCircle2} tono="ok" destacada detalle={`empresa ${sbx.paired_tenant}`} />
            <Cifra titulo="Último reinicio" valor={fecha(sbx.last_reset_at)} icono={RotateCcw} detalle={`${numero(sbx.reset_count)} reinicio(s) · por ${sbx.reset_by_name}`} />
            <Cifra titulo="Próximo reinicio automático" valor={fecha(sbx.next_reset_at)} icono={CalendarClock} detalle={`cada ${sbx.dias_reinicio} días`} />
            <Cifra titulo="Claves de prueba activas" valor={`${numero(sbx.cifras.claves_activas)} de ${numero(sbx.cifras.claves_total)}`} icono={KeyRound} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">Proveedores del sandbox</h2>
              <DetailList
                items={[
                  { label: "Comprobantes", value: "OSE FAKE · acepta al instante, nunca llega a SUNAT" },
                  { label: "Mensajería", value: `Proveedor FAKE · ${numero(sbx.cifras.mensajes)} mensaje(s) simulados, ninguno a clientes reales` },
                  { label: "Pagos", value: "Pasarela FAKE" },
                  { label: "Host", value: <span className="font-mono text-[12.5px]">{sbx.host}</span> },
                  {
                    label: "Datos de demostración",
                    value: `${sbx.cifras.clientes} clientes · ${sbx.cifras.productos} productos · ${sbx.cifras.pedidos} pedidos · ${sbx.cifras.comprobantes} comprobantes`,
                  },
                ]}
              />
            </section>

            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-ink">Claves de prueba</h2>
                <Link href="/m/api/api-02" className="text-[12.5px] font-semibold text-primary hover:underline">Crear clave de prueba</Link>
              </div>
              <DataTable
                rowKey={(k) => k.id}
                columns={colClaves}
                rows={sbx.claves}
                empty="Sin claves de prueba: créalas en Crear clave con entorno Pruebas."
              />
            </section>
          </div>

          <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "orders", label: "Pedidos", count: sbx.orders.length },
                { key: "docs", label: "Comprobantes", count: sbx.documents.length },
                { key: "msgs", label: "Mensajes FAKE", count: sbx.messages.length },
                { key: "data", label: "Clientes y productos" },
              ]}
            />
            {tab === "orders" && <DataTable rowKey={(o) => o.number} columns={colPedidos} rows={sbx.orders} empty="Sin pedidos en el sandbox." />}
            {tab === "docs" && <DataTable rowKey={(d) => d.full_number} columns={colDocs} rows={sbx.documents} empty="Sin comprobantes en el sandbox." />}
            {tab === "msgs" && <DataTable rowKey={(m) => `${m.ref}-${m.at}`} columns={colMsgs} rows={sbx.messages} empty="Sin mensajes: se generan al crear pedidos en el sandbox." />}
            {tab === "data" && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">Clientes de prueba</h3>
                  <DataTable rowKey={(c) => c.id} columns={colClientes} rows={sbx.customers} />
                </div>
                <div className="grid gap-2">
                  <h3 className="text-[13px] font-semibold text-ink">Productos de prueba</h3>
                  <DataTable rowKey={(p) => p.sku} columns={colProductos} rows={sbx.products} />
                </div>
              </div>
            )}
          </section>

          {ops.length > 0 && (
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">Probar en el sandbox</h2>
              <ConsolaApi
                claves={sbx.claves.map((k) => ({ ...k, environment: "TEST" }))}
                operaciones={ops}
                entornoFijo="TEST"
                ejemploPedido={sbx.ejemplo_pedido}
                onLlamada={cargar}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
