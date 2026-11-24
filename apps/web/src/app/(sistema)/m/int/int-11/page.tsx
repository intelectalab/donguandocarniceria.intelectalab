"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FileStack, HardDrive, ShieldAlert, Trash } from "lucide-react";
import { Badge, Button, Cifra, DataTable, Field, FiltroSelect, PageHeader, Select, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { Adjuntos, Clasificacion, tamano, useDescarga, type Archivo } from "@/modulos/int/Adjuntos";

type Lista = Pagina<Archivo> & {
  cifras: { activos: number; bytes: number; sensibles: number; eliminados: number };
  clasificaciones: Record<string, string>; registros: Record<string, string>; adjuntables: Record<string, string>;
  permitidos: string[]; max_mb: number; minutos: number;
};

/** Clasificación sugerida al adjuntar a cada tipo de registro (se puede cambiar). */
const SUGERIDA: Record<string, string> = { employees: "PERSONAL_DATA", payments: "CONFIDENTIAL", suppliers: "CONFIDENTIAL" };

/**
 * INT-11 Archivos adjuntos: todos los archivos de la empresa y el panel que usa cualquier ficha para adjuntar (subir con
 * archivo o cámara, descargar con enlace temporal y eliminar con motivo).
 */
export default function ArchivosAdjuntos() {
  const [f, setF] = useState({ buscar: "", entity: "", classification: "", status: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [registro, setRegistro] = useState("sales_orders");
  const [opciones, setOpciones] = useState<{ id: string; label: string }[]>([]);
  const [elegido, setElegido] = useState("");
  const pag = usePagina(JSON.stringify(f));
  const descarga = useDescarga();

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/int/archivos?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  useEffect(() => {
    let vivo = true;
    api<{ id: string; label: string }[]>(`/v1/int/archivos/registros?entity=${registro}`)
      .then((r) => { if (vivo) { setOpciones(r); setElegido(r[0]?.id ?? ""); } }).catch(() => vivo && setOpciones([]));
    return () => { vivo = false; };
  }, [registro]);

  const columnas: Column<Archivo>[] = [
    { key: "file_name", sortable: true, header: "Archivo", cardTitle: true, render: (a) => (
      <div className="min-w-0">
        <p className="truncate font-semibold text-ink" title={a.file_name}>{a.file_name}</p>
        <p className="font-mono text-[11.5px] text-muted" title={`SHA-256 ${a.sha256}`}>{a.sha256.slice(0, 16)}…</p>
      </div>
    ) },
    { key: "entity", sortable: true, header: "Registro", render: (a) => a.registro },
    { key: "size_bytes", sortable: true, header: "Tamaño", align: "right", render: (a) => tamano(a.size_bytes) },
    { key: "classification", sortable: true, header: "Clasificación", render: (a) => <Clasificacion a={a} /> },
    { key: "uploaded_at", sortable: true, header: "Subido", hideOnMobile: true, render: (a) => <span className="text-[12.5px]">{[a.uploaded_at ? fechaHora(a.uploaded_at) : null, a.uploaded_by].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "status", sortable: true, header: "Estado", render: (a) => (a.status === "ACTIVE" ? <Badge tone="ok" dot>Activo</Badge>
      : <span title={a.deleted_reason ? `${a.deleted_reason} · ${a.deleted_by ?? ""}` : ""}><Badge>Eliminado</Badge></span>) },
    { key: "acciones", header: "", align: "right", render: (a) => (a.status === "ACTIVE"
      ? <Button size="sm" icon={Download} onClick={(e) => { e.stopPropagation(); descarga.pedir(a); }}>Descargar</Button> : null) },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description={`Los archivos de la empresa: fotos de entrega, vouchers, comprobantes, documentos del personal. Se descargan con un enlace que vence a los ${lista?.minutos ?? 10} minutos (nunca hay una dirección pública) y los confidenciales piden permiso. Hasta ${lista?.max_mb ?? 20} MB por archivo.`} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Archivos activos" valor={numero(c.activos)} icono={FileStack} destacada />
          <Cifra titulo="Espacio usado" valor={tamano(c.bytes)} icono={HardDrive} />
          <Cifra titulo="Confidenciales o personales" valor={numero(c.sensibles)} icono={ShieldAlert} detalle="Descargarlos pide permiso" />
          <Cifra titulo="Eliminados" valor={numero(c.eliminados)} icono={Trash} detalle="Se depuran por retención" />
        </div>
      )}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
          empty="No hay archivos con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar por nombre del archivo…" }}
          toolbar={<>
            <FiltroSelect etiqueta="Registro" ancho={170} value={f.entity} onChange={(v) => setF({ ...f, entity: v })} options={Object.entries(lista?.registros ?? {}).map(([value, label]) => ({ value, label }))} />
            <FiltroSelect etiqueta="Clasificación" todos="todas" ancho={190} value={f.classification} onChange={(v) => setF({ ...f, classification: v })}
              options={Object.entries(lista?.clasificaciones ?? {}).map(([value, label]) => ({ value, label }))} />
            <FiltroSelect etiqueta="Estado" ancho={150} value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[{ value: "ACTIVE", label: "Activos" }, { value: "DELETED", label: "Eliminados" }]} />
          </>} />
        <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
          <div>
            <h2 className="text-[14px] font-semibold text-ink">Adjuntar a un registro</h2>
            <p className="text-[12.5px] text-muted">El mismo panel que aparece en la ficha de cada pedido, cobro o trabajador.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
            <Field label="Tipo de registro">
              <Select value={registro} onChange={(e) => setRegistro(e.target.value)} options={Object.entries(lista?.adjuntables ?? { sales_orders: "Pedido" }).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="Registro">
              <Select value={elegido} onChange={(e) => setElegido(e.target.value)} placeholder={opciones.length ? undefined : "No hay registros"}
                options={opciones.map((o) => ({ value: o.id, label: o.label }))} />
            </Field>
          </div>
          {elegido && <Adjuntos key={`${registro}|${elegido}`} entidad={registro} id={elegido} clasificacion={SUGERIDA[registro] ?? "INTERNAL"}
            camara={registro === "sales_orders"} permitidos={lista?.permitidos} maxMb={lista?.max_mb} onCambio={cargar} />}
        </section>
      </div>
      {descarga.modal}
    </div>
  );
}
