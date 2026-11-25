"use client";

import Link from "next/link";
import { Alert } from "@/components/ui";
import { useSesion } from "@/lib/sesion";

/** Telefonía llega apagada (RN-TEL-01): mientras lo esté, sus pantallas solo explican cómo encenderla. */
export function useTelefonia() {
  const { puede } = useSesion();
  return Boolean(puede("TEL"));
}

export function TelefoniaApagada() {
  return (
    <Alert tone="info">
      Telefonía está incluida pero apagada: la decisión de gerencia es activarla más adelante. Para encenderla, completa su lista de activación en{" "}
      <Link href="/m/plt/plt-12" className="font-semibold underline">Módulos activables</Link>. Mientras esté apagada no se configura ni se cursa ninguna llamada.
    </Alert>
  );
}
