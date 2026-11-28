"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck2, Rocket } from "lucide-react";
import { Alert, Badge, Button, DetailList, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { fecha, fechaHora, soles } from "@/lib/formato";
import { CabeceraPaso, EstadoPasoBadge, IconoPaso, PasoAlta } from "@/modulos/onb/comun";

type Serie = { id: string; series: string; doc_type: string; next_number: number };

type EstadoSalida = {
  run: {
    id: string;
    status: string;
    go_live_at: string | null;
    first_accepted_document_at: string | null;
    first_document: { id: string; full_number: string; total: number; customer_name: string } | null;
  };
  steps: PasoAlta[];
};

export default function Onb15SalidaProduccionPage() {
  const [datos, setDatos] = useState<EstadoSalida | null>(null);
  const [series, setSeries] = useState<Serie[]>([]);
  const [serieSel, setSerieSel] = useState("");
  const [desc, setDesc] = useState("Primera venta en GestionCarnica");
  const [amount, setAmount] = useState("45");
  const [goLiveDate, setGoLiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [emitiendo, setEmitiendo] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  function cargar() {
    api<EstadoSalida>("/v1/onb/pasos")
      .then(setDatos)
      .catch((e) => toast.error(mensajeDe(e)));
    api<{ series: Serie[] }>("/v1/onb/series")
      .then((r) => {
        const validas = r.series.filter((s) => ["RECEIPT", "INVOICE"].includes(s.doc_type));
        setSeries(validas);
        if (!serieSel && validas[0]) setSerieSel(validas[0].series);
      })
      .catch(() => {});
  }

  useEffect(() => {
    cargar();
  }, []);

  async function emitirPrimero(e: React.FormEvent) {
    e.preventDefault();
    setEmitiendo(true);
    try {
      const doc = await api<{ full_number: string }>("/v1/onb/salida/primer-comprobante", {
        method: "POST",
        body: JSON.stringify({
          series: serieSel,
          description: desc,
          amount: Number(amount),
        }),
      });
      toast.ok(`Comprobante ${doc.full_number} aceptado por SUNAT.`);
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setEmitiendo(false);
    }
  }

  async function salir(e: React.FormEvent) {
    e.preventDefault();
    setSaliendo(true);
    try {
      const r = await api<EstadoSalida>("/v1/onb/salida", {
        method: "POST",
        body: JSON.stringify({ date: goLiveDate }),
      });
      setDatos(r);
      toast.ok("Alta completada: la empresa sale a producción.");
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setSaliendo(false);
    }
  }

  const pasosChecklist = (datos?.steps ?? []).filter((s) => s.step_code !== "GO_LIVE");
  const pendientes = pasosChecklist.filter((s) => s.status === "PENDING" || (s.is_required && s.status !== "DONE"));
  const stepGoLive = (datos?.steps ?? []).find((s) => s.step_code === "GO_LIVE");
  const run = datos?.run;

  return (
    <div className="space-y-5">
      <PageHeader description="Checklist final, primer comprobante real aceptado por SUNAT y fecha de inicio de operación." />
      <CabeceraPaso step={stepGoLive} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-semibold">Checklist final</h2>
          <div className="divide-y divide-line">
            {pasosChecklist.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 py-2 text-[13.5px]">
                <div className="flex items-center gap-2">
                  <IconoPaso status={s.status} />
                  <span>{s.name}</span>
                  {s.is_required && <span className="text-[12px] text-muted">· obligatorio</span>}
                </div>
                <EstadoPasoBadge status={s.status} />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 py-2 text-[13.5px]">
              <div className="flex items-center gap-2">
                <IconoPaso status={run?.first_accepted_document_at ? "DONE" : "PENDING"} />
                <span className="font-medium">Primer comprobante real aceptado</span>
              </div>
              <Badge tone={run?.first_accepted_document_at ? "ok" : "warn"}>
                {run?.first_accepted_document_at ? "Aceptado" : "Pendiente"}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h2 className="text-[15px] font-semibold">Primer comprobante real</h2>
            {run?.first_accepted_document_at ? (
              <div className="space-y-3">
                <Alert tone="ok" title="Comprobante aceptado por SUNAT">
                  Aceptado el {fechaHora(run.first_accepted_document_at)}.
                </Alert>
                {run.first_document && (
                  <DetailList
                    items={[
                      { label: "Comprobante", value: <span className="font-mono font-semibold">{run.first_document.full_number}</span> },
                      { label: "Total", value: soles(run.first_document.total) },
                      { label: "Cliente", value: run.first_document.customer_name || "Clientes varios" },
                    ]}
                  />
                )}
              </div>
            ) : (
              <form onSubmit={emitirPrimero} className="space-y-4">
                <Field label="Serie" required>
                  <Select value={serieSel} onChange={(e) => setSerieSel(e.target.value)} required>
                    {series.map((s) => (
                      <option key={s.id} value={s.series}>
                        {s.series} · siguiente {s.series}-{String(s.next_number).padStart(8, "0")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Descripción" required>
                  <Input value={desc} onChange={(e) => setDesc(e.target.value)} required />
                </Field>
                <Field label="Total con IGV (S/)" required>
                  <Input type="number" min="1" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" icon={FileCheck2} loading={emitiendo}>
                    Emitir y enviar a SUNAT
                  </Button>
                </div>
              </form>
            )}
          </div>

          {run?.status === "COMPLETED" ? (
            <Alert tone="ok" title="Empresa en operación">
              La empresa opera en GestionCarnica desde el <b>{fecha(run.go_live_at)}</b>.
            </Alert>
          ) : (
            <form onSubmit={salir} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
              <h2 className="text-[15px] font-semibold">Inicio de operación</h2>
              {pendientes.length > 0 && (
                <Alert tone="warn" title="Pasos pendientes">
                  Para salir a producción completa u omite los pasos pendientes: {pendientes.map((s) => s.name).join(", ")}.
                </Alert>
              )}
              <Field label="Fecha de inicio de operación" required>
                <Input type="date" value={goLiveDate} onChange={(e) => setGoLiveDate(e.target.value)} required />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" icon={Rocket} loading={saliendo}>
                  Salir a producción
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
