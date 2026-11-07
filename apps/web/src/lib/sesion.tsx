"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

import type { TemaMarca } from "./temaMarca";

export type Accion = "C" | "L" | "E" | "A";

export type Me = {
  user: { id: string; name: string; email: string; role: string; default_brand_id: string | null; must_change_password: boolean };
  tenant: { id: string; name: string; short: string; plan: string };
  roles: string[];
  permissions: string[];
  modules: { code: string; name: string; phase: number; enabled: boolean; actions: string }[];
  brands: { id: string; code: string; name: string; primary_color: string; logo_url: string | null }[];
  establishments: { id: string; code: string; name: string; short: string; has_counter: boolean }[];
  /** Colores (PLT-06): el de la empresa y el propio de cada marca. */
  themes?: { empresa: TemaMarca | null; brands: Record<string, TemaMarca> | TemaMarca[] };
};

export type Sesion = {
  me: Me;
  /** Marca y local del selector superior ('ALL' = todas las que el usuario puede ver). */
  marca: string;
  local: string;
  setMarca: (id: string) => void;
  setLocal: (id: string) => void;
  /** Permiso especial de la spec: can('ped.discount.approve'). */
  can: (permiso: string) => boolean;
  /** Acceso al módulo: puede('PED', 'C'). Falso si el módulo está apagado para la empresa. */
  puede: (modulo: string, accion?: Accion) => boolean;
  recargar: () => Promise<void>;
};

/** Estado de la carga de /me, para el armazón (esqueleto, error y reintento). */
type Estado = { sesion: Sesion | null; cargando: boolean; error: string | null; reintentar: () => void };

const Ctx = createContext<Estado | null>(null);

const leer = (k: string) => {
  if (typeof window === "undefined") return "ALL";
  try {
    return localStorage.getItem(k) ?? "ALL";
  } catch {
    return "ALL";
  }
};
const guardar = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export function SesionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  // En el servidor no hay localStorage: leer() devuelve "ALL" y nada de esto se pinta antes de /me.
  const [marca, setMarcaState] = useState(() => leer("aycha-marca"));
  const [local, setLocalState] = useState(() => leer("aycha-local"));

  const recargar = useCallback(async () => {
    try {
      setError(null);
      setMe(await api<Me>("/v1/me"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar tu sesión.");
    }
  }, []);

  useEffect(() => {
    // La carga de /me actualiza el estado cuando responde la API (no de forma síncrona).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recargar();
  }, [recargar, intento]);

  const sesion = useMemo<Sesion | null>(() => {
    if (!me) return null;
    const mods = new Map(me.modules.map((m) => [m.code, m]));
    // Una marca o local guardado que ya no está en el alcance vuelve a "todas".
    const marcaOk = marca === "ALL" || me.brands.some((b) => b.id === marca) ? marca : "ALL";
    const localOk = local === "ALL" || me.establishments.some((e) => e.id === local) ? local : "ALL";
    return {
      me,
      marca: marcaOk,
      local: localOk,
      setMarca: (id) => (setMarcaState(id), guardar("aycha-marca", id)),
      setLocal: (id) => (setLocalState(id), guardar("aycha-local", id)),
      can: (p) => me.permissions.includes("*") || me.permissions.includes(p),
      puede: (code, accion = "L") => {
        const m = mods.get(code);
        return Boolean(m?.enabled && m.actions.includes(accion));
      },
      recargar,
    };
  }, [me, marca, local, recargar]);

  const estado = useMemo<Estado>(
    () => ({ sesion, cargando: !me && !error, error, reintentar: () => setIntento((n) => n + 1) }),
    [sesion, me, error],
  );

  return <Ctx.Provider value={estado}>{children}</Ctx.Provider>;
}

/** Para el armazón: la sesión puede no haber cargado todavía. */
export function useEstadoSesion() {
  const e = useContext(Ctx);
  if (!e) throw new Error("useEstadoSesion fuera de SesionProvider");
  return e;
}

/** Para las pantallas: el armazón solo las monta con la sesión cargada. */
export function useSesion(): Sesion {
  const s = useEstadoSesion().sesion;
  if (!s) throw new Error("useSesion antes de cargar la sesión");
  return s;
}
