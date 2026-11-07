"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Copy, Globe, Plus, ShieldCheck, Star } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Cifra, DataTable, Field, Input, Modal, PageHeader, confirmAction, toast, type Column } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";

type Dominio = { id: string; hostname: string; is_primary: boolean; status: "ACTIVE" | "PENDING_DNS" | "INACTIVE"; verified_at: string | null; verify_token: string | null; plataforma: boolean };
type Respuesta = { empresa: { name: string; short: string; plan: string; status: string }; dominios: Dominio[]; por_dominio: boolean };

const ESTADO_EMPRESA: Record<string, string> = { ACTIVE: "Activa", TRIAL: "En prueba", PAST_DUE: "Pago vencido", READ_ONLY: "Solo lectura", SUSPENDED: "Suspendida", CANCELLED: "Cerrada" };

/** PLT-13 Dominio de acceso: con qué dirección entran los usuarios del cliente (el tenant, con todas sus empresas y marcas). */
export default function DominioDeAcceso() {
  const { can } = useSesion();
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [version, setVersion] = useState(0);
  const [agregando, setAgregando] = useState(false);
  const [verificando, setVerificando] = useState<Dominio | null>(null);
  const [ocupado, setOcupado] = useState("");
  const puede = can("plt.hostname.manage");

  useEffect(() => {
    let vigente = true;
    api<Respuesta>("/v1/plt/dominios").then((r) => vigente && setDatos(r)).catch((err) => toast.error(mensajeDe(err)));
    return () => { vigente = false; };
  }, [version]);

  const recargar = () => setVersion((v) => v + 1);
  const ds = datos?.dominios ?? [];
  const principal = ds.find((d) => d.is_primary && d.status === "ACTIVE");
  const visibles = ds.filter((d) => d.status !== "INACTIVE");

  async function accion(d: Dominio, tipo: "principal" | "desactivar") {
    const ok = await confirmAction(tipo === "principal"
      ? { title: `Usar ${d.hostname} como principal`, message: "Será la dirección que se muestra a los usuarios para entrar.", confirmLabel: "Usar como principal" }
      : { title: d.status === "PENDING_DNS" ? `Retirar la solicitud de ${d.hostname}` : `Desactivar ${d.hostname}`,
          message: "Los usuarios ya no podrán entrar por esta dirección.", confirmLabel: d.status === "PENDING_DNS" ? "Retirar" : "Desactivar", danger: true });
    if (!ok) return;
    setOcupado(d.id);
    try {
      await api(`/v1/plt/dominios/${d.id}/${tipo}`, { method: "POST" });
      toast.ok(tipo === "principal" ? `${d.hostname} es el dominio principal` : `${d.hostname} desactivado`);
      recargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setOcupado("");
    }
  }

  const columnas: Column<Dominio>[] = [
    { key: "hostname", header: "Dominio", cardTitle: true, render: (d) => (
      <span className="inline-flex items-center gap-2 font-mono text-[13px]">{d.hostname}{d.is_primary && <Badge tone="primary">Principal</Badge>}</span>
    ) },
    { key: "status", header: "Estado", render: (d) => d.status === "ACTIVE" ? <Badge tone="ok" dot>Activo</Badge>
      : d.status === "PENDING_DNS" ? <Badge tone="warn" dot>Pendiente de DNS</Badge> : <Badge dot>Inactivo</Badge> },
    { key: "verificacion", header: "Verificación", render: (d) => d.verified_at ? `Verificado el ${fecha(d.verified_at)}`
      : d.verify_token ? <span className="font-mono text-[12px]">TXT {d.verify_token}</span> : <span className="text-muted">Asignado por Intelectalab</span> },
    ...(puede ? [{ key: "acciones", header: "", render: (d: Dominio) => (
      <span className="flex flex-wrap justify-end gap-2">
        {d.status === "PENDING_DNS" && <Button size="sm" icon={ShieldCheck} onClick={() => setVerificando(d)}>Verificar</Button>}
        {d.status === "ACTIVE" && !d.is_primary && <Button size="sm" variant="ghost" icon={Star} loading={ocupado === d.id} onClick={() => accion(d, "principal")}>Hacer principal</Button>}
        {!d.is_primary && !d.plataforma && d.status !== "INACTIVE" && <Button size="sm" variant="ghost" disabled={Boolean(ocupado)} onClick={() => accion(d, "desactivar")}>
          {d.status === "PENDING_DNS" ? "Retirar" : "Desactivar"}</Button>}
      </span>
    ) }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`La dirección web con la que entran los usuarios de ${datos?.empresa.short ?? "tu negocio"}, para todas sus empresas (RUC) y marcas. Cada dominio es de un solo cliente. Un dominio propio se verifica con un registro TXT en su DNS; los de aycha.pe los asigna Intelectalab.`}
        actions={puede && <Button variant="primary" icon={Plus} onClick={() => setAgregando(true)}>Agregar dominio propio</Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra titulo="Cliente" valor={datos?.empresa.short ?? undefined} detalle={datos ? `Plan ${datos.empresa.plan}` : ""} icono={Building2} destacada />
        <Cifra titulo="Estado" valor={datos ? ESTADO_EMPRESA[datos.empresa.status] ?? datos.empresa.status : undefined} icono={CheckCircle2}
          detalle={datos?.empresa.status === "ACTIVE" ? "Se muestra el inicio de sesión" : "No se muestra el inicio de sesión"}
          tono={datos && datos.empresa.status !== "ACTIVE" ? "bad" : "ok"} />
        <Cifra titulo="Dominio principal" valor={datos ? principal?.hostname ?? "—" : undefined} detalle="Por donde entran los usuarios" icono={Star} />
        <Cifra titulo="Dominios" valor={datos ? numero(visibles.length) : undefined} detalle={datos ? (() => { const n = ds.filter((d) => d.status === "PENDING_DNS").length; return n === 1 ? "1 pendiente de DNS" : `${n} pendientes de DNS`; })() : ""} icono={Globe} />
      </div>

      {datos && !datos.por_dominio && (
        <Alert tone="info">Por ahora se entra por el ingreso general (el cliente sale del correo del usuario). Los dominios quedan listos para cuando se active el ingreso por dominio.</Alert>
      )}

      <DataTable columns={columnas} rows={visibles} rowKey={(d) => d.id} loading={!datos} empty="No hay dominios registrados." />

      {agregando && <AgregarDominio onClose={() => setAgregando(false)} onAgregado={(d) => { setAgregando(false); recargar(); setVerificando(d); }} />}
      {verificando && <VerificarDominio d={verificando} onClose={() => setVerificando(null)} onVerificado={() => { setVerificando(null); recargar(); }} />}
    </div>
  );
}

function AgregarDominio({ onClose, onAgregado }: { onClose: () => void; onAgregado: (d: Dominio) => void }) {
  const [host, setHost] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const d = await api<Dominio>("/v1/plt/dominios", { method: "POST", body: { hostname: host } });
      toast.ok("Dominio agregado: falta crear el registro TXT");
      onAgregado(d);
    } catch (err) {
      setError(erroresDe(err).hostname ?? mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} dismissable={!guardando} size="sm" placement="center" title="Agregar dominio propio"
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cancelar</Button>
        <Button variant="primary" loading={guardando} disabled={!host.trim()} onClick={guardar}>Agregar</Button>
      </>}>
      <Field label="Dominio" required error={error || undefined} hint="Un dominio propio de tu negocio, por ejemplo sistema.donguando.com. Después se verifica con un registro TXT.">
        <Input value={host} onChange={(e) => setHost(e.target.value.trim().toLowerCase())} maxLength={253} placeholder="sistema.donguando.com" className="font-mono" />
      </Field>
    </Modal>
  );
}

