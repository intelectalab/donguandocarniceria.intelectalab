"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, Field, Input, Modal, PageHeader, Select, StatusBadge, buttonClass, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { Seccion, SinPermiso, Vacio, useDatos, usePermisosGas } from "@/modulos/gas/comunes";

type Fondo = {
  id: string; establishment_id: string; local: string; custodian_user_id: string; responsable: string; cash_account_id: string | null; cuenta: string | null;
  status: string; fund_amount: number; max_expense_amount: number; ocupado: number; saldo: number; abierta: { id: string; number: string; total: number } | null;
  dias_sin_rendir: number | null; por_reponer: number; responsable_con_acceso: boolean;
};
type Datos = {
  fondos: Fondo[]; gestiona: boolean; responsables: { id: string; name: string }[];
  cuentas: { id: string; name: string; establishment_id: string | null }[]; locales: { id: string; code: string; name: string }[];
};

/** GAS-07 Caja chica: un fondo por local con su responsable, saldo y la rendición abierta (RN-GAS-09). */
export default function CajaChica() {
  const p = usePermisosGas();
  const { datos, error, cargando, recargar } = useDatos<Datos>("/v1/gas/caja-chica");
  const [editar, setEditar] = useState<Fondo | "nuevo" | null>(null);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error) return error.includes("permiso") ? <SinPermiso que="La caja chica la ve administración y el responsable de cada fondo." /> : <Alert tone="bad">{error}</Alert>;
  const d = datos!;
  const activos = d.fondos.filter((f) => f.status === "ACTIVE");
  const peor = Math.max(0, ...activos.map((f) => f.dias_sin_rendir ?? 0));
  return (
    <div className="space-y-4">
      <PageHeader description="Cada local tiene un fondo fijo con un responsable. Los gastos pagados con el fondo bajan el saldo; al rendirlos y reponerlos, el fondo vuelve a su monto."
        actions={d.gestiona && <Button variant="primary" icon={Plus} onClick={() => setEditar("nuevo")}>Fondo</Button>} />
      {!d.gestiona && d.fondos.length === 0 && (
        <SinPermiso que={p.crea ? "No eres responsable de ningún fondo de caja chica. Tus gastos de caja chica los ves en «Mis gastos»." : "La caja chica la maneja administración."} />
      )}
      {d.fondos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Cifra titulo="Saldo en fondos" valor={soles(activos.reduce((s, f) => s + f.saldo, 0))} detalle={`${activos.length} fondos activos`} destacada />
          <Cifra titulo="Gastado sin reponer" valor={soles(activos.reduce((s, f) => s + f.ocupado, 0))} />
          <Cifra titulo="Días sin rendir" valor={String(peor)} detalle="El gasto más antiguo de una rendición abierta" tono={peor > 7 ? "warn" : "ok"} />
        </div>
      )}
      {d.gestiona && d.fondos.length === 0 && <Alert tone="info">Todavía no hay fondos. Crea uno por local con su responsable y su monto.</Alert>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {d.fondos.map((f) => <Tarjeta key={f.id} f={f} gestiona={d.gestiona} onEditar={() => setEditar(f)} />)}
      </div>
      {d.fondos.length > 0 && <p className="text-[13px] text-muted">Las rendiciones enviadas, aprobadas y repuestas están en <Link href="/m/gas/gas-08" className="font-medium text-primary hover:underline">Rendición de caja chica</Link>.</p>}
      {editar && <Formulario d={d} f={editar === "nuevo" ? null : editar} onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </div>
  );
}

