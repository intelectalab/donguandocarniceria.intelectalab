"use client";

import { useEffect, useState } from "react";
import { Copy, Play, RotateCcw } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Input, Modal, Select, Textarea, toast, type Tone } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";

export type Clave = {
  id: string; name: string; description: string | null; environment: "LIVE" | "TEST"; entorno: string; prefix: string; huella: string; scopes: string[];
  alcances: { code: string; name: string; is_write: boolean }[]; escritura: boolean; brand_ids: string[]; marcas: string[]; allowed_ips: string[];
  customer_id: string | null; cliente: string | null; channel: string; canal: string; expires_at: string; dias: number; status: "ACTIVE" | "REVOKED" | "EXPIRED"; estado: string;
  creo: string | null; created_at: string; revoked_at: string | null; revoco: string | null; revoke_reason: string | null; last_used_at: string | null; last_ip: string | null;
};
export type Alcance = { code: string; name: string; module_code: string; modulo: string; description: string; is_write: boolean; rutas: { metodo: string; ruta: string; nombre: string }[] };

export type DestinoWebhook = {
  id: string; name: string; description: string | null; url: string; host: string; resolved_ip: string; ip_privada: boolean;
  environment: "LIVE" | "TEST"; entorno: string; events: string[]; brand_ids: string[]; marcas: string[];
  customer_id: string | null; cliente: string | null; sim_mode: string; simulador: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED"; estado: string; secret_last4: string; secret_version: number;
  prev_last4: string | null; prev_valid_until: string | null; prev_vigente: boolean; rotated_at: string | null;
  failure_streak: number; limite_fallos: number; last_delivery_at: string | null; last_delivery_status: string | null;
  disabled_at: string | null; disabled_reason: string | null; status_reason: string | null;
  entregas_count: number; created_at: string; ultimas_entregas?: EntregaWebhook[];
};

export type EntregaWebhook = {
  id: string; number: string; endpoint_id: string; endpoint_name: string; endpoint_url?: string | null; endpoint_status?: string | null;
  environment: "LIVE" | "TEST"; entorno: string; event_id: string; event_type: string; event_version: string;
  occurred_at: string; payload: string; signature: string | null;
  status: "PENDING" | "RETRYING" | "DELIVERED" | "DEAD"; estado: string;
  attempts: number; max_attempts: number; next_attempt_at: string | null; delivered_at: string | null; dead_at: string | null;
  resent_from: string | null; resent_from_number: string | null; resent_to: string | null; resent_to_number: string | null; resent_at: string | null;
  last_http: number | null; last_error: string | null; is_test: boolean; created_at: string;
};

export type IntentoWebhook = {
  id: string; attempt_no: number; at: string; http_status: number | null; duration_ms: number; ok: boolean;
  resolved_ip: string | null; response_snippet: string | null; error: string | null;
  signature: string; secret_version: number; wait_next_min: number | null;
};

export type OperacionDoc = {
  method: "GET" | "POST"; path: string; scope: string; write: boolean; name: string; description: string;
  params: { name: string; in: string; description: string }[];
  ejemplo?: { req: Record<string, unknown> | null; res: unknown };
};

export const TONO_ESTADO: Record<string, Tone> = { ACTIVE: "ok", REVOKED: "neutral", EXPIRED: "bad" };
export const TONO_DESTINO: Record<string, Tone> = { ACTIVE: "ok", PAUSED: "warn", DISABLED: "bad" };
export const TONO_ENTREGA: Record<string, Tone> = { DELIVERED: "ok", PENDING: "info", RETRYING: "warn", DEAD: "bad" };

export function Entorno({ e }: { e: string }) {
  return e === "TEST" ? <Badge tone="info">Pruebas</Badge> : <Badge tone="neutral">Producción</Badge>;
}

export function EstadoHttp({ s }: { s: number | null | undefined }) {
  if (!s) return <Badge tone="bad">sin respuesta</Badge>;
  const tono: Tone = s >= 200 && s < 300 ? "ok" : s === 429 || s === 409 ? "warn" : s >= 400 ? "bad" : "info";
  return <Badge tone={tono}>{s}</Badge>;
}

