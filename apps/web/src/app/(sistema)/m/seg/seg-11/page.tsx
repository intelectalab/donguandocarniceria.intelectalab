"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { LETRAS, enOrdenDelMenu, nombreModulo, type PermisoDelRol, type RolFicha, type RolFila } from "@/modulos/seg/tipos";

/**
 * SEG-11 Permisos del rol: acceso por módulo (crear, leer, editar, aprobar o anular) y permisos
 * especiales con su explicación, por módulo en el orden del menú. Los módulos apagados se ven en
 * gris y no conceden nada. Cada cambio se guarda al marcarlo y rige en la siguiente petición.
 */
export default function PermisosDelRol() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [roles, setRoles] = useState<RolFila[] | null>(null);

  useEffect(() => {
    let vigente = true;
    api<{ data: RolFila[] }>("/v1/seg/roles").then((r) => vigente && setRoles(r.data)).catch(() => {});
    return () => { vigente = false; };
  }, []);

  // Sin rol elegido, el primero de la lista (como el prototipo, que abre en Vendedora).
  const elegido = id ?? roles?.find((r) => r.code === "VENDEDORA")?.id ?? roles?.[0]?.id ?? null;

  return (
    <div className="space-y-5">
      <PageHeader description="Acceso por módulo y permisos especiales con su explicación, agrupados por módulo. Los módulos apagados aparecen en gris y no conceden permisos. Los cambios rigen en la siguiente petición de cada usuario."
        actions={<Button icon={ArrowLeft} onClick={() => router.push("/m/seg/seg-10")}>Volver a roles</Button>} />
      <div className="w-full sm:max-w-md">
        <Field label="Rol">
          <Select value={elegido ?? ""} onChange={(e) => router.replace(`/m/seg/seg-11?id=${e.target.value}`)} placeholder="Elige un rol"
            options={(roles ?? []).map((r) => ({ value: r.id, label: `${r.name} (${r.code})` }))} searchable />
        </Field>
      </div>
      {elegido ? <Ficha key={elegido} id={elegido} /> : <div className="h-40 animate-pulse rounded-xl bg-surface-2" />}
    </div>
  );
}

