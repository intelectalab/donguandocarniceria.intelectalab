# Filtros en la barra de la tabla (consola e Integraciones)

**Problema:** varias pantallas tenían los filtros sueltos encima de la tabla, con otro tamaño y otro texto vacío. Tampoco usaban la barra de la tabla que ya trae el sistema, como en Trabajadores.

**Cambio:**
- **Componentes nuevos** en `components/ui/Filtro.tsx`:
  - `FiltroSelect`: compacto, con su nombre en el texto vacío («Estado: todos», «Empresa: todas»);
  - `FiltroFecha`: fecha o mes; con `visible` muestra la etiqueta delante, para rangos «Desde» y «Hasta».
- **Dónde van:** en el `toolbar` del `DataTable`, a la derecha del buscador (`search`). En el celular quedan de dos en dos.

**Pantallas pasadas a este diseño:**
- **Consola:** Bitácora, Tickets, Facturación, Cobros, Accesos de soporte, Anuncios, Incidentes, Registros, Complementos y Planes (en la vista de tabla). Empresas y Suscripciones ya usaban la barra; ahora también usan el filtro común.
- **Integraciones:** Conectores, Credenciales, Mensajes salientes y sus eventos, y Bitácora de webhooks.

Parámetros de plataforma no cambió porque no es una tabla: son tarjetas agrupadas con su buscador.

**Regla para las pantallas nuevas:** toda lista con filtros usa `<DataTable search={…} toolbar={<FiltroSelect … />} />`. Nunca filtros sueltos encima de la tabla.

Revisado en el navegador (1440 y 375 px) contra `aycha_test`, sin errores en la consola.
