"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleOff, Layers, ListTree, Network, Plus, Tags } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { useSeleccion } from "@/lib/useSeleccion";
import { CentroCostoForm } from "@/modulos/plt/CentroCostoForm";
import { AREAS_COSTO, etiqueta, type CentroCosto, type Empresa, type Local, type Marca } from "@/modulos/plt/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };

type Resumen = { total: number; activos: number; areas: number; areas_total: number; nivel_maximo: number; limite: number; por_marca: number };

/** PLT-07 Centros de costo: árbol por área, con local y marca opcionales, a los que se imputan gastos y costos. */
export default function CentrosCosto() {
  const { can } = useSesion();
  const [area, setArea] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<CentroCosto>("/v1/plt/centros-costo", { orden: "code", filtros: { area, status: estado } });
  const empresas = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100 }).filas;
  const locales = useListado<Local>("/v1/plt/locales", { porPagina: 100 }).filas;
  const marcas = useListado<Marca>("/v1/plt/marcas", { porPagina: 100, orden: "sort_order" }).filas;
  const [arbol, setArbol] = useState<{ centros: CentroCosto[]; resumen: Resumen } | null>(null);
  const [version, setVersion] = useState(0);
  const [editando, setEditando] = useState<{ centro: CentroCosto | null; padre?: CentroCosto } | null>(null);
  const sel = useSeleccion(lista.filas);
  const [cambiando, setCambiando] = useState(false);
  const puedeEditar = can("plt.cost_center.manage");
  const limite = arbol?.resumen.limite ?? 4;
  const r = arbol?.resumen;

  useEffect(() => {
    let vigente = true;
    api<{ centros: CentroCosto[]; resumen: Resumen }>("/v1/plt/centros-costo/arbol").then((d) => vigente && setArbol(d)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => { lista.recargar(); setVersion((n) => n + 1); };

  /** Activa o desactiva los marcados. */
  async function cambiarEstado(status: "ACTIVE" | "INACTIVE") {
    const n = sel.filas.filter((f) => (f.status === "ACTIVE") !== (status === "ACTIVE")).length;
    const plural = n === 1 ? "1 centro de costo" : `${n} centros de costo`;
    const ok = await confirmAction(status === "INACTIVE" ? {
      title: `Desactivar ${plural}`,
      message: "No admiten gastos ni costos nuevos. Lo ya imputado no cambia. Sus centros de abajo siguen como están.",
      confirmLabel: "Desactivar", danger: true,
    } : { title: `Activar ${plural}`, message: "Vuelven a admitir gastos y costos.", confirmLabel: "Activar" });
    if (!ok) return;
    setCambiando(true);
    try {
      const res = await api<{ cambiados: number }>("/v1/plt/centros-costo/estado", { method: "PUT", body: { ids: sel.ids, status } });
      toast.ok(res.cambiados === 0 ? "Ya estaban así: no cambió nada."
        : `${res.cambiados === 1 ? "1 centro de costo" : `${res.cambiados} centros de costo`} ${status === "ACTIVE" ? "activado" : "desactivado"}${res.cambiados === 1 ? "" : "s"}`);
      sel.limpiar();
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setCambiando(false);
    }
  }

  const columnas: Column<CentroCosto>[] = [
    { key: "code", header: "Código", sortable: true, render: (c) => <span className="font-mono font-semibold">{c.code}</span> },
    { key: "name", header: "Nombre", sortable: true, cardTitle: true },
    { key: "area", header: "Área", sortable: true, render: (c) => etiqueta(AREAS_COSTO, c.area) },
    { key: "parent_code", header: "Depende de", hideOnMobile: true, render: (c) => c.parent_code ? <span className="font-mono">{c.parent_code}</span> : <span className="text-muted">—</span> },
    { key: "nivel", header: "Nivel", align: "right", hideOnMobile: true },
    { key: "establishment_name", header: "Local", hideOnMobile: true, render: (c) => c.establishment_name ?? <span className="text-muted">—</span> },
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (c) => c.brand_name ?? <span className="text-muted">—</span> },
    { key: "status", header: "Estado", sortable: true, render: (c) => <StatusBadge status={c.status} labels={ESTADOS} /> },
  ];

  const abrir = (centro: CentroCosto | null, padre?: CentroCosto) => setEditando({ centro, padre });

  return (
    <div className="space-y-5">
      <PageHeader description={`Los centros a los que se imputan los gastos y costos, en árbol por área, con local y marca opcionales. Hasta ${limite} niveles. Un centro que ya no se usa se desactiva.`}
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => abrir(null)} disabled={!empresas.length}>Nuevo centro de costo</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Centros de costo" icono={Network} destacada valor={r ? numero(r.total) : undefined} detalle={r ? `${r.activos} activos` : ""} />
        <Cifra titulo="Áreas con centros" icono={Layers} valor={r ? `${r.areas} de ${r.areas_total}` : undefined} detalle="" />
        <Cifra titulo="Nivel máximo" icono={ListTree} valor={r ? numero(r.nivel_maximo) : undefined} detalle={r ? `Límite: ${r.limite} niveles` : ""} />
        <Cifra titulo="Por marca" icono={Tags} valor={r ? numero(r.por_marca) : undefined} detalle="Ventas y marketing de cada marca" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {AREAS_COSTO.map((a) => (
          <Area key={a.value} titulo={a.label} centros={(arbol?.centros ?? []).filter((c) => c.area === a.value)} cargando={!arbol}
            limite={limite} onAbrir={puedeEditar ? (c) => abrir(c) : undefined} onHijo={puedeEditar ? (c) => abrir(null, c) : undefined} />
        ))}
      </div>

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar código o nombre…" }}
        onRowClick={puedeEditar ? (c) => abrir(c) : undefined}
        empty="No hay centros de costo con esos filtros."
        selection={puedeEditar ? {
          selected: sel.ids, onChange: sel.cambiar,
          actions: <>
            {sel.filas.some((f) => f.status !== "ACTIVE") && (
              <Button size="sm" icon={CircleCheck} loading={cambiando} onClick={() => cambiarEstado("ACTIVE")}>Activar</Button>
            )}
            {sel.filas.some((f) => f.status === "ACTIVE") && (
              <Button size="sm" variant="danger" icon={CircleOff} loading={cambiando} onClick={() => cambiarEstado("INACTIVE")}>Desactivar</Button>
            )}
          </>,
        } : undefined}
        toolbar={<>
          <Filtro label="Área" value={area} onChange={setArea} options={AREAS_COSTO} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" }]} />
        </>} />

      {editando && (
        <CentroCostoForm centro={editando.centro} padre={editando.padre} todos={arbol?.centros ?? []} empresas={empresas} locales={locales} marcas={marcas}
          limite={limite} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); recargar(); }} />
      )}
    </div>
  );
}

