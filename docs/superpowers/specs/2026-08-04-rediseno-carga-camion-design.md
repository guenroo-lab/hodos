# HODOS — Rediseño de "Cargar camión" + fecha rápida + entrada manual + carga masiva oculta + informe sin copia en Drive

**Fecha:** 2026-08-04
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Depende de:** Fase 3 (carga de camión), ya en producción (v33). La mayor parte es una
capa nueva sobre `Index.html` que reutiliza funciones ya existentes (`escanearSoporte`,
`obtenerPendientesPorTienda`, `crearCarga`/`obtenerOCrearCarga`) — no toca esquema. La
sección de destinatarios/Drive del informe de cierre sí toca `Backend.gs` (`cerrarCarga`)
y `ConfigEntregas.gs`, sin cambios de esquema (la columna `pdf_url` de Supabase ya existe
y simplemente deja de rellenarse).

## Contexto

La pantalla "Cargar camión" (Paso 1: elegir tienda/fecha/horario → Paso 2: escanear →
Paso 3: resumen) funciona pero visualmente es la más básica de la app, y el operario
reportó tres fricciones reales:

1. No hay forma cómoda de dejar puesta la fecha de hoy por defecto ni de elegir un día
   próximo sin abrir el calendario nativo cada vez.
2. El campo de escaneo autoenvía muy rápido (pensado para la pistola de código de
   barras) y no deja teclear un pedido a mano con calma cuando hace falta.
3. No existe ninguna forma de añadir varios soportes pendientes de golpe cuando ya se
   sabe con certeza que están físicamente en el camión — solo el escaneo uno a uno.

Esta fase resuelve las tres cosas y de paso eleva visualmente el Paso 1 y el Paso 2
(indicador de progreso, colores por tienda más presentes, jerarquía más clara).

Además, se cambia a quién y cómo se envía el informe de cierre de carga: por ahora solo
debe llegar al equipo de la plataforma (no todavía a las tiendas individuales — eso se
añadirá en próximas semanas cuando el usuario pase las listas por tienda), y deja de
guardarse una copia permanente en Drive — el PDF pasa a existir solo como adjunto del
correo.

## Alcance

