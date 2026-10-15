# Cargas: panel de cargas abiertas, cargador obligatorio y reapertura sin duplicar

Fecha: 2026-10-15. Pedido por el usuario (Pedro, Taisa) tras un caso real: el 15/10 se cargaron
10 soportes de Marbella como «16:00» cuando el camión era el de las 22:00 y no había forma de
corregirlo desde la app; además se abrieron cargas duplicadas del mismo camión (19:00 y 17:30 ya
tenían carga cerrada).

## Qué se pide

1. **Pantalla principal con las cargas activas.** En la vista del muelle (`?vista=operario`, paso 1)
   se ve qué cargas están abiertas y cuáles se pueden reabrir.
2. **Cargador obligatorio.** Para abrir (o reabrir) una carga hay que indicar quién la realiza,
   eligiendo de la lista de personas de la app Cargas/Descargas Plataforma Málaga.
3. **Reabrir una carga cerrada** para añadir o quitar mercancía, **sin crear otra igual**. Se puede
   hasta la hora y día de llegada (`fecha_entrega` + `horario`); pasada esa hora ya no se modifica.
4. (Dato de hoy, hecho aparte a mano) pasar los 10 soportes de Marbella 16:00 a Marbella 22:00.

## Reglas

- **Un camión = una carga.** Un camión se identifica por `destino + fecha_entrega + horario`.
  `obtenerOCrearCarga` busca cualquier carga con esa terna (antes solo miraba las abiertas, por eso
  se podía cargar varias veces el mismo camión):
  - abierta → se continúa;
  - cerrada y aún no ha llegado → se pide confirmación y se reabre;
  - cerrada y ya llegó → no se puede modificar ni crear otra (aviso);
  - no existe → se crea.
  Con duplicados antiguos de la misma terna manda la abierta más reciente y, si no hay, la cerrada más reciente.
- **Hora de llegada** = `fecha_entrega` + `horario` en hora de Madrid. Si el horario no es una hora
  («Envío único diario», Granada) se cuenta hasta el final de ese día.
- **Cargador**: 1 o 2 personas de la lista (4 principales + 26 auxiliares de Cargas/Descargas, copiadas en
  `Utilidades.gs`; si allí cambia la lista hay que actualizarla aquí). Se guarda en `cargas.cargador`
  como texto «A, B»; cada vez que alguien abre o reabre se añade a los ya anotados (sin repetir).
  El servidor rechaza una apertura sin cargador o con un nombre que no esté en la lista.
- **Cerrar de nuevo una carga reabierta** manda otro informe: asunto «ACTUALIZADO», con una franja
  «Informe actualizado tras reabrir la carga» y el cargador en la cabecera.
- **B2B de Leroy Merlin (palets SIE)**: `actualizarB2BSIE_` suma a las celdas de sección. Para no contar
  dos veces al cerrar otra vez, se guarda en `cargas.b2b_conteo` lo que se aplicó en el último cierre
  y al volver a cerrar solo se aplica la diferencia (puede ser negativa si se quitan palets). Al reabrir
  una carga antigua sin `b2b_conteo`, se calcula a partir de sus palets ya cotejados.
- **Panel**: abiertas con llegada desde ayer, y cerradas con llegada futura (reabribles). Cada tarjeta
  lleva tienda, fecha y horario, nº de soportes y palets, cargador y estado. Pulsar una tarjeta rellena
  tienda/fecha/horario del formulario (el flujo de abrir es uno solo). Se refresca al entrar, al volver
  al paso 1 y con un botón; sin sondeo periódico (egress de Supabase).
- La llegada cruzada desde Carta de Portes SIE (`?vista=operario&tienda=…&fecha=…&horario=…`) ya no
  abre la carga sola: rellena el formulario y espera a que se elija el cargador.
- Sin diálogos nativos (`alert/confirm/prompt`): en el flujo de abrir carga se sustituyen por los modales propios.

## Datos (migración que ejecuta el usuario en Supabase)

`docs/migraciones/2026-10-15-cargas-cargador-reapertura.sql`: columnas nuevas y nulables en `public.cargas`:
`cargador text`, `reabierta_por text`, `reabierta_en timestamptz`, `b2b_conteo jsonb`.
Hay que aplicarla **antes** de desplegar el código (la apertura escribe `cargador`).

## Ajustes respecto al diseño inicial (al terminar la pantalla, 2026-10-15)

- `reabrirCarga` **no** deja la carga en el caché de «carga abierta» (`cachearCargaAbierta_` solo lo escribe
  `crearCarga` y solo lo borra `cerrarCarga`): un segundo escritor podría dejarlo en ABIERTA tras un cierre
  simultáneo desde otro móvil. Sin caché, `escanearSoporte` lee la carga en fresco (una lectura más por escaneo,
  solo en cargas reabiertas).
- Continuar una carga abierta con las mismas personas ya anotadas no escribe en la base.
- Dos enlaces para moverse sin recargar la página: «← Cargas activas» (desde el escaneo; **no** cierra la carga)
  y «Volver al inicio» (tras cerrar; vacía quién carga). La selección de cargadores se conserva mientras la
  página siga abierta y nunca se guarda en el navegador: cada persona se identifica al abrir.
- «Abrir carga» se bloquea mientras se espera al servidor (una doble pulsación no lanza dos aperturas).
- `mostrarConfirmacion_` acepta el texto del botón («Reabrir»); los avisos de «quitar soporte/palet» usan el
  cuadro propio en vez de `alert()`. Quedan `alert()/confirm()` heredados en pestañas de administración
  (imprimir, borrar, agrupar…), fuera de este alcance.
- `Pruebas.gs`: la prueba de `obtenerOCrearCarga` usa un horario propio en cada ejecución (un camión = una carga
  para siempre) y comprueba también el caso «cerrada».
- Coste de lectura del panel: 1 consulta de `cargas` + 1-2 de recuento (`etiquetas`, `palets`) por cada 40 cargas;
  solo baja la columna `batea_id`. Sin sondeo periódico.

## Fuera de alcance

- Borrar cargas, o forzar nombres de usuario por login (la cuenta de Google del muelle es compartida).
- Atribuir cada soporte escaneado a una persona (solo se anota a nivel de carga).
- Un índice único en base de datos para `destino+fecha+horario` (hay duplicados históricos).
