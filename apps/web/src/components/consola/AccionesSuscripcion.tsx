"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus, Percent, RefreshCw } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { ESTADOS_SUSCRIPCION } from "@/components/consola/empresas";
import { erroresDe, mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";

export type SuscripcionAcciones = {
  id: string; status: string; trial_days_granted: number; discount_pct: number;
  transiciones: string[]; efectos?: Record<string, string>;
};

type Accion = "estado" | "extender" | "descuento" | null;

/**
 * Acciones de la consola sobre una suscripción (SUS-11 y OPS-04): cambiar el estado con motivo (suspender, solo
 * lectura, reactivar…), extender la prueba y fijar el descuento pactado. Cada una explica su efecto antes de guardar.
 */
export function AccionesSuscripcion({ s, puedeEstado, puedePlanes, onCambio, efectos }: {
  s: SuscripcionAcciones; puedeEstado: boolean; puedePlanes: boolean; onCambio: () => void; efectos?: Record<string, string>;
}) {
  const [accion, setAccion] = useState<Accion>(null);
  const [destino, setDestino] = useState(s.transiciones[0] ?? "");
  const [dias, setDias] = useState("7");
  const [pct, setPct] = useState(String(s.discount_pct));
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);
  const efecto = (efectos ?? s.efectos ?? {})[destino];

  const abrir = (a: Accion) => { setAccion(a); setMotivo(""); setErrores({}); setGeneral(""); setDestino(s.transiciones[0] ?? ""); };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setGeneral("");
    try {
      if (accion === "estado") await apiConsola(`/suscripciones/${s.id}/estado`, { method: "POST", body: { status: destino, reason: motivo } });
      if (accion === "extender") await apiConsola(`/suscripciones/${s.id}/extender`, { method: "POST", body: { days: Number(dias), reason: motivo } });
      if (accion === "descuento") await apiConsola(`/suscripciones/${s.id}/descuento`, { method: "POST", body: { pct: Number(pct), reason: motivo } });
      toast.ok({ estado: "Estado cambiado", extender: "Prueba extendida", descuento: "Descuento guardado" }[accion as string] ?? "Guardado");
      setAccion(null);
      onCambio();
    } catch (err) {
      const c = erroresDe(err);
      setErrores(c);
      if (!Object.keys(c).length) setGeneral(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  if (!puedeEstado && !puedePlanes) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {puedeEstado && s.transiciones.length > 0 && <Button size="sm" icon={RefreshCw} onClick={() => abrir("estado")}>Cambiar estado</Button>}
        {puedePlanes && s.status === "TRIAL" && <Button size="sm" icon={CalendarPlus} onClick={() => abrir("extender")}>Extender prueba</Button>}
        {puedePlanes && s.status !== "CANCELLED" && <Button size="sm" icon={Percent} onClick={() => abrir("descuento")}>Descuento</Button>}
      </div>
      {accion && (
        <Modal open onClose={() => setAccion(null)} placement="center" dismissable={!guardando}
          title={{ estado: "Cambiar el estado de la suscripción", extender: "Extender la prueba", descuento: "Descuento pactado" }[accion]}
          footer={<><Button onClick={() => setAccion(null)} disabled={guardando}>Cancelar</Button>
            <Button variant={accion === "estado" && (destino === "SUSPENDED" || destino === "CANCELLED") ? "danger" : "primary"} type="submit" form="f-accion-sus" loading={guardando}>Guardar</Button></>}>
          <form id="f-accion-sus" onSubmit={guardar} className="grid gap-4">
            {accion === "estado" && (
              <>
                <Field label="Nuevo estado" required error={errores.status}>
                  <Select value={destino} onChange={(e) => setDestino(e.target.value)}
                    options={s.transiciones.map((t) => ({ value: t, label: ESTADOS_SUSCRIPCION[t]?.[0] ?? t }))} />
                </Field>
                {efecto && <Alert tone={destino === "SUSPENDED" || destino === "CANCELLED" ? "bad" : destino === "READ_ONLY" ? "warn" : "info"} title="Qué pasa con la empresa">{efecto}</Alert>}
              </>
            )}
            {accion === "extender" && (
              <Field label="Días más" required error={errores.days} hint={`Ya tiene ${s.trial_days_granted} días; el total no pasa de 30 (RN-SUS-15).`}>
                <Input type="number" min={1} max={30} value={dias} onChange={(e) => setDias(e.target.value)} />
              </Field>
            )}
            {accion === "descuento" && (
              <Field label="Descuento sobre la cuota (%)" required error={errores.pct} hint="0 lo quita. Se descuenta del MRR.">
                <Input type="number" min={0} max={100} step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} />
              </Field>
            )}
            <Field label="Motivo" required error={errores.reason} hint="Queda en el historial de la suscripción y en la bitácora de la consola.">
              <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
            </Field>
            {general && <Alert tone="bad">{general}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
