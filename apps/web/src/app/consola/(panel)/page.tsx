import { redirect } from "next/navigation";

// Inicio de la consola: la lista de empresas (OPS-02).
export default function InicioConsola() {
  redirect("/consola/empresas");
}
