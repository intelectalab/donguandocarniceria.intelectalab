"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Alert, Badge, Button, StatusBadge, Tabs, confirmAction, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Vacio } from "@/modulos/ped/Seccion";
import { ESTADOS } from "@/modulos/ped/tipos";

type Solicitud = {
  id: string; order_id: string; order_number: string; requested_by_name: string; requested_role: string | null; requested_pct: string; requested_amount: string;
  order_base: string | null; reason: string; status: string; requested_at: string; decided_by_name: string | null; decided_at: string | null; decision_note: string | null;
  estado_pedido: string; cliente: string | null; marca: string | null; propia: boolean;
};
type Vista = "PENDING" | "APPROVED" | "REJECTED" | "ALL";
const ESTADO_SOL: Record<string, [string, Tone]> = { PENDING: ["Pendiente", "warn"], APPROVED: ["Aprobado", "ok"], REJECTED: ["Rechazado", "bad"] };

/** PED-10 Aprobación de descuentos: los que pasan el límite del rol esperan aquí (RN-PED-11). Quien lo pidió no lo aprueba. */
export default function Aprobaciones() {
  const router = useRouter();
  const { can, puede } = useSesion();
  const [vista, setVista] = useState<Vista>("PENDING");
  const [filas, setFilas] = useState<{ vista: Vista; datos: Solicitud[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [ocupado, setOcupado] = useState("");
  const decide = can("ped.discount.approve") && puede("PED", "A");

  useEffect(() => {
    let vigente = true;
    api<Solicitud[]>(`/v1/ped/descuentos?status=${vista}`).then((d) => vigente && setFilas({ vista, datos: d })).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [vista, version]);

  async function decidir(s: Solicitud, aprueba: boolean) {
    const r = await confirmAction({
      title: `${aprueba ? "¿Aprobar" : "¿Rechazar"} el descuento de ${s.order_number}?`,
      message: aprueba ? "Se aplica al pedido y se recalcula su total." : "El pedido queda sin este descuento.",
      confirmLabel: aprueba ? "Aprobar" : "Rechazar", danger: !aprueba,
      reason: aprueba ? { label: "Nota (opcional)", optional: true } : { label: "Motivo del rechazo", min: 3 },
    });
    if (!r) return;
    setOcupado(s.id);
    try {
      await api(`/v1/ped/descuentos/${s.id}/${aprueba ? "aprobar" : "rechazar"}`, { method: "POST", body: { note: r.reason || null } });
      toast.ok(aprueba ? "Descuento aprobado" : "Descuento rechazado");
      setVersion((n) => n + 1);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const datos = filas?.vista === vista ? filas.datos : null;
  return (
    <div className="space-y-4">
      {!decide && <Alert tone="info">Puedes ver las solicitudes; las aprueba quien tiene el permiso de aprobar descuentos.</Alert>}
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "PENDING", label: "Pendientes" }, { key: "APPROVED", label: "Aprobados" }, { key: "REJECTED", label: "Rechazados" }, { key: "ALL", label: "Todos" }]} />
      {!datos ? <Vacio>Cargando…</Vacio> : datos.length === 0 ? <Vacio>{vista === "PENDING" ? "No hay descuentos esperando aprobación." : "No hay solicitudes."}</Vacio> : (
        <ul className="space-y-3">
          {datos.map((s) => {
            const base = Number(s.order_base ?? 0);
            const monto = Number(s.requested_amount) > 0 ? Number(s.requested_amount) : (base * Number(s.requested_pct)) / 100;
            return (
              <li key={s.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => router.push(`/m/ped/ped-03?id=${s.order_id}`)} className="cursor-pointer font-semibold text-ink hover:underline">{s.order_number}</button>
                      <StatusBadge status={s.estado_pedido} labels={ESTADOS} />
                      <StatusBadge status={s.status} labels={ESTADO_SOL} />
                      {s.propia && <Badge>Lo pediste tú</Badge>}
                    </div>
                    <p className="text-[12.5px] text-muted">{s.cliente} · {s.marca} · pidió {s.requested_by_name}{s.requested_role ? ` (${s.requested_role})` : ""} · {fechaHora(s.requested_at)}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-[16px] font-semibold text-ink">{Number(s.requested_pct) > 0 ? porcentaje(s.requested_pct, 1) : soles(s.requested_amount)}</div>
                    <div className="text-[12px] text-muted">−{soles(monto)}{base ? ` sobre ${soles(base)}` : ""}</div>
                  </div>
                </div>
                <p className="mt-2 text-[13px] text-ink">Motivo: {s.reason}</p>
                {s.status !== "PENDING" && (
                  <p className="mt-1 text-[12.5px] text-muted">{s.status === "APPROVED" ? "Aprobó" : "Rechazó"} {s.decided_by_name} · {fechaHora(s.decided_at)}{s.decision_note ? ` · ${s.decision_note}` : ""}</p>
                )}
                {s.status === "PENDING" && decide && (
                  s.propia ? <p className="mt-2 text-[12.5px] text-muted">Otra persona con permiso debe decidir este descuento.</p> : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="primary" icon={Check} loading={ocupado === s.id} onClick={() => decidir(s, true)}>Aprobar</Button>
                      <Button size="sm" variant="danger" icon={X} disabled={ocupado === s.id} onClick={() => decidir(s, false)}>Rechazar</Button>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
