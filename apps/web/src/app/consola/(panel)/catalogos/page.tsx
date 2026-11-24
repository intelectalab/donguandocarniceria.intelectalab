"use client";

import { useState, type FormEvent } from "react";
import { FileSearch, Upload } from "lucide-react";
import { Alert, Badge, Button, Field, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { ApiError, mensajeDe } from "@/lib/api";
import { getTokenConsola } from "@/lib/consola";

type Ejemplo = { tipo: "nueva" | "cambia"; clave: string; despues?: Record<string, unknown>; campos?: { campo: string; antes: unknown; despues: unknown }[] };
type Revision = {
  tabla: string; tabla_nombre: string; validas: number; total_errores: number; errores: { linea: number; mensaje: string }[];
  previa: { nuevas: number; cambian: number; iguales: number; ejemplos: Ejemplo[] };
};

const FORMATOS: Record<string, string> = {
  sunat: "catálogo;código;descripción;vigente desde (AAAA-MM-DD);vigente hasta (vacío = sin fin)",
  ubigeo: "ubigeo de 6 dígitos;departamento;provincia;distrito",
  entidades: "código;nombre;tipo (BANK, WALLET, ACQUIRER, GATEWAY, CAJA);RUC;código CCI",
};

/** Sube el archivo con FormData (apiConsola envía JSON). */
async function subir<T>(ruta: string, datos: FormData): Promise<T> {
  const token = getTokenConsola();
  const res = await fetch(`/api/v1/consola${ruta}`, { method: "POST", body: datos, headers: { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message ?? "No se pudo completar la operación.", res.status, data.code, data.errors);
  return data as T;
}

/**
 * Catálogos globales (RN-MAE-11): SUNAT, ubigeo y entidades financieras son de toda la plataforma y las empresas solo
 * los consultan. Aquí Intelectalab los actualiza: primero revisa el archivo (nuevas, cambios y errores por línea) y
 * recién entonces importa. Hace lo mismo que el comando mae:importar-global.
 */
export default function CatalogosGlobales() {
  const yo = useUsuarioConsola();
  const [tabla, setTabla] = useState("ubigeo");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState("");
  const [revision, setRevision] = useState<Revision | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState<"" | "revisar" | "importar">("");

  const datos = (conMotivo = false) => {
    const fd = new FormData();
    fd.append("tabla", tabla);
    if (archivo) fd.append("archivo", archivo);
    if (conMotivo) fd.append("reason", motivo);
    return fd;
  };

  async function revisar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setRevision(null);
    setCargando("revisar");
    try {
      setRevision(await subir<Revision>("/catalogos/revisar", datos()));
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  async function importar() {
    setError("");
    setCargando("importar");
    try {
      const r = await subir<Revision>("/catalogos/importar", datos(true));
      toast.ok(`${r.tabla_nombre}: ${r.previa.nuevas} nuevas y ${r.previa.cambian} actualizadas`);
      setRevision(null);
      setArchivo(null);
      setMotivo("");
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setCargando("");
    }
  }

  if (!yo.puede["catalogs.import"]) {
    return <div className="grid gap-4"><h1 className="font-display text-[22px] font-bold text-ink">Catálogos globales</h1><Alert tone="warn">Solo un administrador de plataforma importa catálogos globales.</Alert></div>;
  }

  return (
    <div className="grid gap-5">
      <PageHeader description="Los catálogos de SUNAT, el ubigeo y las entidades financieras son de toda la plataforma: las empresas solo los consultan en Maestros. Sube el archivo, revisa qué cambia y recién entonces impórtalo." />

      <form onSubmit={revisar} className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card sm:grid-cols-2">
        <Field label="Catálogo" required>
          <Select value={tabla} onChange={(e) => { setTabla(e.target.value); setRevision(null); }}
            options={[{ value: "sunat", label: "Catálogos SUNAT" }, { value: "ubigeo", label: "Ubigeo" }, { value: "entidades", label: "Entidades financieras" }]} />
        </Field>
        <Field label="Archivo (.txt o .csv, hasta 5 MB)" required hint={`Una fila por línea, separada por punto y coma: ${FORMATOS[tabla]}. Las líneas que empiezan con # se saltan.`}>
          <input type="file" accept=".txt,.csv,text/plain,text/csv" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setRevision(null); }}
            className="block w-full text-[13px] text-ink file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" icon={FileSearch} loading={cargando === "revisar"} disabled={!archivo}>Revisar sin grabar</Button>
        </div>
      </form>

      {error && <Alert tone="bad">{error}</Alert>}

      {revision && (
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="font-display text-[15px] font-bold text-ink">Revisión de {revision.tabla_nombre}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">{revision.validas} filas válidas</Badge>
            <Badge tone="ok">{revision.previa.nuevas} nuevas</Badge>
            <Badge tone="warn">{revision.previa.cambian} cambian</Badge>
            <Badge>{revision.previa.iguales} quedan igual</Badge>
            {revision.total_errores > 0 && <Badge tone="bad">{revision.total_errores} con error</Badge>}
          </div>
          {revision.total_errores > 0 && (
            <Alert tone="bad" title="Corrige estas líneas y vuelve a subir el archivo: con errores no se importa nada">
              <ul className="mt-1 grid gap-0.5">
                {revision.errores.map((e) => <li key={e.linea}>Línea {e.linea}: {e.mensaje}</li>)}
              </ul>
            </Alert>
          )}
          {revision.previa.ejemplos.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-[12.5px] text-muted">Algunos ejemplos de lo que cambia:</p>
              <ul className="grid gap-1 text-[13px]">
                {revision.previa.ejemplos.map((x, i) => (
                  <li key={i} className="rounded-lg bg-surface-2 px-3 py-1.5">
                    <b className="font-mono">{x.clave}</b> · {x.tipo === "nueva" ? "nueva" : x.campos?.map((c) => `${c.campo}: «${String(c.antes ?? "")}» → «${String(c.despues ?? "")}»`).join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {revision.total_errores === 0 && revision.previa.nuevas + revision.previa.cambian > 0 && (
            <div className="grid gap-3">
              <Field label="Motivo" required hint="Por ejemplo «Actualización del catálogo 03 de SUNAT de noviembre». Queda en la bitácora con la huella del archivo.">
                <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
              </Field>
              <div><Button variant="primary" icon={Upload} loading={cargando === "importar"} disabled={motivo.trim().length < 5} onClick={importar}>Importar {revision.previa.nuevas + revision.previa.cambian} filas</Button></div>
            </div>
          )}
          {revision.total_errores === 0 && revision.previa.nuevas + revision.previa.cambian === 0 && <p className="text-[13.5px] text-muted">El archivo no trae nada nuevo: no hace falta importarlo.</p>}
        </section>
      )}
    </div>
  );
}
