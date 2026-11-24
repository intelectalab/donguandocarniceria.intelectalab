"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { Alert, Badge, Button, DetailList, Modal, Select, confirmAction, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

export type Archivo = {
  id: string; file_name: string; ext: string | null; size_bytes: number; sha256: string; classification: string; classification_name: string; sensible: boolean;
  entity: string | null; entity_id: string | null; registro: string; status: string; uploaded_by: string | null; uploaded_at: string | null;
  deleted_reason: string | null; deleted_by: string | null; deleted_at: string | null; descargable: boolean;
};
type Enlace = { url: string; expires_at: string; minutos: number };

export const CLASIFICACIONES: [string, string][] = [["PUBLIC", "Público"], ["INTERNAL", "Interno"], ["CONFIDENTIAL", "Confidencial"], ["PERSONAL_DATA", "Datos personales"]];

/** 1 200 000 → «1,1 MB». */
export const tamano = (b: number) => (b >= 1048576 ? `${numero(b / 1048576, 1)} MB` : `${numero(Math.max(1, Math.round(b / 1024)))} KB`);

export function Clasificacion({ a }: { a: Pick<Archivo, "classification_name" | "sensible"> }) {
  return <Badge tone={a.sensible ? "warn" : "neutral"}>{a.classification_name}</Badge>;
}

/** «Descargar»: pide el enlace firmado (vence en minutos) y lo muestra con sus datos antes de abrirlo. */
export function useDescarga() {
  const [enlace, setEnlace] = useState<{ a: Archivo; e: Enlace } | null>(null);
  const pedir = async (a: Archivo) => {
    try {
      setEnlace({ a, e: await api<Enlace>(`/v1/int/archivos/${a.id}/enlace`, { method: "POST" }) });
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  };
  const modal = enlace && (
    <Modal open onClose={() => setEnlace(null)} title="Enlace temporal de descarga" size="md"
      footer={<a href={enlace.e.url} target="_blank" rel="noopener noreferrer" onClick={() => setEnlace(null)}
        className="inline-flex min-h-10 items-center gap-2 rounded-[9px] bg-primary px-4 text-[13.5px] font-semibold text-primary-ink hover:opacity-90"><Download size={16} aria-hidden="true" />Descargar</a>}>
      <div className="grid gap-4">
        <DetailList items={[
          { label: "Archivo", value: enlace.a.file_name }, { label: "Clasificación", value: <Clasificacion a={enlace.a} /> },
          { label: "Vence", value: `${fechaHora(enlace.e.expires_at)} (${enlace.e.minutos} minutos)` },
          { label: "Huella SHA-256", value: <span className="font-mono text-[11.5px] break-all">{enlace.a.sha256}</span> },
        ]} />
        <Alert tone="info">Es un enlace firmado y temporal: no hay ninguna dirección pública del archivo.{enlace.a.sensible ? " Esta descarga queda registrada en la bitácora." : ""}</Alert>
      </div>
    </Modal>
  );
  return { pedir, modal };
}

/**
 * Panel de adjuntos de un registro (pedido, cobro, trabajador…): lista, subir (archivo o cámara en el celular),
 * descargar con enlace temporal y eliminar con motivo. Se usa en cualquier ficha:
 *   <Adjuntos entidad="sales_orders" id={pedido.id} clasificacion="INTERNAL" camara />
 */
export function Adjuntos({ entidad, id, clasificacion = "INTERNAL", camara, permitidos, maxMb, onCambio }: {
  entidad: string; id: string; clasificacion?: string; camara?: boolean; permitidos?: string[]; maxMb?: number; onCambio?: () => void;
}) {
  const { can, puede } = useSesion();
  const sube = Boolean(can("int.file.upload")) && puede("INT", "C");
  const elimina = Boolean(can("int.file.delete")) && puede("INT", "E");
  const [archivos, setArchivos] = useState<Archivo[] | null>(null);
  const [clase, setClase] = useState(clasificacion);
  const [subiendo, setSubiendo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const descarga = useDescarga();

  const cargar = useCallback(() => {
    api<{ data: Archivo[] }>(`/v1/int/archivos?entity=${entidad}&entity_id=${id}&per_page=50`).then((r) => setArchivos(r.data)).catch((e) => toast.error(mensajeDe(e)));
  }, [entidad, id]);
  // La clasificación inicial sale de la prop; quien usa el panel le da una key por registro para empezar de nuevo.
  useEffect(() => cargar(), [cargar]);

  async function subir(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entity", entidad);
    fd.append("entity_id", id);
    fd.append("classification", clase);
    setSubiendo(true);
    try {
      const a = await api<Archivo>("/v1/int/archivos", { method: "POST", body: fd });
      toast.ok(`${a.file_name} adjuntado`);
      cargar();
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function eliminar(a: Archivo) {
    const r = await confirmAction({ title: `¿Eliminar ${a.file_name}?`, danger: true, confirmLabel: "Eliminar",
      message: "Se marca como eliminado y deja de poder descargarse. El contenido se depura después, según la retención.", reason: { min: 10, label: "Motivo" } });
    if (!r) return;
    try {
      await api(`/v1/int/archivos/${a.id}/eliminar`, { method: "POST", body: { reason: r.reason } });
      toast.ok("Archivo marcado como eliminado");
      cargar();
      onCambio?.();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const aceptar = permitidos?.length ? permitidos.map((x) => `.${x.toLowerCase()}`).join(",") : "image/*,.pdf,.mp3,.ogg,.wav,.csv,.xlsx,.xml,.zip";
  return (
    <div className="grid gap-3">
      {archivos === null && <p className="text-[13px] text-muted">Cargando…</p>}
      {archivos?.length === 0 && <p className="text-[13px] text-muted">Sin archivos adjuntos.</p>}
      {archivos?.map((a) => (
        <div key={a.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-md bg-primary-soft font-mono text-[11px] font-semibold text-primary">{a.ext ?? "?"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] text-ink" title={a.file_name}>{a.file_name}</p>
            <p className="text-[12px] text-muted">{tamano(a.size_bytes)} · {a.classification_name} · {a.uploaded_by ?? "—"}</p>
          </div>
          {a.status === "ACTIVE" ? (
            <div className="flex shrink-0 gap-1">
              <Button size="sm" icon={Download} onClick={() => descarga.pedir(a)}>Descargar</Button>
              {elimina && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => eliminar(a)} aria-label={`Eliminar ${a.file_name}`}>Eliminar</Button>}
            </div>
          ) : <span title={a.deleted_reason ?? ""}><Badge>Eliminado</Badge></span>}
        </div>
      ))}
      {sube && (
        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <label className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[9px] border border-dashed border-line px-3 text-[13px] font-medium text-ink hover:border-primary ${subiendo ? "pointer-events-none opacity-60" : ""}`}>
            {subiendo ? <Paperclip size={16} aria-hidden="true" className="animate-pulse" /> : <Upload size={16} aria-hidden="true" />}
            {subiendo ? "Subiendo…" : camara ? "Subir archivo o tomar foto" : "Subir archivo"}
            <input ref={entrada} type="file" className="sr-only" accept={aceptar}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); }} aria-label="Subir archivo" />
          </label>
          <Select aria-label="Clasificación" value={clase} onChange={(e) => setClase(e.target.value)} options={CLASIFICACIONES.map(([value, label]) => ({ value, label }))} />
          {(permitidos?.length || maxMb) && <p className="text-[12px] text-muted sm:col-span-2">{permitidos?.join(", ")}{maxMb ? ` · hasta ${maxMb} MB` : ""}</p>}
        </div>
      )}
      {descarga.modal}
    </div>
  );
}
