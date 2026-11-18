import type { Metadata } from "next";
import PaginaPrecios from "@/components/landing/Precios";

// Precios y planes de GestionCarnica (página pública, como la del prototipo): con o sin sesión.
export const metadata: Metadata = {
  title: "Precios y planes · GestionCarnica",
  description: "Un plan para cada tamaño de negocio: prueba 14 días gratis con todos los módulos, sin tarjeta, sin contrato de permanencia y sin comisiones por venta.",
};

export default function Precios() {
  return <PaginaPrecios />;
}
