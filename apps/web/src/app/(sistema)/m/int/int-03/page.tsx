"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Ban, KeyRound, Plus, RefreshCw } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, Input, PageHeader, Select, StatusBadge, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { CampoSecreto, ESTADOS_CREDENCIAL, useDatos, venceEn, type Credencial } from "@/modulos/int/tipos";

/** Vigente en la base pero con la fecha de vencimiento ya pasada. */
const vencida = (k: Credencial) => k.status === "ACTIVE" && k.dias_para_vencer !== null && k.dias_para_vencer < 0;

type Datos = { data: Credencial[]; por_vencer: Credencial[]; dias_aviso: number; conectores: { id: string; name: string }[]; estados: Record<string, string> };

/**
 * INT-03 Credenciales: los secretos de cada conector, cifrados con la clave de la aplicación. Nunca se muestran: solo
 * sus últimos 4 caracteres. Se cargan, se rotan (versión nueva y la anterior revocada) y se revocan con motivo.
 */
function Credenciales() {
  const inicial = useSearchParams().get("connector") ?? "";
  const { can, puede } = useSesion();
  const { datos, error, recargar } = useDatos<Datos>("/v1/int/credenciales");
  const [f, setF] = useState({ connector: inicial, status: "ACTIVE" });
  const [cargando, setCargando] = useState(false);
  const [rotando, setRotando] = useState<Credencial | null>(null);
  const gestiona = can("int.credential.rotate") && puede("INT", "E");

  const visibles = useMemo(() => (datos?.data ?? []).filter((k) => (!f.connector || k.connector_id === f.connector) && (!f.status || k.status === f.status)), [datos, f]);
  const ord = useOrdenLocal(visibles, {
    connector: (k) => k.connector_name, name: (k) => k.name, version: (k) => k.version, expires_at: (k) => k.expires_at, created_at: (k) => k.created_at, status: (k) => k.status_name,
  });
  const pagina = usePaginaLocal(ord.filas, `${JSON.stringify(f)}|${ord.orden.sort}`);
  const aviso = datos?.dias_aviso ?? 7;
  const vencidas = (datos?.por_vencer ?? []).filter(vencida);
  const porVencer = (datos?.por_vencer ?? []).filter((k) => !vencida(k));

  async function revocar(k: Credencial) {
    const r = await confirmAction({ title: `¿Revocar ${k.name} (versión ${k.version})?`, danger: true, confirmLabel: "Revocar",
      message: `${k.connector_name}: deja de usarse en el momento. Si el proveedor la sigue necesitando, carga una nueva.`, reason: { min: 10, label: "Motivo de la revocación" } });
    if (!r) return;
    try {
      await api(`/v1/int/credenciales/${k.id}/revocar`, { method: "POST", body: { reason: r.reason } });
      toast.ok("Credencial revocada");
      recargar();
    } catch (e) {
      toast.error(mensajeDe(e));
    }
  }

  const columnas: Column<Credencial>[] = [
    { key: "connector", sortable: true, header: "Conector", cardTitle: true, render: (k) => <span className="font-semibold text-ink">{k.connector_name}</span> },
    { key: "name", sortable: true, header: "Credencial", render: (k) => <span className="font-mono text-[12.5px]">{k.name}</span> },
    { key: "value", header: "Valor", render: (k) => <span className="font-mono">{k.value}</span> },
    { key: "version", sortable: true, header: "Versión", align: "right", render: (k) => k.version },
    { key: "expires_at", sortable: true, header: "Vence", render: (k) => (k.expires_at
      ? <span className={vencida(k) ? "font-semibold text-bad" : k.status === "ACTIVE" && k.dias_para_vencer !== null && k.dias_para_vencer <= aviso ? "font-semibold text-warn" : ""}>{fecha(k.expires_at)}{k.status === "ACTIVE" ? ` (${venceEn(k.dias_para_vencer)})` : ""}</span>
      : <span className="text-muted">No vence</span>) },
    { key: "created_at", sortable: true, header: "Cargada por", hideOnMobile: true, render: (k) => <span className="text-[12.5px]">{k.created_by} · {fecha(k.created_at)}</span> },
    { key: "status", sortable: true, header: "Estado", render: (k) => (
      <div className="grid gap-0.5">
        {vencida(k) ? <Badge tone="bad" dot>Vencida</Badge> : <StatusBadge status={k.status} labels={ESTADOS_CREDENCIAL} />}
        {k.revoked_reason && <span className="text-[12px] text-muted">{k.revoked_reason}</span>}
      </div>
    ) },
    ...(gestiona ? [{ key: "acciones", header: "", align: "right" as const, render: (k: Credencial) => (k.status === "ACTIVE" ? (
      <div className="flex justify-end gap-1.5">
        <Button size="sm" icon={RefreshCw} onClick={() => setRotando(k)}>Rotar</Button>
        <Button size="sm" variant="ghost" icon={Ban} onClick={() => revocar(k)}>Revocar</Button>
      </div>
    ) : null) }] : []),
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Los secretos de cada conector (tokens, claves de API, secretos de webhooks) se guardan cifrados con la clave de la aplicación, fuera de la base. Nunca se muestran completos: solo sus últimos 4 caracteres. Hay una sola vigente por nombre; rotar crea la versión siguiente y revoca la anterior."
        actions={gestiona ? <Button variant="primary" icon={Plus} onClick={() => setCargando(true)}>Cargar credencial</Button> : undefined} />
      {vencidas.length > 0 && (
        <Alert tone="bad" title={vencidas.length === 1 ? "Una credencial vencida" : `${vencidas.length} credenciales vencidas`}>
          {vencidas.map((k) => `${k.connector_name} · ${k.name} (venció el ${fecha(k.expires_at!)})`).join("; ")}. El proveedor ya no las acepta: rótalas con un secreto nuevo.
        </Alert>
      )}
      {porVencer.length > 0 && (
        <Alert tone="warn" title="Credenciales por vencer">
          {porVencer.map((k) => `${k.connector_name} · ${k.name} vence el ${fecha(k.expires_at!)} (${venceEn(k.dias_para_vencer)})`).join("; ")}. Rótalas antes de que dejen de funcionar.
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select aria-label="Conector" value={f.connector} onChange={(e) => setF({ ...f, connector: e.target.value })} placeholder="Todos los conectores"
          options={(datos?.conectores ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <Select aria-label="Estado" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} placeholder="Vigentes y revocadas"
          options={Object.entries(datos?.estados ?? {}).map(([value, label]) => ({ value, label }))} />
      </div>
      <DataTable {...ord.orden} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!datos && !error} error={error} onRetry={recargar}
        empty={<span className="inline-flex items-center gap-2"><KeyRound size={16} aria-hidden="true" />No hay credenciales con estos filtros.</span>} />

      {cargando && datos && <CargarCredencial conectores={datos.conectores} conector={f.connector} onClose={() => setCargando(false)} onListo={() => { setCargando(false); recargar(); }} />}
      {rotando && <RotarCredencial k={rotando} onClose={() => setRotando(null)} onListo={() => { setRotando(null); recargar(); }} />}
    </div>
  );
}

function CargarCredencial({ conectores, conector, onClose, onListo }: { conectores: { id: string; name: string }[]; conector: string; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ connector_id: conector, name: "", secret: "", expires_at: "" });
  return (
    <Dialogo titulo="Cargar credencial" boton="Cifrar y guardar" onClose={onClose} aviso="El secreto se cifra al guardarlo; después solo se ven sus últimos 4 caracteres."
      enviar={async () => { await api("/v1/int/credenciales", { method: "POST", body: { ...d, expires_at: d.expires_at || null } }); toast.ok("Credencial cifrada y guardada"); onListo(); }}>
      {(errores) => (
        <>
          <Field label="Conector" required error={errores.connector_id}>
            <Select value={d.connector_id} onChange={(e) => setD({ ...d, connector_id: e.target.value })} placeholder="Elige el conector" options={conectores.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Nombre" required error={errores.name} hint="En minúsculas y sin espacios: access_token, api_key, webhook_secret…">
            <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value.toLowerCase().replace(/\s+/g, "_") })} maxLength={80} placeholder="access_token" />
          </Field>
          <Field label="Secreto" required error={errores.secret} hint="Al menos 8 caracteres."><CampoSecreto value={d.secret} onChange={(v) => setD({ ...d, secret: v })} /></Field>
          <Field label="Vence" error={errores.expires_at} hint="Déjalo vacío si no vence. Se avisa unos días antes."><Input type="date" value={d.expires_at} onChange={(e) => setD({ ...d, expires_at: e.target.value })} /></Field>
        </>
      )}
    </Dialogo>
  );
}

function RotarCredencial({ k, onClose, onListo }: { k: Credencial; onClose: () => void; onListo: () => void }) {
  const [d, setD] = useState({ secret: "", expires_at: "" });
  return (
    <Dialogo titulo={`Rotar ${k.name}`} boton="Rotar" onClose={onClose} aviso={`${k.connector_name}: se crea la versión ${k.version + 1} con el secreto nuevo y la ${k.version} (${k.value}) queda revocada.`}
      enviar={async () => { await api(`/v1/int/credenciales/${k.id}/rotar`, { method: "POST", body: { ...d, expires_at: d.expires_at || null } }); toast.ok("Credencial rotada"); onListo(); }}>
      {(errores) => (
        <>
          <Field label="Secreto nuevo" required error={errores.secret} hint="Al menos 8 caracteres."><CampoSecreto value={d.secret} onChange={(v) => setD({ ...d, secret: v })} /></Field>
          <Field label="Vence" error={errores.expires_at}><Input type="date" value={d.expires_at} onChange={(e) => setD({ ...d, expires_at: e.target.value })} /></Field>
        </>
      )}
    </Dialogo>
  );
}

export default function Page() {
  return <Suspense><Credenciales /></Suspense>;
}
