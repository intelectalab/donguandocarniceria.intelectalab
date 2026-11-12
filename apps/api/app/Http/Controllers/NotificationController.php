<?php

namespace App\Http\Controllers;

use App\Support\Access;
use App\Support\Listado;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Notificaciones en la app (INT · notifications): las dirigidas a la persona (user_id) o a su rol
 * (role, sin user_id). La campana pide el resumen; «Ver todas» pide la lista paginada.
 * Leída: la personal, con su read_at; la de rol, con la marca de cada persona (notification_reads),
 * así que leerla no la deja leída para el resto del rol.
 */
class NotificationController extends Controller
{
    /**
     * La campana. «Importantes» son las rojas y las ámbar de los módulos del día a día de la persona:
     * los de su menú corto («dia», códigos de módulo que manda la web) o, sin menú corto, los módulos
     * donde su rol registra o aprueba. La campana cuenta solo las importantes sin leer.
     */
    public function summary(Request $request)
    {
        $d = $request->validate(['dia' => ['nullable', 'string', 'max:200', 'regex:/^[A-Z]{3}(,[A-Z]{3})*$/']]);
        $importante = $this->importante($request, array_values(array_filter(explode(',', $d['dia'] ?? ''))));
        $rango = "CASE tone WHEN 'bad' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END";

        return response()->json([
            'unread' => $this->mias($request)->whereNull('leida_en')->count(),
            'importantes' => $this->mias($request)->whereNull('leida_en')->where($importante)->count(),
            'latest' => $this->mias($request)->orderByDesc('at')->limit(10)->get()->map($this->fila(...)),
            // Las importantes: sin leer primero, lo rojo antes que lo ámbar, y lo más nuevo primero.
            'latest_importantes' => $this->mias($request)->where($importante)
                ->orderByRaw('leida_en IS NOT NULL')->orderByRaw($rango)->orderByDesc('at')->limit(10)->get()->map($this->fila(...)),
        ]);
    }

    public function index(Request $request)
    {
        $query = $this->mias($request)->when($request->boolean('unread'), fn ($q) => $q->whereNull('leida_en'));
        $pagina = Listado::de($query, $request, buscar: ['title', 'body', 'module'],
            ordenar: ['at', 'title', 'module'], porDefecto: '-at');
        $pagina->getCollection()->transform($this->fila(...));

        return response()->json($pagina);
    }

    public function read(Request $request, string $id)
    {
        $n = $this->mias($request)->where('id', $id)->first();
        if ($n && $n->leida_en === null) {
            $this->marcar($request, collect([$n]));
        }

        return response()->noContent();
    }

    public function readAll(Request $request)
    {
        $this->marcar($request, $this->mias($request)->whereNull('leida_en')->get(['id', 'user_id']));

        return response()->noContent();
    }

    /** Marca como leídas para esta persona: las personales en la notificación; las de rol, solo para ella. */
    private function marcar(Request $request, $notificaciones): void
    {
        $yo = $request->user()->id;
        [$personales, $deRol] = $notificaciones->partition(fn ($n) => $n->user_id !== null);
        if ($personales->isNotEmpty()) {
            DB::table('notifications')->whereIn('id', $personales->pluck('id'))->where('user_id', $yo)->whereNull('read_at')
                ->update(['read_at' => now(), 'updated_at' => now()]);
        }
        if ($deRol->isNotEmpty()) {
            DB::table('notification_reads')->insertOrIgnore($deRol->map(fn ($n) => ['notification_id' => $n->id, 'user_id' => $yo, 'read_at' => now()])->values()->all());
        }
    }

    /** Condición de «importante» para la persona (ver summary). */
    private function importante(Request $request, array $dia): \Closure
    {
        $a = Access::for($request->user());
        $modulos = $dia ?: collect($a['enabled_modules'])
            ->filter(fn ($m) => preg_match('/[EA]/', $a['modules'][$m] ?? $a['modules']['*'] ?? ''))->values()->all();

        return fn ($q) => $q->where('tone', 'bad')->orWhere(fn ($w) => $w->where('tone', 'warn')->whereIn('module', $modulos));
    }

    /** Las de la persona y las de su rol, con cuándo la leyó ella (leida_en, null = sin leer). */
    private function mias(Request $request): Builder
    {
        $user = $request->user();
        $roles = Access::for($user)['roles'];
        $q = DB::table('notifications as n')
            ->leftJoin('notification_reads as r', fn ($j) => $j->on('r.notification_id', '=', 'n.id')->where('r.user_id', $user->id))
            ->where(fn ($w) => $w->where('n.user_id', $user->id)->orWhere(fn ($x) => $x->whereNull('n.user_id')->whereIn('n.role', $roles)))
            ->select(['n.id', 'n.user_id', 'n.title', 'n.body', 'n.module', 'n.tone', 'n.ref', 'n.at'])
            ->selectRaw('CASE WHEN n.user_id IS NULL THEN r.read_at ELSE n.read_at END AS leida_en');

        return DB::query()->fromSub($q, 's');
    }

    private function fila(object $n): array
    {
        $ref = json_decode($n->ref ?? 'null', true);

        return [
            'id' => $n->id,
            'title' => $n->title,
            'body' => $n->body,
            'module' => $n->module,
            'tone' => $n->tone,
            'read' => $n->leida_en !== null,
            'created_at' => $n->at,
            // Enlace a la pantalla que la originó: el módulo, hasta que tenga sus propias rutas.
            'link' => is_array($ref) && isset($ref['href']) ? $ref['href'] : ($n->module ? '/m/'.strtolower($n->module) : null),
        ];
    }
}