function Ficha({ id }: { id: string }) {
  const { can } = useSesion();
  const [rol, setRol] = useState<RolFicha | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState("");
  const [editando, setEditando] = useState(false);
  const editable = Boolean(rol?.editable) && can("seg.role.manage");

  useEffect(() => {
    let vigente = true;
    api<RolFicha>(`/v1/seg/roles/${id}`).then((r) => vigente && setRol(r)).catch((e) => vigente && setError(mensajeDe(e, "No se encontró el rol.")));
    return () => { vigente = false; };
  }, [id]);

  const modulos = useMemo(() => (rol ? enOrdenDelMenu(rol.modules) : []), [rol]);
  const porModulo = useMemo(() => {
    const m = new Map<string, PermisoDelRol[]>();
    for (const p of rol?.permissions ?? []) m.set(p.module_code, [...(m.get(p.module_code) ?? []), p]);
    return m;
  }, [rol]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!rol) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" />;

  async function acceso(modulo: string, letras: string) {
    const clave = `a-${modulo}`;
    setGuardando(clave);
    const antes = rol!.modules;
    setRol((r) => r && { ...r, modules: r.modules.map((m) => (m.code === modulo ? { ...m, actions: letras } : m)) });
    try {
      const res = await api<{ actions: string }>(`/v1/seg/roles/${id}/acceso`, { method: "PUT", body: { module_code: modulo, actions: letras } });
      toast.ok(`${nombreModulo(modulo)}: ${res.actions ? LETRAS.filter((l) => res.actions.includes(l.letra)).map((l) => l.nombre.toLowerCase()).join(", ") : "sin acceso"}`);
    } catch (e) {
      setRol((r) => r && { ...r, modules: antes });
      toast.error(mensajeDe(e));
    } finally {
      setGuardando("");
    }
  }

  async function permiso(p: PermisoDelRol, conceder: boolean) {
    setGuardando(`p-${p.code}`);
    const marcar = (v: boolean) => setRol((r) => r && { ...r, permissions: r.permissions.map((x) => (x.code === p.code ? { ...x, granted: v } : x)) });
    marcar(conceder);
    try {
      await api(`/v1/seg/roles/${id}/permisos`, { method: "PUT", body: { permission_code: p.code, granted: conceder } });
      toast.ok(`${p.code} ${conceder ? "concedido" : "quitado"}`);
    } catch (e) {
      marcar(!conceder);
      toast.error(mensajeDe(e));
    } finally {
      setGuardando("");
    }
  }

  const aviso = rol.code === "GERENTE" ? "La gerencia ve todo y tiene todos los permisos: no se edita."
    : rol.code === "SOPORTE_PLATAFORMA" ? "Este rol es del soporte de Intelectalab: sus permisos no se cambian desde la empresa."
      : !can("seg.role.manage") ? "Solo lectura: cambiar permisos exige el permiso de gestionar roles." : null;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <div className="mr-auto min-w-0">
          <p className="font-semibold">{rol.name} <span className="font-mono text-[12px] text-muted">{rol.code}</span></p>
          {rol.description && <p className="text-[13px] text-muted">{rol.description}</p>}
        </div>
        {rol.is_system ? <Badge tone="info">Rol del sistema</Badge> : <Badge tone="primary">Rol propio</Badge>}
        {rol.requires_mfa && <Badge tone="warn">Exige segundo factor</Badge>}
        <Badge>{rol.scope_mode === "ASSIGNED" ? "Alcance asignado" : "Alcance total"}</Badge>
        <Badge>{rol.users === 1 ? "1 usuario" : `${rol.users} usuarios`}</Badge>
        {!rol.is_system && can("seg.role.manage") && <Button size="sm" icon={Pencil} onClick={() => setEditando(true)}>Editar</Button>}
      </section>
      {aviso && <Alert tone="info">{aviso}</Alert>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {modulos.map((m) => {
          const perms = porModulo.get(m.code) ?? [];
          const bloqueado = !editable || !m.enabled;
          return (
            <section key={m.code} className={`min-w-0 rounded-xl border border-line bg-surface shadow-card ${m.enabled ? "" : "opacity-55 grayscale"}`}>
              <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <h3 className="text-[13.5px] font-semibold"><span className="font-mono text-[12px] text-muted">{m.code}</span> {nombreModulo(m.code, m.name)}</h3>
                {!m.enabled && <Badge tone="warn">Apagado</Badge>}
              </header>
              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {LETRAS.map((l) => (
                    <Checkbox key={l.letra} label={l.nombre} checked={m.actions.includes(l.letra)} disabled={bloqueado || guardando === `a-${m.code}`}
                      onChange={(v) => acceso(m.code, LETRAS.map((x) => x.letra).filter((x) => (x === l.letra ? v : m.actions.includes(x))).join(""))} />
                  ))}
                </div>
                {perms.length > 0 && (
                  <div className="space-y-2 border-t border-line pt-3">
                    {perms.map((p) => (
                      <Checkbox key={p.code} checked={p.granted} disabled={bloqueado || p.everyone || guardando === `p-${p.code}`}
                        onChange={(v) => permiso(p, v)}
                        label={<span><span className="font-mono text-[12px]">{p.code}</span> · {p.description}{p.everyone && <span className="text-muted"> (lo tienen todos)</span>}</span>} />
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {editando && <EditarRol rol={rol} onClose={() => setEditando(false)} onGuardado={(r) => { setRol((x) => x && { ...x, name: r.name, description: r.description }); setEditando(false); }} />}
    </div>
  );
}

/** Nombre y descripción de un rol propio (el código no cambia). */
function EditarRol({ rol, onClose, onGuardado }: { rol: RolFicha; onClose: () => void; onGuardado: (r: { name: string; description: string | null }) => void }) {
  const [nombre, setNombre] = useState(rol.name);
  const [descripcion, setDescripcion] = useState(rol.description ?? "");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setErrores({});
    try {
      const r = await api<{ name: string; description: string | null }>(`/v1/seg/roles/${rol.id}`, { method: "PUT", body: { name: nombre, description: descripcion || null } });
      toast.ok("Rol guardado");
      onGuardado(r);
    } catch (e) {
      const porCampo = erroresDe(e);
      setErrores(porCampo);
      if (!Object.keys(porCampo).length) toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={`Editar ${rol.code}`}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" loading={guardando} onClick={guardar}>Guardar</Button></>}>
      <div className="space-y-4">
        <Field label="Nombre" required error={errores.name}><Input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} /></Field>
        <Field label="Descripción" error={errores.description}><Textarea rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}
