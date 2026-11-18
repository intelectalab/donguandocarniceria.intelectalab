"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileText, XCircle } from "lucide-react";
import { Alert, ArchivoImportar, Badge, Button, Cifra, DataTable, PageHeader, Textarea, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { NOMBRE_DOC } from "@/modulos/mae/tipos";

type Fila = {
  n: number; errores: string[];
  datos: { doc_type: string; doc_number: string; full_name: string; position: string; local: string; centro_costo: string; hire_date: string };
};

const EJEMPLO = [
  "tipo_doc;numero;nombre;cargo;local;centro_costo;ingreso;celular;correo",
  "DNI;72651034;Jhon Huamaní Tito;Preparador;L1;ALM-L1;2026-10-12;+51984551230;",
  "DNI;7265103;Lucero Rojas Paz;Vendedora;L1;VEN-MOS;2026-10-12;+51984551231;lrojas@donguando.pe",
  "CE;002315478;Andreína Pérez Gil;Operaria de empaque;L2;PROD-L2;2026-10-12;+51984551232;",
  "DNI;73110299;Nataly Inga Ramos;Operaria de caldos;L2;PROD-L2;12/10/2026;984551235;",
].join("\n");

/** MAE-10 Importar trabajadores: CSV con validación fila por fila, vista previa y reporte de errores antes de grabar. */
export default function ImportarTrabajadores() {
  const router = useRouter();
  const { puede, can } = useSesion();
  const [texto, setTexto] = useState(EJEMPLO);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const gestiona = can("mae.employee.manage") && puede("MAE", "C");
  const validas = filas?.filter((f) => !f.errores.length) ?? [];

  async function validar() {
    setOcupado(true);
    try {
      setFilas((await api<{ filas: Fila[] }>("/v1/mae/trabajadores/importar/revisar", { method: "POST", body: { texto } })).filas);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  }

  async function grabar() {
    setOcupado(true);
    try {
      const r = await api<{ grabados: number; omitidos: number }>("/v1/mae/trabajadores/importar", { method: "POST", body: { texto } });
      toast.ok(`${r.grabados} trabajador(es) registrados.${r.omitidos ? ` ${r.omitidos} fila(s) con error no se grabaron.` : ""}`);
      router.push("/m/mae/mae-01");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado(false);
    }
  }

  const columnas: Column<Fila>[] = [
    { key: "n", header: "Fila", align: "right" },
    { key: "doc", header: "Documento", render: (f) => <span className="font-mono text-[12.5px]">{NOMBRE_DOC[f.datos.doc_type] ?? f.datos.doc_type} {f.datos.doc_number}</span> },
    { key: "full_name", header: "Nombre", cardTitle: true, render: (f) => f.datos.full_name || "—" },
    { key: "position", header: "Cargo", hideOnMobile: true, render: (f) => f.datos.position || "—" },
    { key: "local", header: "Local", hideOnMobile: true, render: (f) => f.datos.local || "—" },
    { key: "hire_date", header: "Ingreso", hideOnMobile: true, render: (f) => /^\d{4}-\d{2}-\d{2}$/.test(f.datos.hire_date) ? fecha(f.datos.hire_date) : f.datos.hire_date || "—" },
    { key: "resultado", header: "Resultado", render: (f) => f.errores.length
      ? <span className="text-[12.5px] text-bad">{f.errores.join(" ")}</span> : <Badge tone="ok">Lista para grabar</Badge> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Carga de un CSV con validación fila por fila, vista previa y reporte de errores antes de grabar."
        actions={<Button onClick={() => router.push("/m/mae/mae-01")}>Trabajadores</Button>} />

      {!gestiona && <Alert tone="warn">Importar trabajadores exige el permiso de gestionarlos.</Alert>}

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">1. Archivo</h2>
        <p className="text-[13px] text-muted">Descarga el modelo en Excel, llénalo y súbelo, o sube un CSV. También puedes pegar las filas aquí: tipo_doc; numero; nombre; cargo; local (L1, L2…); centro_costo; ingreso; celular; correo. El ejemplo trae un error a propósito.</p>
        <ArchivoImportar plantilla="/v1/mae/trabajadores/importar/plantilla" archivo="/v1/mae/trabajadores/importar/archivo"
          nombre="plantilla-trabajadores.xlsx" disabled={!gestiona} onTexto={(t) => { setTexto(t); setFilas(null); }} />
        <Textarea aria-label="Contenido CSV" value={texto} onChange={(e) => { setTexto(e.target.value); setFilas(null); }} className="min-h-[160px] font-mono text-[12.5px]" />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={ocupado && !filas} disabled={!texto.trim()} onClick={validar}>Validar</Button>
          <Button onClick={() => { setTexto(EJEMPLO); setFilas(null); }}>Restaurar ejemplo</Button>
        </div>
      </section>

      {filas && <>
        <div className="grid grid-cols-3 gap-3">
          <Cifra titulo="Filas leídas" valor={numero(filas.length)} icono={FileText} destacada />
          <Cifra titulo="Válidas" valor={numero(validas.length)} icono={CheckCircle2} tono="ok" />
          <Cifra titulo="Con errores" valor={numero(filas.length - validas.length)} icono={XCircle} tono={filas.length - validas.length ? "bad" : undefined} />
        </div>
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">2. Vista previa</h2>
            {gestiona && validas.length > 0 && <Button variant="primary" loading={ocupado} onClick={grabar}>Grabar {validas.length} fila(s) válidas</Button>}
          </div>
          <DataTable columns={columnas} rows={filas} rowKey={(f) => String(f.n)} empty="El archivo no tiene filas." />
        </section>
      </>}
    </div>
  );
}
