# 05/11/2026 · Componentes compartidos y PLT: Empresas y Locales

## Componentes compartidos (web)
En `apps/web/src/components/ui`, para que todas las pantallas se vean y se comporten igual:
- **`DataTable`**: búsqueda, orden por columna, estados de carga, error y vacío, columnas que se ocultan en celular. El paginador tiene el diseño de erp-saas: «Mostrando 1 a 25 de 31», filas por página (10, 25, 50, 100) y páginas numeradas con primera y última.
- **`MapPicker`**: mapa con las calles de OpenStreetMap (Leaflet, como en erp-saas). Un clic pone el pin y se arrastra para ajustarlo; muestra los demás puntos como referencia. Si el mapa no carga, lo dice y la ubicación se escribe a mano. **`MapView`**: el mismo mapa, de solo lectura, con varios pines etiquetados.
- **Formularios**: `Field` con etiqueta, ayuda y error, más `Input` (con prefijo o sufijo), `Select`, `Textarea`, `Checkbox` y `Switch`.
- **`Modal`**: panel que entra por la derecha, de alto completo (en celular ocupa toda la pantalla). Escape y clic afuera cierran (salvo mientras se guarda) y el foco no sale del panel. Las confirmaciones son un diálogo centrado (`placement="center"`).
- **`confirmAction`** con motivo opcional y **`toast`**: se llaman desde cualquier pantalla; `UiHost` está montado en el armazón.
- **`Button`**, `PageHeader`, `Tabs`, `Alert`, `Badge`, `StatusBadge` y `DetailList`.
- **`useListado`** (`src/lib/useListado.ts`): lista paginada de la API con búsqueda que espera a que se deje de escribir.
- **`src/lib/formato.ts`**: soles, kg, porcentajes y fechas en hora de Lima. `api.ts` suma `mensajeDe` y `erroresDe`.
- **Muestra en `/componentes`** (solo en desarrollo), con datos reales de las notificaciones.

## Listas en la API
`App\Support\Listado`: el mismo contrato para todas las listas (`?q=`, `?sort=`, `?page=`, `?per_page=` hasta 100). Las notificaciones ya lo usan y aceptan `?unread=1`.

## PLT-03 Empresas
- Tarjeta por empresa con RUC, régimen, domicilio fiscal y distrito; cuántas marcas (y activas), locales (con sus nombres) y series (y electrónicas) tiene; y sus marcas con su color.
- Crear y editar (permiso `plt.company.manage`): el RUC se valida mientras se escribe y en la API (RN-PLT-13: 11 dígitos, prefijo y dígito verificador módulo 11) y no se repite en la empresa cliente.
- `App\Modulos\Plt\Services\Ruc` queda para CLI y COM.

## PLT-04 Locales
- Tabla con búsqueda y filtros por empresa, tipo y estado.
- Crear y editar (permiso `plt.establishment.manage`): código interno único de 1 a 6 caracteres y código anexo SUNAT de 4 dígitos único por empresa (RN-PLT-04). Una empresa de otro cliente no existe para el formulario (RLS).
- Ubigeo con sugerencias de distritos (`GET /v1/plt/ubigeo?q=`).
- Mapa en el formulario para fijar la ubicación del local, con los demás locales como referencia.
- Mapa con todos los locales (un clic en un pin abre el local) y columnas de pin, almacenes y zonas de reparto de cada local.

## Base de datos
Migración `2026_11_05_100000_plt_unicos_de_empresas_y_locales`: RUC único por empresa cliente y código anexo único por empresa. Solo agrega índices: basta con `php artisan migrate --database=pgsql_owner`.

## Verificado
- `php artisan test`: pasan las pruebas nuevas (`ListadoTest`, `PltTest`) junto con las anteriores.
- `npm run typecheck` y `npm run lint` sin errores.
- En el navegador: tabla, formulario, ventana, confirmación con motivo, avisos, y las dos pantallas en escritorio y a 375 px.

## Pendiente
- El catálogo de ubigeo de demo tiene 123 distritos; el oficial del INEI se carga desde MAE-08.
