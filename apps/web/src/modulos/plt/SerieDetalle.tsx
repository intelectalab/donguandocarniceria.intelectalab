"use client";

import { useEffect, useState } from "react";
import { Button, DetailList, Modal, StatusBadge, confirmAction, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje, soles } from "@/lib/formato";
import { TIPOS_DOCUMENTO, etiqueta, usoSerie, type Serie } from "./tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };

/** Ficha de una serie (PLT-08): datos, uso del rango, últimos números emitidos y activar o desactivar. */
export function SerieDetalle({ serie, puedeEditar, onClose, onCambio }:
  { serie: Serie; puedeEditar: boolean; onClose: () => void; onCambio: () => void }) {
  const [detalle, setDetalle] = useState<Serie | null>(null);
  const [guardando, setGuardando] = useState(false);
  const activa = serie.status === "ACTIVE";
  const uso = usoSerie(serie.next_number);

  useEffect(() => {
    let vigente = true;
    api<Serie>(`/v1/plt/series/${serie.id}`).then((s) => vigente && setDetalle(s)).catch(() => vigente && setDetalle({ ...serie, ultimos: [] }));
    return () => { vigente = false; };
  }, [serie]);

  async function cambiarEstado() {
    const r = await confirmAction({
      title: `${activa ? "Desactivar" : "Activar"} la serie ${serie.series}`,
      message: activa
        ? "Una serie inactiva no numera documentos nuevos. Los ya emitidos no cambian."
        : `La serie vuelve a numerar desde el ${numero(serie.next_number)}.`,
      confirmLabel: activa ? "Desactivar" : "Activar",
      danger: activa,
      reason: { label: "Motivo", min: 10 },
    });
    if (!r) return;
    setGuardando(true);
    try {
      await api(`/v1/plt/series/${serie.id}/estado`, { method: "PUT", body: { status: activa ? "INACTIVE" : "ACTIVE", reason: r.reason } });
      toast.ok(`Serie ${serie.series} ${activa ? "desactivada" : "activada"}`);
      onCambio();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Serie ${serie.series}`} description={etiqueta(TIPOS_DOCUMENTO, serie.doc_type)}
      footer={<>
        <Button onClick={onClose}>Cerrar</Button>
        {puedeEditar && <Button variant={activa ? "danger" : "primary"} loading={guardando} onClick={cambiarEstado}>{activa ? "Desactivar" : "Activar"}</Button>}
      </>}>
      <DetailList items={[
        { label: "Estado", value: <StatusBadge status={serie.status} labels={ESTADOS} /> },
        { label: "Electrónica", value: serie.is_electronic ? "Sí, se envía a SUNAT" : "No, es interna" },
        { label: "Local", value: serie.establishment_name ?? "Toda la empresa" },
        { label: "Marca", value: serie.brand_name ?? "Todas" },
        { label: "Siguiente número", value: <span className="tabular-nums">{numero(serie.next_number)}</span> },
        { label: "Uso del rango", value: porcentaje(uso, uso < 0.01 ? 4 : 1) },
        ...(serie.applies_to ? [{ label: "Se aplica a", value: serie.applies_to === "INVOICE" ? "Facturas" : "Boletas" }] : []),
        ...(serie.company_name ? [{ label: "Empresa", value: serie.company_name }] : []),
        { label: "Nota", value: serie.note ?? "—" },
        ...(serie.status_reason ? [{ label: "Motivo del último cambio", value: serie.status_reason }] : []),
      ]} />

      <section className="mt-6 border-t border-line pt-4">
        <h3 className="mb-2 text-[14px] font-semibold">Últimos números emitidos</h3>
        {detalle === null ? (
          <p className="text-[13px] text-muted">Cargando…</p>
        ) : detalle.ultimos?.length ? (
          <ul className="divide-y divide-line text-[13px]">
            {detalle.ultimos.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-mono font-medium">{d.full_number}</p>
                  <p className="truncate text-[12px] text-muted">{d.customer_name ?? "Sin cliente"} · {fecha(d.issue_date)}</p>
                </div>
                <span className="shrink-0 tabular-nums">{soles(d.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Todavía no hay comprobantes con esta serie.</p>
        )}
      </section>
    </Modal>
  );
}