`Index.html`, sección `#vistaCamion` (Paso 1/2/3) y su JS asociado, más `Backend.gs`
(`cerrarCarga`) y `ConfigEntregas.gs` para la parte de destinatarios/Drive del informe.
No se toca: cabecera/sidebar general, resto de vistas (Buscar, Pendientes, Buscador
tienda), los 3 temas existentes (Black/Vivid/Gray, deben seguir funcionando igual), ni
el esquema de Supabase (la columna `pdf_url` ya existe y solo deja de rellenarse).

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Dirección visual | "Wizard elevado" (evolución del estilo actual, no un sistema de color nuevo) | Elegido por el usuario tras comparar dos mockups en el companion visual; mantiene consistencia con el resto de la app y los 3 temas |
| Colores por tienda | Reutilizar los ya definidos en CSS (`--tienda-btn.tienda-malaga` etc.: Málaga `#22c55e`, Marbella `#3498db`, Mijas `#9b59b6`, Granada `#f39c12`), con relleno sólido al seleccionar en vez del brillo sutil actual | Pedido explícito del usuario; ya existían como variables, no hace falta inventar paleta nueva |
| Selector de fecha | Fila de chips (Hoy + Mañana + 5 días con nombre corto = 7 días) + chip "Otra fecha" que revela el `<input type="date">` nativo existente para cualquier fecha más lejana | El usuario pidió expresamente 7 días con calendario de reserva, no sustituir del todo el calendario |
| Valor por defecto de fecha | "Hoy" preseleccionado al entrar en el Paso 1 | Pedido explícito |
| Entrada manual en escaneo | Botón visible "⌨ Introducir a mano" junto al campo de escaneo, que desactiva el autoenvío por patrón de pistola mientras esté activo; solo se añade con Intro o un botón "Añadir" que aparece al lado | El usuario aclaró que el problema real es que el autoenvío es "muy rápido" y no le deja teclear con calma — no es sobre reanudar una carga por ID |
| Carga masiva | Gesto oculto: mantener pulsado 2s el título de la carga (sin ninguna pista visual de cómo activarlo) abre un panel con los soportes pendientes de la tienda de esa carga, checkboxes + "Añadir seleccionados" | Pedido explícito de que sea difícil de encontrar por accidente; 2s y sin pista son ajustes directos del usuario sobre la propuesta inicial (1.2s + texto de ayuda) |
| Motor de la carga masiva | Reutilizar `escanearSoporte(idCarga, idUnico)` una vez por soporte seleccionado (no una función nueva que salte validaciones) | Hereda gratis las comprobaciones existentes (destino correcto, no duplicado) — es la opción con menos riesgo técnico |
| Lista de soportes ya añadidos (Paso 2) | Solo 2 columnas: **ID** (idUnico) y **Origen** — sin nº de fila ni nº de pedido | Pedido explícito: "solo quiero poder visionar lista de ID y origen, no quiero más detalles". Aplica solo a la vista en pantalla — el informe PDF de cierre no cambia (sigue con el detalle completo que ya usan las tiendas) |
| Aviso de riesgo de la carga masiva | Una línea de texto fija dentro del panel ("estos soportes se marcarán como cargados sin escanearlos"), sin diálogo de confirmación adicional | El usuario confirmó explícitamente que quiere la función tal cual, sin un paso de confirmación extra — el propio gesto oculto + el botón explícito ya son la barrera intencionada |
| Copia del informe en Drive | Se elimina — el PDF ya no se guarda como archivo permanente, solo se genera en memoria para adjuntarlo al correo | Pedido explícito del usuario |
| Destinatarios del informe (temporal) | Se sustituyen las 4 listas actuales por tienda (Marbella/Mijas/Málaga/Granada) por una única lista igual para las 4: "Para" = `administracion.alm-malaga@leroymerlin.es` + `pedidocliente.alm-malaga@leroymerlin.es`; "CC" = 8 personas (los "mandos") | El usuario confirmó explícitamente que quiere sustituir (no sumar) — por ahora el informe debe llegar solo al equipo de la plataforma, no a las tiendas; las listas por tienda actuales se recuperarán/ampliarán cuando pase las definitivas "en próximas semanas" |
| Enlace "Abrir informe PDF" en pantalla de cierre | Se elimina sin sustituto | Pedido explícito — sin copia en Drive no hay nada a lo que enlazar |
| Blindaje de `verificarSistema()` frente al modo prueba real | `verificarSistema()` fuerza `activarModoPrueba()` al empezar (si no lo estaba ya) y restaura el estado original al terminar, en un `try/finally` que envuelve TODA la función | El usuario va a desactivar el modo prueba en producción él mismo nada más desplegar esto. Se ha detectado que 5 de los 6 bloques de `verificarSistema()` que llaman a `cerrarCarga` no comprueban el modo prueba antes — con las 4 tiendas ahora con destinatarios reales configurados (antes Málaga/Granada estaban vacías), cualquier ejecución futura de las pruebas mandaría hasta 5 correos reales con datos de prueba a las 10 personas configuradas. Forzar el modo prueba SOLO durante la ejecución de las pruebas (sin tocar el estado real de producción) elimina el riesgo sin depender de que nadie se acuerde de comprobarlo a mano |

## Paso 1 — Tienda y fecha

- Se añade un indicador de pasos (Tienda → Fecha y horario → Escanear) encima del
  formulario, con el paso activo resaltado en `--color-accent` y los completados en
  verde, igual que en el mockup aprobado.
- Los botones de tienda (`.tienda-btn`) pasan de fondo tenue + brillo a **relleno sólido
  del color de la tienda** cuando están seleccionados (mismo color de fondo que hoy usa
  el `.tienda-dot`), manteniendo el `✓` y el resto de la lógica JS (`seleccionarTiendaCamion_`)
  intacta — es un cambio de CSS, no de comportamiento.
- El `<input type="date" id="camionFecha">` deja de mostrarse por defecto: se sustituye
  visualmente por una fila de chips (Hoy, Mañana, + 5 días con nombre corto en español —
  Lun/Mar/Mié/Jue/Vie/Sáb/Dom — calculados desde `new Date()`) y un chip final
  "📅 Otra fecha". El `<input>` nativo sigue existiendo en el DOM (oculto) como fuente de
  verdad: clicar un chip le pone el valor correspondiente y lo marca seleccionado;
  clicar "Otra fecha" lo muestra/abre para elegir cualquier fecha y, si el valor elegido
  no coincide con ninguno de los 7 chips, ninguno queda marcado (el chip "Otra fecha"
  pasa a mostrar la fecha elegida). Al entrar en el Paso 1, el chip "Hoy" queda
  preseleccionado y `camionFecha.value` se inicializa a la fecha de hoy.
