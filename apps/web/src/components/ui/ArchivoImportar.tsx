"use client";

import { useState, type ChangeEvent } from "react";
import { FileSpreadsheet, FileUp, Loader2 } from "lucide-react";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { toast } from "./feedback";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Botones de los importadores, como en erp-saas: «Descargar modelo en Excel» (plantilla con instrucciones,
 * ejemplos y listas) y «Subir Excel o CSV». La API lee el archivo (con las columnas en cualquier orden) y
 * devuelve el texto «;» que después se revisa; ese texto llega en onTexto.
 *   <ArchivoImportar plantilla="/v1/mae/trabajadores/importar/plantilla" archivo="/v1/mae/trabajadores/importar/archivo"
 *     nombre="plantilla-trabajadores.xlsx" onTexto={setTexto} />
 */
export function ArchivoImportar({ plantilla, archivo, nombre, onTexto, disabled }: {
  plantilla: string; archivo: string; nombre: string; onTexto: (texto: string) => void; disabled?: boolean;
}) {
  const [ocupado, setOcupado] = useState<"" | "modelo" | "archivo">("");
  const boton = "inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-line bg-surface px-3.5 text-[13.5px] font-semibold hover:bg-surface-2";

  async function modelo() {
    setOcupado("modelo");
    try {
      await apiDescargar(plantilla, nombre);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  async function subir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/\.(xlsx|xls|csv|txt)$/i.test(f.name)) { toast.error("Sube un Excel (.xlsx o .xls) o un CSV."); return; }
    if (f.size > MAX_BYTES) { toast.error("El archivo pasa de 2 MB: divídelo en partes."); return; }
    setOcupado("archivo");
    try {
      const datos = new FormData();
      datos.append("archivo", f);
      const r = await api<{ texto: string }>(archivo, { method: "POST", body: datos });
      onTexto(r.texto);
      toast.ok(`Archivo «${f.name}» leído: revísalo antes de grabar.`);
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`${boton} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`} onClick={modelo} disabled={disabled || ocupado !== ""}>
        {ocupado === "modelo" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileSpreadsheet size={16} aria-hidden="true" />}
        Descargar modelo en Excel
      </button>
      <label className={`${boton} ${disabled || ocupado ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        {ocupado === "archivo" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
        Subir Excel o CSV
        <input type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" onChange={subir} disabled={disabled || ocupado !== ""} />
      </label>
    </div>
  );
}
