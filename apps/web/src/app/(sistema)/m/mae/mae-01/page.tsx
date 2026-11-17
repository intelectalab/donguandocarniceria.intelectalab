"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, UserMinus, UserX, Users } from "lucide-react";
import { Badge, Button, Cifra, DataTable, PageHeader, Select, StatusBadge, type Column } from "@/components/ui";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { useListado } from "@/lib/useListado";
import { TrabajadorForm } from "@/modulos/mae/TrabajadorForm";
import { ESTADOS_USUARIO, NOMBRE_DOC, useDatos, type ResumenTrabajadores, type Trabajador } from "@/modulos/mae/tipos";

/** MAE-01 Trabajadores: documento, cargo, local, centro de costo y usuario vinculado. La baja desactiva el usuario. */
export default function Trabajadores() {
  const router = useRouter();
  const { puede, can } = useSesion();
  const [local, setLocal] = useState("");
  const [cargo, setCargo] = useState("");
  const [estado, setEstado] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const lista = useListado<Trabajador>("/v1/mae/trabajadores", { orden: "full_name", filtros: { establishment_id: local, position: cargo, status: estado } });
  const { datos: r } = useDatos<ResumenTrabajadores>("/v1/mae/trabajadores/resumen");
  const gestiona = can("mae.employee.manage") && puede("MAE", "C");

  const columnas: Column<Trabajador>[] = [
    { key: "doc_number", header: "Documento", sortable: true, render: (e) => <span className="font-mono text-[12.5px]">{NOMBRE_DOC[e.doc_type]} {e.doc_number}</span> },
    { key: "full_name", header: "Nombre", sortable: true, cardTitle: true, render: (e) => <span className="font-semibold">{e.full_name}</span> },
    { key: "position", header: "Cargo", sortable: true },
    { key: "local", header: "Local", sortable: true, render: (e) => e.local ?? "—" },
    { key: "centro_costo", header: "Centro de costo", hideOnMobile: true, render: (e) => e.centro_costo ?? "—" },
    { key: "usuario", header: "Usuario", hideOnMobile: true, render: (e) => e.usuario ? (
      <span className="flex flex-wrap items-center gap-1.5"><span className="text-[12.5px]">{e.usuario.email}</span><StatusBadge status={e.usuario.status} labels={ESTADOS_USUARIO} /></span>
    ) : <span className="text-[12.5px] text-muted">Sin usuario</span> },
    { key: "hire_date", header: "Ingreso", sortable: true, hideOnMobile: true, render: (e) => fecha(e.hire_date) },
    { key: "status", header: "Estado", sortable: true, render: (e) => e.status === "ACTIVE" ? <Badge tone="ok" dot>Activo</Badge> : <Badge tone="bad">Cesado {fecha(e.terminated_on)}</Badge> },
  ];
  const filtro = "!min-h-9 h-9 py-1.5 text-[13px]";

  return (
    <div className="space-y-5">
      <PageHeader description="Personal con su documento, cargo, local, centro de costo y usuario vinculado. La baja desactiva el usuario."
        actions={gestiona ? <>
          <Button onClick={() => router.push("/m/mae/mae-10")}>Importar CSV</Button>
          <Button variant="primary" onClick={() => setNuevo(true)} disabled={!r}>Nuevo trabajador</Button>
        </> : undefined} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Trabajadores activos" valor={r ? numero(r.activos) : undefined} detalle={r ? `${numero(r.de_baja)} de baja` : undefined} icono={Users} destacada />
        <Cifra titulo="Con usuario vigente" valor={r ? numero(r.con_usuario) : undefined} detalle="Acceden al sistema" icono={KeyRound} />
        <Cifra titulo="Sin usuario" valor={r ? numero(r.sin_usuario) : undefined} detalle="Operarios y apoyo" icono={UserX} />
        <Cifra titulo="Ceses este año" valor={r ? numero(r.ceses_del_anio) : undefined} icono={UserMinus} tono={r?.ceses_del_anio ? "warn" : undefined} />
      </div>

      <DataTable {...lista.tabla} columns={columnas} empty="No hay trabajadores con esos filtros." onRowClick={(e) => router.push(`/m/mae/mae-02?id=${e.id}`)}
        search={{ ...lista.tabla.search, placeholder: "Buscar nombre, documento, cargo o correo…" }}
        toolbar={<>
          <div className="w-full sm:w-[150px]">
            <Select aria-label="Local" value={local} onChange={(e) => setLocal(e.target.value)} placeholder="Local: todos" className={filtro}
              options={(r?.locales ?? []).map((l) => ({ value: l.id, label: l.short }))} />
          </div>
          <div className="w-full sm:w-[190px]">
            <Select aria-label="Cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Cargo: todos" className={filtro}
              options={(r?.cargos ?? []).map((c) => ({ value: c, label: c }))} />
          </div>
          <div className="w-full sm:w-[140px]">
            <Select aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Estado: todos" className={filtro}
              options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "De baja" }]} />
          </div>
        </>} />

      {nuevo && r && <TrabajadorForm opciones={r} onClose={() => setNuevo(false)} onGuardado={(id) => router.push(`/m/mae/mae-02?id=${id}`)} />}
    </div>
  );
}
