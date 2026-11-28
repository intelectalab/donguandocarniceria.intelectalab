"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Button, Checkbox, DataTable, Field, Input, PageHeader, Select, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { CabeceraPaso, PasoAlta } from "@/modulos/onb/comun";

type Local = {
  id: string;
  code: string;
  name: string;
  sunat_code: string;
  est_type: string;
  address: string;
  has_counter: boolean;
};

type Almacen = {
  id: string;
  code: string;
  name: string;
  establishment_id: string;
  establishment_code: string;
  wh_type: string;
  min_temp_c: number | null;
  max_temp_c: number | null;
};

type RespuestaLocales = {
  establishments: Local[];
  warehouses: Almacen[];
  wh_types: Record<string, string>;
  sites_limit: number | null;
  step_establishments: PasoAlta | null;
  step_warehouses: PasoAlta | null;
};

const TIPOS_LOCAL: Record<string, string> = {
  MIXED: "Producción y tienda",
  STORE: "Tienda",
  PLANT: "Planta",
  WAREHOUSE: "Almacén",
};

export default function Onb05LocalesAlmacenesPage() {
  const [datos, setDatos] = useState<RespuestaLocales | null>(null);
  const [cargando, setCargando] = useState(true);

  const [eCode, setECode] = useState("");
  const [eName, setEName] = useState("");
  const [eSunat, setESunat] = useState("0000");
  const [eType, setEType] = useState("MIXED");
  const [eAddr, setEAddr] = useState("");
  const [eCounter, setECounter] = useState(true);
  const [guardandoLocal, setGuardandoLocal] = useState(false);

  const [wEst, setWEst] = useState("");
  const [wCode, setWCode] = useState("");
  const [wName, setWName] = useState("");
  const [wType, setWType] = useState("COLD_ROOM");
  const [wMin, setWMin] = useState("0");
  const [wMax, setWMax] = useState("4");
  const [guardandoWh, setGuardandoWh] = useState(false);

  function cargar() {
    setCargando(true);
    api<RespuestaLocales>("/v1/onb/locales")
      .then((r) => {
        setDatos(r);
        setESunat(String(r.establishments.length).padStart(4, "0"));
        if (!wEst && r.establishments[0]) {
          setWEst(r.establishments[0].id);
        }
      })
      .catch((e) => toast.error(mensajeDe(e)))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
  }, []);

  function cambiarTipoAlmacen(tipo: string) {
    setWType(tipo);
    if (tipo === "COLD_ROOM" || tipo === "STORE") {
      setWMin("0");
      setWMax("4");
    } else if (tipo === "FREEZER") {
      setWMin("-22");
      setWMax("-18");
    } else {
      setWMin("");
      setWMax("");
    }
  }

  async function agregarLocal(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoLocal(true);
    try {
      await api("/v1/onb/locales", {
        method: "POST",
        body: JSON.stringify({
          code: eCode,
          name: eName,
          sunat_code: eSunat,
          est_type: eType,
          address: eAddr,
          has_counter: eCounter,
        }),
      });
      toast.ok("Local agregado.");
      setECode("");
      setEName("");
      setEAddr("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardandoLocal(false);
    }
  }

  async function agregarAlmacen(e: React.FormEvent) {
    e.preventDefault();
    setGuardandoWh(true);
    try {
      await api("/v1/onb/almacenes", {
        method: "POST",
        body: JSON.stringify({
          establishment_id: wEst,
          code: wCode,
          name: wName,
          wh_type: wType,
          min_temp_c: wMin,
          max_temp_c: wMax,
        }),
      });
      toast.ok("Almacén agregado.");
      setWCode("");
      setWName("");
      cargar();
    } catch (err) {
      toast.error(mensajeDe(err));
    } finally {
      setGuardandoWh(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader description="Locales con código de anexo SUNAT y tipo; almacenes por local (cámara, congeladora, tienda) con su rango de temperatura." />
      <CabeceraPaso step={datos?.step_establishments} secondStep={datos?.step_warehouses} />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-[15px] font-semibold">Locales</h2>
          <DataTable<Local>
            rows={datos?.establishments ?? []}
            loading={cargando}
            rowKey={(r) => r.id}
            empty="Sin locales registrados."
            columns={[
              { key: "code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
              { key: "name", header: "Local", render: (r) => r.name },
              { key: "sunat_code", header: "Anexo SUNAT", render: (r) => <span className="font-mono">{r.sunat_code}</span> },
              { key: "est_type", header: "Tipo", render: (r) => TIPOS_LOCAL[r.est_type] ?? r.est_type },
              { key: "has_counter", header: "Mostrador", render: (r) => (r.has_counter ? "Sí" : "No") },
            ]}
          />

          <form onSubmit={agregarLocal} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
            <h3 className="text-[14px] font-semibold">Agregar local</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código" required>
                <Input value={eCode} onChange={(e) => setECode(e.target.value.toUpperCase())} placeholder="L1" required />
              </Field>
              <Field label="Nombre" required>
                <Input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Planta y tienda" required />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código de anexo SUNAT (0000 = fiscal)" required>
                <Input value={eSunat} onChange={(e) => setESunat(e.target.value)} required />
              </Field>
              <Field label="Tipo de local">
                <Select value={eType} onChange={(e) => setEType(e.target.value)}>
                  {Object.entries(TIPOS_LOCAL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Dirección">
              <Input value={eAddr} onChange={(e) => setEAddr(e.target.value)} />
            </Field>
            <Checkbox checked={eCounter} onChange={(v) => setECounter(v)} label="Tiene mostrador de venta" />
            <div className="flex justify-end">
              <Button type="submit" icon={Plus} loading={guardandoLocal}>
                Agregar local
              </Button>
            </div>
          </form>
        </div>

        <div className="space-y-4">
          <h2 className="text-[15px] font-semibold">Almacenes</h2>
          <DataTable<Almacen>
            rows={datos?.warehouses ?? []}
            loading={cargando}
            rowKey={(r) => r.id}
            empty="Sin almacenes registrados."
            columns={[
              { key: "code", header: "Código", render: (r) => <span className="font-mono font-semibold">{r.code}</span> },
              { key: "name", header: "Almacén", render: (r) => r.name },
              { key: "establishment_code", header: "Local", render: (r) => r.establishment_code || "—" },
              { key: "wh_type", header: "Tipo", render: (r) => datos?.wh_types?.[r.wh_type] ?? r.wh_type },
              {
                key: "temp",
                header: "Temperatura",
                render: (r) => (r.min_temp_c != null ? `${r.min_temp_c} a ${r.max_temp_c} °C` : "Ambiente"),
              },
            ]}
          />

          {(datos?.establishments.length ?? 0) === 0 ? (
            <Alert tone="warn" title="Registra primero un local">
              Un almacén pertenece a un local: agrega primero al menos un local en la columna izquierda.
            </Alert>
          ) : (
            <form onSubmit={agregarAlmacen} className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
              <h3 className="text-[14px] font-semibold">Agregar almacén</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Local" required>
                  <Select value={wEst} onChange={(e) => setWEst(e.target.value)} required>
                    {datos?.establishments.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.code} · {l.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tipo de almacén">
                  <Select value={wType} onChange={(e) => cambiarTipoAlmacen(e.target.value)}>
                    {Object.entries(datos?.wh_types ?? {}).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Código" required>
                  <Input value={wCode} onChange={(e) => setWCode(e.target.value.toUpperCase())} placeholder="CAM-L1" required />
                </Field>
                <Field label="Nombre" required>
                  <Input value={wName} onChange={(e) => setWName(e.target.value)} placeholder="Cámara de frío" required />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Temp. mínima (°C)">
                  <Input type="number" step="0.5" value={wMin} onChange={(e) => setWMin(e.target.value)} />
                </Field>
                <Field label="Temp. máxima (°C)">
                  <Input type="number" step="0.5" value={wMax} onChange={(e) => setWMax(e.target.value)} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" icon={Plus} loading={guardandoWh}>
                  Agregar almacén
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
