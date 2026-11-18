import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  // Como en erp-saas: con dos dominios la página pública vive en SITE_URL; con uno solo, en la raíz de este.
  const sitio = process.env.SITE_URL?.replace(/\/+$/, "") ?? "";
  // useSearchParams (?volver=…) necesita un límite de Suspense.
  return (
    <Suspense>
      <LoginForm inicioUrl={`${sitio}/`} planesUrl={`${sitio}/#precios`} />
    </Suspense>
  );
}
