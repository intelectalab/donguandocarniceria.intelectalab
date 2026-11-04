# NOTAS · DES

- Seeds: 42.5 (productos de pollo y pato, 8 plantillas y precios de referencia; antes de que PRO 43 use `ct-CER-1`, `ct-CUY-1`, `ct-COR-1` y `ct-CON-1`) y 44 (6 despieces de pollo cerrados y una orden liberada para hoy).
- Sobre PRO: DES registra con `G.pro.consume` / `G.pro.output` / `G.pro.close`. `G.des.close` exige `des.mass_balance.override` antes de llamar a PRO (RN-DES-04).
- Respaldo por PRO: `G.pro.close` solo fija `lots.unit_cost`. DES escucha `production_order.closed` y revaloriza el saldo de cada lote con dos `ADJUSTMENT` (sale a costo provisional y entra a costo conjunto final).
- Respaldo de datos: los cortes de cordero que crea PRO (`pr-COR-PAL`, `pr-COR-CUE`) llegan sin registro sanitario. El seed de DES los completa para que no se caiga el seed de CAL.
- Fuera de DES: con CAT en el build, el seed de CAL se cae con `pr-PATE` (CAT lo crea con `sanitary_registry_expires: null`). Por ese error de consola, `test.js` marca como fallidas todas las pruebas de este build. Sin CAT, las 5 pruebas de DES pasan.
