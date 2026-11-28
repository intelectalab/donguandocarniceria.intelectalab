"use client";

import { useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, DataTable, Field, Modal, PageHeader, Select, Tabs, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fechaHora, numero, soles } from "@/lib/formato";
import { ErrorCarga, Estado, FiltroMes, Seccion, Vacio, useDatos } from "@/modulos/per/comunes";
import { hoyLima, inicioMes, sumarMeses } from "@/modulos/per/tipos";

type Intercambio = {
  id: string; period: string; nombre: string; direction: string; direccion: string; provider: string; proveedor: string; file_name: string | null; status: string;
  total_amount: number | null; row_count: number | null; error_message: string | null; processed_at: string | null; quien: string | null;
};
type Variable = { employee_id: string; dni: string | null; codigo: string | null; nombre: string; trabajados: number; faltas: number; permisos: number; tardanzas: number; min_tardanza: number; horas_extra: number; comisiones: number; bonos: number; descuentos: number };
type Datos = { data: Intercambio[]; mes: string; nombre: string; fuente: string; conector_ayni: boolean; variables: Variable[] };

const ESTADOS: Record<string, [string, "ok" | "warn" | "bad" | "neutral"]> = { DONE: ["Listo", "ok"], PENDING: ["En proceso", "warn"], FAILED: ["Con error", "bad"], SUPERSEDED: ["Reemplazado", "neutral"] };

