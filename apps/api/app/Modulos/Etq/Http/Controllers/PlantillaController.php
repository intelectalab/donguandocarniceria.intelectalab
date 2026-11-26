<?php

namespace App\Modulos\Etq\Http\Controllers;

use App\Http\Controllers\Controller;
use App\Modulos\Etq\Services\EtiquetasService as Etq;
use App\Modulos\Pro\Http\Controllers\Alcance;
use App\Support\Access;
use App\Support\Listado;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** ETQ-01 Plantillas de etiqueta y las opciones de las pantallas de ETQ. */
class PlantillaController extends Controller
{
    use Alcance;

    public function index(Request $r)
    {
        $q = DB::table('label_templates as t')->join('brands as b', 'b.id', '=', 't.brand_id')
            ->when($r->query('status'), fn ($x, $s) => $x->where('t.status', $s))
            ->when($r->query('brand_id'), fn ($x, $s) => $x->where('t.brand_id', $s))
            ->selectRaw('t.id, t.code, t.name, t.format, t.width_mm, t.height_mm, t.includes_qr, t.status, t.brand_id, t.updated_at, b.name as brand_name,
                (SELECT count(*) FROM label_prints p WHERE p.template_id = t.id) as prints,
                (SELECT max(p.printed_at) FROM label_prints p WHERE p.template_id = t.id) as last_print');

        return response()->json(Listado::de(DB::query()->fromSub($q, 's'), $r, buscar: ['code', 'name', 'brand_name'],
            ordenar: ['code', 'name', 'brand_name', 'format', 'status', 'updated_at', 'prints'], porDefecto: 'code'));
    }

    public function show(string $id)
    {
        $t = DB::table('label_templates as t')->join('brands as b', 'b.id', '=', 't.brand_id')->where('t.id', $id)->first(['t.*', 'b.name as brand_name']) ?? abort(404);
        $t->missing = Etq::faltantes($t->body, (bool) $t->includes_qr);

        return response()->json($t);
    }

    public function store(Request $r)
    {
        return response()->json(Etq::guardarPlantilla($this->datos($r), null, $r->user()), 201);
    }

    public function update(Request $r, string $id)
    {
        return response()->json(Etq::guardarPlantilla($this->datos($r), $id, $r->user()));
    }

    private function datos(Request $r): array
    {
        return $r->validate(['code' => 'sometimes|string|max:40', 'brand_id' => 'sometimes|uuid', 'name' => 'sometimes|string|max:120', 'format' => 'sometimes|in:ZPL,ESCPOS,PDF',
            'width_mm' => 'sometimes|integer|min:20|max:300', 'height_mm' => 'sometimes|integer|min:10|max:300', 'body' => 'sometimes|string|max:8000',
            'includes_qr' => 'sometimes|boolean', 'status' => 'sometimes|in:DRAFT,ACTIVE,RETIRED']);
    }

    public function opciones(Request $r)
    {
        $locales = Access::for($r->user())['establishments'];

        return response()->json([
            'brands' => DB::table('brands')->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'code', 'name']),
            'templates' => DB::table('label_templates as t')->join('brands as b', 'b.id', '=', 't.brand_id')->where('t.status', 'ACTIVE')->orderBy('t.code')
                ->get(['t.id', 't.code', 't.name', 't.format', 't.width_mm', 't.height_mm', 't.brand_id', 'b.name as brand_name']),
            'establishments' => DB::table('establishments')->where('status', 'ACTIVE')->when($locales, fn ($q) => $q->whereIn('id', $locales))->orderBy('name')
                ->get(['id', 'code', 'name', 'short']),
            'printers' => DB::table('equipment')->where('category', 'LABEL_PRINTER')->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))->orderBy('code')
                ->get(['id', 'code', 'name', 'establishment_id', 'status']),
            'scales' => DB::table('equipment')->where('category', 'SCALE')->when($locales, fn ($q) => $q->whereIn('establishment_id', $locales))->orderBy('code')
                ->get(['id', 'code', 'name', 'establishment_id', 'status']),
            'fields' => Etq::CAMPOS, 'required_fields' => Etq::OBLIGATORIOS,
            'channels' => ['COUNTER', 'WHATSAPP', 'WEB', 'B2B'],
            'risk_classes' => ['CLASS_I', 'CLASS_II', 'CLASS_III'],
            'can' => ['manage_templates' => $this->puede($r, 'etq.template.manage'), 'print' => $this->puede($r, 'etq.label.print') || $this->puede($r, 'etq.label.reprint'),
                'reprint' => $this->puede($r, 'etq.label.reprint'), 'start_recall' => $this->puede($r, 'etq.recall.start'), 'close_recall' => $this->puede($r, 'etq.recall.close')],
        ]);
    }
}