function Tarjeta({ f, gestiona, onEditar }: { f: Fondo; gestiona: boolean; onEditar: () => void }) {
  const usado = f.fund_amount > 0 ? Math.min(100, Math.round((f.ocupado / f.fund_amount) * 100)) : 0;
  const tono = usado >= 80 ? "bg-bad" : usado >= 50 ? "bg-warn" : "bg-ok";
  return (
    <Seccion titulo={f.local} acciones={<StatusBadge status={f.status} />}>
      <div className="space-y-3">
        <div>
          <p className="text-[12px] text-muted">Saldo</p>
          <p className="text-[22px] font-semibold text-ink">{soles(f.saldo)} <span className="text-[13px] font-normal text-muted">de {soles(f.fund_amount)}</span></p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={usado} aria-valuemin={0} aria-valuemax={100} aria-label="Fondo usado">
            <div className={`h-full ${tono}`} style={{ width: `${usado}%` }} />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Responsable</dt><dd className="text-right text-ink">{f.responsable}</dd>
          <dt className="text-muted">Máximo por gasto</dt><dd className="text-right text-ink">{soles(f.max_expense_amount)}</dd>
          <dt className="text-muted">Gastado sin reponer</dt><dd className="text-right text-ink">{soles(f.ocupado)}</dd>
          {f.por_reponer > 0 && <><dt className="text-muted">Rendido por reponer</dt><dd className="text-right text-ink">{soles(f.por_reponer)}</dd></>}
          <dt className="text-muted">Cuenta</dt><dd className="truncate text-right text-ink">{f.cuenta ?? "—"}</dd>
        </dl>
        {gestiona && !f.responsable_con_acceso && <Alert tone="warn">{f.responsable} no tiene acceso a Gastos: no puede ver el fondo ni enviar la rendición. Dale acceso en Seguridad o envíala tú.</Alert>}
        {f.dias_sin_rendir !== null && f.dias_sin_rendir > 7 && <Badge tone="warn">{f.dias_sin_rendir} días sin rendir</Badge>}
        <div className="flex flex-wrap gap-2">
          {f.abierta
            ? <Link href={`/m/gas/gas-08?id=${f.abierta.id}`} className={buttonClass("primary")}>Rendición {f.abierta.number} · {soles(f.abierta.total)}</Link>
            : <span className="text-[13px] text-muted">Sin gastos por rendir.</span>}
          {gestiona && <Button icon={Pencil} onClick={onEditar}>Editar</Button>}
        </div>
      </div>
    </Seccion>
  );
}

function Formulario({ d, f, onClose, onListo }: { d: Datos; f: Fondo | null; onClose: () => void; onListo: () => void }) {
  const [v, setV] = useState({
    establishment_id: f?.establishment_id ?? "", custodian_user_id: f?.custodian_user_id ?? "", fund_amount: f ? String(f.fund_amount) : "",
    max_expense_amount: f ? String(f.max_expense_amount) : "", cash_account_id: f?.cash_account_id ?? "", status: f?.status ?? "ACTIVE",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const pon = (k: keyof typeof v, x: string) => setV((y) => ({ ...y, [k]: x }));
  const cuentas = d.cuentas.filter((c) => !c.establishment_id || !v.establishment_id || c.establishment_id === v.establishment_id);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      await api(f ? `/v1/gas/caja-chica/${f.id}` : "/v1/gas/caja-chica", { method: f ? "PUT" : "POST", body: {
        ...v, fund_amount: Number(v.fund_amount), max_expense_amount: Number(v.max_expense_amount), cash_account_id: v.cash_account_id || null,
      } });
      toast.ok("Fondo guardado.");
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={f ? `Fondo de ${f.local}` : "Nuevo fondo de caja chica"} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-fondo" loading={guardando}>Guardar</Button></>}>
      <form id="f-fondo" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Local" required>
          <Select value={v.establishment_id} disabled={Boolean(f)} onChange={(e) => pon("establishment_id", e.target.value)} placeholder="Elige el local"
            options={d.locales.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))} />
        </Field>
        <Field label="Responsable" required hint="Custodia el efectivo y envía la rendición.">
          <Select value={v.custodian_user_id} onChange={(e) => pon("custodian_user_id", e.target.value)} placeholder="Elige" options={d.responsables.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Monto del fondo (S/)" required><Input type="number" inputMode="decimal" min="0" step="0.01" value={v.fund_amount} onChange={(e) => pon("fund_amount", e.target.value)} /></Field>
          <Field label="Máximo por gasto (S/)" required><Input type="number" inputMode="decimal" min="0" step="0.01" value={v.max_expense_amount} onChange={(e) => pon("max_expense_amount", e.target.value)} /></Field>
        </div>
        <Field label="Cuenta de caja chica" hint="La cuenta de Caja y bancos donde está el efectivo. Puede quedar vacía.">
          <Select value={v.cash_account_id} onChange={(e) => pon("cash_account_id", e.target.value)} placeholder="Sin cuenta" options={cuentas.map((c) => ({ value: c.id, label: c.name }))} />
        </Field>
        {f && <Field label="Estado"><Select value={v.status} onChange={(e) => pon("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} /></Field>}
      </form>
    </Modal>
  );
}
