"use client";

import { useState } from "react";
import { CheckCircle2, Hash, Percent, Wallet } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { CANAL, ESTADOS_MEDIO, TIPO_ENTIDAD, TIPO_MEDIO, pct, useDatos } from "@/modulos/mae/tipos";

type Medio = {
  id: string; code: string; system_code: string | null; name: string; kind: string; requires_reference: boolean; allowed_on_delivery: boolean;
  status: string; institution_code: string | null; entidad: string | null; connector_code: string | null; settlement_days: number | null;
  allowed_channels: string[]; comision_vigente: { fee_pct: number; fee_fixed: number; igv_included: boolean } | null; cobros_mes: number; cobrado_mes: number;
};
type Datos = {
  medios: Medio[]; mes: string; canales: string[]; entidades: { code: string; name: string; kind: string }[];
  cifras: { activos: number; total: number; exigen_referencia: number; cobrado_mes: number; cobros_mes: number; comision_mp: number | null };
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const abono = (d: number | null) => (d ? `${d} día${d === 1 ? "" : "s"}` : "Inmediato");

/**
 * MAE-03 Medios de pago: los 7 medios con su entidad, canales, plazo de abono y conector. Los del sistema no se borran
 * ni cambian de código (RN-MAE-03); se configuran y se desactivan con motivo.
 */
export default function MediosDePago() {
  const { puede, can } = useSesion();
  const { datos, error, recargar } = useDatos<Datos>("/v1/mae/medios");
  const [abierto, setAbierto] = useState<Medio | null>(null);
  const [configurando, setConfigurando] = useState<Medio | null>(null);
  const gestiona = can("mae.payment_method.manage") && puede("MAE", "E");
  const c = datos?.cifras;
  const mes = datos ? MESES[Number(datos.mes.slice(5, 7)) - 1] : "";

  async function cambiarEstado(m: Medio) {
    const activar = m.status !== "ACTIVE";
    const r = await confirmAction({
      title: `${activar ? "Activar" : "Desactivar"} ${m.name}`, confirmLabel: activar ? "Activar" : "Desactivar", danger: !activar,
      message: activar ? "Vuelve a aceptarse en los canales configurados." : "Deja de aceptarse en cobros nuevos. Los cobros ya registrados no cambian.",
      reason: { min: 5, label: "Motivo del cambio" },
    });
    if (!r) return;
    try {
      await api(`/v1/mae/medios/${m.id}/estado`, { method: "POST", body: { active: activar, reason: r.reason } });
      toast.ok(activar ? "Medio activado" : "Medio desactivado");
      setAbierto(null);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Medio>[] = [
    { key: "system_code", header: "Código", render: (m) => <span className="font-mono text-[12.5px]">{m.system_code ?? m.code}</span> },
    { key: "name", header: "Medio", cardTitle: true, render: (m) => <span className="font-semibold">{m.name}</span> },
    { key: "kind", header: "Tipo", render: (m) => TIPO_MEDIO[m.kind] ?? m.kind },
    { key: "entidad", header: "Entidad", hideOnMobile: true, render: (m) => m.entidad ?? (m.system_code === "POS_VISA" ? <span className="text-warn">Por definir</span> : "—") },
    { key: "requires_reference", header: "N.º de operación", render: (m) => m.requires_reference ? <Badge tone="warn">Obligatorio</Badge> : <Badge>No pide</Badge> },
    { key: "allowed_channels", header: "Canales", hideOnMobile: true, render: (m) => m.allowed_channels.map((x) => CANAL[x] ?? x).join(", ") || "—" },
    { key: "settlement_days", header: "Abono", align: "right", render: (m) => abono(m.settlement_days) },
    { key: "connector_code", header: "Conector", hideOnMobile: true, render: (m) => m.connector_code ?? "—" },
    { key: "cobrado_mes", header: `Cobrado ${mes.slice(0, 3)}.`, align: "right", hideOnMobile: true, render: (m) => soles(m.cobrado_mes) },
    { key: "status", header: "Estado", render: (m) => <StatusBadge status={m.status} labels={ESTADOS_MEDIO} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Los 7 medios con su entidad, canales, plazo de abono y conector. Los del sistema no se borran ni cambian de código: se configuran o se desactivan." />

      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Medios activos" valor={c ? `${c.activos} de ${c.total}` : undefined} icono={CheckCircle2} destacada />
        <Cifra titulo="Exigen n.º de operación" valor={c ? numero(c.exigen_referencia) : undefined} detalle="Yape, Plin, POS, Mercado Pago, transferencia" icono={Hash} />
        <Cifra titulo={`Cobrado en ${mes}`} valor={c ? soles(c.cobrado_mes) : undefined} detalle={c ? `${numero(c.cobros_mes)} cobros` : undefined} icono={Wallet} />
        <Cifra titulo="Comisión de Mercado Pago" valor={c ? pct(c.comision_mp) : undefined} detalle="Vigente hoy · tasa a confirmar" icono={Percent} />
      </div>

      <DataTable columns={columnas} rows={datos?.medios ?? []} loading={!datos && !error} onRowClick={setAbierto} empty="No hay medios de pago." />

      {datos && <ValidarCobro medios={datos.medios} />}

      {abierto && (
        <Modal open title={abierto.name} onClose={() => setAbierto(null)}
          footer={gestiona ? <>
            <Button variant={abierto.status === "ACTIVE" ? "danger" : "primary"} onClick={() => cambiarEstado(abierto)}>{abierto.status === "ACTIVE" ? "Desactivar" : "Activar"}</Button>
            <Button variant="primary" onClick={() => { setConfigurando(abierto); setAbierto(null); }}>Configurar</Button>
          </> : undefined}>
          <div className="space-y-4">
            <DetailList items={[
              { label: "Código del sistema", value: abierto.system_code ?? abierto.code },
              { label: "Tipo", value: TIPO_MEDIO[abierto.kind] ?? abierto.kind },
              { label: "Entidad", value: abierto.entidad ?? "—" },
              { label: "Exige número de operación", value: abierto.requires_reference ? "Sí" : "No" },
              { label: "Permitido contra entrega", value: abierto.allowed_on_delivery ? "Sí" : "No" },
              { label: "Canales", value: abierto.allowed_channels.map((x) => CANAL[x] ?? x).join(", ") || "—" },
              { label: "Plazo de abono", value: abono(abierto.settlement_days) },
              { label: "Conector", value: abierto.connector_code ?? "—" },
              { label: "Comisión vigente", value: abierto.comision_vigente ? `${pct(abierto.comision_vigente.fee_pct)} + ${soles(abierto.comision_vigente.fee_fixed)}${abierto.comision_vigente.igv_included ? " (IGV incluido)" : " (más IGV)"}` : "Sin comisión registrada" },
              { label: "Estado", value: <StatusBadge status={abierto.status} labels={ESTADOS_MEDIO} /> },
            ]} />
            {!gestiona && <Alert tone="info">Configurar o desactivar un medio exige el permiso de gestionar medios de pago.</Alert>}
            <p className="text-[12.5px] text-muted">Los medios del sistema no se eliminan ni cambian su código o tipo: se pueden desactivar.</p>
          </div>
        </Modal>
      )}

      {configurando && datos && (
        <Configurar medio={configurando} canales={datos.canales} entidades={datos.entidades} onClose={() => setConfigurando(null)}
          onGuardado={() => { setConfigurando(null); recargar(); }} />
      )}
    </div>
  );
}

/** RN-MAE-03: nombre, entidad, plazo de abono, canales y contra entrega, con motivo del cambio. */
function Configurar({ medio, canales, entidades, onClose, onGuardado }: {
  medio: Medio; canales: string[]; entidades: Datos["entidades"]; onClose: () => void; onGuardado: () => void;
}) {
  const [v, setV] = useState({
    name: medio.name, institution_code: medio.institution_code ?? "", settlement_days: String(medio.settlement_days ?? 0),
    allowed_channels: medio.allowed_channels, allowed_on_delivery: medio.allowed_on_delivery, reason: "",
  });
  const canal = (x: string, si: boolean) => setV({ ...v, allowed_channels: si ? [...v.allowed_channels, x] : v.allowed_channels.filter((y) => y !== x) });

  return (
    <Dialogo titulo={`Configurar ${medio.name}`} boton="Guardar configuración" onClose={onClose}
      enviar={async () => {
        await api(`/v1/mae/medios/${medio.id}`, { method: "PUT", body: { ...v, institution_code: v.institution_code || null, settlement_days: Number(v.settlement_days) } });
        toast.ok("Medio de pago actualizado");
        onGuardado();
      }}>
      {(e) => <>
        <Field label="Nombre visible" required error={e.name}><Input value={v.name} onChange={(x) => setV({ ...v, name: x.target.value })} /></Field>
        <Field label="Entidad" error={e.institution_code}>
          <Select value={v.institution_code} onChange={(x) => setV({ ...v, institution_code: x.target.value })} placeholder="Sin entidad"
            options={entidades.map((f) => ({ value: f.code, label: `${f.name} · ${TIPO_ENTIDAD[f.kind] ?? f.kind}` }))} />
        </Field>
        <Field label="Plazo de abono (días)" required error={e.settlement_days} hint="0 = inmediato">
          <Input type="number" min={0} max={60} value={v.settlement_days} onChange={(x) => setV({ ...v, settlement_days: x.target.value })} />
        </Field>
        <Field label="Contra entrega" error={e.allowed_on_delivery}>
          <Checkbox label="Permitido contra entrega" checked={v.allowed_on_delivery} onChange={(si) => setV({ ...v, allowed_on_delivery: si })} />
        </Field>
        <Field label="Canales" required error={e.allowed_channels ?? e["allowed_channels.0"]} className="sm:col-span-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {canales.map((x) => <Checkbox key={x} label={CANAL[x] ?? x} checked={v.allowed_channels.includes(x)} onChange={(si) => canal(x, si)} />)}
          </div>
        </Field>
        <Field label="Motivo del cambio" required error={e.reason} className="sm:col-span-2"><Input value={v.reason} onChange={(x) => setV({ ...v, reason: x.target.value })} /></Field>
      </>}
    </Dialogo>
  );
}

/** RN-MAE-04: prueba si un cobro trae el número de operación que exige su medio. */
function ValidarCobro({ medios }: { medios: Medio[] }) {
  const [medio, setMedio] = useState(medios[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  async function validar() {
    try {
      await api("/v1/mae/medios/validar", { method: "POST", body: { payment_method_id: medio, reference: ref || null } });
      setResultado({ ok: true, texto: "El cobro tiene los datos que exige el medio." });
    } catch (e) {
      setResultado({ ok: false, texto: mensajeDe(e) });
    }
  }
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[15px] font-semibold">Validar un cobro</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end [&>*]:min-w-0">
        <Field label="Medio"><Select value={medio} onChange={(x) => { setMedio(x.target.value); setResultado(null); }} options={medios.map((m) => ({ value: m.id, label: m.name }))} /></Field>
        <Field label="Número de operación"><Input value={ref} onChange={(x) => { setRef(x.target.value); setResultado(null); }} /></Field>
        <Button variant="primary" onClick={validar}>Validar</Button>
      </div>
      {resultado && <div className="mt-3"><Alert tone={resultado.ok ? "ok" : "bad"}>{resultado.texto}</Alert></div>}
    </section>
  );
}
