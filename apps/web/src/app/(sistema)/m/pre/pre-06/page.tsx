"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCheck, Minus, Plus, Printer, Tags } from "lucide-react";
import { Alert, Button, Field, Select, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CabeceraTarea, ConTarea, Imprimible, Seccion, Vacio } from "@/modulos/pre/comunes";
import { Code128 } from "@/modulos/pre/Code128";
import { BOLSAS, R, nombreBolsa, type Bolsa, type Tarea } from "@/modulos/pre/tipos";

const ESTADO_BOLSA: Record<string, [string, "neutral" | "ok" | "info" | "bad"]> = {
  SEALED: ["Cerrada", "neutral"], LOADED: ["Cargada", "ok"], DELIVERED: ["Entregada", "info"], RETURNED: ["Devuelta", "bad"],
};

/** PRE-06 Bolsas y etiquetas: número de bolsas o cajas térmicas e impresión de etiquetas con pedido, número de bolsa, total, ruta y parada. */
export default function BolsasYEtiquetas() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <ConTarea id={id} ruta={R.bolsas} estados={["PICKED", "PACKED"]} titulo="Pedidos armados por embolsar" vacio="No hay pedidos armados por embolsar para esta fecha.">
      {(t, poner) => <Bolsas t={t} poner={poner} />}
    </ConTarea>
  );
}

function Bolsas({ t, poner }: { t: Tarea; poner: (t: Tarea) => void }) {
  const router = useRouter();
  const { can } = useSesion();
  const [n, setN] = useState(t.parcel_count ?? t.sugerido.count);
  const [tipo, setTipo] = useState(t.parcel_type ?? t.sugerido.type);
  const [guardando, setGuardando] = useState(false);
  const editable = can("pre.task.pick") && ["PICKED", "PACKED"].includes(t.estado) && t.pedido.status !== "CANCELLED";

  async function generar() {
    setGuardando(true);
    try {
      poner(await api<Tarea>(`/v1/pre/tareas/${t.id}/bolsas`, { method: "POST", body: { count: n, type: tipo } }));
      toast.ok(`${n} etiqueta(s) listas para imprimir`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <CabeceraTarea t={t} volver={R.bolsas} />

      {["PENDING", "PICKING"].includes(t.estado) && (
        <Alert tone="warn" title="El pedido aún no está armado">
          Termina de escanear las líneas antes de embolsar.
          <div className="mt-2"><Button size="sm" onClick={() => router.push(`${R.armado}?id=${t.id}`)}>Ir al armado</Button></div>
        </Alert>
      )}

      {editable && (
        <Seccion titulo="Bolsas del pedido">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Cantidad">
              <div className="flex items-center gap-2">
                <Button icon={Minus} aria-label="Una menos" disabled={n <= 1} onClick={() => setN(n - 1)} />
                <span className="w-10 text-center text-[22px] font-bold text-ink tabular-nums">{n}</span>
                <Button icon={Plus} aria-label="Una más" disabled={n >= 20} onClick={() => setN(n + 1)} />
              </div>
            </Field>
            <Field label="Tipo" className="w-[180px]">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)} options={BOLSAS} />
            </Field>
            <Button variant="primary" icon={Tags} loading={guardando} onClick={generar}>{t.bolsas.length ? "Rehacer etiquetas" : "Generar etiquetas"}</Button>
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            Sugerido: {t.sugerido.count} {nombreBolsa(t.sugerido.type).toLowerCase()}. {t.bolsas.length ? "Rehacer reemplaza las etiquetas anteriores: vuelve a imprimirlas." : ""}
          </p>
        </Seccion>
      )}

      <Seccion titulo="Etiquetas" acciones={t.bolsas.length > 0 && <>
        <Button size="sm" icon={Printer} onClick={() => window.print()}>Imprimir</Button>
        {t.estado === "PACKED" && can("pre.task.verify") && <Button size="sm" variant="primary" icon={CheckCheck} onClick={() => router.push(`${R.verificacion}?id=${t.id}`)}>Verificar</Button>}
      </>}>
        {t.bolsas.length === 0 ? <Vacio>Aún no hay etiquetas para este pedido.</Vacio> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {t.bolsas.map((b) => <Etiqueta key={b.id} b={b} t={t} />)}
          </div>
        )}
      </Seccion>

      {t.bolsas.length > 0 && (
        <Imprimible>
          {t.bolsas.map((b) => (
            <div key={b.id} className="mb-[4mm] w-[100mm] break-inside-avoid border border-black p-[3mm] text-black">
              <EtiquetaContenido b={b} t={t} impresa />
            </div>
          ))}
        </Imprimible>
      )}
    </div>
  );
}

function Etiqueta({ b, t }: { b: Bolsa; t: Tarea }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <EtiquetaContenido b={b} t={t} />
      <div className="mt-2 flex items-center justify-between text-[12px]">
        <StatusBadge status={b.status} labels={ESTADO_BOLSA} />
        {b.weight_kg && <span className="text-muted">{kg(b.weight_kg)}</span>}
      </div>
    </div>
  );
}

function EtiquetaContenido({ b, t, impresa }: { b: Bolsa; t: Tarea; impresa?: boolean }) {
  const texto = impresa ? "text-black" : "text-ink";
  return (
    <div className={texto}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[22px] leading-tight font-black">{b.pedido}</p>
          <p className="text-[13px]">{b.cliente}</p>
        </div>
        <div className="text-right">
          <p className="text-[20px] leading-tight font-black">{b.parcel_no} / {b.parcel_count}</p>
          <p className="text-[11px]">{nombreBolsa(b.parcel_type)}</p>
        </div>
      </div>
      <p className="mt-1 text-[15px] font-bold">{b.route_code ? `Ruta ${b.route_code} · parada ${b.stop_seq ?? "—"}` : "Sin ruta"}</p>
      <p className="text-[11px]">{t.pedido.marca} · {t.pedido.zona ?? ""}</p>
      <div className={`mt-2 ${impresa ? "" : "rounded-md border border-line p-1"}`}><Code128 valor={b.label_code} alto={impresa ? 60 : 52} /></div>
      <p className="text-center font-mono text-[12px] tracking-wider">{b.label_code}</p>
      {!impresa && <p className="mt-1 text-[11.5px] text-muted">{b.leyenda}</p>}
    </div>
  );
}
