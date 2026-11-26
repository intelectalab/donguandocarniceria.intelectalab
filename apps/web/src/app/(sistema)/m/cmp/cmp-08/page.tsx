"use client";

import { useState } from "react";
import { Coins, Gift, Pencil, Timer, Users } from "lucide-react";
import { Alert, Button, DetailList, Field, Input, PageHeader, Select, StatusBadge, toast } from "@/components/ui";
import { api } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { Cifras, CifraLink, Panel, num, useDatos, useOpcionesDe, type Etiquetas } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import type { Opciones } from "@/modulos/cmp/tipos";

type Programa = { id: string; code: string; name: string; brand_id: string | null; points_per_pen: string; pen_per_point: string; min_redeem_points: number; expiry_months: number;
  referral_bonus_points: number; status: string };
type Resp = { program: Programa | null; totals: { balance: number; earned: number; redeemed: number; expired: number; customers: number }; liability: number; brands: { id: string; name: string }[] };

const ESTADO_PROGRAMA: Etiquetas = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };

/** CMP-08 Programa de puntos: reglas de acumulación y canje, vencimiento, bono por referido y pasivo de puntos vigentes. */
export default function ProgramaPuntos() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const r = useDatos<Resp>("/v1/cmp/puntos");
  const [editar, setEditar] = useState(false);
  const p = r.datos?.program ?? null;
  const t = r.datos?.totals;
  const gestiona = Boolean(op?.can["cmp.coupon.manage"]);

  return (
    <div className="space-y-5">
      <PageHeader description="El cliente gana puntos cuando paga su pedido, no cuando lo pide. Los puntos vencen por antigüedad y se canjean como descuento en un pedido siguiente."
        actions={gestiona && <Button variant="primary" icon={Pencil} disabled={!r.datos} onClick={() => setEditar(true)}>{p ? "Editar programa" : "Crear programa"}</Button>} />
      <Cifras>
        <CifraLink destacada titulo="Puntos vigentes" valor={t ? numero(t.balance) : undefined} detalle={r.datos ? `Equivalen a ${soles(r.datos.liability)} en descuentos` : undefined} icono={Coins} href="/m/cmp/cmp-09" />
        <CifraLink titulo="Clientes con puntos" valor={t ? numero(t.customers) : undefined} detalle="Con al menos un movimiento" icono={Users} href="/m/cmp/cmp-09" />
        <CifraLink titulo="Canjeados" valor={t ? numero(t.redeemed) : undefined} detalle={t ? `de ${numero(t.earned)} ganados` : undefined} icono={Gift} />
        <CifraLink titulo="Vencidos" valor={t ? numero(t.expired) : undefined} detalle={p ? `A los ${p.expiry_months} meses de ganados` : undefined} icono={Timer} />
      </Cifras>
      <Panel titulo="Reglas del programa">
        {r.cargando && !r.datos ? <p className="text-muted">Cargando…</p> : !p ? <Alert tone="warn" title="No hay programa de puntos">Mientras no exista, los cobros no suman puntos ni se pueden canjear.</Alert> : (
          <DetailList items={[
            { label: "Programa", value: <span className="flex items-center gap-2">{p.name} <StatusBadge status={p.status} labels={ESTADO_PROGRAMA} /></span> },
            { label: "Marca", value: r.datos?.brands.find((b) => b.id === p.brand_id)?.name ?? "Todas las marcas" },
            { label: "Se gana", value: `${numero(p.points_per_pen, 2)} punto(s) por cada S/ 1 cobrado` },
            { label: "Vale cada punto", value: soles(p.pen_per_point) },
            { label: "Canje mínimo", value: `${numero(p.min_redeem_points)} puntos (${soles(p.min_redeem_points * Number(p.pen_per_point))})` },
            { label: "Vencimiento", value: `${p.expiry_months} meses desde que se ganan` },
            { label: "Bono por referido", value: `${numero(p.referral_bonus_points)} puntos al que refiere, cuando el referido paga su primer pedido` },
          ]} />
        )}
      </Panel>
      <Alert tone="info" title="Ejemplo">
        {p ? `Un pedido cobrado de S/ 189 suma ${numero(Math.floor(189 * Number(p.points_per_pen)))} puntos. Con ${numero(p.min_redeem_points)} puntos el cliente puede pedir ${soles(p.min_redeem_points * Number(p.pen_per_point))} de descuento.` : "Define el programa para ver un ejemplo."}
        {" "}Si un cobro se anula, sus puntos se revierten.
      </Alert>
      {editar && r.datos && <FormPrograma p={p} onClose={() => setEditar(false)} onHecho={() => { setEditar(false); r.recargar(); }} />}
    </div>
  );
}

function FormPrograma({ p, onClose, onHecho }: { p: Programa | null; onClose: () => void; onHecho: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? "Puntos Don Guando", points_per_pen: p ? String(Number(p.points_per_pen)) : "1", pen_per_point: p ? String(Number(p.pen_per_point)) : "0.05",
    min_redeem_points: String(p?.min_redeem_points ?? 100), expiry_months: String(p?.expiry_months ?? 12), referral_bonus_points: String(p?.referral_bonus_points ?? 200), status: p?.status ?? "ACTIVE" });
  const c = (x: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [x]: e.target.value });
  return (
    <Dialogo titulo={p ? "Editar programa de puntos" : "Crear programa de puntos"} boton="Guardar" onClose={onClose}
      aviso="Los cambios valen para los puntos que se ganen desde ahora. Los puntos ya ganados conservan su fecha de vencimiento."
      enviar={async () => {
        await api("/v1/cmp/puntos", { method: "PUT", body: { name: f.name, points_per_pen: num(f.points_per_pen), pen_per_point: num(f.pen_per_point), min_redeem_points: Number(f.min_redeem_points),
          expiry_months: Number(f.expiry_months), referral_bonus_points: Number(f.referral_bonus_points), status: f.status } });
        toast.ok("Programa guardado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Nombre" required error={e.name} className="sm:col-span-2"><Input value={f.name} onChange={c("name")} /></Field>
        <Field label="Puntos por cada S/ 1" required error={e.points_per_pen}><Input inputMode="decimal" value={f.points_per_pen} onChange={c("points_per_pen")} /></Field>
        <Field label="Valor de cada punto" required error={e.pen_per_point}><Input inputMode="decimal" prefix="S/" value={f.pen_per_point} onChange={c("pen_per_point")} /></Field>
        <Field label="Canje mínimo" required error={e.min_redeem_points}><Input inputMode="numeric" suffix="puntos" value={f.min_redeem_points} onChange={c("min_redeem_points")} /></Field>
        <Field label="Vencen a los" required error={e.expiry_months}><Input inputMode="numeric" suffix="meses" value={f.expiry_months} onChange={c("expiry_months")} /></Field>
        <Field label="Bono por referido" required error={e.referral_bonus_points}><Input inputMode="numeric" suffix="puntos" value={f.referral_bonus_points} onChange={c("referral_bonus_points")} /></Field>
        <Field label="Estado" error={e.status}><Select value={f.status} onChange={c("status")} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>
      </>}
    </Dialogo>
  );
}
