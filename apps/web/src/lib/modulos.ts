import catalogo from "./modulos.json";
import menuPrototipo from "./menu-prototipo.json";

// Catálogo de módulos y pantallas de la spec (generado desde aycha-proto: dist/spec.json y el prototipo)
// y la estructura del menú del prototipo (G.GROUPS y G.SCREEN_ONLY de src/js/04-shell.js y 00-core.js).
// El orden del menú y del inicio sale de aquí: no reordenar a mano.
export type Pantalla = { code: string; name: string; desc: string; roles: string[] | null };
export type ModuloCatalogo = {
  code: string;
  name: string;
  title: string;
  phase: number;
  objective: string;
  screens: Pantalla[];
};

export const MODULOS = catalogo as ModuloCatalogo[];

/** Dirección de una pantalla: /m/ped/ped-02 (el código de la spec, como el prototipo). */
export const rutaPantalla = (modulo: string, pantalla: string) => `/m/${modulo.toLowerCase()}/${pantalla.toLowerCase()}`;
export const moduloPorCodigo = (code: string) => MODULOS.find((m) => m.code === code.toUpperCase());

/**
 * Grupos del menú, en el orden del prototipo, con sus módulos en orden. Las fases (F0 a F4) son
 * la planificación de la entrega, no algo del sistema: no se muestran.
 */
export const GRUPOS = menuPrototipo.groups as { name: string; mods: string[] }[];

/** Grupo del menú de un módulo. */
export const grupoDe = (code: string) => GRUPOS.find((g) => g.mods.includes(code.toUpperCase()))?.name;

/** Pantallas que ve cada rol en ciertos módulos (G.SCREEN_ONLY): el resto del módulo no le sale. */
const SOLO = menuPrototipo.screenOnly as Record<string, Record<string, string[]>>;

/** G.screenVisible del prototipo, para una persona con uno o más roles. */
export function pantallaVisible(modulo: string, p: Pantalla, roles: string[]) {
  return roles.some((rol) => {
    const solo = SOLO[rol]?.[modulo];
    if (solo && !solo.includes(p.code)) return false;
    if (rol === "CLIENTE_B2B") return Boolean(p.roles?.includes("CLIENTE_B2B"));
    if (p.roles && !["GERENTE", "AUDITOR"].includes(rol) && !p.roles.includes(rol)) return false;
    return true;
  });
}

type AccesoModulo = { code: string; enabled: boolean; actions: string };
export type ModuloDelMenu = ModuloCatalogo & { enabled: boolean; actions: string; visibles: Pantalla[] };
export type GrupoDelMenu = { name: string; modulos: ModuloDelMenu[] };

/**
 * Menú de la persona, como lo arma el prototipo: grupos de G.GROUPS en su orden; un módulo sale si
 * el rol lo puede ver (letra L o C) y tiene al menos una pantalla visible.
 */
export function menuDe(acceso: AccesoModulo[], roles: string[]): GrupoDelMenu[] {
  const porCodigo = new Map(acceso.map((a) => [a.code, a]));
  return GRUPOS.map((g) => ({
    name: g.name,
    modulos: g.mods.flatMap((code) => {
      const a = porCodigo.get(code);
      const m = moduloPorCodigo(code);
      if (!a || !m || !/[LC]/.test(a.actions)) return [];
      const visibles = m.screens.filter((p) => pantallaVisible(code, p, roles));
      return visibles.length ? [{ ...m, enabled: a.enabled, actions: a.actions, visibles }] : [];
    }),
  })).filter((g) => g.modulos.length > 0);
}
