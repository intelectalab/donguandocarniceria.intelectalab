import { soles } from "@/lib/formato";
import { n, type Turno } from "./tipos";

/** Esperado, contado y diferencia por medio de un turno cerrado (POS-07 y POS-08). */
export function TablaConteos({ t }: { t: Pick<Turno, "conteos"> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] text-[13px]">
        <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Medio</th><th className="py-1 text-right font-medium">Esperado</th><th className="py-1 text-right font-medium">Contado</th><th className="py-1 text-right font-medium">Dif.</th></tr></thead>
        <tbody>
          {t.conteos.map((c) => (
            <tr key={c.code} className="border-t border-line">
              <td className="py-1.5">{c.name}</td>
              <td className="py-1.5 text-right tabular-nums">{soles(c.expected_amount)}</td>
              <td className="py-1.5 text-right tabular-nums">{soles(c.counted_amount)}</td>
              <td className={`py-1.5 text-right tabular-nums ${Math.abs(n(c.difference)) < 0.005 ? "text-ok" : "text-bad"}`}>{soles(c.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
