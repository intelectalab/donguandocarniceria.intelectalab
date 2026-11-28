<?php

namespace App\Modulos\Pos\Services;

use App\Models\User;
use App\Modulos\Plt\Services\Periodos;
use App\Support\Access;
use App\Support\Events;
use App\Support\Params;
use App\Support\RuleError;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Turnos de caja: abrir con fondo por denominación (POS-01), ingresos y retiros (POS-06), cerrar
 * con arqueo por medio de pago (POS-07) y aprobar el cierre (POS-08).
 *
 * Reglas: RN-POS-01 (una caja, un turno abierto; cerrado no se reabre), RN-POS-02 (una cajera, un
 * turno abierto), RN-POS-07 (efectivo esperado y motivo de toda diferencia), RN-POS-08 (aprueba otra
 * persona; aviso a la supervisora sobre el límite) y RN-POS-09 (movimientos en turno abierto;
 * retiros y gastos sobre el límite con autorización). La base repite RN-POS-01, 02 y 07.
 */
final class Turnos
{
    /** Billetes y monedas en soles, de mayor a menor. */
    public const DENOMINACIONES = ['200', '100', '50', '20', '10', '5', '2', '1', '0.5', '0.2', '0.1'];

    public const MOVIMIENTOS = [
        'CASH_IN' => 'Ingreso de sencillo', 'CASH_OUT' => 'Retiro a caja fuerte', 'DEPOSIT' => 'Depósito al banco',
        'PETTY_EXPENSE' => 'Gasto menor', 'REFUND' => 'Devolución en efectivo',
    ];

    /** Movimientos que sacan efectivo de la caja. */
    public const SALIDAS = ['CASH_OUT', 'DEPOSIT', 'PETTY_EXPENSE', 'REFUND'];

    public const EPS = 0.005;

    public static function turno(string $id): object
    {
        return DB::table('pos_shifts')->where('id', $id)->first() ?? abort(404, 'Turno no encontrado.');
    }

    /** El turno con candado de fila. */
    public static function bloquear(string $id): object
    {
        return DB::table('pos_shifts')->where('id', $id)->lockForUpdate()->first() ?? abort(404, 'Turno no encontrado.');
    }

    /** El turno visible para el usuario (por el local de su alcance). */
    public static function visible(string $id, User $u): object
    {
        $t = self::turno($id);
        if (! Cajas::enAlcance($t->establishment_id, $u)) {
            abort(404, 'Turno no encontrado.');
        }

        return $t;
    }

    /** El turno abierto de la cajera, o null. */
    public static function abiertoDe(User $u): ?object
    {
        return DB::table('pos_shifts')->where('cashier_user_id', $u->id)->where('status', 'OPEN')->first();
    }

    /** RN-POS-03 / RN-POS-05: el turno abierto de quien vende o cobra. */
    public static function exigirAbierto(User $u, ?string $shiftId = null): object
    {
        $t = self::abiertoDe($u);
        if (! $t) {
            RuleError::fail('RN-POS-03', 'No tienes un turno de caja abierto: abre el turno (Abrir turno) para vender y cobrar en el mostrador.');
        }
        if ($shiftId && $shiftId !== $t->id) {
            RuleError::fail('RN-POS-03', "La venta va en tu turno abierto ({$t->number}).");
        }

        return $t;
    }

    /** Suma del conteo por denominación; falla con cantidades negativas o con decimales. */
    public static function sumar(?array $conteo, string $regla): array
    {
        $limpio = [];
        $total = 0.0;
        foreach ($conteo ?? [] as $denom => $cant) {
            $d = rtrim(rtrim(number_format((float) $denom, 2, '.', ''), '0'), '.');
            if (! in_array($d, self::DENOMINACIONES, true)) {
                RuleError::fail($regla, "S/ {$denom} no es una denominación válida.");
            }
            if ($cant === null || $cant === '') {
                continue;
            }
            if (! is_numeric($cant) || (float) $cant < 0 || abs((float) $cant - round((float) $cant)) > 0.0001) {
                RuleError::fail($regla, "La cantidad de S/ {$d} debe ser un número entero de 0 o más.");
            }
            if ((int) $cant > 0) {
                $limpio[$d] = (int) $cant;
                $total += (float) $d * (int) $cant;
            }
        }

        return [$limpio, round($total, 2)];
    }

