<?php

namespace Tests\Feature\Modulos;

use App\Models\User;
use App\Modulos\Cal\Services\CalidadService as Cal;
use App\Modulos\Cat\Services\Balanza;
use App\Modulos\Etq\Services\EtiquetasService as Etq;
use App\Support\RuleError;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ETQ · Etiquetado, trazabilidad y retiros. CA-ETQ-01 a 06 de la spec, RN-ETQ-04/11/12, permisos y rutas.
 * Fecha de las pruebas: 10/10/2026. Datos de demo: el chorizo CH-2026-0412 en cuarentena hecho con la carne de cerdo
 * CP-2026-0310 del Camal San Pedro, el cuy CU-2026-1008 de la Granja Don Guando (con su QR) y el retiro abierto RC-2026-002.
 */
class EtqTest extends TestCase
{
    private const CALIDAD = 'sramos@donguando.pe';      // CALIDAD: plantillas, reimpresión y retiros

    private const JEFE = 'olazo@donguando.pe';          // JEFE_PRODUCCION: reimprime, no inicia retiros

    private const OPERARIO = 'npoma@donguando.pe';      // OPERARIO_PRODUCCION, local 2: imprime

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-10 10:00', 'America/Lima'));
    }

    /* ------------------------------------------------------------ ayudas */

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function usuario(string $email = self::CALIDAD): User
    {
        $tenantId = DB::selectOne('SELECT auth_tenants_for_email(?) AS t', [$email])->t;
        TenantContext::set(TenantContext::find($tenantId));
        $u = User::where('email', $email)->firstOrFail();
        TenantContext::setUser($u->id);

        return $u;
    }

    private function falla(string $regla, callable $fn): RuleError
    {
        try {
            $fn();
        } catch (RuleError $e) {
            $this->assertSame($regla, $e->rule, $e->getMessage());

            return $e;
        }
        $this->fail("Se esperaba el rechazo {$regla} y la acción pasó.");
    }

    private function lote(string $codigo): object
    {
        $this->usuario();

        return DB::table('lots')->where('code', $codigo)->orderByDesc('created_at')->first();
    }

    private function plantilla(string $codigo): object
    {
        $this->usuario();

        return DB::table('label_templates')->where('code', $codigo)->first();
    }

    private function impresion(object $lot, int $copias = 1, string $quien = self::OPERARIO): object
    {
        return Etq::imprimir(['template_id' => $this->plantilla('ETQ-M3-100X50')->id, 'lot_id' => $lot->id, 'copies' => $copias, 'printer_code' => 'IMP-L2-01'], $this->usuario($quien));
    }

    /** Tres boletas a tres clientes distintos con 2 unidades del lote (copias de una boleta de la demo). */
    private function boletas(object $lot): array
    {
        $this->usuario();
        $base = DB::table('sales_documents')->where('status', 'ISSUED')->where('doc_type', 'RECEIPT')->whereNotNull('customer_id')->orderBy('number')->first();
        $linea = DB::table('sales_document_lines')->where('sales_document_id', $base->id)->orderBy('line_no')->first();
        $clientes = DB::table('customers')->where('status', 'ACTIVE')->whereNotNull('phone')->orderBy('full_name')->offset(5)->limit(3)->pluck('id');
        $max = (int) DB::table('sales_documents')->where('series', $base->series)->max('number');
        $ids = [];
        foreach ($clientes as $i => $c) {
            $num = $max + 1 + $i;
            $id = DB::table('sales_documents')->insertGetId(array_merge((array) $base, ['id' => Str::uuid()->toString(), 'number' => $num,
                'full_number' => $base->series.'-'.str_pad((string) $num, 8, '0', STR_PAD_LEFT), 'customer_id' => $c, 'order_id' => null, 'related_document_id' => null,
                'created_at' => now(), 'updated_at' => now()]), 'id');
            DB::table('sales_document_lines')->insert(array_merge((array) $linea, ['id' => Str::uuid()->toString(), 'sales_document_id' => $id,
                'line_no' => 1, 'variant_id' => $lot->variant_id, 'description' => 'Chorizo parrillero 500 g', 'qty' => 2, 'lot_id' => $lot->id]));
            $ids[] = $id;
        }

        return $ids;
    }

    /* ------------------------------------------------------------ criterios de aceptación */

    public function test_ca_etq_01_lote_en_cuarentena_se_etiqueta_y_retirado_no(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $this->assertSame('QUARANTINE', $lot->qc_status);
        $p = $this->impresion($lot, 60);
        $this->assertSame(60, (int) $p->copies);
        $this->assertSame('CH-2026-0412', $p->lot_code);
        $this->assertNull($p->reprint_of);

        $this->usuario();
        DB::statement("SELECT set_config('app.cal_decision', 'on', true)");
        DB::table('lots')->where('id', $lot->id)->update(['qc_status' => 'RECALLED']);
        $this->falla('RN-ETQ-01', fn () => $this->impresion($lot));
    }

    public function test_ca_etq_02_trazabilidad_hacia_atras_llega_al_camal(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $t = Etq::trazar($lot->id);
        $cp = collect($t['backward'])->firstWhere('code', 'CP-2026-0310');
        $this->assertNotNull($cp, 'Falta CP-2026-0310 hacia atrás.');
        $this->assertSame(1, $cp['level']);
        $this->assertSame('Camal San Pedro', $cp['supplier']);
        $this->assertSame('SLAUGHTERHOUSE', DB::table('suppliers')->where('id', $cp['row']->supplier_id ?? DB::table('lots')->where('id', $cp['lot_id'])->value('supplier_id'))->value('supplier_type'));
        // Y hacia adelante, desde la carne, aparece el chorizo.
        $this->assertContains($lot->id, Etq::trazar($cp['lot_id'])['descendants']);
    }

    public function test_ca_etq_03_retiro_con_derivados_y_tres_contactos(): void
    {
        $ch = $this->lote('CH-2026-0412');
        Cal::decidir($ch->id, ['decision' => 'RELEASE'], $this->usuario());
        $this->boletas($ch);
        $cp = $this->lote('CP-2026-0310');

        $previa = Etq::previa(['lot_ids' => [$cp->id], 'include_descendants' => true]);
        $this->assertCount(3, $previa['customers']);

        $r = Etq::iniciarRetiro(['lot_ids' => [$cp->id], 'include_descendants' => true, 'reason' => 'Carne de cerdo con resultado positivo a Salmonella en el camal',
            'risk_class' => 'CLASS_I'], $this->usuario());
        $this->assertMatchesRegularExpression('/^RC-2026-\d{3}$/', $r->number);
        $this->assertSame('RECALLED', DB::table('lots')->where('id', $cp->id)->value('qc_status'));
        $this->assertSame('RECALLED', DB::table('lots')->where('id', $ch->id)->value('qc_status'));
        $this->assertCount(3, $r->contacts);
        $this->assertEquals(6.0, (float) $r->progress['sold_kg']);
        $this->assertNotNull($r->contacts_listed_at);
        $this->assertDatabaseHas('domain_events', ['event_name' => 'lot.recalled', 'aggregate_id' => $ch->id]);
        $this->assertDatabaseHas('domain_events', ['event_name' => 'lot_recall.started', 'aggregate_id' => $r->id]);
        // El stock del lote retirado ya no se puede usar ni etiquetar.
        $this->falla('RN-ETQ-01', fn () => $this->impresion($ch));
        // El aviso usa la plantilla de utilidad del CRM.
        $a = Etq::aviso($r->contacts[0]->id);
        $this->assertSame('recall_aviso_cliente', $a['template']);
        $this->assertSame('UTILITY', $a['kind']);
        $this->assertStringContainsString('CH-2026-0412', $a['text']);
        // Iniciarlo exige etq.recall.start (RN-ETQ-13).
        $this->falla('RN-ETQ-13', fn () => Etq::iniciarRetiro(['lot_ids' => [$cp->id], 'reason' => 'Prueba', 'risk_class' => 'CLASS_II'], $this->usuario(self::JEFE)));
    }

    public function test_ca_etq_04_retiro_con_contacto_pendiente_no_se_cierra(): void
    {
        $this->usuario();
        $r = DB::table('lot_recalls')->where('number', 'RC-2026-002')->first();
        $this->assertSame('OPEN', $r->status);
        $this->assertTrue(DB::table('lot_recall_contacts')->where('recall_id', $r->id)->where('status', 'PENDING')->exists());

        $this->falla('RN-ETQ-08', fn () => Etq::cerrarRetiro($r->id, ['closing_summary' => 'Resumen'], $this->usuario()));
        foreach (DB::table('lot_recall_contacts')->where('recall_id', $r->id)->where('status', 'PENDING')->pluck('id') as $c) {
            Etq::contacto($c, ['status' => 'NOT_REACHABLE', 'contact_notes' => 'Sin respuesta'], $this->usuario());
        }
        $this->falla('RN-ETQ-08', fn () => Etq::cerrarRetiro($r->id, ['closing_summary' => ''], $this->usuario()));
        $c = Etq::cerrarRetiro($r->id, ['closing_summary' => 'Todos los clientes avisados', 'authority_notified' => true], $this->usuario());
        $this->assertSame('CLOSED', $c->status);
        $this->assertNotNull($c->authority_notified_at);
    }

    public function test_ca_etq_05_plantilla_activa_sin_registro_sanitario_se_rechaza(): void
    {
        $u = $this->usuario();
        $dg = DB::table('brands')->where('code', 'DG')->value('id');
        $e = $this->falla('RN-ETQ-03', fn () => Etq::guardarPlantilla(['brand_id' => $dg, 'code' => 'ETQ-PRUEBA', 'name' => 'Prueba', 'format' => 'ZPL', 'width_mm' => 100,
            'height_mm' => 50, 'includes_qr' => true, 'status' => 'ACTIVE', 'body' => '{{brand}} {{product}} {{net_weight}} {{lot}} {{production_date}} {{expiry_date}} {{qr}}'], null, $u));
        $this->assertStringContainsString('{{sanitary_registry}}', $e->getMessage());
        // La borrador de la demo tampoco se activa.
        $this->falla('RN-ETQ-03', fn () => Etq::guardarPlantilla(['status' => 'ACTIVE'], $this->plantilla('ETQ-M5-NUEVA')->id, $this->usuario()));
        // Y la base lo impide aunque no se pase por el servicio.
        $this->expectException(QueryException::class);
        DB::transaction(fn () => DB::table('label_templates')->where('code', 'ETQ-M5-NUEVA')->update(['status' => 'ACTIVE']));
    }

    public function test_ca_etq_06_qr_del_cuy_de_la_granja_sin_precios_ni_clientes(): void
    {
        $lot = $this->lote('CU-2026-1008');
        $this->assertNotEmpty(Etq::ventas([$lot->id]), 'El lote debe tener clientes para comprobar que no se muestran.');
        $token = DB::table('lot_qr_tokens')->where('lot_id', $lot->id)->value('token');

        // Sin sesión, como lo abre el cliente desde el celular.
        $res = $this->getJson("/api/v1/publico/lotes/{$token}")->assertOk()
            ->assertJsonPath('farm.tagline', 'De nuestra granja a tu mesa')->assertJsonPath('farm.slaughter_date', '2026-10-07')->assertJsonPath('lot', 'CU-2026-1008');
        $this->assertStringContainsString('Granja Don Guando', $res->json('farm.farm_name'));
        $txt = mb_strtolower($res->getContent());
        foreach (['price', 'cost', 'customer', 'order', 'precio', 's/ '] as $k) {
            $this->assertStringNotContainsString($k, $txt, "La página pública expone «{$k}».");
        }
        // Un lote en cuarentena no se muestra (RN-ETQ-09) y un token inventado tampoco.
        $q = Etq::token($this->lote('CH-2026-0412')->id);
        $this->getJson("/api/v1/publico/lotes/{$q}")->assertNotFound()->assertJsonPath('code', 'RN-ETQ-09');
        $this->getJson('/api/v1/publico/lotes/noExisteEsteToken123')->assertNotFound();
    }

    /* ------------------------------------------------------------ otras reglas */

    public function test_rn_etq_11_precio_por_peso_real_y_codigo_de_balanza(): void
    {
        $lot = $this->lote('CU-2026-1008');
        $a = Etq::armar(['template_id' => $this->plantilla('ETQ-DG-100X50')->id, 'lot_id' => $lot->id, 'net_weight_kg' => 0.987, 'channel' => 'COUNTER']);
        $this->assertEquals(42.0, (float) $a['price_per_kg']);
        $this->assertEquals(41.5, (float) $a['price']);   // 42 × 0,987 = 41,454 → S/ 41,50
        $this->assertStringStartsWith('2', $a['barcode']);
        $this->assertSame(0.987, Balanza::leer($a['barcode'])['weight_kg']);
        $this->assertStringContainsString('^XA', $a['payload']);
        $this->assertStringContainsString($a['qr_url'], $a['payload']);
        $this->assertStringContainsString('CU-2026-1008', $a['text']);
    }

    public function test_rn_etq_04_reimpresion_exige_motivo_y_permiso_y_rn_etq_12_solo_insercion(): void
    {
        $lot = $this->lote('CH-2026-0412');
        $p = $this->impresion($lot, 10);
        $this->falla('RN-ETQ-04', fn () => Etq::imprimir(['reprint_of' => $p->id], $this->usuario(self::OPERARIO)));
        $this->falla('RN-ETQ-04', fn () => Etq::imprimir(['reprint_of' => $p->id, 'reprint_reason' => ''], $this->usuario(self::JEFE)));
        $r = Etq::imprimir(['reprint_of' => $p->id, 'reprint_reason' => 'Se atascó el rollo', 'copies' => 2], $this->usuario(self::JEFE));
        $this->assertSame($p->id, $r->reprint_of);
        $this->assertSame($lot->id, $r->lot_id);

        $this->expectException(QueryException::class);
        DB::transaction(fn () => DB::table('label_prints')->where('id', $p->id)->update(['copies' => 1]));
    }

    public function test_api_etiquetas(): void
    {
        $this->como(self::CALIDAD)->getJson('/api/v1/etq/opciones')->assertOk()->assertJsonPath('can.start_recall', true);
        $this->como(self::OPERARIO)->getJson('/api/v1/etq/opciones')->assertOk()->assertJsonPath('can.start_recall', false)->assertJsonPath('can.print', true);
        $this->como(self::CALIDAD)->getJson('/api/v1/etq/plantillas')->assertOk()->assertJsonFragment(['code' => 'ETQ-M3-100X50']);
        $tpl = $this->plantilla('ETQ-M5-NUEVA');
        $this->como(self::CALIDAD)->getJson("/api/v1/etq/plantillas/{$tpl->id}")->assertOk()->assertJsonStructure(['missing']);
        $this->como(self::CALIDAD)->putJson("/api/v1/etq/plantillas/{$tpl->id}", ['status' => 'ACTIVE'])->assertStatus(422)->assertJsonPath('code', 'RN-ETQ-03');
        $this->como(self::OPERARIO)->putJson("/api/v1/etq/plantillas/{$tpl->id}", ['name' => 'x'])->assertStatus(403);

        $lot = $this->lote('CH-2026-0412');
        $m3 = $this->plantilla('ETQ-M3-100X50');
        $this->como(self::OPERARIO)->getJson('/api/v1/etq/lotes?q=CH-2026-0412')->assertOk()->assertJsonFragment(['code' => 'CH-2026-0412']);
        $this->como(self::OPERARIO)->postJson('/api/v1/etq/previa', ['template_id' => $m3->id, 'lot_id' => $lot->id])->assertOk()
            ->assertJsonPath('lot.code', 'CH-2026-0412')->assertJsonPath('block', null)->assertJsonMissingPath('lot.unit_cost');
        $p = $this->como(self::OPERARIO)->postJson('/api/v1/etq/impresiones', ['template_id' => $m3->id, 'lot_id' => $lot->id, 'copies' => 3, 'printer_code' => 'IMP-L2-01'])
            ->assertCreated()->json();
        $this->como(self::OPERARIO)->postJson("/api/v1/etq/impresiones/{$p['id']}/reimprimir", ['reprint_reason' => 'x'])->assertStatus(403);
        $this->como(self::JEFE)->postJson("/api/v1/etq/impresiones/{$p['id']}/reimprimir", ['reprint_reason' => 'Etiqueta borrosa'])->assertCreated()->assertJsonPath('reprint_of', $p['id']);
        $this->como(self::CALIDAD)->getJson('/api/v1/etq/impresiones?reprints=1')->assertOk()->assertJsonFragment(['reprint_reason' => 'Etiqueta borrosa']);
        $this->como(self::CALIDAD)->getJson("/api/v1/etq/impresiones/{$p['id']}")->assertOk()->assertJsonCount(1, 'reprints');

        // ETQ-08: el enlace del QR para la vista interna; un lote en cuarentena todavía no tiene página pública.
        $this->como(self::OPERARIO)->getJson("/api/v1/etq/lotes/{$lot->id}/qr")->assertOk()->assertJsonStructure(['token', 'url'])->assertJsonPath('public', null);
        $cuy = $this->lote('CU-2026-1008');
        $this->como(self::OPERARIO)->getJson("/api/v1/etq/lotes/{$cuy->id}/qr")->assertOk()->assertJsonPath('public.lot', 'CU-2026-1008');
        $this->como(self::CALIDAD)->getJson("/api/v1/etq/lotes/{$lot->id}/trazabilidad")->assertOk()->assertJsonFragment(['code' => 'CP-2026-0310']);
        $this->como(self::CALIDAD)->getJson('/api/v1/etq/retiros')->assertOk()->assertJsonFragment(['number' => 'RC-2026-002']);
        $r = DB::table('lot_recalls')->where('number', 'RC-2026-002')->first();
        $this->como(self::CALIDAD)->getJson("/api/v1/etq/retiros/{$r->id}")->assertOk()->assertJsonStructure(['contacts', 'lots', 'progress', 'whatsapp_template']);
        $c = DB::table('lot_recall_contacts')->where('recall_id', $r->id)->where('status', 'PENDING')->value('id');
        $this->como(self::CALIDAD)->getJson("/api/v1/etq/contactos/{$c}/aviso")->assertOk()->assertJsonPath('kind', 'UTILITY');
        $this->como(self::CALIDAD)->postJson("/api/v1/etq/retiros/{$r->id}/cerrar", ['closing_summary' => 'x'])->assertStatus(422)->assertJsonPath('code', 'RN-ETQ-08');
        $this->como(self::CALIDAD)->postJson('/api/v1/etq/retiros/previa', ['lot_ids' => [$lot->id], 'include_descendants' => true])->assertOk()->assertJsonStructure(['lots', 'customers', 'stock_qty']);
        $this->como(self::JEFE)->postJson('/api/v1/etq/retiros', ['lot_ids' => [$lot->id], 'reason' => 'Prueba de retiro', 'risk_class' => 'CLASS_II'])->assertStatus(403);
        $this->como(self::CALIDAD)->getJson('/api/v1/etq/tablero')->assertOk()
            ->assertJsonStructure(['recalls', 'open_recalls', 'listing_minutes_avg', 'recovery_pct', 'prints', 'reprint_pct', 'by_establishment', 'open', 'brands_without_template']);
        $this->como('mcardenas@donguando.pe')->getJson('/api/v1/etq/plantillas')->assertStatus(403);
    }
}
