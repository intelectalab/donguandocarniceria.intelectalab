<?php

namespace Tests\Feature;

use Tests\TestCase;

/** Contrato de las listas (App\Support\Listado), probado sobre las notificaciones. */
class ListadoTest extends TestCase
{
    private function lista(string $query = ''): array
    {
        $token = $this->ingresar(self::DG, 'rquispe@donguando.pe');

        return $this->desde(self::DG, $token)->getJson('/api/v1/me/notifications'.$query)->assertOk()->json();
    }

    public function test_pagina_con_el_formato_de_laravel_y_tope_de_100(): void
    {
        $r = $this->lista('?per_page=500');

        $this->assertSame(100, $r['per_page']);
        $this->assertArrayHasKey('last_page', $r);
        $this->assertGreaterThan(0, $r['total']);
    }

    public function test_busca_sin_mayusculas_ni_tildes(): void
    {
        $titulo = $this->lista()['data'][0]['title'];
        $palabra = collect(preg_split('/\s+/u', $titulo))->sortByDesc(fn ($p) => mb_strlen($p))->first();
        $sinTildes = strtr(mb_strtoupper($palabra), ['Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U']);

        $r = $this->lista('?q='.urlencode($sinTildes));

        $this->assertGreaterThan(0, $r['total']);
        $this->assertSame(0, $this->lista('?q=zzzz-no-existe')['total']);
    }

    public function test_ordena_solo_por_columnas_permitidas(): void
    {
        $titulos = array_column($this->lista('?sort=title&per_page=100')['data'], 'title');
        $ordenados = $titulos;
        usort($ordenados, fn ($a, $b) => strcmp(mb_strtolower($a), mb_strtolower($b)));
        $this->assertSame(mb_strtolower($titulos[0]), mb_strtolower($ordenados[0]));

        // Una columna que no está en la lista blanca se ignora (no hay error ni se ordena por ella).
        $this->lista('?sort=-user_id');
    }
}
