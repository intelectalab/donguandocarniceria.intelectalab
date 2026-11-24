"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Field, PageHeader, Select, Switch, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";

type Canal = "in_app" | "email" | "push";
type Fila = { type: string; name: string; fijo: boolean; in_app: boolean; email: boolean; push: boolean };
type Datos = { usuario: { id: string; name: string }; data: Fila[]; puede_elegir: boolean; usuarios: { id: string; name: string; roles: string | null }[] };

const CANALES: [Canal, string][] = [["in_app", "En la app"], ["email", "Correo"], ["push", "Push (Android)"]];

/**
 * INT-10 Preferencias de notificación: por tipo de aviso, en qué canal recibirlo (en la app, correo o push). Los avisos
 * críticos llegan siempre y no se pueden apagar. Gerencia y administración del sistema pueden ajustar las de otra persona.
 */
function Preferencias() {
  const router = useRouter();
  const usuario = useSearchParams().get("user") ?? "";
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState("");

  const cargar = useCallback(() => {
    api<Datos>(`/v1/int/preferencias${usuario ? `?user=${usuario}` : ""}`).then((r) => { setDatos(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [usuario]);
  useEffect(() => cargar(), [cargar]);

  async function cambiar(fila: Fila, canal: Canal, valor: boolean) {
    if (!datos) return;
    const clave = `${fila.type}|${canal}`;
    setGuardando(clave);
    // Se ve al instante; si falla, se recarga lo guardado.
    setDatos({ ...datos, data: datos.data.map((x) => (x.type === fila.type ? { ...x, [canal]: valor } : x)) });
    try {
      const r = await api<Datos>("/v1/int/preferencias", { method: "PUT", body: { user: datos.usuario.id, type: fila.type, [canal]: valor } });
      setDatos(r);
      toast.ok("Preferencia guardada");
    } catch (e) {
      toast.error(mensajeDe(e));
      cargar();
    } finally {
      setGuardando("");
    }
  }

  return (
    <div className="grid gap-5">
      <PageHeader description="Elige por tipo de aviso en qué canal recibirlo: en la app, por correo o como push en la app Android. Los avisos críticos llegan siempre por todos los canales y no se pueden apagar." />
      <Alert tone="info">Apagar «En la app» oculta ese tipo de aviso en la campana y en el centro de notificaciones. El correo y el push quedan guardados y se enviarán cuando estén configurados sus conectores; el push es solo para la app Android.</Alert>
      {error && <Alert tone="bad">{error}</Alert>}
      {datos?.puede_elegir && (
        <div className="max-w-md">
          <Field label="Persona">
            <Select value={datos.usuario.id} onChange={(e) => router.replace(`/m/int/int-10?user=${e.target.value}`, { scroll: false })}
              options={datos.usuarios.map((u) => ({ value: u.id, label: u.roles ? `${u.name} · ${u.roles}` : u.name }))} />
          </Field>
        </div>
      )}
      {datos && (
        <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <header className="border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-semibold text-ink">{datos.usuario.name}</h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                  <th scope="col" className="px-4 py-2.5">Tipo de aviso</th>
                  {CANALES.map(([c, nombre]) => <th key={c} scope="col" className="px-4 py-2.5 text-center">{nombre}</th>)}
                </tr>
              </thead>
              <tbody>
                {datos.data.map((fila) => (
                  <tr key={fila.type} className="border-b border-line last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-ink">{fila.name}</p>
                      {fila.fijo && <p className="text-[12px] text-muted">Siempre activos</p>}
                    </td>
                    {CANALES.map(([c, nombre]) => (
                      <td key={c} className="px-4 py-3 text-center">
                        <span className="inline-flex justify-center">
                          <Switch checked={fila[c]} disabled={fila.fijo || guardando === `${fila.type}|${c}`} onChange={(v) => cambiar(fila, c, v)}
                            label={`${fila.name}: ${nombre}`} />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export default function Page() {
  return <Suspense><Preferencias /></Suspense>;
}
