"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Download, HandCoins, Wallet } from "lucide-react";
import { Badge, Button, Cifra, DataTable, FiltroSelect, PageHeader, toast, type Column } from "@/components/ui";
import { apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { Seccion, Vacio, useDatos } from "@/modulos/caj/comunes";

type Fila = {
  id: string; full_number: string; doc_type: string; issue_date: string; due_date: string | null; total: string; balance: string; payment_terms: string; customer_id: string;
  order_id: string | null; cliente: string; cliente_doc: string | null; marca: string | null; vendedora: string | null; dias: number; dias_vencido: number; tramo: string;
};
type Cliente = { customer_id: string; cliente: string; n: number; saldo: number; t1: number; t2: number; t3: number; vencido: number; max_dias: number };
type Resumen = { total: number; n: number; tramos: Record<string, number>; vencido: number; vencido_pct: number; clientes: Cliente[] };

const TRAMOS: Record<string, string> = { "0-30": "0 a 30 días", "31-60": "31 a 60 días", "60+": "Más de 60 días" };

/** CAJ-11 Cuentas por cobrar: comprobantes con saldo por cliente y antigüedad. La vendedora ve solo sus clientes. */
export default function CuentasPorCobrar() {
  const router = useRouter();
  const { can, puede, marca } = useSesion();
  const [f, setF] = useState({ cliente: "", tramo: "", vencidos: "" });
  const [bajando, setBajando] = useState(false);
  const filtros = { ...f, marca: marca !== "ALL" ? marca : "" };
  const lista = useListado<Fila>("/v1/caj/por-cobrar", { orden: "issue_date", filtros });
  const pr = new URLSearchParams(Object.entries({ ...filtros, cliente: "", per_page: "1" }).filter(([, v]) => v));
  const { datos } = useDatos<{ resumen: Resumen }>(`/v1/caj/por-cobrar?${pr}`);
  const r = datos?.resumen;
  const cobra = can("caj.payment.register") && puede("CAJ", "C");

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar(`/v1/caj/por-cobrar/exportar?${new URLSearchParams(Object.entries(filtros).filter(([, v]) => v))}`, "cuentas-por-cobrar.xlsx");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "full_number", header: "Comprobante", cardTitle: true, render: (d) => <div><div className="font-medium">{d.full_number}</div><div className="text-[12px] text-muted">{d.marca ?? ""}{d.payment_terms === "CREDIT" ? " · crédito" : ""}</div></div> },
    { key: "cliente", header: "Cliente", render: (d) => <div className="min-w-0"><div className="truncate">{d.cliente}</div><div className="text-[12px] text-muted">{d.cliente_doc ?? ""}{d.vendedora ? ` · ${d.vendedora}` : ""}</div></div> },
    { key: "issue_date", header: "Emisión", sortable: true, render: (d) => fecha(d.issue_date) },
    { key: "due_date", header: "Vence", sortable: true, render: (d) => (
      <div>{fecha(d.due_date)}{d.dias_vencido > 0 && <div className="text-[11.5px] text-bad">vencido hace {d.dias_vencido} días</div>}</div>
    ) },
    { key: "dias", header: "Antigüedad", sortable: true, align: "right", render: (d) => <Badge tone={d.tramo === "60+" ? "bad" : d.tramo === "31-60" ? "warn" : "neutral"}>{d.dias} días</Badge> },
    { key: "balance", header: "Saldo", sortable: true, align: "right", render: (d) => <div className="text-right"><span className="font-semibold tabular-nums">{soles(d.balance)}</span><div className="text-[11.5px] text-muted">de {soles(d.total)}</div></div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Comprobantes con saldo por cobrar: total menos notas de crédito y cobros aplicados. Por antigüedad desde la emisión y con los días vencidos."
        actions={<>
          <Button icon={Download} loading={bajando} onClick={exportar}>Exportar</Button>
          {cobra && <Button variant="primary" icon={HandCoins} onClick={() => router.push(f.cliente ? `/m/caj/caj-02?cliente=${f.cliente}` : "/m/caj/caj-02")}>Registrar cobro</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por cobrar" icono={Wallet} destacada valor={r ? soles(r.total) : undefined} detalle={r ? `${numero(r.n)} comprobantes` : ""} />
        <Cifra titulo="Vencido" icono={AlertTriangle} tono={r && r.vencido > 0 ? "bad" : undefined} valor={r ? soles(r.vencido) : undefined} detalle={r ? `${numero(r.vencido_pct, 0)} % del total` : ""} />
        <Cifra titulo="31 a 60 días" valor={r ? soles(r.tramos["31-60"]) : undefined} tono={r && r.tramos["31-60"] > 0 ? "warn" : undefined} detalle={r ? `0 a 30: ${soles(r.tramos["0-30"])}` : ""} />
        <Cifra titulo="Más de 60 días" valor={r ? soles(r.tramos["60+"]) : undefined} tono={r && r.tramos["60+"] > 0 ? "bad" : undefined} detalle="Desde la emisión" />
      </div>
      <Seccion titulo="Por cliente" acciones={f.cliente && <Button size="sm" variant="ghost" onClick={() => setF({ ...f, cliente: "" })}>Ver todos</Button>}>
        {!r ? <Vacio>Cargando…</Vacio> : !r.clientes.length ? <Vacio>No hay saldos por cobrar.</Vacio> : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {r.clientes.slice(0, 12).map((c) => (
              <li key={c.customer_id}>
                <button type="button" onClick={() => setF({ ...f, cliente: f.cliente === c.customer_id ? "" : c.customer_id })}
                  className={`w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors hover:bg-surface-2 ${f.cliente === c.customer_id ? "border-primary" : "border-line"}`}>
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[13.5px] font-medium">{c.cliente}</span><span className="shrink-0 font-semibold tabular-nums">{soles(c.saldo)}</span></div>
                  <div className="text-[12px] text-muted">{c.n} comprobantes · el más antiguo de {c.max_dias} días{c.vencido > 0 ? <span className="text-bad"> · vencido {soles(c.vencido)}</span> : null}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      <DataTable {...lista.tabla} columns={columnas} empty="No hay comprobantes con saldo."
        onRowClick={cobra ? (d) => router.push(`/m/caj/caj-02?cliente=${d.customer_id}`) : undefined}
        search={{ ...lista.tabla.search, placeholder: "Comprobante, cliente o documento…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Antigüedad" value={f.tramo} onChange={(v) => setF({ ...f, tramo: v })} vacio="Toda antigüedad" options={Object.entries(TRAMOS).map(([value, label]) => ({ value, label }))} ancho={170} />
          <FiltroSelect etiqueta="Vencimiento" value={f.vencidos} onChange={(v) => setF({ ...f, vencidos: v })} vacio="Vencidos y por vencer" options={[{ value: "1", label: "Solo vencidos" }]} ancho={190} />
        </>} />
    </div>
  );
}
