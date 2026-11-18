"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Layers, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, confirmAction, toast, type Column, type Tone } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import type { RolFila, RolesResumen } from "@/modulos/seg/tipos";

const ESTADOS: Record<string, [string, Tone]> = { ACTIVE: ["Activo", "ok"], INACTIVE: ["Inactivo", "neutral"] };

/**
 * SEG-10 Roles: los del sistema y los propios, con descripción, si exigen segundo factor, alcance y
 * cantidad de usuarios. Los del sistema no se borran ni cambian su código; sus permisos sí se ajustan.
 */
export default function Roles() {
  const router = useRouter();
  const { can } = useSesion();
  const [datos, setDatos] = useState<{ data: RolFila[]; resumen: RolesResumen } | null>(null);
  const [error, setError] = useState("");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("");
  const [copiando, setCopiando] = useState<RolFila | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState("");
  const puede = can("seg.role.manage");

  const cargar = useCallback(() => {
    api<{ data: RolFila[]; resumen: RolesResumen }>("/v1/seg/roles").then(setDatos).catch((e) => setError(mensajeDe(e)));
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function borrar(r: RolFila) {
    if (!(await confirmAction({ title: `Borrar ${r.name}`, message: "Se borra el rol con sus accesos y permisos. Los roles con usuarios no se borran.", confirmLabel: "Borrar", danger: true }))) return;
    setOcupado(r.id);
    try {
      await api(`/v1/seg/roles/${r.id}`, { method: "DELETE" });
      toast.ok("Rol borrado");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setOcupado("");
    }
  }

  const q = busca.trim().toLowerCase();
  const filas = (datos?.data ?? []).filter((r) => (!tipo || (tipo === "S") === r.is_system)
    && (!q || `${r.code} ${r.name} ${r.description ?? ""}`.toLowerCase().includes(q)));
  const res = datos?.resumen;

  const columnas: Column<RolFila>[] = [
    { key: "name", header: "Rol", cardTitle: true, render: (r) => (
      <div className="min-w-0">
        <p className="font-semibold">{r.name}</p>
        <p className="font-mono text-[12px] text-muted">{r.code}</p>
      </div>
    ) },
    { key: "description", header: "Descripción", hideOnMobile: true, render: (r) => r.description ?? <span className="text-muted">—</span> },
    { key: "tipo", header: "Tipo", render: (r) => r.is_system ? <Badge tone="info">Del sistema</Badge> : <Badge tone="primary">Propio</Badge> },
    { key: "requires_mfa", header: "Segundo factor", hideOnMobile: true, render: (r) => r.requires_mfa ? <Badge tone="warn">Exige</Badge> : <span className="text-muted">No</span> },
    { key: "scope_mode", header: "Alcance", render: (r) => r.scope_mode === "ASSIGNED" ? "Asignado" : "Todo" },
    { key: "users", header: "Usuarios", align: "right", render: (r) => numero(r.users) },
    { key: "perms", header: "Permisos especiales", align: "right", hideOnMobile: true, render: (r) => numero(r.perms) },
    { key: "status", header: "Estado", hideOnMobile: true, render: (r) => <StatusBadge status={r.status} labels={ESTADOS} /> },
    { key: "acciones", header: "", align: "right", render: (r) => puede ? (
      <span className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {r.editable && <Button size="sm" icon={Copy} onClick={() => setCopiando(r)}>Copiar</Button>}
        {!r.is_system && <Button size="sm" variant="ghost" icon={Trash2} loading={ocupado === r.id} onClick={() => borrar(r)}>Borrar</Button>}
      </span>
    ) : null },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description="Roles del sistema y propios, con descripción, si exigen segundo factor, alcance y cantidad de usuarios. Los del sistema no se borran ni cambian su código; sus permisos sí se ajustan por empresa."
        actions={puede && <Button variant="primary" icon={Copy} onClick={() => setCopiando(null)} disabled={!datos}>Copiar un rol del sistema</Button>} />

      {error && <Alert tone="bad">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Roles del sistema" valor={res ? numero(res.sistema) : undefined} detalle="Vienen con GestionCarnica" icono={ShieldCheck} destacada />
        <Cifra titulo="Roles propios" valor={res ? numero(res.propios) : undefined} detalle="Creados por la empresa" icono={UserCog} />
        <Cifra titulo="Exigen segundo factor" valor={res ? numero(res.exigen_2fa) : undefined} detalle="Gerencia, finanzas, auditoría…" icono={KeyRound} />
        <Cifra titulo="Alcance asignado" valor={res ? numero(res.asignado) : undefined} detalle="Ven solo sus marcas o locales" icono={Layers} />
      </div>

      <DataTable rows={filas} rowKey={(r) => r.id} columns={columnas} loading={!datos && !error}
        onRowClick={(r) => router.push(`/m/seg/seg-11?id=${r.id}`)}
        search={{ value: busca, onChange: setBusca, placeholder: "Buscar rol, código o descripción…" }}
        empty="No hay roles con esos filtros."
        toolbar={
          <div className="w-full sm:w-[160px]">
            <Select aria-label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Tipo: todos"
              options={[{ value: "S", label: "Del sistema" }, { value: "P", label: "Propio" }]} className="!min-h-9 h-9 py-1.5 text-[13px]" />
          </div>
        } />

      {copiando !== undefined && datos && (
        <CopiarRol base={copiando} roles={datos.data.filter((r) => r.editable)} onClose={() => setCopiando(undefined)}
          onCreado={(id) => { setCopiando(undefined); router.push(`/m/seg/seg-11?id=${id}`); }} />
      )}
    </div>
  );
}

/** Crear un rol propio copiando accesos, permisos, segundo factor y alcance de otro. */
function CopiarRol({ base, roles, onClose, onCreado }: { base: RolFila | null; roles: RolFila[]; onClose: () => void; onCreado: (id: string) => void }) {
  const inicial = base ?? roles.find((r) => r.code === "VENDEDORA") ?? roles[0];
  const [baseId, setBaseId] = useState(inicial?.id ?? "");
  const [codigo, setCodigo] = useState(inicial ? `${inicial.code}_PROPIO`.slice(0, 25) : "");
  const [nombre, setNombre] = useState(inicial ? `${inicial.name} (propio)` : "");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  function elegir(id: string) {
    const r = roles.find((x) => x.id === id);
    setBaseId(id);
    if (r) { setCodigo(`${r.code}_PROPIO`.slice(0, 25)); setNombre(`${r.name} (propio)`); }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setErrores({});
    try {
      const r = await api<{ id: string }>("/v1/seg/roles", { method: "POST", body: { base_id: baseId, code: codigo, name: nombre } });
      toast.ok("Rol creado: ajusta sus permisos");
      onCreado(r.id);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      setError(Object.keys(porCampo).length ? "Revisa los datos marcados." : mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title="Crear rol propio"
      description="Copia los accesos, permisos, segundo factor y alcance del rol elegido. Después ajustas sus permisos."
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button type="submit" form="f-rol" variant="primary" loading={guardando}>Crear rol</Button>
      </>}>
      <form id="f-rol" onSubmit={guardar} noValidate className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Copiar de" required error={errores.base_id}>
          <Select value={baseId} onChange={(e) => elegir(e.target.value)} options={roles.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <Field label="Código" required error={errores.code} hint="Mayúsculas, números y guion bajo; de 3 a 25 caracteres. No se cambia después.">
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} maxLength={25} className="font-mono uppercase" />
        </Field>
        <Field label="Nombre" required error={errores.name}>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
        </Field>
      </form>
    </Modal>
  );
}
