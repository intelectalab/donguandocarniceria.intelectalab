"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Truck } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, Select, StatusBadge, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Vacio } from "@/modulos/ped/Seccion";
import { useOpciones } from "@/modulos/ped/usePedido";
import { ESTADOS, celular } from "@/modulos/ped/tipos";

type Envio = {
  id: string; number: string; status: string; delivery_date: string | null; estimated_total: string; final_total: string | null; paid_amount: string;
  province_agency: string | null; province_destination: string | null; thermal_packaging: boolean | null; tracking_number: string | null;
  dispatch_guide_number: string | null; agencia: string | null; cliente: string | null; celular: string | null; marca: string | null; address_line: string | null; district: string | null;
};
type Vista = "POR_DESPACHAR" | "DESPACHADOS" | "TODOS";
type Form = { province_agency: string; province_destination: string; thermal_packaging: boolean; tracking_number: string; dispatch_guide_number: string };

/** PED-11 Pedidos de provincia: agencia, destino, embalaje térmico, guía y seguimiento. Sin guía y seguimiento no sale a ruta (RN-PED-08). */
export default function Provincia() {
  const router = useRouter();
  const { puede } = useSesion();
  const op = useOpciones();
  const [vista, setVista] = useState<Vista>("POR_DESPACHAR");
  const [filas, setFilas] = useState<{ vista: Vista; datos: Envio[] } | null>(null);
  const [version, setVersion] = useState(0);
  const [editando, setEditando] = useState<Envio | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const editar = puede("PED", "E");

  useEffect(() => {
    let vigente = true;
    api<Envio[]>(`/v1/ped/provincia?vista=${vista}`).then((d) => vigente && setFilas({ vista, datos: d })).catch((e) => toast.error(mensajeDe(e)));
    return () => { vigente = false; };
  }, [vista, version]);

  function abrir(e: Envio) {
    setError("");
    setEditando(e);
    setForm({ province_agency: e.province_agency ?? "", province_destination: e.province_destination ?? "", thermal_packaging: Boolean(e.thermal_packaging),
      tracking_number: e.tracking_number ?? "", dispatch_guide_number: e.dispatch_guide_number ?? "" });
  }

  async function guardar() {
    if (!editando || !form) return;
    setOcupado("guardar");
    setError("");
    try {
      await api(`/v1/ped/provincia/${editando.id}`, { method: "PUT", body: { ...form, province_agency: form.province_agency || null } });
      toast.ok("Datos del envío guardados");
      setEditando(null);
      setVersion((n) => n + 1);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function aRuta(e: Envio) {
    setOcupado(e.id);
    try {
      await api(`/v1/ped/pedidos/${e.id}/estado`, { method: "POST", body: { to: "IN_ROUTE" } });
      toast.ok(`${e.number} salió con la agencia`);
      setVersion((n) => n + 1);
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const datos = filas?.vista === vista ? filas.datos : null;
  return (
    <div className="space-y-4">
      <Tabs value={vista} onChange={setVista} tabs={[{ key: "POR_DESPACHAR", label: "Por despachar" }, { key: "DESPACHADOS", label: "Despachados" }, { key: "TODOS", label: "Todos" }]} />
      {!datos ? <Vacio>Cargando…</Vacio> : datos.length === 0 ? <Vacio>No hay envíos a provincia en esta vista.</Vacio> : (
        <ul className="space-y-3">
          {datos.map((e) => {
            const listo = Boolean(e.tracking_number && e.dispatch_guide_number);
            return (
              <li key={e.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => router.push(`/m/ped/ped-03?id=${e.id}`)} className="cursor-pointer font-semibold text-ink hover:underline">{e.number}</button>
                      <StatusBadge status={e.status} labels={ESTADOS} />
                      {e.thermal_packaging && <Badge tone="info">Embalaje térmico</Badge>}
                    </div>
                    <p className="text-[12.5px] text-muted">{e.cliente} · {celular(e.celular)} · {e.marca} · {fecha(e.delivery_date)}</p>
                    <p className="text-[12.5px] text-muted">{e.address_line}{e.district ? `, ${e.district}` : ""}</p>
                  </div>
                  <span className="text-[14px] font-semibold text-ink">{soles(e.final_total ?? e.estimated_total)}</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
                  <Dato t="Agencia" v={e.agencia} />
                  <Dato t="Destino" v={e.province_destination} />
                  <Dato t="Guía de remisión" v={e.dispatch_guide_number} />
                  <Dato t="Seguimiento" v={e.tracking_number} />
                </dl>
                {editar && !["DELIVERED", "CLOSED", "CANCELLED"].includes(e.status) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" icon={Pencil} onClick={() => abrir(e)}>Datos del envío</Button>
                    {e.status === "READY" && (
                      <Button size="sm" variant="primary" icon={Truck} disabled={!listo} loading={ocupado === e.id} onClick={() => aRuta(e)}
                        title={listo ? "" : "Falta la guía o el número de seguimiento"}>Salió con la agencia</Button>
                    )}
                    {e.status === "READY" && !listo && <span className="self-center text-[12px] text-warn">Falta guía o seguimiento para despachar.</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal open={Boolean(editando)} onClose={() => setEditando(null)} title={editando ? `Envío de ${editando.number}` : ""}
        footer={<><Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button><Button variant="primary" loading={ocupado === "guardar"} onClick={guardar}>Guardar</Button></>}>
        {form && editando && (
          <div className="space-y-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Agencia" required>
              <Select value={form.province_agency} disabled={["IN_ROUTE", "NOT_DELIVERED"].includes(editando.status)} onChange={(e) => setForm({ ...form, province_agency: e.target.value })}
                placeholder="Elige la agencia" options={(op?.agencias ?? []).map((a) => ({ value: a.id, label: a.name }))} />
            </Field>
            <Field label="Destino" hint="Ciudad o código de la agencia."><Input value={form.province_destination} maxLength={20} onChange={(e) => setForm({ ...form, province_destination: e.target.value })} /></Field>
            <Checkbox checked={form.thermal_packaging} onChange={(v) => setForm({ ...form, thermal_packaging: v })} label="Lleva embalaje térmico" />
            <Field label="Guía de remisión"><Input value={form.dispatch_guide_number} maxLength={40} onChange={(e) => setForm({ ...form, dispatch_guide_number: e.target.value })} /></Field>
            <Field label="Número de seguimiento" hint="Se le comparte al cliente."><Input value={form.tracking_number} maxLength={40} onChange={(e) => setForm({ ...form, tracking_number: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Dato({ t, v }: { t: string; v: string | null }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-1.5">
      <dt className="text-[11.5px] text-muted">{t}</dt>
      <dd className={`truncate ${v ? "text-ink" : "text-warn"}`}>{v || "Falta"}</dd>
    </div>
  );
}
