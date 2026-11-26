"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Alert, Badge, Button, DetailList, Modal, toast, type Tone } from "@/components/ui";
import { fecha } from "@/lib/formato";

export type Clave = {
  id: string; name: string; description: string | null; environment: "LIVE" | "TEST"; entorno: string; prefix: string; huella: string; scopes: string[];
  alcances: { code: string; name: string; is_write: boolean }[]; escritura: boolean; brand_ids: string[]; marcas: string[]; allowed_ips: string[];
  customer_id: string | null; cliente: string | null; channel: string; canal: string; expires_at: string; dias: number; status: "ACTIVE" | "REVOKED" | "EXPIRED"; estado: string;
  creo: string | null; created_at: string; revoked_at: string | null; revoco: string | null; revoke_reason: string | null; last_used_at: string | null; last_ip: string | null;
};
export type Alcance = { code: string; name: string; module_code: string; modulo: string; description: string; is_write: boolean; rutas: { metodo: string; ruta: string; nombre: string }[] };

export const TONO_ESTADO: Record<string, Tone> = { ACTIVE: "ok", REVOKED: "neutral", EXPIRED: "bad" };

export function Entorno({ e }: { e: string }) {
  return e === "TEST" ? <Badge tone="info">Pruebas</Badge> : <Badge tone="neutral">Producción</Badge>;
}

export function Alcances({ items }: { items: { code: string; name: string; is_write: boolean }[] }) {
  return (
    <div className="flex max-w-[360px] flex-wrap gap-1">
      {items.map((s) => <span key={s.code} title={s.name} className={`rounded-md px-1.5 py-0.5 font-mono text-[11.5px] ${s.is_write ? "bg-warn/15 text-ink" : "bg-surface-2 text-muted"}`}>{s.code}</span>)}
    </div>
  );
}

/** El secreto se muestra una sola vez, al crear la clave. */
export function SecretoUnaVez({ token, clave, onClose }: { token: string; clave: Clave; onClose: () => void }) {
  const [copiada, setCopiada] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(token); setCopiada(true); toast.ok("Clave copiada"); } catch { toast.error("No se pudo copiar: selecciónala y cópiala a mano."); }
  }
  return (
    <Modal open onClose={onClose} dismissable={false} title="Copia tu clave ahora" description={clave.name}
      footer={<><Button variant="ghost" icon={Copy} onClick={copiar}>{copiada ? "Copiada" : "Copiar clave"}</Button><Button variant="primary" onClick={onClose}>Ya la guardé</Button></>}>
      <div className="grid gap-4">
        <Alert tone="warn">El secreto se muestra una sola vez. GestionCarnica guarda solo el prefijo y una huella del secreto: nadie podrá volver a verlo. Si se pierde, revoca la clave y crea otra.</Alert>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[13px] break-all whitespace-pre-wrap text-ink select-all">{token}</pre>
        <DetailList items={[{ label: "Prefijo", value: <span className="font-mono">{clave.prefix}</span> }, { label: "Entorno", value: clave.entorno }, { label: "Vence", value: fecha(clave.expires_at) }]} />
        <p className="text-[12.5px] text-muted">Guárdala en el gestor de secretos del sistema que la usará. Se envía en cada llamada como <span className="font-mono">Authorization: Bearer {clave.prefix}_…</span></p>
      </div>
    </Modal>
  );
}
