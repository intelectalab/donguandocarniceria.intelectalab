# Primeros pasos: del clon al sistema funcionando

Para preparar el proyecto en una computadora nueva (Windows). Se hace una sola vez; el trabajo de cada día está al final.

## 0. Antes de empezar
Tener instalado lo de [requisitos-de-instalacion.md](requisitos-de-instalacion.md): Git, GitHub Desktop (opcional), Docker Desktop, PHP 8.4 con `pdo_pgsql`, Composer y Node 24. Cada comando debe mostrar una versión:

```bash
git --version
```
```bash
php -v
```
```bash
composer --version
```
```bash
node -v
```
```bash
docker --version
```

## 1. Clonar el repositorio con GitHub Desktop
1. Abrir GitHub Desktop e iniciar sesión con la cuenta de GitHub (**File → Options → Accounts**). La cuenta debe estar agregada como colaboradora del repositorio.
2. **File → Clone repository → GitHub.com** y elegir el repositorio del proyecto.
3. En **Local path**, una ruta corta, por ejemplo `C:\proyectos\aycha`.
4. **Clone**.
5. **Repository → Open in Visual Studio Code**, y abrir una terminal con **Terminal → New Terminal**.

Con Git en la terminal es lo mismo: `git clone <url-del-repositorio>`.

## 2. Levantar la base de datos y Redis
Con Docker Desktop **abierto**, desde la raíz del proyecto:

```bash
docker compose up -d postgres redis
```

La primera vez descarga las imágenes y tarda unos minutos. En Docker Desktop deben aparecer `aycha_postgres` y `aycha_redis` encendidos.

## 3. Preparar la API (Laravel)

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

El último comando crea las tablas y carga los datos de demo; tarda menos de un minuto. Luego, levantar la API (la terminal queda ocupada y debe seguir abierta):

```bash
php artisan serve --port=8010
```

## 4. Preparar la web (Next.js)
En **otra terminal** (botón **+** de la terminal de VS Code), desde la raíz:

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

## 5. Comprobar
- Abrir **http://localhost:3010** e ingresar con `rquispe@donguando.pe` (gerente) y la contraseña `SEED_PASSWORD` del `.env` de la API. Los demás usuarios de demo están en el [README](../README.md).
- Correr las pruebas de la API (en `apps/api`); deben pasar todas:

```bash
php artisan test
```

## 6. Ver la base de datos (opcional)
Con DBeaver, TablePlus u otro cliente de PostgreSQL:

| Campo | Valor |
|---|---|
| Host | `127.0.0.1` |
| Puerto | `5433` (no el 5432 por defecto) |
| Usuario | `aycha_owner` |
| Contraseña | la de `DB_OWNER_PASSWORD` en el `.env` de la API |
| Base | `aycha` |

Con `aycha_owner` se ven los datos de todas las empresas. El usuario de la app (`aycha_app`) muestra las tablas vacías desde un cliente, porque el RLS solo deja ver filas cuando la API fija la empresa. Cada computadora tiene su propia base: lo que se cambie en ella no lo ve nadie más.

## El trabajo de cada día
1. Abrir Docker Desktop. Si los contenedores no arrancan solos: `docker compose up -d postgres redis`.
2. En GitHub Desktop: **Fetch origin → Pull**.
3. Si llegaron migraciones nuevas, en `apps/api`:
   ```bash
   php artisan migrate --database=pgsql_owner
   ```
4. Si cambiaron dependencias: `composer install` en `apps/api` o `npm install` en `apps/web`.
5. Levantar la API y la web (pasos 3 y 4, solo el último comando de cada uno).

`migrate:fresh` borra la base local y la vuelve a sembrar: usarlo solo cuando un cambio lo pida (se avisa en `docs/cambios/`).

## Problemas comunes
| Síntoma | Causa y solución |
|---|---|
| `could not find driver` al migrar | Falta `extension=pdo_pgsql` en `php.ini` |
| `Connection refused` en el puerto 5433 | Docker Desktop cerrado o el contenedor apagado |
| `EADDRINUSE :3010` | La web ya está corriendo en otra terminal; cerrar una de las dos |
| La web abre pero no carga datos | La API (puerto 8010) no está corriendo |
| `php` o `composer` «no se reconoce» | No están en el PATH; cerrar y abrir VS Code después de instalarlos |
| El contenedor no levanta por el puerto 5433 | Otro PostgreSQL usa ese puerto; cambiarlo solo en la copia local (`docker-compose.yml` y `.env`) sin subir el cambio |

## Después
1. Leer [como-construir-un-modulo.md](como-construir-un-modulo.md).
2. Ver la parte de cada uno en [plan-de-sprints.md](plan-de-sprints.md).