/** Tarjeta de un área con su árbol de centros. */
function Area({ titulo, centros, cargando, limite, onAbrir, onHijo }: {
  titulo: string; centros: CentroCosto[]; cargando: boolean; limite: number;
  onAbrir?: (c: CentroCosto) => void; onHijo?: (c: CentroCosto) => void;
}) {
  const ids = new Set(centros.map((c) => c.id));
  const raices = centros.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const hijosDe = (id: string) => centros.filter((c) => c.parent_id === id);

  const nodo = (c: CentroCosto, nivel: number): React.ReactNode => (
    <li key={c.id}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 py-1 ${c.status !== "ACTIVE" ? "opacity-55" : ""}`} style={{ paddingLeft: nivel * 16 }}>
        {onAbrir ? (
          <button type="button" onClick={() => onAbrir(c)} className="cursor-pointer text-left text-[13px] hover:text-primary hover:underline">
            <span className="font-mono text-[12px] font-semibold">{c.code}</span> {c.name}
          </button>
        ) : (
          <span className="text-[13px]"><span className="font-mono text-[12px] font-semibold">{c.code}</span> {c.name}</span>
        )}
        {c.establishment_name && <Badge tone="info">{c.establishment_name}</Badge>}
        {c.brand_name && <Badge tone="primary">{c.brand_name.split(" · ")[0]}</Badge>}
        {c.status !== "ACTIVE" && <Badge>Inactivo</Badge>}
        {onHijo && c.nivel < limite && (
          <button type="button" onClick={() => onHijo(c)} className="cursor-pointer text-[12px] text-muted hover:text-primary hover:underline">+ hijo</button>
        )}
      </div>
      {hijosDe(c.id).length > 0 && <ul>{hijosDe(c.id).map((h) => nodo(h, nivel + 1))}</ul>}
    </li>
  );

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-2.5 text-[13.5px] font-semibold">{titulo}</h2>
      <div className="px-4 py-2">
        {cargando ? (
          <div className="space-y-2 py-1">{[1, 2].map((n) => <div key={n} className="h-4 animate-pulse rounded bg-surface-2" />)}</div>
        ) : raices.length ? (
          <ul>{raices.map((c) => nodo(c, 0))}</ul>
        ) : (
          <p className="py-2 text-[13px] text-muted">Sin centros en esta área.</p>
        )}
      </div>
    </section>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
