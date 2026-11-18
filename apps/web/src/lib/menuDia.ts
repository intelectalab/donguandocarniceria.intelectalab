import { moduloPorCodigo, rutaPantalla, type GrupoDelMenu } from "./modulos";

/**
 * «Lo de todos los días»: las pantallas del trabajo diario de cada puesto, como en el prototipo, más
 * las que la persona fija con la estrella. Es un grupo más arriba del menú: el menú completo no cambia.
 */
export const ESENCIALES: Record<string, string[]> = {
  GERENTE: ["TAB-01", "TAB-11", "PED-14", "PED-01", "POS-02", "CAJ-13", "CAJ-11", "ALM-02", "GAS-03", "DEL-07", "CON-13", "CAT-13"],
  ADMIN_SISTEMA: ["ONB-02", "SEG-08", "ONB-14", "PLT-03", "PLT-04", "PLT-08", "WEB-09", "SUS-01", "INT-12"],
  ADMINISTRACION: ["TAB-01", "TAB-11", "FAC-01", "CAJ-03", "CAJ-11", "CAJ-13", "GAS-03", "COM-09", "CON-13", "DEL-23", "SUS-01"],
  SUPERVISORA_VENTAS: ["PED-14", "PED-01", "PED-02", "CRM-01", "CRM-06", "CLI-01", "PED-10", "TAB-03", "TAB-11"],
  VENDEDORA: ["CRM-01", "PED-02", "PED-01", "CLI-01", "CRM-17", "CRM-05", "TAB-02", "TAB-11"],
  CAJERO: ["POS-02", "POS-01", "POS-07", "POS-10", "POS-12", "POS-09", "CLI-01"],
  ALMACENERO: ["ALM-02", "ALM-04", "ALM-07", "ALM-08", "ALM-09", "ALM-11", "COM-06", "PRE-11"],
  PREPARADOR: ["PRE-11", "PRE-03", "PRE-04", "PRE-05", "PRE-07", "PRE-08"],
  COORDINADOR_DELIVERY: ["DEL-01", "DEL-02", "DEL-07", "DEL-22", "DEL-23", "DEL-24", "DEL-16", "TAB-04"],
  REPARTIDOR: ["DEL-04", "DEL-05", "DEL-17", "DEL-21", "DEL-06"],
  MARKETING: ["TAB-06", "TAB-11", "CMP-03", "CMP-04", "ADS-05", "CRM-05", "WEB-04", "CAT-09"],
  JEFE_PRODUCCION: ["PRO-12", "PRO-04", "PRO-05", "PRO-02", "DES-04", "DES-09", "TAB-05"],
  OPERARIO_PRODUCCION: ["PRO-04", "PRO-08", "DES-04", "CAL-05"],
  CALIDAD: ["CAL-13", "CAL-03", "CAL-05", "CAL-06", "CAL-07", "CAL-08"],
  COMPRAS: ["COM-12", "COM-03", "COM-04", "COM-06", "COM-09", "COM-01"],
  CONTADORA: ["CNT-16", "CNT-05", "CNT-03", "CNT-07", "FAC-12", "GAS-09", "CNT-12"],
  PRACTICANTE_CONTABLE: ["CNT-05", "CNT-03", "GAS-09", "FAC-12"],
  VISITADOR_CONSIGNACION: ["CON-08", "CON-09", "CON-10", "CON-11", "CON-12", "CON-06"],
  RRHH: ["PER-08", "PER-05", "PER-11", "PER-12", "MAE-01"],
};

export type PantallaDelDia = { href: string; label: string; code: string; modulo: string; fijada: boolean };

/**
 * Las pantallas de «Lo de todos los días»: las del puesto y luego las fijadas, sin repetir y solo las
 * que la persona ve en su menú (un módulo apagado, sin acceso o una pantalla que su rol no ve no sale).
 */
export function pantallasDelDia(menu: GrupoDelMenu[], roles: string[], fijadas: string[]): PantallaDelDia[] {
  const visibles = new Map<string, { label: string; modulo: string; code: string }>();
  for (const g of menu) for (const m of g.modulos) if (m.enabled) for (const p of m.visibles) visibles.set(p.code, { label: p.name, modulo: m.name, code: m.code });
  const fijo = new Set(fijadas);
  const codigos = [...roles.flatMap((r) => ESENCIALES[r] ?? []), ...fijadas];
  const vistos = new Set<string>();
  const out: PantallaDelDia[] = [];
  for (const code of codigos) {
    const p = visibles.get(code);
    if (!p || vistos.has(code)) continue;
    vistos.add(code);
    out.push({ href: rutaPantalla(p.code, code), label: p.label, code, modulo: moduloPorCodigo(p.code)?.name ?? p.modulo, fijada: fijo.has(code) });
  }
  return out;
}