/** PER-15 Intercambio con Ayni HR: importa el costo de planilla del mes y exporta asistencia y conceptos variables; o el archivo para el contador. */
export default function IntercambioPlanilla() {
  const [mes, setMes] = useState(sumarMeses(inicioMes(hoyLima()), -1));
  const [vista, setVista] = useState<"variables" | "historial">("variables");
  const [importar, setImportar] = useState(false);
  const [bajando, setBajando] = useState("");
  const { datos, error, cargando, recargar } = useDatos<Datos>(`/v1/per/intercambio?mes=${mes}`);
  if (error) return <ErrorCarga error={error} que="El intercambio de planilla lo hacen RR. HH. y Contabilidad." />;
  async function exportar(provider: string) {
    setBajando(provider);
    try {
      await apiDescargar(`/v1/per/intercambio/exportar?mes=${mes}&provider=${provider}`, `variables-planilla-${mes.slice(0, 7)}.xlsx`);
      toast.ok("Archivo generado; queda en el historial.");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando("");
    }
  }
  const colsV: Column<Variable>[] = [
    { key: "nombre", header: "Trabajador", cardTitle: true, render: (v) => <span className="flex flex-col"><span className="font-medium">{v.nombre}</span><span className="text-[12px] text-muted">{v.dni ?? "•••"}{v.codigo ? ` · ${v.codigo}` : ""}</span></span> },
    { key: "trabajados", header: "Días", align: "right", render: (v) => v.trabajados },
    { key: "faltas", header: "Faltas", align: "right", render: (v) => v.faltas || "—" },
    { key: "tardanzas", header: "Tardanzas", align: "right", hideOnMobile: true, render: (v) => v.tardanzas ? `${v.tardanzas} (${v.min_tardanza} min)` : "—" },
    { key: "horas_extra", header: "H. extra", align: "right", hideOnMobile: true, render: (v) => v.horas_extra ? numero(v.horas_extra, 1) : "—" },
    { key: "comisiones", header: "Comisiones", align: "right", render: (v) => v.comisiones ? soles(v.comisiones) : "—" },
    { key: "bonos", header: "Bonos", align: "right", render: (v) => v.bonos ? soles(v.bonos) : "—" },
    { key: "descuentos", header: "Descuentos", align: "right", hideOnMobile: true, render: (v) => v.descuentos ? soles(v.descuentos) : "—" },
  ];
  const colsH: Column<Intercambio>[] = [
    { key: "nombre", header: "Período", cardTitle: true, render: (i) => <span className="flex flex-col"><span className="font-medium">{i.nombre}</span><span className="text-[12px] text-muted">{i.direccion}</span></span> },
    { key: "proveedor", header: "Con", render: (i) => <span className="flex flex-col"><span>{i.proveedor}</span>{i.file_name && <span className="text-[12px] text-muted">{i.file_name}</span>}</span> },
    { key: "total_amount", header: "Total", align: "right", render: (i) => i.total_amount === null ? "—" : <span className="flex flex-col items-end"><span>{soles(i.total_amount)}</span><span className="text-[12px] text-muted">{i.row_count} filas</span></span> },
    { key: "processed_at", header: "Cuándo", hideOnMobile: true, render: (i) => <span className="flex flex-col text-[12.5px]"><span>{fechaHora(i.processed_at)}</span><span className="text-muted">{i.quien}</span></span> },
    { key: "status", header: "Estado", render: (i) => <span className="flex flex-col items-end gap-0.5"><Estado s={i.status} labels={ESTADOS} />{i.error_message && <span className="max-w-[260px] text-right text-[11.5px] text-muted">{i.error_message}</span>}</span> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader description="Cada mes se importa el costo real de planilla (sueldo, aportes y provisiones) para el costo de personal, y se envían la asistencia, comisiones, bonos y descuentos para que Ayni HR o el contador calculen la planilla. Volver a importar un mes reemplaza el anterior." />
      <div className="flex flex-wrap items-center gap-2">
        <FiltroMes value={mes} onChange={setMes} />
      </div>
      {datos && !datos.conector_ayni && (
        <Alert tone="warn" title="Conector de Ayni HR aún no activo">La importación desde Ayni HR se simula con las condiciones de pago y queda marcada como simulada. Para el costo real, usa el archivo del contador o activa el conector en Integraciones.</Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Seccion titulo="Importar costo de planilla">
          <p className="mb-3 text-[13px] text-muted">De {datos?.nombre ?? "este mes"}: por DNI, sueldo, aportes del empleador y provisiones.</p>
          <Button variant="primary" icon={Upload} onClick={() => setImportar(true)}>Importar</Button>
        </Seccion>
        <Seccion titulo="Exportar variables del mes">
          <p className="mb-3 text-[13px] text-muted">Días, faltas, tardanzas, horas extra, comisiones, bonos y descuentos de cada persona.</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={Download} loading={bajando === "AYNI_HR"} onClick={() => exportar("AYNI_HR")}>Para Ayni HR</Button>
            <Button icon={FileSpreadsheet} loading={bajando === "ACCOUNTANT_FILE"} onClick={() => exportar("ACCOUNTANT_FILE")}>Para el contador</Button>
          </div>
        </Seccion>
      </div>
      <Tabs tabs={[{ key: "variables", label: "Variables del mes", count: datos?.variables.length }, { key: "historial", label: "Historial", count: datos?.data.length }]} value={vista} onChange={setVista} />
      {vista === "variables"
        ? <DataTable rows={datos?.variables ?? []} rowKey={(v) => v.employee_id} columns={colsV} loading={cargando} empty={<Vacio>Sin variables en el mes.</Vacio>} />
        : <DataTable rows={datos?.data ?? []} columns={colsH} loading={cargando} empty={<Vacio>Sin intercambios.</Vacio>} />}
      {importar && datos && <Importar mes={mes} nombre={datos.nombre} fuente={datos.fuente} onClose={() => setImportar(false)} onListo={() => { setImportar(false); recargar(); }} />}
    </div>
  );
}

function Importar({ mes, nombre, fuente, onClose, onListo }: { mes: string; nombre: string; fuente: string; onClose: () => void; onListo: () => void }) {
  const [provider, setProvider] = useState(fuente === "ACCOUNTANT_FILE" ? "ACCOUNTANT_FILE" : "AYNI_HR");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("mes", mes);
      fd.append("provider", provider);
      if (archivo) fd.append("archivo", archivo);
      const r = await api<{ total: number; filas: number; avisos: string[] }>("/v1/per/intercambio/importar", { method: "POST", body: fd });
      toast.ok(`Importado: ${r.filas} filas por ${soles(r.total)}.${r.avisos.length ? ` ${r.avisos.length} aviso(s).` : ""}`);
      if (r.avisos.length) toast.info(r.avisos.slice(0, 3).join(" "));
      onListo();
    } catch (x) {
      setError(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  async function plantilla() {
    try {
      await apiDescargar("/v1/per/intercambio/plantilla", "plantilla-planilla-contador.xlsx");
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }
  return (
    <Modal open onClose={onClose} title={`Importar planilla de ${nombre}`} dismissable={!guardando}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" type="submit" form="f-imp" loading={guardando} disabled={provider === "ACCOUNTANT_FILE" && !archivo}>Importar</Button></>}>
      <form id="f-imp" className="space-y-3" onSubmit={guardar}>
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Desde"><Select value={provider} onChange={(e) => setProvider(e.target.value)} options={[{ value: "AYNI_HR", label: "Ayni HR (API)" }, { value: "ACCOUNTANT_FILE", label: "Archivo del contador" }]} /></Field>
        {provider === "ACCOUNTANT_FILE" && (
          <>
            <Button size="sm" variant="ghost" icon={FileSpreadsheet} onClick={plantilla}>Descargar modelo en Excel</Button>
            <Field label="Archivo Excel o CSV" required hint="Columnas: dni, sueldo, aportes, provisiones. Máximo 2 MB.">
              <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-[9px] file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}
