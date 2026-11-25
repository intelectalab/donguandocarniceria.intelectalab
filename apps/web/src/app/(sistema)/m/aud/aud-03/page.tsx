"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, LockKeyhole, LogIn, ShieldAlert } from "lucide-react";
import { Alert, Badge, Cifra, DataTable, FiltroFecha, FiltroSelect, PageHeader, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { fechaHoraSeg } from "@/modulos/aud/comunes";

type Opcion = { value: string; label: string };
type Acceso = {
  id: string; at: string; user_id: string | null; user_name: string; email: string | null; rol: string | null; event: string; event_name: string; tono: Tone;
  result: "OK" | "DENIED"; ip: string; device: string; session_id: string | null; detalle: string | null;
};
type Semana = { semana: string; user_id: string | null; usuario: string; rol_nombre: string | null; sin_permiso: number; modulo_apagado: number; total: number };
type Lista = Pagina<Acceso> & {
  cifras: { ingresos_hoy: number; fallidos_7: number; bloqueos_7: number; denegados_7: number }; semanas: Semana[];
  desde: string; hasta: string; eventos: Opcion[]; usuarios: Opcion[];
};

/**
 * AUD-03 Bitácora de accesos: ingresos correctos y fallidos, segundo factor, bloqueos, cierres de sesión,
 * recuperaciones y accesos denegados, con usuario, IP y dispositivo. Solo se agregan filas: nadie la cambia.
 */
export default function BitacoraDeAccesos() {
  const { can } = useSesion();
  const permitido = Boolean(can("aud.access_log.view"));
  const [f, setF] = useState({ evento: "", usuario: "", resultado: "", desde: "", hasta: "", buscar: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify(f));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 400);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    if (!permitido) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/aud/accesos?${q}${q ? "&" : ""}${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, pag.qs, permitido]);
  useEffect(() => cargar(), [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no consulta la bitácora de accesos.</Alert>;

  const columnas: Column<Acceso>[] = [
    { key: "at", sortable: true, header: "Fecha y hora (Lima)", render: (x) => <span className="whitespace-nowrap tabular-nums">{fechaHoraSeg(x.at)}</span> },
    { key: "user_name", sortable: true, header: "Usuario", cardTitle: true, render: (x) => (
      <div className="min-w-0"><p className="font-semibold text-ink">{x.user_name}</p><p className="text-[12px] text-muted">{x.rol ?? x.email ?? ""}</p></div>
    ) },
    { key: "event", sortable: true, header: "Evento", render: (x) => <Badge tone={x.tono} dot>{x.event_name}</Badge> },
    { key: "ip", sortable: true, header: "IP", render: (x) => <span className="font-mono text-[12px]">{x.ip}</span> },
    { key: "device", sortable: true, header: "Dispositivo", hideOnMobile: true, render: (x) => <span className="text-[12.5px]">{x.device}</span> },
    { key: "detalle", header: "Detalle", hideOnMobile: true, render: (x) => <span className="text-[12.5px] text-muted">{x.detalle ?? ""}</span> },
  ];
  const colSemanas: Column<Semana>[] = [
    { key: "semana", header: "Semana del", render: (s) => fecha(s.semana) },
    { key: "usuario", header: "Usuario", cardTitle: true, render: (s) => <span className="font-semibold text-ink">{s.usuario}</span> },
    { key: "rol", header: "Rol", render: (s) => s.rol_nombre ?? "—" },
    { key: "sin_permiso", header: "Sin permiso", align: "right", render: (s) => s.sin_permiso },
    { key: "modulo_apagado", header: "Módulo apagado", align: "right", render: (s) => s.modulo_apagado },
    { key: "total", header: "Total", align: "right", render: (s) => <b>{s.total}</b> },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Cada ingreso, correcto o fallido, el segundo factor, los bloqueos, los cierres de sesión, las recuperaciones de contraseña y los accesos denegados, con la persona, la IP y el dispositivo. Solo se agregan filas: nadie la puede cambiar ni borrar." />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cifra titulo="Ingresos hoy" valor={numero(c.ingresos_hoy)} icono={LogIn} destacada />
          <Cifra titulo="Ingresos fallidos" valor={numero(c.fallidos_7)} icono={ShieldAlert} tono={c.fallidos_7 ? "warn" : undefined} detalle="Últimos 7 días, con el segundo factor" />
          <Cifra titulo="Bloqueos" valor={numero(c.bloqueos_7)} icono={LockKeyhole} tono={c.bloqueos_7 ? "bad" : "ok"} detalle="Últimos 7 días" />
          <Cifra titulo="Accesos denegados" valor={numero(c.denegados_7)} icono={Ban} tono={c.denegados_7 > 5 ? "warn" : undefined} detalle="Últimos 7 días · sin permiso o módulo apagado" />
        </div>
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        empty="No hay accesos con estos filtros." search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar persona, detalle o IP…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Evento" ancho={210} value={f.evento} onChange={(v) => setF({ ...f, evento: v })} options={lista?.eventos ?? []} />
          <FiltroSelect etiqueta="Usuario" ancho={200} value={f.usuario} onChange={(v) => setF({ ...f, usuario: v })} options={lista?.usuarios ?? []} />
          <FiltroSelect etiqueta="Resultado" ancho={160} value={f.resultado} onChange={(v) => setF({ ...f, resultado: v })}
            options={[{ value: "OK", label: "Correctos" }, { value: "DENIED", label: "Denegados" }]} />
          <FiltroFecha etiqueta="Desde" visible value={f.desde} max={f.hasta || undefined} onChange={(v) => setF({ ...f, desde: v })} />
          <FiltroFecha etiqueta="Hasta" visible value={f.hasta} min={f.desde || undefined} onChange={(v) => setF({ ...f, hasta: v })} />
        </>} />
      <section className="grid gap-2">
        <h2 className="text-[14px] font-semibold text-ink">Accesos denegados por usuario y semana</h2>
        <p className="text-[12.5px] text-muted">En el período elegido{lista ? ` (del ${fecha(lista.desde)} al ${fecha(lista.hasta)})` : ""}. Muchos intentos sin permiso pueden indicar un rol mal asignado o alguien probando pantallas.</p>
        <DataTable columns={colSemanas} rows={lista?.semanas ?? []} rowKey={(s) => `${s.semana}|${s.user_id}`} loading={!lista && !error} empty="Ningún acceso denegado en el período." />
      </section>
    </div>
  );
}
