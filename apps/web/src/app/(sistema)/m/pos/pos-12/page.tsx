"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { Alert, Button, DataTable, Field, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Cobro } from "@/modulos/pos/Cobro";
import { Renglon, Seccion, SinTurno, Vacio } from "@/modulos/pos/Seccion";
import { Tickets } from "@/modulos/pos/Ticket";
import { n, type Comprobante, type Pago } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

type Fila = {
  id: string; number: string; status: string; delivery_date: string; slot_from: string | null; slot_to: string | null; final_total: string | null; estimated_total: string;
  paid_amount: string; balance_mode: string | null; requested_doc_type: string; cliente: string; phone: string | null; contact_phone: string | null; marca: string;
  units: number; est_kg: string | null; total: number; saldo: number; a_favor: number; comprobante: string | null;
};
type Detalle = {
  pedido: { id: string; number: string; status: string; delivery_date: string; slot_from: string | null; slot_to: string | null; notes: string | null; requested_doc_type: string; balance_mode: string | null; contact_phone: string | null };
  lineas: { id: string; name: string; sku: string; sale_mode: string; qty: string; price_basis: string; unit_price: string; est_weight_kg: string | null; weighed_kg: string | null; est_amount: string; final_amount: string | null }[];
  saldo: { total: number; pagado: number; diferencia: number; tipo: "POR_COBRAR" | "A_FAVOR" | "CUADRA" | string };
  cliente: { id: string; full_name: string; phone: string | null; doc_type: string | null; doc_number: string | null } | null;
  marca: string;
};
type Entrega = { comprobante: { id: string } | null; cobrado: number; vuelto: number; cerrado: boolean; cobros: string[] };

const franja = (a: string | null, b: string | null) => (a && b ? `${a.slice(0, 5)}–${b.slice(0, 5)}` : "");

