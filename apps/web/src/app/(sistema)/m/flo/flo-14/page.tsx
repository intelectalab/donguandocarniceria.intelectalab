"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, FiltroSelect, Modal, PageHeader, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroVehiculo, Seccion, Vacio, useDatos, useOpciones } from "@/modulos/flo/comunes";
import { ALERTA, REVISION, SEVERIDAD, type Alerta } from "@/modulos/flo/tipos";

type Lista = { data: Alerta[]; por_tipo: Record<string, { n: number; graves: number }> };

/** A qué pantalla ir para resolver cada tipo de alerta. */
function destino(a: Alerta): { href: string; texto: string } | null {
  const v = a.vehicle_id ?? "";
  const dia = a.first_at.slice(0, 10);
  switch (a.alert_type) {
    case "FUEL_EFFICIENCY": return { href: "/m/flo/flo-06", texto: "Ver rendimiento" };
    case "MAINTENANCE": return { href: "/m/flo/flo-07", texto: "Ver planes de mantenimiento" };
    case "DOCUMENT": return { href: "/m/flo/flo-09", texto: "Renovar el documento" };
    case "TEMPERATURE": return { href: "/m/flo/flo-13", texto: "Ver la temperatura" };
    case "GPS_SILENT": return { href: "/m/flo/flo-01", texto: "Ver el mapa en vivo" };
    case "SPEED": return { href: `/m/flo/flo-02?vehiculo=${v}&fecha=${dia}`, texto: "Ver el recorrido" };
    case "ODOMETER": return v ? { href: `/m/flo/flo-04?id=${v}`, texto: "Ver la ficha del vehículo" } : null;
    default: return null;
  }
}

