"use client";

import { useEffect, useState } from "react";
import { LifeBuoy, LogOut } from "lucide-react";

export type SesionSoporte = { level: "RO" | "RW"; level_name: string; can_export: boolean; expires_at: string; platform_user_name: string };

const restante = (hasta: string, ahora: number) => {
  const min = Math.max(0, Math.floor((new Date(hasta).getTime() - ahora) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
};

/**
 * Sesión de soporte (OPS-06): franja fija mientras el soporte de GestionCarnica está dentro de la empresa, con el nivel
 * del acceso y el tiempo que le queda. Al vencer, la API ya no responde y se vuelve al ingreso.
 */
export function FranjaSoporte({ s, onSalir }: { s: SesionSoporte; onSalir: () => void }) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const vencido = new Date(s.expires_at).getTime() <= ahora;

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-warn px-4 py-2 text-[13px] font-semibold text-black sm:px-6">
      <LifeBuoy size={16} aria-hidden="true" className="shrink-0" />
      <span>Sesión de soporte de GestionCarnica · {s.platform_user_name}</span>
      <span className="font-normal">
        {s.level_name}{s.can_export ? " · puede exportar" : " · sin exportar"} · {vencido ? "el acceso venció" : `quedan ${restante(s.expires_at, ahora)}`}
      </span>
      <button type="button" onClick={onSalir}
        className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-black/10 px-2.5 py-1 text-[12.5px] font-semibold hover:bg-black/20">
        <LogOut size={14} aria-hidden="true" />Terminar sesión
      </button>
    </div>
  );
}
