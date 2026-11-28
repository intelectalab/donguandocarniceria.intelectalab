"use client";
import { useRef, useState } from "react";

type Props = {
  plantilla: string;   // URL to download the template
  archivo: string;     // URL to upload the file
  nombre: string;      // template filename
  onTexto: (texto: string) => void; // callback with parsed text
};

export function ArchivoImportar({ plantilla, archivo, nombre, onTexto }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [cargando, setCargando] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCargando(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(archivo, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const texto = await res.text();
      onTexto(texto);
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <a
        href={plantilla}
        download={nombre}
        className="text-xs text-primary underline underline-offset-2"
      >
        Descargar plantilla
      </a>
      <span className="text-muted-foreground">·</span>
      <button
        type="button"
        disabled={cargando}
        onClick={() => ref.current?.click()}
        className="text-xs text-primary underline underline-offset-2 disabled:opacity-50"
      >
        {cargando ? "Subiendo…" : "Subir archivo"}
      </button>
      <input ref={ref} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleFile} />
    </div>
  );
}
