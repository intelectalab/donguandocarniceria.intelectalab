"use client";

import { useState } from "react";
import { CheckCircle2, MapPin } from "lucide-react";
import { Alert, Badge, Button, Field, FiltroSelect, Input, PageHeader, Select, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Avance, Seccion, Vacio, hoyLima, useDatos } from "@/modulos/del/comunes";
import { NIVEL, PEDIDO, lista } from "@/modulos/del/tipos";

type Fila = {
  order_id: string; pedido: string; cliente: string | null; status: string; franja: string | null; score: number; level: string; issues: string[];
  address: { id: string; line: string; reference: string | null; district: string | null; lat: number | null; lng: number | null; verified_at: string | null;
    call_signal: string | null; location_requested_at: string | null; verify_note: string | null } | null;
};

const SENAL = { OK: "Contesta llamadas", WHATSAPP_ONLY: "Solo WhatsApp", NO_SIGNAL: "Sin señal en la zona" };

/** DEL-19 Calidad de direcciones: puntaje de cada pedido del día, confirmar con el cliente o pedirle su ubicación (RN-DEL-14). */
export default function Direcciones() {
  const { can } = useSesion();
  const [fecha, setFecha] = useState(hoyLima());
  const [nivel, setNivel] = useState("");
  const { datos, error, cargando, recargar } = useDatos<{ data: Fila[] }>(`/v1/del/direcciones?fecha=${fecha}${nivel ? `&nivel=${nivel}` : ""}`);
  const planifica = can("del.route.plan");
  const post = async (url: string, body: unknown, ok: string) => {
    try { const r = await api<{ url?: string | null }>(url, { method: "POST", body }); toast.ok(ok); recargar(); return r; } catch (x) { toast.error(mensajeDe(x)); return null; }
  };
  return (
    <div className="space-y-5">
      <PageHeader description="Revisa antes de armar las rutas: sin pin, sin referencia o sin teléfono, el repartidor pierde tiempo. Las peores salen primero." />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Fecha de entrega"><Input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} /></Field>
        <FiltroSelect etiqueta="Calidad" todos="todas" value={nivel} onChange={setNivel} options={lista(Object.fromEntries(Object.entries(NIVEL).map(([k, v]) => [k, v[0]])))} />
      </div>
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay pedidos de delivery para esa fecha.</Vacio> : (
        <div className="grid gap-3 md:grid-cols-2">
          {datos.data.map((f) => {
            const a = f.address;
            return (
              <Seccion key={f.order_id} titulo={`${f.pedido} · ${f.cliente ?? "—"}`} acciones={<StatusBadge status={f.level} labels={NIVEL} />}>
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[15px] font-semibold text-ink">{f.score}</span>
                  <span className="flex-1"><Avance valor={f.score} tono={f.level === "OK" ? "ok" : f.level === "REVIEW" ? "warn" : "bad"} /></span>
                </div>
                <p className="mt-2 text-[13px] text-ink">{a ? [a.line, a.district].filter(Boolean).join(", ") : "Sin dirección"}</p>
                {a?.reference && <p className="text-[12.5px] text-muted">Ref.: {a.reference}</p>}
                <p className="text-[12.5px] text-muted">{f.franja ?? "Sin franja"} · <StatusBadge status={f.status} labels={PEDIDO} /></p>
                {f.issues.length > 0 && <ul className="mt-2 list-disc pl-5 text-[12.5px] text-warn">{f.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {a?.verified_at && <Badge tone="ok">Confirmada {fechaHora(a.verified_at)}</Badge>}
                  {a?.location_requested_at && <Badge tone="info">Ubicación pedida {fechaHora(a.location_requested_at)}</Badge>}
                </div>
                {planifica && a && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!a.verified_at && (
                      <Button size="sm" icon={CheckCircle2} disabled={a.lat == null} onClick={async () => {
                        const c = await confirmAction({ title: "Confirmar la dirección", confirmLabel: "Confirmada", message: "Confirmaste con el cliente la dirección y el pin.", reason: { label: "Nota", optional: true } });
                        if (c) await post(`/v1/del/direcciones/${a.id}/confirmar`, { note: c.reason || null }, "Dirección confirmada.");
                      }}>Confirmar</Button>
                    )}
                    <Button size="sm" variant="ghost" icon={MapPin} onClick={async () => {
                      const r = await post(`/v1/del/pedidos/${f.order_id}/pedir-ubicacion`, {}, "Pedido de ubicación registrado.");
                      if (r?.url) window.open(r.url, "_blank", "noopener");
                    }}>Pedir ubicación</Button>
                    <span className="w-[190px]">
                      <Select aria-label="Contacto en la zona" value={a.call_signal ?? ""} placeholder="Contacto: sin dato" options={lista(SENAL)}
                        onChange={(e) => post(`/v1/del/direcciones/${a.id}/senal`, { call_signal: e.target.value || null }, "Guardado.")} />
                    </span>
                  </div>
                )}
              </Seccion>
            );
          })}
        </div>
      )}
    </div>
  );
}
