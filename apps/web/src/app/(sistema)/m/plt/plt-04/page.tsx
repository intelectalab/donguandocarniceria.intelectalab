"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, DataTable, MapView, PageHeader, Select, StatusBadge, type Column } from "@/components/ui";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { LocalForm } from "@/modulos/plt/LocalForm";
import { TIPOS_LOCAL, etiqueta, type Empresa, type Local } from "@/modulos/plt/tipos";

/** PLT-04 Locales: plantas, tiendas, almacenes y oficinas de cada empresa. */
export default function Locales() {
  const { can } = useSesion();
  const [empresa, setEmpresa] = useState("");
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<Local>("/v1/plt/locales", { filtros: { company_id: empresa, est_type: tipo, status: estado } });
  const empresas = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100 }).filas;
  const [editando, setEditando] = useState<Local | null | undefined>(undefined);
  const puedeEditar = can("plt.establishment.manage");
  const conPin = lista.filas.filter((l) => l.lat !== null && l.lng !== null)
    .map((l) => ({ id: l.id, lat: l.lat!, lng: l.lng!, label: l.code, title: l.name, muted: l.status !== "ACTIVE" }));
  const sinPin = lista.filas.length - conPin.length;

  const columnas: Column<Local>[] = [
    { key: "code", header: "Código", sortable: true, render: (l) => <span className="font-mono font-semibold">{l.code}</span> },
    {
      key: "name", header: "Local", sortable: true, cardTitle: true, render: (l) => (
        <div className="min-w-[180px]">
          <p className="font-medium">{l.short}</p>
          <p className="text-[12px] text-muted">{l.name}</p>
        </div>
      ),
    },
    { key: "est_type", header: "Tipo", sortable: true, render: (l) => etiqueta(TIPOS_LOCAL, l.est_type) },
    { key: "company_name", header: "Empresa", hideOnMobile: true, render: (l) => l.company_name ?? "—" },
    { key: "sunat_code", header: "Anexo SUNAT", hideOnMobile: true, render: (l) => <span className="font-mono">{l.sunat_code}</span> },
    {
      key: "address", header: "Dirección", hideOnMobile: true, render: (l) => (
        <div className="min-w-[180px]">
          <p>{l.address}</p>
          {l.district && <p className="text-[12px] text-muted">{l.district}</p>}
        </div>
      ),
    },
    { key: "has_counter", header: "Mostrador", hideOnMobile: true, render: (l) => l.has_counter ? <Badge tone="info">POS</Badge> : <span className="text-muted">—</span> },
    { key: "pin", header: "Pin", hideOnMobile: true, render: (l) => l.lat !== null ? <Badge tone="ok">Con pin</Badge> : <Badge tone="warn">Sin pin</Badge> },
    { key: "warehouses_count", header: "Almacenes", sortable: true, align: "right", hideOnMobile: true },
    { key: "zones_count", header: "Zonas", sortable: true, align: "right", hideOnMobile: true },
    { key: "status", header: "Estado", sortable: true, render: (l) => <StatusBadge status={l.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Plantas, tiendas, almacenes y oficinas de cada empresa. Un local que ya no se usa se desactiva."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)} disabled={!empresas.length}>Nuevo local</Button>} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <DataTable {...lista.tabla} columns={columnas}
          search={{ ...lista.tabla.search, placeholder: "Buscar código, nombre o dirección…" }}
          onRowClick={puedeEditar ? setEditando : undefined}
          empty="No hay locales con esos filtros."
          toolbar={<>
            <FiltroSelect label="Empresa" value={empresa} onChange={setEmpresa} options={empresas.map((c) => ({ value: c.id, label: c.trade_name }))} />
            <FiltroSelect label="Tipo" value={tipo} onChange={setTipo} options={TIPOS_LOCAL} />
            <FiltroSelect label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Inactivos" }]} />
          </>} />

        <section className="min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card">
          <h2 className="mb-3 text-[15px] font-semibold">Mapa</h2>
          {conPin.length ? (
            <MapView points={conPin} onSelect={puedeEditar ? (id) => setEditando(lista.filas.find((l) => l.id === id) ?? undefined) : undefined} />
          ) : (
            <p className="text-[13px] text-muted">{lista.cargando ? "Cargando…" : "Ningún local de la lista tiene pin. Fíjalo al editar el local."}</p>
          )}
          {sinPin > 0 && <p className="mt-2 text-[12px] text-muted">{sinPin} {sinPin === 1 ? "local sin pin no aparece" : "locales sin pin no aparecen"} en el mapa.</p>}
        </section>
      </div>

      {editando !== undefined && (
        <LocalForm local={editando} empresas={empresas} otros={lista.filas} onClose={() => setEditando(undefined)}
          onGuardado={() => { setEditando(undefined); lista.recargar(); }} />
      )}
    </div>
  );
}

function FiltroSelect({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
