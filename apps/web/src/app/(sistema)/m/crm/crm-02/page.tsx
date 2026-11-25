"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { useSesion } from "@/lib/sesion";
import { Conversacion, PanelCliente, type Ficha } from "@/modulos/crm/conversacion";

/**
 * CRM-02 Conversación: el hilo completo con texto, fotos, audios transcritos y ubicación; responder con atajos y ver
 * cuánto cuesta el próximo mensaje. Al costado, la ficha del cliente o del lead.
 */
function VerConversacion() {
  const params = useSearchParams();
  const { can } = useSesion();
  const permitido = Boolean(can("crm.conversation.view_own") || can("crm.conversation.view_all"));
  const [id, setId] = useState<string | null>(params.get("id"));
  const [c, setC] = useState<Ficha | null>(null);
  const [error, setError] = useState("");

  // Sin id, la primera abierta asignada a mí (o la primera visible).
  useEffect(() => {
    if (id || !permitido) return;
    api<{ data: { id: string }[] }>("/v1/crm/conversaciones?asignada=me&per_page=1")
      .then((r) => r.data[0]?.id ?? api<{ data: { id: string }[] }>("/v1/crm/conversaciones?per_page=1").then((x) => x.data[0]?.id ?? null))
      .then((x) => { if (x) setId(x); else setError("No hay conversaciones abiertas para tu usuario."); })
      .catch((e) => setError(mensajeDe(e)));
  }, [id, permitido]);

  const cargar = useCallback(() => {
    if (!id) return;
    api<Ficha>(`/v1/crm/conversaciones/${id}`).then((r) => { setC(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [id]);
  useEffect(() => cargar(), [cargar]);
  useEffect(() => {
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [cargar]);

  if (!permitido) return <Alert tone="warn">Tu rol no atiende chats.</Alert>;
  return (
    <div className="grid gap-5">
      <PageHeader description="El hilo completo con texto, fotos, audios transcritos y ubicación. Responde con atajos y mira cuánto cuesta el próximo mensaje. Los mensajes no se editan ni se borran."
        actions={<Link href="/m/crm/crm-01" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink hover:bg-surface-2"><ArrowLeft className="size-4" />Bandeja</Link>} />
      {error && <Alert tone={c ? "bad" : "info"}>{error}</Alert>}
      {c && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Conversacion c={c} onCambio={setC} />
          <PanelCliente c={c} />
        </div>
      )}
      {!c && !error && <p className="text-[13px] text-muted">Cargando…</p>}
    </div>
  );
}

export default function Page() {
  return <Suspense><VerConversacion /></Suspense>;
}
