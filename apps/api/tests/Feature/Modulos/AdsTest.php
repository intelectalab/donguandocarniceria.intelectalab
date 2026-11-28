<?php

namespace Tests\Feature\Modulos;

use App\Modulos\Ads\Services\Publicidad;
use App\Support\TenantContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ADS · Publicidad y atribución (ADS-01 a ADS-09; RN-ADS-01 a 12; CA-ADS-01 a 07).
 */
class AdsTest extends TestCase
{
    private const ADMIN = 'lccahuana@donguando.pe';

    private const GERENTE = 'rquispe@donguando.pe';

    private const CONTADORA = 'mcardenas@donguando.pe';

    private array $tokens = [];

    private function como(string $email): static
    {
        return $this->desde(self::DG, $this->tokens[$email] ??= $this->ingresar(self::DG, $email));
    }

    private function enEmpresa(string $short, callable $f): mixed
    {
        TenantContext::set(['id' => DB::table('tenants')->where('short', $short)->value('id')]);
        try {
            return $f();
        } finally {
            TenantContext::set(null);
        }
    }

    public function test_pantallas_rastreo_reimportacion_y_tipo_de_cambio(): void
    {
        $this->travelTo(Carbon::parse('2026-10-10 10:00:00', 'America/Lima'));

        // ADS-01 Cuentas publicitarias y ADS-02 Campañas y anuncios
        $cuentas = $this->como(self::ADMIN)->getJson('/api/v1/ads/cuentas')->assertOk();
        $this->assertNotEmpty($cuentas->json('data'));

        $anuncios = $this->como(self::ADMIN)->getJson('/api/v1/ads/anuncios')->assertOk();
        $this->assertNotEmpty($anuncios->json('anuncios'));
        $this->assertGreaterThanOrEqual(1, $anuncios->json('cifras.sin_rastreo'));

        // RN-ADS-03: código de rastreo con formato inválido o repetido se rechaza.
        $ad0 = $anuncios->json('anuncios.0');
        $this->como(self::ADMIN)->putJson("/api/v1/ads/anuncios/{$ad0['id']}/rastreo", [
            'destination' => 'WHATSAPP',
            'channel_id' => $ad0['channel_id'],
            'tracking_code' => 'MALO',
            'status' => 'ACTIVE',
        ])->assertStatus(422)->assertJsonPath('code', 'RN-ADS-03');

        // CA-ADS-02: reimportar un día con S/ 120 ajustado a S/ 118 deja una sola fila con S/ 118.
        $this->enEmpresa('Don Guando', function () {
            $camp = DB::table('ad_campaigns')->where('code', 'DG-GO-SRCH')->first();
            $ad = DB::table('ad_ads')->where('campaign_id', $camp->id)->first();
            Publicidad::importarDia($camp->account_id, '2026-08-20', [
                ['campaign_id' => $camp->id, 'ad_id' => $ad->id, 'spend' => 120],
            ], null, 1.0);
            $r = Publicidad::importarDia($camp->account_id, '2026-08-20', [
                ['campaign_id' => $camp->id, 'ad_id' => $ad->id, 'spend' => 118],
            ], null, 1.0);
            $filas = DB::table('ad_spend_daily')->where('campaign_id', $camp->id)->where('ad_id', $ad->id)->where('spend_date', '2026-08-20')->get();
            $this->assertCount(1, $filas);
            $this->assertSame(118.0, (float) $filas[0]->spend_pen);
            $this->assertSame(1, $r['actualizadas']);

            // CA-ADS-06: cuenta en USD, gasto de USD 100 con tipo de cambio 3.80 -> S/ 380.
            $accUsd = DB::table('ad_accounts')->where('currency', 'USD')->first();
            $campUsd = DB::table('ad_campaigns')->where('account_id', $accUsd->id)->first();
            $adUsd = DB::table('ad_ads')->where('campaign_id', $campUsd->id)->first();
            Publicidad::importarDia($accUsd->id, '2026-08-25', [
                ['campaign_id' => $campUsd->id, 'ad_id' => $adUsd->id, 'spend' => 100],
            ], null, 3.80);
            $filaUsd = DB::table('ad_spend_daily')->where('campaign_id', $campUsd->id)->where('ad_id', $adUsd->id)->where('spend_date', '2026-08-25')->first();
            $this->assertSame(380.0, (float) $filaUsd->spend_pen);
        });
    }

