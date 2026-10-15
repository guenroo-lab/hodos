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
5. **Cargas huérfanas y pendientes** (pedido después de ver el panel, el mismo día): la pantalla no mezcla abiertas,
   cerradas y huérfanas; las cargas que se quedan sin terminar se pueden gestionar (cerrar o descartar) y hay una regla
   clara de cuándo desaparecen (ver «Cuándo desaparece una carga de la pantalla»).

## Reglas

- **Un camión = una carga.** Un camión se identifica por `destino + fecha_entrega + horario`.
  `obtenerOCrearCarga` busca cualquier carga con esa terna (antes solo miraba las abiertas, por eso
  se podía cargar varias veces el mismo camión):
  - abierta → se continúa;
  - cerrada y aún no ha llegado → se pide confirmación y se reabre;
  - cerrada y ya llegó → no se puede modificar ni crear otra (aviso);
  - no existe → se crea.
  Con cargas repetidas del mismo camión (herencia de cuando solo se buscaban las abiertas: salieron de abrir
  la pantalla otra vez con la carga ya cerrada) manda la que **lleva mercancía** (soportes + palets); a
  igualdad, la abierta; a igualdad, la más reciente. El panel enseña solo esa carga y `obtenerOCrearCarga`
  abre esa; las repetidas vacías quedan sin tocar en la base (ni se ven ni se continúan). Caso real del
  15/10 en Marbella: 19:00 = cerrada con 6 soportes y 13 palets (manda) + una abierta vacía; 17:30 =
  cerrada con 16 palets + una abierta vacía; 22:00 = abierta con 10 soportes + una cerrada vacía.
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
- **Panel: tres listas que NO se mezclan** (`listarCargasPanel` devuelve `{abiertas, cerradas, porRevisar}`; el
  reparto es `clasificarCargasPanel_`, en `Utilidades.gs`). Arriba, siempre visible, solo **Cargas abiertas**; debajo
  dos barras plegables, «Cerradas (n)» y «Por revisar (n)», que no se muestran si están vacías y de las que solo
  se abre una a la vez. Cada tarjeta lleva tienda, fecha y horario, nº de soportes y palets, cargador y estado.
  Pulsar una abierta, una cerrada reabrible o «Abrir para cerrarla» rellena tienda/fecha/horario del formulario
  (el flujo de abrir es uno solo: hay que elegir quién carga). Se refresca al entrar, al volver al paso 1 y con un
  botón; sin sondeo periódico (egress de Supabase).
- **Un camión sale una sola vez** en el panel: la carga que manda (`elegirCargaExistente_`). Las demás ABIERTAS
  de ese camión van a «Por revisar» como repetidas; las CERRADAS repetidas y las DESCARTADAS no se muestran.
- La llegada cruzada desde Carta de Portes SIE (`?vista=operario&tienda=…&fecha=…&horario=…`) ya no
  abre la carga sola: rellena el formulario y espera a que se elija el cargador.
- Sin diálogos nativos (`alert/confirm/prompt`): en el flujo de abrir carga se sustituyen por los modales propios.

## Cuándo desaparece una carga de la pantalla

| Carga | Dónde se ve | Cuándo desaparece |
|---|---|---|
| Abierta, camión aún sin llegar | Cargas abiertas | Al cerrarla (pasa a «Cerradas») |
| Abierta y el camión ya llegó | Por revisar · «llegó el camión» | Al cerrarla («Abrir para cerrarla», con mercancía) o al descartarla (vacía). Si nadie la toca sigue ahí hasta 7 días después de su entrega |
| Abierta y repetida (otra del mismo camión manda) | Por revisar · «repetida» | Al descartarla (vacía). Con mercancía no tiene botones: se avisa a administración |
| Cerrada con entrega hoy o más adelante | Cerradas | Al acabar su día de entrega (medianoche, Madrid). Reabrible hasta la hora de llegada; después, «solo consulta» |
| Cerrada de un día anterior | — | Ya no sale |
| Descartada | — | No sale ni cuenta como la carga del camión (se puede abrir otra) |

La ventana de lectura es `DIAS_REVISION_CARGAS_` = 7 días hacia atrás (`fecha_entrega >= hoy − 7`), con solo las columnas
que pinta el panel. Una carga abierta que lleve más de 7 días sin cerrar deja de verse en la pantalla (sigue en la base).

**Descartar** (`descartarCarga(idCarga)`, botón rojo con confirmación en «Por revisar»): solo una carga ABIERTA y VACÍA
(0 soportes y 0 palets); con mercancía hay que abrirla y cerrarla para que salga su informe. No envía informe. Queda en
`cargas` con `estado = 'DESCARTADA'`, `cerrada_por` = quién y `fecha_cierre` = cuándo. Se hace con un bloqueo y un
`PATCH` condicionado a `estado=eq.ABIERTA`; si un escaneo se cuela entre contar y descartar, se deshace.
`cargas.estado` es texto libre: no hace falta migración salvo que la base tuviera un `CHECK` sobre el estado.

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
- Coste de lectura del panel: 1 consulta de `cargas` (los últimos 7 días, solo las columnas del panel) + el
  recuento (`etiquetas`, `palets`; solo baja la columna `batea_id`, lotes de 40 ids) únicamente de lo que se ve y
  de las cargas repetidas. Sin sondeo periódico.
- Decisión entre cargas repetidas: ver «Reglas». `obtenerOCrearCarga` solo cuenta mercancía cuando el camión tiene
  más de una carga (lo normal es una y no cuesta ninguna lectura más).

## Fuera de alcance

- Borrar cargas de la base (las descartadas solo quedan marcadas), unir dos cargas repetidas con mercancía, o forzar
  nombres de usuario por login (la cuenta de Google del muelle es compartida).
- Atribuir cada soporte escaneado a una persona (solo se anota a nivel de carga).
- Un índice único en base de datos para `destino+fecha+horario` (hay duplicados históricos).
