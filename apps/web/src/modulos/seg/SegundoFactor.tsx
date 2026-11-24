"use client";

import { useMemo, useState, type FormEvent } from "react";
import qrcode from "qrcode-generator";
import { Copy, Download, KeyRound, Printer, ShieldCheck, ShieldOff } from "lucide-react";
import { Alert, Badge, Button, Checkbox, DetailList, Field, Input, Modal, toast } from "@/components/ui";
import { api, erroresDe, mensajeDe } from "@/lib/api";
import { fechaHora } from "@/lib/formato";

export type EstadoSegundoFactor = { activo: boolean; desde: string | null; rol_lo_exige: boolean; obligatorio: boolean; codigos_disponibles: number; codigos_por_lote: number };
export type Preparado = { secreto: string; enlace: string; vence_en_minutos: number };

/** Código QR como trazos SVG (sin imágenes externas: el secreto no sale del navegador). */
export function Qr({ texto }: { texto: string }) {
  const { d, n } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(texto);
    q.make();
    const m = q.getModuleCount();
    let ruta = "";
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) if (q.isDark(y, x)) ruta += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d: ruta, n: m + 4 };
  }, [texto]);
  return (
    <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label="Código QR para la app autenticadora" className="size-44 shrink-0 rounded-lg bg-white p-1" shapeRendering="crispEdges">
      <path d={d} fill="#1b1b1b" />
    </svg>
  );
}

/** El secreto en grupos de 4, para escribirlo a mano si la cámara no lee el QR. */
export const secretoLegible = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/** Solo dígitos, hasta 6 (el código de la app). */
export const soloCodigo = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/**
 * Los códigos de recuperación recién generados: se ven una sola vez. Copiar, descargar o imprimir, y confirmar que se
 * guardaron antes de seguir.
 */
