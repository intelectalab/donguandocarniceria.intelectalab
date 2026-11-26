"use client";

import { useState } from "react";
import { ArrowLeft, Gift, SlidersHorizontal, Undo2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, fechaHora, numero, soles } from "@/lib/formato";
import { Cifras, CifraLink, Panel, Sub, accion, qs, useAlAbrir, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { MOVIMIENTO, type Opciones } from "@/modulos/cmp/tipos";

type Fila = { id: string; full_name: string; phone: string | null; balance: number; last_movement: string | null };
type Mov = { id: string; movement: string; points: number; expires_on: string | null; reason: string | null; order_number: string | null; payment_number: string | null; reversed: boolean;
  reversal_of: string | null; created_at: string };
type Detalle = { balance: number; value: number; movements: Mov[]; expiring: { points: number; expires_on: string }[];
  program: { min_redeem_points: number; pen_per_point: string } | null; customer: { id: string; full_name: string; phone: string | null; referral_code: string | null } };

/** CMP-09 Puntos del cliente: saldo, equivalente en soles, movimientos, puntos por vencer, canje y ajustes. */
export default function PuntosCliente() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [id, setId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useAlAbrir((p) => setId(p.get("id") ?? ""));
  const lista = useDatos<{ data: Fila[] }>(id === "" ? `/v1/cmp/puntos/clientes${qs({ q })}` : null);

  const columnas: Column<Fila>[] = [
    { key: "full_name", header: "Cliente", cardTitle: true, render: (c) => <div><p className="font-semibold">{c.full_name}</p><Sub>{c.phone ?? "Sin teléfono"}</Sub></div> },
    { key: "balance", header: "Saldo", align: "right", render: (c) => <span className="tabular-nums font-semibold">{numero(c.balance)}</span> },
    { key: "last_movement", header: "Último movimiento", render: (c) => c.last_movement ? fecha(c.last_movement) : "—" },
  ];

  if (id) return <Cliente id={id} op={op} onVolver={() => setId("")} />;
  return (
    <div className="space-y-5">
      <PageHeader description="Clientes con movimientos de puntos, de mayor a menor saldo. Abre uno para ver su historial, canjear o ajustar." />
      <DataTable columns={columnas} rows={lista.datos?.data ?? []} loading={id === null || lista.cargando} error={lista.error} onRetry={lista.recargar} empty="No hay clientes con puntos."
        onRowClick={(c) => setId(c.id)}
        toolbar={<Input aria-label="Buscar" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-[260px]" />} />
    </div>
  );
}

function Cliente({ id, op, onVolver }: { id: string; op: Opciones | null; onVolver: () => void }) {
  const r = useDatos<Detalle>(`/v1/cmp/puntos/clientes/${id}`);
  const [dialogo, setDialogo] = useState<"canje" | "ajuste" | null>(null);
  const d = r.datos;
  const canjea = Boolean(op?.can["cmp.coupon.manage"] || op?.can["cmp.loyalty.adjust"]);
  const ajusta = Boolean(op?.can["cmp.loyalty.adjust"]);
  const porVencer = (d?.expiring ?? []).reduce((s, e) => s + e.points, 0);

  const columnas: Column<Mov>[] = [
    { key: "created_at", header: "Fecha", render: (m) => <span className="whitespace-nowrap">{fechaHora(m.created_at)}</span> },
    { key: "movement", header: "Movimiento", cardTitle: true, render: (m) => <div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={m.movement} labels={MOVIMIENTO} />{m.reversed && <Badge tone="neutral">Revertido</Badge>}</div> },
    { key: "points", header: "Puntos", align: "right", render: (m) => <span className={`tabular-nums font-semibold ${m.points < 0 ? "text-bad" : "text-ok"}`}>{m.points > 0 ? "+" : ""}{numero(m.points)}</span> },
    { key: "reason", header: "Detalle", render: (m) => <div className="max-w-[320px]">{m.reason ?? "—"}{(m.order_number || m.payment_number) && <Sub>{[m.order_number, m.payment_number].filter(Boolean).join(" · ")}</Sub>}</div> },
    { key: "expires_on", header: "Vence", hideOnMobile: true, render: (m) => m.expires_on && m.points > 0 ? fecha(m.expires_on) : "—" },
    { key: "acc", header: "", hideInCard: false, render: (m) => ajusta && !m.reversed && !m.reversal_of && m.movement !== "EXPIRE" && <Button size="sm" variant="ghost" icon={Undo2}
      onClick={() => accion({ title: `¿Revertir ${m.points > 0 ? "+" : ""}${numero(m.points)} puntos?`, message: "Se crea un movimiento contrario; el original queda en el historial.", confirmLabel: "Revertir", danger: true, reason: { min: 5, label: "Motivo" } },
        (motivo) => api(`/v1/cmp/puntos/movimientos/${m.id}/reverso`, { method: "POST", body: { reason: motivo } }), "Movimiento revertido", r.recargar)}>Revertir</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={d ? `${d.customer.full_name}${d.customer.phone ? ` · ${d.customer.phone}` : ""}${d.customer.referral_code ? ` · código de referido ${d.customer.referral_code}` : ""}` : "Cargando cliente…"}
        actions={<>
          <Button variant="ghost" icon={ArrowLeft} onClick={onVolver}>Todos los clientes</Button>
          {ajusta && <Button icon={SlidersHorizontal} disabled={!d} onClick={() => setDialogo("ajuste")}>Ajustar</Button>}
          {canjea && <Button variant="primary" icon={Gift} disabled={!d || !d.program || d.balance < d.program.min_redeem_points} onClick={() => setDialogo("canje")}>Canjear</Button>}
        </>} />
      {r.error && <Alert tone="bad">{r.error}</Alert>}
      <Cifras cols={3}>
        <CifraLink destacada titulo="Saldo" valor={d ? `${numero(d.balance)} puntos` : undefined} detalle={d ? `Equivale a ${soles(d.value)}` : undefined} />
        <CifraLink titulo="Por vencer en 60 días" valor={d ? numero(porVencer) : undefined} detalle={d?.expiring[0] ? `Los primeros el ${fecha(d.expiring[0].expires_on)}` : "Nada por vencer"} tono={porVencer ? "warn" : "ok"} />
        <CifraLink titulo="Canje mínimo" valor={d?.program ? `${numero(d.program.min_redeem_points)} puntos` : undefined} detalle={d?.program ? soles(d.program.min_redeem_points * Number(d.program.pen_per_point)) : "Sin programa activo"} />
      </Cifras>
      <Panel titulo="Movimientos">
        <DataTable columns={columnas} rows={d?.movements ?? []} loading={r.cargando} empty="Este cliente aún no tiene movimientos." />
      </Panel>
      {dialogo === "canje" && d && <Canje d={d} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); r.recargar(); }} />}
      {dialogo === "ajuste" && d && <Ajuste d={d} onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); r.recargar(); }} />}
    </div>
  );
}

