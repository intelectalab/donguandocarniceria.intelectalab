"use client";

import { useState } from "react";
import { Ban, UserPlus } from "lucide-react";
import { Alert, Button, DataTable, Field, PageHeader, StatusBadge, toast, type Column } from "@/components/ui";
import { api } from "@/lib/api";
import { fecha, numero } from "@/lib/formato";
import { FiltroSelect, Panel, Sub, accion, opcionesDe, qs, useDatos, useOpcionesDe } from "@/modulos/canales/comunes";
import { Dialogo } from "@/modulos/cat/Dialogo";
import { BuscarCliente, type ClienteBuscado } from "@/modulos/cmp/BuscarCliente";
import { ESTADO_REFERIDO, type Opciones } from "@/modulos/cmp/tipos";

type Referido = { id: string; referrer_customer_id: string; referred_customer_id: string; referral_code: string; status: string; referrer_name: string; referred_name: string;
  coupon_code: string | null; order_number: string | null; reward_points: number | null; reject_reason: string | null; created_at: string; qualified_at: string | null; rewarded_at: string | null };
type Resp = { data: Referido[]; top: { id: string; full_name: string; referral_code: string; referrals: number; rewarded: number }[]; bonus_points: number };

/** CMP-10 Referidos: quién refirió a quién, cupón de bienvenida, primer pedido y bono; ranking de los que más refieren. */
export default function Referidos() {
  const op = useOpcionesDe<Opciones>("/v1/cmp/opciones");
  const [estado, setEstado] = useState("");
  const r = useDatos<Resp>(`/v1/cmp/referidos${qs({ status: estado })}`);
  const [nuevo, setNuevo] = useState(false);
  const gestiona = Boolean(op?.can["cmp.coupon.manage"] || op?.can["cmp.campaign.manage"]);

  const columnas: Column<Referido>[] = [
    { key: "referrer_name", header: "Refirió", cardTitle: true, render: (x) => <div><p className="font-semibold">{x.referrer_name}</p><Sub>Código {x.referral_code}</Sub></div> },
    { key: "referred_name", header: "Cliente nuevo", render: (x) => <div>{x.referred_name}<Sub>desde {fecha(x.created_at)}</Sub></div> },
    { key: "coupon_code", header: "Cupón de bienvenida", hideOnMobile: true, render: (x) => x.coupon_code ? <span className="font-mono">{x.coupon_code}</span> : "—" },
    { key: "order_number", header: "Primer pedido", render: (x) => x.order_number ?? <span className="text-muted">Aún no</span> },
    { key: "reward_points", header: "Bono", align: "right", render: (x) => x.reward_points ? `${numero(x.reward_points)} pts` : "—" },
    { key: "status", header: "Estado", render: (x) => <div><StatusBadge status={x.status} labels={ESTADO_REFERIDO} />{x.reject_reason && <Sub>{x.reject_reason}</Sub>}</div> },
    { key: "acc", header: "", render: (x) => gestiona && ["PENDING", "QUALIFIED"].includes(x.status) && <Button size="sm" variant="ghost" icon={Ban}
      onClick={() => accion({ title: `¿Rechazar el referido de ${x.referred_name}?`, message: "No se dará el bono al que refirió.", confirmLabel: "Rechazar", danger: true, reason: { min: 5, label: "Motivo" } },
        (motivo) => api(`/v1/cmp/referidos/${x.id}/rechazar`, { method: "POST", body: { reason: motivo } }), "Referido rechazado", r.recargar)}>Rechazar</Button> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader description={`El cliente nuevo recibe un cupón de bienvenida. Cuando paga su primer pedido, el que lo refirió gana ${numero(r.datos?.bonus_points ?? 0)} puntos. Un cliente que ya compró no cuenta como referido.`}
        actions={gestiona && <Button variant="primary" icon={UserPlus} onClick={() => setNuevo(true)}>Registrar referido</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <DataTable columns={columnas} rows={r.datos?.data ?? []} loading={r.cargando} error={r.error} onRetry={r.recargar} empty="No hay referidos."
          toolbar={<FiltroSelect label="Estado" value={estado} onChange={setEstado} options={opcionesDe(ESTADO_REFERIDO)} />} />
        <Panel titulo="Los que más refieren">
          {(r.datos?.top ?? []).length === 0 ? <p className="text-muted">Aún no hay referidos.</p> : (
            <ol className="space-y-2.5">
              {r.datos!.top.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold">{i + 1}</span>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{t.full_name}</p><Sub>{t.referral_code}</Sub></div>
                  <div className="text-right tabular-nums"><p className="font-semibold">{numero(t.referrals)}</p><Sub>{numero(t.rewarded)} premiados</Sub></div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
      {nuevo && <Nuevo onClose={() => setNuevo(false)} onHecho={() => { setNuevo(false); r.recargar(); }} />}
    </div>
  );
}

function Nuevo({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  const [refiere, setRefiere] = useState<ClienteBuscado | null>(null);
  const [nuevo, setNuevo] = useState<ClienteBuscado | null>(null);
  return (
    <Dialogo titulo="Registrar referido" boton="Registrar" onClose={onClose}
      aviso="Se le crea al cliente nuevo un cupón de bienvenida personal. El bono llega cuando paga su primer pedido."
      enviar={async () => {
        await api("/v1/cmp/referidos", { method: "POST", body: { referrer_customer_id: refiere?.id ?? null, referred_customer_id: nuevo?.id ?? null } });
        toast.ok("Referido registrado"); onHecho();
      }}>
      {(e) => <>
        <Field label="Quién refiere" required error={e.referrer_customer_id} className="sm:col-span-2"><BuscarCliente valor={refiere} onChange={setRefiere} /></Field>
        <Field label="Cliente nuevo" required error={e.referred_customer_id} className="sm:col-span-2"><BuscarCliente valor={nuevo} onChange={setNuevo} /></Field>
        {nuevo && (nuevo.orders_count ?? 0) > 0 && <div className="sm:col-span-2"><Alert tone="warn">{nuevo.full_name} ya tiene pedidos: no puede registrarse como referido.</Alert></div>}
      </>}
    </Dialogo>
  );
}
