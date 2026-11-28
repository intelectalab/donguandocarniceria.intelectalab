"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Send, Undo2, Wallet } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, FiltroSelect, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { Seccion, SinPermiso, Vacio, columnasGasto, useDatos } from "@/modulos/gas/comunes";
import { Ficha } from "@/modulos/gas/Ficha";
import { RENDICIONES, type FilaGasto } from "@/modulos/gas/tipos";

type Fila = { id: string; number: string; status: string; estado: string; period_from: string; period_to: string; total: number; replenishment_amount: number | null; fund_id: string; local: string };
type Detalle = Omit<Fila, "fund_id" | "local"> & {
  fondo: { id: string; local: string; responsable: string; fund_amount: number; saldo: number };
  envio: string | null; submitted_at: string | null; aprobo: string | null; approved_at: string | null; reimbursed_at: string | null; cuenta_reposicion: string | null;
  devolvio: string | null; rejection_reason: string | null; gastos: FilaGasto[]; pendientes: number;
  puede: { enviar: boolean; aprobar: boolean; devolver: boolean; reponer: boolean };
};
type Cuenta = { id: string; name: string; account_type: string };

const EstadoR = ({ s }: { s: string }) => <StatusBadge status={s} labels={RENDICIONES} />;

/** GAS-08 Rendición de caja chica: el responsable envía los gastos del fondo, administración aprueba (otra persona) y registra la reposición. */
export default function Rendiciones() {
  return <Suspense fallback={<Vacio>Cargando…</Vacio>}><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const abrir = (x: string | null) => router.replace(x ? `/m/gas/gas-08?id=${x}` : "/m/gas/gas-08", { scroll: false });
  return id ? <Rendicion id={id} onVolver={() => abrir(null)} /> : <Lista onAbrir={abrir} />;
}

function Lista({ onAbrir }: { onAbrir: (id: string) => void }) {
  const { datos, error, cargando } = useDatos<Fila[]>("/v1/gas/rendiciones");
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error) return error.includes("permiso") ? <SinPermiso que="Las rendiciones las ve administración y el responsable de cada fondo." /> : <Alert tone="bad">{error}</Alert>;
  const todas = datos ?? [];
  const filas = todas.filter((r) => (!estado || r.status === estado) && `${r.number} ${r.local}`.toLowerCase().includes(q.toLowerCase()));
  const porAprobar = todas.filter((r) => r.status === "SUBMITTED");
  const porReponer = todas.filter((r) => r.status === "APPROVED");
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Rendición", cardTitle: true, render: (r) => <span className="flex flex-col"><span className="font-medium text-ink">{r.number}</span><span className="text-[12px] text-muted">{r.local}</span></span> },
    { key: "period_from", header: "Periodo", render: (r) => `${fecha(r.period_from)} al ${fecha(r.period_to)}` },
    { key: "total", header: "Gastos", align: "right", render: (r) => soles(r.total) },
    { key: "replenishment_amount", header: "Reposición", align: "right", hideOnMobile: true, render: (r) => (r.replenishment_amount !== null ? soles(r.replenishment_amount) : "—") },
    { key: "status", header: "Estado", render: (r) => <EstadoR s={r.status} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="La rendición junta los gastos pagados con el fondo. El responsable la envía; administración la aprueba (no puede aprobarla quien la envió) y registra de qué cuenta sale la reposición." />
      <div className="grid grid-cols-2 gap-3">
        <Cifra titulo="Por aprobar" valor={String(porAprobar.length)} detalle={soles(porAprobar.reduce((s, r) => s + (r.replenishment_amount ?? 0), 0))} destacada tono={porAprobar.length ? "warn" : "ok"} />
        <Cifra titulo="Por reponer" valor={String(porReponer.length)} detalle={soles(porReponer.reduce((s, r) => s + (r.replenishment_amount ?? 0), 0))} tono={porReponer.length ? "warn" : "ok"} />
      </div>
      <DataTable rows={filas} columns={columnas} onRowClick={(r) => onAbrir(r.id)} search={{ value: q, onChange: setQ, placeholder: "Buscar por número o local" }}
        toolbar={<FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={Object.entries(RENDICIONES).map(([value, [label]]) => ({ value, label }))} />}
        empty="No hay rendiciones con ese filtro." />
    </div>
  );
}