export function CodigosRecuperacion({ codigos, cuenta, onListo, boton = "Ya los guardé" }: { codigos: string[]; cuenta: string; onListo: () => void; boton?: string }) {
  const [guardados, setGuardados] = useState(false);
  const texto = `Códigos de recuperación de GestionCarnica · ${cuenta}\nCada código sirve una sola vez.\n\n${codigos.join("\n")}\n`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      toast.ok("Códigos copiados");
    } catch {
      toast.error("No se pudo copiar: selecciónalos y cópialos a mano.");
    }
  }
  function descargar() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([texto], { type: "text/plain;charset=utf-8" }));
    a.download = "codigos-de-recuperacion-gestioncarnica.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function imprimir() {
    const w = window.open("", "_blank", "width=480,height=640");
    if (!w) return;
    const doc = w.document;
    doc.title = "Códigos de recuperación";
    const pre = doc.createElement("pre");
    pre.style.cssText = "font:16px/1.7 monospace;padding:24px";
    pre.textContent = texto;   // como texto: nada de HTML armado a mano
    doc.body.appendChild(pre);
    w.print();
  }

  return (
    <div className="grid gap-4">
      <Alert tone="warn">Guárdalos en un lugar seguro: sirven para entrar si pierdes el celular. Cada uno funciona una sola vez y no se vuelven a mostrar.</Alert>
      <ol className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 font-mono text-[14px] tracking-wider text-ink">
        {codigos.map((c) => <li key={c} className="text-center">{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={Copy} onClick={copiar}>Copiar</Button>
        <Button size="sm" icon={Download} onClick={descargar}>Descargar</Button>
        <Button size="sm" icon={Printer} onClick={imprimir}>Imprimir</Button>
      </div>
      <Checkbox checked={guardados} onChange={setGuardados} label="Ya guardé mis códigos de recuperación" />
      <Button variant="primary" disabled={!guardados} onClick={onListo}>{boton}</Button>
    </div>
  );
}

/** Pasos del QR: escanear, o escribir el secreto, y confirmar con el primer código. */
export function PasoQr({ p, codigo, onCodigo, error }: { p: Preparado; codigo: string; onCodigo: (v: string) => void; error?: string }) {
  return (
    <div className="grid gap-4">
      <ol className="grid list-decimal gap-1 pl-5 text-[13px] text-ink">
        <li>Instala una app autenticadora en tu celular: Google Authenticator, Microsoft Authenticator o Authy.</li>
        <li>En la app, agrega una cuenta y escanea este código.</li>
        <li>Escribe el código de 6 dígitos que muestra la app.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        <Qr texto={p.enlace} />
        <div className="min-w-0 flex-1 text-[12.5px] text-muted">
          <p>¿No puedes escanear? Escribe esta clave en la app:</p>
          <p className="mt-1 font-mono text-[13px] break-all text-ink select-all">{secretoLegible(p.secreto)}</p>
          <p className="mt-2">Este código vence en {p.vence_en_minutos} minutos.</p>
        </div>
      </div>
      <Field label="Código de la app" required error={error}>
        <Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} value={codigo} onChange={(e) => onCodigo(soloCodigo(e.target.value))}
          className="font-mono tracking-[0.3em]" />
      </Field>
    </div>
  );
}

/** SEG-06: la sección «Segundo factor» de Mi cuenta: activarlo, códigos nuevos y desactivarlo. */
export function SeccionSegundoFactor({ s, cuenta, onCambio }: { s: EstadoSegundoFactor; cuenta: string; onCambio: () => void }) {
  const [abierto, setAbierto] = useState<"activar" | "codigos" | "desactivar" | null>(null);

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-3 text-[14px] font-semibold">Segundo factor</h2>
      <DetailList items={[
        { label: "Estado", value: s.activo ? <Badge tone="ok" dot>Activo</Badge>
          : <Badge tone={s.obligatorio ? "bad" : s.rol_lo_exige ? "warn" : "neutral"}>{s.obligatorio ? "Obligatorio y no activo" : "No activo"}</Badge> },
        { label: "Activado", value: s.desde ? fechaHora(s.desde) : "—" },
        { label: "Códigos de recuperación disponibles", value: s.activo ? `${s.codigos_disponibles} de ${s.codigos_por_lote}` : "—" },
        { label: "Tu rol", value: s.rol_lo_exige ? (s.obligatorio ? "Lo exige: es obligatorio" : "Lo recomienda") : "No lo exige" },
      ]} />
      <p className="mt-3 text-[12.5px] text-muted">
        {s.activo
          ? "Al ingresar, después de la contraseña se pide el código de tu app autenticadora. Si cambias de celular, desactívalo y vuelve a activarlo."
          : "Con el segundo factor, además de tu contraseña se pide un código de tu celular. Así nadie entra aunque conozca tu contraseña."}
      </p>
      {s.activo && s.codigos_disponibles <= 2 && <div className="mt-3"><Alert tone="warn">Te quedan pocos códigos de recuperación: genera unos nuevos.</Alert></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {!s.activo && <Button variant="primary" icon={ShieldCheck} onClick={() => setAbierto("activar")}>Activar segundo factor</Button>}
        {s.activo && <Button icon={KeyRound} onClick={() => setAbierto("codigos")}>Códigos de recuperación nuevos</Button>}
        {s.activo && !s.obligatorio && <Button variant="ghost" icon={ShieldOff} onClick={() => setAbierto("desactivar")}>Desactivar</Button>}
      </div>
      {abierto === "activar" && <ActivarEnMiCuenta cuenta={cuenta} onClose={() => setAbierto(null)} onListo={() => { setAbierto(null); onCambio(); }} />}
      {abierto && abierto !== "activar" && (
        <ConCodigo modo={abierto} cuenta={cuenta} onClose={() => setAbierto(null)} onListo={() => { setAbierto(null); onCambio(); }} />
      )}
    </section>
  );
}

/** SEG-03 desde Mi cuenta: QR, primer código y códigos de recuperación. */
function ActivarEnMiCuenta({ cuenta, onClose, onListo }: { cuenta: string; onClose: () => void; onListo: () => void }) {
  const [p, setP] = useState<Preparado | null>(null);
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);

  async function empezar() {
    setEnviando(true);
    try {
      setP(await api<Preparado>("/v1/seg/mi-cuenta/segundo-factor/preparar", { method: "POST" }));
    } catch (e) {
      toast.error(mensajeDe(e));
      onClose();
    } finally {
      setEnviando(false);
    }
  }
  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const r = await api<{ codigos: string[] }>("/v1/seg/mi-cuenta/segundo-factor/activar", { method: "POST", body: { codigo } });
      setCodigos(r.codigos);
      toast.ok("Segundo factor activado");
    } catch (x) {
      setError(erroresDe(x).codigo ?? mensajeDe(x));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open onClose={codigos ? onListo : onClose} dismissable={!codigos} title={codigos ? "Tus códigos de recuperación" : "Activar segundo factor"} size="md"
      footer={!codigos && p ? <Button variant="primary" type="submit" form="f-activar-2fa" loading={enviando} disabled={codigo.length !== 6}>Activar</Button> : undefined}>
      {codigos ? <CodigosRecuperacion codigos={codigos} cuenta={cuenta} onListo={onListo} /> : !p ? (
        <div className="grid gap-4">
          <p className="text-[13.5px] text-ink">Vas a vincular tu cuenta con una app autenticadora en tu celular. Después, al ingresar, se pedirá el código de 6 dígitos que muestra la app.</p>
          <Button variant="primary" loading={enviando} onClick={empezar}>Empezar</Button>
        </div>
      ) : (
        <form id="f-activar-2fa" onSubmit={confirmar} noValidate><PasoQr p={p} codigo={codigo} onCodigo={setCodigo} error={error} /></form>
      )}
    </Modal>
  );
}