/** POS-12 Pedidos por recoger: pedidos LISTO con recojo en este local; busca por número o celular, cobra el saldo y entrega. */
export default function PedidosPorRecoger() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader code="POS-12" description="Pedidos listos para recoger en este local. Al entregar se emite el comprobante, se cobra el saldo y el pedido se cierra si cuadra." />
      {id ? <Entregar key={id} id={id} /> : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const { me } = useSesion();
  const [q, setQ] = useState("");
  const [local, setLocal] = useState("");
  const [datos, setDatos] = useState<{ clave: string; local?: string; pedidos?: Fila[]; error?: string } | null>(null);
  const clave = `${q.trim()}|${local}`;

  useEffect(() => {
    let vigente = true;
    const [texto, l] = clave.split("|");
    const t = setTimeout(() => {
      const p = new URLSearchParams(Object.entries({ q: texto, establishment_id: l }).filter(([, v]) => v));
      api<{ local: string; pedidos: Fila[] }>(`/v1/pos/recojos?${p}`)
        .then((r) => vigente && setDatos({ clave, ...r }))
        .catch((e) => vigente && setDatos({ clave, error: mensajeDe(e) }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [clave]);

  const locales = me.establishments.filter((e) => e.has_counter);
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Pedido", cardTitle: true, render: (o) => <div><div className="font-medium">{o.number}</div><div className="text-[12px] text-muted">{o.marca}</div></div> },
    { key: "cliente", header: "Cliente", render: (o) => <div><div>{o.cliente}</div><div className="text-[12px] text-muted">{o.contact_phone ?? o.phone ?? ""}</div></div> },
    { key: "delivery_date", header: "Recojo", render: (o) => <div className="whitespace-nowrap">{fecha(o.delivery_date)} <span className="text-muted">{franja(o.slot_from, o.slot_to)}</span></div> },
    { key: "total", header: "Total", align: "right", render: (o) => soles(o.total) },
    {
      key: "saldo", header: "Por cobrar", align: "right",
      render: (o) => (o.saldo > 0.005 ? <span className="font-semibold text-bad">{soles(o.saldo)}</span> : o.a_favor > 0.005 ? <span className="text-info">{soles(o.a_favor)} a favor</span> : <span className="text-ok">Pagado</span>),
    },
  ];
  return (
    <div className="space-y-3">
      {locales.length > 1 && (
        <div className="max-w-[360px]">
          <Field label="Local de recojo">
            <Select value={local || datos?.local || ""} onChange={(e) => setLocal(e.target.value)} options={locales.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
        </div>
      )}
      <DataTable rows={datos?.pedidos ?? []} columns={columnas} loading={!datos} error={datos?.error}
        search={{ value: q, onChange: setQ, placeholder: "Número de pedido o celular…" }}
        onRowClick={(o) => router.push(`/m/pos/pos-12?id=${o.id}`)} empty="No hay pedidos listos para recoger en este local." />
    </div>
  );
}

function Entregar({ id }: { id: string }) {
  const router = useRouter();
  const { ctx } = useContexto();
  const [d, setD] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [tipo, setTipo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecha, setHecha] = useState<Entrega | null>(null);
  const [tickets, setTickets] = useState<Comprobante[] | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Detalle>(`/v1/pos/recojos/${id}`).then((r) => vigente && setD(r)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id]);

  useEffect(() => {
    const doc = hecha?.comprobante?.id;
    if (!doc) return;
    let vigente = true;
    api<Comprobante>(`/v1/pos/comprobantes/${doc}`).then((c) => vigente && setTickets([c])).catch(() => {});
    return () => { vigente = false; };
  }, [hecha]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!d || !ctx) return <Vacio>Cargando el pedido…</Vacio>;
  const o = d.pedido;
  const docTipo = tipo || o.requested_doc_type || "RECEIPT";
  const falta = d.saldo.tipo === "POR_COBRAR" && o.balance_mode !== "WAIVE" ? Math.round(-d.saldo.diferencia * 100) / 100 : 0;

  async function entregar(pagos: Pago[]) {
    setEnviando(true);
    try {
      const r = await api<Entrega>(`/v1/pos/recojos/${id}/entregar`, { method: "POST", body: { payments: pagos, doc_type: docTipo } });
      setHecha(r);
      toast.ok(`Pedido ${o.number} entregado${r.cobrado > 0 ? `, cobrados ${soles(r.cobrado)}` : ""}.`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  if (hecha) {
    return (
      <div className="mx-auto max-w-[560px] space-y-4">
        <Alert tone="ok" title={`Pedido ${o.number} entregado`}>
          {hecha.cobrado > 0 ? `Cobrados ${soles(hecha.cobrado)}.` : "Sin cobro en el mostrador."}{hecha.vuelto > 0 ? ` Vuelto ${soles(hecha.vuelto)}.` : ""}{" "}
          {hecha.cerrado ? "El pedido quedó cerrado." : <>El pedido tiene saldo a favor del cliente: decide qué hacer con él en <Link className="underline" href="/m/ped/ped-12">Saldo del pedido</Link>.</>}
        </Alert>
        <div className="flex justify-center"><Button onClick={() => router.push("/m/pos/pos-12")}>Otro pedido</Button></div>
        {tickets && <Tickets lista={tickets} onCambio={(c) => setTickets([c])} />}
      </div>
    );
  }

  const identificado = Boolean(d.cliente && d.cliente.id !== ctx.cliente_varios);
  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-12")}>Otro pedido</Button>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Seccion titulo={`Pedido ${o.number} · ${d.marca}`}>
          <p className="mb-3 text-[12.5px] text-muted">{d.cliente?.full_name} · {o.contact_phone ?? d.cliente?.phone ?? ""} · recojo {fecha(o.delivery_date)} {franja(o.slot_from, o.slot_to)}</p>
          {o.notes && <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">{o.notes}</p>}
          <ul className="divide-y divide-line text-[13.5px]">
            {d.lineas.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  {l.name}
                  <span className="block text-[12px] text-muted">
                    {l.price_basis === "KG" ? `${kg(l.weighed_kg ?? l.est_weight_kg)}${l.weighed_kg ? " pesado" : " estimado"}` : `${numero(l.qty)} u`} × {soles(l.unit_price)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{soles(l.final_amount ?? l.est_amount)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <Renglon label="Total del pedido" valor={soles(d.saldo.total)} />
            <Renglon label="Pagado" valor={soles(d.saldo.pagado)} />
            <Renglon label={falta > 0 ? "Por cobrar" : d.saldo.tipo === "A_FAVOR" ? "A favor del cliente" : "Saldo"} valor={soles(falta > 0 ? falta : Math.abs(d.saldo.diferencia))} fuerte tono={falta > 0 ? "bad" : "ok"} />
          </div>
        </Seccion>

        <Seccion titulo="Entrega">
          <div className="space-y-3">
            <Field label="Comprobante">
              <Select value={docTipo} onChange={(e) => setTipo(e.target.value)} options={[{ value: "RECEIPT", label: "Boleta" }, { value: "INVOICE", label: "Factura (cliente con RUC)" }]} />
            </Field>
            {d.saldo.tipo === "A_FAVOR" && <Alert tone="info">El cliente pagó {soles(n(d.saldo.diferencia))} de más: se entrega sin cobro y el saldo se decide en Saldo del pedido.</Alert>}
            {falta > 0 ? (
              ctx.turno
                ? <Cobro total={falta} medios={ctx.medios} marcasTarjeta={ctx.marcas_tarjeta} saldoCliente={0} clienteIdentificado={identificado} enviando={enviando}
                    textoBoton="Cobrar y entregar" onCobrar={entregar} />
                : <SinTurno abrir={ctx.puede.abrir} texto="Este pedido tiene saldo por cobrar: el cobro se registra en un turno abierto." />
            ) : (
              <Button variant="primary" icon={PackageCheck} className="h-12 w-full" loading={enviando} onClick={() => entregar([])}>Entregar pedido</Button>
            )}
          </div>
        </Seccion>
      </div>
    </div>
  );
}
