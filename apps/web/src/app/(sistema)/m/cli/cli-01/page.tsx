"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Copy, Download, Megaphone, Plus, Repeat, UserPlus, Users } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, Tabs, toast, type Column } from "@/components/ui";
import { api, apiDescargar, mensajeDe } from "@/lib/api";
import { fecha, numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ESTADOS_CLIENTE, TIPOS_CLIENTE, celular, etiqueta, type ClienteFila, type ResumenClientes } from "@/modulos/cli/tipos";

type Vista = "ACTIVE" | "BLOCKED" | "MERGED" | "ALL";

/** CLI-01 Clientes: un solo cliente para las 5 marcas. Busca por celular (como sea que se escriba), nombre, documento o correo. */
export default function Clientes() {
  const router = useRouter();
  const { can } = useSesion();
  const [vista, setVista] = useState<Vista>("ACTIVE");
  const [tipo, setTipo] = useState("");
  const [zona, setZona] = useState("");
  const [marca, setMarca] = useState("");
  const [estado, setEstado] = useState("");
  const [vendedora, setVendedora] = useState("");
  const [mes, setMes] = useState("");
  const [resumen, setResumen] = useState<ResumenClientes | null>(null);
  const [exportando, setExportando] = useState(false);

  const lista = useListado<ClienteFila>("/v1/cli/clientes", {
    orden: "full_name",
    filtros: { vista, customer_type: tipo, zone_id: zona, brand_id: marca, status: estado, seller_user_id: vendedora },
  });

  useEffect(() => {
    let vigente = true;
    api<ResumenClientes>(`/v1/cli/clientes/resumen${mes ? `?mes=${mes}` : ""}`).then((r) => vigente && setResumen(r)).catch(() => {});
    return () => { vigente = false; };
  }, [mes]);

  async function exportar() {
    setExportando(true);
    try {
      await apiDescargar("/v1/cli/clientes/exportar", "clientes.xlsx");
      toast.ok("Exportación descargada: queda registrada en la bitácora.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setExportando(false);
    }
  }

  const r = resumen;
  const op = r?.opciones;
  const columnas: Column<ClienteFila>[] = [
    {
      key: "full_name", header: "Cliente", sortable: true, cardTitle: true,
      render: (c) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>{c.trade_name || c.full_name}</span>
            {c.duplicado && <Badge tone="warn">Posible duplicado</Badge>}
          </div>
          <div className="text-[12px] text-muted">{c.trade_name ? c.full_name : c.email ?? ""}</div>
        </div>
      ),
    },
    { key: "phone", header: "Celular", sortable: true, render: (c) => <span className="font-mono whitespace-nowrap">{celular(c.phone)}</span> },
    {
      key: "doc", header: "Documento", hideOnMobile: true,
      render: (c) => c.doc_type === "NONE" || !c.doc_number ? <span className="text-[12.5px] text-muted">Sin documento</span> : (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono whitespace-nowrap">{c.doc_type} {c.doc_number}</span>
          {c.doc_validated_at ? <Badge tone="ok">{c.doc_validation_source}</Badge> : <Badge tone="warn">Sin validar</Badge>}
        </span>
      ),
    },
    { key: "customer_type", header: "Tipo", sortable: true, hideOnMobile: true, render: (c) => <Badge tone={c.customer_type === "PERSON" ? "neutral" : "info"}>{etiqueta(TIPOS_CLIENTE, c.customer_type)}</Badge> },
    { key: "zona", header: "Zona", hideOnMobile: true, render: (c) => c.zona ?? <span className="text-muted">—</span> },
    {
      key: "ultima_compra", header: "Última compra", sortable: true, hideOnMobile: true,
      render: (c) => c.ultima_compra ? <div><div>{fecha(c.ultima_compra)}</div><div className="text-[12px] text-muted">{c.ultima_marca}</div></div> : <span className="text-muted">—</span>,
    },
    { key: "pedidos", header: "Pedidos", align: "right", sortable: true, render: (c) => numero(c.pedidos) },
    { key: "vendedora", header: "Vendedora", hideOnMobile: true, render: (c) => c.vendedora ?? <span className="text-muted">—</span> },
    { key: "marketing_opt_in", header: "Publicidad", hideOnMobile: true, render: (c) => c.marketing_opt_in ? <Badge tone="ok">Sí</Badge> : <span className="text-[12.5px] text-muted">No</span> },
    { key: "status", header: "Estado", sortable: true, render: (c) => c.merged_into_id ? <Badge>Fusionado</Badge> : <StatusBadge status={c.status} labels={ESTADOS_CLIENTE} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Un solo cliente para las 5 marcas. Busca por celular (como sea que lo escriba), nombre, documento o correo."
        actions={<>
          {can("cli.customer.export") && <Button icon={Download} loading={exportando} onClick={exportar}>Exportar</Button>}
          {can("cli.customer.manage") && <Button icon={UserPlus} onClick={() => router.push("/m/cli/cli-12")}>Importar</Button>}
          {can("cli.customer.manage") && <Button variant="primary" icon={Plus} onClick={() => router.push("/m/cli/cli-03")}>Alta rápida</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Cifra titulo="Clientes activos" icono={Users} destacada valor={r ? numero(r.activos) : undefined} detalle={r ? `${numero(r.aceptan_publicidad)} aceptan publicidad` : ""} />
        <Cifra titulo="Nuevos del mes" icono={UserPlus} valor={r ? numero(r.nuevos_mes) : undefined} detalle="Primer pedido confirmado" />
        <Cifra titulo="Recurrentes del mes" icono={Repeat} valor={r ? porcentaje(r.recurrentes.valor, 1) : undefined}
          detalle={r ? `${r.recurrentes.numerador} de ${r.recurrentes.denominador} con 2 o más entregas` : ""} />
        <button type="button" onClick={() => router.push("/m/cli/cli-10")} className="h-full cursor-pointer text-left [&>div]:h-full">
          <Cifra titulo="Duplicados por revisar" icono={Copy} valor={r ? numero(r.duplicados_abiertos) : undefined}
            tono={r ? (r.duplicados_abiertos ? "warn" : "ok") : undefined} detalle="Abre la revisión" />
        </button>
        <button type="button" onClick={() => setVista("BLOCKED")} className="col-span-2 h-full cursor-pointer text-left lg:col-span-1 [&>div]:h-full">
          <Cifra titulo="Bloqueados" icono={Ban} valor={r ? numero(r.bloqueados) : undefined} tono={r && r.bloqueados ? "bad" : undefined} detalle="No reciben pedidos nuevos" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <Megaphone size={14} aria-hidden="true" />
        <span>Cifras del mes</span>
        <input type="month" aria-label="Mes de las cifras" value={mes || r?.mes || ""} onChange={(e) => setMes(e.target.value)}
          className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[13px] text-ink" />
      </div>

      <Tabs value={vista} onChange={setVista} tabs={[
        { key: "ACTIVE", label: "Activos y bloqueados" }, { key: "BLOCKED", label: "Bloqueados" },
        { key: "MERGED", label: "Fusionados" }, { key: "ALL", label: "Todos" },
      ]} />

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Celular (987 654 321), nombre, DNI/RUC o correo…" }}
        onRowClick={(c) => router.push(`/m/cli/cli-02?id=${c.id}`)}
        empty="No hay clientes con esos filtros."
        toolbar={<>
          <Filtro label="Tipo" value={tipo} onChange={setTipo} options={TIPOS_CLIENTE} />
          <Filtro label="Marca de su última compra" value={marca} onChange={setMarca} options={(op?.marcas ?? []).map((m) => ({ value: m.id, label: m.name }))} />
          <Filtro label="Zona" value={zona} onChange={setZona} options={(op?.zonas ?? []).map((z) => ({ value: z.id, label: z.name }))} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activo" }, { value: "BLOCKED", label: "Bloqueado" }, { value: "INACTIVE", label: "Inactivo" }]} />
          <Filtro label="Vendedora" value={vendedora} onChange={setVendedora} options={(op?.vendedoras ?? []).map((u) => ({ value: u.id, label: u.name }))} />
        </>} />
    </div>
  );
}

function Filtro({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="w-full sm:w-[160px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={`${label}: todos`} options={options}
        className="!min-h-9 h-9 py-1.5 text-[13px]" />
    </div>
  );
}
