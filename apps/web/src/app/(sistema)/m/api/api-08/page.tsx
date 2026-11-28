"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Alert, Button, DataTable, DetailList, Field, Input, PageHeader, Tabs, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { ConsolaApi, EstadoHttp, type OperacionDoc } from "@/modulos/api/comun";

type ErrorFila = { http: number; code: string; when: string };
type ClaveItem = { id: string; name: string; prefix: string; environment: string; entorno: string; status: string; estado: string; scopes: string[] };
type DocData = {
  base_produccion: string;
  base_sandbox: string;
  meses_aviso: number;
  tolerancia_firma_s: number;
  operaciones: OperacionDoc[];
  errores: ErrorFila[];
  claves: ClaveItem[];
  firma_ejemplo: { secret: string; t: string; body: string; v1: string; header: string };
  openapi: Record<string, unknown>;
};

/** API-08 Documentación: OpenAPI navegable generado de las rutas y alcances, tabla de errores, calculadora de firma HMAC y consola de prueba. */
export default function DocumentacionDeLaApi() {
  const [doc, setDoc] = useState<DocData | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState(0);
  const [langTab, setLangTab] = useState("node");
  const [sig, setSig] = useState({ secret: "whsec_prueba", t: "1760090400", body: '{"id":1}' });
  const [sigRes, setSigRes] = useState({ message: '1760090400.{"id":1}', v1: "", header: "" });

  useEffect(() => {
    api<DocData>("/v1/api/documentacion").then((r) => {
      setDoc(r);
      setSig({ secret: r.firma_ejemplo.secret, t: r.firma_ejemplo.t, body: r.firma_ejemplo.body });
      setSigRes({
        message: `${r.firma_ejemplo.t}.${r.firma_ejemplo.body}`,
        v1: r.firma_ejemplo.v1,
        header: r.firma_ejemplo.header,
      });
    }).catch((e) => setError(mensajeDe(e)));
  }, []);

  useEffect(() => {
    if (!sig.secret || !sig.t) return;
    const h = setTimeout(() => {
      api<{ message: string; v1: string; header: string }>("/v1/api/documentacion/firma", { method: "POST", body: sig })
        .then(setSigRes)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(h);
  }, [sig]);

  const porAlcance = useMemo(() => {
    const g = new Map<string, { idx: number; op: OperacionDoc }[]>();
    (doc?.operaciones ?? []).forEach((op, idx) => {
      g.set(op.scope, [...(g.get(op.scope) ?? []), { idx, op }]);
    });
    return [...g.entries()];
  }, [doc]);

  function descargarOpenApi() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc.openapi, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gestioncarnica-openapi-v1.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.ok("OpenAPI descargado");
  }

  const opActual = doc?.operaciones[sel] ?? doc?.operaciones[0];
  const tol = doc?.tolerancia_firma_s ?? 300;

  const colErrores: Column<ErrorFila>[] = [
    { key: "http", header: "HTTP", render: (x) => <EstadoHttp s={x.http} /> },
    { key: "code", header: "Código", render: (x) => <span className="font-mono text-[12px] text-ink">{x.code}</span> },
    { key: "when", header: "Cuándo ocurre", render: (x) => x.when },
  ];

  const codigoNode = `const crypto = require('crypto');

function verificar(cabecera, cuerpoCrudo, secreto, tolerancia = ${tol}) {
  const t = Number((cabecera.match(/t=(\\d+)/) || [])[1]);
  const firmas = [...cabecera.matchAll(/v1=([0-9a-f]{64})/g)].map(m => m[1]);
  if (!t || Math.abs(Date.now() / 1000 - t) > tolerancia) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(t + '.' + cuerpoCrudo).digest('hex');
  return firmas.some(f => crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada)));
}`;

  const codigoPhp = `function verificar(string $cabecera, string $cuerpoCrudo, string $secreto, int $tolerancia = ${tol}): bool {
  preg_match('/t=(\\d+)/', $cabecera, $t);
  preg_match_all('/v1=([0-9a-f]{64})/', $cabecera, $v1);
  if (!$t || abs(time() - (int) $t[1]) > $tolerancia) return false;
  $esperada = hash_hmac('sha256', $t[1] . '.' . $cuerpoCrudo, $secreto);
  foreach ($v1[1] as $f) if (hash_equals($esperada, $f)) return true;
  return false;
}`;

  return (
    <div className="grid gap-5">
      <PageHeader
        description="Especificación OpenAPI navegable generada de las rutas y alcances vigentes, con ejemplos ejecutados en el sandbox, tabla de errores, guía de firma de webhooks y consola de prueba."
        actions={doc && <Button variant="ghost" icon={Download} onClick={descargarOpenApi}>Descargar openapi.json</Button>}
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {doc && (
        <>
          <Alert tone="info">
            Base: <span className="font-mono font-semibold">{doc.base_produccion}</span> (producción) y <span className="font-mono font-semibold">{doc.base_sandbox}</span> (sandbox). Autenticación: <span className="font-mono">Authorization: Bearer ak_live_xxxxxxxx_secreto</span>. Versión en la ruta: agregar campos nuevos no rompe compatibilidad; una versión nueva se anuncia con {doc.meses_aviso} meses de aviso.
          </Alert>

          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="grid content-start gap-4">
              {opActual && (
                <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 font-mono text-[12px] font-bold ${opActual.method === "POST" ? "bg-warn/20 text-ink" : "bg-info/15 text-info"}`}>
                      {opActual.method}
                    </span>
                    <h2 className="font-mono text-[14px] font-semibold text-ink">/api/publica/v1{opActual.path}</h2>
                  </div>
                  <div>
                    <p className="text-[13.5px] font-semibold text-ink">{opActual.name}</p>
                    <p className="text-[12.5px] text-muted">{opActual.description}</p>
                  </div>
                  <DetailList
                    items={[
                      { label: "Alcance requerido", value: <span className="font-mono text-[12.5px]">{opActual.scope}</span> },
                      {
                        label: "Idempotency-Key",
                        value: opActual.write ? "Obligatoria: repetir la llamada con la misma clave devuelve la respuesta guardada sin duplicar." : "No aplica",
                      },
                      {
                        label: "Parámetros",
                        value: opActual.params.length
                          ? opActual.params.map((p) => `${p.name} (${p.in}): ${p.description}`).join(" · ")
                          : "—",
                      },
                    ]}
                  />
                  {opActual.ejemplo?.req && (
                    <div>
                      <p className="mb-1 text-[11.5px] font-semibold text-muted">Ejemplo de petición</p>
                      <pre className="max-h-60 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap text-ink">
                        {JSON.stringify(opActual.ejemplo.req, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div>
                    <p className="mb-1 text-[11.5px] font-semibold text-muted">Respuesta {opActual.write ? 201 : 200} (ejecutada en el sandbox)</p>
                    <pre className="max-h-72 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap text-ink">
                      {JSON.stringify(opActual.ejemplo?.res ?? {}, null, 2)}
                    </pre>
                  </div>
                </section>
              )}

              <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                <h2 className="text-[14px] font-semibold text-ink">Códigos de error y formato</h2>
                <DataTable rowKey={(x) => String(x.http)} columns={colErrores} rows={doc.errores} />
                <div>
                  <p className="mb-1 text-[11.5px] font-semibold text-muted">Ejemplo de cuerpo de error</p>
                  <pre className="rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] text-ink">
                    {`{\n  "code": "RN-PED-01",\n  "message": "Faltan datos obligatorios: DIRECCION_CON_PIN."\n}`}
                  </pre>
                </div>
              </section>

              <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                <div>
                  <h2 className="text-[14px] font-semibold text-ink">Firma de webhooks</h2>
                  <p className="text-[12.5px] text-muted">
                    Cada entrega lleva la cabecera <span className="font-mono">GestionCarnica-Signature: t=&lt;segundos Unix&gt;, v1=&lt;HMAC-SHA256 hex de &quot;t.cuerpo&quot;&gt;</span>. Rechaza firmas con más de {tol} s de antigüedad. Al rotar el secreto llegan dos <span className="font-mono">v1</span> durante 24 horas; acepta si alguna coincide. Deduplica por <span className="font-mono">event_id</span> y ordena por <span className="font-mono">occurred_at</span>.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Secreto">
                    <Input className="font-mono" value={sig.secret} onChange={(e) => setSig({ ...sig, secret: e.target.value })} />
                  </Field>
                  <Field label="Marca de tiempo (t)">
                    <Input className="font-mono" value={sig.t} onChange={(e) => setSig({ ...sig, t: e.target.value })} />
                  </Field>
                  <Field label="Cuerpo crudo">
                    <Input className="font-mono" value={sig.body} onChange={(e) => setSig({ ...sig, body: e.target.value })} />
                  </Field>
                </div>
                <DetailList
                  items={[
                    { label: "Mensaje firmado", value: <span className="font-mono text-[12px] break-all">{sigRes.message}</span> },
                    { label: "v1 (HMAC-SHA256)", value: <span className="font-mono text-[12px] break-all">{sigRes.v1}</span> },
                    { label: "Cabecera enviada", value: <span className="font-mono text-[12px] break-all">{sigRes.header}</span> },
                  ]}
                />
                <Tabs
                  value={langTab}
                  onChange={setLangTab}
                  tabs={[
                    { key: "node", label: "Node.js" },
                    { key: "php", label: "PHP" },
                  ]}
                />
                <pre className="overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12px] whitespace-pre-wrap text-ink">
                  {langTab === "node" ? codigoNode : codigoPhp}
                </pre>
              </section>

              <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                <h2 className="text-[14px] font-semibold text-ink">Probar (consola)</h2>
                <ConsolaApi claves={doc.claves} operaciones={doc.operaciones} />
              </section>
            </div>

            <aside className="grid content-start gap-2 rounded-xl border border-line bg-surface p-3 shadow-card lg:sticky lg:top-4">
              <h2 className="px-2 text-[13px] font-semibold text-ink">Operaciones</h2>
              {porAlcance.map(([scope, items]) => (
                <div key={scope} className="grid gap-1">
                  <p className="mt-1.5 px-2 font-mono text-[11px] font-semibold text-muted">{scope}</p>
                  {items.map(({ idx, op }) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSel(idx)}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${sel === idx ? "bg-primary-soft font-semibold text-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
                    >
                      <span className="w-10 shrink-0 font-mono text-[11px] font-bold">{op.method}</span>
                      <span className="truncate font-mono">{op.path}</span>
                    </button>
                  ))}
                </div>
              ))}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
