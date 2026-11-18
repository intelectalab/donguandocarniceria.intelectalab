"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field, Input, Select, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import type { Ficha, Opciones } from "./tipos";

type Valores = { name: string; email: string; role_id: string; employee_id: string; brand_ids: string[]; establishment_ids: string[] };

/**
 * Datos, rol, trabajador y alcance de un usuario. Sin «usuario» crea e invita por correo (SEG-08);
 * con él edita rol y alcance (SEG-09). Un solo rol por usuario, como el prototipo: si el rol es de
 * alcance total ve todo y no se eligen marcas ni locales; si es asignado, se exige al menos uno
 * (RN-SEG-13). El correo no se cambia una vez creado (RN-SEG-01).
 */
export function UsuarioForm({ usuario, opciones, onGuardado, onCancelar, id = "f-usuario" }: {
  usuario: Ficha | null; opciones: Opciones; onGuardado: (u: Ficha) => void; onCancelar?: () => void; id?: string;
}) {
  const [v, setV] = useState<Valores>(() => ({
    name: usuario?.name ?? "", email: usuario?.email ?? "", role_id: usuario?.role_id ?? usuario?.role_ids?.[0] ?? "",
    employee_id: usuario?.employee_id ?? "", brand_ids: usuario?.brand_ids ?? [], establishment_ids: usuario?.establishment_ids ?? [],
  }));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const rol = opciones.roles.find((r) => r.id === v.role_id);
  const asignado = rol?.scope_mode === "ASSIGNED";
  const variosRoles = (usuario?.role_ids?.length ?? 0) > 1;
  const alternar = (campo: "brand_ids" | "establishment_ids", valor: string, marcado: boolean) =>
    setV((x) => ({ ...x, [campo]: marcado ? [...x[campo], valor] : x[campo].filter((i) => i !== valor) }));
  const trabajadores = opciones.employees.filter((e) => !e.user_id || e.user_id === usuario?.id);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    setErrores({});
    try {
      // Con un rol de alcance total no se mandan marcas ni locales: ve todo.
      const body = { name: v.name, role_id: v.role_id, employee_id: v.employee_id || null,
        brand_ids: asignado ? v.brand_ids : [], establishment_ids: asignado ? v.establishment_ids : [] };
      const r = await api<Ficha>(usuario ? `/v1/seg/usuarios/${usuario.id}` : "/v1/seg/usuarios",
        { method: usuario ? "PUT" : "POST", body: usuario ? body : { ...body, email: v.email } });
      toast.ok(usuario ? "Rol y alcance guardados: rigen en su siguiente petición" : `Usuario creado. Invitación enviada a ${r.email}`);
      onGuardado(r);
    } catch (err) {
      const porCampo = erroresDe(err);
      setErrores(porCampo);
      setError(Object.keys(porCampo).length ? "Revisa los datos marcados." : mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form id={id} onSubmit={guardar} noValidate className="space-y-5">
      {error && <Alert tone="bad">{error}</Alert>}
      {variosRoles && (
        <Alert tone="warn" title="Tiene más de un rol guardado">
          Ahora cada usuario tiene un solo rol: hoy figura como {usuario?.roles_names}. Al guardar queda solo el rol elegido.
          Si necesita los permisos de ambos, crea un rol propio que los junte en la pantalla de Roles.
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre completo" required error={errores.name}>
          <Input value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} maxLength={255} autoComplete="off" />
        </Field>
        <Field label="Correo" required error={errores.email} hint={usuario ? "No se cambia una vez creado." : "Único en la empresa; se guarda en minúsculas."}>
          <Input type="email" value={v.email} disabled={Boolean(usuario)} onChange={(e) => setV((x) => ({ ...x, email: e.target.value }))} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Rol" required error={errores.role_id}
          hint={rol ? `${asignado ? "Alcance asignado: ve solo las marcas o locales que elijas abajo." : "Alcance total: ve todas las marcas y locales."}${rol.requires_mfa ? " Exige segundo factor." : ""}` : undefined}>
          <Select value={v.role_id} onChange={(e) => setV((x) => ({ ...x, role_id: e.target.value }))} placeholder="Elige un rol"
            options={opciones.roles.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <Field label="Trabajador vinculado" error={errores.employee_id} hint="Opcional: la persona de planilla que usa esta cuenta.">
          <Select value={v.employee_id} onChange={(e) => setV((x) => ({ ...x, employee_id: e.target.value }))} placeholder="Ninguno"
            options={trabajadores.map((t) => ({ value: t.id, label: `${t.full_name} · ${t.position}` }))} />
        </Field>
      </div>

      {asignado && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">Marcas{!v.establishment_ids.length ? <span className="text-bad"> *</span> : ""}</legend>
              <div className="space-y-2">
                {opciones.brands.map((b) => <Checkbox key={b.id} label={b.name} checked={v.brand_ids.includes(b.id)} onChange={(m) => alternar("brand_ids", b.id, m)} />)}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">Locales{!v.brand_ids.length ? <span className="text-bad"> *</span> : ""}</legend>
              <div className="space-y-2">
                {opciones.establishments.map((l) => <Checkbox key={l.id} label={l.short} hint={l.name} checked={v.establishment_ids.includes(l.id)} onChange={(m) => alternar("establishment_ids", l.id, m)} />)}
              </div>
            </fieldset>
          </div>
          <p className="text-[12.5px] text-muted">Elige al menos una marca o un local.</p>
          {(errores.brand_ids || errores.establishment_ids) && <p className="text-[12.5px] text-bad">{errores.brand_ids ?? errores.establishment_ids}</p>}
        </>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {onCancelar && <Button onClick={onCancelar} disabled={guardando}>Cancelar</Button>}
        <Button type="submit" variant="primary" loading={guardando}>{usuario ? "Guardar rol y alcance" : "Crear e invitar por correo"}</Button>
      </div>
    </form>
  );
}
