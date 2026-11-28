"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Cifra, DataTable, Field, Input, PageHeader, Textarea, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Marca = {
  id: string;
  code: string;
  name: string;
  primary_color: string;
  whatsapp_display_name: string | null;
  legal_footer: string | null;
  status: string;
};

type RespuestaMarcas = {
  brands: Marca[];
  active_count: number;
  limit: number | null;
  plan_code: string;
  step: PasoAlta | null;
};

export default function Onb04MarcasPage() {
  const [datos, setDatos] = useState<RespuestaMarcas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#922242");
  const [waName, setWaName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [description, setDescription] = useState("");
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaMarcas>("/v1/onb/marcas")
      .then(setDatos)
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api("/v1/onb/marcas", {
        method: "POST",
        body: JSON.stringify({ code, name, color, wa_name: waName, logo_url: logoUrl, description }),
      });
      toast.ok("Marca agregada.");
      setCode("");
      setName("");
      setWaName("");
      setLogoUrl("");
      setDescription("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const lim = datos?.limit;
  const act = datos?.active_count ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader description="Alta de marcas con logo, color y pie legal; avisa al acercarse al límite del plan." />
      <CabeceraPaso step={datos?.step} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Cifra
          titulo="Marcas activas"
          valor={lim != null ? `${act} de ${lim}` : String(act)}
          detalle={datos ? `Límite del plan ${datos.plan_code}` : ""}
          tono={lim != null && act >= lim ? "bad" : lim != null && act >= lim - 1 ? "warn" : undefined}
        />
      </div>

      {lim != null && act >= lim - 1 && act < lim && (
        <Alert tone="warn" title="Cerca del límite del plan">
          Te queda {lim - act} marca disponible en tu plan actual; al superarlo se requerirá un complemento de marcas (SUS-03).
        </Alert>
      )}

      <DataTable<Marca>
        rows={datos?.brands ?? []}
        loading={cargando}
        rowKey={(r) => r.id}
        empty="Aún no hay marcas registradas."
        columns={[
          { key: "code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
          {
            key: "name",
            header: "Marca",
            render: (r) => (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: r.primary_color || "#922242" }} />
                <span className="font-medium">{r.name}</span>
              </div>
            ),
          },
          { key: "whatsapp_display_name", header: "Nombre en WhatsApp", render: (r) => r.whatsapp_display_name || "—" },
          { key: "legal_footer", header: "Pie legal", render: (r) => <span className="text-[12.5px] text-muted">{r.legal_footer || "—"}</span> },
          {
            key: "status",
            header: "Estado",
            render: (r) => <Badge tone={r.status === "ACTIVE" ? "ok" : "neutral"}>{r.status === "ACTIVE" ? "Activa" : r.status}</Badge>,
          },
        ]}
      />

      <form onSubmit={agregar} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <h2 className="text-[15px] font-semibold">Nueva marca</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Código (2 a 6 letras o números)" required>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DG" required />
          </Field>
          <Field label="Nombre de la marca" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Don Guando" required />
          </Field>
          <Field label="Color principal">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-9 w-12 cursor-pointer rounded border border-line bg-surface"
              />
              <Input value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre visible en WhatsApp">
            <Input value={waName} onChange={(e) => setWaName(e.target.value)} placeholder="Opcional (por defecto el nombre)" />
          </Field>
          <Field label="Logo (URL)">
            <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
          </Field>
        </div>
        <Field label="Descripción">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" icon={Plus} loading={guardando}>
            Agregar marca
          </Button>
        </div>
      </form>
    </div>
  );
}
