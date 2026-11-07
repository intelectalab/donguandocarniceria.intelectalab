# 07/11/2026 · PLT-01 Armazón de la aplicación

El armazón (barra, menú, selectores, campana, modo de color y colores de la marca) ya funcionaba en todas las pantallas. Esta es su pantalla propia:

- Cifras: módulos en tu menú, módulos apagados, marcas y locales de tu alcance y notificaciones sin leer.
- Vista previa del armazón con los colores de la marca elegida (o de la marca de tu usuario), sacados de PLT-06.
- Tus preferencias: marca y local (solo los de tu alcance) y modo de color (claro, oscuro o el del sistema), guardado en el navegador como el botón de la barra.
- Tus notificaciones recientes, con «Abrir», «Marcar leída» y «Marcar todas como leídas».
- Módulos y tu acceso: cada módulo con su grupo, si está encendido, lo que tu rol puede hacer (crear, ver, editar, aprobar) y si sale en tu menú. Sin fases.
- Los textos de las notificaciones se muestran sin los códigos del prototipo.

Sin cambios en la API: usa `/v1/me`, `/v1/me/notifications` y `/v1/plt/modulos`.
