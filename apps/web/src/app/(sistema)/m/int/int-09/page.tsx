"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellRing, CheckCheck, Inbox, Settings2 } from "lucide-react";
import { Button, Cifra, DataTable, FiltroSelect, PageHeader, StatusBadge, Tabs, toast, type Column, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { usePagina, type Pagina } from "@/lib/paginas";
import { nombreModulo } from "@/modulos/int/tipos";

type Aviso = {
  id: string; title: string; body: string; module: string | null; tone: string; type: string | null; type_name: string; severity: string; severity_name: string;
  read: boolean; at: string; mia: boolean; destino: string | null; link: string | null;
};
type Lista = Pagina<Aviso> & { cifras: { sin_leer: number; criticas: number; recibidas_30: number }; ve_todas: boolean; tipos: Record<string, string>; severidades: Record<string, string> };

const SEVERIDAD: Record<string, [string, Tone]> = { CRITICAL: ["Crítica", "bad"], WARNING: ["Advertencia", "warn"], INFO: ["Información", "info"], OK: ["Correcto", "ok"] };

/**
 * INT-09 Centro de notificaciones: los avisos de la persona (suyos y de su rol) con su severidad y el enlace al registro.
 * Respetan sus preferencias, salvo los críticos, que llegan siempre. Gerencia, administración del sistema y auditoría
 * ven también todas las de la empresa, con su destinatario.
 */
export default function CentroNotificaciones() {
  const router = useRouter();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [f, setF] = useState({ buscar: "", severidad: "", tipo: "", lectura: "" });
  const [buscar, setBuscar] = useState("");
  const [lista, setLista] = useState<Lista | null>(null);
  const [error, setError] = useState("");
  const pag = usePagina(JSON.stringify({ ...f, scope }));

  useEffect(() => {
    const t = setTimeout(() => setF((x) => (x.buscar === buscar.trim() ? x : { ...x, buscar: buscar.trim() })), 350);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries({ ...f, scope, lectura: scope === "all" ? "" : f.lectura }).filter(([, v]) => v)).toString();
    api<Lista>(`/v1/int/notificaciones?${q}&${pag.qs}`).then((r) => { setLista(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f, scope, pag.qs]);
  useEffect(() => cargar(), [cargar]);

  async function marcar(n: Aviso, leida: boolean) {
    try {
      await api(`/v1/int/notificaciones/${n.id}/leida`, { method: "POST", body: { leida } });
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  async function todas() {
    try {
      const r = await api<{ marcadas: number }>("/v1/int/notificaciones/leer-todas", { method: "POST" });
      toast.ok(r.marcadas ? `${r.marcadas} ${r.marcadas === 1 ? "notificación marcada" : "notificaciones marcadas"} como leídas` : "No había notificaciones sin leer");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }
  /** Abrir: la marca como leída (si es suya) y va al registro que la originó. */
  async function abrir(n: Aviso) {
    if (n.mia && !n.read) await marcar(n, true);
    if (n.link) router.push(n.link);
  }

  const columnas: Column<Aviso>[] = [
    { key: "leida", header: "", render: (n) => (n.read || !n.mia ? <span className="sr-only">Leída</span>
      : <span title="Sin leer" className="inline-block size-2.5 rounded-full bg-primary" aria-label="Sin leer" />) },
    { key: "at", sortable: true, header: "Fecha", render: (n) => <span className="whitespace-nowrap">{fechaHora(n.at)}</span> },
    { key: "severidad", sortable: true, header: "Severidad", render: (n) => <StatusBadge status={n.severity} labels={SEVERIDAD} /> },
    { key: "title", sortable: true, header: "Aviso", cardTitle: true, render: (n) => (
      <div className="min-w-0 max-w-[520px]">
        <p className={`text-ink ${n.read || !n.mia ? "font-medium" : "font-semibold"}`}>{n.title}</p>
        <p className="text-[12.5px] text-muted">{n.body}</p>
      </div>
    ) },
    { key: "type", sortable: true, header: "Tipo", hideOnMobile: true, render: (n) => n.type_name },
    { key: "module", sortable: true, header: "Módulo", hideOnMobile: true, render: (n) => (n.module ? nombreModulo(n.module) : "—") },
    ...(scope === "all" ? [{ key: "destino", header: "Destinatario", render: (n: Aviso) => n.destino ?? "—" }] : []),
    { key: "acciones", header: "", align: "right", render: (n) => (
      <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {n.mia && <Button size="sm" variant="ghost" onClick={() => marcar(n, !n.read)}>{n.read ? "No leída" : "Leída"}</Button>}
        {n.link && <Button size="sm" variant="ghost" onClick={() => abrir(n)}>Abrir ›</Button>}
      </div>
    ) },
  ];

  const c = lista?.cifras;
  return (
    <div className="grid gap-5">
      <PageHeader description="Tus avisos con su severidad y el enlace al registro que los originó. Solo llegan a quien van dirigidos y respetan tus preferencias, salvo los críticos, que llegan siempre."
        actions={<>
          <Button icon={Settings2} onClick={() => router.push("/m/int/int-10")}>Preferencias</Button>
          <Button variant="primary" icon={CheckCheck} onClick={todas}>Marcar todas como leídas</Button>
        </>} />
      {c && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Cifra titulo="Sin leer" valor={numero(c.sin_leer)} icono={Bell} destacada />
          <Cifra titulo="Críticas sin leer" valor={numero(c.criticas)} icono={BellRing} tono={c.criticas ? "bad" : "ok"} detalle={c.criticas ? "Atiéndelas primero" : "Ninguna"} />
          <Cifra titulo="Recibidas en 30 días" valor={numero(c.recibidas_30)} icono={Inbox} />
        </div>
      )}
      {lista?.ve_todas && (
        <Tabs value={scope} onChange={setScope} tabs={[{ key: "mine", label: "Mis notificaciones" }, { key: "all", label: "Todas (por destinatario)" }]} />
      )}
      <DataTable {...pag.orden} columns={columnas} rows={lista?.data ?? []} pagination={pag.props(lista)} loading={!lista && !error} error={error} onRetry={cargar}
        onRowClick={(n) => abrir(n)} empty={scope === "mine" ? "No tienes notificaciones con estos filtros." : "No hay notificaciones con estos filtros."}
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar en el aviso…" }}
        toolbar={<>
          <FiltroSelect etiqueta="Severidad" todos="todas" ancho={170} value={f.severidad} onChange={(v) => setF({ ...f, severidad: v })}
            options={Object.entries(lista?.severidades ?? {}).map(([value, label]) => ({ value, label }))} />
          <FiltroSelect etiqueta="Tipo" ancho={200} value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} options={Object.entries(lista?.tipos ?? {}).map(([value, label]) => ({ value, label }))} />
          {scope === "mine" && (
            <FiltroSelect etiqueta="Lectura" todos="todas" ancho={150} value={f.lectura} onChange={(v) => setF({ ...f, lectura: v })}
              options={[{ value: "U", label: "Sin leer" }, { value: "R", label: "Leídas" }]} />
          )}
        </>} />
    </div>
  );
}
