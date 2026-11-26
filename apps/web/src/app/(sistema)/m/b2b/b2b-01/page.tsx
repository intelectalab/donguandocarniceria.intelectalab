"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Lock, Wallet } from "lucide-react";
import { DataTable, Input, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { numero, soles } from "@/lib/formato";
import { Cifras, CifraLink, DiasMora, FiltroSelect, Sub, opciones, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { ESTADO_CREDITO, TIPO_CLIENTE, type Opciones } from "@/modulos/b2b/tipos";

type Cliente = { id: string; full_name: string; trade_name: string | null; doc_number: string; customer_type: string; seller_name: string | null; age: string; credit_limit: number | null;
  term_days: number | null; balance: number; unbilled: number; exposure: number; overdue: number; overdue_days: number; available: number | null; status: string; blocked_reason: string | null };
type Resp = { data: Cliente[]; summary: { customers: number; with_credit: number; balance: number; overdue: number; blocked: number }; buckets: string[] };

/** B2B-01 Clientes empresariales: límite, saldo, disponible, mora y estado del crédito de restaurantes, empresas y puntos. */
export default function Clientes() {
  const router = useRouter();
  const op = useOpcionesDe<Opciones>("/v1/b2b/opciones");
  const [f, setF] = useState({ q: "", type: "", seller_id: "", status: "", zone_id: "", age: "", brand_id: "" });
  const r = useDatos<Resp>(`/v1/b2b/clientes${qs(f)}`);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const s = r.datos?.summary;

  const columnas: Column<Cliente>[] = [
    { key: "full_name", header: "Cliente", cardTitle: true, render: (c) => <div className="min-w-[200px]"><p className="font-semibold">{c.trade_name ?? c.full_name}</p><Sub>{c.full_name} · RUC {c.doc_number}</Sub></div> },
    { key: "customer_type", header: "Tipo", hideOnMobile: true, render: (c) => TIPO_CLIENTE[c.customer_type] ?? c.customer_type },
    { key: "seller_name", header: "Vendedora", hideOnMobile: true, render: (c) => c.seller_name ?? "—" },
    { key: "credit_limit", header: "Límite", align: "right", render: (c) => c.credit_limit != null ? <div>{soles(c.credit_limit)}<Sub>{c.term_days} días</Sub></div> : <span className="text-muted">Contado</span> },
    { key: "balance", header: "Saldo", align: "right", render: (c) => <div>{soles(c.balance)}{c.unbilled > 0 && <Sub>+ {soles(c.unbilled)} por facturar</Sub>}</div> },
    { key: "available", header: "Disponible", align: "right", render: (c) => c.available != null ? <span className={c.available < 0 ? "font-semibold text-bad" : ""}>{soles(c.available)}</span> : "—" },
    { key: "overdue", header: "Vencido", align: "right", render: (c) => c.overdue > 0 ? <div className="text-bad">{soles(c.overdue)}<Sub>{c.age}</Sub></div> : "—" },
    { key: "overdue_days", header: "Mora", render: (c) => <DiasMora d={c.overdue_days} /> },
    { key: "status", header: "Crédito", render: (c) => <div><StatusBadge status={c.status} labels={ESTADO_CREDITO} />{c.blocked_reason && <Sub>{c.blocked_reason}</Sub>}</div> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`Clientes que compran a crédito. Un pedido a crédito pasa si cabe en el disponible y la deuda vencida no supera ${op?.params.grace_days ?? 5} días de gracia; si no, necesita una excepción.`} />
      <Cifras>
        <CifraLink destacada titulo="Cartera" valor={s ? soles(s.balance) : undefined} detalle={s ? `${numero(s.with_credit)} clientes con crédito de ${numero(s.customers)}` : undefined} icono={Wallet} href="/m/b2b/b2b-08" />
        <CifraLink titulo="Vencido" valor={s ? soles(s.overdue) : undefined} detalle={s && s.balance ? `${numero((s.overdue / s.balance) * 100, 1)} % de la cartera` : undefined} icono={AlertTriangle} tono={s?.overdue ? "warn" : "ok"} href="/m/b2b/b2b-09" />
        <CifraLink titulo="Bloqueados" valor={s ? numero(s.blocked) : undefined} detalle="No reciben pedidos a crédito" icono={Lock} tono={s?.blocked ? "bad" : "ok"} onClick={() => set("status")("BLOCKED")} />
        <CifraLink titulo="Clientes" valor={s ? numero(s.customers) : undefined} detalle="Empresariales y puntos" icono={Building2} />
      </Cifras>
      <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay clientes con esos filtros." onRowClick={(c) => router.push(`/m/b2b/b2b-02?id=${c.id}`)}
        toolbar={<>
          <Input aria-label="Buscar" placeholder="Buscar razón social o RUC…" value={f.q} onChange={(e) => set("q")(e.target.value)} className="sm:w-[220px]" />
          <FiltroSelect label="Crédito" value={f.status} onChange={set("status")} options={opcionesDe(ESTADO_CREDITO)} />
          <FiltroSelect label="Tipo" value={f.type} onChange={set("type")} options={opciones(TIPO_CLIENTE)} />
          <FiltroSelect label="Vendedora" value={f.seller_id} onChange={set("seller_id")} options={(op?.sellers ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <FiltroSelect label="Antigüedad" value={f.age} onChange={set("age")} options={(r.datos?.buckets ?? []).map((b) => ({ value: b, label: b }))} />
          <FiltroSelect label="Zona" value={f.zone_id} onChange={set("zone_id")} options={(op?.zones ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <FiltroSelect label="Marca" value={f.brand_id} onChange={set("brand_id")} options={(op?.brands ?? []).map((x) => ({ value: x.id, label: x.name }))} />
        </>} />
    </div>
  );
}
