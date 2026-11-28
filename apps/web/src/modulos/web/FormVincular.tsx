"use client";

import { useState, type FormEvent } from "react";
import { Link2 } from "lucide-react";
import { Alert, Button, Field, Input, Modal, Select, Textarea, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { useDatos } from "@/modulos/web/comunes";

type Variante = { id: string; sku: string; name: string; marca: string | null };

/** Vincular un SKU de WooCommerce a una variante del catálogo (WEB-02 y WEB-05). */
export function FormVincular({ tienda, sku, onClose, onListo }: { tienda: string; sku?: string; onClose: () => void; onListo: () => void }) {
  const { datos: vs } = useDatos<Variante[]>(`/v1/web/mapeos/variantes?store=${tienda}`);
  const [f, setF] = useState({ sku: sku ?? "", variant_id: "", note: "" });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrores({});
    setGeneral("");
    try {
      await api("/v1/web/mapeos", { method: "POST", body: { store_id: tienda, ...f } });
      toast.ok(`SKU ${f.sku.toUpperCase()} vinculado. Reprocesa los pedidos web que esperaban este SKU.`);
      onListo();
    } catch (err) {
      setErrores(erroresDe(err));
      setGeneral(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Vincular SKU" description="El SKU de WooCommerce queda traducido a esta variante en los pedidos y en los envíos de precio y stock."
      dismissable={!guardando}
      footer={<><Button onClick={onClose} disabled={guardando}>Cancelar</Button><Button variant="primary" type="submit" form="f-vincular" icon={Link2} loading={guardando}>Vincular</Button></>}>
      <form id="f-vincular" onSubmit={guardar} className="space-y-3">
        {general && <Alert tone="bad">{general}</Alert>}
        <Field label="SKU de la web" required error={errores.sku}>
          <Input value={f.sku} onChange={(e) => setF((x) => ({ ...x, sku: e.target.value }))} maxLength={40} required readOnly={Boolean(sku)} />
        </Field>
        <Field label="Variante del catálogo" required error={errores.variant_id}>
          <Select value={f.variant_id} placeholder={vs ? "Elige la variante" : "Cargando…"} onChange={(e) => setF((x) => ({ ...x, variant_id: e.target.value }))} searchable
            options={(vs ?? []).map((v) => ({ value: v.id, label: `${v.sku} · ${v.name}${v.marca ? ` (${v.marca})` : ""}` }))} required />
        </Field>
        <Field label="Nota" error={errores.note} hint="Opcional: queda en el historial del SKU">
          <Textarea value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} maxLength={255} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}

