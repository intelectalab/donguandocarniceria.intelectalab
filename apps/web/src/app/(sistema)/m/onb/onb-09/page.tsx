"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { soles } from "@/lib/formato";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Zona = {
  id: string;
  code: string;
  name: string;
  establishment_code: string | null;
  districts: string[];
  delivery_fee: number;
  free_from_units: number | null;
  free_from_kg: number | null;
  min_order_amount: number;
  province: boolean;
};

type Local = { id: string; code: string; name: string };

type RespuestaZonas = {
  zones: Zona[];
  establishments: Local[];
  step: PasoAlta | null;
};

export default function Onb09ZonasRepartoPage() {
  const [datos, setDatos] = useState<RespuestaZonas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [estId, setEstId] = useState("");
  const [districts, setDistricts] = useState("");
  const [fee, setFee] = useState("8");
  const [freeUnits, setFreeUnits] = useState("3");
  const [freeKg, setFreeKg] = useState("");
  const [minOrder, setMinOrder] = useState("30");
  const [province, setProvince] = useState(false);
  const [guardando, setGuardando] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaZonas>("/v1/onb/zonas")
      .then((r) => {
        setDatos(r);
        if (!estId && r.establishments[0]) {
          setEstId(r.establishments[0].id);
        }
      })
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
      await api("/v1/onb/zonas", {
        method: "POST",
        body: JSON.stringify({
          code,
          name,
          establishment_id: estId,
          districts,
          delivery_fee: Number(fee || 0),
          free_from_units: freeUnits ? Number(freeUnits) : null,
          free_from_kg: freeKg ? Number(freeKg) : null,
          min_order_amount: Number(minOrder || 0),
          province,
        }),
      });
      toast.ok("Zona de reparto agregada.");
      setCode("");
      setName("");
      setDistricts("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Zonas por local con distritos (o polígono en Clientes), tarifa y regla de delivery gratis." />
      <CabeceraPaso step={datos?.step} />

      <DataTable<Zona>
        rows={datos?.zones ?? []}
        loading={cargando}
        rowKey={(r) => r.id}
        empty="Sin zonas de reparto registradas."
        columns={[
          { key: "code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
          { key: "name", header: "Zona", render: (r) => r.name },
          { key: "establishment_code", header: "Despacha", render: (r) => r.establishment_code || "—" },
          { key: "districts", header: "Distritos", render: (r) => (Array.isArray(r.districts) ? r.districts.join(", ") : String(r.districts || "")) },
          { key: "delivery_fee", header: "Tarifa", align: "right", render: (r) => soles(r.delivery_fee) },
          {
            key: "free",
            header: "Gratis desde",
            render: (r) =>
              [r.free_from_units ? `${r.free_from_units} u` : null, r.free_from_kg ? `${r.free_from_kg} kg` : null]
                .filter(Boolean)
                .join(" o ") || "—",
          },
          { key: "min_order_amount", header: "Pedido mínimo", align: "right", render: (r) => soles(r.min_order_amount) },
        ]}
      />

      {(datos?.establishments.length ?? 0) === 0 ? (
        <Alert tone="warn" title="Registra primero un local">
          Las zonas se asocian al local que despacha: registra al menos un local en ONB-05.
        </Alert>
      ) : (
        <form onSubmit={agregar} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-semibold">Nueva zona de reparto</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Código" required>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUR" required />
            </Field>
            <Field label="Nombre" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Surco y Miraflores" required />
            </Field>
            <Field label="Local que despacha" required>
              <Select value={estId} onChange={(e) => setEstId(e.target.value)} required>
                {datos?.establishments.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Distritos (separados por coma)" required>
            <Input
              value={districts}
              onChange={(e) => setDistricts(e.target.value)}
              placeholder="Santiago de Surco, Miraflores, San Borja, Barranco"
              required
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Tarifa (S/)">
              <Input type="number" min="0" step="0.5" value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="Gratis desde (unidades)">
              <Input type="number" min="0" value={freeUnits} onChange={(e) => setFreeUnits(e.target.value)} />
            </Field>
            <Field label="Gratis desde (kg)">
              <Input type="number" min="0" step="0.5" value={freeKg} onChange={(e) => setFreeKg(e.target.value)} />
            </Field>
            <Field label="Pedido mínimo (S/)">
              <Input type="number" min="0" step="1" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />
            </Field>
          </div>
          <Checkbox checked={province} onChange={(v) => setProvince(v)} label="Envío a provincia (agencia)" />
          <div className="flex justify-end">
            <Button type="submit" icon={Plus} loading={guardando}>
              Agregar zona
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
