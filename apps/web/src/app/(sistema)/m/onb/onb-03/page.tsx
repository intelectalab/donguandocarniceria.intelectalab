"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { Button, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type RespuestaEmpresa = {
  company: {
    id: string;
    legal_name: string;
    ruc: string;
    sunat_status: string | null;
    sunat_condition: string | null;
    trade_name: string;
    fiscal_address: string;
    fiscal_ubigeo: string | null;
    tax_regime: string;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
  } | null;
  regimenes: Record<string, string>;
  step: PasoAlta | null;
};

export default function Onb03EmpresaPage() {
  const [datos, setDatos] = useState<RespuestaEmpresa | null>(null);
  const [tradeName, setTradeName] = useState("");
  const [address, setAddress] = useState("");
  const [ubigeo, setUbigeo] = useState("");
  const [regime, setRegime] = useState("MYPE");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#922242");
  const [secondaryColor, setSecondaryColor] = useState("#FFC676");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api<RespuestaEmpresa>("/v1/onb/empresa")
      .then((r) => {
        setDatos(r);
        if (r.company) {
          setTradeName(r.company.trade_name ?? "");
          setAddress(r.company.fiscal_address ?? "");
          setUbigeo(r.company.fiscal_ubigeo ?? "");
          setRegime(r.company.tax_regime ?? "MYPE");
          setLogoUrl(r.company.logo_url ?? "");
          setPrimaryColor(r.company.primary_color || "#922242");
          setSecondaryColor(r.company.secondary_color || "#FFC676");
        }
      })
      .catch((e) => toast.error(mensajeDe(e)));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await api<RespuestaEmpresa>("/v1/onb/empresa", {
        method: "PUT",
        body: JSON.stringify({
          trade_name: tradeName,
          fiscal_address: address,
          fiscal_ubigeo: ubigeo,
          tax_regime: regime,
          logo_url: logoUrl,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
        }),
      });
      setDatos(r);
      toast.ok("Datos de la empresa guardados.");
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  const co = datos?.company;
  const iniciales = (tradeName || co?.legal_name || "GC")
    .split(" ")
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="space-y-5">
      <PageHeader description="Datos fiscales traídos de SUNAT (la razón social y el RUC no se editan), nombre comercial, domicilio, régimen, logo y colores." />
      <CabeceraPaso step={datos?.step} />

      <div className="grid gap-5 lg:grid-cols-3">
        <form onSubmit={guardar} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card lg:col-span-2">
          <h2 className="text-[15px] font-semibold">Datos de la empresa</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Razón social (SUNAT)">
              <Input value={co?.legal_name ?? ""} readOnly disabled />
            </Field>
            <Field label="RUC">
              <Input value={co?.ruc ?? ""} readOnly disabled />
            </Field>
            <Field label="Estado / condición SUNAT">
              <Input value={`${co?.sunat_status || "ACTIVO"} / ${co?.sunat_condition || "HABIDO"}`} readOnly disabled />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre comercial" required>
              <Input value={tradeName} onChange={(e) => setTradeName(e.target.value)} required />
            </Field>
            <Field label="Régimen tributario">
              <Select value={regime} onChange={(e) => setRegime(e.target.value)}>
                {Object.entries(datos?.regimenes ?? { MYPE: "Régimen MYPE Tributario", RER: "Régimen Especial (RER)", GENERAL: "Régimen General", NRUS: "Nuevo RUS" }).map(
                  ([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  )
                )}
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Domicilio fiscal" required>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} required />
              </Field>
            </div>
            <Field label="Ubigeo (6 dígitos)">
              <Input value={ubigeo} onChange={(e) => setUbigeo(e.target.value)} placeholder="150140" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Logo (URL)">
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
            </Field>
            <Field label="Color principal (#RRGGBB)">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-line bg-surface"
                />
                <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
              </div>
            </Field>
            <Field label="Color secundario (#RRGGBB)">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-line bg-surface"
                />
                <Input value={secondaryColor} onChange={(e) => setSecondaryColor(e.target.value)} />
              </div>
            </Field>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" icon={Save} loading={guardando}>
              Guardar empresa
            </Button>
          </div>
        </form>

        <div className="space-y-4">
          <div
            className="rounded-xl border border-line bg-surface p-5 shadow-card"
            style={{ borderTop: `6px solid ${primaryColor || "#922242"}` }}
          >
            <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted">Vista previa</h3>
            <div className="flex items-center gap-3.5">
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[15px] font-bold text-white"
                style={{ backgroundColor: primaryColor || "#922242" }}
              >
                {iniciales}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[16px] font-bold">{tradeName || "—"}</div>
                <div className="truncate text-[12.5px] text-muted">
                  {co?.legal_name} · RUC {co?.ruc}
                </div>
                <div className="truncate text-[12px] text-muted">{address}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
