"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Alert, Badge, Button, Checkbox, Field, IconButton, Input, Modal, Select, Tabs, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { numero, porcentaje, soles } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { Seccion, Vacio } from "@/modulos/ped/Seccion";

type Motivo = { id: string; code: string; name: string; applies_to: string; requires_note: boolean; counts_as_loss: boolean; status: string; usos: number };
type Limite = { id: string; role: string; brand_id: string | null; max_pct: string; max_amount: string; status: string; marca: string | null };
type Catalogo = { motivos: Motivo[]; limites: Limite[]; roles: { id: string; code: string; name: string }[]; marcas: { id: string; name: string }[] };
type FormMotivo = { id?: string; code: string; name: string; applies_to: string; requires_note: boolean; counts_as_loss: boolean; activo: boolean };
type FormLimite = { id?: string; role: string; brand_id: string; max_pct: string; max_amount: string; activo: boolean };

const APLICA: Record<string, string> = { CANCEL: "Cancelación", NOT_DELIVERED: "No entrega", BOTH: "Ambos" };

/** PED-13 Motivos y límites: motivos de cancelación y no entrega (RN-PED-13) y límite de descuento por rol y marca (RN-PED-11). */
export default function MotivosLimites() {
  const { puede, can } = useSesion();
  const [tab, setTab] = useState<"motivos" | "limites">("motivos");
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [version, setVersion] = useState(0);
  const [fm, setFm] = useState<FormMotivo | null>(null);
  const [fl, setFl] = useState<FormLimite | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const admin = puede("PED", "A");
  const limites = admin && can("ped.discount.approve");

  useEffect(() => {
    api<Catalogo>("/v1/ped/catalogo").then(setCat).catch((e) => toast.error(mensajeDe(e)));
  }, [version]);

  async function enviar(ruta: string, id: string | undefined, body: unknown, cerrar: () => void) {
    setGuardando(true);
    setError("");
    try {
      await api(id ? `${ruta}/${id}` : ruta, { method: id ? "PUT" : "POST", body });
      toast.ok("Guardado");
      cerrar();
      setVersion((n) => n + 1);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const rolNombre = (c: string) => cat?.roles.find((r) => r.code === c)?.name ?? c;
  return (
    <div className="space-y-4">
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "motivos", label: "Motivos de cancelación y no entrega" }, { key: "limites", label: "Límites de descuento" }]} />
      {!cat ? <Vacio>Cargando…</Vacio> : tab === "motivos" ? (
        <Seccion titulo="Motivos" acciones={admin && <Button size="sm" variant="primary" icon={Plus} onClick={() => { setError(""); setFm({ code: "", name: "", applies_to: "CANCEL", requires_note: false, counts_as_loss: false, activo: true }); }}>Nuevo motivo</Button>}>
          <ul className="divide-y divide-line">
            {cat.motivos.map((m) => (
              <li key={m.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${m.status !== "ACTIVE" ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium text-ink">
                    {m.name} <Badge>{APLICA[m.applies_to] ?? m.applies_to}</Badge>
                    {m.requires_note && <Badge tone="info">Pide nota</Badge>}
                    {m.counts_as_loss && <Badge tone="warn">Cuenta como merma</Badge>}
                    {m.status !== "ACTIVE" && <Badge tone="bad">Inactivo</Badge>}
                  </div>
                  <div className="text-[12px] text-muted"><span className="font-mono">{m.code}</span> · usado {numero(m.usos)} veces</div>
                </div>
                {admin && <IconButton icon={Pencil} label={`Editar ${m.name}`} onClick={() => { setError(""); setFm({ id: m.id, code: m.code, name: m.name, applies_to: m.applies_to, requires_note: m.requires_note, counts_as_loss: m.counts_as_loss, activo: m.status === "ACTIVE" }); }} />}
              </li>
            ))}
          </ul>
        </Seccion>
      ) : (
        <Seccion titulo="Límite de descuento por rol" acciones={limites && <Button size="sm" variant="primary" icon={Plus} onClick={() => { setError(""); setFl({ role: "VENDEDORA", brand_id: "", max_pct: "5", max_amount: "20", activo: true }); }}>Nuevo límite</Button>}>
          <p className="mb-3 text-[12.5px] text-muted">Un descuento por encima del límite del rol queda pendiente hasta que alguien con permiso lo apruebe. Vale el límite de la marca si existe; si no, el general.</p>
          {cat.limites.length === 0 ? <Vacio>No hay límites: solo la gerencia aplica descuentos.</Vacio> : (
            <ul className="divide-y divide-line">
              {cat.limites.map((l) => (
                <li key={l.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${l.status !== "ACTIVE" ? "opacity-60" : ""}`}>
                  <div>
                    <div className="text-[13.5px] font-medium text-ink">{rolNombre(l.role)} · {l.marca ?? "Todas las marcas"} {l.status !== "ACTIVE" && <Badge tone="bad">Inactivo</Badge>}</div>
                    <div className="text-[12px] text-muted">Hasta {porcentaje(l.max_pct, 1)} o {soles(l.max_amount)} por pedido</div>
                  </div>
                  {limites && <IconButton icon={Pencil} label="Editar límite" onClick={() => { setError(""); setFl({ id: l.id, role: l.role, brand_id: l.brand_id ?? "", max_pct: String(Number(l.max_pct)), max_amount: String(Number(l.max_amount)), activo: l.status === "ACTIVE" }); }} />}
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      )}

      <Modal open={Boolean(fm)} onClose={() => setFm(null)} title={fm?.id ? "Editar motivo" : "Nuevo motivo"}
        footer={<><Button variant="ghost" onClick={() => setFm(null)}>Cancelar</Button><Button variant="primary" loading={guardando} disabled={!fm?.code || !fm?.name}
          onClick={() => fm && enviar("/v1/ped/motivos", fm.id, { code: fm.code, name: fm.name, applies_to: fm.applies_to, requires_note: fm.requires_note, counts_as_loss: fm.counts_as_loss, status: fm.activo ? "ACTIVE" : "INACTIVE" }, () => setFm(null))}>Guardar</Button></>}>
        {fm && (
          <div className="space-y-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Código" required hint="En mayúsculas, sin espacios: CLIENTE_AUSENTE.">
              <Input value={fm.code} maxLength={40} onChange={(e) => setFm({ ...fm, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} />
            </Field>
            <Field label="Nombre" required><Input value={fm.name} maxLength={80} onChange={(e) => setFm({ ...fm, name: e.target.value })} /></Field>
            <Field label="Se usa para" required>
              <Select value={fm.applies_to} onChange={(e) => setFm({ ...fm, applies_to: e.target.value })} options={Object.entries(APLICA).map(([value, label]) => ({ value, label }))} />
            </Field>
            <Checkbox checked={fm.requires_note} onChange={(v) => setFm({ ...fm, requires_note: v })} label="Exige una nota que explique qué pasó" />
            <Checkbox checked={fm.counts_as_loss} onChange={(v) => setFm({ ...fm, counts_as_loss: v })} label="Cuenta como merma" />
            <Checkbox checked={fm.activo} onChange={(v) => setFm({ ...fm, activo: v })} label="Activo" />
          </div>
        )}
      </Modal>

      <Modal open={Boolean(fl)} onClose={() => setFl(null)} title={fl?.id ? "Editar límite" : "Nuevo límite"}
        footer={<><Button variant="ghost" onClick={() => setFl(null)}>Cancelar</Button><Button variant="primary" loading={guardando}
          onClick={() => fl && enviar("/v1/ped/limites", fl.id, { role: fl.role, brand_id: fl.brand_id || null, max_pct: Number(fl.max_pct), max_amount: Number(fl.max_amount), status: fl.activo ? "ACTIVE" : "INACTIVE" }, () => setFl(null))}>Guardar</Button></>}>
        {fl && (
          <div className="space-y-4">
            {error && <Alert tone="bad">{error}</Alert>}
            <Field label="Rol" required>
              <Select value={fl.role} onChange={(e) => setFl({ ...fl, role: e.target.value })} options={cat?.roles.map((r) => ({ value: r.code, label: r.name })) ?? []} />
            </Field>
            <Field label="Marca">
              <Select value={fl.brand_id} onChange={(e) => setFl({ ...fl, brand_id: e.target.value })} placeholder="Todas las marcas" options={cat?.marcas.map((m) => ({ value: m.id, label: m.name })) ?? []} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Máximo %" required><Input type="number" min="0" max="100" step="0.5" value={fl.max_pct} onChange={(e) => setFl({ ...fl, max_pct: e.target.value })} /></Field>
              <Field label="Máximo S/" required><Input type="number" min="0" step="1" value={fl.max_amount} onChange={(e) => setFl({ ...fl, max_amount: e.target.value })} /></Field>
            </div>
            <Checkbox checked={fl.activo} onChange={(v) => setFl({ ...fl, activo: v })} label="Activo" />
          </div>
        )}
      </Modal>
    </div>
  );
}
