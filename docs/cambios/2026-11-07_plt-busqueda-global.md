# 07/11/2026 · PLT-02 Búsqueda global

## Qué hace
- La caja de la barra (Ctrl K o «/») busca, desde 3 letras (`plt_search_min_chars`), en clientes, pedidos, comprobantes, productos, trabajadores, en los datos de Plataforma (empresas, locales, marcas, series, centros de costo) y en lo que publican los demás módulos (`search_entries`). Sigue mostrando las pantallas, como antes. Sin distinguir mayúsculas ni tildes.
- Hasta `plt_search_max_results` (20) resultados, repartidos entre tipos, primero los que empiezan con lo buscado y después los más recientes.
- «Ver todos los resultados» abre la pantalla PLT-02, con los resultados agrupados por tipo y cuántos hay de cada uno. La búsqueda queda en la dirección (`/m/plt/plt-02?q=…`).
- Mientras los módulos no tengan sus fichas, un resultado abre la pantalla del módulo.

## Seguridad (RN-PLT-16)
- Todo pasa por RLS: solo datos de la empresa de la sesión.
- Solo módulos encendidos que el rol puede ver (letra L): con TEL apagado, sus llamadas no salen ni para la gerencia.
- Solo marcas y locales del alcance del usuario.
- Cada entrada publicada puede pedir su propio permiso (`permission_code`).
- Texto buscado con parámetros (sin armar SQL con lo escrito), máximo 100 caracteres, y límite de 60 búsquedas por minuto.
- Los enlaces de las entradas publicadas solo pueden ser rutas internas del sistema.

## Para los demás módulos
`App\Modulos\Plt\Services\Busqueda::publicar($modulo, $tipo, $id, $titulo, $detalle, $url, keywords:, brandId:, siteId:, permiso:)` al crear o cambiar algo que se debe encontrar (una conversación, una llamada…), y `Busqueda::quitar(...)` al anularlo. Clientes, pedidos, comprobantes, productos y trabajadores ya se buscan directo en sus tablas.

## API
`GET /v1/plt/buscar?q=` (cualquier usuario con `plt.search.use`, que es de todos).

## Pruebas
`tests/Feature/Modulos/PltBusquedaTest.php`: mínimo de letras, varios tipos y sin tildes, datos de Plataforma, alcance de marcas, módulo apagado y publicar y quitar. 78 pruebas en total.