function Canje({ d, onClose, onHecho }: { d: Detalle; onClose: () => void; onHecho: () => void }) {
  const [puntos, setPuntos] = useState(String(d.program?.min_redeem_points ?? 100));
  const valor = Number(puntos || 0) * Number(d.program?.pen_per_point ?? 0);
  return (
    <Dialogo titulo={`Canjear puntos de ${d.customer.full_name}`} boton="Canjear" onClose={onClose}
      aviso={`Tiene ${numero(d.balance)} puntos. El canje se descuenta del saldo y se usa como descuento en su pedido.`}
      enviar={async () => { await api(`/v1/cmp/puntos/clientes/${d.customer.id}/canje`, { method: "POST", body: { points: Number(puntos) } }); toast.ok(`Canje registrado: ${soles(valor)}`); onHecho(); }}>
      {(e) => <>
        <Field label="Puntos a canjear" required error={e.points} hint={`Mínimo ${numero(d.program?.min_redeem_points ?? 0)}.`}><Input inputMode="numeric" suffix="puntos" value={puntos} onChange={(x) => setPuntos(x.target.value)} /></Field>
        <Field label="Descuento"><Input readOnly value={soles(valor)} /></Field>
      </>}
    </Dialogo>
  );
}

function Ajuste({ d, onClose, onHecho }: { d: Detalle; onClose: () => void; onHecho: () => void }) {
  const [puntos, setPuntos] = useState("");
  const [motivo, setMotivo] = useState("");
  return (
    <Dialogo titulo={`Ajustar puntos de ${d.customer.full_name}`} boton="Registrar ajuste" onClose={onClose}
      aviso="Usa un número negativo para quitar puntos. El ajuste queda en el historial con tu nombre y el motivo."
      enviar={async () => { await api(`/v1/cmp/puntos/clientes/${d.customer.id}/ajuste`, { method: "POST", body: { points: Number(puntos), reason: motivo || null } }); toast.ok("Ajuste registrado"); onHecho(); }}>
      {(e) => <>
        <Field label="Puntos" required error={e.points} hint="Ej.: 50 o −50."><Input inputMode="numeric" value={puntos} onChange={(x) => setPuntos(x.target.value.replace("−", "-"))} /></Field>
        <div />
        <Field label="Motivo" required error={e.reason} className="sm:col-span-2"><Textarea rows={2} value={motivo} onChange={(x) => setMotivo(x.target.value)} placeholder="Ej.: compensación por pedido incompleto" /></Field>
      </>}
    </Dialogo>
  );
}
