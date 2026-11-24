import type { Metadata } from "next";
import PaginaRegistro from "@/components/landing/Registro";

// Registro de una empresa desde la página pública (ONB-01): con o sin sesión, en el dominio de la página.
export const metadata: Metadata = {
  title: "Crea tu cuenta · GestionCarnica",
  description: "Prueba GestionCarnica gratis con tu RUC: sin tarjeta, sin contrato de permanencia y con los módulos de tu plan desde el primer día.",
};

export default function Registro() {
  return <PaginaRegistro />;
}
