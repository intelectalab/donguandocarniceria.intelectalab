"use client";

import { MisSesiones } from "@/modulos/seg/MisSesiones";

/**
 * Mis sesiones y dispositivos (SEG-07) en el menú de la cuenta: la abre cualquier persona, tenga o no
 * el módulo de Seguridad. Se llega desde la cifra «Sesiones abiertas» de Mi cuenta.
 */
export default function MisSesionesDeLaCuenta() {
  return <MisSesiones />;
}
