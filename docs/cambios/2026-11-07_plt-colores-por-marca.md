# 07/11/2026 · PLT-06 Colores por marca

## Pantalla
- Pestañas: la empresa y cada marca. Una marca sin colores propios avisa que usa los de la empresa, y al editarla parte de ellos con el color principal de la marca.
- Modo claro y modo oscuro: los 7 colores (primario, primario oscuro, acento, fondo, superficie, texto y texto sobre primario) con selector y código #RRGGBB, y una vista previa de la barra, los botones, una tabla y un comprobante.
- Contraste calculado mientras se edita: texto sobre fondo, texto sobre superficie y texto sobre primario, en los dos modos. Mínimo `plt_ui_min_contrast_ratio` (4.5:1, WCAG AA). «Guardar colores» no se habilita si algún par no se lee bien.
- Versiones: cada vez que se guarda queda una versión nueva activa y la anterior pasa a «Anterior». «Usar los de la empresa» quita los colores propios de una marca.
- Guardar pide el permiso `plt.theme.manage` (gerencia y sistemas).

## Reglas (`App\Modulos\Plt\Services\Temas`)
- Cada color es #RRGGBB y cada par de texto llega al contraste mínimo (RN-PLT-15). El cálculo es el de WCAG 2.x, igual en la API y en la pantalla.
- Un solo tema activo por marca (y uno para la empresa). Una marca sin tema propio usa el de la empresa: `Temas::vigente($brandId)` (RN-PLT-23).
- Cada cambio emite `theme.changed`.

## API
`GET /v1/plt/temas` (`?brand_id=`), `POST /v1/plt/temas`, `POST /v1/plt/temas/quitar`.

## Pendiente
Que el sistema se pinte con los colores de la marca elegida en el selector de arriba (PLT-01). Hoy la aplicación usa la paleta fija de Don Guando de `globals.css`; los colores guardados aquí ya están listos para eso con `Temas::vigente()`.

## Pruebas
`tests/Feature/Modulos/PltTemasTest.php`: contraste WCAG, marca sin tema usa el de la empresa, colores mal escritos o que no se leen, versiones y quitar el tema propio, y permisos. 67 pruebas en total.
