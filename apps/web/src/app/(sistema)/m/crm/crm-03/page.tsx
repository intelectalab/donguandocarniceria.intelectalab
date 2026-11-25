"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Lock, ShoppingCart } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { RedEtiqueta, type Resumen } from "@/modulos/crm/conversacion";

type Preparar = {
  conversacion: { id: string; contacto: string };
  origen: { canal: string; canal_nombre: string; numero: string | null; cuenta: string; marca: string; vendedora: string; anuncio: string | null; entrada: string };
  cliente: { id: string; full_name: string; phone: string | null; doc_type: string; doc_number: string | null } | null;
  nuevo: { full_name: string; phone: string; telefono_fijo: boolean } | null;
  direcciones: { id: string; label: string | null; address_line: string; reference: string | null; district: string | null; lat: number | null }[];
  pedidos: { id: string; number: string; status: string; total: number; lineas: number; resumen_enviado: boolean }[];
  puede: boolean;
};

/**
 * CRM-03 Crear pedido desde el chat: un borrador de Pedidos con el cliente, el canal, el número de origen, la marca, la
 * vendedora y el anuncio ya llenos (no se cambian) y la última dirección guardada. Los productos y la entrega se
 * completan en Pedidos; de vuelta en el chat se envía el resumen con el cobro en un solo mensaje.
 */
function CrearPedido() {
  const id = useSearchParams().get("id");
  const { can } = useSesion();
  if (!can("crm.conversation.create_order")) return <Alert tone="warn">Tu rol no crea pedidos desde el chat.</Alert>;
  return id ? <Formulario id={id} /> : <ElegirChat />;
}

function ElegirChat() {
  const router = useRouter();
  const [filas, setFilas] = useState<(Resumen & { ultimo: { texto: string } | null })[] | null>(null);
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ data: (Resumen & { ultimo: { texto: string } | null })[] }>(`/v1/crm/conversaciones?asignada=me&per_page=100${buscar.trim().length >= 2 ? `&buscar=${encodeURIComponent(buscar.trim())}` : ""}`)
        .then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [buscar]);
  const columnas: Column<Resumen & { ultimo: { texto: string } | null }>[] = [
    { key: "contacto", header: "Contacto", cardTitle: true, render: (c) => <div><p className="font-semibold text-ink">{c.contacto}</p><p className="text-[12px] text-muted">{c.numero_cliente}</p></div> },
    { key: "canal", header: "Número", render: (c) => <span className="text-[12.5px]"><RedEtiqueta kind={c.kind} nombre={c.kind_name} /> {c.channel_name}</span> },
    { key: "entrada", header: "Entrada", hideOnMobile: true, render: (c) => <span className="text-[12.5px]">{c.entry_name}{c.ad_code ? ` ${c.ad_code}` : ""}</span> },
    { key: "cliente", header: "", render: (c) => (c.es_cliente ? <Badge tone="ok">Cliente</Badge> : <Badge tone="info">Lead</Badge>) },
  ];
  return (
    <div className="grid gap-5">
      <PageHeader description="Elige el chat desde el que nace el pedido: un pedido pertenece a una sola conversación. Se muestran tus chats abiertos." />
      <DataTable rowKey={(c) => c.id} columns={columnas} rows={filas ?? []} loading={!filas && !error} error={error} onRowClick={(c) => router.push(`/m/crm/crm-03?id=${c.id}`)}
        empty="No tienes chats abiertos." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar contacto o número…" }} />
    </div>
  );
}

