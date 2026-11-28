"use client";

import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { Button, Checkbox, DataTable, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type MedioDef = { code: string; name: string; kind: string; requires_reference: boolean };
type Medio = { id: string; code: string; name: string; status: string };
type Caja = { id: string; code: string; name: string; account_type: string; establishment_code: string | null };
type Local = { id: string; code: string; name: string };

type RespuestaPagos = {
  defaults: MedioDef[];
  payment_methods: Medio[];
  cash_accounts: Caja[];
  establishments: Local[];
  step: PasoAlta | null;
};

export default function Onb07PagosCajasPage() {
  const [datos, setDatos] = useState<RespuestaPagos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [guardandoMedios, setGuardandoMedios] = useState(false);

  const [cCode, setCCode] = useState("");
  const [cName, setCName] = useState("");
  const [cType, setCType] = useState("BANK");
  const [cEst, setCEst] = useState("");
  const [cAcc, setCAcc] = useState("");
  const [guardandoCaja, setGuardandoCaja] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaPagos>("/v1/onb/pagos")
      .then((r) => {
        setDatos(r);
        const activos = r.payment_methods.filter((p) => p.status === "ACTIVE").map((p) => p.code);
        setSeleccionados(activos.length ? activos : ["CASH", "YAPE", "PLIN"]);
      })
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  function toggleMedio(code: string) {
    setSeleccionados((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  }

  async function guardarMediosYCajasPorLocal() {
    setGuardandoMedios(true);
    try {
      const cajasLocal = (datos?.establishments ?? []).map((e) => ({
        code: `CAJA-${e.code}`,
        name: `Caja ${e.name}`,
        type: "CASH_REGISTER",
        establishment_id: e.id,
      }));
      const r = await api<RespuestaPagos>("/v1/onb/pagos", {
        method: "POST",
        body: JSON.stringify({ codes: seleccionados, cash_boxes: cajasLocal }),
      });
      setDatos(r);
      toast.ok("Medios de pago y cajas guardados.");
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardandoMedios(false);
    }
  }

  async function agregarCaja(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoCaja(true);
    try {
      const r = await api<RespuestaPagos>("/v1/onb/pagos", {
        method: "POST",
        body: JSON.stringify({
          codes: seleccionados.length ? seleccionados : ["CASH"],
          cash_boxes: [
            {
              code: cCode,
              name: cName,
              type: cType,
              establishment_id: cEst || null,
              account_number: cAcc || null,
            },
          ],
        }),
      });
      setDatos(r);
      setCCode("");
      setCName("");
      setCAcc("");
      toast.ok("Caja o cuenta agregada.");
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardandoCaja(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Efectivo, Yape, Plin, POS de tarjeta, pasarela web y transferencia; cajas por local." />
      <CabeceraPaso step={datos?.step} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <h2 className="text-[15px] font-semibold">Medios de pago</h2>
          <div className="space-y-2.5">
            {(datos?.defaults ?? []).map((m) => (
              <Checkbox
                key={m.code}
                checked={seleccionados.includes(m.code)}
                onChange={() => toggleMedio(m.code)}
                label={`${m.name}${m.requires_reference ? " · exige número de operación" : ""}`}
              />
            ))}
          </div>
          <div className="pt-2">
            <Button icon={Save} loading={guardandoMedios} onClick={guardarMediosYCajasPorLocal}>
              Guardar medios y crear cajas por local
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-[15px] font-semibold">Cajas y cuentas</h2>
          <DataTable<Caja>
            rows={datos?.cash_accounts ?? []}
            loading={cargando}
            rowKey={(r) => r.id}
            empty="Sin cajas registradas."
            columns={[
              { key: "code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
              { key: "name", header: "Caja o cuenta", render: (r) => r.name },
              { key: "account_type", header: "Tipo", render: (r) => r.account_type },
              { key: "establishment_code", header: "Local", render: (r) => r.establishment_code || "Empresa" },
            ]}
          />

          <form onSubmit={agregarCaja} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h3 className="text-[14px] font-semibold">Agregar caja o cuenta</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código" required>
                <Input value={cCode} onChange={(e) => setCCode(e.target.value.toUpperCase())} placeholder="BCP-SOL" required />
              </Field>
              <Field label="Nombre" required>
                <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Cuenta corriente BCP" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Tipo">
                <Select value={cType} onChange={(e) => setCType(e.target.value)}>
                  <option value="CASH_REGISTER">Caja de local</option>
                  <option value="PETTY_CASH">Caja chica</option>
                  <option value="BANK">Cuenta bancaria</option>
                  <option value="WALLET">Billetera (Yape/Plin)</option>
                  <option value="GATEWAY">Pasarela</option>
                  <option value="CARD_ACQUIRER">POS de tarjeta</option>
                </Select>
              </Field>
              <Field label="Local (opcional)">
                <Select value={cEst} onChange={(e) => setCEst(e.target.value)}>
                  <option value="">Toda la empresa</option>
                  {datos?.establishments.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} · {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Número de cuenta o celular">
              <Input value={cAcc} onChange={(e) => setCAcc(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" icon={Plus} loading={guardandoCaja}>
                Agregar caja o cuenta
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
