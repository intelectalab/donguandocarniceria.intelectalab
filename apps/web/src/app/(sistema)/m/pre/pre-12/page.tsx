"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Alert, Badge, Button, PageHeader, Tabs, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, useDatos } from "@/modulos/pre/comunes";
import { R, cuando } from "@/modulos/pre/tipos";

type Vista = "PENDIENTES" | "RESUELTAS";
type Fila = {
  id: string; task_id: string; barcode: string; weight_kg: string | null; scanned_at: string; message: string | null; order_number: string; name: string; sku: string;
  lote: string | null; vence: string | null; lote_sugerido: string | null; vence_sugerido: string | null; preparador: string | null; ola: string | null;
  resolucion: { autorizada: boolean; resultado: string; motivo: string | null; supervisora: string | null; at: string } | null;
};
type Resultado = { result: string; ok: boolean; message: string };

/** PRE-12 Autorizaciones FEFO: lecturas bloqueadas por tomar un lote que vence después; la supervisora autoriza o pide el lote correcto (RN-PRE-05). */
export default function AutorizacionesFefo() {
  const router = useRouter();
  const { can } = useSesion();
  const [vista, setVista] = useState<Vista>("PENDIENTES");
  const { datos, error, cargando, recargar } = useDatos<Fila[]>(`/v1/pre/fefo?vista=${vista}`);
  const [ocupado, setOcupado] = useState("");
  const autoriza = can("pre.fefo.override");

  async function resolver(f: Fila, que: "autorizar" | "negar") {
    const r = await confirmAction(que === "autorizar"
      ? { title: `Autorizar el lote ${f.lote ?? f.barcode}`, message: `${f.order_number} · ${f.name}. Queda registrado quién autorizó.`, confirmLabel: "Autorizar", reason: { label: "Motivo", optional: true } }
      : { title: "Pedir el lote que vence antes", message: `Quien arma debe tomar ${f.lote_sugerido ?? "el lote sugerido"}.`, confirmLabel: "Negar", danger: true, reason: { label: "Indicación", optional: true } });
    if (!r) return;
    setOcupado(f.id + que);
    try {
      const x = await api<Resultado>(`/v1/pre/fefo/${f.id}/${que}`, { method: "POST", body: { reason: r.reason } });
      if (que === "autorizar" && !x.ok) toast.error(x.message);
      else toast.ok(que === "autorizar" ? "Autorizado: el paquete quedó armado" : "Negado: se avisó que tome el lote correcto");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Una lectura se bloquea si hay otro lote liberado del mismo producto que vence antes. Solo la supervisora autoriza tomar el que vence después." />
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "PENDIENTES", label: "Por resolver" }, { key: "RESUELTAS", label: "Resueltas" }]} />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.length ? <Vacio>{vista === "PENDIENTES" ? "No hay lecturas bloqueadas por FEFO." : "Aún no hay autorizaciones."}</Vacio> : (
        <div className="space-y-3">
          {datos.map((f) => (
            <Seccion key={f.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" onClick={() => router.push(`${R.ticket}?id=${f.task_id}`)} className="min-w-0 cursor-pointer text-left">
                  <span className="block text-[14px] font-semibold text-ink">{f.order_number} · {f.name}</span>
                  <span className="block text-[12px] text-muted">{f.ola} · {f.preparador ?? "—"} · {cuando(f.scanned_at)}{f.weight_kg ? ` · ${kg(f.weight_kg)}` : ""}</span>
                </button>
                {f.resolucion && (
                  f.resolucion.autorizada ? <Badge tone="ok">Autorizado</Badge> : <Badge tone="bad">Negado</Badge>
                )}
              </div>
              <div className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2">
                <p className="rounded-lg bg-warn-soft px-3 py-2 text-ink">Leído: <b className="font-mono">{f.lote ?? f.barcode}</b> · vence {fecha(f.vence)}</p>
                <p className="rounded-lg bg-ok-soft px-3 py-2 text-ink">Toca: <b className="font-mono">{f.lote_sugerido ?? "—"}</b> · vence {fecha(f.vence_sugerido)}</p>
              </div>
              {f.resolucion && (
                <p className="mt-2 text-[12.5px] text-muted">{f.resolucion.supervisora ?? "—"} · {cuando(f.resolucion.at)}{f.resolucion.motivo ? ` · «${f.resolucion.motivo}»` : ""}</p>
              )}
              {vista === "PENDIENTES" && autoriza && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" icon={ShieldCheck} loading={ocupado === f.id + "autorizar"} onClick={() => resolver(f, "autorizar")}>Autorizar</Button>
                  <Button size="sm" icon={ShieldX} loading={ocupado === f.id + "negar"} onClick={() => resolver(f, "negar")}>Pedir el lote correcto</Button>
                </div>
              )}
            </Seccion>
          ))}
        </div>
      )}
    </div>
  );
}
