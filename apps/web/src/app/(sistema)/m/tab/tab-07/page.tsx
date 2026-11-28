"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Pencil } from "lucide-react";
import { Badge, Button, Checkbox, Cifra, DataTable, Field, FiltroSelect, Input, Modal, PageHeader, Select, Switch, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { ErrorCarga, rutaDetalle, useDatos, valorDe, hoyLima, type Indicador } from "@/modulos/tab/comunes";

type Fila = Omit<Indicador, "value" | "numerator" | "denominator" | "source" | "run_no" | "nocalc" | "error" | "anterior" | "tolerancia" | "meta_id" | "semaforo"> & {
  dimensions: string[] | null; fuente: string | null; phase: number; calculator: string | null; requires_module: string; con_meta: boolean;
};
type Datos = {
  filas: Fila[]; cifras: { registrados: number; activos: number; con_calculo: number; con_meta: number; apagados: number }; modulos: string[];
  unidades: Record<string, string>; sentidos: Record<string, string>; frecuencias: Record<string, string>; roles: { code: string; name: string }[];
};

/** TAB-07 Catálogo de indicadores: fórmula, unidad, sentido, frecuencia, módulo, fuente y detalle de cada uno; activar, roles que lo ven (RN-TAB-06 y 08). */
export default function Catalogo() {
  const { can } = useSesion();
  const editar = can("tab.kpi.manage");
  const { datos, error, cargando, recargar } = useDatos<Datos>("/v1/tab/indicadores");
  const [modulo, setModulo] = useState("");
  const [estado, setEstado] = useState("");
  const [buscar, setBuscar] = useState("");
  const [abierto, setAbierto] = useState<Fila | null>(null);
  const [bajando, setBajando] = useState(false);
  if (error) return <ErrorCarga error={error} que="" />;
  const mes = hoyLima().slice(0, 7);
  const t = buscar.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filas = (datos?.filas ?? []).filter((x) => (!modulo || x.module_code === modulo)
    && (!estado || (estado === "ACTIVE" ? x.status === "ACTIVE" : estado === "INACTIVE" ? x.status !== "ACTIVE" : estado === "OFF" ? !x.modulo_encendido : estado === "CALC" ? x.con_calculo : !x.con_calculo))
    && (!t || `${x.code} ${x.name} ${x.formula}`.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().includes(t)));

  async function exportar() {
    setBajando(true);
    try {
      await apiDescargar("/v1/tab/indicadores/exportar", "catalogo-indicadores.xlsx");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setBajando(false);
    }
  }
  async function activar(x: Fila, v: boolean) {
    try {
      await api(`/v1/tab/indicadores/${x.code}`, { method: "PUT", body: { status: v ? "ACTIVE" : "INACTIVE" } });
      toast.ok(`${x.code} ${v ? "activado" : "desactivado"}`);
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const c = datos?.cifras;
  const columnas: Column<Fila>[] = [
    { key: "name", header: "Indicador", cardTitle: true, render: (x) => (
      <span className="flex flex-col">
        <Link href={rutaDetalle(x.code, mes)} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{x.name}</Link>
        <span className="text-[12px] text-muted">{x.code} · {x.module_code}</span>
      </span>) },
    { key: "formula", header: "Cómo se calcula", hideOnMobile: true, render: (x) => <span className="line-clamp-2 max-w-[28rem] text-[12.5px] text-muted" title={x.formula}>{x.formula}</span> },
    { key: "unit", header: "Unidad", render: (x) => x.unidad },
    { key: "direction", header: "Mejor si", hideOnMobile: true, render: (x) => x.sentido },
    { key: "meta", header: "Meta hoy", align: "right", render: (x) => valorDe(x.meta, x.unit, x.decimals) },
    { key: "estado", header: "Estado", render: (x) => (
      <span className="flex flex-wrap gap-1">
        {x.status === "ACTIVE" ? <Badge tone="ok">Activo</Badge> : <Badge>Inactivo</Badge>}
        {!x.modulo_encendido && <Badge tone="warn">Módulo apagado</Badge>}
        {!x.con_calculo && <Badge>Sin cálculo</Badge>}
        {x.visible_roles.length > 0 && <Badge tone="info">Solo {x.visible_roles.length} roles</Badge>}
      </span>) },
    ...(editar ? [{ key: "acciones", header: "", render: (x: Fila) => (
      <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Switch checked={x.status === "ACTIVE"} onChange={(v) => activar(x, v)} label={x.status === "ACTIVE" ? "Desactivar" : "Activar"} />
        <Button size="sm" icon={Pencil} onClick={() => setAbierto(x)}>Editar</Button>
      </span>) } as Column<Fila>] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader description="Todos los indicadores que registran los módulos, con su fórmula, unidad, sentido, frecuencia y pantalla de detalle. Un indicador inactivo o de un módulo apagado no se calcula, no se congela ni se muestra."
        actions={can("tab.export.run") ? <Button icon={Download} loading={bajando} onClick={exportar}>Excel</Button> : undefined} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Registrados" valor={c ? String(c.registrados) : undefined} detalle={c ? `${c.activos} activos` : ""} destacada />
        <Cifra titulo="Se calculan" valor={c ? String(c.con_calculo) : undefined} detalle="los demás muestran sus meses congelados" />
        <Cifra titulo="Con meta vigente" valor={c ? String(c.con_meta) : undefined} detalle="KPI-TAB-01" />
        <Cifra titulo="De módulos apagados" valor={c ? String(c.apagados) : undefined} detalle="no se muestran (RN-TAB-07)" tono={c?.apagados ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap gap-2">
        <FiltroSelect etiqueta="Módulo" value={modulo} onChange={setModulo} options={(datos?.modulos ?? []).map((m) => ({ value: m, label: m }))} ancho={130} />
        <FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} ancho={190} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" },
          { value: "CALC", label: "Se calculan" }, { value: "NOCALC", label: "Sin cálculo" }, { value: "OFF", label: "Módulo apagado" }]} />
      </div>
      <DataTable rows={filas} columns={columnas} rowKey={(x) => x.code} loading={cargando} search={{ value: buscar, onChange: setBuscar, placeholder: "Código, nombre o fórmula" }}
        onRowClick={editar ? (x) => setAbierto(x) : undefined} empty="No hay indicadores con esos filtros." />
      {abierto && datos && <Editar x={abierto} datos={datos} onClose={() => setAbierto(null)} onSaved={() => { setAbierto(null); recargar(); }} />}
    </div>
  );
}

function Editar({ x, datos, onClose, onSaved }: { x: Fila; datos: Datos; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ status: x.status, visible_roles: x.visible_roles, drilldown: x.drilldown ?? "", decimals: String(x.decimals), frequency: x.frequency });
  const [guardando, setGuardando] = useState(false);
  async function guardar() {
    setGuardando(true);
    try {
      await api(`/v1/tab/indicadores/${x.code}`, { method: "PUT", body: { ...f, decimals: Number(f.decimals) } });
      toast.ok(`${x.code} guardado`);
      onSaved();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }
  const alterna = (r: string, v: boolean) => setF((s) => ({ ...s, visible_roles: v ? [...s.visible_roles, r] : s.visible_roles.filter((y) => y !== r) }));
  return (
    <Modal open onClose={onClose} title={`${x.code} · ${x.name}`} description={x.formula} size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Switch checked={f.status === "ACTIVE"} onChange={(v) => setF({ ...f, status: v ? "ACTIVE" : "INACTIVE" })} label="Activo" />
          <span className="text-[13.5px]">{f.status === "ACTIVE" ? "Activo: se calcula y se muestra" : "Inactivo: no se calcula ni se muestra"}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Pantalla de detalle" hint="TAB-10 o la pantalla del módulo"><Input value={f.drilldown} maxLength={40} onChange={(e) => setF({ ...f, drilldown: e.target.value })} /></Field>
          <Field label="Decimales"><Input type="number" min={0} max={6} value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })} /></Field>
          <Field label="Frecuencia"><Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}
            options={Object.entries(datos.frecuencias).map(([value, label]) => ({ value, label }))} /></Field>
        </div>
        <Field label="Roles que lo ven" hint="Sin ninguno marcado lo ven todos los roles del tablero. Gerencia y Auditoría ven todo.">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {datos.roles.map((r) => <Checkbox key={r.code} checked={f.visible_roles.includes(r.code)} onChange={(v) => alterna(r.code, v)} label={r.name} />)}
          </div>
        </Field>
        <p className="text-[12.5px] text-muted">Unidad: {x.unidad} · {x.sentido} · módulo {x.module_code}{x.fuente ? ` · fuente: ${x.fuente}` : ""}</p>
      </div>
    </Modal>
  );
}
