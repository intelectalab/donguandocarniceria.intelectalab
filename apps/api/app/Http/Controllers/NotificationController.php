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
 */
class NotificationController extends Controller
{
    public function summary(Request $request)
    {
        return response()->json([
            'unread' => $this->mias($request)->whereNull('read_at')->count(),
            'latest' => $this->mias($request)->orderByDesc('at')->limit(10)->get()->map($this->fila(...)),
        ]);
    }

    public function index(Request $request)
    {
        $query = $this->mias($request)->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'));
        $pagina = Listado::de($query, $request, buscar: ['title', 'body', 'module'],
            ordenar: ['at', 'title', 'module'], porDefecto: '-at');
        $pagina->getCollection()->transform($this->fila(...));

        return response()->json($pagina);
    }

    public function read(Request $request, string $id)
    {
        $this->mias($request)->where('id', $id)->whereNull('read_at')->update(['read_at' => now(), 'updated_at' => now()]);

        return response()->noContent();
    }

    public function readAll(Request $request)
    {
        $this->mias($request)->whereNull('read_at')->update(['read_at' => now(), 'updated_at' => now()]);

        return response()->noContent();
    }

    private function mias(Request $request): Builder
    {
        $user = $request->user();
        $roles = Access::for($user)['roles'];

        return DB::table('notifications')->where(fn ($q) => $q->where('user_id', $user->id)
            ->orWhere(fn ($r) => $r->whereNull('user_id')->whereIn('role', $roles)));
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
            'read' => $n->read_at !== null,
            'created_at' => $n->at,
            // Enlace a la pantalla que la originó: el módulo, hasta que tenga sus propias rutas.
            'link' => is_array($ref) && isset($ref['href']) ? $ref['href'] : ($n->module ? '/m/'.strtolower($n->module) : null),
        ];
    }
}
