"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Pantalla del menú de Suscripción: es una pestaña de «Mi suscripción». */
export default function IrAMiSuscripcion() {
  const router = useRouter();
  useEffect(() => router.replace("/suscripcion?tab=comprobantes"), [router]);
  return null;
}
