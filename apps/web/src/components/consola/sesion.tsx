"use client";

import { createContext, useContext } from "react";
import type { UsuarioConsola } from "@/lib/consola";

export const SesionConsola = createContext<UsuarioConsola | null>(null);

/** Usuario de la consola con sesión (dentro del panel de la consola siempre hay uno). */
export const useUsuarioConsola = () => useContext(SesionConsola) as UsuarioConsola;
