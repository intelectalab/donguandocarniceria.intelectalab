"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { lista } from "@/modulos/del/tipos";

type Tarifa = { id: string; supplier_id: string; zone_id: string | null; zona: string | null; rate_basis: string; base: string; amount: number; valid_from: string; valid_to: string | null; status: string; vigente: boolean };
type Empresa = { id: string; trade_name: string | null; legal_name: string; doc_number: string; status: string; phone: string | null; tarifas: Tarifa[]; rutas_mes: number };

/** DEL-09 Empresas de delivery y tarifas: por envío, por kg o por día, por zona o general, con vigencia (RN-DEL-11). */
export default function Empresas() {
  const { can } = useSesion();
  const op = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<{ data: Empresa[]; bases: Record<string, string> }>("/v1/del/empresas");
  const [editar, setEditar] = useState<{ sup: string; t?: Tarifa } | null>(null);
  const gestiona = can("del.carrier.manage");
  return (
    <div className="space-y-5">
      <PageHeader description="Las empresas de delivery son proveedores de tipo «empresa de delivery» (se registran en Maestros). Aquí van sus tarifas: la de la zona manda sobre la general." />
      {error && <Alert tone="bad">{error}</Alert>}
      {cargando ? <Vacio>Cargando…</Vacio> : !datos?.data.length ? <Vacio>No hay empresas de delivery registradas.</Vacio> : (
        <div className="grid gap-4 md:grid-cols-2">
          {datos.data.map((e) => (
            <Seccion key={e.id} titulo={e.trade_name ?? e.legal_name} acciones={gestiona && <Button size="sm" icon={Plus} onClick={() => setEditar({ sup: e.id })}>Tarifa</Button>}>
              <p className="text-[12.5px] text-muted">RUC {e.doc_number}{e.phone ? ` · ${e.phone}` : ""} · {e.rutas_mes} ruta(s) este mes {e.status !== "ACTIVE" && <Badge tone="bad">Inactiva</Badge>}</p>
              {!e.tarifas.length ? <Vacio>Sin tarifas.</Vacio> : (
                <ul className="mt-2 divide-y divide-line">
                  {e.tarifas.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">{soles(t.amount)} {t.base.toLowerCase()} · {t.zona ?? "todas las zonas"}</span>
                        <span className="text-[12px] text-muted">Desde {fecha(t.valid_from)}{t.valid_to ? ` hasta ${fecha(t.valid_to)}` : ""}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        {t.status !== "ACTIVE" ? <StatusBadge status="CANCELLED" /> : t.vigente ? <Badge tone="ok">Vigente</Badge> : <Badge>Fuera de vigencia</Badge>}
                        {gestiona && t.status === "ACTIVE" && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => setEditar({ sup: e.id, t })}>Editar</Button>
                            <Button size="sm" variant="ghost" onClick={async () => {
                              const c = await confirmAction({ title: "Anular la tarifa", danger: true, confirmLabel: "Anular", reason: { label: "Motivo", min: 3 } });
                              if (!c) return;
                              try { await api(`/v1/del/tarifas/${t.id}/anular`, { method: "POST", body: { reason: c.reason } }); toast.ok("Tarifa anulada."); recargar(); } catch (x) { toast.error(mensajeDe(x)); }
                            }}>Anular</Button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Seccion>
          ))}
        </div>
      )}
      {editar && datos && (
        <FormTarifa sup={editar.sup} t={editar.t} bases={datos.bases} zonas={(op.datos?.zonas ?? []).map((z) => ({ value: z.id, label: z.name }))}
          onClose={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />
      )}
    </div>
  );
}

function FormTarifa({ sup, t, bases, zonas, onClose, onListo }: { sup: string; t?: Tarifa; bases: Record<string, string>; zonas: { value: string; label: string }[]; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ zone_id: t?.zone_id ?? "", rate_basis: t?.rate_basis ?? "PER_DELIVERY", amount: t ? String(t.amount) : "", valid_from: t?.valid_from ?? hoyLima(), valid_to: t?.valid_to ?? "" });
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title={t ? "Editar tarifa" : "Nueva tarifa"} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} disabled={d.amount === "" || !d.valid_from} onClick={async () => {
          setOcupado(true);
          try {
            const body = { supplier_id: sup, zone_id: d.zone_id || null, rate_basis: d.rate_basis, amount: Number(d.amount), valid_from: d.valid_from, valid_to: d.valid_to || null };
            await api(t ? `/v1/del/tarifas/${t.id}` : "/v1/del/tarifas", { method: t ? "PUT" : "POST", body });
            toast.ok("Tarifa guardada.");
            onListo();
          } catch (x) { toast.error(mensajeDe(x)); } finally { setOcupado(false); }
        }}>Guardar</Button>
      </>
    }>
      <div className="space-y-3">
        <Field label="Zona"><Select value={d.zone_id} onChange={(e) => setD({ ...d, zone_id: e.target.value })} placeholder="Todas las zonas" options={zonas} /></Field>
        <Field label="Base"><Select value={d.rate_basis} onChange={(e) => setD({ ...d, rate_basis: e.target.value })} options={lista(bases)} /></Field>
        <Field label="Monto (S/)" required><Input type="number" inputMode="decimal" min={0} step="0.1" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde" required><Input type="date" value={d.valid_from} onChange={(e) => setD({ ...d, valid_from: e.target.value })} /></Field>
          <Field label="Hasta"><Input type="date" value={d.valid_to} onChange={(e) => setD({ ...d, valid_to: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
