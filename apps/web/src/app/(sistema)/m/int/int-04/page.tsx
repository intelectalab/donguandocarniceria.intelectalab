"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, RefreshCw, Webhook } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, PageHeader, confirmAction, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";
import { useOrdenLocal, usePaginaLocal } from "@/lib/paginas";
import { useSesion } from "@/lib/sesion";
import { Dialogo } from "@/modulos/mae/Dialogo";
import { CampoSecreto, Entorno, nombreModulo, useDatos, type Conector } from "@/modulos/int/tipos";

type Endpoint = {
  id: string; name: string; url: string; signature_scheme: string; owner_module: string; module_name: string; module_on: boolean; connector_id: string;
  connector_name: string; environment: Conector["environment"]; connector_status: string; status: string; status_name: string; received_count: number;
  last_received_at: string | null; con_secreto: boolean; secret_loaded_at: string | null; token_rotated_at: string | null; anterior_vale_hasta: string | null; eventos: number;
};

/**
 * INT-04 Webhooks de entrada: una URL por proveedor (/api/hooks/{token}) con su esquema de firma y su secreto. Sin firma
 * válida se responde 401 y no se procesa.
 */
export default function WebhooksEntrada() {
  const { can, puede } = useSesion();
  const { datos, error, recargar } = useDatos<{ data: Endpoint[] }>("/v1/int/webhooks");
  const [secreto, setSecreto] = useState<Endpoint | null>(null);
  const editaConector = Boolean(can("int.connector.manage")) && puede("INT", "E");
  const editaSecreto = Boolean(can("int.credential.rotate")) && puede("INT", "E");

  const filas = datos?.data ?? [];
  const ord = useOrdenLocal(filas, {
    name: (e) => e.name, signature_scheme: (e) => e.signature_scheme, module: (e) => nombreModulo(e.owner_module), environment: (e) => e.environment,
    eventos: (e) => e.eventos, last_received_at: (e) => e.last_received_at, secreto: (e) => (e.con_secreto ? 1 : 0), status: (e) => e.status_name,
  });
  const pagina = usePaginaLocal(ord.filas, ord.orden.sort);
  const sinSecreto = filas.filter((e) => !e.con_secreto && e.status === "ACTIVE");

  async function copiar(e: Endpoint) {
    try {
      await navigator.clipboard.writeText(e.url);
      toast.ok("URL copiada");
    } catch {
      toast.error("No se pudo copiar: selecciónala y cópiala a mano.");
    }
  }

  async function regenerar(e: Endpoint) {
    const ok = await confirmAction({ title: `¿Regenerar el token de ${e.name}?`, danger: true, confirmLabel: "Regenerar",
      message: "Se crea una URL nueva. La actual sigue funcionando 24 horas: en ese tiempo cámbiala en el panel del proveedor." });
    if (!ok) return;
    try {
      await api(`/v1/int/webhooks/${e.id}/regenerar`, { method: "POST" });
      toast.ok("Token regenerado: actualiza la URL en el proveedor");
      recargar();
    } catch (x) {
      toast.error(mensajeDe(x));
    }
  }

  const columnas: Column<Endpoint>[] = [
    { key: "name", sortable: true, header: "Endpoint", cardTitle: true, render: (e) => (
      <div className="min-w-0">
        <p className="font-semibold text-ink">{e.name}</p>
        <p className="font-mono text-[11.5px] break-all text-muted">{e.url}</p>
        {e.anterior_vale_hasta && <p className="text-[12px] text-warn">La URL anterior vale hasta {fechaHora(e.anterior_vale_hasta)}</p>}
      </div>
    ) },
    { key: "signature_scheme", sortable: true, header: "Firma", hideOnMobile: true, render: (e) => <span className="text-[12.5px]">{e.signature_scheme}</span> },
    { key: "module", sortable: true, header: "Módulo", render: (e) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">{nombreModulo(e.owner_module)}{!e.module_on && <Badge>Apagado</Badge>}</span>
    ) },
    { key: "environment", sortable: true, header: "Entorno", render: (e) => <Entorno e={e.environment} /> },
    { key: "eventos", sortable: true, header: "Eventos", align: "right", render: (e) => (e.eventos
      ? <Link href={`/m/int/int-05?endpoint=${e.id}`} className="font-medium text-primary hover:underline" title="Ver en la bitácora">{e.eventos}</Link> : "0") },
    { key: "last_received_at", sortable: true, header: "Último", hideOnMobile: true, render: (e) => (e.last_received_at ? <span className="whitespace-nowrap">{fechaHora(e.last_received_at)}</span> : <span className="text-muted">Nunca</span>) },
    { key: "secreto", sortable: true, header: "Secreto de firma", render: (e) => (e.con_secreto
      ? <Badge tone="ok" dot>Cargado</Badge> : <Badge tone="warn" dot>Falta cargar</Badge>) },
    { key: "status", sortable: true, header: "Estado", render: (e) => <Badge tone={e.status === "ACTIVE" ? "ok" : "neutral"} dot>{e.status_name}</Badge> },
    { key: "acciones", header: "", align: "right", render: (e) => (
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => copiar(e)}>Copiar URL</Button>
        {editaSecreto && <Button size="sm" variant="ghost" icon={KeyRound} onClick={() => setSecreto(e)}>{e.con_secreto ? "Cambiar secreto" : "Cargar secreto"}</Button>}
        {editaConector && <Button size="sm" icon={RefreshCw} onClick={() => regenerar(e)}>Regenerar token</Button>}
      </div>
    ) },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Cada proveedor (Mercado Pago, WooCommerce, WhatsApp, el OSE…) avisa a su propia URL, con su firma. Lo que llega sin firma válida se responde con 401, se guarda como rechazado y no se procesa. Lo que llega repetido se procesa una sola vez." />
      {sinSecreto.length > 0 && (
        <Alert tone="warn" title={sinSecreto.length === 1 ? "Un endpoint sin secreto de firma" : `${sinSecreto.length} endpoints sin secreto de firma`}>
          Hasta que cargues el secreto que da el proveedor, todo lo que llegue a {sinSecreto.length === 1 ? "esa URL" : "esas URL"} se rechaza.
        </Alert>
      )}
      <DataTable {...ord.orden} columns={columnas} rows={pagina.filas} pagination={pagina.props} loading={!datos && !error} error={error} onRetry={recargar}
        empty={<span className="inline-flex items-center gap-2"><Webhook size={16} aria-hidden="true" />No hay webhooks de entrada.</span>} />
      {secreto && <CargarSecreto e={secreto} onClose={() => setSecreto(null)} onListo={() => { setSecreto(null); recargar(); }} />}
    </div>
  );
}

function CargarSecreto({ e, onClose, onListo }: { e: Endpoint; onClose: () => void; onListo: () => void }) {
  const [secret, setSecret] = useState("");
  return (
    <Dialogo titulo={`Secreto de firma · ${e.name}`} boton="Cifrar y guardar" onClose={onClose}
      aviso={`Es el secreto que muestra el panel del proveedor para firmar sus avisos (${e.signature_scheme}). Se guarda cifrado y no vuelve a mostrarse.${e.con_secreto ? " Reemplaza al actual." : ""}`}
      enviar={async () => { await api(`/v1/int/webhooks/${e.id}/secreto`, { method: "POST", body: { secret } }); toast.ok("Secreto cifrado y guardado"); onListo(); }}>
      {(errores) => (
        <Field label="Secreto" required error={errores.secret} hint="Al menos 8 caracteres."><CampoSecreto value={secret} onChange={setSecret} /></Field>
      )}
    </Dialogo>
  );
}
