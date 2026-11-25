"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Ban, Pencil } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Input, Modal, PageHeader, Textarea, confirmAction, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, numero } from "@/lib/formato";
import { Entorno, TONO_ESTADO, type Alcance, type Clave } from "@/modulos/api/comun";

type Detalle = Clave & { catalogo: Alcance[]; puede: boolean };

/** API-03 Detalle de clave: datos, alcances, uso y revocación con motivo. Secreto, prefijo, entorno, alcances y marcas no cambian. */
function DetalleClave() {
  const id = useSearchParams().get("id");
  const [k, setK] = useState<Detalle | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState(false);
  const cargar = useCallback(() => {
    if (!id) return;
    api<Detalle>(`/v1/api/claves/${id}`).then((r) => { setK(r); setError(""); }).catch((e) => setError(mensajeDe(e)));
  }, [id]);
  useEffect(() => cargar(), [cargar]);

  async function revocar() {
    if (!k) return;
    const r = await confirmAction({ title: `Revocar ${k.prefix}…`, message: `«${k.name}» dejará de funcionar de inmediato: la siguiente llamada responderá 401. Una clave revocada no se reactiva.`,
      confirmLabel: "Revocar", danger: true, reason: { label: "Motivo de la revocación", min: 10 } });
    if (!r) return;
    try {
      setK(await api<Detalle>(`/v1/api/claves/${k.id}/revocar`, { method: "POST", body: { motivo: r.reason } }));
      toast.ok(`Clave ${k.prefix}… revocada`);
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  if (!id) return <div className="grid gap-5"><PageHeader description="El detalle de una clave." /><Alert tone="info">Elige una clave en <Link href="/m/api/api-01" className="font-semibold underline">Claves de API</Link>.</Alert></div>;
  return (
    <div className="grid gap-5">
      <PageHeader description={k ? `${k.prefix}… · ${k.entorno.toLowerCase()} · creada el ${fecha(k.created_at)}${k.creo ? ` por ${k.creo}` : ""}` : "El detalle de una clave."}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/m/api/api-01"><Button variant="ghost" icon={ArrowLeft}>Claves</Button></Link>
          {k?.puede && k.status === "ACTIVE" && <Button variant="ghost" icon={Pencil} onClick={() => setEditar(true)}>Editar</Button>}
          {k?.puede && k.status === "ACTIVE" && <Button variant="danger" icon={Ban} onClick={revocar}>Revocar</Button>}
        </div>} />
      {error && <Alert tone="bad">{error}</Alert>}
      {k && (
        <>
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-[18px] font-semibold text-ink">{k.name}</h2><Entorno e={k.environment} /><Badge tone={TONO_ESTADO[k.status]}>{k.estado}</Badge></div>
          {k.status === "REVOKED" && <Alert tone="bad">Revocada el {fechaHora(k.revoked_at)}{k.revoco ? ` por ${k.revoco}` : ""}: {k.revoke_reason}. No se reactiva; si se necesita, crea otra clave.</Alert>}
          {k.status === "EXPIRED" && <Alert tone="bad">Venció el {fecha(k.expires_at)}: sus llamadas responden 401 y el vencimiento no se extiende. Crea otra clave.</Alert>}
          {k.status === "ACTIVE" && k.dias <= 15 && <Alert tone="warn">Vence en {numero(k.dias)} días: crea la clave de reemplazo y pásala al sistema que la usa antes del {fecha(k.expires_at)}.</Alert>}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h3 className="text-[14px] font-semibold text-ink">Datos</h3>
              <DetailList items={[
                { label: "Prefijo", value: <span className="font-mono">{k.prefix}…</span> }, { label: "Secreto", value: <span className="text-[12.5px] text-muted">No se muestra · huella {k.huella}…</span> },
                { label: "Vence", value: `${fecha(k.expires_at)}${k.status === "ACTIVE" ? ` (en ${numero(k.dias)} días)` : ""}` }, { label: "Marcas", value: k.marcas.length ? k.marcas.join(", ") : "Todas" },
                { label: "Cliente vinculado", value: k.cliente ?? "—" }, { label: "Canal de pedidos y precios", value: k.canal },
                { label: "IP permitidas", value: k.allowed_ips.length ? <span className="font-mono text-[12.5px]">{k.allowed_ips.join(", ")}</span> : "Cualquiera" },
                { label: "Último uso", value: k.last_used_at ? `${fechaHora(k.last_used_at)} · ${k.last_ip ?? ""}` : "Nunca" },
                { label: "Descripción", value: k.description ?? "—" },
              ]} />
            </section>
            <section className="grid content-start gap-2 rounded-xl border border-line bg-surface p-4 shadow-card">
              <h3 className="text-[14px] font-semibold text-ink">Alcances</h3>
              {k.catalogo.map((a) => {
                const tiene = k.scopes.includes(a.code);
                return (
                  <div key={a.code} className={`flex items-start gap-2 text-[12.5px] ${tiene ? "" : "opacity-45"}`}>
                    <Badge tone={tiene ? "ok" : "neutral"}>{tiene ? "Sí" : "No"}</Badge>
                    <div><span className="font-mono text-ink">{a.code}</span> <span className="text-muted">· {a.name} · {a.modulo}</span>{a.is_write && tiene && <span className="ml-1"><Badge tone="warn">Escritura</Badge></span>}</div>
                  </div>
                );
              })}
            </section>
          </div>
          <Alert tone="info">El uso de los últimos 30 días, las últimas llamadas y la consola para probar la clave llegan con la API misma (siguiente tanda).</Alert>
        </>
      )}
      {editar && k && <Editar k={k} onClose={() => setEditar(false)} onListo={(r) => { setK(r); setEditar(false); toast.ok("Clave actualizada"); }} />}
    </div>
  );
}

function Editar({ k, onClose, onListo }: { k: Detalle; onClose: () => void; onListo: (k: Detalle) => void }) {
  const [d, setD] = useState({ name: k.name, description: k.description ?? "", ips: k.allowed_ips.join(", "), expires_at: k.expires_at });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function guardar() {
    setEnviando(true);
    try {
      onListo(await api<Detalle>(`/v1/api/claves/${k.id}`, { method: "PUT", body: { name: d.name, description: d.description || null, expires_at: d.expires_at,
        allowed_ips: d.ips.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) } }));
    } catch (e) {
      setErrores(erroresDe(e));
      setError(mensajeDe(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Editar clave" description="El secreto, el prefijo, el entorno, los alcances y las marcas no cambian: para eso se crea otra clave."
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={enviando} onClick={guardar}>Guardar</Button></>}>
      <div className="grid gap-3">
        {error && <Alert tone="bad">{error}</Alert>}
        <Field label="Nombre" required error={errores.name}><Input maxLength={120} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></Field>
        <Field label="IP permitidas" error={errores.allowed_ips} hint="Separadas por coma. Vacío: cualquier IP."><Input value={d.ips} onChange={(e) => setD({ ...d, ips: e.target.value })} /></Field>
        <Field label="Vence" error={errores.expires_at} hint="Solo se puede adelantar, no extender."><Input type="date" max={k.expires_at} value={d.expires_at} onChange={(e) => setD({ ...d, expires_at: e.target.value })} /></Field>
        <Field label="Descripción"><Textarea rows={3} maxLength={500} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Page() {
  return <Suspense><DetalleClave /></Suspense>;
}