export function formatearEspera(min: number | null | undefined): string {
  if (!min) return "—";
  if (min >= 1440) return `${numero(min / 1440, min % 1440 ? 1 : 0)} d`;
  if (min >= 60) return `${numero(min / 60, min % 60 ? 1 : 0)} h`;
  return `${min} min`;
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

/** Secreto de firma de un destino de webhook (al crearlo o rotarlo). */
export function SecretoWebhookUnaVez({ secret, titulo, nombre, onClose }: { secret: string; titulo: string; nombre: string; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(secret); setCopiado(true); toast.ok("Secreto copiado"); } catch { toast.error("No se pudo copiar."); }
  }
  return (
    <Modal open onClose={onClose} dismissable={false} title={titulo} description={nombre}
      footer={<><Button variant="ghost" icon={Copy} onClick={copiar}>{copiado ? "Copiado" : "Copiar secreto"}</Button><Button variant="primary" onClick={onClose}>Listo</Button></>}>
      <div className="grid gap-4">
        <Alert tone="warn">Se muestra una sola vez. Configúralo en el receptor para validar la cabecera <span className="font-mono">GestionCarnica-Signature</span>.</Alert>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[13px] break-all whitespace-pre-wrap text-ink select-all">{secret}</pre>
      </div>
    </Modal>
  );
}

type ClaveOpcion = { id: string; name: string; prefix: string; environment: string; status: string; estado: string };
type RespConsola = { status: number; ms: number; headers: Record<string, string>; body: unknown; curl: string; replayed: boolean };