/** Códigos nuevos (con un código de la app) o desactivar (con un código de la app o de recuperación). */
function ConCodigo({ modo, cuenta, onClose, onListo }: { modo: "codigos" | "desactivar"; cuenta: string; onClose: () => void; onListo: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const nuevos = modo === "codigos";

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      if (nuevos) {
        const r = await api<{ codigos: string[] }>("/v1/seg/mi-cuenta/segundo-factor/codigos", { method: "POST", body: { codigo } });
        setCodigos(r.codigos);
      } else {
        await api("/v1/seg/mi-cuenta/segundo-factor/desactivar", { method: "POST", body: { codigo } });
        toast.ok("Segundo factor desactivado");
        onListo();
      }
    } catch (x) {
      setError(erroresDe(x).codigo ?? mensajeDe(x));
    } finally {
      setEnviando(false);
    }
  }

  if (codigos) {
    return (
      <Modal open onClose={onListo} dismissable={false} title="Tus códigos de recuperación nuevos" size="md">
        <CodigosRecuperacion codigos={codigos} cuenta={cuenta} onListo={onListo} />
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={nuevos ? "Códigos de recuperación nuevos" : "Desactivar segundo factor"} size="sm"
      footer={<Button variant={nuevos ? "primary" : "danger"} type="submit" form="f-codigo-2fa" loading={enviando} disabled={!codigo.trim()}>{nuevos ? "Generar" : "Desactivar"}</Button>}>
      <form id="f-codigo-2fa" onSubmit={enviar} noValidate className="grid gap-3">
        <p className="text-[13px] text-ink">
          {nuevos ? "Los códigos que tienes ahora dejarán de servir. Para confirmar que eres tú, escribe el código de tu app autenticadora."
            : "Al ingresar solo se pedirá tu contraseña. Para confirmar, escribe el código de tu app o uno de tus códigos de recuperación."}
        </p>
        <Field label={nuevos ? "Código de la app" : "Código"} required error={error}>
          <Input inputMode={nuevos ? "numeric" : "text"} autoComplete="one-time-code" placeholder={nuevos ? "123456" : "123456 o ABCD-EFGH"} value={codigo}
            onChange={(e) => setCodigo(nuevos ? soloCodigo(e.target.value) : e.target.value.slice(0, 20))} className="font-mono tracking-[0.2em]" />
        </Field>
      </form>
    </Modal>
  );
}