function Rendicion({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { datos: r, error, cargando, recargar } = useDatos<Detalle>(`/v1/gas/rendiciones/${id}`);
  const [ocupado, setOcupado] = useState("");
  const [reponer, setReponer] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !r) return <div className="space-y-3"><Button icon={ArrowLeft} onClick={onVolver}>Rendiciones</Button><Alert tone="bad">{error || "No se encontró la rendición."}</Alert></div>;

  async function accion(clave: string, body: unknown, ok: string) {
    setOcupado(clave);
    try {
      await api(`/v1/gas/rendiciones/${id}/${clave}`, { method: "POST", body });
      toast.ok(ok);
      setReponer(false);
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setOcupado("");
    }
  }
  const p = r.puede;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={onVolver}>Rendiciones</Button>
      </div>
      <PageHeader description={<><span className="font-semibold text-ink">Rendición {r.number}</span> · {r.fondo.local} · responsable {r.fondo.responsable} · del {fecha(r.period_from)} al {fecha(r.period_to)}</>} actions={<EstadoR s={r.status} />} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra titulo="Gastos rendidos" valor={soles(r.total)} detalle={`${r.gastos.length} gastos`} destacada />
        <Cifra titulo="Reposición" valor={r.replenishment_amount !== null ? soles(r.replenishment_amount) : "—"} />
        <Cifra titulo="Saldo del fondo" valor={soles(r.fondo.saldo)} detalle={`de ${soles(r.fondo.fund_amount)}`} />
        <Cifra titulo="Estado" valor={r.estado} tono={r.status === "REJECTED" ? "bad" : r.status === "REIMBURSED" ? "ok" : undefined} />
      </div>
      {r.status === "OPEN" && r.pendientes > 0 && <Alert tone="info">{r.pendientes} gastos todavía no están aprobados: al enviar la rendición pasan a la siguiente.</Alert>}
      {r.rejection_reason && <Alert tone="bad" title={`Devuelta${r.devolvio ? ` por ${r.devolvio}` : ""}`}>{r.rejection_reason}</Alert>}
      <Seccion titulo="Seguimiento">
        <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[180px_minmax(0,1fr)]">
          <dt className="text-muted">Enviada</dt><dd className="text-ink">{r.submitted_at ? `${fechaHora(r.submitted_at)} · ${r.envio ?? ""}` : "—"}</dd>
          <dt className="text-muted">Aprobada</dt><dd className="text-ink">{r.approved_at ? `${fechaHora(r.approved_at)} · ${r.aprobo ?? ""}` : "—"}</dd>
          <dt className="text-muted">Repuesta</dt><dd className="text-ink">{r.reimbursed_at ? `${fechaHora(r.reimbursed_at)} · desde ${r.cuenta_reposicion ?? ""}` : "—"}</dd>
        </dl>
        {(p.enviar || p.aprobar || p.devolver || p.reponer) && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            {p.enviar && <Button variant="primary" icon={Send} loading={ocupado === "enviar"} disabled={r.gastos.length === r.pendientes} onClick={async () => {
              if (await confirmAction({ title: `Enviar la rendición ${r.number}`, confirmLabel: "Enviar" })) await accion("enviar", {}, "Rendición enviada.");
            }}>Enviar rendición</Button>}
            {p.aprobar && <Button variant="primary" icon={Check} loading={ocupado === "aprobar"} onClick={async () => {
              if (await confirmAction({ title: `Aprobar la rendición por ${soles(r.replenishment_amount ?? r.total)}`, confirmLabel: "Aprobar" })) await accion("aprobar", {}, "Rendición aprobada.");
            }}>Aprobar</Button>}
            {p.devolver && <Button variant="danger" icon={Undo2} loading={ocupado === "devolver"} onClick={async () => {
              const x = await confirmAction({ title: "Devolver la rendición", danger: true, confirmLabel: "Devolver", reason: { label: "Qué hay que corregir", min: 5 } });
              if (x) await accion("devolver", { motivo: x.reason }, "Rendición devuelta al responsable.");
            }}>Devolver</Button>}
            {p.reponer && !reponer && <Button variant="primary" icon={Wallet} onClick={() => setReponer(true)}>Registrar reposición</Button>}
          </div>
        )}
        {p.enviar && r.gastos.length === r.pendientes && <p className="mt-2 text-[12.5px] text-muted">Se envía cuando tiene al menos un gasto aprobado.</p>}
        {reponer && <Reponer monto={r.replenishment_amount ?? r.total} ocupado={ocupado === "reponer"} onCancelar={() => setReponer(false)} onReponer={(c) => accion("reponer", { cash_account_id: c }, "Reposición registrada.")} />}
      </Seccion>
      <Seccion titulo="Gastos de la rendición">
        <DataTable rows={r.gastos} columns={columnasGasto([], ["registro", "categoria"])} onRowClick={(g) => setAbierto(g.id)} empty="La rendición no tiene gastos." />
      </Seccion>
      <Ficha id={abierto} onClose={() => setAbierto(null)} onCambio={recargar} />
    </div>
  );
}

function Reponer({ monto, ocupado, onReponer, onCancelar }: { monto: number; ocupado: boolean; onReponer: (cuenta: string) => void; onCancelar: () => void }) {
  const { datos } = useDatos<Cuenta[]>("/v1/gas/cuentas");
  const [cuenta, setCuenta] = useState("");
  const validas = (datos ?? []).filter((c) => !["PETTY_CASH", "DRIVER_CASH", "GATEWAY", "CARD_ACQUIRER"].includes(c.account_type));
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      <p className="text-[13px] text-ink">Reponer <b>{soles(monto)}</b> al fondo.</p>
      <Field label="Sale de la cuenta" required><Select value={cuenta} onChange={(e) => setCuenta(e.target.value)} placeholder="Elige la cuenta" options={validas.map((c) => ({ value: c.id, label: c.name }))} /></Field>
      <div className="flex gap-2">
        <Button variant="primary" loading={ocupado} disabled={!cuenta} onClick={() => onReponer(cuenta)}>Confirmar reposición</Button>
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  );
}
