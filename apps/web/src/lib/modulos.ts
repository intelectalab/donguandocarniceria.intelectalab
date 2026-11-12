import catalogo from "./modulos.json";
import menu from "./menu.json";

// Catálogo de módulos y pantallas (modulos.json) y estructura del menú (menu.json): grupos en su
// orden y pantallas restringidas por rol. El orden del menú y del inicio sale de aquí: no reordenar a mano.
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

/** Dirección de una pantalla: /m/ped/ped-02, con el código de la pantalla. */
export const rutaPantalla = (modulo: string, pantalla: string) => `/m/${modulo.toLowerCase()}/${pantalla.toLowerCase()}`;
export const moduloPorCodigo = (code: string) => MODULOS.find((m) => m.code === code.toUpperCase());

/**
 * Grupos del menú en su orden, con sus módulos en orden. Las fases (F0 a F4) son la planificación
 * de la entrega, no algo del sistema: no se muestran.
 */
export const GRUPOS = menu.groups as { name: string; mods: string[] }[];

/** Grupo del menú de un módulo. */
export const grupoDe = (code: string) => GRUPOS.find((g) => g.mods.includes(code.toUpperCase()))?.name;

/** Pantallas que ve cada rol en ciertos módulos: el resto del módulo no le sale. */
const SOLO = menu.screenOnly as Record<string, Record<string, string[]>>;

/**
 * Pantallas de la spec que no son del menú: pasan antes de entrar al sistema y ya tienen su página
 * propia. Ingreso (/login), segundo factor al ingresar, olvidé mi contraseña (/forgot-password) y
 * nueva contraseña (/reset-password). Activar el segundo factor queda en el ingreso y en Mi cuenta.
 */
const FUERA_DEL_MENU = new Set(["SEG-01", "SEG-02", "SEG-03", "SEG-04", "SEG-05"]);

/**
 * Si una pantalla se le muestra a una persona con uno o más roles: respeta las pantallas restringidas
 * por rol y las que la spec reserva a ciertos roles (gerencia y auditoría ven todas).
 */
export function pantallaVisible(modulo: string, p: Pantalla, roles: string[]) {
  if (FUERA_DEL_MENU.has(p.code)) return false;
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
 * Pantallas que se abren con un permiso aunque el rol no tenga el módulo: solo esa pantalla, sin el
 * resto del módulo. El coordinador de delivery aprueba celulares en Dispositivos sin ver Seguridad.
 * La API revisa lo mismo: esas pantallas piden el permiso, no el acceso al módulo.
 */
const POR_PERMISO: Record<string, Record<string, string>> = {
  SEG: { "SEG-13": "seg.device.approve" },
};

/**
 * Menú de la persona: los grupos en su orden; un módulo sale si el rol lo puede ver (letra L o C)
 * y tiene al menos una pantalla visible. Sin el módulo, solo las pantallas que abre un permiso suyo.
 */
export function menuDe(acceso: AccesoModulo[], roles: string[], permisos: string[] = []): GrupoDelMenu[] {
  const porCodigo = new Map(acceso.map((a) => [a.code, a]));
  return GRUPOS.map((g) => ({
    name: g.name,
    modulos: g.mods.flatMap((code) => {
      const a = porCodigo.get(code);
      const m = moduloPorCodigo(code);
      if (!a || !m) return [];
      const solo = POR_PERMISO[code] ?? {};
      const visibles = /[LC]/.test(a.actions)
        ? m.screens.filter((p) => pantallaVisible(code, p, roles))
        : m.screens.filter((p) => !FUERA_DEL_MENU.has(p.code) && solo[p.code] && permisos.includes(solo[p.code]));
      return visibles.length ? [{ ...m, enabled: a.enabled, actions: a.actions, visibles }] : [];
    }),
  })).filter((g) => g.modulos.length > 0);
}

/** Las pantallas de un módulo que la persona ve en su menú (vacío si el módulo no le sale). */
export const pantallasDelMenu = (codigo: string, acceso: AccesoModulo[], roles: string[], permisos: string[] = []) =>
  menuDe(acceso, roles, permisos).flatMap((g) => g.modulos).find((m) => m.code === codigo.toUpperCase())?.visibles ?? [];
