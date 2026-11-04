# 03/11/2026 · Base del proyecto lista para construir módulos

## Qué se hizo
- **Infraestructura:** Docker con Postgres 17 (puerto 5433) y Redis 8 (6380). Usuarios `aycha_owner` (migra) y `aycha_app` (la app, con RLS). Base `aycha_test` para las pruebas.
- **Base de datos:**
  - 27 migraciones con las tablas de las fases 0 y 1, generadas desde el modelo del prototipo;
  - RLS en todas las tablas con `tenant_id`;
  - bitácora `audit.change_log` inmutable y `domain_events`;
  - tokens de Sanctum con RLS y matriz de acceso por módulo.
- **Semillas:** catálogos globales y dos empresas de demo (DG y CS), con un usuario por rol.
- **API (Laravel 12):**
  - la empresa se resuelve por el dominio (`tenant`);
  - ingreso con bloqueo por intentos fallidos, `/me`, cierre de sesión;
  - permisos (`permiso:`), acceso por módulo (`modulo:` con RN-PLT-07);
  - `RuleError`, `Params` y `Events`;
  - las rutas de cada módulo se cargan solas desde `routes/modulos/`.
- **Web (Next.js 16):**
  - ingreso con el nombre y las marcas de la empresa;
  - armazón con menú por grupos (solo los módulos del rol, con candado si están apagados), selector de marca y local, y modo oscuro;
  - inicio y una ficha por módulo con las pantallas de la spec.
- **Pruebas:** 12, sobre empresa por dominio, ingreso, bloqueo, token de otra empresa, alcance de la vendedora, RLS, bitácora y eventos.

## Verificado
- `php artisan test`: 12 pasan.
- `npm run typecheck` y `npm run lint` sin errores.
- En el navegador:
  - la gerente ve los 40 módulos;
  - la vendedora de las marcas 2 y 3 ve solo esas marcas y sus 13 módulos, con TEL apagado;
  - a 375 px no hay desborde horizontal.

## Hallazgo en el prototipo
Dos usuarios comparten id y correo: `us-dflores` / `dflores@donguando.pe` (Diana Flores, VENDEDORA, y Diego Flores, COMPRAS). El seeder le da al segundo `dflores.compras@donguando.pe`.

## Pendiente
- **SEG:** segundo factor (decidir entre TOTP, como pide la spec, y código por correo, como en erp-saas), registro en `access_log`, sesiones por dispositivo y recuperación de contraseña.
- **INT:** despachar `domain_events` a los suscriptores y al outbox.
- **Base de datos:** funciones y restricciones de negocio de la spec, y FK que aseguren el mismo tenant.
- **Despliegue:** Nginx debe fijar `X-Tenant-Host` con el Host real; no se puede confiar en el que envía el navegador.
