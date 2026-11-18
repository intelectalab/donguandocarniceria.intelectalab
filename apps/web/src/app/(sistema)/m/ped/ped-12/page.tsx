"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Alert, Cifra, Modal, StatusBadge, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, soles } from "@/lib/formato";
import { FormSaldo } from "@/modulos/ped/Formularios";
import { Vacio } from "@/modulos/ped/Seccion";
import { usePedido } from "@/modulos/ped/usePedido";
import { ESTADOS, SALDOS } from "@/modulos/ped/tipos";

type Fila = {
  id: string; number: string; status: string; delivery_date: string | null; estimated_total: string; final_total: string | null; paid_amount: string;
  balance_mode: string | null; balance_amount: string | null; balance_decided_by_name: string | null; balance_decided_at: string | null; balance_note: string | null;
  cliente: string | null; marca: string | null; forma_pago: string | null; diferencia: string;
};
type Respuesta = { filas: Fila[]; a_favor: number; por_cobrar: number; max_condonar: number };
type Vista = "PENDIENTES" | "DECIDIDOS" | "TODOS";

/** PED-12 Saldo del pedido: diferencia entre lo pagado y el total final; se decide qué hacer antes de cerrar (RN-PED-15, RN-PED-19). */
export default function Saldos() {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>("PENDIENTES");
  const [res, setRes] = useState<{ vista: Vista; r: Respuesta } | null>(null);
  const [version, setVersion] = useState(0);
  const [abierto, setAbierto] = useState("");

  useEffect(() => {
    let vigente = true;
    api<Respuesta>(`/v1/ped/saldos?vista=${vista}`).then((r) => vigente && setRes({ vista, r })).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [vista, version]);

  const r = res?.vista === vista ? res.r : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="A favor de clientes" icono={ArrowUpRight} valor={r ? soles(r.a_favor) : undefined} detalle="Pagaron más que el total final" />
        <Cifra titulo="Por cobrar" icono={ArrowDownLeft} valor={r ? soles(r.por_cobrar) : undefined} tono={r && r.por_cobrar ? "warn" : undefined} detalle="Pagaron menos que el total final" />
      </div>
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "PENDIENTES", label: "Por decidir" }, { key: "DECIDIDOS", label: "Decididos" }, { key: "TODOS", label: "Todos" }]} />
      {!r ? <Vacio>Cargando…</Vacio> : r.filas.length === 0 ? <Vacio>No hay pedidos con saldo en esta vista.</Vacio> : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {r.filas.map((o) => {
            const dif = Number(o.diferencia);
            return (
              <li key={o.id}>
                <button type="button" onClick={() => setAbierto(o.id)} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium text-ink">{o.number} · {o.cliente} <StatusBadge status={o.status} labels={ESTADOS} /></span>
                    <span className="block text-[12px] text-muted">
                      {o.marca} · {fecha(o.delivery_date)} · total {soles(o.final_total ?? o.estimated_total)} · pagó {soles(o.paid_amount)}{o.forma_pago ? ` (${o.forma_pago})` : ""}
                    </span>
                    {o.balance_mode && <span className="block text-[12px] text-muted">{SALDOS[o.balance_mode] ?? o.balance_mode} · {o.balance_decided_by_name}{o.balance_note ? ` · ${o.balance_note}` : ""}</span>}
                  </span>
                  <span className={`text-right text-[14px] font-semibold ${dif > 0 ? "text-info" : "text-bad"}`}>
                    {dif > 0 ? "A favor " : "Falta "}{soles(Math.abs(dif))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {r && <p className="text-[12px] text-muted">Se puede condonar un saldo por cobrar de hasta {soles(r.max_condonar)} con permiso. {numero(r.filas.length)} pedido(s) en la vista.</p>}

      <Modal open={Boolean(abierto)} onClose={() => setAbierto("")} title="Saldo del pedido"
        description={<button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => router.push(`/m/ped/ped-03?id=${abierto}`)}>Ver detalle del pedido</button>}>
        {abierto && <Saldo id={abierto} maxCondonar={r?.max_condonar} onListo={() => setVersion((n) => n + 1)} />}
      </Modal>
    </div>
  );
}

function Saldo({ id, maxCondonar, onListo }: { id: string; maxCondonar?: number; onListo: () => void }) {
  const { detalle, error, cargando, reemplazar } = usePedido(id);
  if (cargando) return <Vacio>Cargando…</Vacio>;
  if (error || !detalle) return <Alert tone="bad">{error}</Alert>;
  return <FormSaldo d={detalle} maxCondonar={maxCondonar} onListo={(d) => { reemplazar(d); onListo(); }} />;
}
