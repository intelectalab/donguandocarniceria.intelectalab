"use client";

import { useEffect, useState } from "react";
import { CircleCheck, CircleOff, Plus } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { useSeleccion } from "@/lib/useSeleccion";
import { SerieDetalle } from "@/modulos/plt/SerieDetalle";
import { SerieForm } from "@/modulos/plt/SerieForm";
import { TIPOS_DOCUMENTO, etiqueta, usoSerie, type Empresa, type Local, type Marca, type Serie } from "@/modulos/plt/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activa", "ok"], INACTIVE: ["Inactiva", "neutral"] };

type Resumen = {
  total: number; activas: number; electronicas: number; sobre_aviso: number; aviso_pct: number; numerados: number;
  /** KPI-PLT-02: la serie activa más cargada y su uso del rango (%). */
  mas_cargada: { series: string; uso: number } | null;
};

/** PLT-08 Series: por tipo de documento, local y marca, con su correlativo y cuánto del rango usaron. */
export default function Series() {
  const { can } = useSesion();
  const [tipo, setTipo] = useState("");
  const [marca, setMarca] = useState("");
  const [local, setLocal] = useState("");
  const [estado, setEstado] = useState("");
  const lista = useListado<Serie>("/v1/plt/series", { porPagina: 50, filtros: { doc_type: tipo, brand_id: marca, establishment_id: local, status: estado } });
  const empresas = useListado<Empresa>("/v1/plt/empresas", { porPagina: 100 }).filas;
  const locales = useListado<Local>("/v1/plt/locales", { porPagina: 100 }).filas;
  const marcas = useListado<Marca>("/v1/plt/marcas", { porPagina: 100, orden: "sort_order" }).filas;
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [version, setVersion] = useState(0);
  const [nueva, setNueva] = useState(false);
  const [viendo, setViendo] = useState<Serie | null>(null);
  const sel = useSeleccion(lista.filas);
  const [cambiando, setCambiando] = useState(false);
  const puedeEditar = can("plt.series.manage");
  const aviso = resumen?.aviso_pct ?? 95;

  useEffect(() => {
    let vigente = true;
    api<Resumen>("/v1/plt/series/resumen").then((datos) => vigente && setResumen(datos)).catch(() => {});
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => { lista.recargar(); setVersion((n) => n + 1); };

  /** Activa o desactiva las series marcadas, con un mismo motivo. */
  async function cambiarEstado(status: "ACTIVE" | "INACTIVE") {
    // Cuenta solo las que cambian: las que ya están así se quedan igual.
    const n = sel.filas.filter((f) => (f.status === "ACTIVE") !== (status === "ACTIVE")).length;
    const plural = n === 1 ? "1 serie" : `${n} series`;
    const r = await confirmAction({
      title: `${status === "INACTIVE" ? "Desactivar" : "Activar"} ${plural}`,
      message: status === "INACTIVE"
        ? "Una serie inactiva no numera documentos nuevos. Los ya emitidos no cambian."
        : "Vuelven a numerar desde su siguiente número.",
      confirmLabel: status === "INACTIVE" ? "Desactivar" : "Activar",
      danger: status === "INACTIVE",
      reason: { label: "Motivo", min: 10 },
    });
    if (!r) return;
    setCambiando(true);
    try {
      const res = await api<{ cambiadas: number }>("/v1/plt/series/estado", { method: "PUT", body: { ids: sel.ids, status, reason: r.reason } });
      toast.ok(res.cambiadas === 0 ? "Ya estaban así: no cambió nada."
        : `${res.cambiadas === 1 ? "1 serie" : `${res.cambiadas} series`} ${status === "ACTIVE" ? "activada" : "desactivada"}${res.cambiadas === 1 ? "" : "s"}`);
      sel.limpiar();
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setCambiando(false);
    }
  }

  const columnas: Column<Serie>[] = [
    { key: "series", header: "Serie", sortable: true, render: (s) => <span className="font-mono font-semibold">{s.series}</span> },
    { key: "doc_type", header: "Tipo", sortable: true, render: (s) => etiqueta(TIPOS_DOCUMENTO, s.doc_type) },
    { key: "is_electronic", header: "Envío", hideOnMobile: true, render: (s) => s.is_electronic ? <Badge tone="info">Electrónica</Badge> : <span className="text-muted">Interna</span> },
    { key: "establishment_name", header: "Local", hideOnMobile: true, render: (s) => s.establishment_name ?? <span className="text-muted">Toda la empresa</span> },
    { key: "brand_name", header: "Marca", hideOnMobile: true, render: (s) => s.brand_name ?? <span className="text-muted">Todas</span> },
    { key: "next_number", header: "Siguiente", sortable: true, align: "right", render: (s) => numero(s.next_number) },
    { key: "uso", header: "Uso del rango", hideOnMobile: true, render: (s) => <Uso valor={usoSerie(s.next_number)} aviso={aviso} /> },
    { key: "status", header: "Estado", sortable: true, render: (s) => <StatusBadge status={s.status} labels={ESTADOS} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Series de comprobantes, guías y documentos internos. El número se asigna al emitir: si la emisión falla, el número no se pierde. Una serie que ya no se usa se desactiva."
        actions={puedeEditar && <Button variant="primary" icon={Plus} onClick={() => setNueva(true)} disabled={!empresas.length}>Nueva serie</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Series" valor={resumen ? numero(resumen.total) : undefined}
          detalle={resumen ? `${resumen.activas} activas · ${resumen.electronicas} electrónicas` : ""} />
        <Cifra titulo="Serie más cargada" valor={resumen ? porcentaje(resumen.mas_cargada?.uso ?? 0, 2) : undefined}
          detalle={resumen?.mas_cargada?.series ?? ""}
          tono={resumen?.mas_cargada && resumen.mas_cargada.uso >= aviso ? "bad" : undefined} />
        <Cifra titulo="Sobre el aviso" valor={resumen ? numero(resumen.sobre_aviso) : undefined}
          detalle={resumen ? (resumen.sobre_aviso ? `Pasan el ${numero(aviso)} % del rango: crea otra serie` : `Ninguna pasa el ${numero(aviso)} % del rango`) : ""}
          tono={resumen?.sobre_aviso ? "warn" : undefined} />
        <Cifra titulo="Documentos numerados" valor={resumen ? numero(resumen.numerados) : undefined} detalle="Sin contar series migradas" />
      </div>

      <DataTable {...lista.tabla} columns={columnas}
        search={{ ...lista.tabla.search, placeholder: "Buscar serie o nota…" }}
        onRowClick={setViendo}
        selection={puedeEditar ? {
          selected: sel.ids, onChange: sel.cambiar,
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
        empty="No hay series con esos filtros."
        toolbar={<>
          <Filtro label="Tipo" value={tipo} onChange={setTipo} options={TIPOS_DOCUMENTO} />
          <Filtro label="Marca" value={marca} onChange={setMarca} options={marcas.map((m) => ({ value: m.id, label: m.name }))} />
          <Filtro label="Local" value={local} onChange={setLocal} options={locales.map((l) => ({ value: l.id, label: l.short }))} />
          <Filtro label="Estado" value={estado} onChange={setEstado} options={[{ value: "ACTIVE", label: "Activas" }, { value: "INACTIVE", label: "Inactivas" }]} />
        </>} />

      {nueva && (
        <SerieForm empresas={empresas} locales={locales} marcas={marcas}
          onClose={() => setNueva(false)} onGuardada={() => { setNueva(false); recargar(); }} />
      )}
      {viendo && (
        <SerieDetalle serie={viendo} puedeEditar={puedeEditar} onClose={() => setViendo(null)}
          onCambio={() => { setViendo(null); recargar(); }} />
      )}
    </div>
  );
}

/** Barra del uso del rango; pasa a ámbar desde el aviso. */
function Uso({ valor, aviso }: { valor: number; aviso: number }) {
  const alto = valor >= aviso;
  return (
    <div className="w-[120px]">
      <p className={`text-[12px] tabular-nums ${alto ? "font-semibold text-warn" : "text-muted"}`}>{porcentaje(valor, valor < 0.01 ? 4 : 1)}</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div className={`h-full rounded-full ${alto ? "bg-warn" : "bg-primary"}`} style={{ width: `${Math.max(valor, 1.5)}%` }} />
      </div>
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
