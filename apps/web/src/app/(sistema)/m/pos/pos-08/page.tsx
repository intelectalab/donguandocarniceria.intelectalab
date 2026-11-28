"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, PageHeader, StatusBadge, Tabs, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio } from "@/modulos/pos/Seccion";
import { TablaConteos } from "@/modulos/pos/TablaConteos";
import { ESTADOS_TURNO, n, type TurnoDetalle } from "@/modulos/pos/tipos";
import { useContexto } from "@/modulos/pos/useContexto";

type Fila = {
  id: string; number: string; status: string; cashier_name: string; cashier_user_id: string; opened_at: string; closed_at: string | null;
  opening_float: string; expected_cash: string | null; counted_cash: string | null; difference: string | null; total_difference: string | null;
  difference_reason: string | null; over_limit: boolean; closed_by_name: string | null; approved_by_name: string | null; approved_at: string | null; caja: string;
};
type Estado = "CLOSED" | "APPROVED" | "OPEN" | "ALL";

/** POS-08 Aprobación de cierre: la supervisora revisa el arqueo por medio y el historial de la cajera, y aprueba (RN-POS-08). */
export default function AprobacionCierre() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <div className="space-y-4">
      <PageHeader code="POS-08" description="Revisa el arqueo de cada turno cerrado y apruébalo. Aprueba una persona distinta de la cajera." />
      {id ? <Detalle key={id} id={id} /> : <Lista />}
    </div>
  );
}

function Lista() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>("CLOSED");
  const [datos, setDatos] = useState<{ estado: Estado; filas?: Fila[]; error?: string } | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Fila[]>(`/v1/pos/turnos?status=${estado}`)
      .then((f) => vigente && setDatos({ estado, filas: f }))
      .catch((e) => vigente && setDatos({ estado, error: mensajeDe(e) }));
    return () => { vigente = false; };
  }, [estado]);

  const actual = datos?.estado === estado ? datos : null;
  const columnas: Column<Fila>[] = [
    { key: "number", header: "Turno", cardTitle: true, render: (f) => <div><div className="font-medium">{f.number}</div><div className="text-[12px] text-muted">{f.caja}</div></div> },
    { key: "cashier_name", header: "Cajera" },
    { key: "closed_at", header: "Cierre", render: (f) => (f.closed_at ? fechaHora(f.closed_at) : <span className="text-muted">Abierto desde {fechaHora(f.opened_at)}</span>) },
    {
      key: "total_difference", header: "Diferencia", align: "right",
      render: (f) => f.total_difference === null ? "—" : (
        <span className={`inline-flex items-center gap-1.5 ${Math.abs(n(f.total_difference)) < 0.005 ? "text-ok" : "text-bad"}`}>
          {f.over_limit && <Badge tone="bad">Sobre el límite</Badge>}{soles(f.total_difference)}
        </span>
      ),
    },
    { key: "status", header: "Estado", render: (f) => <StatusBadge status={f.status} labels={ESTADOS_TURNO} /> },
  ];
  return (
    <div className="space-y-3">
      <Tabs value={estado} onChange={setEstado} tabs={[{ key: "CLOSED", label: "Por aprobar" }, { key: "APPROVED", label: "Aprobados" }, { key: "OPEN", label: "Abiertos" }, { key: "ALL", label: "Todos" }]} />
      <DataTable rows={actual?.filas ?? []} columns={columnas} loading={!actual} error={actual?.error}
        onRowClick={(f) => router.push(f.status === "OPEN" ? `/m/pos/pos-07?id=${f.id}` : `/m/pos/pos-08?id=${f.id}`)}
        empty={estado === "CLOSED" ? "No hay cierres por aprobar." : "No hay turnos."} />
    </div>
  );
}

