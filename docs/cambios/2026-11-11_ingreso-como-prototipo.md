# Ingreso · panel nuevo (11/11/2026)

El ingreso, «Olvidé mi contraseña» y «Nueva contraseña» usan el mismo armazón (`components/auth/AuthShell.tsx`). El panel se rediseñó con el texto del sistema; ya no copia el diseño del prototipo.

## Panel de la izquierda
- **Fondo:** el color de la empresa (sin empresa, el vino de Aycha) en degradado: más claro arriba y profundo abajo.
  - Encima: un brillo dorado arriba a la derecha y uno rosado abajo a la izquierda, dos luces difusas y una trama de puntos suave que se desvanece hacia los bordes.
  - Arriba, la franja de siempre.
  - Se quitó el anillo de adorno del prototipo: quedaba cortado contra el borde.
- **Sello:** el logo de la empresa en un recuadro blanco o, sin logo, sus iniciales en un círculo dorado con brillo.
- **Nombre y subtítulo:** el nombre en grande y, con una línea dorada delante, el subtítulo «Ventas, reparto, producción y facturación».
- **Frase:** termina en «Pedidos de WhatsApp, web y mostrador, despiece con costo real, cadena de frío, reparto y comprobantes electrónicos en un solo lugar.». Antes de eso dice:
  - En el ingreso general: «El sistema para empresas cárnicas: carnicerías, avícolas, distribuidoras y plantas de proceso.».
  - Con empresa: «{Empresa} y sus N marcas.» o, con una sola marca, «Todo {Empresa}, en orden.».
- **Tarjetas:** los tres puntos van como tarjetas translúcidas, cada una con su ícono: «Ningún pedido se confirma sin dirección con pin», «Peso real, lote y vencimiento en cada venta» y «Cada empresa ve solo sus datos». En pantallas anchas van en tres columnas.
- **Marcas** de la empresa y, abajo, «Aycha by Intelectalab», con el nombre de la empresa si hay una, y el año.
- **Tamaño:** en escritorio, el contenido va centrado en el alto del panel. La letra y el ancho crecen con la pantalla (probado en 1366 y 1920, en modo claro y oscuro).
- **En celular:** el panel es una franja arriba con el sello, el nombre y el subtítulo.

## A la derecha
- El formulario va en una tarjeta, con un brillo suave del color de la marca detrás. El logo ya no se repite arriba del formulario: está en el panel.
- Los textos pasan a tú:
  - Ingreso: «Hola de nuevo. Ingresa con el correo que te registró tu empresa.» y «¿Olvidaste tu contraseña?». La etiqueta «Usuario (correo)» queda como «Correo».
  - Olvidé mi contraseña: «Escribe tu correo y te enviaremos un código para crear una nueva.».
  - Nueva contraseña: «Escribe el código que te llegó al correo y tu nueva contraseña.».
