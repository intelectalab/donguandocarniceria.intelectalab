"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Field, PageHeader, Select } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { HistoriaRegistro } from "@/modulos/aud/comunes";

type Opcion = { value: string; label: string };
type Registros = { tablas: Opcion[]; tabla: string | null; registros: { id: string; label: string }[] };

/**
 * AUD-02 Historia del registro: la línea de tiempo de cambios y accesos de un registro, según tus permisos. Es la misma
 * pestaña «Historia» que llevan las fichas; aquí se elige el registro.
 */
function Historia() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSesion();
  const permitido = Boolean(can("aud.record_history.view"));
  const pedida = params.get("tabla") ?? "";
  const id = params.get("id") ?? "";
  const [datos, setDatos] = useState<Registros | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!permitido) return;
    let vivo = true;
    api<Registros>(`/v1/aud/historia/registros${pedida ? `?tabla=${pedida}` : ""}`).then((r) => vivo && setDatos(r)).catch((e) => vivo && setError(mensajeDe(e)));
    return () => { vivo = false; };
  }, [pedida, permitido]);
  // Sin tipo elegido: el primero que tiene historia.
  const tabla = pedida || datos?.tabla || "";

  const ir = (t: string, i = "") => router.replace(`/m/aud/aud-02?tabla=${t}${i ? `&id=${i}` : ""}`, { scroll: false });
  // Sin registro elegido: el más reciente con historia.
  const elegido = id || datos?.registros[0]?.id || "";

  if (!permitido) return <Alert tone="info">Tu rol no ve la historia de los registros.</Alert>;
  return (
    <div className="grid gap-5">
      <PageHeader description="La línea de tiempo de un registro: cada cambio, con quién y el antes y el después, y los accesos a él. Es la misma pestaña «Historia» de las fichas; aquí eliges el registro." />
      {error && <Alert tone="bad">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-3xl">
        <Field label="Tipo de registro">
          <Select value={tabla} onChange={(e) => ir(e.target.value)} placeholder={datos && !datos.tablas.length ? "No hay registros con historia" : undefined} options={datos?.tablas ?? []} />
        </Field>
        <Field label="Registro" hint="Los que tienen cambios registrados, los más recientes primero.">
          <Select value={elegido} onChange={(e) => ir(tabla, e.target.value)} placeholder={datos && !datos.registros.length ? "No hay registros con historia" : undefined}
            options={(datos?.registros ?? []).map((r) => ({ value: r.id, label: r.label }))} />
        </Field>
      </div>
      {tabla && elegido && <HistoriaRegistro key={`${tabla}|${elegido}`} tabla={tabla} id={elegido} />}
    </div>
  );
}

export default function Page() {
  return <Suspense><Historia /></Suspense>;
}