    /**
     * POS-01: abre el turno con el fondo contado por denominación.
     * RN-POS-01 (caja con turno abierto o inactiva) y RN-POS-02 (cajera con turno abierto).
     */
    public static function abrir(string $terminalId, ?array $conteo, User $u): object
    {
        return DB::transaction(function () use ($terminalId, $conteo, $u) {
            $caja = Cajas::caja($terminalId, $u);
            $caja = DB::table('pos_terminals')->where('id', $caja->id)->lockForUpdate()->first();
            if ($caja->status !== 'ACTIVE') {
                RuleError::fail('RN-POS-01', "La caja «{$caja->name}» está inactiva.");
            }
            $enCaja = DB::table('pos_shifts')->where('terminal_id', $caja->id)->where('status', 'OPEN')->first();
            if ($enCaja) {
                RuleError::fail('RN-POS-01', "La caja «{$caja->name}» ya tiene el turno {$enCaja->number} abierto por {$enCaja->cashier_name} desde el "
                    .self::fechaHora($enCaja->opened_at).': una caja tiene como máximo un turno abierto.');
            }
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['pos:cajera:'.$u->id]);
            $mio = self::abiertoDe($u);
            if ($mio) {
                $donde = DB::table('pos_terminals')->where('id', $mio->terminal_id)->value('name');
                RuleError::fail('RN-POS-02', "Ya tienes el turno {$mio->number} abierto en «{$donde}»: ciérralo antes de abrir otro.");
            }
            [$limpio, $fondo] = self::sumar($conteo, 'RN-POS-01');
            $empresa = DB::table('establishments')->where('id', $caja->establishment_id)->value('company_id');
            Periodos::abierto(now('America/Lima')->toDateString(), $empresa);

            $numero = self::numero();
            $id = DB::table('pos_shifts')->insertGetId([
                'number' => $numero, 'terminal_id' => $caja->id, 'establishment_id' => $caja->establishment_id,
                'cashier_user_id' => $u->id, 'cashier_name' => mb_substr($u->name, 0, 120), 'opened_at' => now(),
                'opening_float' => $fondo, 'opening_counts' => json_encode((object) $limpio), 'status' => 'OPEN', 'created_at' => now(),
            ], 'id');
            Events::emit('pos.shift.opened', 'pos_shifts', $id, ['number' => $numero, 'terminal' => $caja->code, 'float' => $fondo]);

            return self::turno($id);
        });
    }

    /**
     * RN-POS-07: lo esperado por medio. Efectivo = fondo + cobros en efectivo + ingresos − retiros −
     * depósitos − gastos menores − devoluciones en efectivo. Los demás medios, la suma de sus cobros.
     */
    public static function esperado(object $t): array
    {
        $cobros = DB::table('payments as p')->join('payment_methods as m', 'm.id', '=', 'p.payment_method_id')
            ->where('p.pos_shift_id', $t->id)->where('p.status', 'CONFIRMED')
            ->groupBy('m.code')->selectRaw('m.code, sum(p.amount) as monto, count(*) as n')->get()->keyBy('code');
        $mov = DB::table('pos_cash_movements')->where('shift_id', $t->id)
            ->groupBy('movement_type')->selectRaw('movement_type, sum(amount) as monto')->pluck('monto', 'movement_type');
        $m = fn (string $k) => round((float) ($mov[$k] ?? 0), 2);
        $efectivo = round((float) ($cobros['CASH']->monto ?? 0), 2);
        $esperado = round((float) $t->opening_float + $efectivo + $m('CASH_IN') - $m('CASH_OUT') - $m('DEPOSIT') - $m('PETTY_EXPENSE') - $m('REFUND'), 2);

        $porMedio = [];
        foreach (Cajas::mediosDeArqueo() as $medio) {
            $porMedio[$medio['code']] = [
                'code' => $medio['code'], 'name' => $medio['name'], 'kind' => $medio['kind'],
                'cobros' => round((float) ($cobros[$medio['code']]->monto ?? 0), 2), 'n' => (int) ($cobros[$medio['code']]->n ?? 0),
                'esperado' => $medio['code'] === 'CASH' ? $esperado : round((float) ($cobros[$medio['code']]->monto ?? 0), 2),
            ];
        }
        // Cobros con un medio que ya no está en la lista: también se cuentan.
        foreach ($cobros as $code => $c) {
            if (! isset($porMedio[$code])) {
                $porMedio[$code] = ['code' => $code, 'name' => $code, 'kind' => null, 'cobros' => round((float) $c->monto, 2), 'n' => (int) $c->n, 'esperado' => round((float) $c->monto, 2)];
            }
        }

        return [
            'fondo' => round((float) $t->opening_float, 2), 'cobros_efectivo' => $efectivo,
            'ingresos' => $m('CASH_IN'), 'retiros' => $m('CASH_OUT'), 'depositos' => $m('DEPOSIT'), 'gastos' => $m('PETTY_EXPENSE'), 'devoluciones' => $m('REFUND'),
            'efectivo' => $esperado, 'por_medio' => array_values($porMedio),
            'saldo_a_favor' => round((float) DB::table('customer_balance_movements as b')
                ->join('sales_orders as o', 'o.id', '=', 'b.order_id')->where('o.pos_shift_id', $t->id)
                ->where('b.movement_type', 'APPLIED')->sum(DB::raw('-b.amount')), 2),
        ];
    }

    /**
     * POS-06: ingreso de sencillo, retiro a caja fuerte, depósito o gasto menor (RN-POS-09).
     * Sobre pos_cash_out_approval_above, un retiro, depósito o gasto lo autoriza alguien con
     * pos.cash.withdraw: quien lo registra, si tiene el permiso, o la supervisora con su correo y clave.
     */
    public static function movimiento(string $shiftId, array $d, User $u): object
    {
        return DB::transaction(function () use ($shiftId, $d, $u) {
            $t = self::bloquear($shiftId);
            if (! Cajas::enAlcance($t->establishment_id, $u)) {
                abort(404, 'Turno no encontrado.');
            }
            if ($t->status !== 'OPEN') {
                RuleError::fail('RN-POS-09', "El turno {$t->number} está cerrado: los ingresos y retiros de efectivo se registran en un turno abierto.");
            }
            if ($t->cashier_user_id !== $u->id && ! Access::can($u, 'pos.cash.withdraw')) {
                RuleError::fail('RN-POS-09', "El turno {$t->number} es de {$t->cashier_name}: solo ella o la supervisora registran sus movimientos.");
            }
            $tipo = $d['movement_type'] ?? null;
            if (! in_array($tipo, ['CASH_IN', 'CASH_OUT', 'DEPOSIT', 'PETTY_EXPENSE'], true)) {
                RuleError::fail('RN-POS-09', 'Elige el tipo: ingreso de sencillo, retiro a caja fuerte, depósito o gasto menor.');
            }
            $monto = round((float) ($d['amount'] ?? 0), 2);
            if ($monto <= 0) {
                RuleError::fail('RN-POS-09', 'El monto debe ser mayor que cero.');
            }
            $motivo = trim((string) ($d['reason'] ?? ''));
            if (mb_strlen($motivo) < 3) {
                RuleError::fail('RN-POS-09', 'Escribe el motivo del movimiento.');
            }
            $sale = $tipo !== 'CASH_IN';
            if ($sale) {
                $hay = self::esperado($t)['efectivo'];
                if ($monto > $hay + self::EPS) {
                    RuleError::fail('RN-POS-09', 'En la caja deberían quedar S/ '.number_format($hay, 2).': no se puede sacar S/ '.number_format($monto, 2).'.');
                }
            }
            $limite = (float) (Params::get('pos_cash_out_approval_above', ['site' => $t->establishment_id]) ?? 100);
            $autoriza = null;
            if ($sale && $monto > $limite + self::EPS) {
                $autoriza = self::autorizador($d, $u, $t, $limite);
            }
            $id = DB::table('pos_cash_movements')->insertGetId([
                'shift_id' => $t->id, 'moved_at' => now(), 'user_id' => $u->id, 'user_name' => mb_substr($u->name, 0, 120),
                'movement_type' => $tipo, 'amount' => $monto, 'reason' => mb_substr($motivo, 0, 255),
                'authorized_by' => $autoriza?->id, 'authorized_by_name' => $autoriza ? mb_substr($autoriza->name, 0, 120) : null, 'created_at' => now(),
            ], 'id');
            Events::emit('pos.cash.moved', 'pos_cash_movements', $id, ['shift' => $t->number, 'type' => $tipo, 'amount' => $monto]);

            return DB::table('pos_cash_movements')->where('id', $id)->first();
        });
    }

    /** RN-POS-09: quién autoriza un retiro sobre el límite. */
    private static function autorizador(array $d, User $u, object $t, float $limite): User
    {
        $texto = 'Los retiros, depósitos y gastos sobre S/ '.number_format($limite, 2).' necesitan la autorización de la supervisora o administración';
        if (Access::can($u, 'pos.cash.withdraw') && $u->id !== $t->cashier_user_id) {
            return $u;
        }
        $correo = mb_strtolower(trim((string) ($d['authorizer_email'] ?? '')));
        $clave = (string) ($d['authorizer_password'] ?? '');
        if ($correo === '' || $clave === '') {
            if (Access::can($u, 'pos.cash.withdraw')) {
                return $u;
            }
            RuleError::fail('RN-POS-09', "{$texto}: que ingrese su correo y clave.");
        }
        $a = User::where('email', $correo)->where('status', 'ACTIVE')->first();
        if (! $a || ! $a->password || ! Hash::check($clave, $a->password)) {
            RuleError::fail('RN-POS-09', 'El correo o la clave de quien autoriza no son correctos.');
        }
        if ($a->id === $t->cashier_user_id) {
            RuleError::fail('RN-POS-09', 'La cajera del turno no autoriza su propio retiro.');
        }
        if (! Access::can($a, 'pos.cash.withdraw')) {
            RuleError::fail('RN-POS-09', "{$a->name} no puede autorizar retiros (pos.cash.withdraw).");
        }

        return $a;
    }

    /**
     * POS-07: cierra con el arqueo de cada medio. El efectivo se cuenta por denominación; los demás
     * medios, según el cierre del POS y los avisos de Yape y Plin. Toda diferencia exige motivo
     * (RN-POS-07). Sobre pos_max_cash_diff_without_approval se avisa a la supervisora (RN-POS-08).
     * Cierra la cajera; un turno olvidado lo cierra la supervisora (pos.shift.approve).
     */
    public static function cerrar(string $shiftId, array $d, User $u): object
    {
        return DB::transaction(function () use ($shiftId, $d, $u) {
            $t = self::bloquear($shiftId);
            if (! Cajas::enAlcance($t->establishment_id, $u)) {
                abort(404, 'Turno no encontrado.');
            }
            if ($t->status !== 'OPEN') {
                RuleError::fail('RN-POS-01', "El turno {$t->number} ya está cerrado: un turno cerrado no se reabre.");
            }
            if ($t->cashier_user_id !== $u->id && ! Access::can($u, 'pos.shift.approve')) {
                RuleError::fail('RN-POS-07', "El turno {$t->number} es de {$t->cashier_name}: lo cierra ella (o la supervisora si quedó abierto).");
            }
            $esp = self::esperado($t);
            $conteos = $d['counts'] ?? [];
            $denoms = null;
            if (! empty($d['cash_denoms']) && is_array($d['cash_denoms'])) {
                [$denoms, $contado] = self::sumar($d['cash_denoms'], 'RN-POS-07');
                $conteos['CASH'] = $contado;
            }
            $medios = DB::table('payment_methods')->whereIn('code', array_column($esp['por_medio'], 'code'))->pluck('id', 'code');
            $filas = [];
            foreach ($esp['por_medio'] as $pm) {
                $c = $conteos[$pm['code']] ?? null;
                if ($c === null || $c === '' || ! is_numeric($c)) {
                    RuleError::fail('RN-POS-07', "Falta contar {$pm['name']}.");
                }
                if ((float) $c < 0) {
                    RuleError::fail('RN-POS-07', "El conteo de {$pm['name']} no puede ser negativo.");
                }
                $contado = round((float) $c, 2);
                $filas[] = $pm + ['contado' => $contado, 'diferencia' => round($contado - $pm['esperado'], 2), 'method_id' => $medios[$pm['code']] ?? null];
            }
            $conDif = array_values(array_filter($filas, fn ($f) => abs($f['diferencia']) >= self::EPS));
            $motivo = trim((string) ($d['reason'] ?? ''));
            if ($conDif && mb_strlen($motivo) < 3) {
                $txt = implode(', ', array_map(fn ($f) => $f['name'].' '.($f['diferencia'] > 0 ? '+' : '−').'S/ '.number_format(abs($f['diferencia']), 2), $conDif));
                RuleError::fail('RN-POS-07', "Hay diferencia en el arqueo ({$txt}): escribe el motivo para cerrar.");
            }
            foreach ($filas as $f) {
                if ($f['method_id']) {
                    DB::table('pos_shift_counts')->insert([
                        'shift_id' => $t->id, 'payment_method_id' => $f['method_id'], 'expected_amount' => $f['esperado'],
                        'counted_amount' => $f['contado'], 'difference' => $f['diferencia'], 'created_at' => now(),
                    ]);
                }
            }
            $efectivo = collect($filas)->firstWhere('code', 'CASH') ?? ['esperado' => $esp['efectivo'], 'contado' => $esp['efectivo'], 'diferencia' => 0];
            $limite = (float) (Params::get('pos_max_cash_diff_without_approval', ['site' => $t->establishment_id]) ?? 5);
            $sobre = collect($filas)->contains(fn ($f) => abs($f['diferencia']) > $limite + 1e-9);
            DB::table('pos_shifts')->where('id', $t->id)->update([
                'status' => 'CLOSED', 'closed_at' => now(), 'closed_by' => $u->id, 'closed_by_name' => mb_substr($u->name, 0, 120),
                'expected_cash' => $efectivo['esperado'], 'counted_cash' => $efectivo['contado'], 'difference' => $efectivo['diferencia'],
                'total_difference' => round(array_sum(array_column($filas, 'diferencia')), 2),
                'difference_reason' => $motivo !== '' ? mb_substr($motivo, 0, 255) : null,
                'closing_denoms' => $denoms !== null ? json_encode((object) $denoms) : null, 'over_limit' => $sobre, 'updated_at' => now(),
            ]);
            if ($sobre) {
                $det = implode(' · ', array_map(fn ($f) => $f['name'].' '.($f['diferencia'] >= 0 ? '+' : '−').'S/ '.number_format(abs($f['diferencia']), 2), $conDif));
                DB::table('notifications')->insert([
                    'role' => 'SUPERVISORA_VENTAS', 'title' => mb_substr("Arqueo con diferencia · {$t->number}", 0, 255),
                    'body' => "{$t->cashier_name}: {$det}. Motivo: {$motivo}", 'ref' => json_encode(['screen' => 'POS-08', 'id' => $t->id]),
                    'tone' => 'warn', 'module' => 'POS', 'at' => now(), 'type' => 'ALERTS', 'in_app' => true,
                ]);
            }
            Events::emit('pos.shift.closed', 'pos_shifts', $t->id, ['number' => $t->number, 'difference' => $efectivo['diferencia'], 'over_limit' => $sobre]);

            return self::turno($t->id);
        });
    }

    /** POS-08: aprueba el cierre una persona distinta de la cajera (RN-POS-08). */
    public static function aprobar(string $shiftId, ?string $nota, User $u): object
    {
        return DB::transaction(function () use ($shiftId, $nota, $u) {
            $t = self::bloquear($shiftId);
            if (! Cajas::enAlcance($t->establishment_id, $u)) {
                abort(404, 'Turno no encontrado.');
            }
            if ($t->status !== 'CLOSED') {
                RuleError::fail('RN-POS-08', $t->status === 'OPEN' ? "El turno {$t->number} sigue abierto: primero se cierra con su arqueo." : "El cierre del turno {$t->number} ya está aprobado.");
            }
            if ($t->cashier_user_id === $u->id) {
                RuleError::fail('RN-POS-08', 'El cierre lo aprueba una persona distinta de la cajera.');
            }
            DB::table('pos_shifts')->where('id', $t->id)->update([
                'status' => 'APPROVED', 'approved_by' => $u->id, 'approved_by_name' => mb_substr($u->name, 0, 120), 'approved_at' => now(),
                'approval_note' => trim((string) $nota) !== '' ? mb_substr(trim((string) $nota), 0, 255) : null, 'updated_at' => now(),
            ]);
            Events::emit('pos.shift.approved', 'pos_shifts', $t->id, ['number' => $t->number]);

            return self::turno($t->id);
        });
    }

    /** TUR-00001 por empresa, con candado. */
    private static function numero(): string
    {
        DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ['pos:turno:'.DB::selectOne('SELECT app_tenant_id() AS t')->t]);
        $max = DB::table('pos_shifts')->where('number', 'like', 'TUR-%')
            ->selectRaw("max(nullif(regexp_replace(substr(number, 5), '\\D', '', 'g'), '')::int) AS n")->value('n');

        return 'TUR-'.str_pad((string) (((int) $max) + 1), 5, '0', STR_PAD_LEFT);
    }

    public static function fechaHora(?string $t): string
    {
        return $t ? \Carbon\CarbonImmutable::parse($t)->setTimezone('America/Lima')->format('d/m/Y H:i') : '';
    }
}