- **No se toca** `crearCargaUI()` (sigue leyendo `camionFecha.value` tal cual) ni el
  flujo de llegada cruzada desde Carta de Portes SIE (`iniciarVistaOperario_`, que
  escribe directamente en `camionFecha.value` y puede saltar el Paso 1 entero) — ambos
  siguen funcionando sin cambios porque el campo nativo sigue siendo el mismo elemento
  con el mismo id.

## Paso 2 — Escaneo

- Tarjeta de escaneo con más aire, contador grande (estilo Bebas Neue, como los números
  de la cabecera) con el total de soportes ya cargados en esta carga.
- **Modo manual:** botón "⌨ Introducir a mano" junto al input. Al activarse (toggle):
  - El listener `input` que hoy detecta el patrón ráfaga-rápida-más-silencio de la
    pistola (`ESCANEO_PAUSA_MS_`/`ESCANEO_MAX_DURACION_MS_`) se desactiva por completo
    mientras el modo esté activo — no autoenvía nunca, sea cual sea la velocidad de
    tecleo.
  - Aparece un botón "Añadir" junto al input (además de que Intro sigue funcionando),
    para quien prefiera pulsar en vez de usar el teclado.
  - El estado del botón cambia visualmente (resaltado) mientras está activo, para que
    quede claro que el autoenvío está desactivado.
  - Es un toggle de sesión (dura mientras se tenga la carga abierta en esta pestaña del
    navegador) — no se persiste entre recargas ni afecta a otras cargas.
