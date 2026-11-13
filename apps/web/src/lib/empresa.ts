"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Empresa de la pantalla de ingreso (pública). En el ingreso general (general: true) todavía no
 * hay empresa y sale la marca de GestionCarnica; con dominio por empresa, la de esa empresa.
 */
export type Empresa = {
  general: boolean;
  name: string;
  short: string;
  trade_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  brands: { code: string; name: string; primary_color: string; logo_url: string | null }[];
};

export function useEmpresa() {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    api<Empresa>("/v1/tenant")
      .then((e) => vigente && setEmpresa(e))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo identificar la empresa."));
    return () => {
      vigente = false;
    };
  }, []);

  return { empresa, error, listo: empresa !== null || error !== null };
}

/** Oscurece un color hasta que el texto blanco se lea encima (contraste 4,5:1). */
export function legibleConBlanco(hex: string): [number, number, number] {
  let rgb = (hex.replace("#", "").match(/../g) ?? ["92", "22", "42"]).map((h) => parseInt(h, 16)) as [number, number, number];
  const lum = ([r, g, b]: number[]) => {
    const c = [r, g, b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (let i = 0; i < 20 && 1.05 / (lum(rgb) + 0.05) < 4.5; i++) rgb = rgb.map((v) => v * 0.9) as [number, number, number];
  return rgb;
}

export const iniciales = (nombre: string) =>
  nombre.split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "A";
