"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Undo2 } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, Field, Input, PageHeader, StatusBadge, Textarea, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, kg, numero, soles } from "@/lib/formato";
import { Seccion, Vacio } from "@/modulos/pos/Seccion";
import { SUNAT, TIPOS_DOC, n, r2, type Comprobante } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

type DelDia = { id: string; full_number: string; doc_type: string; pos_ticket: string | null; customer_name: string; brand_name: string; total: string; issued_at: string; devuelto: string };
type Nota = { id: string; full_number: string; issued_at: string; note_reason: string | null; total: string; refund_mode: string | null; refund_status: string | null; customer_name: string; sunat_status: string; afecta: string | null; medio: string | null };
type Hecha = { nota: { id: string; full_number: string; total: string }; monto: number; medio: string | null; modo: "SAME" | "CREDIT"; efectivo: boolean };

/** POS-09 Devolución: comprobante del día, líneas y peso devuelto; nota de crédito y devolución por el mismo medio o como saldo a favor. */
export default function Devolucion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader code="POS-09" description="Solo comprobantes del mostrador emitidos hoy. Se emite una nota de crédito y el producto vuelve al almacén de devoluciones para su revisión." />
      {id ? <Devolver key={id} id={id} /> : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [datos, setDatos] = useState<{ q: string; comprobantes?: DelDia[]; notas?: Nota[]; error?: string } | null>(null);

  useEffect(() => {
    let vigente = true;
    const t = setTimeout(() => {
      api<{ comprobantes: DelDia[]; notas: Nota[] }>(`/v1/pos/devoluciones${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`)
        .then((r) => vigente && setDatos({ q, ...r }))
        .catch((e) => vigente && setDatos({ q, error: mensajeDe(e) }));
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [q]);

  const columnas: Column<DelDia>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (d) => <div><div className="font-medium">{d.full_number}</div><div className="text-[12px] text-muted">{TIPOS_DOC[d.doc_type]} · {d.pos_ticket ?? "—"} · {d.brand_name}</div></div> },
    { key: "customer_name", header: "Cliente" },
    { key: "issued_at", header: "Hora", render: (d) => fechaHora(d.issued_at) },
    { key: "total", header: "Total", align: "right", render: (d) => <div><div>{soles(d.total)}</div>{n(d.devuelto) > 0 && <div className="text-[12px] text-bad">devuelto {soles(d.devuelto)}</div>}</div> },
  ];
  const colNotas: Column<Nota>[] = [
    { key: "full_number", header: "Nota", cardTitle: true, render: (x) => <div><div className="font-medium">{x.full_number}</div><div className="text-[12px] text-muted">afecta {x.afecta ?? "—"}</div></div> },
    { key: "note_reason", header: "Motivo", render: (x) => x.note_reason ?? "—" },
    { key: "refund_mode", header: "Devolución", render: (x) => (x.refund_mode === "CREDIT" ? "Saldo a favor" : x.medio ?? "Mismo medio") + (x.refund_status === "PENDING" ? " · por hacer" : "") },
    { key: "total", header: "Monto", align: "right", render: (x) => soles(x.total) },
    { key: "sunat_status", header: "SUNAT", render: (x) => <StatusBadge status={x.sunat_status} labels={SUNAT} /> },
  ];
  return (
    <div className="space-y-5">
      <DataTable rows={datos?.comprobantes ?? []} columns={columnas} loading={!datos} error={datos?.error}
        search={{ value: q, onChange: setQ, placeholder: "Número, ticket o cliente…" }}
        onRowClick={(d) => router.push(`/m/pos/pos-09?id=${d.id}`)} empty="No hay comprobantes del mostrador de hoy con esa búsqueda." />
      <Seccion titulo="Notas de crédito del mostrador">
        <DataTable rows={datos?.notas ?? []} columns={colNotas} loading={!datos} onRowClick={(x) => router.push(`/m/pos/pos-05?id=${x.id}`)} empty="Sin notas de crédito." />
      </Seccion>
    </div>
  );
}

function Devolver({ id }: { id: string }) {
  const router = useRouter();
  const { ctx } = useContexto();
  const [c, setC] = useState<Comprobante | null>(null);
  const [error, setError] = useState("");
  const [cant, setCant] = useState<Record<string, string>>({});
  const [unid, setUnid] = useState<Record<string, string>>({});
  const [modo, setModo] = useState<"SAME" | "CREDIT">("SAME");
  const [motivo, setMotivo] = useState("");
  const [reingresa, setReingresa] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [hecha, setHecha] = useState<Hecha | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Comprobante>(`/v1/pos/comprobantes/${id}`).then((r) => vigente && setC(r)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!c) return <Vacio>Cargando el comprobante…</Vacio>;
  const d = c.documento;
  const devuelto = Array.isArray(c.devuelto) ? {} : c.devuelto;
  const varios = c.cliente?.customer_type === "OTHER";
  const medio = [...c.cobros].sort((a, b) => n(b.amount) - n(a.amount))[0];

  const lineas = c.lineas.map((l) => {
    const porKg = l.uom_code === "KGM";
    const ya = devuelto[l.id]?.qty ?? 0;
    const queda = Math.round((n(l.qty) - ya) * 1000) / 1000;
    const q = Number(cant[l.id] || 0);
    const importe = q <= 0 ? 0 : Math.abs(q - queda) < 0.0005 ? r2(n(l.total) - (devuelto[l.id]?.amount ?? 0)) : r2(q * n(l.unit_price));
    return { l, porKg, ya, queda, q, importe, excede: q > queda + 0.0005, decimales: !porKg && q % 1 !== 0 };
  });
  const elegidas = lineas.filter((x) => x.q > 0);
  const monto = r2(elegidas.reduce((s, x) => s + x.importe, 0));
  const problema = lineas.find((x) => x.excede || x.decimales);
  const listo = elegidas.length > 0 && !problema && motivo.trim().length >= 5 && !(modo === "CREDIT" && varios);

  async function devolver() {
    const ok = await confirmAction({ title: `¿Emitir la nota de crédito por ${soles(monto)}?`, message: modo === "CREDIT" ? "El monto queda como saldo a favor del cliente." : `Se devuelve por ${medio?.medio ?? "el mismo medio"}.`, confirmLabel: "Emitir nota" });
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await api<Hecha>(`/v1/pos/comprobantes/${id}/devolucion`, {
        method: "POST",
        body: {
          lines: elegidas.map((x) => (x.porKg ? { line_id: x.l.id, weight_kg: x.q, qty: unid[x.l.id] ? Number(unid[x.l.id]) : undefined } : { line_id: x.l.id, qty: x.q })),
          mode: modo, reason: motivo.trim(), restock: reingresa,
        },
      });
      setHecha(r);
      toast.ok(`Nota de crédito ${r.nota.full_number} emitida.`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  if (hecha) {
    return (
      <Seccion titulo={`Nota de crédito ${hecha.nota.full_number}`}>
        <p className="text-[14px] text-ink">
          {hecha.modo === "CREDIT" ? `Quedan ${soles(hecha.monto)} como saldo a favor del cliente.`
            : hecha.efectivo ? `Entrega ${soles(hecha.monto)} en efectivo al cliente: salen de la caja del turno.`
              : `Devuelve ${soles(hecha.monto)} por ${hecha.medio ?? "el mismo medio"}; administración lo registra con el adquirente o la billetera.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => router.push(`/m/pos/pos-05?id=${hecha.nota.id}`)}>Ver e imprimir la nota</Button>
          <Button onClick={() => router.push("/m/pos/pos-09")}>Otra devolución</Button>
        </div>
      </Seccion>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-09")}>Otro comprobante</Button>
      {ctx && !ctx.puede.devolver && <Alert tone="warn">Las devoluciones las registra la supervisora de ventas.</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Seccion titulo={`${c.tipo} ${d.full_number}`}>
          <p className="mb-3 text-[12.5px] text-muted">{d.customer_name} · {fechaHora(d.issued_at)} · {soles(d.total)} · pagó con {c.cobros.map((p) => p.medio).join(" + ") || (c.saldo_a_favor ? "saldo a favor" : "—")}</p>
          <div className="space-y-3">
            {lineas.map((x) => (
              <div key={x.l.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-2 text-[13.5px]">
                  <div className="min-w-0">
                    <div className="font-medium text-ink">{x.l.description}</div>
                    <div className="text-[12px] text-muted">
                      Vendido {x.porKg ? kg(x.l.qty) : `${numero(x.l.qty)} u`} × {soles(x.l.unit_price)} = {soles(x.l.total)}
                      {x.ya > 0 && ` · ya devuelto ${x.porKg ? kg(x.ya) : `${numero(x.ya)} u`}`}
                    </div>
                  </div>
                  {x.importe > 0 && <span className="shrink-0 font-semibold text-bad tabular-nums">− {soles(x.importe)}</span>}
                </div>
                {x.queda > 0 ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Field label={x.porKg ? "Peso devuelto" : "Unidades devueltas"} error={x.excede ? `Máximo ${x.porKg ? kg(x.queda) : `${x.queda} u`}` : x.decimales ? "Sin decimales" : undefined}>
                      <Input suffix={x.porKg ? "kg" : "u"} inputMode="decimal" value={cant[x.l.id] ?? ""} onChange={(e) => setCant((v) => ({ ...v, [x.l.id]: e.target.value.replace(/[^\d.]/g, "") }))} />
                    </Field>
                    {x.porKg && x.l.sale_mode === "UNIT_VARIABLE_WEIGHT" && (
                      <Field label="Piezas que vuelven" hint="Para el stock del almacén de devoluciones.">
                        <Input inputMode="numeric" value={unid[x.l.id] ?? ""} placeholder="1" onChange={(e) => setUnid((v) => ({ ...v, [x.l.id]: e.target.value.replace(/\D/g, "") }))} />
                      </Field>
                    )}
                  </div>
                ) : <p className="mt-1 text-[12px] text-muted">Ya se devolvió completa.</p>}
              </div>
            ))}
          </div>
        </Seccion>

        <Seccion titulo="Nota de crédito">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <Opcion activa={modo === "SAME"} onClick={() => setModo("SAME")} titulo={`Por el mismo medio${medio ? ` (${medio.medio})` : ""}`}
                texto={medio?.code === "CASH" ? "Sale efectivo de la caja del turno abierto." : "Se devuelve por tarjeta, Yape o Plin; administración recibe el aviso."} />
              <Opcion activa={modo === "CREDIT"} disabled={varios} onClick={() => setModo("CREDIT")} titulo="Como saldo a favor"
                texto={varios ? "No disponible: la venta fue a «Clientes varios»." : "Queda en la cuenta del cliente para su próxima compra."} />
            </div>
            <Field label="Motivo" required hint="Mínimo 5 caracteres. Sale en la nota de crédito."><Textarea rows={2} maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
            <Checkbox checked={reingresa} onChange={setReingresa} label="El producto vuelve al almacén de devoluciones" hint="Desmarca si el producto se descarta (no regresa físicamente)." />
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold text-ink">A devolver</span>
              <span className="text-[22px] font-semibold text-bad tabular-nums">{soles(monto)}</span>
            </div>
            <Button variant="primary" icon={Undo2} className="w-full" loading={enviando} disabled={!listo || !ctx?.puede.devolver} onClick={devolver}>Emitir nota de crédito</Button>
          </div>
        </Seccion>
      </div>
    </div>
  );
}

function Opcion({ activa, disabled, onClick, titulo, texto }: { activa: boolean; disabled?: boolean; onClick: () => void; titulo: string; texto: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`cursor-pointer rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${activa ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2"}`}>
      <div className={`text-[13.5px] font-medium ${activa ? "text-primary" : "text-ink"}`}>{titulo}</div>
      <div className="text-[12px] text-muted">{texto}</div>
    </button>
  );
}
