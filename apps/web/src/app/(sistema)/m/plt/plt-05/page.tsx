"use client";

import { useState } from "react";
import { CircleCheck, CircleOff, Plus } from "lucide-react";
import { Button, DataTable, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { useSeleccion } from "@/lib/useSeleccion";
import { MarcaForm } from "@/modulos/plt/MarcaForm";
import type { Empresa, Marca } from "@/modulos/plt/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"], SEPARATED: ["Separada", "info"] };

/** PLT-05 Marcas: las marcas que facturan con cada empresa, con su pie legal, WhatsApp, color y orden. */
export default function Marcas() {
  const { can } = useSesion();
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<Marca>("/v1/plt/marcas", { orden: "sort_order", filtros: { company_id: empresa, status: estado } });
  const empresas = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100 }).filas;
  const [editando, setEditando] = useState<Marca | null | undefined>(undefined);
  const sel = useSeleccion(lista.filas);
  const [cambiando, setCambiando] = useState(false);
  const puedeEditar = can("plt.brand.manage");
  const variasEmpresas = empresas.length > 1;

  /** Activa o desactiva las marcas marcadas. Las separadas no se pueden marcar. */
  async function cambiarEstado(status: "ACTIVE" | "INACTIVE") {
    // Cuenta solo las que cambian: las que ya están así se quedan igual.
    const n = sel.filas.filter((f) => (f.status === "ACTIVE") !== (status === "ACTIVE")).length;
    const plural = n === 1 ? "1 marca" : `${n} marcas`;
    const ok = await confirmAction(status === "INACTIVE" ? {
      title: `Desactivar ${plural}`,
      message: "Dejan de aparecer en los selectores y no admiten documentos nuevos. Sus pedidos y comprobantes anteriores no cambian.",
      confirmLabel: "Desactivar", danger: true,
    } : {
      title: `Activar ${plural}`,
      message: "Vuelven a aparecer en los selectores y admiten documentos nuevos.",
      confirmLabel: "Activar",
    });
    if (!ok) return;
    setCambiando(true);
    try {
      const r = await api<{ cambiadas: number }>("/v1/plt/marcas/estado", { method: "PUT", body: { ids: sel.ids, status } });
      toast.ok(r.cambiadas === 0 ? "Ya estaban así: no cambió nada."
        : `${r.cambiadas === 1 ? "1 marca" : `${r.cambiadas} marcas`} ${status === "ACTIVE" ? "activada" : "desactivada"}${r.cambiadas === 1 ? "" : "s"}`);
      sel.limpiar();
      lista.recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setCambiando(false);
    }
  }

  const columnas: Column<Marca>[] = [
    { key: "sort_order", header: "#", sortable: true, align: "right", className: "text-muted", hideInCard: true },
    { key: "code", header: "Código", sortable: true, render: (m) => <span className="font-mono font-semibold">{m.code}</span> },
    {
      key: "name", header: "Marca", sortable: true, cardTitle: true, render: (m) => (
        <div className="flex min-w-[200px] items-center gap-2.5">
          <span aria-hidden="true" className="size-4 shrink-0 rounded-[4px] border border-line" style={{ background: m.primary_color }} />
          <div className="min-w-0">
            <p className="font-medium">{m.name}</p>
            {m.description && <p className="truncate text-[12px] text-muted" title={m.description}>{m.description}</p>}
          </div>
        </div>
      ),
    },
    ...(variasEmpresas ? [{ key: "company_name", header: "Factura", hideOnMobile: true, render: (m: Marca) => m.company_name ?? "—" }] : []),
    { key: "whatsapp_display_name", header: "En WhatsApp", hideOnMobile: true, render: (m) => m.whatsapp_display_name ?? "—" },
    { key: "website", header: "Web", hideOnMobile: true, render: (m) => m.website ?? <span className="text-muted">—</span> },
    { key: "series_count", header: "Series", align: "right", hideOnMobile: true },
    { key: "orders_count", header: "Pedidos", sortable: true, align: "right", hideOnMobile: true, render: (m) => numero(m.orders_count) },
    { key: "documents_count", header: "Comprobantes", sortable: true, align: "right", hideOnMobile: true, render: (m) => numero(m.documents_count) },
    {
      key: "theme_name", header: "Colores", hideOnMobile: true,
      render: (m) => m.theme_name ? <span title={m.theme_name}>Propios</span> : <span className="text-muted">Generales</span>,
    },
    { key: "status", header: "Estado", sortable: true, render: (m) => <StatusBadge status={m.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Las marcas con las que vendes. Cada una factura con el RUC de una empresa y tiene su pie legal, su nombre en WhatsApp y su color. Una marca que ya no se usa se desactiva."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setEditando(null)} disabled={!empresas.length}>Nueva marca</Button>} />

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar código, nombre o web…" }}
        onRowClick={puedeEditar ? setEditando : undefined}
        selection={puedeEditar ? {
          selected: sel.ids, onChange: sel.cambiar,
          canSelect: (m) => m.status !== "SEPARATED",
          actions: <>
            {/* Solo lo que cambia algo: Activar si hay alguna inactiva, Desactivar si hay alguna activa. */}
            {sel.filas.some((f) => f.status !== "ACTIVE") && (
              <Button size="sm" icon={CircleCheck} loading={cambiando} onClick={() => cambiarEstado("ACTIVE")}>Activar</Button>
            )}
            {sel.filas.some((f) => f.status === "ACTIVE") && (
              <Button size="sm" variant="danger" icon={CircleOff} loading={cambiando} onClick={() => cambiarEstado("INACTIVE")}>Desactivar</Button>
            )}
          </>,
        } : undefined}
        empty="No hay marcas con esos filtros."
        toolbar={<>
          {variasEmpresas && <Filtro label="Empresa" value={empresa} onChange={setEmpresa} options={empresas.map((c) => ({ value: c.id, label: c.trade_name }))} />}
          <Filtro label="Estado" value={estado} onChange={setEstado}
            options={[{ value: "ACTIVE", label: "Activas" }, { value: "INACTIVE", label: "Inactivas" }, { value: "SEPARATED", label: "Separadas" }]} />
        </>} />

      {editando !== undefined && (
        <MarcaForm marca={editando} empresas={empresas} siguienteOrden={lista.total + 1}
          onClose={() => setEditando(undefined)} onGuardada={() => { setEditando(undefined); lista.recargar(); }} />
      )}
    </div>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todas`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
