"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { SecretoUnaVez, type Alcance, type Clave } from "@/modulos/api/comun";

type Opcion = { value: string; label: string };
type Formulario = { alcances: Alcance[]; marcas: Opcion[]; canales: Opcion[]; dias_defecto: number; dias_maximo: number; vence_defecto: string; vence_maximo: string; hoy: string };

const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86400000);

/** API-02 Crear clave: nombre, entorno, alcances, marcas, IP y vencimiento. El secreto se muestra una sola vez y la clave siempre vence. */
export default function CrearClave() {
  const router = useRouter();
  const { can } = useSesion();
  const puede = Boolean(can("api.key.manage"));
  const [op, setOp] = useState<Formulario | null>(null);
  const [error, setError] = useState("");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState<{ clave: Clave; token: string } | null>(null);
  const [d, setD] = useState({ name: "", description: "", environment: "LIVE", expires_at: "", channel: "B2B", ips: "", customer_id: "" });
  const [alcances, setAlcances] = useState<Set<string>>(new Set(["orders:read"]));
  const [marcas, setMarcas] = useState<Set<string>>(new Set());
  const [cliente, setCliente] = useState({ texto: "", elegido: "" });
  const [sugerencias, setSugerencias] = useState<Opcion[]>([]);

  useEffect(() => {
    if (!puede) return;
    api<Formulario>("/v1/api/claves/formulario").then((r) => { setOp(r); setD((x) => ({ ...x, expires_at: r.vence_defecto })); }).catch((e) => setError(mensajeDe(e)));
  }, [puede]);
  useEffect(() => {
    const t = cliente.texto.trim();
    if (t.length < 2 || cliente.elegido) return;
    const h = setTimeout(() => api<{ data: Opcion[] }>(`/v1/api/claves/clientes?buscar=${encodeURIComponent(t)}`).then((r) => setSugerencias(r.data)).catch(() => setSugerencias([])), 300);
    return () => clearTimeout(h);
  }, [cliente]);
  const mostrarSugerencias = cliente.texto.trim().length >= 2 && !cliente.elegido ? sugerencias : [];

  const plazo = op && d.expires_at ? dias(op.hoy, d.expires_at) : null;
  const plazoMal = plazo !== null && op ? (plazo <= 0 ? "El vencimiento debe ser posterior a hoy." : plazo > op.dias_maximo ? `Supera el máximo de ${op.dias_maximo} días.` : "") : "";
  const porModulo = useMemo(() => {
    const g = new Map<string, Alcance[]>();
    for (const a of op?.alcances ?? []) g.set(a.modulo, [...(g.get(a.modulo) ?? []), a]);
    return [...g.entries()];
  }, [op]);

  async function crear() {
    setEnviando(true);
    setErrores({});
    setError("");
    try {
      const r = await api<{ clave: Clave; token: string }>("/v1/api/claves", { method: "POST", body: {
        name: d.name, description: d.description || null, environment: d.environment, expires_at: d.expires_at, channel: d.channel, customer_id: d.customer_id || null,
        scopes: [...alcances], brand_ids: [...marcas], allowed_ips: d.ips.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
      } });
      setCreada(r);
    } catch (e) {
      setErrores(erroresDe(e));
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  const alternar = (s: Set<string>, v: string, set: (x: Set<string>) => void) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); set(n); };

  if (!puede) return <div className="grid gap-5"><PageHeader description="Crear una clave de API." /><Alert tone="warn">Crear claves es del administrador del sistema o la gerencia.</Alert></div>;
  return (
    <div className="grid gap-5">
      <PageHeader description="Elige quién la usará, en qué entorno, qué puede hacer y hasta cuándo. El secreto se muestra una sola vez y la clave siempre vence." />
      {error && <Alert tone="bad">{error}</Alert>}
      {op && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="grid content-start gap-4">
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2">
              <h2 className="text-[14px] font-semibold text-ink sm:col-span-2">Datos de la clave</h2>
              <Field label="Nombre" required error={errores.name} hint="Quién usará la clave y para qué." className="sm:col-span-2">
                <Input maxLength={120} placeholder="ERP del restaurante, tienda online…" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
              </Field>
              <Field label="Entorno" required error={errores.environment}>
                <Select value={d.environment} onChange={(e) => setD({ ...d, environment: e.target.value })} options={[{ value: "LIVE", label: "Producción (ak_live_)" }, { value: "TEST", label: "Pruebas (ak_test_)" }]} />
              </Field>
              <Field label="Vence" required error={errores.expires_at || plazoMal || undefined} hint={`Por defecto ${op.dias_defecto} días; máximo ${op.dias_maximo}.`}>
                <Input type="date" min={op.hoy} max={op.vence_maximo} value={d.expires_at} onChange={(e) => setD({ ...d, expires_at: e.target.value })} />
              </Field>
              <Field label="Cliente vinculado (opcional)" hint="Si la usa un cliente que compra como empresa, verá y creará solo sus pedidos." className="sm:col-span-2">
                <div className="relative">
                  <Input value={cliente.texto} placeholder="Buscar por nombre o RUC…" onChange={(e) => { setCliente({ texto: e.target.value, elegido: "" }); setD({ ...d, customer_id: "" }); }} />
                  {mostrarSugerencias.length > 0 && (
                    <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-card">
                      {mostrarSugerencias.map((s) => <li key={s.value}><button type="button" className="w-full cursor-pointer px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"
                        onClick={() => { setCliente({ texto: s.label, elegido: s.value }); setD({ ...d, customer_id: s.value, channel: "B2B" }); setSugerencias([]); }}>{s.label}</button></li>)}
                    </ul>
                  )}
                </div>
              </Field>
              <Field label="Canal de los pedidos y precios" required error={errores.channel} hint="Define la lista de precios que se aplica.">
                <Select value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })} options={op.canales} />
              </Field>
              <Field label="IP permitidas (opcional)" error={errores.allowed_ips} hint="Separadas por coma. Vacío: cualquier IP.">
                <Input placeholder="181.65.70.12, 181.65.70.0/24" value={d.ips} onChange={(e) => setD({ ...d, ips: e.target.value })} />
              </Field>
              <Field label="Descripción" className="sm:col-span-2"><Textarea rows={2} maxLength={500} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
            </section>
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div><h2 className="text-[14px] font-semibold text-ink">Alcances</h2><p className="text-[12.5px] text-muted">Lo que la clave puede hacer. Los de escritura crean datos en tu empresa.</p></div>
              {errores.scopes && <p className="text-[12.5px] text-bad">{errores.scopes}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {porModulo.map(([mod, items]) => (
                  <div key={mod} className="grid content-start gap-1.5">
                    <p className="text-[11.5px] font-semibold tracking-wide text-muted uppercase">{mod}</p>
                    {items.map((a) => <Checkbox key={a.code} checked={alcances.has(a.code)} onChange={() => alternar(alcances, a.code, setAlcances)}
                      label={<span>{a.name} <span className="font-mono text-[11.5px] text-muted">{a.code}</span>{a.is_write && <span className="ml-1"><Badge tone="warn">Escritura</Badge></span>}</span>} hint={a.description} />)}
                  </div>
                ))}
              </div>
            </section>
            <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <div><h2 className="text-[14px] font-semibold text-ink">Marcas</h2><p className="text-[12.5px] text-muted">Sin marcar: todas. Los datos que devuelve la API se filtran por estas marcas.</p></div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">{op.marcas.map((m) => <Checkbox key={m.value} checked={marcas.has(m.value)} onChange={() => alternar(marcas, m.value, setMarcas)} label={m.label} />)}</div>
            </section>
          </div>
          <aside className="grid content-start gap-4">
            <section className="grid gap-2 rounded-xl border border-line bg-surface p-4 text-[13px] shadow-card lg:sticky lg:top-4">
              <h2 className="text-[14px] font-semibold text-ink">Resumen</h2>
              <p>Prefijo: <span className="font-mono font-semibold">ak_{d.environment === "TEST" ? "test" : "live"}_xxxxxxxx</span> + secreto de 40 caracteres.</p>
              {plazo !== null && <p className={plazoMal ? "font-semibold text-bad" : ""}>{plazoMal || `Vence el ${fecha(d.expires_at)}, en ${numero(plazo)} días.`}</p>}
              <p>Alcances: {alcances.size ? [...alcances].join(", ") : <span className="text-bad">ninguno</span>}</p>
              <p>Marcas: {marcas.size ? op.marcas.filter((m) => marcas.has(m.value)).map((m) => m.label).join(", ") : "todas"}</p>
              {d.environment === "TEST" && <p className="text-[12.5px] text-muted">Una clave de pruebas opera solo en el entorno de pruebas: no lee ni escribe los datos reales.</p>}
              <Button variant="primary" icon={KeyRound} loading={enviando} disabled={!d.name.trim() || !alcances.size || Boolean(plazoMal)} onClick={crear}>Crear clave</Button>
              <p className="text-[12px] text-muted">Guárdala en el gestor de secretos del sistema que la usará.</p>
            </section>
          </aside>
        </div>
      )}
      {creada && <SecretoUnaVez token={creada.token} clave={creada.clave} onClose={() => router.push(`/m/api/api-03?id=${creada.clave.id}`)} />}
    </div>
  );
}
