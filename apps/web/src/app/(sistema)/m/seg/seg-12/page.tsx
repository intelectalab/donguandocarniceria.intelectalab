"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, DataTable, PageHeader, Select, Tabs, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { usePorPagina } from "@/lib/useListado";
import { abreviar, enOrdenDelMenu, nombreModulo, type Matriz } from "@/modulos/seg/tipos";

type Vista = "permisos" | "accesos";
type FilaPermiso = Matriz["permissions"][number];
type FilaModulo = Matriz["modules"][number];

/** SEG-12 Matriz de roles y permisos: todos los roles contra todos los permisos, de solo lectura y exportable para la revisión de accesos. */
export default function MatrizRoles() {
  const [m, setM] = useState<Matriz | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>("permisos");
  const [busca, setBusca] = useState("");
  const [modulo, setModulo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = usePorPagina(vista, 25);

  useEffect(() => {
    let vigente = true;
    api<Matriz>("/v1/seg/matriz").then((x) => vigente && setM(x)).catch((e) => vigente && setError(mensajeDe(e)));
    return () => { vigente = false; };
  }, []);

  const roles = m?.roles ?? [];
  const modulos = useMemo(() => (m ? enOrdenDelMenu(m.modules) : []), [m]);
  const orden = useMemo(() => modulos.map((x) => x.code), [modulos]);
  const q = busca.trim().toLowerCase();

  const permisos = useMemo(() => (m?.permissions ?? [])
    .filter((p) => (!modulo || p.module_code === modulo) && (!q || `${p.code} ${p.description}`.toLowerCase().includes(q)))
    .sort((a, b) => orden.indexOf(a.module_code) - orden.indexOf(b.module_code) || a.code.localeCompare(b.code)), [m, modulo, q, orden]);
  const accesos = useMemo(() => modulos.filter((x) => !q || `${x.code} ${nombreModulo(x.code, x.name)}`.toLowerCase().includes(q)), [modulos, q]);

  const total = vista === "permisos" ? permisos.length : accesos.length;
  const ultima = Math.max(1, Math.ceil(total / porPagina));
  const pag = Math.min(pagina, ultima);
  const corte = <T,>(xs: T[]) => xs.slice((pag - 1) * porPagina, pag * porPagina);

  const celdaRol = (code: string) => ({ key: code, header: abreviar(code), align: "center" as const });
  const colPermisos: Column<FilaPermiso>[] = [
    { key: "code", header: "Permiso", cardTitle: true, render: (p) => (
      <span className={p.enabled ? "" : "opacity-50"} title={p.description}>
        <span className="font-mono text-[12px]">{p.code}</span>{!p.enabled && <span className="text-[12px] text-muted"> (apagado)</span>}
      </span>
    ) },
    { key: "description", header: "Para qué", className: "min-w-[220px]" },
    ...roles.map((r) => ({ ...celdaRol(r.code), render: (p: FilaPermiso) => p.roles.includes(r.code)
      ? <span title={r.name} className="font-bold text-ok">●</span> : <span className="text-muted">·</span> })),
  ];
  const colAccesos: Column<FilaModulo>[] = [
    { key: "code", header: "Módulo", cardTitle: true, render: (x) => (
      <span className={x.enabled ? "" : "opacity-50"}>
        <span className="font-mono text-[12px] text-muted">{x.code}</span> {nombreModulo(x.code, x.name)}{!x.enabled && <span className="text-[12px] text-muted"> (apagado)</span>}
      </span>
    ) },
    ...roles.map((r) => ({ ...celdaRol(r.code), render: (x: FilaModulo) => {
      const a = x.enabled ? x.access[r.code] : "";
      return a ? <span title={`${r.name} · ${x.code}`} className="font-mono text-[12px]">{a}</span> : <span className="text-muted">·</span>;
    } })),
  ];

  const [exportando, setExportando] = useState(false);
  /** Excel con el diseño de reporte de la empresa, generado por la API (queda en la bitácora). */
  async function exportar() {
    setExportando(true);
    try {
      await apiDescargar("/v1/seg/matriz/exportar", "matriz-roles-permisos.xlsx");
      toast.ok("Matriz exportada en Excel");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setExportando(false);
    }
  }

  const paginacion = { page: pag, lastPage: ultima, total, perPage: porPagina, onPageChange: setPagina, onPerPageChange: (n: number) => { setPorPagina(n); setPagina(1); } };

  return (
    <div className="space-y-5">
      <PageHeader description="Vista de solo lectura de todos los roles contra todos los permisos, para la revisión de accesos. Los módulos apagados no conceden nada."
        actions={<Button variant="primary" icon={Download} onClick={exportar} loading={exportando} disabled={!m}>Exportar a Excel</Button>} />
      {error && <Alert tone="bad">{error}</Alert>}

      <Tabs<Vista> value={vista} onChange={(v) => { setVista(v); setPagina(1); }} tabs={[
        { key: "permisos", label: "Permisos especiales", count: m?.permissions.length },
        { key: "accesos", label: "Acceso por módulo", count: m?.modules.length },
      ]} />

      {vista === "permisos" ? (
        <DataTable rows={corte(permisos)} rowKey={(p) => p.code} columns={colPermisos} loading={!m && !error} pagination={paginacion}
          search={{ value: busca, onChange: (v) => { setBusca(v); setPagina(1); }, placeholder: "Buscar permiso…" }} empty="No hay permisos con esos filtros."
          toolbar={
            <div className="w-full sm:w-[220px]">
              <Select aria-label="Módulo" value={modulo} onChange={(e) => { setModulo(e.target.value); setPagina(1); }} placeholder="Módulo: todos"
                options={modulos.filter((x) => m?.permissions.some((p) => p.module_code === x.code)).map((x) => ({ value: x.code, label: `${x.code} · ${nombreModulo(x.code, x.name)}` }))}
                className="!min-h-9 h-9 py-1.5 text-[13px]" />
            </div>
          } />
      ) : (
        <DataTable rows={corte(accesos)} rowKey={(x) => x.code} columns={colAccesos} loading={!m && !error} pagination={paginacion}
          search={{ value: busca, onChange: (v) => { setBusca(v); setPagina(1); }, placeholder: "Buscar módulo…" }} empty="No hay módulos con ese texto." />
      )}

      {roles.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-2 text-[13.5px] font-semibold">Leyenda</h2>
          <p className="mb-2 text-[12.5px] text-muted">Acceso por módulo: C crear · L leer · E editar · A aprobar o anular.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            {roles.map((r) => <span key={r.code}><span className="font-mono">{abreviar(r.code)}</span> = {r.name}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}