/** Consola interactiva para probar operaciones de /api/publica/v1 (usada en API-08 y API-09). */
export function ConsolaApi({ claves, operaciones, entornoFijo, ejemploPedido, onLlamada }: {
  claves: ClaveOpcion[];
  operaciones: OperacionDoc[];
  entornoFijo?: "LIVE" | "TEST";
  ejemploPedido?: Record<string, unknown>;
  onLlamada?: () => void;
}) {
  const filtradas = entornoFijo ? claves.filter((c) => c.environment === entornoFijo) : claves;
  const [keyId, setKeyId] = useState<string>(filtradas[0]?.id ?? "__paste");
  const [tokenPegado, setTokenPegado] = useState("");
  const [opIdx, setOpIdx] = useState(0);
  const [path, setPath] = useState("/orders?limit=5");
  const [ip, setIp] = useState("181.65.70.12");
  const [idemKey, setIdemKey] = useState(() => `erp-${Math.random().toString(36).slice(2, 10)}`);
  const [bodyStr, setBodyStr] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resp, setResp] = useState<RespConsola | null>(null);
  const [err, setErr] = useState("");

  const op = operaciones[opIdx] ?? operaciones[0];

  useEffect(() => {
    if (filtradas.length && keyId !== "__paste" && !filtradas.some((c) => c.id === keyId)) {
      setKeyId(filtradas[0].id);
    }
  }, [filtradas, keyId]);

  function aplicarEjemplo(idx: number) {
    const o = operaciones[idx] ?? operaciones[0];
    if (!o) return;
    const claveSel = filtradas.find((c) => c.id === keyId);
    const esTest = entornoFijo === "TEST" || claveSel?.environment === "TEST" || tokenPegado.startsWith("ak_test_");
    const numPedido = esTest ? "SBX-000001" : "P-000001";
    const sku = esTest ? "SBX-DG-CUY-ENT" : "DG-CUY-ENT";
    let p = o.path.replace("{number}", numPedido);
    if (o.path === "/stock" || o.path === "/prices") p += `?sku=${sku}`;
    else if (o.path === "/orders" && o.method === "GET") p += "?limit=5";
    setPath(p);
    if (o.method === "POST") {
      const ej = o.path === "/orders" && ejemploPedido ? ejemploPedido : o.ejemplo?.req ?? {};
      setBodyStr(JSON.stringify(ej, null, 2));
    } else {
      setBodyStr("");
    }
  }

  async function enviar() {
    if (!op) return;
    setErr("");
    let bodyJson: Record<string, unknown> | null = null;
    if (op.method === "POST" && bodyStr.trim()) {
      try {
        bodyJson = JSON.parse(bodyStr);
      } catch (e) {
        setErr("El cuerpo no es un JSON válido: " + (e instanceof Error ? e.message : ""));
        return;
      }
    }
    setEnviando(true);
    try {
      const r = await api<RespConsola>("/v1/api/consola/probar", {
        method: "POST",
        body: {
          key_id: keyId !== "__paste" ? keyId : null,
          token: keyId === "__paste" ? tokenPegado.trim() : null,
          method: op.method,
          path: path.trim(),
          ip: ip.trim(),
          idempotency_key: op.method === "POST" ? idemKey.trim() : null,
          body: bodyJson,
        },
      });
      setResp(r);
      onLlamada?.();
    } catch (e) {
      setErr(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }

  const opcionesClave = [
    ...filtradas.map((k) => ({ value: k.id, label: `${k.prefix}… · ${k.name}${k.status !== "ACTIVE" ? ` (${k.estado.toLowerCase()})` : ""}` })),
    { value: "__paste", label: "Pegar una clave completa…" },
  ];
  const opcionesOp = operaciones.map((o, i) => ({ value: String(i), label: `${o.method} ${o.path} · ${o.name}` }));

  return (
    <div className="grid gap-3">
      {!filtradas.length && <Alert tone="info">No hay claves en este entorno todavía. Crea una en Claves de API o pega un token completo.</Alert>}
      {err && <Alert tone="bad">{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clave (Authorization: Bearer)">
          <Select value={keyId} onChange={(e) => setKeyId(e.target.value)} options={opcionesClave} />
        </Field>
        <Field label="Operación">
          <Select value={String(opIdx)} onChange={(e) => { const idx = Number(e.target.value); setOpIdx(idx); aplicarEjemplo(idx); }} options={opcionesOp} />
        </Field>
        {keyId === "__paste" && (
          <Field label="Token completo" className="sm:col-span-2">
            <Input className="font-mono" placeholder="ak_live_xxxxxxxx_secreto" value={tokenPegado} onChange={(e) => setTokenPegado(e.target.value)} />
          </Field>
        )}
        <Field label="Ruta (/api/publica/v1…)">
          <Input className="font-mono" value={path} onChange={(e) => setPath(e.target.value)} />
        </Field>
        <Field label="IP de origen (simulada)">
          <Input className="font-mono" value={ip} onChange={(e) => setIp(e.target.value)} />
        </Field>
      </div>
      {op?.method === "POST" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Idempotency-Key" hint="Repetir la llamada con la misma clave devuelve la respuesta guardada sin duplicar.">
            <div className="flex gap-2">
              <Input className="font-mono" value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />
              <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setIdemKey(`erp-${Math.random().toString(36).slice(2, 10)}`)}>Nueva</Button>
            </div>
          </Field>
          <Field label="Cuerpo JSON" className="sm:col-span-2">
            <Textarea rows={6} className="font-mono text-[12.5px]" value={bodyStr} onChange={(e) => setBodyStr(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={Play} loading={enviando} onClick={enviar}>Enviar llamada</Button>
        <Button variant="ghost" loading={enviando} onClick={enviar}>Repetir la misma llamada</Button>
      </div>
      {resp && (
        <div className="grid gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <EstadoHttp s={resp.status} />
            <span className="font-mono font-semibold text-ink">{op?.method} {path}</span>
            <span className="text-muted">{resp.ms} ms</span>
            {resp.replayed && <Badge tone="info">Respuesta repetida (misma Idempotency-Key)</Badge>}
            {resp.headers["Retry-After"] && <Badge tone="warn">Retry-After: {resp.headers["Retry-After"]} s</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11.5px] font-semibold text-muted">Cabeceras de respuesta</p>
              <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-surface p-2.5 font-mono text-[11.5px] text-ink">
                {Object.entries(resp.headers).map(([k, v]) => `${k}: ${v}`).join("\n")}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[11.5px] font-semibold text-muted">Equivalente en curl</p>
              <pre className="max-h-40 overflow-auto rounded-lg border border-line bg-surface p-2.5 font-mono text-[11.5px] whitespace-pre-wrap text-ink">
                {resp.curl}
              </pre>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11.5px] font-semibold text-muted">Cuerpo de respuesta</p>
            <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-surface p-2.5 font-mono text-[12px] whitespace-pre-wrap text-ink">
              {JSON.stringify(resp.body, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
