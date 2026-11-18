import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";

// Página pública de GestionCarnica (landing), como la de erp-saas: en «/», con o sin sesión. El sistema está en /inicio.
export const metadata: Metadata = {
  title: "GestionCarnica · El sistema para empresas cárnicas",
  description:
    "Carnicerías, avícolas, distribuidoras y plantas de proceso: pedidos de WhatsApp, web y mostrador, despiece con costo real, cadena de frío, reparto y comprobantes electrónicos en un solo lugar.",
};

export default function PaginaPublica() {
  return <Landing />;
}
