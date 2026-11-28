"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, KeyRound, Save, Send } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DetailList, Field, Input, PageHeader, Select, Textarea, confirmAction, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { SecretoWebhookUnaVez, type DestinoWebhook, type EntregaWebhook } from "@/modulos/api/comun";

type Opcion = { value: string; label: string };
type EventoCat = { code: string; module_code: string; modulo: string; scope_code: string; description: string; version: string; modulo_encendido: boolean };
type Formulario = {
  destino: DestinoWebhook | null;
  eventos: EventoCat[];
  marcas: Opcion[];
  clientes: Opcion[];
  simuladores: Opcion[];
  puede: boolean;
};
type RevisionUrl = { ok: boolean; url: string; host: string; ip: string; ip_privada: boolean; aviso: string };

/** API-05 Crear o editar destino de webhook: URL https pública, eventos vigentes del catálogo, marcas y rotación de secreto con 24 h de convivencia. */
function CrearOEditarDestinoVista() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") || "";
  const [form, setForm] = useState<Formulario | null>(null);
  const [error, setError] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [secretoModal, setSecretoModal] = useState<{ secret: string; titulo: string; nombre: string } | null>(null);
  const [revUrl, setRevUrl] = useState<{ texto: string; tono: "ok" | "warn" | "bad" } | null>(null);

  const [d, setD] = useState({ name: "", url: "https://", environment: "LIVE", customer_id: "", sim_mode: "OK", description: "" });
  const [eventos, setEventos] = useState<Set<string>>(new Set(["order.delivered"]));
  const [marcas, setMarcas] = useState<Set<string>>(new Set());

  const cargar = () => {
    const q = id ? `?id=${encodeURIComponent(id)}` : "";
    api<Formulario>(`/v1/api/destinos/formulario${q}`).then((r) => {
      setForm(r);
      setError("");
      if (r.destino) {
        setD({
          name: r.destino.name,
          url: r.destino.url,
          environment: r.destino.environment,
          customer_id: r.destino.customer_id ?? "",
          sim_mode: r.destino.sim_mode,
          description: r.destino.description ?? "",
        });
        setEventos(new Set(r.destino.events));
        setMarcas(new Set(r.destino.brand_ids));
      }
    }).catch((e) => setError(mensajeDe(e)));
  };
  useEffect(cargar, [id]);

  useEffect(() => {
    const u = d.url.trim();
    if (!u || u === "https://") { setRevUrl(null); return; }
    const h = setTimeout(() => {
      api<RevisionUrl>("/v1/api/destinos/revisar-url", { method: "POST", body: { url: u } })
        .then((r) => setRevUrl({ texto: r.aviso, tono: r.ip_privada ? "warn" : "ok" }))
        .catch((e) => setRevUrl({ texto: mensajeDe(e), tono: "bad" }));
    }, 350);
    return () => clearTimeout(h);
  }, [d.url]);

  const alternar = (s: Set<string>, v: string, set: (x: Set<string>) => void) => {
    const n = new Set(s);
    if (n.has(v)) n.delete(v); else n.add(v);
    set(n);
  };

  async function guardar() {
    setGuardando(true);
    setError("");
    setErrores({});
    try {
      const cuerpo = {
        name: d.name.trim(),
        url: d.url.trim(),
        environment: d.environment,
        events: [...eventos],
        brand_ids: [...marcas],
        customer_id: d.customer_id || null,
        sim_mode: d.sim_mode,
        description: d.description.trim() || null,
      };
      const r = id
        ? await api<{ destino: DestinoWebhook; secret: string | null }>(`/v1/api/destinos/${id}`, { method: "PUT", body: cuerpo })
        : await api<{ destino: DestinoWebhook; secret: string | null }>("/v1/api/destinos", { method: "POST", body: cuerpo });
      toast.ok(id ? "Destino guardado" : "Destino creado");
      if (r.secret) {
        setSecretoModal({ secret: r.secret, titulo: "Secreto de firma del destino", nombre: r.destino.name });
      }
      if (!id) {
        router.replace(`/m/api/api-05?id=${r.destino.id}`);
      } else {
        cargar();
      }
    } catch (e) {
      setErrores(erroresDe(e));
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  async function rotarSecreto() {
    if (!form?.destino) return;
    const ok = await confirmAction({
      title: "Rotar el secreto de firma",
      message: "Se genera un secreto nuevo. Durante 24 horas cada entrega lleva dos firmas v1 (nuevo y anterior) para que actualices el receptor sin perder eventos.",
      confirmLabel: "Rotar secreto",
    });
    if (!ok) return;
    try {
      const r = await api<{ destino: DestinoWebhook; secret: string }>(`/v1/api/destinos/${form.destino.id}/rotar-secreto`, { method: "POST" });
      toast.ok("Secreto rotado");
      setSecretoModal({ secret: r.secret, titulo: "Secreto rotado", nombre: r.destino.name });
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  async function enviarPrueba() {
    if (!form?.destino) return;
    try {
      const ent = await api<EntregaWebhook>(`/v1/api/destinos/${form.destino.id}/probar`, { method: "POST" });
      if (ent.status === "DELIVERED") {
        toast.ok(`Prueba entregada (${ent.number}): HTTP ${ent.last_http ?? 200}`);
      } else {
        toast.error(`La prueba falló (${ent.last_error ?? "error"}); quedó programado su reintento.`);
      }
      cargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const ep = form?.destino;
  const puede = Boolean(form?.puede);

  return (
    <div className="grid gap-5">
      <PageHeader
        description="URL https pública, eventos vigentes del catálogo y secreto de firma con rotación y 24 horas de convivencia entre el secreto nuevo y el anterior."
        actions={<Link href="/m/api/api-04"><Button variant="ghost" icon={ArrowLeft}>Destinos</Button></Link>}
      />
      {error && <Alert tone="bad">{error}</Alert>}
      {form && !puede && <Alert tone="warn">Tu rol puede consultar este destino, pero crear o editar destinos exige el permiso de gestión de webhooks.</Alert>}

      {form && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-4">
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
              <h2 className="text-[14px] font-semibold text-ink sm:col-span-2">Datos del destino</h2>
              <Field label="Nombre" required error={errores.name}>
                <Input maxLength={120} placeholder="ERP del restaurante · avisos de pedido" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
              </Field>
              <Field label="Entorno" required>
                <Select disabled={Boolean(ep)} value={d.environment} onChange={(e) => setD({ ...d, environment: e.target.value })}
                  options={[{ value: "LIVE", label: "Producción" }, { value: "TEST", label: "Pruebas (sandbox)" }]} />
              </Field>
              <Field label="URL del receptor" required error={errores.url} className="sm:col-span-2">
                <Input className="font-mono" maxLength={500} placeholder="https://erp.cliente.pe/hooks/gestioncarnica" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} />
                {revUrl && (
                  <p className={`mt-1 text-[12px] font-medium ${revUrl.tono === "ok" ? "text-ok" : revUrl.tono === "warn" ? "text-warn" : "text-bad"}`}>
                    {revUrl.texto}
                  </p>
                )}
              </Field>
              <Field label="Solo eventos del cliente (opcional)">
                <Select value={d.customer_id} onChange={(e) => setD({ ...d, customer_id: e.target.value })}
                  options={[{ value: "", label: "Todos los clientes" }, ...form.clientes]} />
              </Field>
              <Field label="Comportamiento del receptor (demostración)" hint="Simula cómo responde el sistema del cliente para ver reintentos y cola muerta.">
                <Select value={d.sim_mode} onChange={(e) => setD({ ...d, sim_mode: e.target.value })} options={form.simuladores} />
              </Field>
              <Field label="Descripción" className="sm:col-span-2">
                <Textarea rows={2} maxLength={500} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
              </Field>
            </section>

            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Eventos suscritos</h2>
                <p className="text-[12.5px] text-muted">Solo se muestran los eventos vigentes del catálogo; si el módulo dueño está apagado, el evento no se emite.</p>
              </div>
              {errores.events && <p className="text-[12.5px] text-bad">{errores.events}</p>}
              <div className="grid gap-2.5 sm:grid-cols-2">
                {form.eventos.map((ev) => (
                  <Checkbox
                    key={ev.code}
                    checked={eventos.has(ev.code)}
                    onChange={() => alternar(eventos, ev.code, setEventos)}
                    label={
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[12.5px] font-semibold text-ink">{ev.code}</span>
                        <Badge tone="neutral">{ev.modulo}</Badge>
                        {!ev.modulo_encendido && <Badge tone="warn">módulo apagado</Badge>}
                      </span>
                    }
                    hint={`${ev.description} · alcance ${ev.scope_code}`}
                  />
                ))}
              </div>
            </section>

            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Marcas</h2>
                <p className="text-[12.5px] text-muted">Sin marcar: recibe eventos de todas las marcas de la empresa.</p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {form.marcas.map((m) => (
                  <Checkbox key={m.value} checked={marcas.has(m.value)} onChange={() => alternar(marcas, m.value, setMarcas)} label={m.label} />
                ))}
              </div>
            </section>
          </div>

          <aside className="grid content-start gap-4">
            {ep && (
              <>
                <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                  <h2 className="text-[14px] font-semibold text-ink">Secreto de firma</h2>
                  <DetailList
                    items={[
                      { label: "Vigente", value: <span className="font-mono text-[12.5px]">v{ep.secret_version} · whsec_••••{ep.secret_last4}</span> },
                      {
                        label: "Anterior (24 h)",
                        value: ep.prev_valid_until ? (
                          <span className="font-mono text-[12px]">
                            ••••{ep.prev_last4} · {ep.prev_vigente ? "firma también hasta " : "dejó de firmar el "}
                            {fechaHora(ep.prev_valid_until)}
                          </span>
                        ) : "—",
                      },
                    ]}
                  />
                  <Button variant="ghost" icon={KeyRound} disabled={!puede} onClick={rotarSecreto}>Rotar secreto</Button>
                </section>

                <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                  <h2 className="text-[14px] font-semibold text-ink">Envío de prueba</h2>
                  <p className="text-[12.5px] text-muted">Envía el evento <span className="font-mono">webhook.test</span> firmado y registra la respuesta del receptor.</p>
                  <Button variant="ghost" icon={Send} disabled={!puede || ep.status !== "ACTIVE"} onClick={enviarPrueba}>Enviar prueba</Button>
                </section>
              </>
            )}

            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <Button variant="primary" icon={Save} loading={guardando} disabled={!puede || !d.name.trim() || !eventos.size} onClick={guardar}>
                {ep ? "Guardar cambios" : "Crear destino"}
              </Button>
              <p className="text-[12px] text-muted">
                Cada entrega incluye la cabecera <span className="font-mono">GestionCarnica-Signature: t=…, v1=…</span> firmada con HMAC-SHA256.
              </p>
            </section>
          </aside>
        </div>
      )}

      {secretoModal && (
        <SecretoWebhookUnaVez
          secret={secretoModal.secret}
          titulo={secretoModal.titulo}
          nombre={secretoModal.nombre}
          onClose={() => setSecretoModal(null)}
        />
      )}
    </div>
  );
}

export default function CrearOEditarDestino() {
  return <Suspense><CrearOEditarDestinoVista /></Suspense>;
}
