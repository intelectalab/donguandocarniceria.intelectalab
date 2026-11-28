"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, CheckCheck, Image as Imagen, TriangleAlert } from "lucide-react";
import { Alert, Button, Checkbox, Field, Input, toast } from "@/components/ui";
import { api, mensajeDe } from "@/lib/api";
import { kg } from "@/lib/formato";
import { useSesion } from "@/lib/sesion";
import { CabeceraTarea, ConTarea, Seccion, Vacio } from "@/modulos/pre/comunes";
import { R, cantidad, cuando, hecho, nombreBolsa, type Tarea } from "@/modulos/pre/tipos";

/** PRE-07 Verificación: otra persona revisa el pedido armado y toma la foto obligatoria; marca VERIFIED. */
export default function Verificacion() {
  return <Suspense><Pantalla /></Suspense>;
}

function Pantalla() {
  const id = useSearchParams().get("id") ?? "";
  return (
    <ConTarea id={id} ruta={R.verificacion} estados={["PICKED", "PACKED"]} titulo="Pedidos por verificar" vacio="No hay pedidos embolsados por verificar para esta fecha.">
      {(t, poner) => <Verificar t={t} poner={poner} />}
    </ConTarea>
  );
}

function Verificar({ t, poner }: { t: Tarea; poner: (t: Tarea) => void }) {
  const router = useRouter();
  const { can, me } = useSesion();
  const [vistos, setVistos] = useState<string[]>([]);
  const [bolsas, setBolsas] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const mismo = t.verifica_otro && t.preparer_user_id === me.user.id;
  const pendiente = ["PICKED", "PACKED"].includes(t.estado) && t.pedido.status !== "CANCELLED";
  const aviso = t.pedido.weight_diff_status === "NOTICE_REQUIRED";

  // Vista previa de la foto elegida (la anterior se libera al cambiarla).
  function elegir(f: File | null) {
    if (vista) URL.revokeObjectURL(vista);
    setFoto(f);
    setVista(f ? URL.createObjectURL(f) : null);
  }

  async function verificar() {
    setGuardando(true);
    try {
      const f = new FormData();
      if (foto) f.append("photo", foto);
      if (bolsas) f.append("parcel_count", bolsas);
      poner(await api<Tarea>(`/v1/pre/tareas/${t.id}/verificar`, { method: "POST", body: f }));
      toast.ok(`${t.pedido.number} verificado: el pedido quedó LISTO`);
    } catch (e) {
      toast.error(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const listo = Boolean(foto) && Number(bolsas) > 0 && vistos.length === t.lineas.length;
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <CabeceraTarea t={t} volver={R.verificacion}>
        <p className="mt-2 text-[12.5px] text-muted">Armó {t.preparador ?? "—"}{t.picked_at ? ` · ${cuando(t.picked_at)}` : ""}</p>
      </CabeceraTarea>

      {["VERIFIED", "LOADED"].includes(t.estado) ? (
        <Alert tone="ok" title="Pedido verificado">
          <p>Verificó {t.verificador ?? "—"}{t.verified_at ? ` el ${cuando(t.verified_at)}` : ""}. El pedido está listo para cargar.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => router.push(R.verificacion)}>Siguiente pedido</Button>
            {t.foto && <FotoGuardada id={t.id} />}
          </div>
        </Alert>
      ) : !pendiente ? null : (
        <>
          {mismo && <Alert tone="warn" title="Verifica otra persona">Tú armaste este pedido: la verificación la hace otra persona (RN-PRE-13).</Alert>}
          {aviso && (
            <Alert tone="bad" title="Falta avisar la diferencia de peso">
              El peso supera la tolerancia: avisa al cliente antes de verificar.
              <div className="mt-2"><Button size="sm" onClick={() => router.push(`/m/ped/ped-07?id=${t.pedido.id}`)}>Avisar al cliente</Button></div>
            </Alert>
          )}
          {t.estado === "PICKED" && (
            <Alert tone="warn" title="Faltan las bolsas">
              Genera las etiquetas antes de verificar.
              <div className="mt-2"><Button size="sm" onClick={() => router.push(`${R.bolsas}?id=${t.id}`)}>Bolsas y etiquetas</Button></div>
            </Alert>
          )}

          <Seccion titulo="1. Revisa cada línea contra el pedido">
            <ul className="divide-y divide-line">
              {t.lineas.map((l) => (
                <li key={l.id} className="py-2.5">
                  <Checkbox checked={vistos.includes(l.id)} onChange={(v) => setVistos(v ? [...vistos, l.id] : vistos.filter((x) => x !== l.id))}
                    label={<span className="font-medium">{l.name}</span>}
                    hint={<>Pedido {cantidad(l)} · armado {hecho(l)}{l.weighted && l.sale_mode !== "KG" && l.weighed_kg ? ` · ${kg(l.weighed_kg)}` : ""}{l.cut_notes ? ` · corte: ${l.cut_notes}` : ""}{l.status === "SHORT_APPROVED" ? " · faltante aprobado" : ""}</>} />
                </li>
              ))}
            </ul>
          </Seccion>

          <Seccion titulo="2. Cuenta las bolsas">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Bolsas que tienes delante" hint={t.bolsas.length ? `Se imprimieron ${t.bolsas.length} etiqueta(s) de ${nombreBolsa(t.parcel_type).toLowerCase()}` : "Aún no hay etiquetas"} className="w-[220px]">
                <Input value={bolsas} onChange={(e) => setBolsas(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="0" />
              </Field>
            </div>
          </Seccion>

          <Seccion titulo="3. Foto del pedido armado">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-surface-2 p-4 text-center hover:border-primary">
              {vista && foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vista} alt="Foto del pedido" className="max-h-64 rounded-lg object-contain" />
              ) : (
                <>
                  <Camera size={28} className="text-muted" />
                  <span className="text-[13.5px] font-medium text-ink">Tomar foto</span>
                  <span className="text-[12px] text-muted">Con todas las bolsas y sus etiquetas a la vista</span>
                </>
              )}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => elegir(e.target.files?.[0] ?? null)} />
            </label>
            {foto && <p className="mt-1 text-[12px] text-muted">{foto.name} · {(foto.size / 1024).toFixed(0)} KB · toca la foto para cambiarla</p>}
          </Seccion>

          {can("pre.task.verify") && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon={CheckCheck} loading={guardando} disabled={!listo || mismo || aviso || t.estado !== "PACKED"} onClick={verificar} className="h-12 px-6">
                Verificar pedido
              </Button>
              {!listo && <span className="text-[12.5px] text-muted">Marca las líneas, cuenta las bolsas y toma la foto.</span>}
              <Button variant="ghost" icon={TriangleAlert} onClick={() => router.push(`${R.errores}?pedido=${t.pedido.id}&numero=${encodeURIComponent(t.pedido.number)}&etapa=VERIFICATION`)}>Registrar un error</Button>
            </div>
          )}
        </>
      )}
      {t.lecturas.length === 0 && t.estado === "PENDING" && <Vacio>El pedido aún no se armó.</Vacio>}
    </div>
  );
}

function FotoGuardada({ id }: { id: string }) {
  const [cargando, setCargando] = useState(false);
  async function abrir() {
    setCargando(true);
    const ventana = window.open("", "_blank");
    try {
      const r = await api<{ url: string }>(`/v1/pre/tareas/${id}/foto`);
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = r.url;
      }
    } catch (e) {
      ventana?.close();
      toast.error(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }
  return <Button size="sm" icon={Imagen} loading={cargando} onClick={abrir}>Ver foto</Button>;
}
