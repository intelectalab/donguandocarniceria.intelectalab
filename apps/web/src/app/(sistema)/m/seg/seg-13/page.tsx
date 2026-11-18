"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, ShieldCheck, XCircle } from "lucide-react";
import { Alert, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { ESTADOS_DISPOSITIVO, PLATAFORMAS } from "@/modulos/seg/tipos";

type Dispositivo = {
  id: string; user_id: string; user_name: string; email: string; roles_names: string | null; name: string; platform: string; status: string;
  fingerprint_hint: string; requested_at: string; approved_at: string | null; approved_by_name: string | null; revoked_at: string | null;
  revoke_reason: string | null; last_seen_at: string;
};
type Resumen = { pendientes: number; aprobados: number; revocados: number; aprobacion_exigida: boolean };

/**
 * SEG-13 Dispositivos de la app: celulares de repartidores y visitadores pendientes, aprobados y
 * revocados. La app solo inicia sesión desde un celular aprobado; revocarlo cierra sus sesiones al
 * instante. Nadie aprueba su propio celular.
 */
export default function DispositivosApp() {
  const router = useRouter();
  const { can } = useSesion();
  const [estado, setEstado] = useState("");
  const [plataforma, setPlataforma] = useState("");
  const lista = useListado<Dispositivo>("/v1/seg/dispositivos", { orden: "-requested_at", filtros: { status: estado, platform: plataforma } });
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [ocupado, setOcupado] = useState("");
  const puede = can("seg.device.approve");

  // Las cifras se piden de nuevo cada vez que la lista termina de cargar (al aprobar o revocar cambian).
  const cargando = lista.cargando;
  useEffect(() => {
    if (cargando) return;
    let vigente = true;
    api<{ resumen: Resumen }>("/v1/seg/dispositivos?per_page=1").then((r) => vigente && setResumen(r.resumen)).catch(() => {});
    return () => { vigente = false; };
  }, [cargando]);

  async function aprobar(d: Dispositivo) {
    if (!(await confirmAction({ title: `Aprobar ${d.name}`, message: `${d.user_name} ya podrá iniciar sesión en la app desde ese celular. Le llega un aviso.`, confirmLabel: "Aprobar" }))) return;
    await accion(d.id, `/v1/seg/dispositivos/${d.id}/aprobar`, undefined, "Celular aprobado: ya puede iniciar sesión");
  }

  async function revocar(d: Dispositivo) {
    const r = await confirmAction({ title: `Revocar ${d.name}`, message: "Sus sesiones se cierran en ese momento y ya no podrá iniciar sesión desde él.",
      confirmLabel: "Revocar", danger: true, reason: { min: 5, label: "Motivo (por ejemplo: celular perdido)" } });
    if (!r) return;
    await accion(d.id, `/v1/seg/dispositivos/${d.id}/revocar`, { reason: r.reason }, "Celular revocado");
  }

  async function accion(id: string, ruta: string, body: object | undefined, mensaje: string) {
    setOcupado(id);
    try {
      await api(ruta, { method: "POST", body });
      toast.ok(mensaje);
      lista.recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const r = resumen;
  const columnas: Column<Dispositivo>[] = [
    { key: "user_name", header: "Usuario", sortable: true, cardTitle: true, render: (d) => (
      <button type="button" onClick={() => router.push(`/m/seg/seg-09?id=${d.user_id}`)} className="cursor-pointer text-left font-semibold hover:text-primary hover:underline">{d.user_name}</button>
    ) },
    { key: "roles_names", header: "Rol", hideOnMobile: true, render: (d) => d.roles_names ?? "—" },
    { key: "name", header: "Dispositivo", sortable: true },
    { key: "platform", header: "Plataforma", render: (d) => PLATAFORMAS[d.platform] ?? d.platform },
    { key: "status", header: "Estado", sortable: true, render: (d) => <StatusBadge status={d.status} labels={ESTADOS_DISPOSITIVO} /> },
    { key: "requested_at", header: "Registrado", sortable: true, hideOnMobile: true, render: (d) => fechaHora(d.requested_at) },
    { key: "approved_by_name", header: "Aprobado por", hideOnMobile: true, render: (d) => d.approved_by_name ? `${d.approved_by_name} · ${fecha(d.approved_at)}` : <span className="text-muted">—</span> },
    { key: "revoke_reason", header: "Motivo de revocación", hideOnMobile: true, render: (d) => d.revoke_reason ?? <span className="text-muted">—</span> },
    { key: "last_seen_at", header: "Último uso", sortable: true, render: (d) => fechaHora(d.last_seen_at) },
    { key: "acciones", header: "", align: "right", render: (d) => puede && d.status !== "REVOKED" ? (
      <span className="flex justify-end gap-1.5">
        {d.status === "PENDING" && <Button size="sm" variant="primary" loading={ocupado === d.id} onClick={() => aprobar(d)}>Aprobar</Button>}
        <Button size="sm" loading={ocupado === d.id && d.status !== "PENDING"} onClick={() => revocar(d)}>Revocar</Button>
      </span>
    ) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Celulares de repartidores y visitadores pendientes, aprobados y revocados. La app solo inicia sesión desde un celular aprobado; revocarlo cierra sus sesiones al instante. Nadie aprueba su propio celular." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Por aprobar" valor={r ? numero(r.pendientes) : undefined} detalle={r?.pendientes ? "Esperan para entrar a la app" : "Ninguno pendiente"} icono={Clock} tono={r?.pendientes ? "warn" : "ok"} destacada />
        <Cifra titulo="Aprobados" valor={r ? numero(r.aprobados) : undefined} detalle="Pueden iniciar sesión" icono={CheckCircle2} />
        <Cifra titulo="Revocados" valor={r ? numero(r.revocados) : undefined} detalle="Ya no entran a la app" icono={XCircle} />
        <Cifra titulo="Aprobación exigida" valor={r ? (r.aprobacion_exigida ? "Sí" : "No") : undefined} detalle="Solo la app pide celular aprobado" icono={ShieldCheck} />
      </div>

      {!puede && <Alert tone="info">Puedes ver los celulares; aprobarlos o revocarlos exige su permiso.</Alert>}

      <DataTable {...lista.tabla} columns={columnas} empty="No hay celulares con esos filtros."
        search={{ ...lista.tabla.search, placeholder: "Buscar usuario, correo, rol o celular…" }}
        toolbar={<>
          <div className="w-full sm:w-[160px]">
            <Select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Estado: todos"
              options={Object.entries(ESTADOS_DISPOSITIVO).map(([value, [label]]) => ({ value, label }))} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
          <div className="w-full sm:w-[160px]">
            <Select aria-label="Plataforma" value={plataforma} onChange={(e) => setPlataforma(e.target.value)} placeholder="Plataforma: todas"
              options={[{ value: "ANDROID", label: "Android" }, { value: "IOS", label: "iPhone" }]} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
        </>} />
    </div>
  );
}
