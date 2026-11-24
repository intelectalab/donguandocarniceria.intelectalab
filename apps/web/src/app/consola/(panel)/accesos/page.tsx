"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Ban, KeyRound, LogIn, Plus, XCircle } from "lucide-react";
import { Alert, Button, DataTable, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { Alcance, ContenidoAcceso, ESTADOS_ACCESO, quedan, type Acceso, type AccesoDetalle } from "@/components/soporte/AccesosEmpresa";
import { PedirAcceso, entrarConAcceso } from "@/components/consola/PedirAcceso";
import { useUsuarioConsola } from "@/components/consola/sesion";
import { mensajeDe } from "@/lib/api";
import { apiConsola } from "@/lib/consola";
import { fechaHora } from "@/lib/formato";

/** Accesos de soporte: los pedidos a las empresas, su estado y la entrada a la empresa con el acceso aprobado. */
export default function AccesosSoporte() {
  return <Suspense><Contenido /></Suspense>;
}

function Contenido() {
  const yo = useUsuarioConsola();
  const router = useRouter();
  const abierto = useSearchParams().get("acceso");
  const [f, setF] = useState({ status: "ABIERTOS", tenant: "" });
  const [filas, setFilas] = useState<Acceso[] | null>(null);
  const [empresas, setEmpresas] = useState<{ id: string; short: string }[]>([]);
  const [error, setError] = useState("");
  const [pedir, setPedir] = useState(false);

  const cargar = useCallback(() => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiConsola<{ data: Acceso[] }>(`/accesos?${q}`).then((r) => { setFilas(r.data); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [f]);
  useEffect(() => cargar(), [cargar]);
  useEffect(() => {
    apiConsola<{ empresas: { id: string; short: string }[] }>("/accesos/opciones").then((r) => setEmpresas(r.empresas)).catch(() => undefined);
  }, []);

  const puedePedir = Boolean(yo.puede["access.request_ro"] || yo.puede["access.request_rw"]);
  const ver = (id: string | null) => router.replace(id ? `/consola/accesos?acceso=${id}` : "/consola/accesos", { scroll: false });

  async function accion(a: Acceso, ruta: "cancelar" | "terminar") {
    const ok = await confirmAction({ title: ruta === "cancelar" ? "¿Cancelar el pedido de acceso?" : `¿Terminar el acceso a ${a.tenant_short}?`,
      confirmLabel: ruta === "cancelar" ? "Cancelar pedido" : "Terminar acceso", danger: true,
      message: ruta === "terminar" ? "Se cierran las sesiones abiertas en la empresa y ya no se puede volver a entrar con este acceso." : undefined });
    if (!ok) return;
    try {
      await apiConsola(`/accesos/${a.id}/${ruta}`, { method: "POST" });
      toast.ok(ruta === "cancelar" ? "Pedido cancelado" : "Acceso terminado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Acceso>[] = [
    { key: "tenant_short", header: "Empresa y motivo", cardTitle: true, render: (a) => (
      <div><p className="font-semibold text-ink">{a.tenant_short}</p>
        <p className="line-clamp-2 text-[12.5px] text-muted">{a.ticket_number ? `${a.ticket_number} · ` : ""}{a.reason}</p></div>
    ) },
    { key: "platform_user_name", header: "Para", hideOnMobile: true, render: (a) => a.platform_user_name },
    { key: "level", header: "Alcance", render: (a) => <Alcance a={a} /> },
    { key: "status", header: "Estado", render: (a) => (
      <div className="grid gap-0.5">
        <StatusBadge status={a.status} labels={ESTADOS_ACCESO} />
        {a.status === "ACTIVE" && <span className="text-[12px] text-muted">Quedan {quedan(a.expires_at)}</span>}
        {a.status === "PENDING" && <span className="text-[12px] text-muted">Pedido el {fechaHora(a.created_at)}</span>}
      </div>
    ) },
    { key: "acciones", header: "", align: "right", render: (a) => {
      const mio = a.platform_user_id === yo.id;
      const admin = yo.role === "PLATFORM_ADMIN";
      return (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {a.status === "ACTIVE" && mio && <Button size="sm" variant="primary" icon={LogIn} onClick={() => entrarConAcceso(a.id)}>Entrar</Button>}
          {a.status === "ACTIVE" && (mio || admin) && <Button size="sm" variant="ghost" icon={Ban} onClick={() => accion(a, "terminar")}>Terminar</Button>}
          {a.status === "PENDING" && (mio || admin) && <Button size="sm" variant="ghost" icon={XCircle} onClick={() => accion(a, "cancelar")}>Cancelar</Button>}
        </div>
      );
    } },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="La consola no ve los datos de negocio de una empresa. Para revisarlos se pide un acceso temporal que la empresa aprueba; es personal y todo lo que se hace con él queda registrado en los dos lados."
        actions={puedePedir ? <Button variant="primary" icon={Plus} onClick={() => setPedir(true)}>Pedir acceso</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Todos los estados"
          options={[{ value: "ABIERTOS", label: "Por aprobar y vigentes" }, ...Object.entries(ESTADOS_ACCESO).map(([value, [label]]) => ({ value, label }))]} />
        <Select aria-label="Empresa" value={f.tenant} onChange={(e) => setF({ ...f, tenant: e.target.value })} placeholder="Todas las empresas"
          options={empresas.map((t) => ({ value: t.id, label: t.short }))} />
      </div>
      <DataTable columns={columnas} rows={filas ?? []} loading={!filas && !error} error={error} onRetry={cargar} onRowClick={(a) => ver(a.id)}
        empty={<span className="inline-flex items-center gap-2"><KeyRound size={16} aria-hidden="true" />No hay accesos con estos filtros.</span>} />
      {pedir && <PedirAcceso onClose={() => setPedir(false)} onPedido={() => { setPedir(false); cargar(); }} />}
      {abierto && <DetalleConsola key={abierto} id={abierto} onClose={() => ver(null)} />}
    </div>
  );
}

function DetalleConsola({ id, onClose }: { id: string; onClose: () => void }) {
  const [a, setA] = useState<AccesoDetalle | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiConsola<AccesoDetalle>(`/accesos/${id}`).then(setA).catch((e) => setError(mensajeDe(e)));
  }, [id]);

  return (
    <Modal open onClose={onClose} size="lg" title={a ? `Acceso a ${a.tenant_short} · ${a.platform_user_name}` : "Acceso de soporte"}
      description={a ? <span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={a.status} labels={ESTADOS_ACCESO} /><Alcance a={a} /></span> : undefined}>
      {error ? <Alert tone="bad">{error}</Alert> : !a ? <p className="text-muted">Cargando…</p> : <ContenidoAcceso a={a} />}
    </Modal>
  );
}