function Formulario({ id }: { id: string }) {
  const router = useRouter();
  const [p, setP] = useState<Preparar | null>(null);
  const [error, setError] = useState("");
  const [d, setD] = useState({ full_name: "", phone: "", doc_number: "", address_id: "" });
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(() => {
    api<Preparar>(`/v1/crm/conversaciones/${id}/pedido`).then((r) => {
      setP(r);
      setD((x) => ({ ...x, full_name: r.nuevo?.full_name ?? "", phone: r.nuevo?.phone ?? "", address_id: r.direcciones[0]?.id ?? "" }));
    }).catch((e) => setError(mensajeDe(e)));
  }, [id]);
  useEffect(() => cargar(), [cargar]);

  async function crear() {
    setCreando(true); setError("");
    try {
      const o = await api<{ id: string; number: string; nuevo_cliente: boolean }>(`/v1/crm/conversaciones/${id}/pedido`, { method: "POST", body: { full_name: d.full_name || null, phone: d.phone || null, doc_number: d.doc_number || null, address_id: d.address_id || null } });
      toast.ok(`Pedido ${o.number} creado en borrador${o.nuevo_cliente ? " (cliente nuevo)" : ""}. Complétalo en Pedidos.`);
      router.push(`/m/ped/ped-02?id=${o.id}`);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setCreando(false);
    }
  }

  const o = p?.origen;
  return (
    <div className="grid gap-5">
      <PageHeader description="Se crea un borrador en Pedidos con el origen ya lleno, que no se cambia. Después completas los productos, la entrega y el pago en el formulario de Pedidos y, de vuelta en el chat, envías el resumen con el cobro en un solo mensaje."
        actions={<Link href={`/m/crm/crm-02?id=${id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-surface-2"><ArrowLeft className="size-4" />Volver al chat</Link>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {p && !p.puede && <Alert tone="warn">Solo la vendedora asignada a este chat o la supervisora crean su pedido.</Alert>}
      {p && o && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="grid content-start gap-4">
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Lock className="size-4 text-muted" />Origen del pedido (no se cambia)</h2>
              <DetailList items={[
                { label: "Conversación", value: p.conversacion.contacto }, { label: "Canal", value: o.canal_nombre },
                { label: "Número de origen", value: o.numero ?? o.cuenta }, { label: "Marca", value: o.marca },
                { label: "Vendedora", value: o.vendedora }, { label: "Anuncio", value: o.anuncio ? `${o.anuncio} · ${o.entrada}` : "Sin anuncio (orgánico)" },
              ]} />
            </section>
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">{p.cliente ? "Cliente" : "Cliente nuevo"}</h2>
              {p.cliente ? (
                <DetailList items={[{ label: "Nombre", value: p.cliente.full_name }, { label: "Celular", value: p.cliente.phone ?? "—" }, { label: "Documento", value: p.cliente.doc_number ? `${p.cliente.doc_type} ${p.cliente.doc_number}` : "Sin documento" }]} />
              ) : (
                <>
                  <p className="text-[12.5px] text-muted">El lead pasa a cliente con su primer pedido. Si su celular ya es de un cliente, se usa ese.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Nombre completo" required><Input maxLength={120} value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
                    <Field label="Celular"><Input value={d.phone} disabled={p.nuevo?.telefono_fijo} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
                    <Field label="DNI (opcional)"><Input inputMode="numeric" maxLength={8} value={d.doc_number} onChange={(e) => setD({ ...d, doc_number: e.target.value.replace(/\D/g, "") })} /></Field>
                  </div>
                </>
              )}
              {p.direcciones.length > 0 && (
                <Field label="Dirección de entrega" hint="Se toma la última guardada; la puedes cambiar en Pedidos.">
                  <Select value={d.address_id} onChange={(e) => setD({ ...d, address_id: e.target.value })}
                    options={p.direcciones.map((a) => ({ value: a.id, label: `${a.label ? `${a.label}: ` : ""}${a.address_line}${a.lat === null ? " (sin pin)" : ""}` }))} />
                </Field>
              )}
            </section>
          </div>
          <div className="grid content-start gap-4">
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h2 className="text-[14px] font-semibold text-ink">Crear el borrador</h2>
              <p className="text-[12.5px] text-muted">Al crear: el pedido queda vinculado a este chat, el lead pasa a ganado y se registra de qué anuncio vino. Se abre el formulario de Pedidos para los productos, la fecha, la franja y el pago.</p>
              <Button variant="primary" icon={ShoppingCart} loading={creando} disabled={!p.puede} onClick={crear}>Crear pedido y completarlo</Button>
            </section>
            {p.pedidos.length > 0 && (
              <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
                <h2 className="text-[14px] font-semibold text-ink">Pedidos de este chat</h2>
                {p.pedidos.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <Link href={`/m/ped/ped-02?id=${x.id}`} className="font-mono font-semibold text-primary hover:underline">{x.number}</Link>
                    <span className="text-muted">{x.lineas} producto(s){x.resumen_enviado ? " · resumen enviado" : ""}</span>
                    <span className="tabular-nums">{soles(x.total)}</span>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      )}
      {!p && !error && <p className="text-[13px] text-muted">Cargando…</p>}
    </div>
  );
}

export default function Page() {
  return <Suspense><CrearPedido /></Suspense>;
}
