"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Cifra, DataTable, FiltroSelect, PageHeader, Tabs, buttonClass } from "@/components/ui";
import { soles } from "@/lib/formato";
import { useListado } from "@/lib/useListado";
import { Vacio, columnasGasto, usePermisosGas } from "@/modulos/gas/comunes";
import { Ficha } from "@/modulos/gas/Ficha";
import type { FilaGasto } from "@/modulos/gas/tipos";

const ESTADOS = [
  { value: "DRAFT", label: "Borradores" }, { value: "SUBMITTED", label: "Enviados" }, { value: "APPROVED", label: "Aprobados" },
  { value: "REJECTED", label: "Rechazados" }, { value: "PAID", label: "Pagados" }, { value: "VOIDED", label: "Anulados" },
];

/** GAS-02 Mis gastos: los propios con su estado, observaciones y rechazos. Quien ve todos puede cambiar a «Todos». */
export default function MisGastos() {
  return <Suspense fallback={<Vacio>Cargando…</Vacio>}><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const abierto = useSearchParams().get("id");
  const p = usePermisosGas();
  const [vista, setVista] = useState<"mios" | "todos">("mios");
  const [estado, setEstado] = useState("");
  const lista = useListado<FilaGasto & { resumen?: never }>("/v1/gas/gastos", { filtros: { vista, estado }, orden: "-created_at" });
  const abrir = (id: string | null) => router.replace(id ? `/m/gas/gas-02?id=${id}` : "/m/gas/gas-02", { scroll: false });
  const rechazados = lista.filas.filter((g) => g.status === "REJECTED" || g.accounting_flag === "OBSERVED").length;
  return (
    <div className="space-y-4">
      <PageHeader description={vista === "mios" ? "Tus gastos con su estado. Si te rechazan uno o la contadora pide corregirlo, ábrelo para ver el motivo y corregirlo." : "Todos los gastos dentro de tu alcance."}
        actions={p.crea && <Link href="/m/gas/gas-01" className={buttonClass("primary")}><Plus size={16} aria-hidden="true" />Registrar gasto</Link>} />
      {p.veTodo && <Tabs tabs={[{ key: "mios", label: "Mis gastos" }, { key: "todos", label: "Todos" }]} value={vista} onChange={(k) => setVista(k as "mios" | "todos")} />}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Cifra titulo="Gastos" valor={String(lista.total)} detalle={estado ? ESTADOS.find((e) => e.value === estado)?.label : "Todos los estados"} destacada />
        <Cifra titulo="En esta página" valor={soles(lista.filas.reduce((s, g) => s + g.amount_pen, 0))} />
        {vista === "mios" && <Cifra titulo="Por corregir" valor={String(rechazados)} tono={rechazados ? "warn" : undefined} detalle="Rechazados u observados" />}
      </div>
      <DataTable {...lista.tabla} columns={columnasGasto([], vista === "mios" ? ["registro"] : [])} onRowClick={(g) => abrir(g.id)}
        search={{ ...lista.tabla.search, placeholder: "Buscar por número, descripción o proveedor" }}
        toolbar={<FiltroSelect etiqueta="Estado" value={estado} onChange={setEstado} options={ESTADOS} />}
        empty={vista === "mios" ? "Aún no registras gastos." : "No hay gastos con ese filtro."} />
      <Ficha id={abierto} onClose={() => abrir(null)} onCambio={lista.recargar} />
    </div>
  );
}
