"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { ESTADOS_DISPOSITIVO, ESTADOS_SESION, PLATAFORMAS, clienteDe, textoPolitica, type MiDispositivo, type MiSesion, type PoliticaSesiones } from "@/modulos/seg/tipos";

type Datos = { sesiones: MiSesion[]; anteriores: MiSesion[]; dispositivos: MiDispositivo[]; ultimo_ingreso: string | null; politica: PoliticaSesiones };

/**
 * Mis sesiones y dispositivos (SEG-07): mis sesiones abiertas con su dispositivo, IP y última
 * actividad, las anteriores y mis celulares registrados. Va en SEG-07 y dentro de Mi cuenta (SEG-06),
 * que ve cualquier persona. «compacto»: sin cifras y con un título de sección en vez del encabezado.
 */
export function MisSesiones({ compacto = false }: { compacto?: boolean }) {
  const [d, setD] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");

  const cargar = useCallback(() => {
    api<Datos>("/v1/seg/mis-sesiones").then(setD).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function cerrar(id: string | null) {
    const ok = await confirmAction(id
      ? { title: "Cerrar esta sesión", message: "Ese equipo tendrá que iniciar sesión de nuevo.", confirmLabel: "Cerrar", danger: true }
      : { title: "Cerrar todas las demás", message: "Se cierran tus sesiones de otros equipos. Esta sesión sigue abierta.", confirmLabel: "Cerrar las demás", danger: true });
    if (!ok) return;
    setOcupado(id ?? "todas");
    try {
      const r = await api<{ cerradas: number }>(id ? `/v1/seg/mis-sesiones/${id}` : "/v1/seg/mis-sesiones", { method: "DELETE" });
      toast.ok(r.cerradas === 1 ? "1 sesión cerrada" : `${r.cerradas} sesiones cerradas`);
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const otras = (d?.sesiones ?? []).filter((s) => !s.actual).length;
  const colSesion: Column<MiSesion>[] = [
    { key: "client", header: "Cliente", cardTitle: true, render: (s) => (
      <span className="flex flex-wrap items-center gap-1.5">{clienteDe(s.client)}{s.actual && <Badge tone="info">Esta sesión</Badge>}</span>
    ) },
    { key: "device", header: "Dispositivo", render: (s) => s.device ?? <span className="text-muted">Sin dato</span> },
    { key: "ip", header: "IP", hideOnMobile: true, render: (s) => s.ip ? <span className="font-mono text-[12.5px]">{s.ip}</span> : <span className="text-muted">—</span> },
    { key: "created_at", header: "Inicio", hideOnMobile: true, render: (s) => fechaHora(s.created_at) },
    { key: "last_used_at", header: "Última actividad", render: (s) => s.last_used_at ? fechaHora(s.last_used_at) : <span className="text-muted">—</span> },
    { key: "expires_at", header: "Vence", hideOnMobile: true, render: (s) => s.expires_at ? fechaHora(s.expires_at) : <span className="text-muted">No vence</span> },
    { key: "acciones", header: "", align: "right", render: (s) => !s.actual ? (
      <Button size="sm" variant="ghost" loading={ocupado === s.id} onClick={() => cerrar(s.id)}>Cerrar</Button>
    ) : null },
  ];
  // Anteriores: como el prototipo, con su estado; el motivo del cierre debajo.
  const colAnterior: Column<MiSesion>[] = [
    { key: "client", header: "Cliente", cardTitle: true, render: (s) => clienteDe(s.client) },
    { key: "device", header: "Dispositivo", render: (s) => s.device ?? <span className="text-muted">Sin dato</span> },
    { key: "ip", header: "IP", hideOnMobile: true, render: (s) => s.ip ? <span className="font-mono text-[12.5px]">{s.ip}</span> : <span className="text-muted">—</span> },
    { key: "created_at", header: "Inicio", hideOnMobile: true, render: (s) => fechaHora(s.created_at) },
    { key: "last_used_at", header: "Última actividad", render: (s) => s.last_used_at ? fechaHora(s.last_used_at) : <span className="text-muted">—</span> },
    { key: "expires_at", header: "Vence", hideOnMobile: true, render: (s) => s.expires_at ? fechaHora(s.expires_at) : <span className="text-muted">—</span> },
    { key: "estado", header: "Estado", render: (s) => (
      <div className="min-w-0">
        <StatusBadge status={s.estado} labels={ESTADOS_SESION} />
        {s.motivo && <p className="mt-0.5 text-[12px] text-muted">{s.motivo}{s.cerrada_en ? ` · ${fechaHora(s.cerrada_en)}` : ""}</p>}
      </div>
    ) },
  ];
  const colDispositivo: Column<MiDispositivo>[] = [
    { key: "name", header: "Dispositivo", cardTitle: true },
    { key: "platform", header: "Plataforma", render: (x) => PLATAFORMAS[x.platform] ?? x.platform },
    { key: "status", header: "Estado", render: (x) => <StatusBadge status={x.status} labels={ESTADOS_DISPOSITIVO} /> },
    { key: "approved_by_name", header: "Aprobado por", hideOnMobile: true, render: (x) => x.approved_by_name ? `${x.approved_by_name} · ${fecha(x.approved_at)}` : <span className="text-muted">—</span> },
    { key: "last_seen_at", header: "Último uso", render: (x) => fechaHora(x.last_seen_at) },
  ];

  const descripcion = d ? `Tus sesiones abiertas con su dispositivo, IP y última actividad. ${textoPolitica(d.politica)}` : "Tus sesiones abiertas con su dispositivo, IP y última actividad.";
  const cerrarDemas = otras > 0 && <Button variant="danger" size={compacto ? "sm" : "md"} icon={LogOut} loading={ocupado === "todas"} onClick={() => cerrar(null)}>Cerrar todas las demás</Button>;

  return (
    <div className="space-y-5">
      {compacto ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold">Mis sesiones y dispositivos</h2>
            <p className="text-[13px] text-muted">{descripcion}</p>
          </div>
          {cerrarDemas}
        </div>
      ) : <PageHeader description={descripcion} actions={cerrarDemas} />}
      {error && <Alert tone="bad">{error}</Alert>}

      {!compacto && <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Abiertas" valor={d ? numero(d.sesiones.length) : undefined} detalle={d ? `De ${d.politica.max_sesiones} permitidas` : undefined} icono={MonitorSmartphone} destacada
          tono={d && d.sesiones.length > d.politica.max_sesiones ? "bad" : undefined} />
        <Cifra titulo="Dispositivos" valor={d ? numero(d.dispositivos.length) : undefined} detalle={d ? `${d.dispositivos.filter((x) => x.status === "APPROVED").length} aprobados` : undefined} icono={Smartphone} />
        <Cifra titulo="Último ingreso" valor={d ? (d.ultimo_ingreso ? fechaHora(d.ultimo_ingreso) : "Nunca") : undefined} icono={Clock} />
      </div>}

      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Sesiones</h2>
        <DataTable rows={d?.sesiones ?? []} rowKey={(s) => s.id} columns={colSesion} loading={!d && !error} empty="Sin sesiones abiertas." />
        {d?.sesiones.some((s) => !s.ip) && <p className="text-[12.5px] text-muted">Las sesiones sin dispositivo ni IP se abrieron antes de que el sistema empezara a anotarlos.</p>}
      </section>
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Sesiones anteriores</h2>
        <DataTable rows={d?.anteriores ?? []} rowKey={(s) => s.id} columns={colAnterior} loading={!d && !error}
          empty="Sin sesiones anteriores registradas. Se guardan desde que el sistema empezó a archivarlas." />
      </section>
      <section className="space-y-2">
        <h2 className="text-[14px] font-semibold">Dispositivos registrados</h2>
        <DataTable rows={d?.dispositivos ?? []} rowKey={(x) => x.id} columns={colDispositivo} loading={!d && !error}
          empty="No registraste celulares de la app. Las sesiones desde el navegador no registran dispositivo." />
      </section>
    </div>
  );
}
