"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, FileCheck2, Plus, Wallet } from "lucide-react";
import { Alert, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, buttonClass, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { ErrorCarga, EstadoVersion, Seccion, Vacio, s0, useDatos, useOpciones, type Totales, type Version } from "@/modulos/prs/comunes";

type V = Version & { totales: Totales; lineas: number };
type Presupuesto = { id: string; year: number; name: string; vigente: V | null; versiones: V[]; por_aprobar: number };
type Datos = { presupuestos: Presupuesto[]; por_aprobar: number; alertas: number };

/** PRS-01 Presupuestos: lista por año con la versión vigente, las versiones en trámite y sus totales de ingreso, costo y gasto. */
export default function Presupuestos() {
  const router = useRouter();
  const { datos: op } = useOpciones();
  const { datos, error, cargando, recargar } = useDatos<Datos>("/v1/prs/presupuestos");
  const [nuevo, setNuevo] = useState(false);
  const [creando, setCreando] = useState<string | null>(null);
  if (error) return <ErrorCarga error={error} que="Los presupuestos los ven Gerencia, Administración, la Contadora y Auditoría." />;
  const puede = op?.puede;
  const anioActual = Number((op?.hoy ?? "2026").slice(0, 4));
  const vigente = datos?.presupuestos.find((p) => p.year === anioActual)?.vigente ?? datos?.presupuestos.find((p) => p.vigente)?.vigente ?? null;

  async function revision(b: Presupuesto, desde?: string) {
    setCreando(b.id);
    try {
      const v = await api<Version>(`/v1/prs/presupuestos/${b.id}/versiones`, { method: "POST", body: desde ? { desde } : {} });
      toast.ok(`Versión ${v.etiqueta} creada en borrador`);
      router.push(desde ? `/m/prs/prs-03?id=${v.id}` : `/m/prs/prs-04?id=${v.id}`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setCreando(null);
    }
  }

  const columnas = (b: Presupuesto): Column<V>[] => [
    { key: "etiqueta", header: "Versión", cardTitle: true, render: (v) => (
      <span className="flex flex-col"><Link href={`/m/prs/prs-03?id=${v.id}`} className="font-medium text-primary hover:underline">v{v.version_no} · {v.name}</Link>
        <span className="text-[12px] text-muted">{v.creada_por} · {fecha(v.created_at)}</span></span>) },
    { key: "status", header: "Estado", render: (v) => <EstadoVersion s={v.status} /> },
    { key: "ingreso", header: "Ingresos", align: "right", render: (v) => s0(v.totales.ingreso) },
    { key: "costo", header: "Costo de ventas", align: "right", hideOnMobile: true, render: (v) => s0(v.totales.costo) },
    { key: "gasto", header: "Gastos", align: "right", render: (v) => s0(v.totales.gasto) },
    { key: "resultado", header: "Resultado", align: "right", render: (v) => <span className={v.totales.resultado < 0 ? "text-bad" : "text-ok"}>{s0(v.totales.resultado)}</span> },
    { key: "acciones", header: "", hideInCard: false, render: (v) => (
      <span className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Link className={buttonClass("ghost", "sm")} href={`/m/prs/prs-09?a=${b.vigente && b.vigente.id !== v.id ? b.vigente.id : ""}&b=${v.id}`}>Comparar</Link>
        {["DRAFT", "REJECTED", "SUBMITTED"].includes(v.status) && <Link className={buttonClass("secondary", "sm")} href={`/m/prs/prs-05?id=${v.id}`}>Envío y aprobación</Link>}
        {puede?.editar && ["APPROVED", "SUPERSEDED", "SUBMITTED"].includes(v.status) && (
          <Button size="sm" variant="ghost" loading={creando === b.id} onClick={() => revision(b, v.id)}>Crear revisión</Button>)}
      </span>) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader description="Presupuesto anual de la empresa: versión vigente, versiones en trámite y totales de ingreso, costo y gasto, en soles sin IGV."
        actions={<>
          <Link className={buttonClass("secondary")} href="/m/prs/prs-06">Real frente a presupuesto</Link>
          {puede?.editar && <Button variant="primary" icon={Plus} onClick={() => setNuevo(true)}>Nuevo presupuesto</Button>}
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo={vigente ? `Ingresos ${vigente.year} (vigente)` : "Ingresos (vigente)"} valor={vigente ? s0(vigente.totales.ingreso) : cargando ? undefined : "—"}
          detalle={vigente ? `${vigente.etiqueta} · ${vigente.name}` : "Sin versión aprobada"} icono={Wallet} destacada />
        <Cifra titulo="Costo y gasto (vigente)" valor={vigente ? s0(vigente.totales.costo + vigente.totales.gasto) : cargando ? undefined : "—"}
          detalle={vigente ? `Resultado ${s0(vigente.totales.resultado)}` : ""} tono={vigente && vigente.totales.resultado < 0 ? "warn" : undefined} />
        <Link href="/m/prs/prs-05" className="block"><Cifra titulo="Versiones por aprobar" valor={datos ? String(datos.por_aprobar) : undefined} detalle="Las aprueba Gerencia" icono={FileCheck2}
          tono={datos?.por_aprobar ? "warn" : undefined} /></Link>
        <Link href="/m/prs/prs-10" className="block"><Cifra titulo="Alertas de desviación" valor={datos ? String(datos.alertas) : undefined} detalle="Abiertas o en seguimiento" icono={Bell}
          tono={datos?.alertas ? "bad" : undefined} /></Link>
      </div>
      {vigente && vigente.totales.resultado < 0 && (
        <Alert tone="warn" title="El resultado presupuestado es negativo">Con los datos de ejemplo, la planilla casi iguala a las ventas sin IGV. Revísalo con datos reales.</Alert>)}
      {datos && !datos.presupuestos.length && <Vacio>Aún no hay presupuestos. {puede?.editar ? "Crea el primero con «Nuevo presupuesto»." : ""}</Vacio>}
      {(datos?.presupuestos ?? []).map((b) => (
        <Seccion key={b.id} titulo={`${b.name}${b.vigente ? ` · vigente v${b.vigente.version_no}` : " · sin versión aprobada"}`}
          acciones={puede?.editar ? <>
            {b.vigente && <Button size="sm" variant="primary" loading={creando === b.id} onClick={() => revision(b, b.vigente!.id)}>Nueva revisión de la vigente</Button>}
            <Button size="sm" loading={creando === b.id} onClick={() => revision(b)}>Versión vacía</Button>
          </> : undefined}>
          <DataTable rows={b.versiones} columns={columnas(b)} rowKey={(v) => v.id} onRowClick={(v) => router.push(`/m/prs/prs-03?id=${v.id}`)} empty="Sin versiones." />
        </Seccion>
      ))}
      {nuevo && <NuevoPresupuesto anio={anioActual + 1} onClose={() => setNuevo(false)} onListo={(id) => { recargar(); router.push(`/m/prs/prs-03?id=${id}`); }} />}
    </div>
  );
}

function NuevoPresupuesto({ anio, onClose, onListo }: { anio: number; onClose: () => void; onListo: (versionId: string) => void }) {
  const [v, setV] = useState({ anio: String(anio), nombre: `Presupuesto ${anio}`, inicio: "REAL", pct: "0" });
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await api<{ version_id: string; copia: { lineas: number } | null }>("/v1/prs/presupuestos", { method: "POST",
        body: { anio: Number(v.anio), nombre: v.nombre, inicio: v.inicio, pct: Number(v.pct || 0) } });
      toast.ok(`Presupuesto ${v.anio} creado en borrador${r.copia ? ` con ${r.copia.lineas} líneas` : ""}`);
      onListo(r.version_id);
    } catch (x) {
      toast.error(mensajeDe(x));
    } finally {
      setGuardando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Nuevo presupuesto" dismissable={!guardando} description="Un presupuesto por empresa y año (RN-PRS-01). Nace con su versión 1 en borrador."
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-prs-nuevo" loading={guardando}>Crear</Button></>}>
      <form id="f-prs-nuevo" onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Año" required><Input type="number" min={2020} max={2100} value={v.anio} onChange={(e) => setV({ ...v, anio: e.target.value, nombre: `Presupuesto ${e.target.value}` })} /></Field>
          <Field label="Ajuste %"><Input type="number" step="0.1" value={v.pct} onChange={(e) => setV({ ...v, pct: e.target.value })} disabled={v.inicio === "VACIO"} /></Field>
        </div>
        <Field label="Nombre" required><Input value={v.nombre} maxLength={120} onChange={(e) => setV({ ...v, nombre: e.target.value })} /></Field>
        <Field label="Empezar desde" hint="El real del año anterior usa lo congelado de los meses cerrados, el real de los vencidos, la proyección del mes en curso y el presupuesto de los que faltan.">
          <Select value={v.inicio} onChange={(e) => setV({ ...v, inicio: e.target.value })} options={[
            { value: "REAL", label: "El real del año anterior" }, { value: "VERSION", label: "La versión aprobada del año anterior" }, { value: "VACIO", label: "Vacío" }]} />
        </Field>
      </form>
    </Modal>
  );
}
