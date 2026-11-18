"use client";

import { useEffect, useState } from "react";
import { LogOut, MonitorSmartphone, Smartphone, Users } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, PageHeader, Select, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { clienteDe, textoPolitica, type PoliticaSesiones, type SesionEmpresa } from "@/modulos/seg/tipos";

type Extra = {
  resumen: { sesiones: number; usuarios: number; moviles: number }; politica: PoliticaSesiones;
  usuarios: { id: string; name: string }[]; roles: { code: string; name: string }[];
};

/** SEG-15 Sesiones activas de la empresa: todas las sesiones abiertas por usuario, dispositivo e IP; cerrar una o todas las de un usuario. */
export default function SesionesEmpresa() {
  const { can } = useSesion();
  const [usuario, setUsuario] = useState("");
  const [cliente, setCliente] = useState("");
  const [rol, setRol] = useState("");
  const lista = useListado<SesionEmpresa>("/v1/seg/sesiones", { orden: "-last_used_at", filtros: { user_id: usuario, client: cliente, role: rol } });
  const [extra, setExtra] = useState<Extra | null>(null);
  const [ocupado, setOcupado] = useState("");
  const puedeCerrar = can("seg.session.revoke");

  // Cifras y política: se piden de nuevo cada vez que la lista termina de cargar (al cerrar sesiones, cambian).
  const cargando = lista.cargando;
  useEffect(() => {
    if (cargando) return;
    let vigente = true;
    api<Extra>("/v1/seg/sesiones?per_page=1").then((r) => vigente && setExtra(r)).catch(() => {});
    return () => { vigente = false; };
  }, [cargando]);

  async function cerrar(s: SesionEmpresa, todas: boolean) {
    const ok = await confirmAction(todas
      ? { title: `Cerrar las sesiones de ${s.user_name}`, message: "Tendrá que iniciar sesión de nuevo en todos sus equipos.", confirmLabel: "Cerrar todas", danger: true }
      : { title: "Cerrar esta sesión", message: `${s.user_name} tendrá que iniciar sesión de nuevo en ese equipo.`, confirmLabel: "Cerrar", danger: true });
    if (!ok) return;
    setOcupado(s.id + (todas ? "-t" : ""));
    try {
      const r = await api<{ cerradas: number }>(todas ? `/v1/seg/usuarios/${s.user_id}/sesiones` : `/v1/seg/sesiones/${s.id}`, { method: "DELETE" });
      toast.ok(r.cerradas === 1 ? "1 sesión cerrada" : `${r.cerradas} sesiones cerradas`);
      lista.recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const r = extra?.resumen;
  const columnas: Column<SesionEmpresa>[] = [
    { key: "user_name", header: "Usuario", sortable: true, cardTitle: true, render: (s) => (
      <div className="min-w-0">
        <p className="font-semibold">{s.user_name} {s.actual && <Badge tone="info">Esta sesión</Badge>}</p>
        <p className="truncate font-mono text-[12px] text-muted">{s.email}</p>
      </div>
    ) },
    { key: "client", header: "Cliente", render: (s) => clienteDe(s.client) },
    { key: "device", header: "Dispositivo", hideOnMobile: true, render: (s) => s.device ?? <span className="text-muted">Sin dato</span> },
    { key: "ip", header: "IP", hideOnMobile: true, render: (s) => s.ip ? <span className="font-mono text-[12.5px]">{s.ip}</span> : <span className="text-muted">—</span> },
    { key: "created_at", header: "Inicio", sortable: true, hideOnMobile: true, render: (s) => fechaHora(s.created_at) },
    { key: "last_used_at", header: "Última actividad", sortable: true, render: (s) => fechaHora(s.last_used_at) },
    { key: "expires_at", header: "Vence", sortable: true, hideOnMobile: true, render: (s) => s.expires_at ? fechaHora(s.expires_at) : <span className="text-muted">No vence</span> },
    { key: "acciones", header: "", align: "right", render: (s) => puedeCerrar && !s.actual ? (
      <span className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" loading={ocupado === s.id} onClick={() => cerrar(s, false)}>Cerrar</Button>
        {s.sesiones_usuario > 1 && <Button size="sm" variant="ghost" icon={LogOut} loading={ocupado === `${s.id}-t`} onClick={() => cerrar(s, true)}>Todas del usuario</Button>}
      </span>
    ) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={extra ? `Todas las sesiones abiertas por usuario, dispositivo e IP. ${textoPolitica(extra.politica)}` : "Todas las sesiones abiertas por usuario, dispositivo e IP."} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Cifra titulo="Sesiones abiertas" valor={r ? numero(r.sesiones) : undefined} detalle="En toda la empresa" icono={MonitorSmartphone} destacada />
        <Cifra titulo="Usuarios conectados" valor={r ? numero(r.usuarios) : undefined} detalle="Con al menos una sesión" icono={Users} />
        <Cifra titulo="App móvil" valor={r ? numero(r.moviles) : undefined} detalle="Celulares de reparto y visitas" icono={Smartphone} />
      </div>

      {!puedeCerrar && <Alert tone="info">Puedes ver las sesiones; cerrarlas exige su permiso.</Alert>}

      <DataTable {...lista.tabla} columns={columnas} empty="No hay sesiones abiertas con esos filtros."
        search={{ ...lista.tabla.search, placeholder: "Buscar usuario, correo, IP o dispositivo…" }}
        toolbar={<>
          <div className="w-full sm:w-[200px]">
            <Select aria-label="Usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Usuario: todos"
              options={(extra?.usuarios ?? []).map((u) => ({ value: u.id, label: u.name }))} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
          <div className="w-full sm:w-[190px]">
            <Select aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)} placeholder="Rol: todos"
              options={(extra?.roles ?? []).map((x) => ({ value: x.code, label: x.name }))} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
          <div className="w-full sm:w-[150px]">
            <Select aria-label="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} placeholder="Cliente: todos"
              options={[{ value: "web", label: "Web" }, { value: "android", label: "App android" }, { value: "ios", label: "App ios" }]} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
        </>} />
    </div>
  );
}
