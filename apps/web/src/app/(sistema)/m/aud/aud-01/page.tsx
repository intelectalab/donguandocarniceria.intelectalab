"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, History, Table2, Users } from "lucide-react";
import { Alert, Checkbox, Cifra, DataTable, DetailList, FiltroFecha, FiltroSelect, Modal, PageHeader, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Accion, Diferencias, fechaHoraSeg, type Cambio } from "@/modulos/aud/comunes";

type Opcion = { value: string; label: string };
type Lista = Pagina<Cambio> & {
  cifras: { total: number; usuarios: number; tablas: number; hoy: number }; desde: string; hasta: string; revelado: boolean; puede_revelar: boolean;
  tablas: Opcion[]; usuarios: Opcion[]; acciones: Record<string, string>;
};

/**
 * AUD-01 Consulta de cambios: quién cambió qué y cuándo, con el antes y el después campo por campo, en hora de Lima.
 * Nadie la puede modificar ni borrar. Los secretos se ven como «***» y los datos personales, enmascarados.
 */
export default function ConsultaDeCambios() {
  const { can } = useSesion();
  const [f, setF] = useState({ tabla: "", usuario: "", accion: "", desde: "", hasta: "" });
  const [revelar, setRevelar] = useState(false);
  const [sistema, setSistema] = useState(false);
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<Cambio | null>(null);
  const pag = usePagina(JSON.stringify({ ...f, revelar, sistema }));

  const permitido = Boolean(can("aud.change_log.view"));
  const cargar = useCallback(() => {
    if (!permitido) return;   // sin permiso no se pide (cada intento quedaría como acceso denegado)
    const q = new URLSearchParams(Object.entries({ ...f, revelar: revelar ? "1" : "", sistema: sistema ? "1" : "" }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/aud/cambios?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, revelar, sistema, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) {
    return (
      <Alert tone="warn" title="La consulta completa de cambios es solo para administración del sistema, gerencia y auditoría">
        Puedes ver la historia de un registro en <Link href="/m/aud/aud-02" className="font-medium underline">Historia del registro</Link>.
      </Alert>
    );
  }

  const columnas: Column<Cambio>[] = [
    { key: "changed_at", sortable: true, header: "Fecha y hora (Lima)", render: (c) => <span className="whitespace-nowrap tabular-nums">{fechaHoraSeg(c.changed_at)}</span> },
    { key: "usuario", sortable: true, header: "Usuario", cardTitle: true, render: (c) => (
      <div className="min-w-0"><p className="font-semibold text-ink">{c.usuario}</p>{c.rol && <p className="text-[12px] text-muted">{c.rol}</p>}</div>
    ) },
    { key: "accion", sortable: true, header: "Operación", render: (c) => <Accion c={c} /> },
    { key: "tabla", sortable: true, header: "Tabla", render: (c) => c.tabla_nombre },
    { key: "registro", header: "Registro", render: (c) => <span className="font-mono text-[12px]">{c.registro ?? (c.row_id ? `${c.row_id.slice(0, 8)}…` : "—")}</span> },
    { key: "cambios", header: "Antes → después", hideOnMobile: true, render: (c) => <div className="max-w-[460px]"><Diferencias c={c} max={3} /></div> },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Quién cambió qué y cuándo: la operación y el antes y el después campo por campo, en hora de Lima. La bitácora la llena la base de datos sola y nadie la puede modificar ni borrar." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Cambios en el filtro" valor={numero(c.total)} icono={History} destacada />
          <Cifra titulo="Usuarios distintos" valor={numero(c.usuarios)} icono={Users} />
          <Cifra titulo="Tablas" valor={numero(c.tablas)} icono={Table2} />
          <Cifra titulo="Hoy" valor={numero(c.hoy)} icono={CalendarDays} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px] text-muted">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Checkbox checked={sistema} onChange={setSistema} label="Incluir la carga inicial y los procesos automáticos" hint="Por defecto se ven solo los cambios de las personas." />
          {lista?.puede_revelar && <Checkbox checked={revelar} onChange={setRevelar} label="Mostrar datos personales" hint="Queda en la bitácora de accesos." />}
        </div>
        <span>Los secretos se ven siempre como «***».{lista ? ` Del ${lista.desde.split("-").reverse().join("/")} al ${lista.hasta.split("-").reverse().join("/")}.` : ""}</span>
      </div>
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} rowKey={(x) => String(x.id)} pagination={pag.props(lista)} loading={!lista && !error} error={error}
        onRetry={cargar} onRowClick={setAbierto} empty="No hay cambios con estos filtros."
        toolbar={<>
          <FiltroSelect etiqueta="Tabla" todos="todas" ancho={200} value={f.tabla} onChange={(v) => setF({ ...f, tabla: v })} options={lista?.tablas ?? []} />
          <FiltroSelect etiqueta="Usuario" ancho={200} value={f.usuario} onChange={(v) => setF({ ...f, usuario: v })}
            options={[{ value: "SISTEMA", label: "Sistema (carga inicial y procesos)" }, ...(lista?.usuarios ?? [])]} />
          <FiltroSelect etiqueta="Operación" todos="todas" ancho={170} value={f.accion} onChange={(v) => setF({ ...f, accion: v })}
            options={Object.entries(lista?.acciones ?? {}).map(([value, label]) => ({ value, label }))} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      {abierto && <DetalleCambio id={abierto.id} revelar={revelar} onClose={() => setAbierto(null)} />}
    </div>
  );
}

function DetalleCambio({ id, revelar, onClose }: { id: number; revelar: boolean; onClose: () => void }) {
  const [c, setC] = useState<Cambio | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let vivo = true;
    api<Cambio>(`/v1/aud/cambios/${id}${revelar ? "?revelar=1" : ""}`).then((r) => vivo && setC(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [id, revelar]);
  return (
    <Modal open onClose={onClose} size="lg" title={c ? `${c.accion_nombre} · ${c.tabla_nombre}` : "Cambio"}
      footer={c?.row_id ? <Link href={`/m/aud/aud-02?tabla=${c.tabla}&id=${c.row_id}`} className="inline-flex min-h-10 items-center rounded-[9px] border border-line px-4 text-[13.5px] font-semibold text-ink hover:border-primary">Ver historia del registro</Link> : undefined}>
      {error && <Alert tone="bad">{error}</Alert>}
      {c && (
        <div className="grid gap-5">
          <DetailList items={[
            { label: "Fecha y hora", value: `${fechaHoraSeg(c.changed_at)} (hora de Lima)` },
            { label: "Usuario", value: c.rol ? `${c.usuario} · ${c.rol}` : c.usuario },
            { label: "Operación", value: <Accion c={c} /> },
            { label: "Tabla", value: c.tabla_nombre },
            { label: "Registro", value: c.registro ?? "—" },
            { label: "Identificador", value: <span className="font-mono text-[12px] break-all">{c.row_id ?? "—"}</span> },
          ]} />
          <section className="grid gap-2">
            <h3 className="text-[14px] font-semibold text-ink">Campo por campo</h3>
            <Diferencias c={c} />
          </section>
        </div>
      )}
    </Modal>
  );
}
