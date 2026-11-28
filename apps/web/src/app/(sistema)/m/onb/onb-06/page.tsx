"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Edit3, Sparkles } from "lucide-react";
import { Alert, Badge, Button, DataTable, DetailList, Field, Input, Modal, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fechaHora, numero } from "@/lib/formato";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Serie = {
  id: string;
  series: string;
  doc_type: string;
  brand_id: string | null;
  brand_name: string | null;
  establishment_code: string | null;
  legacy_last_number: number | null;
  next_number: number;
};

type RespuestaSeries = {
  series: Serie[];
  company: {
    id: string;
    einvoice_provider: string;
    einvoice_user: string;
    einvoice_env: string;
    einvoice_secret_last4: string | null;
    einvoice_test: {
      at: string;
      series: string;
      result: string;
      ticket: string;
      message: string;
    } | null;
  };
  step_series: PasoAlta | null;
  step_einvoice: PasoAlta | null;
};

const TIPOS_DOC: Record<string, string> = {
  INVOICE: "Factura",
  RECEIPT: "Boleta",
  CREDIT_NOTE: "Nota de crédito",
  DEBIT_NOTE: "Nota de débito",
  DISPATCH_GUIDE: "Guía de remisión",
};

export default function Onb06SeriesOsePage() {
  const [datos, setDatos] = useState<RespuestaSeries | null>(null);
  const [cargando, setCargando] = useState(true);
  const [mode, setMode] = useState("BRAND");
  const [generando, setGenerando] = useState(false);

  const [serieEditar, setSerieEditar] = useState<Serie | null>(null);
  const [ultimoNum, setUltimoNum] = useState("");
  const [guardandoNum, setGuardandoNum] = useState(false);

  const [provider, setProvider] = useState("OSE_GENERICO");
  const [user, setUser] = useState("");
  const [secret, setSecret] = useState("");
  const [probando, setProbando] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaSeries>("/v1/onb/series")
      .then((r) => {
        setDatos(r);
        setProvider(r.company.einvoice_provider || "OSE_GENERICO");
        setUser(r.company.einvoice_user || "");
      })
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  async function proponer() {
    setGenerando(true);
    try {
      const r = await api<RespuestaSeries & { created: number }>("/v1/onb/series/proponer", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setDatos(r);
      toast.ok(`${r.created} serie(s) creada(s).`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGenerando(false);
    }
  }

  async function guardarCorrelativo(e: React.FormEvent) {
    e.preventDefault();
    if (!serieEditar) return;
    setGuardandoNum(true);
    try {
      const r = await api<Serie>(`/v1/onb/series/${serieEditar.series}/correlativo`, {
        method: "PUT",
        body: JSON.stringify({ last_number: Number(ultimoNum) }),
      });
      toast.ok(`${r.series}: el primero en GestionCarnica será ${r.series}-${String(r.next_number).padStart(8, "0")}.`);
      setSerieEditar(null);
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardandoNum(false);
    }
  }

  async function enviarPrueba(e: React.FormEvent) {
    e.preventDefault();
    setProbando(true);
    try {
      const r = await api<{ ticket: string }>("/v1/onb/ose/probar", {
        method: "POST",
        body: JSON.stringify({ provider, user, secret }),
      });
      toast.ok(`Comprobante de prueba aceptado: ${r.ticket}`);
      setSecret("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
      cargar();
    } finally {
      setProbando(false);
    }
  }

  const t = datos?.company.einvoice_test;

  return (
    <div className="space-y-5">
      <PageHeader description="Series propuestas (F001, B001, T001) por empresa o por marca; último correlativo del sistema anterior; credenciales del OSE y comprobante de prueba." />
      <CabeceraPaso step={datos?.step_series} secondStep={datos?.step_einvoice} />

      <div className="space-y-3 rounded-xl border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Series de comprobantes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={mode} onChange={(e) => setMode(e.target.value)} className="w-64">
              <option value="BRAND">Una serie por marca (F001, F002…)</option>
              <option value="COMPANY">Una serie para toda la empresa</option>
            </Select>
            <Button icon={Sparkles} loading={generando} onClick={proponer}>
              Generar series propuestas
            </Button>
          </div>
        </div>

        <DataTable<Serie>
          rows={datos?.series ?? []}
          loading={cargando}
          rowKey={(r) => r.id}
          empty="Genera las series propuestas para empezar."
          columns={[
            { key: "series", header: "Serie", render: (r) => <span className="font-mono font-semibold">{r.series}</span> },
            { key: "doc_type", header: "Tipo", render: (r) => TIPOS_DOC[r.doc_type] ?? r.doc_type },
            { key: "brand_name", header: "Marca", render: (r) => r.brand_name || "Toda la empresa" },
            { key: "establishment_code", header: "Local", render: (r) => r.establishment_code || "—" },
            {
              key: "legacy_last_number",
              header: "Último en el sistema anterior",
              align: "right",
              render: (r) => (r.legacy_last_number != null ? numero(r.legacy_last_number) : "—"),
            },
            {
              key: "next_number",
              header: "Primer número en el sistema",
              render: (r) => (
                <span className="font-mono font-medium">
                  {r.series}-{String(r.next_number).padStart(8, "0")}
                </span>
              ),
            },
            {
              key: "acciones",
              header: "Acción",
              align: "right",
              render: (r) => (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Edit3}
                  onClick={() => {
                    setSerieEditar(r);
                    setUltimoNum(r.legacy_last_number != null ? String(r.legacy_last_number) : "");
                  }}
                >
                  Último correlativo
                </Button>
              ),
            },
          ]}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={enviarPrueba} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-semibold">Credenciales del OSE</h2>
          <Field label="Proveedor">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="OSE_GENERICO">OSE homologado (genérico)</option>
              <option value="SUNAT_SEE">SEE SUNAT (sistema del contribuyente)</option>
              <option value="FAKE">FAKE (desarrollo)</option>
            </Select>
          </Field>
          <Field label="Usuario SOL / OSE" required>
            <Input value={user} onChange={(e) => setUser(e.target.value)} required />
          </Field>
          <Field label="Clave (al menos 8 caracteres)" required hint="Se guarda cifrada; se muestran solo los 4 últimos caracteres.">
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} required />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" icon={CheckCircle2} loading={probando}>
              Guardar y enviar comprobante de prueba
            </Button>
          </div>
        </form>

        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-semibold">Último comprobante de prueba</h2>
          {t ? (
            <div className="space-y-3">
              <Alert tone={t.result === "ACCEPTED" ? "ok" : "bad"} title={t.result === "ACCEPTED" ? "Aceptado" : "Rechazado"}>
                {t.message}
              </Alert>
              <DetailList
                items={[
                  { label: "Enviado", value: fechaHora(t.at) },
                  { label: "Serie", value: t.series },
                  {
                    label: "Resultado",
                    value: <Badge tone={t.result === "ACCEPTED" ? "ok" : "bad"}>{t.result === "ACCEPTED" ? "Aceptado" : "Rechazado"}</Badge>,
                  },
                  { label: "Ticket", value: <span className="font-mono">{t.ticket}</span> },
                  { label: "Entorno", value: datos?.company.einvoice_env || "BETA" },
                  { label: "Clave guardada", value: datos?.company.einvoice_secret_last4 ? `••••${datos.company.einvoice_secret_last4}` : "—" },
                ]}
              />
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">Aún no se envió el comprobante de prueba en el entorno de homologación.</p>
          )}
        </div>
      </div>

      <Modal open={Boolean(serieEditar)} onClose={() => setSerieEditar(null)} title={serieEditar ? `Serie ${serieEditar.series}` : ""}>
        <form onSubmit={guardarCorrelativo} className="space-y-4">
          <Field label="Último número emitido en el sistema anterior" required>
            <Input type="number" min="0" value={ultimoNum} onChange={(e) => setUltimoNum(e.target.value)} required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSerieEditar(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={guardandoNum}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
