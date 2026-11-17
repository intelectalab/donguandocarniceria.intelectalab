# 16/11/2026 · CLI Clientes, direcciones con pin y zonas de reparto (CLI-01 a CLI-12)

## Base de datos
Migración `2026_11_16_000100_cli_restricciones_y_enlaces.php`:
- `customers`: dirección fiscal, condición del contribuyente, estado de la validación del documento, desbloqueo (fecha y nota) y origen del consentimiento.
- Restricciones CHECK de estados y tipos (cliente, dirección, zona, duplicado), montos de zona, par de duplicados distinto y pin dentro del Perú.
- Índices únicos: un documento por cliente no fusionado (`customers_documento_unico`) y una sola dirección predeterminada activa por cliente.
- Tabla `customer_location_links` (enlace de ubicación de un solo uso, se guarda solo el hash del token) con RLS y la función `cli_link_tenant()` para abrirlo sin sesión.

Después de `git pull`: `php artisan migrate --database=pgsql_owner`.

## Pantallas
- **CLI-01 Clientes:** cifras del mes (activos, nuevos, recurrentes, duplicados, bloqueados), pestañas, filtros por tipo, marca de la última compra, zona, estado y vendedora, búsqueda por celular escrito de cualquier forma, exportación a Excel (queda en la bitácora).
- **CLI-02 Ficha del cliente:** datos, documento, consentimiento de publicidad (Ley 29733) con su historial, saldo a favor, por cobrar, pedidos por marca y canal, alertas (fusionado, bloqueado, duplicado, sin pin) y pestañas de pedidos, comprobantes, direcciones y por cobrar. Bloquear y desbloquear con motivo (RN-CLI-09).
- **CLI-03 Alta rápida:** celular, nombre, tipo y canal. Mientras se escribe el celular avisa si ya existe y abre ese cliente en vez de crear otro (CA-CLI-01). Lista de altas de los últimos 7 días.
- **CLI-04 Validar documento:** consulta DNI (RENIEC) o RUC (SUNAT) con el adaptador de prueba, muestra la respuesta y la guarda con fuente y fecha (RN-CLI-12). Validación manual con nota para supervisora y gerente. Lista de documentos sin validar y últimas consultas.
- **CLI-05 Direcciones:** las del cliente con zona, pin, quién recibe y último uso; cifras de pins confirmados del mes (KPI-CLI-04), por confirmar y fuera de cobertura; lista de toda la base por revisar.
- **CLI-06 Mapa de la dirección:** pin en el mapa, búsqueda por texto, GPS o coordenadas pegadas; referencia obligatoria de 10 caracteres (RN-CLI-02); pin dentro del Perú (RN-CLI-04); búsqueda por texto con poca confianza obliga a mover el pin (RN-CLI-05); muestra la zona y tarifa mientras se mueve.
- **CLI-07 Enlace de ubicación:** genera un enlace de 24 horas y un solo uso, con botón para mandarlo por WhatsApp. El cliente lo abre sin cuenta en `/u/{token}`, marca su pin o usa el GPS y la dirección queda guardada; se avisa a su vendedora.
- **CLI-08 Zonas de reparto:** mapa con las zonas, tabla y formulario (local, tarifa, mínimo, gratis desde unidades, kg o monto, prioridad, distritos, provincia). El polígono se dibuja con clics en el mapa.
- **CLI-09 Simulador:** pin, distrito o zona más un carrito; muestra la zona, el local, la tarifa, si llega al gratis y si está bajo el mínimo.
- **CLI-10 Duplicados:** pares con motivo y puntaje, fusionar o descartar con motivo, buscar en toda la base (RN-CLI-07).
- **CLI-11 Fusión:** elegir quién sobrevive, ver todo lo que se moverá y el motivo; no se deshace (RN-CLI-08). Historial de fusiones.
- **CLI-12 Importar:** pegar o subir CSV (nombre; celular; correo; documento; distrito), revisar y decidir fila por fila. Mismo documento se omite siempre (RN-CLI-11). Las direcciones no se importan.

## Servicios para otros módulos (`app/Modulos/Cli/Services`)
- `Clientes::altaRapida($datos, $usuario)`: crea o devuelve el cliente de ese celular (PED, CRM).
- `Clientes::buscarPorCelular($texto)`: encuentra al cliente aunque el número venga con espacios, +51 o guiones.
- `Clientes::puedeComprar($cliente)`: falso si está bloqueado o fusionado (RN-CLI-09).
- `Zonas::para($lat, $lng, $distrito)`: zona del pin (primero polígono por prioridad, después distrito).
- `Zonas::tarifa([...])`: tarifa de delivery, gratis y pedido mínimo para un pin y un carrito (PED, WEB).

## Pruebas
22 pruebas en `tests/Feature/Modulos/Cli*Test.php` (clientes, documentos, direcciones, enlaces, zonas, duplicados e importación).

## Verificado
- Pruebas CLI de la API pasan; `npm run typecheck` y `eslint` sin errores.
- En el navegador como gerente: las 12 pantallas cargan sin errores; se probó de punta a punta alta rápida, validar DNI, generar el enlace y abrirlo desde un celular sin sesión hasta guardar la dirección.

## Pendiente
- Proveedores reales de RENIEC/SUNAT y de mapas (hoy son adaptadores de prueba).
