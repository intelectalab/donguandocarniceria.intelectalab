# Qué instalar para desarrollar en Aycha · Don Guando

Son las versiones con las que está armado y probado el proyecto.

| Herramienta | Versión | Para qué |
|---|---|---|
| **Git** (Git para Windows) | reciente | Clonar el repo y trabajar con ramas y pull requests. Obligatorio aunque usen GitHub Desktop (ver abajo) |
| **Docker Desktop** | 4.x o más (en Windows, con WSL 2 activado) | Levanta PostgreSQL 17 y Redis 8. No hace falta instalar PostgreSQL aparte |
| **PHP** | **8.4** | La API (Laravel 12) |
| **Composer** | 2.x | Dependencias de PHP |
| **Node.js** | **24 LTS** (incluye npm) | La web (Next.js 16) |
| **Python** | 3.11 o más (opcional) | Solo para los scripts de `tools/prototipo` (generar tablas, recalcular sprints) |

## ¿Git o GitHub Desktop?

Los dos, si quieren. **Git es obligatorio:** GitHub Desktop trae su propio Git, pero solo lo usa él; no queda disponible en la terminal ni en VS Code, y Composer también lo necesita. Git para Windows trae además *Git Bash*, una terminal cómoda para los comandos del README. **GitHub Desktop es opcional,** como interfaz visual encima para hacer commits, ver cambios y cambiar de rama.

## Cómo instalar PHP y Composer (Windows)

PHP se instala en cada computadora: Docker solo levanta la base de datos y Redis. La API corre con el PHP de cada uno (`php artisan serve`). La forma que usamos en el equipo:

1. **XAMPP con PHP 8.4.** Instalarlo en `C:\xampp`. Solo se usa su PHP: Apache y MySQL no hacen falta y no se encienden. Si su versión de XAMPP trae un PHP más antiguo, hay que actualizarlo a 8.4.
2. **Agregar `C:\xampp\php` al PATH de Windows,** para que `php` funcione en cualquier terminal.
3. **Activar las extensiones** en `C:\xampp\php\php.ini`: buscar cada línea y quitarle el `;` del inicio. XAMPP trae **`pdo_pgsql` y `pgsql` desactivadas**, y sin ellas la API no se conecta a PostgreSQL:
   ```ini
   extension=pdo_pgsql
   extension=pgsql
   extension=intl
   extension=zip
   ```
   (`curl`, `fileinfo`, `mbstring` y `openssl` suelen venir activas; revisarlas igual).
4. **Instalar Composer** con su instalador oficial para Windows (*Composer-Setup.exe*, de getcomposer.org). Durante la instalación detecta `C:\xampp\php\php.exe`.
5. **Cerrar y abrir la terminal,** y comprobar: `php -v` debe decir 8.4 y `php -m` debe listar `pdo_pgsql` y `pgsql`.

## Extensiones de PHP

Deben estar activas en `php.ini`: `pdo_pgsql`, `pgsql`, `mbstring`, `openssl`, `fileinfo`, `zip`, `curl`, `intl`, `dom`, `xml` y `zlib`.

La más común de olvidar es **`pdo_pgsql`**: sin ella la API no se conecta a la base. Para ver las activas:

```bash
php -m
```

## Editor y herramientas recomendadas

- **VS Code**, con las extensiones *PHP Intelephense*, *ESLint* y *Tailwind CSS IntelliSense*.
- Para mirar la base de datos (opcional): **DBeaver** o **TablePlus**, conectando a `127.0.0.1:5433`, base `aycha`.

## Comprobar que todo está instalado

Cada comando debe mostrar una versión:

```bash
git --version
```
```bash
docker --version
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

## Después

1. Preparar el proyecto con [primeros-pasos.md](primeros-pasos.md): clonar, Docker, `composer install`, migrar y sembrar la base, y luego la API (puerto 8010) y la web (puerto 3010).
2. Leer `docs/como-construir-un-modulo.md` antes de empezar su módulo.
3. Ver su parte en `docs/plan-de-sprints.md`.
