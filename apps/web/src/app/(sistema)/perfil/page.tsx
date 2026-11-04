"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import ChangePasswordModal from "@/components/layout/ChangePasswordModal";
import { iniciales } from "@/lib/empresa";
import { useSesion } from "@/lib/sesion";

/** Mi perfil y seguridad: datos de la cuenta, alcance (marcas y locales) y cambio de contraseña. */
export default function Perfil() {
  const { me } = useSesion();
  const [cambiando, setCambiando] = useState(false);
  const fila = "grid gap-0.5 border-b border-line py-3 last:border-0 sm:grid-cols-[180px_1fr] sm:gap-4";

  return (
    <div className="grid max-w-4xl gap-5 lg:grid-cols-[1fr_320px]">
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-primary-ink">{iniciales(me.user.name)}</span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{me.user.name}</h2>
            <p className="truncate text-[13px] text-muted">{me.user.email}</p>
          </div>
        </div>
        <dl className="text-[13.5px]">
          <div className={fila}><dt className="text-muted">Empresa</dt><dd>{me.tenant.name}</dd></div>
          <div className={fila}><dt className="text-muted">Rol</dt><dd>{me.roles.join(", ")}</dd></div>
          <div className={fila}>
            <dt className="text-muted">Marcas</dt>
            <dd className="flex flex-wrap gap-1.5">
              {me.brands.map((b) => (
                <span key={b.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[12.5px]">
                  <span className="size-2 rounded-full" style={{ background: b.primary_color }} />{b.name}
                </span>
              ))}
            </dd>
          </div>
          <div className={fila}><dt className="text-muted">Locales</dt><dd>{me.establishments.map((e) => e.name).join(" · ")}</dd></div>
          <div className={fila}>
            <dt className="text-muted">Permisos especiales</dt>
            <dd>{me.permissions.includes("*") ? "Todos (Gerencia)" : `${me.permissions.length} permisos de su rol`}</dd>
          </div>
        </dl>
      </section>

      <section className="h-fit rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="font-semibold">Seguridad</h2>
        <p className="mt-1 text-[13px] text-muted">Al cambiar tu contraseña se cierran tus sesiones en otros equipos.</p>
        <button onClick={() => setCambiando(true)}
          className="mt-4 flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[9px] bg-primary text-[13.5px] font-semibold text-primary-ink hover:brightness-110">
          <KeyRound size={16} />
          Cambiar contraseña
        </button>
      </section>

      {cambiando && <ChangePasswordModal onClose={() => setCambiando(false)} />}
    </div>
  );
}
