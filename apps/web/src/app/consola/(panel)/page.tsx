import { redirect } from "next/navigation";

// Inicio de la consola: por ahora, Usuarios de plataforma (la lista de empresas llega en la tanda 2).
export default function InicioConsola() {
  redirect("/consola/usuarios");
}