function VerificarDominio({ d, onClose, onVerificado }: { d: Dominio; onClose: () => void; onVerificado: () => void }) {
  const [principal, setPrincipal] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function verificar() {
    setGuardando(true);
    setError("");
    try {
      await api(`/v1/plt/dominios/${d.id}/verificar`, { method: "POST", body: { primary: principal } });
      toast.ok(`${d.hostname} verificado`);
      onVerificado();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const copiar = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.ok("Copiado"), () => {});
  return (
    <Modal open onClose={onClose} dismissable={!guardando} title={`Verificar ${d.hostname}`}
      footer={<>
        <Button onClick={onClose} disabled={guardando}>Cerrar</Button>
        <Button variant="primary" icon={ShieldCheck} loading={guardando} onClick={verificar}>Verificar ahora</Button>
      </>}>
      <div className="grid gap-4 text-[13.5px]">
        <p>Para probar que el dominio es tuyo, crea este registro en el DNS de <b>{d.hostname}</b> (en el panel de quien te vende el dominio):</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-[10px] border border-line bg-surface-2/60 p-3">
          <dt className="text-[12px] text-muted">Tipo</dt><dd className="font-mono">TXT</dd><span />
          <dt className="text-[12px] text-muted">Nombre</dt><dd className="break-all font-mono">{d.hostname}</dd>
          <button type="button" onClick={() => copiar(d.hostname)} aria-label="Copiar el nombre" className="cursor-pointer text-muted hover:text-ink"><Copy size={15} /></button>
          <dt className="text-[12px] text-muted">Valor</dt><dd className="break-all font-mono">{d.verify_token}</dd>
          <button type="button" onClick={() => copiar(d.verify_token ?? "")} aria-label="Copiar el valor" className="cursor-pointer text-muted hover:text-ink"><Copy size={15} /></button>
        </dl>
        <p className="text-[12.5px] text-muted">Los cambios de DNS pueden tardar unas horas. Después de verificarlo, Intelectalab lo publica en el servidor con su certificado.</p>
        <Checkbox checked={principal} onChange={setPrincipal} label="Usarlo como dominio principal al verificarse" />
        {error && <Alert tone="warn">{error}</Alert>}
      </div>
    </Modal>
  );
}
