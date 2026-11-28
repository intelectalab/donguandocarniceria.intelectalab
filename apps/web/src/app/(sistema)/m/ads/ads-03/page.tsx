"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Copy, Pencil } from "lucide-react";
import { Alert, Badge, Button, DataTable, Field, PageHeader, Select, toast, type Column } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CodigoQr, InsigniaPlataforma } from "@/modulos/ads/comun";

type Anuncio = {
  id: string; name: string; code: string; tracking_code: string | null;
  brand_name: string; platform: string; plataforma: string;
  destination: string; is_ctwa: boolean; whatsapp_number: string | null;
  utm_content: string | null; wa_link: string | null; utm_url: string | null; enlace: string | null;
  problemas: string[]; sin_rastreo: boolean; status: string;
};

/** ADS-03 Enlaces de rastreo: genera el enlace wa.me con el texto «Hola, vi el anuncio …» y la URL con UTM para cada anuncio; copia y código QR. */
function EnlacesDeRastreoVista() {
  const params = useSearchParams();
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [selId, setSelId] = useState("");
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    api<{ anuncios: Anuncio[] }>("/v1/ads/anuncios").then((r) => {
      setAnuncios(r.anuncios);
      const paramAd = params.get("ad");
      const inicial = (paramAd && r.anuncios.find((x) => x.id === paramAd))
        || r.anuncios.find((x) => x.tracking_code === "DG-G01")
        || r.anuncios.find((x) => x.status === "ACTIVE")
        || r.anuncios[0];
      if (inicial) setSelId(inicial.id);
    }).catch((e) => setError(mensajeDe(e)));
  }, [params]);

  const sel = anuncios.find((a) => a.id === selId) ?? anuncios[0];
  const activos = anuncios.filter((a) => a.status === "ACTIVE");

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.ok("Enlace copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar.");
    }
  }

  const filtrados = anuncios.filter((a) => {
    const t = buscar.trim().toLowerCase();
    return t.length < 2 || [a.name, a.tracking_code ?? "", a.code, a.brand_name, a.plataforma].some((v) => v.toLowerCase().includes(t));
  });

  const cols: Column<Anuncio>[] = [
    {
      key: "code", header: "Rastreo",
      render: (a) => <span className="font-mono text-[12px] font-semibold text-ink">{a.tracking_code || a.utm_content || a.code}</span>,
    },
    { key: "name", header: "Anuncio", cardTitle: true, render: (a) => a.name },
    { key: "brand_name", header: "Marca", render: (a) => a.brand_name },
    { key: "platform", header: "Plataforma", render: (a) => <InsigniaPlataforma p={a.platform} label={a.plataforma} /> },
    {
      key: "enlace", header: "Enlace generado",
      render: (a) => a.enlace ? (
        <span className="font-mono text-[11.5px] break-all text-muted">
          {a.enlace.length > 72 ? `${a.enlace.slice(0, 70)}…` : a.enlace}
        </span>
      ) : (
        <Badge tone="bad">Sin rastreo</Badge>
      ),
    },
    {
      key: "acc", header: "", align: "right",
      render: (a) => a.enlace ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon={Copy} onClick={() => copiar(a.enlace!)}>Copiar</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="grid gap-5">
      <PageHeader description="Enlace wa.me con el texto «Hola, vi el anuncio …» y URL con UTM para cada anuncio, con botón de copia y código QR para afiches, empaques y vitrina." />
      {error && <Alert tone="bad">{error}</Alert>}

      {activos.length > 0 && (
        <div className="max-w-xl">
          <Field label="Anuncio">
            <Select
              value={selId}
              onChange={(e) => setSelId(e.target.value)}
              options={activos.map((a) => ({
                value: a.id,
                label: `${a.tracking_code || a.code} · ${a.name} · ${a.brand_name} · ${a.plataforma}`,
              }))}
            />
          </Field>
        </div>
      )}

      {sel && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="text-[14px] font-semibold text-ink">{sel.destination === "WEB" ? "URL con parámetros UTM" : "Enlace directo a WhatsApp"}</h2>
            {sel.sin_rastreo && (
              <Alert tone="warn">
                Este anuncio tiene observaciones de rastreo ({sel.problemas.join(", ")}). Corrígelo en Campañas y anuncios antes de publicarlo.
              </Alert>
            )}
            {sel.enlace ? (
              <pre className="overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] whitespace-pre-wrap break-all text-ink select-all">
                {sel.enlace}
              </pre>
            ) : (
              <p className="text-[13px] text-muted">Este anuncio todavía no tiene enlace generado: asígnale un código de rastreo o parámetros UTM.</p>
            )}
            {sel.wa_link && (
              <p className="text-[12.5px] text-muted">
                Texto que enviará el cliente: <strong className="text-ink">Hola, vi el anuncio {sel.tracking_code}</strong> · número <span className="font-mono">{sel.whatsapp_number}</span>
              </p>
            )}
            {sel.is_ctwa && (
              <Alert tone="info">
                Anuncio de clic a WhatsApp: Meta envía el referral con el anuncio de origen; el código en el mensaje sirve de respaldo si el cliente reenvía el enlace.
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {sel.enlace && <Button variant="primary" size="sm" icon={Copy} onClick={() => copiar(sel.enlace!)}>Copiar enlace</Button>}
              <Link href={`/m/ads/ads-02?ad=${sel.id}`}><Button variant="ghost" size="sm" icon={Pencil}>Editar rastreo</Button></Link>
            </div>
          </section>

          <section className="grid content-start justify-items-center gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="justify-self-start text-[14px] font-semibold text-ink">Código QR</h2>
            {sel.enlace ? (
              <>
                <CodigoQr valor={sel.enlace} size={172} />
                <p className="text-center text-[12.5px] text-muted">Para afiches, empaques y la vitrina del mostrador ({sel.tracking_code || sel.code}).</p>
              </>
            ) : (
              <p className="py-10 text-[13px] text-muted">Sin enlace para generar código QR.</p>
            )}
          </section>
        </div>
      )}

      <DataTable
        rowKey={(a) => a.id}
        columns={cols}
        rows={filtrados}
        loading={!anuncios.length && !error}
        onRowClick={(a) => setSelId(a.id)}
        empty="No hay anuncios registrados."
        search={{ value: buscar, onChange: setBuscar, placeholder: "Buscar anuncio, código o marca…" }}
      />
    </div>
  );
}

export default function EnlacesDeRastreo() {
  return <Suspense><EnlacesDeRastreoVista /></Suspense>;
}
