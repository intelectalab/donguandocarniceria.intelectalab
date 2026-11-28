"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Plus, Route as RutaIcono } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, FiltroFecha, FiltroSelect, MapView, Modal, PageHeader, Select, StatusBadge, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg, soles } from "@/lib/formato";
import { Seccion, TarjetaRuta, Vacio, hoyLima, useDatos, useOpciones } from "@/modulos/del/comunes";
import { PEDIDO, R, type RutaResumen } from "@/modulos/del/tipos";

type PedidoPlan = {
  id: string; number: string; status: string; cliente: string | null; establishment_id: string; zona: string | null; franja: string | null; slot_id: string | null;
  direccion: string | null; distrito: string | null; lat: number; lng: number; con_pin: boolean; kg: number; cobrar: number; preparacion: string | null;
  ruta: { id: string; code: string; seq: number } | null;
};
type Plan = { pedidos: PedidoPlan[]; rutas: RutaResumen[] };

/** DEL-01 Planificador: pedidos de delivery del día por zona y franja, en el mapa; crear rutas y agregar pedidos. */
export default function Planificador() {
  const router = useRouter();
  const [dia, setDia] = useState(hoyLima());
  const op = useOpciones(dia);
  const [local, setLocal] = useState("");
  const localId = local || op.datos?.locales[0]?.id || "";
  const plan = useDatos<Plan>(localId ? `/v1/del/planificador?fecha=${dia}&establishment_id=${localId}` : null);
  const [zona, setZona] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [crear, setCrear] = useState(false);
  const [agregar, setAgregar] = useState(false);

  const pedidos = useMemo(() => (plan.datos?.pedidos ?? []).filter((p) => !zona || p.zona === zona), [plan.datos, zona]);
  const libres = pedidos.filter((p) => !p.ruta && p.status !== "DELIVERED" && p.status !== "IN_ROUTE");
  const zonas = [...new Set((plan.datos?.pedidos ?? []).map((p) => p.zona).filter(Boolean))] as string[];
  const elegidos = libres.filter((p) => sel.includes(p.id));
  const editables = (plan.datos?.rutas ?? []).filter((r) => ["PLANNED", "LOADING"].includes(r.status));
  const puede = op.datos?.puede.planificar;

  return (
    <div className="space-y-5">
      <PageHeader description="Arma las rutas del día: elige los pedidos (por zona y franja, mirando el mapa) y crea la ruta. El orden de las paradas sale del vecino más cercano desde el local." />
      <div className="flex flex-wrap items-end gap-3">
        <FiltroFecha etiqueta="Fecha de entrega" value={dia} onChange={(v) => { setDia(v || hoyLima()); setSel([]); }} />
        {(op.datos?.locales.length ?? 0) > 1 && (
          <FiltroSelect etiqueta="Local" todos="" value={localId} onChange={(v) => { setLocal(v); setSel([]); }}
            options={(op.datos?.locales ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))} />
        )}
        <FiltroSelect etiqueta="Zona" value={zona} onChange={setZona} todos="Todas" options={zonas.map((z) => ({ value: z, label: z }))} />
      </div>
      {(op.error || plan.error) && <Alert tone="bad">{op.error || plan.error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Seccion titulo={`Pedidos del día (${pedidos.length})`} acciones={puede && (
            <>
              <Button size="sm" icon={Plus} disabled={!elegidos.length} onClick={() => setCrear(true)}>Crear ruta{elegidos.length ? ` (${elegidos.length})` : ""}</Button>
              <Button size="sm" variant="secondary" disabled={!elegidos.length || !editables.length} onClick={() => setAgregar(true)}>Agregar a ruta</Button>
            </>
          )}>
            {plan.cargando ? <Vacio>Cargando…</Vacio> : !pedidos.length ? <Vacio>No hay pedidos de delivery para esta fecha.</Vacio> : (
              <ul className="divide-y divide-line">
                {pedidos.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 py-2.5">
                    <span className="pt-0.5">
                      <Checkbox checked={sel.includes(p.id)} disabled={!puede || !!p.ruta || ["IN_ROUTE", "DELIVERED"].includes(p.status)}
                        onChange={(v) => setSel((s) => (v ? [...s, p.id] : s.filter((x) => x !== p.id)))} label="" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-ink">{p.number}</span>
                        <StatusBadge status={p.status} labels={PEDIDO} />
                        {!p.con_pin && <Badge tone="warn">Sin pin</Badge>}
                        {p.ruta && <Badge tone="primary">{p.ruta.code} · parada {p.ruta.seq}</Badge>}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted">{p.cliente} · {p.direccion ?? "Sin dirección"}{p.distrito ? `, ${p.distrito}` : ""}</span>
                      <span className="block text-[12px] text-muted">{p.zona ?? "Sin zona"} · {p.franja ?? "sin franja"} · {kg(p.kg)}{p.cobrar > 0 ? ` · cobrar ${soles(p.cobrar)}` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
          {pedidos.length > 0 && (
            <Seccion titulo="Mapa">
              <MapView height={300} points={pedidos.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.ruta ? `${p.ruta.code}·${p.ruta.seq}` : p.number.slice(-4), title: `${p.number} · ${p.cliente ?? ""}`, muted: !!p.ruta }))}
                onSelect={(id) => setSel((s) => (s.includes(id) || !libres.some((p) => p.id === id) ? s : [...s, id]))} />
              <p className="mt-2 flex items-center gap-1 text-[12px] text-muted"><MapPin size={13} /> Toca un pin libre para marcarlo. En gris, los que ya tienen ruta.</p>
            </Seccion>
          )}
        </div>
        <Seccion titulo={`Rutas (${plan.datos?.rutas.length ?? 0})`}>
          {!plan.datos?.rutas.length ? <Vacio>Aún no hay rutas para esta fecha.</Vacio> : (
            <div className="space-y-3">
              {plan.datos.rutas.map((r) => <TarjetaRuta key={r.id} r={r} onClick={() => router.push(`${R.hoja}?id=${r.id}`)} />)}
            </div>
          )}
        </Seccion>
      </div>

      {crear && op.datos && (
        <CrearRuta dia={dia} local={localId} franjas={op.datos.franjas.filter((f) => f.establishment_id === localId && !f.zone_id)}
          franjaSugerida={elegidos[0]?.slot_id ?? ""} pedidos={elegidos.map((p) => p.id)}
          onClose={() => setCrear(false)} onListo={(id) => { setCrear(false); setSel([]); router.push(`${R.hoja}?id=${id}`); }} />
      )}
      {agregar && (
        <Modal open onClose={() => setAgregar(false)} title={`Agregar ${elegidos.length} pedido(s)`} size="sm">
          <div className="space-y-2">
            {editables.map((r) => (
              <Button key={r.id} className="w-full justify-start" icon={RutaIcono} onClick={async () => {
                try {
                  await api(`/v1/del/rutas/${r.id}/paradas`, { method: "POST", body: { order_ids: elegidos.map((p) => p.id) } });
                  toast.ok(`Agregados a ${r.code}.`);
                  setAgregar(false); setSel([]); plan.recargar();
                } catch (e) { toast.error(mensajeDe(e)); }
              }}>{r.code} · {r.paradas} parada(s)</Button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function CrearRuta({ dia, local, franjas, franjaSugerida, pedidos, onClose, onListo }: {
  dia: string; local: string; franjas: { id: string; name: string; slot_from: string; slot_to: string }[]; franjaSugerida: string; pedidos: string[];
  onClose: () => void; onListo: (id: string) => void;
}) {
  const [franja, setFranja] = useState(franjas.some((f) => f.id === franjaSugerida) ? franjaSugerida : "");
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal open onClose={onClose} title="Nueva ruta" size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" loading={ocupado} onClick={async () => {
          setOcupado(true);
          try {
            const h = await api<{ ruta: { id: string; code: string } }>("/v1/del/rutas", { method: "POST", body: { route_date: dia, establishment_id: local, slot_id: franja || null, order_ids: pedidos } });
            toast.ok(`Ruta ${h.ruta.code} creada.`);
            onListo(h.ruta.id);
          } catch (e) { toast.error(mensajeDe(e)); } finally { setOcupado(false); }
        }}>Crear con {pedidos.length} pedido(s)</Button>
      </>
    }>
      <Field label="Franja de la ruta" hint="Da el código de la ruta y la hora de salida para las horas estimadas.">
        <Select value={franja} onChange={(e) => setFranja(e.target.value)} placeholder="Sin franja"
          options={franjas.map((f) => ({ value: f.id, label: `${f.name} (${f.slot_from.slice(0, 5)}–${f.slot_to.slice(0, 5)})` }))} />
      </Field>
    </Modal>
  );
}
