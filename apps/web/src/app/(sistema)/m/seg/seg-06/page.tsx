"use client";

import { PageHeader } from "@/components/ui";
import { MiCuenta } from "@/modulos/seg/MiCuenta";

/** SEG-06 Mi cuenta. La misma pantalla está en «Mi perfil», para quien no tiene el módulo de Seguridad. */
export default function PantallaMiCuenta() {
  return (
    <div className="space-y-5">
      <PageHeader description="Tus datos, contraseña, segundo factor, marca por defecto, modo de color, avisos y sesiones. Todo queda en la bitácora de accesos." />
      <MiCuenta />
    </div>
  );
}