    public function test_atribucion_resultados_roas_y_conciliacion_de_facturas(): void
    {
        $this->travelTo(Carbon::parse('2026-10-10 10:00:00', 'America/Lima'));

        // CA-ADS-04: clic a WhatsApp con referral + código de otro anuncio en el mensaje -> gana CTWA_REFERRAL.
        $this->enEmpresa('Don Guando', function () {
            $ctwa = Publicidad::anuncioPorCodigo('DG-C01');
            $otro = Publicidad::anuncioPorCodigo('DG-G01');
            $at1 = Publicidad::atribuirLead([
                'referral_ad_id' => $ctwa->id,
                'first_message' => 'Hola, vi el anuncio '.$otro->tracking_code,
                'phone' => '+51955000111',
            ]);
            $this->assertSame(['CTWA_REFERRAL', $ctwa->id], [$at1->method, $at1->ad_id]);

            $at2 = Publicidad::atribuirLead([
                'first_message' => 'hola vi el anuncio '.strtolower($otro->tracking_code),
                'phone' => '+51955000222',
            ]);
            $this->assertSame(['TRACKING_CODE', $otro->id], [$at2->method, $at2->ad_id]);
        });

        // CA-ADS-03: gasto importado de Meta de S/ 3000 en agosto -> factura de S/ 3020 queda RECONCILED (tolerancia 2% = S/ 60);
        // factura de S/ 3100 queda OBSERVED con diferencia de S/ 100.
        $accMeta = $this->enEmpresa('Don Guando', function () {
            $acc = DB::table('ad_accounts')->where('platform', 'META')->first();
            $camp = DB::table('ad_campaigns')->where('account_id', $acc->id)->first();
            $ad = DB::table('ad_ads')->where('campaign_id', $camp->id)->first();
            for ($i = 0; $i < 30; $i++) {
                $dia = Carbon::parse('2026-08-01')->addDays($i)->toDateString();
                Publicidad::importarDia($acc->id, $dia, [
                    ['campaign_id' => $camp->id, 'ad_id' => $ad->id, 'spend' => 100],
                ], null, 1.0);
            }

            return $acc;
        });

        $okInv = $this->como(self::CONTADORA)->postJson('/api/v1/ads/facturas', [
            'account_id' => $accMeta->id,
            'invoice_number' => 'FBADS-AGO-1',
            'issue_date' => '2026-09-03',
            'period_from' => '2026-08-01',
            'period_to' => '2026-08-31',
            'currency' => 'PEN',
            'amount' => 3020,
            'send_to_gas' => false,
        ])->assertCreated();
        $this->assertSame(['RECONCILED', 60.0, 20.0], [
            $okInv->json('status'),
            (float) $okInv->json('tolerance_pen'),
            (float) $okInv->json('difference_pen'),
        ]);

        $badInv = $this->como(self::CONTADORA)->postJson('/api/v1/ads/facturas', [
            'account_id' => $accMeta->id,
            'invoice_number' => 'FBADS-AGO-2',
            'issue_date' => '2026-09-03',
            'period_from' => '2026-08-01',
            'period_to' => '2026-08-31',
            'currency' => 'PEN',
            'amount' => 3100,
            'send_to_gas' => false,
        ])->assertCreated();
        $this->assertSame(['OBSERVED', 100.0], [$badInv->json('status'), (float) $badInv->json('difference_pen')]);

        // Enviar la factura conciliada a Gastos (GAS) crea el gasto FOREIGN_INVOICE.
        $gasInv = $this->como(self::CONTADORA)->postJson('/api/v1/ads/facturas/'.$okInv->json('id').'/enviar-gas')->assertOk();
        $this->assertNotNull($gasInv->json('expense_id'));
        $this->assertStringStartsWith('GS-', $gasInv->json('expense_number'));

        // ADS-05 Resultados, ADS-06 Embudo, ADS-08 Creadores y ADS-09 Comparativo responden 200 con sus cifras.
        $res = $this->como(self::GERENTE)->getJson('/api/v1/ads/resultados?desde=2026-09-01&hasta=2026-09-30')->assertOk();
        $this->assertGreaterThan(0, $res->json('totales.spend'));

        $embudo = $this->como(self::GERENTE)->getJson('/api/v1/ads/embudo?desde=2026-09-01&hasta=2026-09-30')->assertOk();
        $this->assertGreaterThan(0, $embudo->json('cobertura.digitales'));

        $this->como(self::GERENTE)->getJson('/api/v1/ads/creadores?desde=2026-09-01&hasta=2026-10-31')->assertOk();
        $comp = $this->como(self::GERENTE)->getJson('/api/v1/ads/comparativo?desde=2026-09-01&hasta=2026-09-30')->assertOk();
        $this->assertCount(3, $comp->json('plataformas'));
    }
}
