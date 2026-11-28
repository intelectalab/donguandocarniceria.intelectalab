"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Alert, Button, PageHeader, Tabs, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { R, cuando } from "@/modulos/pre/tipos";

type Vista = "POR_APROBAR" | "INCOMPLETAS" | "APROBADAS";
type Fila = {
  id: string; task_id: string; qty_required: string; qty_picked: string; weighed_kg: string | null; status: string; short_reason: string | null;
  short_qty: string | null; short_requested_at: string | null; short_approved_at: string | null; short_requested_by: string | null; preparer_user_id: string | null;
  order_number: string; sku: string; name: string; sale_mode: string; pedido_por: string | null; aprobado_por: string | null; vendedora: string | null;
  ola: string; cliente: string | null; hecho: number;
};

const cant = (f: Fila, v: number | string | null) => (f.sale_mode === "KG" ? kg(v ?? 0) : `${numero(v ?? 0)} u`);

/** PRE-09 Faltantes: líneas sin stock o incompletas; motivo y aprobación de la supervisora; aviso a la vendedora para hablar con el cliente. */
export default function Faltantes() {
  const router = useRouter();
  const { can, me } = useSesion();
  const [vista, setVista] = useState<Vista>("POR_APROBAR");
  const { datos, error, cargando, recargar } = useDatos<Fila[]>(`/v1/pre/faltantes?vista=${vista}`);
  const [ocupado, setOcupado] = useState("");
  const aprueba = can("pre.short.approve");

  async function resolver(f: Fila, que: "aprobar" | "rechazar") {
    const r = await confirmAction(que === "aprobar"
      ? { title: `Aprobar el faltante de ${f.order_number}`, message: `${f.name}: sale ${cant(f, f.hecho)} de ${cant(f, f.qty_required)}. Se avisa a la vendedora para que hable con el cliente.`, confirmLabel: "Aprobar" }
      : { title: `Rechazar el faltante de ${f.order_number}`, message: "La línea vuelve al armado: hay que completarla.", confirmLabel: "Rechazar", danger: true, reason: { label: "Motivo", optional: true } });
    if (!r) return;
    setOcupado(f.id + que);
    try {
      await api(`/v1/pre/lineas/${f.id}/faltante/${que}`, { method: "POST", body: que === "rechazar" ? { reason: r.reason } : {} });
      toast.ok(que === "aprobar" ? "Faltante aprobado: se avisó a la vendedora" : "Faltante rechazado");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Quien arma registra el faltante con su motivo; lo aprueba la supervisora de almacén, no quien lo pidió ni quien armó." />
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "POR_APROBAR", label: "Por aprobar" }, { key: "INCOMPLETAS", label: "Líneas incompletas" }, { key: "APROBADAS", label: "Aprobados" }]} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.length ? (
        <Vacio>{vista === "POR_APROBAR" ? "No hay faltantes por aprobar." : vista === "INCOMPLETAS" ? "No hay líneas incompletas en olas abiertas." : "No hay faltantes aprobados."}</Vacio>
      ) : (
        <div className="space-y-3">
          {datos.map((f) => {
            const propio = f.short_requested_by === me.user.id || f.preparer_user_id === me.user.id;
            return (
              <Seccion key={f.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button type="button" onClick={() => router.push(`${R.ticket}?id=${f.task_id}`)} className="min-w-0 cursor-pointer text-left">
                    <span className="block text-[14px] font-semibold text-ink">{f.order_number} <span className="font-normal text-muted">· {f.cliente}</span></span>
                    <span className="block text-[12px] text-muted">{f.ola}{f.vendedora ? ` · vendedora ${f.vendedora}` : ""}</span>
                  </button>
                  <span className="text-right text-[13px] text-ink">
                    <b>{f.name}</b>
                    <span className="block text-[12px] text-muted">armado {cant(f, f.hecho)} de {cant(f, f.qty_required)}</span>
                  </span>
                </div>
                {f.short_reason && (
                  <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink">
                    «{f.short_reason}»<span className="block text-[12px] text-muted">{f.pedido_por ?? "—"} · {cuando(f.short_requested_at)}</span>
                  </p>
                )}
                {vista === "APROBADAS" && <p className="mt-2 text-[12.5px] text-muted">Aprobó {f.aprobado_por ?? "—"} · {cuando(f.short_approved_at)} · sale {cant(f, f.short_qty)}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {vista === "POR_APROBAR" && aprueba && (propio
                    ? <span className="text-[12.5px] text-muted">Lo pediste o armaste tú: lo aprueba otra supervisora.</span>
                    : <>
                      <Button size="sm" variant="primary" icon={Check} loading={ocupado === f.id + "aprobar"} onClick={() => resolver(f, "aprobar")}>Aprobar</Button>
                      <Button size="sm" icon={X} loading={ocupado === f.id + "rechazar"} onClick={() => resolver(f, "rechazar")}>Rechazar</Button>
                    </>)}
                  {vista === "INCOMPLETAS" && can("pre.task.pick") && (
                    <Button size="sm" onClick={() => router.push(`${R.armado}?id=${f.task_id}`)}>Completar o registrar faltante</Button>
                  )}
                </div>
              </Seccion>
            );
          })}
        </div>
      )}
    </div>
  );
}
