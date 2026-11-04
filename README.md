# Aycha · Don Guando Comercial

SaaS comercial de Intelectalab para empresas de carnes y alimentos. Su piloto es AGROPECUARIA DON GUANDO SAC: 5 marcas, 2 locales, pedidos por WhatsApp y la web, reparto y producción.

| Carpeta | Qué es |
|---|---|
| `apps/api` | API en Laravel 12 / PHP 8.4 (Sanctum, PostgreSQL con RLS) |
| `apps/web` | Web en Next.js 16 / React 19 / Tailwind 4 |
| `infrastructure/` | Arranque de Postgres en Docker (usuarios y base de pruebas) |
| `docs/` | Revisión del prototipo, base de datos y guía para construir módulos |
| `tools/prototipo/` | Modelo de datos extraído del prototipo y generador de migraciones |
| `aycha-proto/` | Prototipo de referencia (HTML de demo). **No es código del sistema** |

## Levantar en local

Requisitos: Docker Desktop, PHP 8.4 (`pdo_pgsql`), Composer y Node 24. La lista completa, con extensiones y cómo comprobarlas, está en [docs/requisitos-de-instalacion.md](docs/requisitos-de-instalacion.md). Paso a paso, desde clonar el repositorio, en [docs/primeros-pasos.md](docs/primeros-pasos.md).

1. Base de datos y Redis:
   ```bash
   docker compose up -d postgres redis
   ```
2. API, la primera vez:
   ```bash
   cd apps/api
   ```
   ```bash
   composer install
   ```
   ```bash
   cp .env.example .env
   ```
   ```bash
   php artisan key:generate
   ```
   ```bash
   php artisan migrate:fresh --database=pgsql_owner --seed
   ```
3. Correr la API (puerto 8010):
   ```bash
   php artisan serve --port=8010
   ```
4. Web, en otra terminal (puerto 3010):
   ```bash
   cd apps/web
   ```
   ```bash
   npm install
   ```
   ```bash
   cp .env.example .env.local
   ```
   ```bash
   npm run dev
   ```
5. Abrir **http://localhost:3010**. El ingreso es general: la empresa sale del usuario que entra. Con la gerente de Carnes Selectas del Sur (la segunda empresa) se prueba el aislamiento.

   Para que cada empresa entre por su propio dominio (`donguando.localhost:3010`, `cs.localhost:3010`), pon `TENANT_POR_DOMINIO=true` en el `.env` de la API. Los dominios están en `tenant_hostnames`.

Los puertos (Postgres 5433, Redis 6380, API 8010, web 3010) no son los de por defecto, para no chocar con otros proyectos que corran en la misma máquina.

### Usuarios de demo (Don Guando)

Todos usan la contraseña `SEED_PASSWORD` del `.env` de la API.

| Rol | Correo |
|---|---|
| GERENTE | rquispe@donguando.pe |
| ADMIN_SISTEMA | lccahuana@donguando.pe |
| ADMINISTRACION | chuaman@donguando.pe |
| SUPERVISORA_VENTAS | pleon@donguando.pe |
| VENDEDORA (marca Don Guando) | ana.torres@donguando.pe |
| VENDEDORA (marcas 2 y 3) | cnunez@donguando.pe |
| CAJERO | jsalas@donguando.pe |
| ALMACENERO | irojas@donguando.pe |
| PREPARADOR | smamani@donguando.pe |
| COORDINADOR_DELIVERY | rchavez@donguando.pe |
| REPARTIDOR | hticona@donguando.pe |
| MARKETING | lparedes@donguando.pe |
| JEFE_PRODUCCION | olazo@donguando.pe |
| OPERARIO_PRODUCCION | npoma@donguando.pe |
| CALIDAD | sramos@donguando.pe |
| COMPRAS | dflores.compras@donguando.pe |
| CONTADORA | mcardenas@donguando.pe |
| PRACTICANTE_CONTABLE | khuerta@donguando.pe |
| VISITADOR_CONSIGNACION | mvilla@donguando.pe |
| RRHH | gsoto@donguando.pe |
| AUDITOR | aexterno@donguando.pe |
| CLIENTE_B2B | cocina@elcuydorado.pe |

En Carnes Selectas del Sur: `hsalas@carnesselectas.pe` (gerente) y `npinto@carnesselectas.pe` (vendedora).

## Pruebas

```bash
cd apps/api
```
```bash
php artisan test
```
Corren contra la base `aycha_test` de Postgres, porque RLS es parte de lo que se prueba.

```bash
cd apps/web
```
```bash
npm run typecheck
```
```bash
npm run lint
```

## Documentación
- [docs/primeros-pasos.md](docs/primeros-pasos.md): preparar el proyecto en una computadora nueva, desde clonar hasta entrar al sistema, y el trabajo de cada día.
- [docs/revision-del-prototipo.md](docs/revision-del-prototipo.md): alcance (40 módulos, 498 pantallas), reparto entre 3 personas y decisiones pendientes.
- [docs/plan-de-sprints.md](docs/plan-de-sprints.md): sprints por módulos para las 3 personas, con niveles de dependencia (1, 2 y 3) para que nadie se bloquee.
- [docs/como-construir-un-modulo.md](docs/como-construir-un-modulo.md): **empieza aquí** para trabajar en un módulo.
- [docs/base-de-datos.md](docs/base-de-datos.md): Docker, migraciones, RLS y bitácora.
- [docs/pendientes.md](docs/pendientes.md): lo que se dejó para después (consola de plataforma, datos globales, 2FA…).
