"use client";

import { useState } from "react";
import { Building2, Map, MapPin, MapPinned } from "lucide-react";
import { Alert, Cifra, DataTable, PageHeader, Select, type Column } from "@/components/ui";
import { numero } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { NIVEL_UBIGEO, useDatos } from "@/modulos/mae/tipos";

type Ubigeo = { id: string; code: string; level: string; department: string; province: string | null; district: string | null; direcciones: number };
type Resumen = {
  lima: number; callao: number; arequipa: number; departamentos: number; lista_departamentos: string[];
  locales: { short: string; ubigeo: string | null; district: string | null }[];
};

/**
 * MAE-08 Ubigeo: departamento, provincia y distrito con el código INEI. Es de todo el sistema y de solo lectura:
 * lo actualiza Intelectalab con el archivo oficial del INEI (RN-MAE-11). Muestra cuántas direcciones de clientes
 * usan cada distrito.
 */
export default function UbigeoPantalla() {
  const [nivel, setNivel] = useState("");
  const [departamento, setDepartamento] = useState("");
  const { datos: r, error } = useDatos<Resumen>("/v1/mae/ubigeo/resumen");
  const lista = useListado<Ubigeo>("/v1/mae/ubigeo", { orden: "code", porPagina: 25, filtros: { level: nivel, department: departamento } });
  const filtro = "!min-h-9 h-9 py-1.5 text-[13px]";

  const columnas: Column<Ubigeo>[] = [
    { key: "code", header: "Ubigeo", sortable: true, render: (u) => <span className="font-mono text-[12.5px]">{u.code}</span> },
    { key: "level", header: "Nivel", render: (u) => NIVEL_UBIGEO[u.level] ?? u.level },
    { key: "department", header: "Departamento", sortable: true },
    { key: "province", header: "Provincia", sortable: true, render: (u) => u.province ?? "—" },
    { key: "district", header: "Distrito", sortable: true, cardTitle: true, render: (u) => u.district ?? "—" },
    { key: "direcciones", header: "Direcciones", align: "right", hideOnMobile: true, render: (u) => (u.direcciones ? numero(u.direcciones) : "—") },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Departamento, provincia y distrito con el código INEI. Es de todo el sistema y de solo lectura: lo actualiza Intelectalab con el archivo oficial del INEI." />
      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Lima Metropolitana" valor={r ? `${numero(r.lima)} distritos` : undefined} detalle="Provincia 1501" icono={MapPinned} destacada />
        <Cifra titulo="Callao" valor={r ? `${numero(r.callao)} distritos` : undefined} detalle="Provincia 0701" icono={MapPin} />
        <Cifra titulo="Arequipa" valor={r ? `${numero(r.arequipa)} distritos` : undefined} detalle="Provincia 0401 (envíos a provincia)" icono={Building2} />
        <Cifra titulo="Departamentos" valor={r ? numero(r.departamentos) : undefined} icono={Map} />
      </div>

      {r && r.locales.length > 0 && (
        <Alert tone="info">{r.locales.map((l) => `${l.short}: ${l.ubigeo ?? "sin ubigeo"}${l.district ? ` ${l.district}` : ""}`).join(" · ")}</Alert>
      )}

      <DataTable {...lista.tabla} columns={columnas} empty="No hay ubigeos con esos filtros."
        search={{ ...lista.tabla.search, placeholder: "Buscar código, departamento, provincia o distrito…" }}
        toolbar={<>
          <div className="w-full sm:w-[160px]">
            <Select aria-label="Nivel" value={nivel} onChange={(e) => setNivel(e.target.value)} placeholder="Nivel: todos" className={filtro}
              options={Object.entries(NIVEL_UBIGEO).map(([value, label]) => ({ value, label }))} />
          </div>
          <div className="w-full sm:w-[190px]">
            <Select aria-label="Departamento" value={departamento} onChange={(e) => setDepartamento(e.target.value)} placeholder="Departamento: todos" className={filtro}
              options={(r?.lista_departamentos ?? []).map((d) => ({ value: d, label: d }))} />
          </div>
        </>} />
    </div>
  );
}
