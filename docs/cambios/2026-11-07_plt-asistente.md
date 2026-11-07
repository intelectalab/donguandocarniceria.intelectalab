# 07/11/2026 · PLT-14 Asistente de configuración inicial

## Qué hace
Lista guiada para poner en marcha al cliente, en 8 pasos: datos de la empresa; marcas, colores y logo; locales; centros de costo (uno por área); series; usuarios iniciales; medios de pago; módulos. Muestra el avance (por ejemplo 91 %, 32 de 35 comprobaciones) y, en cada paso, qué está listo, qué falta con su detalle y el enlace a la pantalla donde se completa.

No guarda nada: cada comprobación se marca sola cuando el dato existe y es válido (`App\Modulos\Plt\Services\Asistente`). «Volver a revisar» la recalcula.

## Diferencias con el prototipo
- Sin la comprobación del segundo factor en administrador y gerencia: el segundo factor está pendiente por decisión del equipo.
- Sin el botón «Probar seed_plataforma», que era una ayuda de prueba del prototipo.
- Se agregó «Logo general del cliente» en el paso de marcas y colores.
- Revisa todas las empresas (RUC) activas o en preparación, no solo la primera.

## API
`GET /v1/plt/asistente` (solo lectura; todo pasa por RLS).

## Pruebas
`tests/Feature/Modulos/PltAsistenteTest.php`: pasos con los datos del cliente (NI09 sobre el 95 %, logo pendiente) y una comprobación que se marca sola al completar el dato. 83 pruebas en total.

Con esto están las 14 pantallas de Plataforma.
