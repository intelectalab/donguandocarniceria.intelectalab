import { Suspense } from "react";
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  // useSearchParams (?volver=…) necesita un límite de Suspense.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
