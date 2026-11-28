"use client";

import { useState } from "react";
import { Banknote, Building2, Plus, Smartphone, Wallet } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, StatusBadge, Textarea, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { CONCILIACION, Linea, Qr, Seccion, TIPOS_CUENTA, Vacio, n, useDatos } from "@/modulos/caj/comunes";

type Cuenta = {
  id: string; code: string; name: string; account_type: string; tipo: string; establishment_id: string | null; brand_id: string | null; local: string | null; marca: string | null;
  bank_name: string | null; account_number: string | null; cci: string | null; holder_name: string | null; titular_trabajador: string | null; usuario: string | null;
  qr_payload: string | null; tiene_qr: boolean; payment_link_base: string | null; fee_pct: string | null; fee_fixed: string | null; settlement_days: number | null;
  opening_balance: string | null; max_balance: string | null; status: string; saldo: number; sobre_tope: boolean; por_conciliar: number;
  detalle_saldo: { saldo: number; cobros: number; entradas: number; salidas: number; otros: number };
};
type Respuesta = { cuentas: Cuenta[]; tipos: Record<string, string>; puede_editar: boolean; total: number };
type Opciones = { tipos: { value: string; label: string }[]; locales: { id: string; name: string }[]; marcas: { id: string; name: string }[] };
type Form = Record<string, string>;

const EFECTIVO = ["CASH_REGISTER", "PETTY_CASH", "DRIVER_CASH"];
const DIGITAL = ["WALLET", "GATEWAY", "CARD_ACQUIRER"];

/** CAJ-01 Cuentas: por tipo, con saldo, local, marca, titular, comisión y días de abono. */
export default function Cuentas() {
  const [f, setF] = useState({ tipo: "", estado: "ACTIVE" });
  const p = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { datos, error, cargando, recargar } = useDatos<Respuesta>(`/v1/caj/cuentas?${p}`);
  const { datos: op } = useDatos<Opciones>(datos?.puede_editar ? "/v1/caj/cuentas/opciones" : null);
  const [editando, setEditando] = useState<{ id: string | null; form: Form } | null>(null);
  const [viendo, setViendo] = useState<Cuenta | null>(null);
  const filas = datos?.cuentas ?? [];
  const activas = filas.filter((c) => c.status === "ACTIVE");
  const suma = (tipos: string[]) => activas.filter((c) => tipos.includes(c.account_type)).reduce((s, c) => s + n(c.saldo), 0);

  const columnas: Column<Cuenta>[] = [
    { key: "name", header: "Cuenta", cardTitle: true, render: (c) => (
      <div className="min-w-0"><div className="font-medium">{c.name}</div><div className="text-[12px] text-muted">{c.code} · {c.tipo}</div></div>
    ) },
    { key: "local", header: "Local y marca", render: (c) => <div className="text-[13px]">{c.local ?? "Todos los locales"}<div className="text-[12px] text-muted">{c.marca ?? "Todas las marcas"}</div></div> },
    { key: "holder_name", header: "Titular", hideOnMobile: true, render: (c) => c.holder_name ?? c.titular_trabajador ?? c.usuario ?? <span className="text-muted">—</span> },
    { key: "fee_pct", header: "Comisión y abono", hideOnMobile: true, render: (c) => (DIGITAL.includes(c.account_type)
      ? <span className="text-[13px]">{numero(n(c.fee_pct), 2)} %{n(c.fee_fixed) ? ` + ${soles(c.fee_fixed)}` : ""}<span className="block text-[12px] text-muted">abona a {c.settlement_days ?? 0} días</span></span>
      : <span className="text-muted">—</span>) },
    { key: "saldo", header: "Saldo", align: "right", render: (c) => (
      <div className="text-right"><span className={`font-semibold tabular-nums ${c.saldo < 0 ? "text-bad" : ""}`}>{soles(c.saldo)}</span>
        {c.account_type === "DRIVER_CASH" && <div className="text-[11.5px] text-muted">por liquidar</div>}
        {c.sobre_tope && <div className="text-[11.5px] text-warn">pasa el tope de {soles(c.max_balance)}</div>}
        {c.por_conciliar > 0 && <div className="text-[11.5px] text-muted">{c.por_conciliar} por conciliar</div>}</div>
    ) },
    { key: "status", header: "Estado", render: (c) => <StatusBadge status={c.status} /> },
  ];

  const abrir = (c: Cuenta | null) => setEditando({
    id: c?.id ?? null,
    form: c ? Object.fromEntries(Object.entries({
      code: c.code, name: c.name, account_type: c.account_type, establishment_id: c.establishment_id, brand_id: c.brand_id, bank_name: c.bank_name, account_number: c.account_number,
      cci: c.cci, holder_name: c.holder_name, qr_payload: c.qr_payload, payment_link_base: c.payment_link_base, fee_pct: c.fee_pct, fee_fixed: c.fee_fixed,
      settlement_days: c.settlement_days, opening_balance: c.opening_balance, max_balance: c.max_balance, status: c.status,
    }).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)])) : { account_type: "BANK", status: "ACTIVE", opening_balance: "0" },
  });

  return (
    <div className="space-y-5">
      <PageHeader description="Dónde está el dinero: cajas de efectivo, cajas de los repartidores, billeteras, pasarela, POS de tarjeta y bancos. Los datos de pago que ve el cliente salen de aquí y solo los cambia la gerencia."
        actions={datos?.puede_editar && <Button variant="primary" icon={Plus} disabled={!op} onClick={() => abrir(null)}>Nueva cuenta</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Total en cuentas" icono={Wallet} destacada valor={datos ? soles(datos.total) : undefined} detalle={datos ? `${activas.length} cuentas activas` : ""} />
        <Cifra titulo="Efectivo" icono={Banknote} valor={datos ? soles(suma(EFECTIVO)) : undefined} detalle="Cajas y repartidores" />
        <Cifra titulo="Digital por abonar" icono={Smartphone} valor={datos ? soles(suma(DIGITAL)) : undefined} detalle="Yape, Plin, pasarela y POS" />
        <Cifra titulo="Bancos" icono={Building2} valor={datos ? soles(suma(["BANK"])) : undefined} detalle="Según cobros, traslados y abonos" />
      </div>
      <DataTable rows={filas} columns={columnas} loading={cargando} error={error} onRetry={recargar} onRowClick={(c) => setViendo(c)} empty="No hay cuentas con estos filtros."
        toolbar={<>
          <FiltroSelect etiqueta="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={Object.entries(TIPOS_CUENTA).map(([value, label]) => ({ value, label }))} ancho={190} />
          <FiltroSelect etiqueta="Estado" value={f.estado} onChange={(v) => setF({ ...f, estado: v })} options={[{ value: "ACTIVE", label: "Activas" }, { value: "INACTIVE", label: "Inactivas" }]} vacio="Activas e inactivas" ancho={170} />
        </>} />
      {viendo && <DetalleCuenta cuenta={viendo} puedeEditar={Boolean(datos?.puede_editar && op)} onClose={() => setViendo(null)}
        onEditar={() => { abrir(viendo); setViendo(null); }} />}
      {editando && op && (
        <FormCuenta key={editando.id ?? "nueva"} id={editando.id} inicial={editando.form} op={op} onClose={() => setEditando(null)}
          onGuardada={() => { setEditando(null); recargar(); }} />
      )}
    </div>
  );
}