function Detalle({ id }: { id: string }) {
  const router = useRouter();
  const { me } = useSesion();
  const { ctx } = useContexto();
  const [t, setT] = useState<TurnoDetalle | null>(null);
  const [error, setError] = useState("");
  const [nota, setNota] = useState("");
  const [aprobando, setAprobando] = useState(false);

  useEffect(() => {
    let vigente = true;
    api<TurnoDetalle>(`/v1/pos/turnos/${id}`).then((r) => vigente && setT(r)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, [id]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!t) return <Vacio>Cargando el turno…</Vacio>;

  async function aprobar() {
    setAprobando(true);
    try {
      const r = await api<TurnoDetalle>(`/v1/pos/turnos/${id}/aprobar`, { method: "POST", body: { note: nota.trim() || null } });
      setT((x) => (x ? { ...x, ...r } : x));
      toast.ok(`Cierre del turno ${r.number} aprobado.`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setAprobando(false);
    }
  }

  const propio = t.cashier_user_id === me.user.id;
  return (
    <div className="space-y-4">
      <Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/m/pos/pos-08")}>Todos los turnos</Button>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Seccion titulo={`Turno ${t.number} · ${t.caja.name}`} acciones={<StatusBadge status={t.status} labels={ESTADOS_TURNO} />}>
          <DetailList items={[
            { label: "Cajera", value: t.cashier_name },
            { label: "Abrió", value: `${fechaHora(t.opened_at)} con ${soles(t.opening_float)}` },
            { label: "Cerró", value: t.closed_at ? `${fechaHora(t.closed_at)}${t.closed_by_name && t.closed_by_name !== t.cashier_name ? ` · ${t.closed_by_name}` : ""}` : "Abierto" },
            { label: "Ventas", value: `${t.tickets} ticket(s) · ${soles(t.ventas)}` },
            { label: "Motivo de la diferencia", value: t.difference_reason },
            { label: "Aprobó", value: t.approved_by_name ? `${t.approved_by_name} · ${fechaHora(t.approved_at)}${t.approval_note ? ` · ${t.approval_note}` : ""}` : null },
          ]} />
          <div className="mt-4"><TablaConteos t={t} /></div>
          {t.closing_denoms && (
            <p className="mt-3 text-[12px] text-muted">Efectivo por denominación: {Object.entries(t.closing_denoms).map(([d, q]) => `${q} × S/ ${d}`).join(" · ")}</p>
          )}
          {t.over_limit && <div className="mt-3"><Alert tone="warn">La diferencia pasa el límite de {soles(ctx?.parametros.diferencia_con_aviso ?? 5)}: revisa el motivo antes de aprobar.</Alert></div>}
        </Seccion>

        <div className="space-y-4">
          {t.status === "CLOSED" && (
            <Seccion titulo="Aprobar el cierre">
              {!ctx?.puede.aprobar ? <Alert tone="info">Aprueba la supervisora de ventas o la gerencia.</Alert>
                : propio ? <Alert tone="warn">Es tu propio turno: lo aprueba otra persona.</Alert> : (
                  <div className="space-y-3">
                    <Field label="Nota (opcional)"><Textarea rows={2} maxLength={255} value={nota} onChange={(e) => setNota(e.target.value)} /></Field>
                    <div className="flex justify-end"><Button variant="primary" icon={CheckCircle2} loading={aprobando} onClick={aprobar}>Aprobar cierre</Button></div>
                  </div>
                )}
            </Seccion>
          )}
          <Seccion titulo={`Historial de ${t.cashier_name}`}>
            <p className="mb-2 text-[12.5px] text-muted">Últimos {t.diferencias_cajera.turnos} turno(s): {soles(t.diferencias_cajera.suma_abs)} de diferencias sumadas.</p>
            {t.historial.length === 0 ? <Vacio>Sin turnos anteriores.</Vacio> : (
              <ul className="divide-y divide-line text-[13px]">
                {t.historial.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>{h.number} · {fechaHora(h.closed_at)}</span>
                    <span className={`tabular-nums ${Math.abs(n(h.total_difference)) < 0.005 ? "text-ok" : "text-bad"}`}>{soles(h.total_difference)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          <Seccion titulo="Movimientos de efectivo">
            {t.movimientos.length === 0 ? <Vacio>Sin movimientos.</Vacio> : (
              <ul className="divide-y divide-line text-[13px]">
                {t.movimientos.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-2 py-1.5">
                    <span className="min-w-0">{ctx?.movimientos[m.movement_type] ?? m.movement_type} · <span className="text-muted">{m.reason}{m.authorized_by_name ? ` · autorizó ${m.authorized_by_name}` : ""}</span></span>
                    <span className="shrink-0 tabular-nums">{soles(m.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      </div>
    </div>
  );
}
