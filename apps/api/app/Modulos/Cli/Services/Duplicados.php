<?php

namespace App\Modulos\Cli\Services;

use App\Models\User;
use App\Modulos\Cli\Models\Customer;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;

/**
 * RN-CLI-07: posibles duplicados. Al crear o editar un cliente se compara su celular, celular
 * alterno, documento y correo con los demás; el par queda OPEN para revisarlo en CLI-10, donde se
 * fusiona (CLI-11) o se descarta con motivo.
 */
final class Duplicados
{
    public const MOTIVOS = ['SAME_PHONE' => 'Mismo celular', 'SAME_DOC' => 'Mismo documento', 'SAME_EMAIL' => 'Mismo correo', 'SIMILAR_NAME_ADDRESS' => 'Nombre y dirección parecidos'];

    private const PUNTAJE = ['SAME_DOC' => 1.0, 'SAME_PHONE' => 0.95, 'SAME_EMAIL' => 0.85, 'SIMILAR_NAME_ADDRESS' => 0.6];

    /** Registra los pares del cliente con los demás y los devuelve. */
    public static function revisar(Customer $c): array
    {
        $out = [];
        $celulares = array_values(array_filter([$c->phone, $c->phone_alt]));
        $otros = Customer::whereNull('merged_into_id')->where('status', '<>', 'INACTIVE')->where('id', '<>', $c->id)
            ->where(function ($q) use ($c, $celulares) {
                if ($celulares) {
                    $q->orWhereIn('phone', $celulares)->orWhereIn('phone_alt', $celulares);
                }
                if ($c->doc_type !== 'NONE' && $c->doc_number) {
                    $q->orWhere(fn ($w) => $w->where('doc_type', $c->doc_type)->where('doc_number', $c->doc_number));
                }
                if ($c->email) {
                    $q->orWhereRaw('lower(email) = ?', [mb_strtolower($c->email)]);
                }
            })->get();
        if (! $celulares && ! $c->email && $c->doc_type === 'NONE') {
            return [];
        }
        foreach ($otros as $o) {
            $motivo = match (true) {
                $c->doc_type !== 'NONE' && $c->doc_number && $o->doc_type === $c->doc_type && $o->doc_number === $c->doc_number => 'SAME_DOC',
                (bool) array_intersect($celulares, array_filter([$o->phone, $o->phone_alt])) => 'SAME_PHONE',
                default => 'SAME_EMAIL',
            };
            $puntaje = $motivo === 'SAME_PHONE' && $c->phone !== $o->phone ? 0.9 : self::PUNTAJE[$motivo];
            if ($par = self::registrar($c->id, $o->id, $motivo, $puntaje)) {
                $out[] = $par;
            }
        }

        return $out;
    }

    /** Un solo par por pareja de clientes, en cualquier orden. Devuelve el par (nuevo o el que ya estaba). */
    public static function registrar(string $clienteId, string $duplicadoDe, string $motivo, float $puntaje): ?object
    {
        $ya = DB::table('customer_duplicate_candidates')
            ->where(fn ($q) => $q->where(['customer_id' => $clienteId, 'duplicate_of_id' => $duplicadoDe])
                ->orWhere(fn ($w) => $w->where(['customer_id' => $duplicadoDe, 'duplicate_of_id' => $clienteId])))
            ->first();
        if ($ya) {
            return $ya;
        }
        $id = DB::table('customer_duplicate_candidates')->insertGetId([
            'customer_id' => $clienteId, 'duplicate_of_id' => $duplicadoDe, 'match_reason' => $motivo, 'score' => $puntaje, 'status' => 'OPEN',
        ]);

        return DB::table('customer_duplicate_candidates')->find($id);
    }

    /**
     * Revisa toda la base: mismo celular, documento, correo, o mismo nombre con la dirección
     * predeterminada en la misma zona. Devuelve cuántos pares nuevos registró.
     */
    public static function buscarEnTodaLaBase(): int
    {
        $antes = DB::table('customer_duplicate_candidates')->count();
        $activos = "c.merged_into_id IS NULL AND c.status <> 'INACTIVE'";
        $grupos = [
            'SAME_PHONE' => "SELECT c.id, c.created_at, c.phone AS k FROM customers c WHERE {$activos} AND c.phone IS NOT NULL
                             UNION SELECT c.id, c.created_at, c.phone_alt FROM customers c WHERE {$activos} AND c.phone_alt IS NOT NULL",
            'SAME_DOC' => "SELECT c.id, c.created_at, c.doc_type || c.doc_number AS k FROM customers c WHERE {$activos} AND c.doc_type <> 'NONE' AND c.doc_number IS NOT NULL",
            'SAME_EMAIL' => "SELECT c.id, c.created_at, lower(c.email) AS k FROM customers c WHERE {$activos} AND c.email IS NOT NULL AND c.email <> ''",
            'SIMILAR_NAME_ADDRESS' => "SELECT c.id, c.created_at, translate(lower(trim(c.full_name)), 'áéíóúüñ', 'aeiouun') || '|' || a.zone_id AS k
                             FROM customers c JOIN customer_addresses a ON a.customer_id = c.id AND a.is_default AND a.status = 'ACTIVE' AND a.zone_id IS NOT NULL
                            WHERE {$activos}",
        ];
        foreach ($grupos as $motivo => $sql) {
            $filas = collect(DB::select($sql))->groupBy('k')->filter(fn ($g) => $g->unique('id')->count() > 1);
            foreach ($filas as $g) {
                $g = $g->unique('id')->sortBy('created_at')->values();
                for ($i = 1; $i < $g->count(); $i++) {
                    self::registrar($g[$i]->id, $g[0]->id, $motivo, self::PUNTAJE[$motivo]);
                }
            }
        }

        return DB::table('customer_duplicate_candidates')->count() - $antes;
    }

    public static function descartar(string $id, string $nota, User $quien): void
    {
        $par = DB::table('customer_duplicate_candidates')->find($id);
        if (! $par || $par->status !== 'OPEN') {
            RuleError::fail('RN-CLI-07', 'Ese par ya fue resuelto.');
        }
        if (trim($nota) === '') {
            RuleError::fail('RN-CLI-07', 'Escribe por qué no es duplicado (por ejemplo: «esposos con el mismo celular»).');
        }
        DB::table('customer_duplicate_candidates')->where('id', $id)->update([
            'status' => 'DISMISSED', 'resolved_by' => $quien->id, 'resolved_at' => now(), 'resolution_note' => mb_substr(trim($nota), 0, 255), 'updated_at' => now(),
        ]);
    }
}
