"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, Printer, RefreshCw, ScanLine } from "lucide-react";
import { Alert, Button, StatusBadge, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Avance, CabeceraTarea, ConTarea, Imprimible, Seccion, Vacio } from "@/modulos/pre/comunes";
import { LINEA, R, RESULTADOS, cantidad, cuando, hecho, nombreBolsa, type Tarea } from "@/modulos/pre/tipos";

/** PRE-03 Lista por pedido: ticket de preparación con líneas, cortes, notas, número de bolsas sugerido y parada. */
export default function ListaPorPedido() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <ConTarea id={id} ruta={R.ticket} titulo="Pedidos en preparación" vacio="No hay pedidos en olas liberadas para esta fecha.">
      {(t, poner) => <Ticket t={t} poner={poner} />}
    </ConTarea>
  );
}

function Ticket({ t, poner }: { t: Tarea; poner: (t: Tarea) => void }) {
  const router = useRouter();
  const { can, puede } = useSesion();
  const [ocupado, setOcupado] = useState("");
  const o = t.pedido;
  const supervisa = puede("PRE", "E") && (can("pre.wave.manage") || can("pre.short.approve"));
  const armable = ["PENDING", "PICKING"].includes(t.estado) && o.status !== "CANCELLED";

  async function anular() {
    const r = await confirmAction({
      title: `Anular la tarea de ${o.number}`, message: "Lo armado vuelve al almacén y las bolsas quedan devueltas.", confirmLabel: "Anular tarea", danger: true,
      reason: { label: "Nota", optional: true },
    });
    if (!r) return;
    setOcupado("anular");
    try {
      poner(await api<Tarea>(`/v1/pre/tareas/${t.id}/anular`, { method: "POST", body: { note: r.reason } }));
      toast.ok("Tarea anulada: el stock volvió al almacén");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function reintentar() {
    setOcupado("stock");
    try {
      const n = await api<Tarea>(`/v1/pre/tareas/${t.id}/stock`, { method: "POST" });
      poner(n);
      if (n.stock_error) toast.error(n.stock_error);
      else toast.ok("Stock descontado");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="mx-auto max-w-[860px] space-y-4">
      <CabeceraTarea t={t} volver={R.ticket}>
        <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
          {o.direccion && <p className="text-ink">{o.direccion}{o.referencia ? <span className="text-muted"> · {o.referencia}</span> : null}</p>}
          {o.notes && <p className="rounded-lg bg-warn-soft px-3 py-2 text-ink"><b>Nota del pedido:</b> {o.notes}</p>}
          <p className="text-muted">
            Sugerido: <b className="text-ink">{t.sugerido.count} {nombreBolsa(t.sugerido.type).toLowerCase()}{t.sugerido.count > 1 ? "s" : ""}</b>
            {t.preparador ? ` · arma ${t.preparador}` : ""}{t.verificador ? ` · verificó ${t.verificador}` : ""}
          </p>
          <div className="flex items-center gap-2"><span className="w-20 shrink-0 text-muted">Avance</span><Avance valor={t.avance} /><span className="w-12 shrink-0 text-right whitespace-nowrap text-muted">{t.avance} %</span></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {armable && can("pre.task.pick") && <Button variant="primary" icon={ScanLine} onClick={() => router.push(`${R.armado}?id=${t.id}`)}>Armar con escaneo</Button>}
          <Button icon={Printer} onClick={() => window.print()}>Imprimir ticket</Button>
          {supervisa && o.status === "CANCELLED" && t.estado !== "CANCELLED" && (
            <Button variant="danger" icon={Ban} loading={ocupado === "anular"} onClick={anular}>Anular tarea</Button>
          )}
        </div>
      </CabeceraTarea>

      {t.stock_error && (
        <Alert tone="bad" title="No se pudo descontar el stock">
          <p>{t.stock_error}</p>
          {supervisa && <div className="mt-2"><Button size="sm" icon={RefreshCw} loading={ocupado === "stock"} onClick={reintentar}>Reintentar</Button></div>}
        </Alert>
      )}

      <Seccion titulo="Líneas del pedido">
        <ul className="divide-y divide-line">
          {t.lineas.map((l) => (
            <li key={l.id} className="space-y-1.5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-ink">{l.name}</p>
                  <p className="font-mono text-[11.5px] text-muted">{l.sku}{l.requires_lot ? " · con lote" : ""}{l.weighted ? " · se pesa" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-ink">{cantidad(l)}</p>
                  {l.sale_mode !== "KG" && l.est_weight_kg ? <p className="text-[12px] text-muted">~{kg(l.est_weight_kg)}</p> : null}
                </div>
              </div>
              {l.cut_notes && <p className="rounded-lg bg-warn-soft px-3 py-1.5 text-[12.5px] text-ink"><b>Corte:</b> {l.cut_notes}</p>}
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <StatusBadge status={l.status} labels={LINEA} />
                <span className="text-muted">Armado {hecho(l)}{l.weighted && l.sale_mode !== "KG" && l.weighed_kg ? ` · ${kg(l.weighed_kg)}` : ""}</span>
                {l.lote_sugerido && <span className="text-muted">· FEFO: <b className="font-mono text-ink">{l.lote_sugerido.code}</b> vence {fecha(l.lote_sugerido.vence)} ({l.lote_sugerido.almacen})</span>}
              </div>
              {l.short_reason && <p className="text-[12.5px] text-info">Faltante: {l.short_reason}{l.status === "SHORT_APPROVED" ? " (aprobado)" : " (por aprobar)"}</p>}
              <Avance valor={l.avance} />
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Lecturas">
        {t.lecturas.length === 0 ? <Vacio>Aún no se escaneó nada.</Vacio> : (
          <ul className="divide-y divide-line">
            {t.lecturas.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[12.5px]">
                <span className="min-w-0">
                  <span className="block text-ink">{s.message ?? s.barcode}</span>
                  <span className="block text-muted">{cuando(s.scanned_at)} · {s.usuario ?? "—"} · <span className="font-mono">{s.barcode}</span>{s.scan_type === "LOAD" ? " · carga" : ""}</span>
                </span>
                <StatusBadge status={s.override_of ? (s.result === "OK" ? "AUT" : "NEG") : s.result}
                  labels={{ ...RESULTADOS, AUT: ["Autorizado", "ok"], NEG: ["Negado", "bad"] }} />
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Imprimible>
        <div className="text-[12px] text-black">
          <p className="text-[18px] font-bold">{o.number} · {t.ruta ? `Ruta ${t.ruta} · parada ${t.parada ?? "—"}` : "Sin ruta"}</p>
          <p>{o.cliente} · {o.marca} · {fecha(o.delivery_date)} {o.slot_from?.slice(0, 5)}–{o.slot_to?.slice(0, 5)} · {t.wave.number}</p>
          {o.direccion && <p>{o.direccion}{o.referencia ? ` · ${o.referencia}` : ""}</p>}
          {o.notes && <p className="mt-1 font-bold">Nota: {o.notes}</p>}
          <table className="mt-2 w-full border-collapse">
            <thead><tr>{["✓", "Producto", "Cantidad", "Corte", "Lote FEFO"].map((h) => <th key={h} className="border border-black px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
            <tbody>
              {t.lineas.map((l) => (
                <tr key={l.id}>
                  <td className="w-6 border border-black px-1.5 py-1" />
                  <td className="border border-black px-1.5 py-1">{l.name} <span className="font-mono">{l.sku}</span></td>
                  <td className="border border-black px-1.5 py-1 whitespace-nowrap">{cantidad(l)}</td>
                  <td className="border border-black px-1.5 py-1">{l.cut_notes ?? ""}</td>
                  <td className="border border-black px-1.5 py-1 font-mono">{l.lote_sugerido?.code ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">Bolsas sugeridas: {t.sugerido.count} {nombreBolsa(t.sugerido.type).toLowerCase()} · Armó: ____________ · Verificó: ____________</p>
        </div>
      </Imprimible>
    </div>
  );
}