/** FLO-14 Alertas de flota (RN-FLO-20): una bandeja para rendimiento, mantenimiento, documentos, temperatura, GPS, odómetro y velocidad. */
export default function Alertas() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const sp = useSearchParams();
  const { datos: op } = useOpciones();
  const [estado, setEstado] = useState("");
  const [tipo, setTipo] = useState(sp.get("tipo") ?? "");
  const [vehiculo, setVehiculo] = useState(sp.get("vehiculo") ?? "");
  const [abierta, setAbierta] = useState<Alerta | null>(null);
  const [revisando, setRevisando] = useState(false);
  const q = new URLSearchParams({ ...(estado ? { estado } : {}), ...(tipo ? { tipo } : {}), ...(vehiculo ? { vehiculo } : {}) });
  const { datos, error, cargando, recargar } = useDatos<Lista>(`/v1/flo/alertas?${q}`);
  if (error) return <ErrorCarga error={error} que="Las alertas de flota las ven el coordinador de reparto, quien gestiona la flota y calidad." />;
  async function barrer() {
    setRevisando(true);
    try {
      const r = await api<{ abiertas: number }>("/v1/flo/alertas/barrido", { method: "POST" });
      toast.ok(`Revisado: ${r.abiertas} alerta(s) sin cerrar.`);
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setRevisando(false);
    }
  }
  const tipos = op?.alertas ?? {};
  const columnas: Column<Alerta>[] = [
    { key: "title", header: "Alerta", cardTitle: true, render: (a) => (
      <span className="flex flex-col"><span className="font-medium">{a.title}</span><span className="text-[12px] text-muted">{a.number} · {a.tipo}{a.occurrences > 1 ? ` · ${a.occurrences} veces` : ""}</span></span>
    ) },
    { key: "severity", header: "Gravedad", render: (a) => <Estado s={a.severity} labels={SEVERIDAD} /> },
    { key: "vehiculo", header: "Vehículo", hideOnMobile: true, render: (a) => a.vehiculo ?? a.conductor ?? "—" },
    { key: "last_at", header: "Última vez", hideOnMobile: true, render: (a) => fechaHora(a.last_at) },
    { key: "pendientes", header: "", render: (a) => (a.pendientes > 0 ? <Badge tone="warn">{a.pendientes} pedidos por revisar</Badge> : null) },
    { key: "status", header: "Estado", render: (a) => <Estado s={a.status} labels={ALERTA} /> },
  ];
  const resumen = Object.entries(datos?.por_tipo ?? {});
  return (
    <div className="space-y-4">
      <PageHeader description="Cada problema de la flota abre una sola alerta (si se repite, suma veces). Atiéndela diciendo qué hiciste y ciérrala con la resolución. Algunas se cierran solas cuando se corrige la causa."
        actions={<Button icon={RefreshCw} loading={revisando} onClick={barrer}>Revisar ahora</Button>} />
      {resumen.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {resumen.map(([k, v]) => (
            <button key={k} type="button" onClick={() => setTipo(tipo === k ? "" : k)}
              className={`rounded-full border px-3 py-1 text-[12.5px] ${tipo === k ? "border-primary bg-primary text-white" : "border-line bg-surface text-ink hover:bg-surface-2"}`}>
              {tipos[k] ?? k} · {v.n}{v.graves > 0 && <span className={tipo === k ? "" : "text-bad"}> ({v.graves} graves)</span>}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} vacio="Sin cerrar"
          options={[{ value: "OPEN", label: "Abiertas" }, { value: "ACK", label: "Atendidas" }, { value: "CLOSED", label: "Cerradas" }, { value: "TODAS", label: "Todas" }]} />
        <FiltroSelect etiqueta="Tipo" value={tipo} onChange={setTipo} options={Object.entries(tipos).map(([k, l]) => ({ value: k, label: l }))} />
        <FiltroVehiculo op={op} value={vehiculo} onChange={setVehiculo} />
      </div>
      <DataTable rows={datos?.data ?? []} columns={columnas} loading={cargando} onRowClick={setAbierta}
        empty={<Vacio>{estado === "" ? "No hay alertas sin cerrar. Todo en orden." : "No hay alertas con estos filtros."}</Vacio>} />
      {abierta && <Detalle a={abierta} onClose={() => setAbierta(null)} onCambio={(a) => { setAbierta(a); recargar(); }} />}
    </div>
  );
}

function Detalle({ a, onClose, onCambio }: { a: Alerta; onClose: () => void; onCambio: (a: Alerta) => void }) {
  const [ocupado, setOcupado] = useState("");
  const ir = destino(a);
  async function accion(clave: string, url: string, body: Record<string, unknown>, ok: string) {
    setOcupado(clave);
    try {
      const r = await api<Alerta>(url, { method: "POST", body });
      toast.ok(ok);
      onCambio(r);
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setOcupado("");
    }
  }
  async function atender() {
    const r = await confirmAction({ title: `Atender ${a.number}`, message: "Cuenta qué hiciste: llamaste al conductor, programaste el taller, pediste el documento…", confirmLabel: "Atender", reason: { label: "Acción tomada", min: 3 } });
    if (r) await accion("atender", `/v1/flo/alertas/${a.id}/atender`, { note: r.reason }, "Alerta atendida.");
  }
  async function cerrar() {
    const r = await confirmAction({ title: `Cerrar ${a.number}`, message: "La alerta se cierra con su resolución y queda en el historial.", confirmLabel: "Cerrar alerta", reason: { label: "Resolución", min: 3 } });
    if (r) await accion("cerrar", `/v1/flo/alertas/${a.id}/cerrar`, { resolution: r.reason }, "Alerta cerrada.");
  }
  async function revisar(o: Alerta["order_reviews"][number], decision: "RELEASED" | "REJECTED") {
    const rechazar = decision === "REJECTED";
    const r = await confirmAction({
      title: `${rechazar ? "Rechazar" : "Liberar"} ${o.number}`,
      message: rechazar ? "El pedido no se entrega como está: indica si va reclamo o reposición." : "La carne del pedido está bien y se entrega.",
      confirmLabel: rechazar ? "Rechazar" : "Liberar", danger: rechazar, reason: { label: rechazar ? "Motivo" : "Nota", min: rechazar ? 5 : 0, optional: !rechazar },
    });
    if (r) await accion(o.order_id, `/v1/flo/alertas/${a.id}/pedidos`, { order_id: o.order_id, decision, note: r.reason || null }, rechazar ? "Pedido rechazado." : "Pedido liberado.");
  }
  const pendientes = a.order_reviews.filter((o) => o.status === "PENDING").length;
  return (
    <Modal open onClose={onClose} title={`${a.number} · ${a.tipo}`} placement="right"
      footer={a.status !== "CLOSED" && (
        <>
          {a.status === "OPEN" && <Button loading={ocupado === "atender"} onClick={atender}>Atender</Button>}
          <Button variant="primary" loading={ocupado === "cerrar"} onClick={cerrar} disabled={a.alert_type === "TEMPERATURE" && pendientes > 0}>Cerrar alerta</Button>
        </>
      )}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><Estado s={a.severity} labels={SEVERIDAD} /><Estado s={a.status} labels={ALERTA} /></div>
        <p className="font-medium text-ink">{a.title}</p>
        {a.detail && <p className="text-[13px] text-muted">{a.detail}</p>}
        {ir && <Link href={ir.href} className="inline-block text-[13px] font-medium text-primary hover:underline">{ir.texto}</Link>}
        <DetailList items={[
          { label: "Vehículo", value: a.vehiculo ?? "—" },
          { label: "Conductor", value: a.conductor ?? "—" },
          { label: "Primera vez", value: fechaHora(a.first_at) },
          { label: "Última vez", value: `${fechaHora(a.last_at)}${a.occurrences > 1 ? ` (${a.occurrences} veces)` : ""}` },
          ...(a.excursion_minutes !== null ? [{ label: "Fuera de rango", value: `${a.excursion_minutes} min${a.max_value !== null ? ` · máx. ${a.max_value} °C` : ""}` }] : []),
          ...(a.ack_note ? [{ label: "Atendida", value: `${a.ack_note} (${a.atendio ?? "—"}, ${fechaHora(a.ack_at)})` }] : []),
          ...(a.resolution ? [{ label: "Resolución", value: `${a.resolution} (${a.cerro ?? "sistema"}, ${fechaHora(a.closed_at)})` }] : []),
        ]} />
        {a.order_reviews.length > 0 && (
          <Seccion titulo={`Pedidos de la ruta a revisión (${pendientes} por revisar)`}>
            {pendientes > 0 && a.status !== "CLOSED" && <Alert tone="warn">Libera o rechaza cada pedido antes de cerrar la alerta (RN-FLO-14).</Alert>}
            <ul className="mt-2 divide-y divide-line">
              {a.order_reviews.map((o) => (
                <li key={o.order_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{o.number}</span>
                    {o.decided_by && <span className="text-[12px] text-muted">{o.decided_by} · {fechaHora(o.decided_at)}{o.note ? ` · ${o.note}` : ""}</span>}
                  </span>
                  {o.status === "PENDING" ? (
                    <span className="flex gap-1">
                      <Button size="sm" loading={ocupado === o.order_id} onClick={() => revisar(o, "RELEASED")}>Liberar</Button>
                      <Button size="sm" variant="ghost" disabled={ocupado === o.order_id} onClick={() => revisar(o, "REJECTED")}>Rechazar</Button>
                    </span>
                  ) : <Estado s={o.status} labels={REVISION} />}
                </li>
              ))}
            </ul>
          </Seccion>
        )}
      </div>
    </Modal>
  );
}