- **Lista de soportes añadidos** (`renderizarListaCamion_`): se reduce de 4 columnas
  (#, Nº Pedido, Origen, ID único) a **2 columnas — ID único y Origen** — mismo dato,
  menos ruido visual. No afecta a `obtenerCarga` (el backend sigue devolviendo todos los
  campos; simplemente no se pintan todos).
- **Carga masiva (gesto oculto):**
  - Mantener pulsado el título de la carga (`#camionTitulo`) durante 2000ms (pointerdown
    → temporizador → si se suelta antes, se cancela sin efecto) abre un panel/modal
    nuevo. No hay ningún icono, texto de ayuda ni indicio visual de que ese gesto existe
    en ningún sitio de la pantalla.
  - El panel llama a `obtenerPendientesPorTienda()` (ya existente, sin cambios) y
    muestra únicamente la entrada correspondiente a la tienda de la carga abierta:
    lista con checkbox + **ID** + **Origen** por soporte pendiente, más "seleccionar
    todos" arriba y un botón "Añadir seleccionados" abajo.
  - Encima de la lista, una línea de texto fija (no un diálogo, no bloquea): *"Estos
    soportes se marcarán como cargados sin necesidad de escanearlos."*
  - Al pulsar "Añadir seleccionados", se llama a `escanearSoporte(idCarga, idUnico)` una
    vez por cada soporte marcado (secuencial, para no saturar la cuota de Apps
    Script/Supabase con llamadas paralelas). Si alguno falla (p.ej. otra persona lo
    escaneó justo antes), no aborta el resto — al final se muestra un resumen de cuántos
    se añadieron y, si hubo alguno rechazado, cuáles y por qué (mismo patrón que el
    borrado masivo del panel de administración, que ya reporta aparte los que fallan).
  - Al cerrar el panel (o al terminar de añadir), se refresca la lista de soportes del
    Paso 2 igual que hace ya cada escaneo individual.

## Paso 3

Pulido visual (espaciado, tipografía) más el cambio funcional del enlace al PDF (ver
sección siguiente) — el resto de comportamiento no cambia.

## Informe de cierre: sin copia en Drive + destinatarios temporales

**`cerrarCarga` (`Backend.gs`):** se mantiene la misma técnica de generación (HTML →
archivo temporal en Drive → `getAs('application/pdf')`, porque Apps Script necesita un
archivo de Drive para hacer esa conversión), pero:
- Ya no se llama a `DriveApp.getRootFolder().createFile(pdfFile)` para guardar la copia
  permanente — el `pdfFile` (blob en memoria) se usa directamente como `attachments` del
  `MailApp.sendEmail`.
- El archivo temporal HTML (`tempFile`) se sigue borrando (`setTrashed(true)`) igual que
  hoy — nunca fue la copia permanente, solo un paso intermedio necesario.
- `pdfUrl` deja de calcularse y de pasarse a `actualizarCarga_`/al valor de retorno. La
  columna `pdf_url` de Supabase (ya existente) queda simplemente sin usar — no requiere
  migración, solo se deja de escribir en ella.
- El objeto que devuelve `cerrarCarga` ya no incluye `pdfUrl`.

**`ConfigEntregas.gs`:** `EMAILS_PEDIDO_CLIENTE_TIENDA` mantiene su forma (un array por
tienda, para poder ampliarlo tienda a tienda cuando lleguen las listas definitivas), pero
las 4 tiendas pasan a tener temporalmente el mismo array:
`['administracion.alm-malaga@leroymerlin.es', 'pedidocliente.alm-malaga@leroymerlin.es']`.
`EMAILS_PEDIDO_CLIENTE_CC` se sustituye por los 8 "mandos":
`jose-manuel.lachambre@leroymerlin.es`, `pedro.gil@ext.leroymerlin.es`,
`jose-antonio.alcaide@ext.leroymerlin.es`, `david.delcampo@ext.leroymerlin.es`,
`daniel.arrastio@ext.leroymerlin.es`, `sebastian.gelvis@ext.leroymerlin.es`,
`daniel.simo@ext.leroymerlin.es`, `francisco-javier.camara@ext.leroymerlin.es`. Las
listas actuales por tienda (Marbella 3, Mijas 26, Málaga 4, Granada 3 personas reales)
**no se borran del historial** — quedan documentadas aquí por si hace falta recuperarlas
al añadir las tiendas más adelante, pero el código ya no las usa.

**`Index.html` (Paso 3):** el bloque `camionResumen` deja de incluir el enlace
`<a href="...">Abrir informe PDF</a>` — sin sustituto.

**`Pruebas.gs`:**
- El smoke test de `cerrarCarga` comprobaba `pdfUrl ? 'generada' : 'FALTA'`; como
  `pdfUrl` deja de existir, esa comprobación se adapta para no reportar un falso
  "FALTA" (verificar en su lugar que `cerrarCarga` no lanza error y que
  `cantidad`/`emailEnviado` son coherentes, sin depender de `pdfUrl`).
- **Blindaje frente a envíos reales durante las pruebas:** `verificarSistema()` guarda el
  estado actual de `modoPruebaActivo()` al principio, fuerza `activarModoPrueba()` si no
  lo estaba ya, ejecuta todos los bloques de prueba existentes sin cambiarlos, y en un
  `finally` restaura el estado original (vuelve a llamar a `desactivarModoPrueba()` si
  así estaba antes de empezar). Esto cubre los 5 bloques que hoy cierran una carga sin
  comprobar el modo prueba (fase 3 FIFO, escaneo por idUnico, grupo de pedidos, pedido
  incompleto, `obtenerOCrearCarga`) sin tener que tocar cada uno por separado. El bloque
  que ya comprobaba `modoPruebaActivo()` explícitamente (la "regresión de seguridad" de
  Mijas) se simplifica, ya que con el blindaje ese chequeo siempre será verdadero durante
  la prueba — se mantiene la aserción en sí (que el envío NO ocurrió de verdad) como red
  de seguridad, pero se quita la rama muerta del aviso "modo prueba desactivado".

**Modo prueba (producción):** el usuario tiene previsto ejecutar `desactivarModoPrueba()`
desde el editor de Apps Script él mismo en cuanto esto esté desplegado — no es una acción
que se ejecute como parte de este cambio de código. A partir de ese momento, cerrar
cualquier carga real (fuera de `verificarSistema()`) enviará un correo real a los 10
destinatarios configurados.

## Fuera de alcance

- Cualquier cambio al contenido/estilo visual del PDF en sí (`ReporteCarga.gs`,
  `htmlInformeCarga`) — sigue mostrando el mismo detalle que ya usan las tiendas, solo
  cambia dónde se guarda y a quién llega.
- Añadir las listas de correo específicas por tienda — queda pendiente, lo hará el
  usuario "en próximas semanas".
- Cualquier cambio a la pestaña "Pendientes" en sí (solo se reutiliza su función de
  datos, `obtenerPendientesPorTienda`, sin tocarla).
- Sustituir el calendario nativo por completo — sigue disponible vía "Otra fecha" para
  fechas fuera del rango de 7 días.
- Persistir el modo manual de escaneo entre sesiones/recargas.