type Movs = {
  cuenta: { id: string; code: string; name: string }; saldo: { saldo: number; cobros: number; entradas: number; salidas: number; otros: number } | null;
  cobros: { id: string; number: string; at: string; amount: string; status: string; reference: string | null; medio: string; cliente: string | null; reconciliation_status: string }[];
  traslados: { id: string; at: string; amount: string; reference: string; reason: string; desde: string; hacia: string; sale: boolean }[];
};

function DetalleCuenta({ cuenta: c, puedeEditar, onClose, onEditar }: { cuenta: Cuenta; puedeEditar: boolean; onClose: () => void; onEditar: () => void }) {
  const { datos } = useDatos<Movs>(`/v1/caj/cuentas/${c.id}/movimientos`);
  const s = c.detalle_saldo;
  return (
    <Modal open onClose={onClose} title={c.name} description={`${c.code} · ${c.tipo}`} size="lg"
      footer={<>{puedeEditar && <Button onClick={onEditar}>Editar cuenta</Button>}<Button variant="primary" onClick={onClose}>Cerrar</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Seccion titulo="Saldo">
            {c.account_type === "DRIVER_CASH" ? (<>
              <Linea t="Cobros en efectivo sin liquidar" v={soles(s.cobros)} />
              <Linea t="Gastos pagados con ese efectivo" v={`−${soles(s.salidas)}`} />
              <Linea t="Por liquidar" v={soles(s.saldo)} fuerte />
            </>) : (<>
              <Linea t="Saldo inicial" v={soles(c.opening_balance)} />
              <Linea t="Cobros vigentes" v={soles(s.cobros)} />
              <Linea t="Traslados recibidos" v={soles(s.entradas)} />
              <Linea t="Traslados, comisiones, devoluciones y gastos" v={`−${soles(s.salidas)}`} />
              {s.otros !== 0 && <Linea t="Mostrador y reposiciones de caja chica" v={soles(s.otros)} />}
              <Linea t="Saldo según el sistema" v={soles(s.saldo)} fuerte tono={s.saldo < 0 ? "bad" : undefined} />
            </>)}
          </Seccion>
          <Seccion titulo="Datos de pago">
            <div className="space-y-1 text-[13.5px]">
              {c.bank_name && <p>{c.bank_name}</p>}
              {c.account_number && <p>Número: <span className="font-medium">{c.account_number}</span></p>}
              {c.cci && <p>CCI: {c.cci}</p>}
              {c.holder_name && <p>Titular: {c.holder_name}</p>}
              {c.payment_link_base && <p className="break-all">Enlace: {c.payment_link_base}</p>}
              {c.qr_payload && <div className="pt-2"><Qr texto={c.qr_payload} tamano={140} /></div>}
              {!c.qr_payload && c.tiene_qr && <p className="text-muted">Tiene QR oficial (lo ve la gerencia).</p>}
              {!c.bank_name && !c.account_number && !c.payment_link_base && !c.tiene_qr && <Vacio>Sin datos de pago.</Vacio>}
            </div>
          </Seccion>
        </div>
        <Seccion titulo="Últimos movimientos (14 días)">
          {!datos ? <Vacio>Cargando…</Vacio> : !datos.cobros.length && !datos.traslados.length ? <Vacio>Sin movimientos en estos días.</Vacio> : (
            <ul className="divide-y divide-line">
              {datos.traslados.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0"><div>{t.sale ? `Traslado a ${t.hacia}` : `Traslado desde ${t.desde}`}</div><div className="text-[12px] text-muted">{fechaHora(t.at)} · {t.reference} · {t.reason}</div></div>
                  <span className={`shrink-0 tabular-nums ${t.sale ? "text-bad" : "text-ok"}`}>{t.sale ? "−" : "+"}{soles(t.amount)}</span>
                </li>
              ))}
              {datos.cobros.slice(0, 40).map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <div className="min-w-0"><div>{p.number} · {p.medio}{p.cliente ? ` · ${p.cliente}` : ""}</div>
                    <div className="text-[12px] text-muted">{fechaHora(p.at)}{p.reference ? ` · op. ${p.reference}` : ""} · {CONCILIACION[p.reconciliation_status]?.[0] ?? p.reconciliation_status}</div></div>
                  <span className={`shrink-0 tabular-nums ${p.status === "REVERSED" ? "text-muted line-through" : ""}`}>{soles(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    </Modal>
  );
}

function FormCuenta({ id, inicial, op, onClose, onGuardada }: { id: string | null; inicial: Form; op: Opciones; onClose: () => void; onGuardada: () => void }) {
  const [f, setF] = useState<Form>(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const poner = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const tipo = f.account_type;
  const repartidor = tipo === "DRIVER_CASH";
  const digital = DIGITAL.includes(tipo);

  async function guardar() {
    setGuardando(true);
    setErrores({});
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
      await api(id ? `/v1/caj/cuentas/${id}` : "/v1/caj/cuentas", { method: id ? "PUT" : "POST", body });
      toast.ok(id ? "Cuenta guardada." : "Cuenta creada.");
      onGuardada();
    } catch (e) {
      setErrores(erroresDe(e));
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={id ? `Cuenta ${inicial.name}` : "Nueva cuenta"} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!f.code?.trim() || !f.name?.trim()} onClick={guardar}>Guardar</Button></>}>
      {repartidor && <Alert tone="info">La caja del repartidor la crea el reparto: aquí solo cambias su nombre, tope y estado.</Alert>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Código" required error={errores.code}><Input value={f.code ?? ""} maxLength={40} disabled={repartidor} onChange={(e) => poner("code", e.target.value.toUpperCase())} placeholder="BBVA-CTE" /></Field>
        <Field label="Nombre" required error={errores.name}><Input value={f.name ?? ""} maxLength={80} onChange={(e) => poner("name", e.target.value)} placeholder="BBVA cuenta corriente soles" /></Field>
        {!repartidor && (<>
          <Field label="Tipo" required error={errores.account_type}>
            <Select value={tipo} onChange={(e) => poner("account_type", e.target.value)} options={op.tipos} />
          </Field>
          <Field label="Local" error={errores.establishment_id} hint={["CASH_REGISTER", "PETTY_CASH"].includes(tipo) ? "Una caja de efectivo es de un local." : "Vacío: sirve a todos los locales."}>
            <Select value={f.establishment_id ?? ""} placeholder="Todos los locales" onChange={(e) => poner("establishment_id", e.target.value)} options={op.locales.map((l) => ({ value: l.id, label: l.name }))} />
          </Field>
          <Field label="Marca" error={errores.brand_id} hint="Vacío: recibe cobros de todas las marcas.">
            <Select value={f.brand_id ?? ""} placeholder="Todas las marcas" onChange={(e) => poner("brand_id", e.target.value)} options={op.marcas.map((m) => ({ value: m.id, label: m.name }))} />
          </Field>
          <Field label="Titular" error={errores.holder_name}><Input value={f.holder_name ?? ""} maxLength={80} onChange={(e) => poner("holder_name", e.target.value)} /></Field>
          {(tipo === "BANK" || tipo === "WALLET") && <Field label={tipo === "BANK" ? "Banco" : "Banco de la billetera"} error={errores.bank_name}><Input value={f.bank_name ?? ""} maxLength={40} onChange={(e) => poner("bank_name", e.target.value)} /></Field>}
          {(tipo === "BANK" || tipo === "WALLET" || digital) && (
            <Field label={tipo === "WALLET" ? "Número de celular" : tipo === "BANK" ? "Número de cuenta" : "Código de comercio"} error={errores.account_number}>
              <Input value={f.account_number ?? ""} maxLength={40} onChange={(e) => poner("account_number", e.target.value)} />
            </Field>
          )}
          {tipo === "BANK" && <Field label="CCI" error={errores.cci}><Input value={f.cci ?? ""} maxLength={80} onChange={(e) => poner("cci", e.target.value)} /></Field>}
          {tipo === "GATEWAY" && <Field label="Enlace de pago" error={errores.payment_link_base} className="sm:col-span-2"><Input value={f.payment_link_base ?? ""} maxLength={255} placeholder="https://link.mercadopago.com.pe/…" onChange={(e) => poner("payment_link_base", e.target.value)} /></Field>}
          {tipo === "WALLET" && (
            <Field label="Texto del QR oficial" error={errores.qr_payload} hint="Lo que trae el QR de Yape o Plin de la empresa (lo lee cualquier lector de QR)." className="sm:col-span-2">
              <Textarea rows={3} value={f.qr_payload ?? ""} maxLength={2000} onChange={(e) => poner("qr_payload", e.target.value)} />
            </Field>
          )}
          {digital && (<>
            <Field label="Comisión (%)" error={errores.fee_pct}><Input type="number" step="0.0001" min={0} max={100} value={f.fee_pct ?? ""} onChange={(e) => poner("fee_pct", e.target.value)} /></Field>
            <Field label="Comisión fija (S/)" error={errores.fee_fixed}><Input type="number" step="0.01" min={0} value={f.fee_fixed ?? ""} onChange={(e) => poner("fee_fixed", e.target.value)} /></Field>
            <Field label="Días de abono" error={errores.settlement_days}><Input type="number" min={0} max={90} value={f.settlement_days ?? ""} onChange={(e) => poner("settlement_days", e.target.value)} /></Field>
          </>)}
          <Field label="Saldo inicial (S/)" error={errores.opening_balance}><Input type="number" step="0.01" value={f.opening_balance ?? ""} onChange={(e) => poner("opening_balance", e.target.value)} /></Field>
        </>)}
        <Field label="Tope de saldo (S/)" error={errores.max_balance} hint="Avisa cuando la cuenta pasa este monto (vacío: sin tope)."><Input type="number" step="0.01" min={0} value={f.max_balance ?? ""} onChange={(e) => poner("max_balance", e.target.value)} /></Field>
        {id && (
          <Field label="Estado" error={errores.status}>
            <Select value={f.status ?? "ACTIVE"} onChange={(e) => poner("status", e.target.value)} options={[{ value: "ACTIVE", label: "Activa" }, { value: "INACTIVE", label: "Inactiva" }]} />
          </Field>
        )}
      </div>
      {f.status === "INACTIVE" && <div className="mt-3"><Badge tone="warn">Una cuenta inactiva no recibe cobros ni traslados.</Badge></div>}
    </Modal>
  );
}
