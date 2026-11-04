import AppShell from "@/components/layout/AppShell";
import { SesionProvider } from "@/lib/sesion";

// Todas las pantallas del sistema: requieren sesión (proxy.ts) y cargan /me una vez.
export default function SistemaLayout({ children }: LayoutProps<"/">) {
  return (
    <SesionProvider>
      <AppShell>{children}</AppShell>
    </SesionProvider>
  );
}
