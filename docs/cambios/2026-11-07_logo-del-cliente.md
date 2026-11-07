# 07/11/2026 · Logo del cliente

## Qué es
El logo general del cliente (el tenant, con todas sus empresas y marcas). Sale en la pantalla de ingreso, cuando se entra por dominio, y en el cuadro de arriba del menú, donde antes salían las iniciales. Cada marca sigue teniendo su propio logo en 05 Marcas, que es el de sus comprobantes.

## Dónde se cambia
06 Colores, pestaña **General**: subir, cambiar o quitar. PNG, JPG o WEBP de hasta 1 MB. Pide `plt.theme.manage` (gerencia y sistemas), igual que los colores.

## Migración (solo agrega)
`2026_11_07_000300_plt_logo_del_cliente`: tabla `tenant_branding`, una fila por cliente, con RLS y bitácora. Correr: `php artisan migrate --database=pgsql_owner`.

## Seguridad
- El logo no va en `tenants`: la app solo puede leer esa tabla, y así sigue, para que un error nunca cambie el plan o el estado de otro cliente. `tenant_branding` tiene RLS: cada cliente solo ve y cambia su fila.
- Solo PNG, JPG o WEBP (sin SVG, que puede llevar código), hasta 1 MB, en el disco privado y servido con `X-Content-Type-Options: nosniff`.
- `/v1/tenant/logo` da el logo del cliente de la petición: en el ingreso por dominio, el del dominio; con sesión, el del usuario. En el ingreso general, sin cliente, no da nada.
- La pantalla de ingreso solo muestra un logo de la propia API, `data:image/` o `https://`.
- `App\Support\Logos` reúne la validación, el guardado y la entrega de logos; Marcas también lo usa.

## API
`POST /v1/plt/temas/logo`, `DELETE /v1/plt/temas/logo`, `GET /v1/tenant/logo`. `/v1/me` trae `tenant.logo_url`.

## Pruebas
`tests/Feature/Modulos/PltLogoClienteTest.php`: tipos y tamaño, subir, cambiar y quitar, armazón, cada cliente su logo, ingreso por dominio y permisos. 81 pruebas en total.
