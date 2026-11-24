"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FlaskConical, MessageCircle, Plug } from "lucide-react";
import { Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { Entorno, EstadoConector, nombreModulo, useDatos, type Conector } from "@/modulos/int/tipos";

type Datos = {
  data: Conector[]; cifras: { activos: number; total: number; en_error: number; whatsapp: number; prueba: number };
  tipos: { code: string; name: string }[]; marcas: { id: string; name: string }[]; estados: Record<string, string>;
};
const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * INT-01 Conectores: cada proveedor externo detrás de su interfaz, con su adaptador (el falso solo en el entorno de
 * prueba), entorno, marca y local, módulo dueño, última conexión correcta y último error.
 */
export default function Conectores() {
  const router = useRouter();
  const { datos, error, recargar } = useDatos<Datos>("/v1/int/conectores");
  const [f, setF] = useState({ buscar: "", kind: "", brand: "", environment: "", status: "" });

  const visibles = useMemo(() => {
    const q = sinTildes(f.buscar.trim());
    return (datos?.data ?? []).filter((c) => (!q || sinTildes(`${c.name} ${c.code} ${c.adapter_name}`).includes(q))
      && (!f.kind || c.kind === f.kind) && (!f.brand || c.brand_id === f.brand) && (!f.environment || c.environment === f.environment) && (!f.status || c.status === f.status));
  }, [datos, f]);
  const ord = useOrdenLocal(visibles, {
    name: (c) => c.name, kind: (c) => c.kind_name, adapter: (c) => c.adapter_name, brand: (c) => `${c.brand_name ?? ""} ${c.establishment_name ?? ""}`,
    environment: (c) => c.environment, owner_module: (c) => nombreModulo(c.owner_module), last_ok_at: (c) => c.last_ok_at, last_error_at: (c) => c.last_error_at, status: (c) => c.status_name,
  });
  const pagina = usePaginaLocal(ord.filas, `${JSON.stringify(f)}|${ord.orden.sort}`);
  const c = datos?.cifras;

  const columnas: Column<Conector>[] = [
    { key: "name", sortable: true, header: "Conector", cardTitle: true, render: (x) => <div><p className="font-semibold text-ink">{x.name}</p><p className="font-mono text-[12px] text-muted">{x.code}</p></div> },
    { key: "kind", sortable: true, header: "Tipo", render: (x) => x.kind_name },
    { key: "adapter", sortable: true, header: "Adaptador", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.adapter_name}</span> },
    { key: "brand", sortable: true, header: "Marca · local", hideOnMobile: true, render: (x) => [x.brand_name, x.establishment_name].filter(Boolean).join(" · ") || "Empresa" },
    { key: "environment", sortable: true, header: "Entorno", render: (x) => <Entorno e={x.environment} /> },
    { key: "owner_module", sortable: true, header: "Módulo", hideOnMobile: true, render: (x) => nombreModulo(x.owner_module) },
    { key: "last_ok_at", sortable: true, header: "Última conexión correcta", hideOnMobile: true, render: (x) => (x.last_ok_at ? <span className="whitespace-nowrap">{fechaHora(x.last_ok_at)}</span> : <span className="text-muted">Nunca</span>) },
    { key: "last_error_at", sortable: true, header: "Último error", hideOnMobile: true, render: (x) => (x.last_error
      ? <span className="text-[12.5px] text-bad">{x.last_error_at ? `${fechaHora(x.last_error_at)} · ` : ""}{x.last_error}</span> : <span className="text-muted">—</span>) },
    { key: "status", sortable: true, header: "Estado", render: (x) => <EstadoConector c={x} /> },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Cada proveedor externo (WhatsApp, comprobantes, pagos, anuncios, mapas…) se usa a través de su conector. En el entorno de prueba trabaja un adaptador falso que no sale a internet; en producción, el adaptador real del proveedor. Los secretos están aparte, en Credenciales." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Conectores activos" valor={`${c.activos} de ${c.total}`} icono={Plug} destacada />
          <Cifra titulo="En error" valor={String(c.en_error)} tono={c.en_error ? "bad" : "ok"} icono={AlertTriangle} detalle={c.en_error ? "Revisa su ficha" : "Todos responden"} />
          <Cifra titulo="Números de WhatsApp" valor={String(c.whatsapp)} icono={MessageCircle} detalle="API oficial con coexistencia" />
          <Cifra titulo="Entorno de prueba" valor={String(c.prueba)} icono={FlaskConical} detalle="Con adaptador falso" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input type="search" aria-label="Buscar" placeholder="Buscar por nombre, código o adaptador" value={f.buscar} onChange={(e) => setF({ ...f, buscar: e.target.value })}
          className="min-h-[40px] w-full rounded-[9px] border border-line bg-surface px-3 py-2 text-[13.5px] text-ink outline-none placeholder:text-muted/70 focus:border-primary" />
        <Select aria-label="Tipo" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} placeholder="Todos los tipos"
          options={(datos?.tipos ?? []).map((t) => ({ value: t.code, label: t.name }))} />
        <Select aria-label="Marca" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} placeholder="Todas las marcas"
          options={(datos?.marcas ?? []).map((m) => ({ value: m.id, label: m.name }))} />
        <Select aria-label="Entorno" value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })} placeholder="Producción y prueba"
          options={[{ value: "PRODUCTION", label: "Producción" }, { value: "SANDBOX", label: "Prueba" }]} />
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
          options={Object.entries(datos?.estados ?? {}).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable {...ord.orden} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!datos && !error} error={error} onRetry={recargar}
        onRowClick={(x) => router.push(`/m/int/int-02?id=${x.id}`)} empty="No hay conectores con estos filtros." />
    </div>
  );
}
