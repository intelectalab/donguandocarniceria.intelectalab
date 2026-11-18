"use client";

import { useMemo, useState } from "react";
import { Alert, DataTable, DetailList, Modal, PageHeader, Select, StatusBadge, type Column, type Tone } from "@/components/ui";
import { TIPO_ENTIDAD, ordenarFilas, sinTildes, useDatos } from "@/modulos/mae/tipos";

type Entidad = { id: string; code: string; name: string; kind: string; ruc: string | null; cci_code: string | null; status: string; medios: string[] };

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };

/**
 * MAE-09 Entidades financieras: bancos, billeteras (Yape, Plin), adquirentes (Niubiz, Izipay) y pasarelas (Mercado Pago).
 * Son de todo el sistema y de solo lectura (RN-MAE-11); se enlazan a los medios de pago (MAE-03) y a las cuentas de Caja.
 */
export default function Entidades() {
  const { datos, error } = useDatos<Entidad[]>("/v1/mae/entidades");
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [orden, setOrden] = useState("");
  const [abierta, setAbierta] = useState<Entidad | null>(null);
  const filas = useMemo(() => {
    const q = sinTildes(busca.trim());
    const vistas = (datos ?? []).filter((f) => (!tipo || f.kind === tipo)
      && (!q || [f.code, f.name, f.ruc ?? "", f.cci_code ?? "", ...f.medios].some((x) => sinTildes(x).includes(q))));
    return ordenarFilas(vistas, orden,
      (f, c) => (c === "kind" ? TIPO_ENTIDAD[f.kind] ?? f.kind : c === "medios" ? f.medios.join(", ") : (f as unknown as Record<string, string>)[c]));
  }, [datos, tipo, busca, orden]);

  const columnas: Column<Entidad>[] = [
    { key: "code", header: "Código", sortable: true, render: (f) => <span className="font-mono text-[12.5px]">{f.code}</span> },
    { key: "name", header: "Entidad", cardTitle: true, sortable: true, render: (f) => <span className="font-semibold">{f.name}</span> },
    { key: "kind", header: "Tipo", sortable: true, render: (f) => TIPO_ENTIDAD[f.kind] ?? f.kind },
    { key: "ruc", header: "RUC", hideOnMobile: true, sortable: true, render: (f) => <span className="font-mono text-[12.5px]">{f.ruc ?? "—"}</span> },
    { key: "cci_code", header: "Código CCI", hideOnMobile: true, sortable: true, render: (f) => <span className="font-mono text-[12.5px]">{f.cci_code ?? "—"}</span> },
    { key: "medios", header: "Medios de pago", sortable: true, render: (f) => f.medios.join(", ") || "—" },
    { key: "status", header: "Estado", render: (f) => <StatusBadge status={f.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Bancos, billeteras, adquirentes y pasarelas. Son de todo el sistema y de solo lectura: se enlazan a los medios de pago y a las cuentas de Caja." />
      {error && <Alert tone="bad">{error}</Alert>}

      <DataTable columns={columnas} rows={filas} loading={!datos && !error} empty="No hay entidades con esa búsqueda o tipo." onRowClick={setAbierta}
        sort={orden} onSortChange={setOrden}
        search={{ value: busca, onChange: setBusca, placeholder: "Buscar código, nombre, RUC o medio de pago…" }}
        toolbar={<>
          <div className="w-full sm:w-[200px]">
            <Select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo: todos" className="!min-h-9 h-9 py-1.5 text-[13px]"
              options={Object.entries(TIPO_ENTIDAD).map(([value, label]) => ({ value, label }))} />
          </div>
        </>} />

      {abierta && (
        <Modal open title={abierta.name} onClose={() => setAbierta(null)}>
          <div className="space-y-4">
            <DetailList items={[
              { label: "Código", value: abierta.code },
              { label: "Tipo", value: TIPO_ENTIDAD[abierta.kind] ?? abierta.kind },
              { label: "RUC", value: abierta.ruc ?? "—" },
              { label: "Código CCI", value: abierta.cci_code ?? "—" },
              { label: "Medios de pago que la usan", value: abierta.medios.join(", ") || "—" },
              { label: "Estado", value: <StatusBadge status={abierta.status} labels={ESTADOS} /> },
            ]} />
            <p className="text-[12.5px] text-muted">Registro de todo el sistema y de solo lectura. Las cuentas de la empresa en cada banco se verán aquí cuando exista el módulo de Caja.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
