"use client";

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Badge, Button, Checkbox, Cifra, DataTable, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type CanalWa = {
  id: string;
  number: string;
  display_name: string;
  brand_id: string | null;
  brand_name: string | null;
  shared: boolean;
  coexistence: boolean;
  quality_rating: string | null;
  status: string;
};

type Marca = { id: string; code: string; name: string };

type RespuestaWa = {
  channels: CanalWa[];
  brands: Marca[];
  connected_count: number;
  limit: number;
  step: PasoAlta | null;
};

export default function Onb08WhatsappPage() {
  const [datos, setDatos] = useState<RespuestaWa | null>(null);
  const [cargando, setCargando] = useState(true);
  const [number, setNumber] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [brandId, setBrandId] = useState("");
  const [shared, setShared] = useState(false);
  const [coexistence, setCoexistence] = useState(true);
  const [conectando, setConectando] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaWa>("/v1/onb/whatsapp")
      .then((r) => {
        setDatos(r);
        if (!brandId && r.brands[0]) {
          setBrandId(r.brands[0].id);
        }
      })
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function conectar(e: React.FormEvent) {
    e.preventDefault();
    setConectando(true);
    try {
      await api("/v1/onb/whatsapp", {
        method: "POST",
        body: JSON.stringify({
          number,
          display_name: displayName,
          brand_id: shared ? null : brandId,
          shared,
          coexistence,
        }),
      });
      toast.ok("Número de WhatsApp conectado.");
      setNumber("");
      setDisplayName("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setConectando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Un número por marca o compartido, conectado con el registro integrado del proveedor oficial (Cloud API con coexistencia); prohibidos los conectores por QR." />
      <CabeceraPaso step={datos?.step} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra
          titulo="Números conectados"
          valor={datos ? `${datos.connected_count} de ${datos.limit}` : "…"}
          detalle="Límite del plan contratado"
          tono={datos && datos.connected_count >= datos.limit ? "warn" : undefined}
        />
      </div>

      <DataTable<CanalWa>
        rows={datos?.channels ?? []}
        loading={cargando}
        rowKey={(r) => r.id}
        empty="Sin números de WhatsApp conectados."
        columns={[
          { key: "number", header: "Número", render: (r) => <span className="font-mono font-semibold">{r.number}</span> },
          { key: "display_name", header: "Nombre visible", render: (r) => r.display_name },
          {
            key: "brand_name",
            header: "Marca",
            render: (r) => (r.shared || !r.brand_id ? <Badge tone="info">Compartido</Badge> : r.brand_name || "—"),
          },
          { key: "coexistence", header: "Coexistencia", render: (r) => (r.coexistence ? "Sí (app + API)" : "Solo API") },
          { key: "quality_rating", header: "Calidad", render: (r) => r.quality_rating || "HIGH" },
          {
            key: "status",
            header: "Estado",
            render: (r) => <Badge tone={r.status === "ACTIVE" ? "ok" : "neutral"}>{r.status === "ACTIVE" ? "Activo" : r.status}</Badge>,
          },
        ]}
      />

      <form onSubmit={conectar} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">Conectar un número (registro integrado oficial)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Celular (9 dígitos)" required>
            <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="987654321" required />
          </Field>
          <Field label="Nombre visible">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Don Guando" />
          </Field>
          <Field label="Marca">
            <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={shared}>
              {datos?.brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-6">
          <Checkbox checked={shared} onChange={(v) => setShared(v)} label="Número compartido por varias marcas" />
          <Checkbox
            checked={coexistence}
            onChange={(v) => setCoexistence(v)}
            label="Coexistencia (sigue funcionando la app WhatsApp Business)"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" icon={MessageSquarePlus} loading={conectando}>
            Conectar con el proveedor oficial
          </Button>
        </div>
      </form>
    </div>
  );
}
