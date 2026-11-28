"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, UserPlus } from "lucide-react";
import { Badge, Button, Checkbox, Cifra, DataTable, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Usuario = {
  id: string;
  name: string;
  email: string;
  role: string;
  role_name: string;
  status: string;
  twofa_required: boolean;
  twofa_enabled: boolean;
  brands: string[];
  sites: string[];
};

type RespuestaUsuarios = {
  users: Usuario[];
  active_count: number;
  limit: number | null;
  roles: { id: string; code: string; name: string; requires_mfa: boolean }[];
  brands: { id: string; code: string; name: string }[];
  establishments: { id: string; code: string; name: string }[];
  step: PasoAlta | null;
};

export default function Onb14UsuariosPage() {
  const [datos, setDatos] = useState<RespuestaUsuarios | null>(null);
  const [cargando, setCargando] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VENDEDORA");
  const [selBrands, setSelBrands] = useState<string[]>([]);
  const [selSites, setSelSites] = useState<string[]>([]);
  const [invitando, setInvitando] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaUsuarios>("/v1/onb/usuarios")
      .then(setDatos)
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  function toggleId(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function invitar(e: React.FormEvent) {
    e.preventDefault();
    setInvitando(true);
    try {
      await api("/v1/onb/usuarios", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          role,
          brands: selBrands,
          sites: selSites,
        }),
      });
      toast.ok(`Invitación enviada a ${email}.`);
      setName("");
      setEmail("");
      setSelBrands([]);
      setSelSites([]);
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setInvitando(false);
    }
  }

  async function aceptarSimulado(id: string) {
    try {
      await api(`/v1/onb/usuarios/${id}/aceptar`, {
        method: "POST",
        body: JSON.stringify({ with_mfa: true }),
      });
      toast.ok("Invitación aceptada con segundo factor.");
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const pendientes = (datos?.users ?? []).filter((u) => u.status === "INVITED").length;
  const con2fa = (datos?.users ?? []).filter((u) => u.twofa_enabled).length;

  return (
    <div className="space-y-5">
      <PageHeader description="Invitar por correo con rol, locales y marcas; segundo factor obligatorio para los roles que lo exigen." />
      <CabeceraPaso step={datos?.step} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra
          titulo="Usuarios del personal"
          valor={datos?.limit != null ? `${datos.active_count} de ${datos.limit}` : String(datos?.active_count ?? 0)}
          detalle="Límite del plan contratado"
        />
        <Cifra titulo="Invitaciones pendientes" valor={String(pendientes)} />
        <Cifra titulo="Con segundo factor" valor={String(con2fa)} />
      </div>

      <DataTable<Usuario>
        rows={datos?.users ?? []}
        loading={cargando}
        rowKey={(r) => r.id}
        empty="Sin usuarios registrados."
        columns={[
          { key: "name", header: "Nombre", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "email", header: "Correo", render: (r) => r.email },
          { key: "role_name", header: "Rol", render: (r) => r.role_name },
          {
            key: "alcance",
            header: "Alcance",
            render: (r) => [...r.brands, ...r.sites].join(" · ") || "Todo",
          },
          {
            key: "twofa",
            header: "Segundo factor",
            render: (r) =>
              r.twofa_required ? (
                r.twofa_enabled ? (
                  <Badge tone="ok">Activo</Badge>
                ) : (
                  <Badge tone="warn">Obligatorio</Badge>
                )
              ) : r.twofa_enabled ? (
                <Badge tone="ok">Activo</Badge>
              ) : (
                <span className="text-muted">Opcional</span>
              ),
          },
          {
            key: "status",
            header: "Estado",
            render: (r) => (
              <Badge tone={r.status === "ACTIVE" ? "ok" : r.status === "INVITED" ? "warn" : "neutral"}>
                {r.status === "ACTIVE" ? "Activo" : r.status === "INVITED" ? "Invitado" : r.status}
              </Badge>
            ),
          },
          {
            key: "acciones",
            header: "Acción",
            align: "right",
            render: (r) =>
              r.status === "INVITED" ? (
                <Button size="sm" variant="secondary" icon={CheckCircle2} onClick={() => aceptarSimulado(r.id)}>
                  Aceptar invitación (simulado)
                </Button>
              ) : null,
          },
        ]}
      />

      <form onSubmit={invitar} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">Invitar usuario</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre completo" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Correo electrónico" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Rol" required hint="Gerencia, Administrador, Administración y Contadora exigen segundo factor.">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {datos?.roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                  {r.requires_mfa ? " · 2FA" : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="space-y-2">
          <div className="text-[12.5px] font-medium text-muted">Marcas asignadas</div>
          <div className="flex flex-wrap gap-4">
            {datos?.brands.map((b) => (
              <Checkbox
                key={b.id}
                checked={selBrands.includes(b.id)}
                onChange={() => toggleId(selBrands, setSelBrands, b.id)}
                label={b.name}
              />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[12.5px] font-medium text-muted">Locales asignados</div>
          <div className="flex flex-wrap gap-4">
            {datos?.establishments.map((e) => (
              <Checkbox
                key={e.id}
                checked={selSites.includes(e.id)}
                onChange={() => toggleId(selSites, setSelSites, e.id)}
                label={`${e.code} · ${e.name}`}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" icon={UserPlus} loading={invitando}>
            Enviar invitación
          </Button>
        </div>
      </form>
    </div>
  );
}
