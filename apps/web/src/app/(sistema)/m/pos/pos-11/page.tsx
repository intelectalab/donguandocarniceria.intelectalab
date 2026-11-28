"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { MODOS_BALANZA, type Caja } from "@/modulos/pos/tipos";

type Opciones = {
  locales: { id: string; code: string; name: string }[];
  almacenes: { id: string; code: string; name: string; establishment_id: string; wh_type: string }[];
  cajas_efectivo: { id: string; code: string; name: string; establishment_id: string | null }[];
  cuentas_tarjeta: { id: string; code: string; name: string; establishment_id: string | null; fee_pct: string }[];
  series_boleta: { id: string; series: string; brand_id: string; establishment_id: string | null; all_sites: boolean; marca: string }[];
  series_factura: { id: string; series: string; brand_id: string; establishment_id: string | null; all_sites: boolean; marca: string }[];
  listas: { id: string; code: string; name: string; brand_id: string | null }[];
  modos_balanza: [string, string][];
};
type Form = Partial<Record<"code" | "name" | "establishment_id" | "warehouse_id" | "cash_account_id" | "card_account_id" | "receipt_series_id" | "invoice_series_id" | "default_price_list_id" | "scale_mode" | "status", string>>;

/** POS-11 Cajas registradoras: local, almacén, caja de efectivo, cuenta del adquirente, series, modo de balanza y lista de precios. */
export default function Cajas() {
  const { can } = useSesion();
  const gestiona = can("pos.terminal.manage");
  const [version, setVersion] = useState(0);
  const [datos, setDatos] = useState<{ v: number; filas?: Caja[]; error?: string } | null>(null);
  const [op, setOp] = useState<Opciones | null>(null);
  const [editando, setEditando] = useState<{ id: string | null; form: Form } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Caja[]>("/v1/pos/cajas").then((f) => vigente && setDatos({ v: version, filas: f })).catch((e) => vigente && setDatos({ v: version, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [version]);

  useEffect(() => {
    if (!gestiona) return;
    let vigente = true;
    api<Opciones>("/v1/pos/cajas/opciones").then((o) => vigente && setOp(o)).catch(() => {});
    return () => { vigente = false; };
  }, [gestiona]);

  const columnas: Column<Caja>[] = [
    { key: "name", header: "Caja", cardTitle: true, render: (c) => <div><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted">{c.code} · {c.local}</div></div> },
    { key: "almacen", header: "Almacén", render: (c) => <div><div>{c.almacen}</div><div className="text-[12px] text-muted">{c.lista_precios ?? "Lista del canal mostrador"}</div></div> },
    { key: "serie_boleta", header: "Series", render: (c) => `${c.serie_boleta ? `B: ${c.serie_boleta}` : "B: de la marca"} · ${c.serie_factura ? `F: ${c.serie_factura}` : "F: de la marca"}` },
    { key: "scale_mode", header: "Balanza", hideOnMobile: true, render: (c) => MODOS_BALANZA[c.scale_mode] },
    { key: "turno_abierto", header: "Turno", render: (c) => (c.turno_abierto ? <Badge tone="ok">{c.turno_abierto} · {c.turno_cajera}</Badge> : <span className="text-muted">—</span>) },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} /> },
  ];

  const abrir = (c: Caja | null) => setEditando({
    id: c?.id ?? null,
    form: c ? {
      code: c.code, name: c.name, establishment_id: c.establishment_id, warehouse_id: c.warehouse_id, cash_account_id: c.cash_account_id ?? "", card_account_id: c.card_account_id ?? "",
      receipt_series_id: c.receipt_series_id ?? "", invoice_series_id: c.invoice_series_id ?? "", default_price_list_id: c.default_price_list_id ?? "", scale_mode: c.scale_mode, status: c.status,
    } : { scale_mode: "MANUAL", status: "ACTIVE" },
  });

  return (
    <div className="space-y-4">
      <PageHeader code="POS-11" description="Cada caja vende desde el almacén de su local, cobra en su caja de efectivo y emite con sus series (o las de cada marca si no tiene)."
        actions={gestiona && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => abrir(null)}>Nueva caja</Button>} />
      {!gestiona && <Alert tone="info">Solo consulta: la configuración de cajas la cambia la gerencia.</Alert>}
      <DataTable rows={datos?.filas ?? []} columns={columnas} loading={!datos} error={datos?.error} onRetry={() => setVersion((v) => v + 1)}
        onRowClick={gestiona && op ? (c) => abrir(c) : undefined} empty="No hay cajas registradoras." />
      {editando && op && (
        <FormCaja key={editando.id ?? "nueva"} id={editando.id} inicial={editando.form} op={op} onClose={() => setEditando(null)}
          onGuardada={() => { setEditando(null); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

function FormCaja({ id, inicial, op, onClose, onGuardada }: { id: string | null; inicial: Form; op: Opciones; onClose: () => void; onGuardada: () => void }) {
  const [f, setF] = useState<Form>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const poner = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));
  const local = f.establishment_id ?? "";
  const delLocal = <T extends { establishment_id: string | null; all_sites?: boolean }>(xs: T[]) => xs.filter((x) => !local || !x.establishment_id || x.establishment_id === local || x.all_sites);

  async function guardar() {
    setGuardando(true);
    setErrores({});
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
      await api(id ? `/v1/pos/cajas/${id}` : "/v1/pos/cajas", { method: id ? "PUT" : "POST", body });
      toast.ok(id ? "Caja guardada." : "Caja creada.");
      onGuardada();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const listo = f.code?.trim() && f.name?.trim() && f.establishment_id && f.warehouse_id && f.receipt_series_id;
  return (
    <Modal open onClose={onClose} title={id ? `Caja ${inicial.name}` : "Nueva caja"} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!listo} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Código" required error={errores.code}><Input value={f.code ?? ""} maxLength={20} onChange={(e) => poner("code", e.target.value.toUpperCase())} placeholder="MOS-2" /></Field>
        <Field label="Nombre" required error={errores.name}><Input value={f.name ?? ""} maxLength={80} onChange={(e) => poner("name", e.target.value)} placeholder="Mostrador 2" /></Field>
        <Field label="Local" required error={errores.establishment_id}>
          <Select value={local} placeholder="Elige el local" onChange={(e) => setF((x) => ({ ...x, establishment_id: e.target.value, warehouse_id: "", cash_account_id: "" }))}
            options={op.locales.map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label="Almacén que vende" required error={errores.warehouse_id} hint="El de exhibición del mostrador de ese local.">
          <Select value={f.warehouse_id ?? ""} placeholder="Elige el almacén" onChange={(e) => poner("warehouse_id", e.target.value)} disabled={!local}
            options={op.almacenes.filter((a) => a.establishment_id === local).map((a) => ({ value: a.id, label: `${a.name} (${a.code})` }))} />
        </Field>
        <Field label="Caja de efectivo" error={errores.cash_account_id}>
          <Select value={f.cash_account_id ?? ""} placeholder="Sin caja de efectivo" onChange={(e) => poner("cash_account_id", e.target.value)}
            options={delLocal(op.cajas_efectivo).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
        </Field>
        <Field label="Cuenta del adquirente (POS de tarjeta)" error={errores.card_account_id}>
          <Select value={f.card_account_id ?? ""} placeholder="Sin POS de tarjeta" onChange={(e) => poner("card_account_id", e.target.value)}
            options={op.cuentas_tarjeta.map((c) => ({ value: c.id, label: `${c.name} · comisión ${Number(c.fee_pct)} %` }))} />
        </Field>
        <Field label="Serie de boleta" required error={errores.receipt_series_id}>
          <Select value={f.receipt_series_id ?? ""} placeholder="Elige la serie" onChange={(e) => poner("receipt_series_id", e.target.value)}
            options={delLocal(op.series_boleta).map((s) => ({ value: s.id, label: `${s.series} · ${s.marca}${s.all_sites ? " · todos los locales" : ""}` }))} />
        </Field>
        <Field label="Serie de factura" error={errores.invoice_series_id} hint="Vacío: usa la serie de factura de cada marca.">
          <Select value={f.invoice_series_id ?? ""} placeholder="La de cada marca" onChange={(e) => poner("invoice_series_id", e.target.value)}
            options={delLocal(op.series_factura).map((s) => ({ value: s.id, label: `${s.series} · ${s.marca}` }))} />
        </Field>
        <Field label="Lista de precios por defecto" error={errores.default_price_list_id} hint="Vacío: la vigente del canal mostrador de cada marca.">
          <Select value={f.default_price_list_id ?? ""} placeholder="La del canal mostrador" onChange={(e) => poner("default_price_list_id", e.target.value)}
            options={op.listas.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))} />
        </Field>
        <Field label="Modo de balanza" error={errores.scale_mode} hint={f.scale_mode === "SCALE" ? "La balanza conectada aún no está integrada: la cajera digita el peso." : undefined}>
          <Select value={f.scale_mode ?? "MANUAL"} onChange={(e) => poner("scale_mode", e.target.value)} options={op.modos_balanza.map(([value, label]) => ({ value, label }))} />
        </Field>
        {id && (
          <Field label="Estado" error={errores.status} hint="No se desactiva con un turno abierto.">
            <Select value={f.status ?? "ACTIVE"} onChange={(e) => poner("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
