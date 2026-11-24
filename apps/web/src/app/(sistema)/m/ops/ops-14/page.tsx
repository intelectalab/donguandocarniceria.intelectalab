"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Accesos de soporte del menú de Soporte: es la pestaña «Accesos de soporte» de Ayuda y soporte. */
export default function AccesosDeSoporte() {
  const router = useRouter();
  useEffect(() => router.replace("/soporte?tab=accesos"), [router]);
  return null;
}
