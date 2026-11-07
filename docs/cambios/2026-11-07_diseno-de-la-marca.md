# 07/11/2026 · Detalles de diseño con los colores de la marca

Sin cambiar la paleta (vino, granate, dorado, ámbar y crema de donguando.com), se agregan adornos que dan identidad a las pantallas. Todos están en `app/globals.css` y en los componentes compartidos: las pantallas los reciben solas.

- **Franja de colores** (`.franja`): triángulos en vino, dorado, rosa, ámbar y crema. Va arriba del menú lateral y del panel de ingreso, y al pie de la cifra destacada.
- **Encabezado de cada pantalla** (`PageHeader`): ahora es una banda con rombos escalonados muy tenues a la derecha (`.rombos`, del color primario, se desvanecen hacia la izquierda) y una línea de segmentos de colores abajo (`.linea-colores`). Funciona en claro y en oscuro.
- **Cifras** (`Cifra`): `icono` muestra un ícono en un cuadro de color suave (del color del tono si lo tiene), y `destacada` pinta la cifra principal con el degradado del menú. Una sola destacada por pantalla.

Los adornos son decorativos (`aria-hidden`) y no cambian el contraste del texto.
