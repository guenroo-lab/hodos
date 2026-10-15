# HODOS — Trazabilidad de pedidos cliente (Taisa Logistics)

Sistema de trazabilidad de pedidos cliente de Taisa Logistics. Proyecto GAS standalone,
gestionado con clasp. Sin git (igual que los demás proyectos GAS de Taisa). Fases
implementadas: Módulo 1 (carga por lote + etiquetas), Cabecera+Buscadores, Fase 3
(carga de camión con escaneo + informe).

## Reglas de oro (aprendidas en lm_producción, aplican aquí igual)

- **Nunca** poner `<style>`, `<script>`, `<!DOCTYPE>`, `<head>` o `<body>` (ni sus cierres)
  como texto literal dentro de un `<script>` inline servido por HtmlService — rompe la
  ejecución de TODO el JS de la página. El HTML de las etiquetas se genera siempre en el
  servidor (`Backend.gs`), nunca como plantilla literal en `Index.html`.
- No se puede ejecutar GAS en local. La lógica pura (parseo, formateo, CODE128) se testea
  con `node --test` (ver `test/`). La lógica con servicios de Google se verifica con
  `Pruebas.gs` desde el editor, tras `clasp push`.
- Tras cualquier cambio aprobado: `clasp push -f`. Para publicar una versión nueva:
  `clasp deploy -i <deploymentId>` (ver `.clasp.json` / `clasp deployments`).
- El número de pedido **no se normaliza a 6 dígitos**. 6 dígitos es lo normal pero no es
  una condición — se guarda tal cual se pega (solo trim de espacios).
- Un número de pedido repetido **dentro del mismo lote pegado** NO es un reenvío: son
  varios soportes/palets del mismo pedido (`calcularSoportes` en `Utilidades.gs`). Se
  numeran en orden de aparición y la etiqueta muestra "SOPORTE X/Y" solo si hay más de 1
  Y no es un grupo (ver regla del barcode/agrupación más abajo).
- **El barcode de la etiqueta codifica el `idUnico`, NO el número de pedido** (cambio
  introducido tras el primer uso real — antes codificaba `numeroPedido`, lo que hacía
  imposible distinguir soportes repetidos del mismo pedido al escanear). `idUnico` es
  único por fila SIEMPRE, así que cada etiqueta física identifica exactamente su propio
  soporte sin ambigüedad. `escanearSoporte`/`seleccionarSoporteAEscanear` (`Utilidades.gs`)
  son duales: si el valor escaneado empieza por `HODOS-` se resuelve exacto por idUnico;
  si no (el operario tecleó el número de pedido a mano), cae al FIFO de siempre entre los
  soportes pendientes de ese pedido+destino. **Esto no afecta a `pedidosPendientesEnCarga`**
  (el bloqueo de cierre con pedidos incompletos sigue funcionando sobre el campo
  `numeroPedido`, no sobre el barcode — requisito explícito del usuario al aprobar este
  cambio: "debe estar ligado a un pedido, para no dejar soportes sin cargar").
  **CORREGIDO (2026-09-22, revisado también con Codex CLI):** bug real reportado por el
  usuario — `numeroPedido` puede repetirse por PURA COINCIDENCIA entre registros sin
  relación (misma numeración en otra expedición/día distinto — dato de dominio ya
  documentado en `IntegracionIncpc.gs` sobre MacroArrastres). Antes de este fix,
  `pedidosPendientesEnCarga` agrupaba por `numeroPedido+destino` en TODA la tabla sin
  más, así que un pedido de UN SOLO soporte (sin badge 1/2) quedaba bloqueado al cerrar
  por culpa de otro registro no relacionado. Requisito explícito del usuario: el
  bloqueo debe aplicar SOLO a soportes declarados multi-soporte, es decir
  `soporteTotal > 1` **del mismo `loteId`** (calcularSoportes calcula soporteTotal
  dentro de un único lote pegado; dos lotes distintos que cada uno declare su propio
  multi-soporte para el mismo numeroPedido+destino tampoco deben cruzarse — matiz que
  detectó la revisión de Codex). `cerrarCarga` (Backend.gs) ahora propaga
  `soporteTotal`/`loteId` en `filasChk` (antes se perdían, solo mandaba idUnico/
  numeroPedido/origen/origenTexto/destino/estado/bateaId). **Efecto colateral aceptado
  por el usuario:** una etiqueta agrupada con `+` nace con `soporteTotal=1`
  (`agruparSoportesAdmin`), así que el aviso legado "agrupaste y dejaste un soporte
  suelto sin agrupar" (párrafo siguiente) DEJA de bloquear el cierre — no hay forma de
  distinguirlo de una coincidencia real de numeroPedido sin este campo, y el usuario
  prefirió perder ese aviso a mantener el bloqueo incorrecto.
- **Agrupación de varios pedidos en un mismo soporte físico**: se pegan juntos en la
  misma línea del lote separados por `+` (ej. `100200+100300+100450` = 1 soporte con 3
  pedidos). Una única fila/etiqueta/idUnico para todo el grupo — el barcode agrupado
  también es simplemente su idUnico. La etiqueta impresa apila los números (uno por
  línea, fuente más pequeña vía `.numero-pedido-grupo`) y **nunca lleva badge de
  "SOPORTE X/Y"** aunque el mismo grupo se repita varias veces en el lote (decisión
  explícita del usuario: un grupo es una pieza única). `buscarEtiquetas` encuentra la
  fila buscando por CUALQUIERA de los pedidos del grupo (coincide por substring sobre el
  campo `numeroPedido`, que guarda el string completo "a+b+c"). `pedidosPendientesEnCarga`
  tokeniza ese campo por `+` (`tokensPedido_` en `Utilidades.gs`), pero desde el fix del
  2026-09-22 (ver nota "CORREGIDO" más arriba) una etiqueta agrupada ya NO bloquea el
  cierre si queda un pedido suelto sin agrupar en otra fila — nace con `soporteTotal=1`,
  fuera del ámbito del bloqueo (que ahora exige `soporteTotal>1` + mismo `loteId`).
- El logo de Leroy Merlin ya está integrado (`LOGO_LM_B64` en `Backend.gs`, desde
  `assets/logo_leroymerlin.png`), abajo-izquierda en la etiqueta, junto al barcode.
- El proyecto es de tipo `sheets` (script vinculado a una Google Sheet, no standalone):
  `SpreadsheetApp.getActiveSpreadsheet()` depende de eso.
- `Index.html` tiene 3 vistas por `?vista=` (carga/interno/tienda), inyectadas por
  `doGet` vía `createTemplateFromFile` (`validarVista`/`validarTienda` en `Utilidades.gs`
  filtran valores no reconocidos antes de templar, para evitar inyección por URL).
- Layout de `Index.html`: shell tipo app (cabecera fija + sidebar de navegación
  Cargar/Buscar que se convierte en barra superior en móvil `<860px`), full-bleed —
  no una página centrada. Tablas de resultados se convierten en tarjetas apiladas
  (`data-label` + CSS) por debajo de 700px, sin scroll horizontal. Vista `tienda` oculta
  la sidebar entera (no debe verla).
- **Google Sheets reinterpreta como número cualquier string que parezca numérico**
  (ej. `numeroPedido = "007890"`) al escribirlo con `setValues()`, **incluso desde Apps
  Script** — no solo al escribir a mano — y pierde los ceros a la izquierda. Por eso
  `obtenerHojaEtiquetas()` fuerza formato de texto (`'@'`) en toda la columna
  `numeroPedido` (`asegurarNumeroPedidoComoTexto_` en `EstructuraSheets.gs`) antes de
  cualquier escritura. Si se añade alguna otra columna que pueda recibir texto
  puramente numérico, aplicar el mismo tratamiento. Regresión cubierta en
  `verificarSistema()` (`Pruebas.gs`, caso `007890`).
- **`google.script.run` devuelve `null` en silencio (sin lanzar error) cuando el valor
  que cruza de servidor a cliente incluye objetos `Date` dentro de un array de
  objetos.** Pasó exactamente esto en `buscarEtiquetas`/`obtenerHistorialLotes`: cada
  fila devuelta llevaba `fechaCreacion`/`fechaEnvio` como `Date` crudo, y aunque la
  función devolvía los datos perfectamente al llamarla directamente desde el editor (sin
  pasar por el puente cliente-servidor), el navegador siempre recibía `null`. **Regla:
  ninguna función expuesta a `google.script.run` debe devolver un `Date` sin convertir**
  — usar `fechaComoTexto(valor)` (`Utilidades.gs`) para pasarlo a ISO string antes de
  incluirlo en el objeto de retorno. Esto **no se detecta ni con `node --test` ni con
  `Pruebas.gs`** (ambos llaman a las funciones directamente, sin cruzar el puente RPC
  real) — solo se ve en el navegador real, con la consola abierta. Si `resultados
  recibidos: null` aparece en consola para una función que sí devuelve datos al probarla
  en el editor, sospechar primero de esto.
- **Impresión de etiquetas a Zebra: el driver ignora la orientación de CSS y usa el
  tamaño NATIVO del rollo para la página** (confirmado en real, primero en
  `robot-ubicacion-pyxis/App.html` y luego reproducido igual en HODOS: sin esto la
  etiqueta salía girada Y cortada). Arreglo aplicado en `htmlEtiquetas` (`Backend.gs`):
  `@page{size:100mm 150mm;margin:0;}` (dimensiones intercambiadas respecto a la etiqueta
  150x100 en lectura normal) + `.etiqueta-wrapper` del tamaño nativo (100x150) +
  `.etiqueta` posicionado absoluto centrado con `transform:translate(-50%,-50%)
  rotate(90deg)` para que el contenido se lea apaisado. Si en el futuro se cambia el
  tamaño físico de la etiqueta, hay que intercambiar también las dimensiones de
  `@page`/`.etiqueta-wrapper`, no solo las de `.etiqueta`.
- **`imprimirLote()` (`Index.html`) tiene fallback + manejo de errores**, copiado de
  `lm_produccion/Index.html` tras una auditoría cruzada de todos los proyectos hermanos
  con impresión física (solo `lm_produccion` tenía algo comparable — el resto no imprime
  nada físico): si `window.open()` devuelve `null` (bloqueado por el navegador), cae a
  `imprimirEnMarcoOculto_()` (iframe oculto). Si `htmlEtiquetas` falla en el servidor, el
  `.catch()` escribe el error en la ventana (o `alert()` si no hay ventana) en vez de
  dejarla colgada en "Generando etiquetas...". Se evaluó explícitamente escalar el
  tamaño de fuente del número de pedido según nº de dígitos (como hace
  `robot-ubicacion-pyxis`) y se descartó: ningún proyecto hermano lo valida para Zebra,
  y no hay evidencia de que haga falta aquí — si se observa desbordamiento real con
  pedidos muy largos, tratarlo como fix puntual, no como regla general.
- **Fase 3 (carga de camión):** el barcode de la etiqueta lleva el número de pedido, no
  el ID único (no se cambió — invalidaría etiquetas ya impresas), así que un pedido con
  varios soportes o reenviado en otro lote comparte código de barras entre varias filas
  de `ETIQUETAS`. `escanearSoporte` resuelve esto con `seleccionarSoporteAEscanear`
  (`Utilidades.gs`, pura/testeada): cada escaneo marca la fila pendiente más antigua
  (FIFO) de ese pedido+destino — trata soportes-del-mismo-lote y reenvíos-de-otro-lote
  de forma idéntica (cada fila = una unidad física que espera un escaneo). Al escanear
  correctamente se rellenan `estado`→`EN_RUTA`, `bateaId`→idCarga, `fechaEnvio`→ahora en
  `ETIQUETAS` (las columnas que el Módulo 1 dejó reservadas) — el buscador de tienda las
  recoge sin cambios. El informe de cierre (`ReporteCarga.gs`) copia el estilo visual
  exacto de `CartaPortes.gs` (`buildPDFHtml`) y sus mismas listas de destinatarios/
  horarios por tienda (`ConfigEntregas.gs`) — las 4 tiendas (Marbella/Mijas/Málaga/
  Granada) ya tienen destinatarios reales configurados. **Granada es un caso especial:
  solo recibe un camión al día**, así que en vez de una lista de horas reales tiene un
  único horario "sentinela" (`'Envío único diario'`) — el desplegable de horario en
  `Index.html` (`poblarHorarios_`) simplemente muestra esa única opción ya seleccionada,
  sin necesitar cambios de código (un `<select>` con una sola `<option>` la autoselecciona).
  El envío de email necesita autorización manual la primera vez
  (`autorizarYProbarCorreo()` en `Pruebas.gs`) — en `lm_produccion` no bastó con
  conceder el permiso, hubo que quitar `oauthScopes` de `appsscript.json` y revocar el
  acceso previo en `myaccount.google.com/permissions`.
- **Pedidos incompletos (bug reportado tras la primera prueba real):** como el barcode
  identifica solo el pedido (no el soporte individual), escanear un pedido de varios
  soportes NO garantiza que todos vayan al mismo camión salvo que se fuerce. `cerrarCarga`
  ahora llama a `pedidosPendientesEnCarga` (`Utilidades.gs`, pura/testeada): si algún
  pedido tiene AL MENOS un soporte escaneado en esta carga pero otro sigue `REGISTRADO`
  (sin escanear en ningún sitio), lanza un Error y bloquea el cierre — no cuenta como
  pendiente un soporte que ya salió `EN_RUTA` en OTRA carga (ya se fue, cerrar esta no lo
  arregla). El mensaje de error llega tal cual al `alert()` de `cerrarCargaUI()` en
  `Index.html`.
- **Cargado vs Llegó (bug reportado: la búsqueda mostraba mal la fecha):** `fechaEnvio`
  en `ETIQUETAS` es el instante REAL del escaneo (momento de "Cargado" en el camión), no
  la fecha de entrega en tienda. `buscarEtiquetas` ahora también cruza con `CARGAS`
  (`obtenerMapaCargas_`) para devolver `fechaLlegada`/`horarioLlegada` — el
  `fechaEntrega`+`horario` de la CARGA, que es la fecha/hora que ELEGIMOS nosotros al
  crearla, no un escaneo de llegada real. La tabla de resultados (`Index.html`) ahora
  tiene dos columnas separadas: "Cargado" (`fechaCargado`) y "Llegó" (`fechaLlegada`+
  `horarioLlegada`). Mismo criterio en el informe PDF (`ReporteCarga.gs`): la cabecera ya
  mostraba "Fecha entrega"/"Horario" (= Llegó a nivel de carga), la columna por fila se
  renombró de "HORA" a "CARGADO" para no mezclar los dos conceptos.
- **Enlace a Carta de Portes SIE solo para Marbella/Mijas:** ese sistema no gestiona
  Málaga ni Granada (`validarTiendaCarta_` en `CartaPortesSIE/CartaPortes.gs` solo acepta
  esas dos), así que `actualizarEnlaceCartaPortes_` en `Index.html` oculta el enlace
  cruzado para cualquier otro destino en vez de mostrar un enlace que no llevaría a nada
  útil.
- **Cesión entre tiendas (nuevo origen):** transferencia de mercancía entre dos tiendas
  del circuito (`TIENDAS_VALIDAS`), no una plataforma externa ni Taisa. Añade una
  `origenTienda` (tienda de origen) — columna nueva en `ETIQUETAS`, **añadida al FINAL**
  de `COLUMNAS_ETIQUETAS` (no en medio) para no desalinear filas ya escritas antes de este
  cambio (`setValues()` en la cabecera no desplaza los datos existentes). Validado por
  `validarCesionEntreTiendas` (`Utilidades.gs`, pura/testeada): la tienda de origen Y la
  de destino deben estar ambas en el circuito, y ser distintas entre sí. **Bug encontrado
  y corregido en revisión post-despliegue**: la primera versión solo validaba el origen
  contra el circuito y comparaba contra el destino tal cual, sin comprobar que el propio
  destino también estuviera en `TIENDAS_VALIDAS` — un cliente con un bug (o una llamada
  directa a `google.script.run` saltándose la UI) podía registrar una cesión con un
  destino inventado. `origenTexto` queda "CESIÓN - TIENDA"
  (mismo patrón que "TAISA - SUBTIPO", `formatearOrigenTexto` generalizado a un segundo
  parámetro "detalle" cuyo significado depende del origen).
- **Selector de tienda por botones de color (Carga de camión):** sustituye el `<select>`
  original, mismo patrón visual que `CartaPortesSIE/cartaPortes.html` (`.tienda-btn` con
  clase base `tienda-<slug>` + clase `sel-<slug>` cuando está seleccionada). Colores fijos
  por tienda (constantes entre temas, igual que en Carta de Portes SIE): Marbella azul
  `#3498db`, Mijas morado `#9b59b6` (idénticos a los de Carta de Portes SIE), Málaga verde
  `#22c55e`, Granada naranja `#f39c12` (estos dos nuevos, mismo estilo). El estado
  seleccionado vive en la variable JS `camionDestinoSeleccionado` (ya no hay un
  `<select id="camionDestino">"), actualizada por `seleccionarTiendaCamion_` (click manual)
  o `marcarTiendaCamionSeleccionada_` (llegada cruzada desde Carta de Portes SIE vía
  `iniciarVistaOperario_`, sin disparar una recarga duplicada de horarios).
- **Selector de tema como botón único cíclico:** los 3 botones de tema se sustituyeron por
  un solo `#temaToggleBtn` que al pulsar avanza black → vivid → gray → black
  (`TEMAS_ORDEN_` en `Index.html`, función `cambiarTema()` sin argumento + `aplicarTema_`
  compartida con la restauración de tema guardado en `localStorage`).
- **Contenido opcional por soporte (artículos + cantidades):** pestaña nueva `CONTENIDO`
  (`EstructuraContenido.gs`) — una fila por línea de artículo, varias filas pueden
  compartir el mismo `idUnico`. Se añade justo al generar el lote (`Index.html`, sección
  "Contenido de los soportes" bajo Etiquetas Generadas, colapsada por soporte hasta que
  se pulsa "+ Añadir contenido") — **no afecta a la etiqueta impresa**.
  `guardarContenidoSoporte(idUnico, items)` REEMPLAZA cualquier contenido previo de ese
  soporte (borra e inserta, no acumula) tras normalizar con `prepararLineasContenido`
  (`Utilidades.gs`, pura/testeada: descarta líneas sin descripción, fuerza cantidad a
  número). Visible en AMBAS búsquedas (interno y tienda, decisión explícita del usuario)
  vía `obtenerMapaContenido_` cruzado en `buscarEtiquetas` (columna "Contenido") y en
  `obtenerCarga`/`htmlInformeCarga` (línea gris bajo el número de pedido en el PDF).
- **`verificarSistema()` corre sobre la MISMA hoja de producción, para siempre, sin
  resetearse nunca.** Esto ya causó un falso ERROR real (el check de ceros a la izquierda
  asumía `length === 1` y se rompió al acumular filas de ejecuciones anteriores — arreglado
  comprobando `.every(...)` en vez de contar filas) y un riesgo real de contaminación
  permanente (la prueba de "pedido incompleto" y la de `obtenerOCrearCarga` creaban una
  carga de prueba y NUNCA la cerraban — arreglado: ambas ahora se autolimpian cerrando la
  carga al final, y la de `obtenerOCrearCarga` además cierra cualquier carga ABIERTA
  sobrante de una ejecución anterior al fix antes de correr su propia comprobación). Regla
  para cualquier prueba nueva en `Pruebas.gs`: nunca asumir "esto es la única fila/carga que
  existe" — o bien filtrar por un identificador único de esta ejecución (`idUnico`, `loteId`,
  `idCarga` recién creado), o bien cerrar/limpiar explícitamente lo que la prueba abre.
- **Modo prueba (`ConfigEntregas.gs`, activo por defecto):** `modoPruebaActivo()` hace
  que `cerrarCarga` genere el PDF pero **nunca** llame a `MailApp.sendEmail`, aunque la
  tienda tenga destinatarios reales configurados (Marbella/Mijas ya los tienen — sin
  este interruptor, un simple test mandaría un correo real a una tienda de Leroy
  Merlin). `emailEnviado` devuelve `"MODO_PRUEBA (no enviado)"` en vez de `"SI"`/error,
  y la UI muestra un aviso rojo "MODO PRUEBA" en la pantalla de escaneo. Para pasar a
  envíos reales: ejecutar `desactivarModoPrueba()` desde el editor (guarda la decisión
  en `PropertiesService`, no hace falta redesplegar). Volver a activarlo con
  `activarModoPrueba()`. Regresión de seguridad en `verificarSistema()`: cierra una
  carga de Mijas (destinatarios reales) y falla fuerte si alguna vez se detecta que
  habría enviado un email de verdad estando en modo prueba.
- **Caché de "carga abierta" en `escanearSoporte` (2026-07-30, tras migrar a Supabase):**
  cada escaneo hacía 3 llamadas HTTP a Supabase; el usuario reportó la carga de soportes
  como la parte más lenta tras la migración. `cachearCargaAbierta_`/`obtenerCargaCacheada_`
  (`Backend.gs`) cachean `{destino, estado}` en `CacheService` para evitar releer Supabase
  en cada escaneo. **Gotcha real encontrado en revisión adversarial:** la primera versión
  dejaba que `escanearSoporte` repoblara el caché en cada cache-miss — eso abre una
  condición de carrera de "resurrección" clásica de cache-aside: una lectura en vuelo puede
  escribir un valor viejo (`ABIERTA`) justo *después* de que otra operación (`cerrarCarga`)
  borre esa misma entrada, dejando el caché con el valor viejo y un TTL nuevo, sin
  autocorregirse hasta que ese TTL expire. `CacheService` no tiene compare-and-swap para
  evitarlo. **Solución: un único escritor.** `cachearCargaAbierta_` solo se llama una vez,
  desde `crearCarga` (antes de que exista ningún escaneo o cierre para esa idCarga);
  `escanearSoporte` es de solo lectura y en un cache-miss relee Supabase sin volver a
  escribir. Sin un segundo escritor, no hay nada que pueda competir con el borrado de
  `cerrarCarga` — la garantía de frescura es ese borrado explícito (en `try/catch`, para no
  romper el cierre si fallara), no el TTL (puesto al máximo de `CacheService`, 6h, porque ya
  no es la barrera de seguridad principal). Regla general para cualquier caché futuro en
  este proyecto: si una operación puede invalidar una entrada, ningún otro punto del código
  debe poder repoblarla después — un solo escritor por clave, o un caché con CAS de verdad.
- **Revisión de seguridad/concurrencia 2026-09-23** (revisión propia con 4 agentes +
  verificación adversarial independiente por hallazgo; Codex CLI no pudo dar 2ª opinión
  — spend cap del workspace agotado a los ~8min, sin hallazgos usables). 15 bugs reales
  confirmados, todos arreglados salvo el punto 1 (decisión explícita del usuario:
  documentar, no bloquear):
  1. **[NO arreglado, decisión del usuario] Autorización de funciones admin solo en
     cliente.** `buscarEtiquetas` y las funciones admin (`borrarSoporteAdmin`,
     `actualizarSoporteAdmin`, `agruparSoportesAdmin`, `cerrarCarga(id, forzar=true)`)
     no comprueban identidad/rol en servidor — la restricción de `vista=tienda` a "solo
     su tienda" es solo del cliente (`Index.html`). Mismo aviso de seguridad ya
     documentado el 2026-07-27 para la fuga de lectura entre tiendas (webapp limitado a
     `access: DOMAIN`), pero las funciones admin/destructivas se añadieron DESPUÉS de
     ese aviso y nunca se reevaluaron contra él. **Decisión explícita del usuario al
     revisar este hallazgo:** los usuarios de `vista=tienda` (pensada para Leroy
     Merlin) NO comparten el dominio de Google Workspace de Taisa, así que el enlace de
     tienda no es una vía real de acceso no autorizado — se deja documentado en vez de
     añadir un allowlist de emails internos. Si esto cambia (Leroy Merlin pasa a tener
     cuentas dentro del dominio), replantear con allowlist.
  2. **XSS almacenado en Index.html arreglado.** `renderizarResultados`,
     `cargarPendientes_`, `editarSoporteUI_`, `renderizarContenidoSoportes_`,
     `cargarHistorial`, `renderizarListaCamion_`, `renderizarListaCargaMasiva_`
     insertaban `numeroPedido`/`origenTexto`/`destino`/`contenido`/`estado` sin escapar
     vía `innerHTML` (dato de un pegado libre del operario, sin whitelist de origen
     hasta este mismo pase). Nueva `escapeHtml_()` en `Index.html`, aplicada en los 9
     puntos afectados. El servidor ya escapaba (`esc_`) para etiquetas/PDF/email —
     el hueco era solo la UI web interactiva.
  3. **`cerrarCarga` sin lock/CAS + escaneo fantasma durante el cierre, arreglados
     juntos.** El cierre se escribía en Supabase AL FINAL (después de generar PDF +
     mandar email real + escribir B2B externo, varios segundos de I/O). Doble clic o
     dos operarios cerrando casi a la vez duplicaban email/B2B; un escaneo que llegara
     durante esa ventana quedaba `EN_RUTA` con éxito pero fuera del informe ya enviado.
     Fix: el reclamo (`actualizarCargaCondicional_`, PATCH condicionado a
     `estado=eq.ABIERTA`, mismo patrón optimista que `escanearSoporte`) se mueve AL
     PRINCIPIO, antes del PDF/email/B2B, y el caché se borra justo después — reduce la
     ventana residual a la concurrencia real (sub-segundo), no la elimina del todo
     (mismo tipo de TOCTOU ya aceptado para Sheets).
  4. **`supaGet_` (SupabaseCliente.gs) truncaba en silencio si el "Max Rows" real de
     Supabase fuera menor que `SUPA_PAGE_SIZE_` (1000).** Ahora pide `Prefer:
     count=exact` y usa el total real de `Content-Range` para decidir si quedan más
     páginas, y avanza el offset por lo que el servidor devolvió de verdad
     (`pagina.length`), no por `SUPA_PAGE_SIZE_` — así no se salta filas si el servidor
     capa una página por debajo de lo pedido. Sin `Content-Range` (servidor viejo), cae
     al heurístico anterior. Además, `buscarEtiquetas` y `cerrarCarga` (lectura completa
     de `etiquetas` para `filasChk`) ahora piden `order=id_unico.asc` explícito —
     orden estable entre páginas si hay un borrado concurrente (p.ej. "Borrar
     seleccionados" del Buscador Interno mientras se cierra una carga).
  5. **`crearLoteArrastreDesdeMacroArrastres_` (IntegracionIncpc.gs): dedup por
     expedición sin lock + por presencia en vez de por cantidad.** Dos llamadas casi
     simultáneas (reintento de red, doble clic) para la misma expedición podían
     duplicar el lote entero — mismo tipo de incidente que el ya documentado del
     pedido 514281 (v47), pero sin esa defensa (que solo cubre
     `crearEtiquetaDesdeIncpc_`, no el flujo de lotes). Además, el antiduplicado era un
     mapa de booleanos: si el mismo pedido aparecía 3 veces en el lote pero solo 1 fila
     ya existía, las 3 se omitían enteras. Fix: `LockService.getScriptLock()` alrededor
     de leer+decidir+insertar (barato — se llama una vez por lote, no por escaneo), y
     `_conteoPedidosYaCreadosEnExpedicion_` (antes `_pedidosYaCreadosEnExpedicion_`)
     devuelve cantidades, no booleanos — se omite una aparición por cada fila que YA
     existe, el resto (soportes nuevos reales) se crea.
  6. **`obtenerOCrearCarga` (Backend.gs): check-then-act sin lock.** Dos peticiones
     casi simultáneas con el mismo destino+fecha+horario (el enlace cruzado de Carta de
     Portes SIE) podían crear dos cargas ABIERTA para el mismo camión. Fix:
     `LockService.getScriptLock()` — se llama una vez por camión, coste asumible (a
     diferencia de `escanearSoporte`, de ahí que ese siga con concurrencia optimista).
  7. **`escanearPaletSSCC_` (EstructuraPaletes.gs): mismo check-then-act sin lock que
     el punto 6**, en el INSERT de palets SIE (sin UNIQUE en `sscc` a nivel de
     Supabase) — doble tap casi simultáneo del mismo SSCC podía duplicar el palet en
     el informe y en el B2B externo. Mismo fix: `LockService.getScriptLock()`.
  8. **`agruparSoportesAdmin` (Backend.gs): borraba los originales sin re-comprobar su
     estado justo antes del borrado.** Un escaneo colado en la ventana intermedia
     (incluye una llamada HTTP síncrona a INCPC) marcaba un original `EN_RUTA`, y aun
     así se borraba igual — desaparecía de `etiquetas` aunque ya estuviera en un
     camión real. Fix: nueva `borrarEtiquetaCondicionalPorIdUnico_`
     (`EstructuraSheets.gs`, DELETE condicionado a `estado=eq.REGISTRADO`,
     `supaBorrar_` ahora pide `return=representation` para saber si borró algo de
     verdad); si no se pudo borrar, se avisa en `avisosIncpc` (mismo patrón ya
     existente para los avisos de INCPC) en vez de fallar en silencio.
  9. **`actualizarSoporteAdmin` (Backend.gs): editar `numeroPedido`/`destino` de UNA
     fila de un multi-soporte (`soporteTotal>1`) rompía su clave compuesta con sus
     hermanas** (`pedidosPendientesEnCarga` empareja por
     `numeroPedido+destino+loteId`) — `cerrarCarga` podía cerrar creyendo que ya no
     quedaba nada pendiente, con la etiqueta editada (impresa con el `soporteTotal`
     viejo) aún sin escanear. Fix: bloquea el cambio de `numeroPedido`/`destino` en un
     soporte con `soporteTotal>1` (mensaje explícito pidiendo borrar y volver a
     registrar); sigue permitiendo editar otros campos, y sigue permitiendo
     `numeroPedido`/`destino` libremente en soportes sin hermanos (`soporteTotal=1`).
  10. **`registrarLote`/`crearCarga` (Backend.gs): `destino` solo se comprobaba
      truthy, nunca contra `TIENDAS_VALIDAS`** (a diferencia de `origenTienda` en una
      Cesión, donde justo este mismo tipo de bug ya se corrigió una vez). Un destino
      con typo o sin normalizar creaba un soporte huérfano invisible en Pendientes y en
      el filtro del Buscador Interno. Fix: `validarTienda(destino)` obligatorio en
      ambas.
  11. **`actualizarB2BSIE_` (IntegracionB2B.gs): abría la hoja mensual con la fecha de
      EJECUCIÓN, buscaba la fila con la fecha de ENTREGA.** Un cierre procesado en un
      mes distinto al de su entrega (p.ej. entrega 31/08, cierre 01/09) abría
      "Septiembre" y nunca encontraba la fila de agosto — fallo heredado sin cambios
      del puerto directo de CartaPortesSIE. Fix: la hoja se localiza con la misma fecha
      de entrega que ya se usa para la fila. Además, ahora devuelve `{ok, error}` en
      vez de tragarse el fallo en `Logger.log` sin más.
  12. **Fallos de cotejo SIE / escritura B2B en `cerrarCarga` eran invisibles fuera del
      log del editor.** Ahora `cerrarCarga` devuelve `avisosSie` (mismo patrón que
      `avisosIncpc`) y `Index.html` (`mostrarResumenCierre_`) lo muestra en rojo en el
      resumen de cierre.
  13-15. Huecos de cobertura de test rellenados (sin bug de comportamiento):
      `tokensPedido_` sin test directo, `code128Secuencia`/`Anchos`/`SVG` con texto
      vacío sin test del `throw`, `horasLaborablesTranscurridas` sin ningún caso que
      cruce 2+ fines de semana completos (relevante para el umbral de 30h de la
      pestaña Pendientes), y `htmlInformeCarga` (en producción con emails reales desde
      v50) sin ningún test hasta ahora — cubiertos `colorBanda` fallback, `avisoVacio`
      con carga 100% refill SIE, pluralización de `chipResumen`, y el bloque
      `bloqueSie` con `okCount`/`nokCount`.
  Todo lo de esta entrada verificado con `node --test test/` en verde (240 tests) tras
  cada cambio. Pendiente de `clasp push -f` — no incluido en este pase, a confirmar.
- **Un camión = una carga, cargador obligatorio y reapertura (2026-10-15).** Spec:
  `docs/superpowers/specs/2026-10-15-cargas-panel-cargador-reapertura-design.md`. Un camión se
  identifica por destino+fecha+horario y tiene UNA carga para siempre: `obtenerOCrearCarga` busca en
  cualquier estado (abierta → la continúa; cerrada y aún no ha llegado → devuelve `{cerrada, reabrible}`
  para que la pantalla pida confirmar y llame a `reabrirCarga`; cerrada y ya llegó → solo avisa, no crea
  otra; con cargas repetidas heredadas manda la que lleva mercancía, `elegirCargaExistente_`). Hora de
  llegada = fecha+horario en hora de Madrid (`fechaLlegadaCarga_`, `Utilidades.gs`).
  Abrir/reabrir exige 1-2 cargadores de la lista de Cargas/Descargas (copia en `Utilidades.gs`, vigilada
  por `test/cargasReapertura.test.js`; `obtenerCargadores()` la sirve a la pantalla). Columnas nuevas de
  `cargas` (`cargador`, `reabierta_por`, `reabierta_en`, `b2b_conteo`): migración
  `docs/migraciones/2026-10-15-cargas-cargador-reapertura.sql`, que hay que aplicar ANTES de desplegar
  (la apertura escribe `cargador`: sin la columna, abrir una carga falla). Al cerrar otra vez una carga
  reabierta: asunto y franja «ACTUALIZADO» y, al B2B de Leroy Merlin, solo la diferencia (`b2b_conteo`).
  `reabrirCarga` NO escribe en el caché de «carga abierta» a propósito (ver `cachearCargaAbierta_`).
  `Index.html`: panel de cargas (`listarCargasPanel`, sin sondeo por el egress de Supabase) y
  selector «¿Quién carga?» en el paso 1; el JS va entre las marcas `CARGAS ACTIVAS Y CARGADOR` y se
  prueba en `test/indexCargasPanel.test.js`. La llegada cruzada desde Carta de Portes SIE ya no abre la
  carga sola. `Pruebas.gs` usa un horario propio por ejecución para `obtenerOCrearCarga`.
- **Pantalla del muelle en tres listas y cargas huérfanas (2026-10-15).** `listarCargasPanel()` devuelve
  `{abiertas, cerradas, porRevisar}` y las tres NO se mezclan: arriba solo las abiertas con el camión sin llegar;
  barras plegables «Cerradas» (entrega de hoy en adelante; reabribles hasta la llegada, luego solo consulta;
  desaparecen al acabar su día de entrega) y «Por revisar» (abiertas con el camión ya llegado, hay que cerrarlas, y
  abiertas REPETIDAS de un camión que ya tiene su carga). El reparto es `clasificarCargasPanel_` (pura, en
  `Utilidades.gs`; un camión = `claveCamionCarga_`; manda `elegirCargaExistente_`). Lee los últimos
  `DIAS_REVISION_CARGAS_` (7) días y solo `COLUMNAS_PANEL_CARGAS_`. `descartarCarga(idCarga)` pasa una carga ABIERTA
  y VACÍA a `estado = 'DESCARTADA'` (sin informe; con mercancía se niega: hay que cerrarla); las DESCARTADAS no
  cuentan como carga del camión (`elegirCargaExistente_` solo mira ABIERTA/CERRADA). Si la base tuviera un `CHECK`
  sobre `cargas.estado` hay que migrarlo antes de usar «Descartar» (falla sin tocar nada). Tabla de «cuándo
  desaparece cada carga» en el spec. Se comprobaron unas 100 mutaciones (servidor y pantalla): las pruebas fallan con cada una.
  `cargas.estado` NO tiene `CHECK` (comprobado el 15/10) y «Descartar» ya se ha usado (4 cargas `DESCARTADA`).
- **Recorte de egress: historial de lotes y subtipos Taisa en Postgres (2026-10-15, HODOS v104, rollback `-V 103`).**
  `obtenerHistorialLotes` (`Backend.gs`) y `obtenerSubtiposConocidos` (`EstructuraSheets.gs`) ya no bajan la tabla
  `etiquetas` (7.302 filas): llaman por RPC a `public.historial_lotes(p_limite)` y `public.subtipos_taisa_usados()`
  (solo `service_role`), definidas en `migraciones/2026-10-15-egress-historial-lotes-y-subtipos.sql` (aplicada con
  `apply_migration`; vuelta atrás en el `-rollback.sql`, DESPUÉS de volver al código anterior). Desempate: el
  «primer registro» de un lote es el de menor `id_unico` (el código viejo dependía de un orden de empates sin
  definir; solo cambia en lotes de Antequera con varios pedidos de proveedor). Pruebas: `test/egressHistorialLotes.test.js`,
  `herramientas/pruebas-egress-fase2.js` (simulador; contra producción: `OLD_REF=<commit desplegado> UMBRAL_BYTES=1`,
  el `OLD_REF` por defecto 7f81f28 está desfasado) y `herramientas/pruebas-egress-historial-sql.js` (SQL real en
  PGlite: `PGLITE_DIR=<carpeta con @electric-sql/pglite>`).
- **Números de pedido en el «Historial reciente» (2026-10-15, v105).** Cada lote del historial enseña debajo de su línea
  los números de pedido que se registraron en él (los 30 primeros a la vista y el resto tras «+N más», un `<details>`).
  `obtenerHistorialLotes` sigue pidiendo los 10 lotes a la RPC y añade `pedidos` con `obtenerPedidosPorLote_`: UNA
  lectura de `etiquetas` (`lote_id,numero_pedido`, `lote_id=in.(…)`, orden `fecha_creacion,id_unico`) solo de los lotes que
  salen, en trozos de 40 ids por el límite de 2 KB de URL; un soporte agrupado «a+b» aporta `a` y `b`, sin repetir. Si esa
  lectura falla el historial sale igual, sin números, y queda un `AVISO` en el registro de ejecuciones. La cifra «N pedidos»
  de cada lote es el nº de ETIQUETAS (soportes), no de pedidos distintos: puede ser mayor que la lista de números.
  Pruebas: `test/egressHistorialLotes.test.js` (servidor), `test/indexHistorialPedidos.test.js` (pantalla) y el banco
  `pruebas-egress-fase2.js` (lotes con varios pedidos; `OLD_REF=4ddeeef UMBRAL_BYTES=1.05 SIN_TOPES_ACCION=1`).
- **Sin diálogos nativos del navegador (regla del usuario, 2026-10-15).** `Index.html` no usa `alert()`,
  `confirm()` ni `prompt()` (salen con la URL fea de googleusercontent.com): avisos con
  `mostrarModalAviso_(titulo, texto)` y confirmaciones con
  `mostrarConfirmacion_(mensaje, alConfirmar, titulo, textoBoton, peligro)` (`alConfirmar` se ejecuta dentro del
  clic de Aceptar; `peligro` = la acción destruye algo: botón rojo y foco inicial en «Cancelar»; Esc cierra el
  cuadro abierto). Lo vigila `test/indexSinDialogosNativos.test.js` (escáner que ignora comentarios, cadenas y
  expresiones regulares, también atributos `onclick`) y comprueba el comportamiento de los flujos de
  administración (borrar, agrupar, copiar, imprimir, guardar).

## Estructura

- `EstructuraSheets.gs` — pestaña `ETIQUETAS` (esquema en el spec de diseño)
- `EstructuraCargas.gs` — pestaña `CARGAS` (una fila = una carga de camión)
- `EstructuraContenido.gs` — pestaña `CONTENIDO` (artículos/cantidades opcionales por soporte)
- `Utilidades.gs` — funciones puras (parseo de lote, formateo de textos, IDs, soportes,
  validación de tienda/vista, selección FIFO de soporte a escanear, pedidos pendientes en
  una carga, normalización de líneas de contenido)
- `Barcode.gs` — encoder CODE128-B propio, sin CDN
- `Backend.gs` — `doGet` (con plantilla), `registrarLote`, `htmlEtiquetas`,
  `buscarEtiquetas`, `crearCarga`, `listarCargasAbiertas`, `obtenerOCrearCarga`, `reabrirCarga`,
  `listarCargasPanel`, `obtenerCarga`, `escanearSoporte`, `cerrarCarga`, `guardarContenidoSoporte`
- `ReporteCarga.gs` — `htmlInformeCarga` (informe de cierre, estilo Carta de Portes)
- `ConfigEntregas.gs` — destinatarios/horarios de entrega por tienda
- `Index.html` — UI (3 temas, 4 vistas: carga/interno/tienda/camión, shell responsive)
- `Pruebas.gs` — funciones de humo para ejecutar desde el editor + `autorizarYProbarCorreo`

## Documentación

- Spec Módulo 1: `docs/superpowers/specs/2026-07-27-modulo1-carga-etiquetas-design.md`
- Plan Módulo 1: `docs/superpowers/plans/2026-07-27-modulo1-carga-etiquetas.md`
- Spec cabecera+buscadores: `docs/superpowers/specs/2026-07-27-cabecera-y-buscadores-design.md`
- Plan cabecera+buscadores: `docs/superpowers/plans/2026-07-27-cabecera-y-buscadores.md`
- Spec fase 3 (carga de camión): `docs/superpowers/specs/2026-07-28-carga-camion-design.md`
- Plan fase 3 (carga de camión): `docs/superpowers/plans/2026-07-28-carga-camion.md`
- Spec migración Sheets→Supabase: `docs/superpowers/specs/2026-07-29-migracion-sheets-supabase-design.md`
- Plan migración Sheets→Supabase: `docs/superpowers/plans/2026-07-29-migracion-sheets-supabase.md`
- Spec rediseño Cargar camión + informe sin Drive: `docs/superpowers/specs/2026-08-04-rediseno-carga-camion-design.md`
- Plan rediseño Cargar camión + informe sin Drive: `docs/superpowers/plans/2026-08-04-rediseno-carga-camion.md`
- Despliegue actual: deployment `AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ`,
  versión 56 (v1 módulo 1 → v2 logo LM → v3 cabecera/buscadores → v4 rediseño responsive
  → v5 transiciones/foco → v6 instrumentación diagnóstico → v7 fix numeroPedido texto →
  v8 fix subtipo → v9 fix Date en google.script.run → v10 fix @page → v11 fix
  rotación etiqueta → v12 fallback impresión + manejo de errores → v13 fase 3: carga de
  camión → v14 modo prueba de email → v15 mejoras de accesibilidad/contraste + vista
  operario + integración cruzada con Carta de Portes SIE + horarios de Málaga → v16
  destinatarios reales de Málaga y Granada → v17 bloqueo de cierre con pedidos
  incompletos + columnas Cargado/Llegó separadas + enlace SIE oculto para Málaga/Granada
  → v18 contenido opcional por soporte (artículos/cantidades) → v19 smoke test de
  contenido en Pruebas.gs → v20 cesión entre tiendas + selector de tienda por botones de
  color + tema en botón único cíclico → v21 barcode = idUnico (no numeroPedido) +
  agrupación de varios pedidos en un mismo soporte con "+" → v22 fix falso ERROR en smoke
  test de ceros a la izquierda → v23 revisión adversarial post-despliegue: valida destino
  de cesión contra el circuito + 2 smoke tests que dejaban cargas de prueba abiertas para
  siempre ahora se autolimpian → v24 fix real tras probar v23: pedidosPendientesEnCarga
  busca por número de pedido en TODA la hoja, así que "930001"/"910001"/"920001" fijos
  seguían acumulando filas huérfanas de ejecuciones anteriores al propio fix de v23 —
  las 3 pruebas ahora usan un número de pedido único por ejecución, o escanean por
  idUnico en vez de por número de pedido, según lo que cada una necesite probar → v25
  migración de Google Sheets a Supabase (Postgres/PostgREST) como capa de persistencia —
  `EstructuraSheets.gs`/`EstructuraCargas.gs`/`EstructuraContenido.gs` pasan a hablar con
  Supabase vía `SupabaseCliente.gs` (cliente REST genérico, clave `service_role` legacy en
  Propiedades del script); IDs de `HODOS-`/`CARGA-` ahora vienen de secuencias de Postgres
  vía RPC (`siguiente_bloque_ids_etiquetas`/`siguiente_id_carga`) en vez de
  `LockService`+contador; `escanearSoporte` gana un bucle de reintento con concurrencia
  optimista (PATCH condicionado a `estado=eq.REGISTRADO`, con `order=fecha_creacion.asc,
  id_unico.asc` para un desempate FIFO determinista) para la carrera real de dos operarios
  escaneando casi a la vez; `Index.html`/`ConfigEntregas.gs`/`Utilidades.gs` no se tocaron.
  Reemplazo directo, sin fases de dual-write (HODOS seguía en modo prueba, sin datos ni
  usuarios reales). `verificarSistema()` en verde dos veces seguidas contra Supabase antes
  de este despliegue. Riesgos aceptados/documentados en el spec de migración: lecturas sin
  límite (`leerEtiquetas_(null)`) dependen del límite "Max Rows" de Supabase; ventana TOCTOU
  entre `escanearSoporte` y `cerrarCarga` ya existía en la versión Sheets, no es nueva; clave
  `service_role` quedó pegada en el chat de configuración, pendiente rotar antes de
  producción real.) → v26 primera ronda de feedback de uso real: (1) admin — nuevas
  `borrarSoporteAdmin`/`actualizarSoporteAdmin` en `Backend.gs`, con botones
  Editar/Borrar en la tabla del Buscador Interno, solo mientras el soporte sigue
  REGISTRADO (bloqueado en servidor y en cliente en cuanto se carga a un camión, para no
  descuadrar cargas ya en curso o informes ya enviados); (2) autointro en el escaneo de
  "Cargar Camión" — además del Intro que ya disparaba el envío, `camionEscaneo` ahora
  también detecta el patrón de ráfaga-rápida-seguida-de-silencio típico de una pistola
  (ver `ESCANEO_PAUSA_MS_`/`ESCANEO_MAX_DURACION_MS_` en `Index.html`) y se autoenvía sin
  esperar a que nadie pulse nada, con guarda anti doble-envío; si el tecleo total tarda
  más de 300ms se asume manual y sigue haciendo falta Intro; (3) el resumen tras generar
  un lote en "Cargar lote" deja de volcar todos los IDs en una sola línea (ilegible con
  lotes grandes) y agrupa por número de pedido + recuento de soportes; el formulario se
  vacía y recupera el foco solo tras generar, para poder seguir bipando el siguiente
  lote sin limpiar nada a mano; (4) posible causa de etiquetas descuadradas al imprimir:
  el margen fijo de 250ms antes de `print()` no bastaba para que lotes grandes terminaran
  de maquetar/paginar — sustituido por una espera real a que carguen las imágenes + doble
  `requestAnimationFrame`, con tope de seguridad; queda como sospecha razonable, no como
  causa confirmada (revisar también en el propio diálogo de impresión que la escala esté
  al 100%/tamaño real y los márgenes en "Ninguno", y que el tamaño de página del driver
  de la Zebra coincida con 100×150mm); (5) logo Leroy Merlin de la etiqueta impresa
  (`LOGO_LM_B64` en `Backend.gs`) sustituido por una versión más nítida.) → v27 el
  fix de espera-antes-de-imprimir de v26 NO arregló el descuadre (usuario probó una
  serie de 8 etiquetas: 7 mal, solo la última bien — capturas de pantalla comparadas).
  Patrón real: en las malas, el recuadro `.etiqueta` sale más pequeño de lo debido y el
  contenido (barcode) se sale por debajo de su propio borde, con hueco en blanco a la
  derecha/abajo de la página — la que sale bien ocupa la página entera. Diagnóstico:
  `.etiqueta` usaba `position:absolute;left:50%;top:50%;` +
  `transform:translate(-50%,-50%) rotate(90deg)` para centrar el contenido rotado
  dentro de `.etiqueta-wrapper` (el truco de "@page en horizontal, contenido rotado
  90°" ya documentado arriba). Ese `%` de `left/top` se resuelve contra el tamaño de
  el contenedor EN CADA PÁGINA del trabajo de impresión — con 8 páginas casi idénticas
  seguidas, más una posibilidad real de que Chrome lo resuelva mal en páginas
  concretas del mismo documento (bug de paginación de impresión con position:absolute
  + % repetido muchas veces, no de timing/carga). Sustituido por centrado con
  flexbox (`.etiqueta-wrapper{display:flex;align-items:center;justify-content:center;}`
  + `.etiqueta{flex:none;transform:rotate(90deg);}`, sin `position:absolute` ni
  `top/left` en `%`): mismo resultado visual, pero sin depender de resolver un
  porcentaje de posición por página. Verificado en render local (8 etiquetas de
  prueba, sin regresión visual) — la reproducción exacta del bug de paginación de
  Chrome solo se puede confirmar imprimiendo de verdad en la Zebra, pendiente de que
  el usuario lo pruebe con el mismo lote de 8.) → v28 dos añadidos al panel de
  administración (Buscador Interno), pedidos tras el lanzamiento en limpio a
  producción (base de datos vaciada por completo con `delete from
  etiquetas/cargas` + reinicio de `seq_etiquetas_id`/`seq_cargas_id` a 1, ver
  histórico de esta sesión): (1) botón "Reimprimir" junto a Editar/Borrar —
  `htmlEtiquetaUnica(idUnico)` nueva en `Backend.gs`, reutiliza
  `envolverEtiquetasHtml_` (mismo CSS/@page que el lote, incluido el fix de v27) para
  que una reimpresión suelta salga con el mismo layout; a diferencia de
  Editar/Borrar, Reimprimir NO exige estado REGISTRADO (es de solo lectura, no toca
  Supabase, tiene sentido incluso para un soporte ya cargado en un camión); (2)
  borrado masivo — columna de checkboxes (solo en filas REGISTRADO, con
  "seleccionar todos" en la cabecera) + botón "Borrar seleccionados";
  `borrarSoportesAdmin(idsUnicos)` reutiliza `borrarSoporteAdmin` por cada id (misma
  guarda de estado), no aborta el lote si uno falla, y reporta aparte cuáles no se
  pudieron borrar. `imprimirLote`/`reimprimirEtiquetaUI_` comparten ahora
  `imprimirHtmlEtiquetas_` en `Index.html` (mismo flujo de ventana/fallback/espera de
  renderizado, antes duplicado).) → v29 nueva pestaña "Pendientes" en la barra
  lateral: una tarjeta por tienda destino con sus soportes "vivos" (estado
  REGISTRADO, aún no cargados en ningún camión), ordenados por antigüedad (más
  antiguo primero, mismo orden que interesa revisar). Aviso visual (fila en rojo +
  ⚠) para los que llevan más de `UMBRAL_ALERTA_HORAS_` = 30 horas — pero horas
  *laborables*: `horasLaborablesTranscurridas(fechaCreacion, ahora)` en Utilidades.gs
  descuenta los tramos que caen en sábado/domingo completos (no descuenta horas
  nocturnas dentro de un día laborable, solo fines de semana enteros), usando el
  mismo desfase fijo GMT+1 sin DST que ya usa el resto de la app para no depender de
  Utilities.formatDate (Utilidades.gs se mantiene sin dependencias de servicios de
  Google). `obtenerPendientesPorTienda()` en Backend.gs agrupa por las 4 tiendas del
  circuito (TIENDAS_VALIDAS, incluidas las que no tienen pendientes, para que la
  pestaña siempre muestre las 4 tarjetas) y calcula `horasTranscurridas`/`alerta`
  por soporte en el momento de la petición (no es un reloj en vivo — si se deja la
  pestaña abierta mucho rato, refrescar volviendo a entrar en ella).) → v30 botón
  "Imprimir silueta" en cada tarjeta de la pestaña Pendientes — imprime un informe
  A4 (no la etiqueta Zebra 100x150mm) con TODOS los soportes REGISTRADO de esa
  tienda, para la revisión diaria de qué queda pendiente de cargar.
  `htmlPendientesTienda(tienda)` en ReporteCarga.gs reutiliza el mismo estilo visual
  que `htmlInformeCarga` (cabecera oscura con logo Taisa, banda de color con el
  nombre de la tienda) y la misma antigüedad/alerta que la pestaña Pendientes
  (`horasLaborablesTranscurridas`/`UMBRAL_ALERTA_HORAS_`); en cliente reutiliza
  `imprimirHtmlEtiquetas_` (el mismo flujo de ventana/fallback/espera de renderizado
  de v27, no es específico de la Zebra).) → v31 dos peticiones: (1) rediseño de la
  tabla de la pestaña Pendientes — desbordaba fuera de la tarjeta/pantalla con 5
  columnas en tarjetas de ~380px. Reducida a 3 (Pedido con el ID único como subtexto
  debajo, Origen, Antigüedad), envuelta en `.pendientes-tabla-wrap{overflow-x:auto}`
  como red de seguridad si aun así no cupiera. La antigüedad pasa de solo texto a una
  "badge" de color con escalada amarillo→naranja→rojo según qué tan cerca esté de
  `UMBRAL_ALERTA_HORAS_` — `nivelAvisoPorHoras(horas, umbral)` nueva en Utilidades.gs
  (ok &lt;60% del umbral, amarillo 60-85%, naranja 85-100%, rojo ≥100%, todo como
  fracción del umbral para que la escalada se reajuste sola si cambia el número);
  `obtenerPendientesPorTienda` ahora manda `nivelAviso` por soporte (con `alerta`
  como antes, ahora derivado de `nivelAviso==='rojo'` para una sola fuente de verdad
  del umbral), y `htmlPendientesTienda` usa los mismos 3 colores en el informe
  imprimible. (2) nueva regla de negocio: el origen MECO debe cargarse completo por
  tienda destino en la misma carga — `soportesMecoPendientesEnCarga(filas, idCarga)`
  nueva en Utilidades.gs (mismo patrón que `pedidosPendientesEnCarga` pero agrupando
  por origen MECO + tienda en vez de por número de pedido); `cerrarCarga` en
  Backend.gs combina ambas comprobaciones en un solo mensaje de error si las dos
  fallan a la vez, listando los `idUnico`+pedido concretos que faltan. En cliente,
  los errores de `cerrarCarga` (antes un `alert()` nativo) ahora se muestran en un
  modal centrado propio (`mostrarModalAviso_`/`cerrarModalAviso_`, overlay + caja en
  `Index.html`) para poder leer con calma una lista de varios soportes faltantes.
  Efecto colateral necesario: los registros de humo de Pruebas.gs que usaban
  `origen: 'MECO'` como relleno (sin probar nada específico de MECO) se cambiaron a
  `'Valencia'` — si no, un registro MECO+Mijas/Granada que una prueba anterior deja
  sin escanear en la misma ejecución (p.ej. las de "ceros a la izquierda" o
  "contenido", que nunca cierran su carga) bloquearía el cierre de OTRAS pruebas
  MECO de la misma tienda más adelante en la misma ejecución de `verificarSistema()`.)
  → v32 nuevo campo opcional "Razón del flujo", independiente del origen (a diferencia
  del subtipo, que solo aplica a Taisa): aplica a CUALQUIER origen, con 3 valores
  cerrados — Sobrante, Soporte No documentado cargado, Anulado — y nunca viene
  seleccionado por defecto. `razonFlujoEfectiva(razonFlujo)` nueva en Utilidades.gs
  (mismo patrón defensivo que `subtipoEfectivo`: descarta cualquier valor fuera de
  `OPCIONES_RAZON_FLUJO_` o vacío) se usa en `registrarLote` y `actualizarSoporteAdmin`
  de Backend.gs; `razonFlujo`/`razon_flujo` se añaden al mapeo de
  EstructuraSheets.gs y se exponen también en `buscarEtiquetas` y
  `obtenerPendientesPorTienda`. Requirió una migración de esquema antes de desplegar
  (`ALTER TABLE etiquetas ADD COLUMN razon_flujo text`, aditiva y sin pérdida de
  datos) — ejecutada en el SQL Editor de Supabase ANTES del `clasp push`, porque
  `registrarLote` manda siempre la clave `razon_flujo` en el insert (aunque sea
  cadena vacía): desplegar el código sin la columna habría roto el registro de
  CUALQUIER lote, no solo los que usaran la opción nueva. En `Index.html`: select
  "Razón del flujo (opcional)" en Cargar Lote (se resetea a "-- Ninguna --" tras
  generar cada lote para que no se arrastre sin querer al siguiente lote normal),
  badge `.badge-razon-flujo` junto al origen en Buscador Interno y en la pestaña
  Pendientes cuando el soporte tiene una razón asignada, y select editable en la fila
  de edición del admin.)
  → v33 corrección: la razón del flujo NO debe aplicar a Taisa (esos motivos ya los
  cubre su propio subtipo, que se amplía con 4 valores nuevos — Sobrante, Ean
  Erroneo, Anulado, Rotura — algunos coincidiendo a propósito con los de razón del
  flujo). `razonFlujoEfectiva(origen, razonFlujo)` en Utilidades.gs pasa a recibir
  el origen (mismo patrón que `subtipoEfectivo`) y devuelve siempre vacío si
  `origen==='Taisa'`, sea cual sea el valor recibido; `registrarLote` y
  `actualizarSoporteAdmin` en Backend.gs actualizados para pasarle el origen. En
  `Index.html`: el grupo "Razón del flujo" de Cargar Lote se oculta y se limpia en
  `toggleSubtipoTaisa()` en cuanto el origen es Taisa (y `generarLoteEtiquetas()` lo
  fuerza a vacío como defensa adicional); en la fila de edición del admin, el select
  de razón se oculta/muestra dinámicamente en `onCambioOrigenEdicion_` igual que ya
  hacían subtipo/origenTienda (el servidor ya lo forzaba a vacío para Taisa aunque el
  cliente lo mandara, esto solo evita mostrar un campo que no va a tener efecto). No
  hizo falta tocar el esquema de Supabase (mismo `razon_flujo` genérico, sin
  restricción de origen a nivel de columna).)
  → v34 rediseño de "Cargar camión" (spec/plan del 2026-08-04, ver Documentación
  arriba): Paso 1 gana un indicador de pasos (`#camionStepper`, vive fuera de
  `camionPaso1/2/3` para no desaparecer al avanzar — quedó anidado dentro de
  `camionPaso1` en la primera versión y se corrigió en revisión) y chips de fecha
  rápida (Hoy por defecto + 6 días + "Otra fecha" que revela el calendario nativo,
  `generarChipsFecha_`/`marcarChipSeleccionado_` en `Index.html`); los botones de
  tienda seleccionados pasan a relleno sólido (colores oscurecidos al 60% del
  original para cumplir contraste WCAG AA con texto blanco, no los colores de marca
  tal cual). Paso 2 gana un modo manual de escaneo (botón "⌨ Introducir a mano",
  `toggleModoManual_`, desactiva el autointro mientras esté activo) y una carga
  masiva **oculta a propósito**: mantener pulsado 2s el título de la carga
  (`#camionTitulo`, sin ningún indicio visual de que ese gesto existe) abre un panel
  con los soportes pendientes de esa tienda (reutiliza `obtenerPendientesPorTienda`)
  para añadirlos sin escanear, llamando a `escanearSoporte` una vez por soporte
  seleccionado (hereda sus validaciones, no es una función nueva que se salte
  reglas) — decisión explícita del usuario tras avisarle del riesgo (marcar como
  cargado algo no verificado físicamente). La lista de soportes ya cargados se
  simplifica a solo ID + Origen. Además, `cerrarCarga` (Backend.gs) deja de guardar
  copia permanente del PDF en Drive (sigue generándose en memoria solo para
  adjuntarlo al email; `pdfUrl` desaparece del todo, incluida la pestaña de
  Supabase que ahora queda sin usar) y el enlace "Abrir informe PDF" se quita de la
  pantalla de cierre. `ConfigEntregas.gs`: las 4 tiendas comparten TEMPORALMENTE
  (hasta que el usuario pase las listas definitivas) el mismo destinatario
  "Para" (administración + pedido cliente de la plataforma) y el mismo CC (8
  personas) — las listas reales anteriores por tienda quedan documentadas en
  comentario, no borradas. Como esto le dio por primera vez destinatarios reales a
  Málaga y Granada en `verificarSistema()`, `Pruebas.gs` se blindó: la función
  ahora guarda el estado real de `modoPruebaActivo()`, lo fuerza a activo durante
  toda su ejecución pase lo que pase (`try/finally`), y lo restaura al salir — así
  las pruebas nunca pueden mandar un correo real sin importar el estado de
  producción. Por último, subtipo Taisa gana una opción más, "Pedido cliente"
  (`OPCIONES_SUBTIPO_` en `Index.html` y el `<select>` de Cargar Lote — sin
  validación cerrada en servidor, `subtipoEfectivo` solo filtra por origen, no por
  valor, igual que las adiciones anteriores). Implementado con
  subagent-driven-development: cada tarea del plan pasó revisión de spec y de
  calidad por separado; 5 hallazgos reales se corrigieron durante el proceso
  (contraste WCAG, chips sin semántica de botón accesible, el bug del stepper
  anidado ya mencionado, un `setTimeout` del gesto oculto sin `clearTimeout` previo,
  y dos mensajes de UI que mencionaban un PDF que ya no queda guardado en ningún
  sitio). El usuario tiene pendiente ejecutar `desactivarModoPrueba()` desde el
  editor cuando decida pasar a envíos de email reales — no forma parte de este
  despliegue.)
  → v35 tres fixes reportados por el usuario probando v34 en real: (1) el chip de
  fecha seleccionado no se distinguía bien — se añadió peso de fuente, sombra y un
  "✓ " antepuesto vía `::before` en `.fecha-chip.sel`, para no depender solo del
  color; (2) el gesto oculto de carga masiva no funcionaba en móvil porque mantener
  pulsado sobre texto dispara el menú nativo de "copiar/seleccionar" de iOS/Android,
  que se comía el evento antes de llegar a `pointerdown` — arreglado con
  `-webkit-touch-callout:none`/`user-select:none` en `#camionTitulo` más un
  `contextmenu` con `preventDefault()` como refuerzo; (3) **bug real preexistente
  expuesto por el nuevo panel**: la regla global `input, select, textarea { width:
  100% }` (pensada para campos de texto) también alcanzaba a TODOS los checkboxes
  de la app (carga masiva, borrado masivo del Buscador Interno, "seleccionar
  todos"), convirtiéndolos en bloques grandes con fondo/borde de input de texto en
  vez de una casilla pequeña — añadida `input[type="checkbox"] { width:auto;
  padding:0; ... }` para devolverles el tamaño nativo (con `accent-color` a juego
  con el tema). Afecta a más pantallas de las que motivaron el aviso, no solo a
  carga masiva.)
  → v36 tras probar v35 en real (móvil + producción): (1) responsive del Paso 1 en
  móvil — `.tienda-selector` pasa a grid 2x2 y `.busqueda-form`/`.fecha-chips` a
  una sola columna a partir de 700px, para aprovechar el ancho en vez de envolver
  en filas irregulares (el usuario probó en un Motorola G56); (2) el chip de fecha
  seleccionado pasa de rojo (mismo acento que el resto de la pantalla, poco
  distinguible) a verde — color exclusivo para "elegido", sin competir visualmente
  con nada más; (3) **investigación de bug real reportado**: pedido 284982 (3
  soportes reales, origen Valencia→Málaga) pidió un 4º soporte inexistente al
  cerrar la carga, obligando a crear uno de más solo para poder cerrar — revisadas
  `pedidosPendientesEnCarga`/`seleccionarSoporteAEscanear` dos veces a fondo, la
  exclusión de soportes `EN_RUTA` es correcta en ambas; con los datos reales del
  Buscador Interno (HODOS-000217/228/230 = 1/3,2/3,3/3, todos con hora de escaneo
  real ANTES de crearse HODOS-000271) no se pudo aislar la causa exacta — no hay
  histórico/logs a los que Claude tenga acceso para reconstruir la secuencia
  completa. Pendiente de que se repita con la mejora del punto (4) activa para
  capturarlo con detalle; (4) el aviso de "pedidos incompletos" al cerrar
  (`cerrarCarga` en Backend.gs) ahora lista el ID único y origen de cada soporte
  que falta, no solo un recuento — `pedidosPendientesEnCarga` (Utilidades.gs)
  devuelve un array `soportes` con `{idUnico, origenTexto}` por pedido pendiente
  además del recuento `soportesPendientes` (tests en `test/utilidades.test.js`
  actualizados); (5) nueva columna "Estado" con etiqueta calculada "Entregado" en
  el Buscador Interno: si un soporte sigue `EN_RUTA` pero ya pasó la fecha+hora de
  entrega de su carga (`fechaLlegada`+`horarioLlegada`, ya existían en
  `buscarEtiquetas`), se muestra "Entregado" en pantalla — **el estado real en
  Supabase NO cambia**, es solo una etiqueta calculada en `Index.html`
  (`estadoMostrado_`), no un reloj en vivo (hay que rebuscar para refrescarla). Si
  el horario de la carga no es una hora concreta (Granada: "Envío único diario"),
  se asume entregado al final del día de la fecha de entrega.)
  → v37 nueva opción "Libre Servicio" en "Razón del flujo (opcional)" — a diferencia
  del subtipo Taisa (sin validación cerrada en servidor), Razón del flujo SÍ tiene
  lista cerrada server-side (`OPCIONES_RAZON_FLUJO_` en `Utilidades.gs`,
  `razonFlujoEfectiva`): había que añadirla ahí también, no solo en los `<select>`
  de `Index.html` (Cargar Lote + fila de edición del admin), o el valor se habría
  guardado vacío en silencio pese a elegirse en pantalla. Test nuevo en
  `test/utilidades.test.js`.) → v38 integración con INCPC (proyecto hermano
  `Desktop\Proyectos\INCPC`, Taisa Málaga): un trigger instalable en INCPC llama a un
  `doPost` nuevo (`IntegracionIncpc.gs`) cuando en la hoja "Incidencias" se marca el
  check de la columna N con la columna M en "sí" (cualquier variante) — crea la
  etiqueta (origen Taisa, destino normalizado desde la columna B, subtipo desde la
  columna H, contenido desde F/G) y la marca `pendiente_impresion_incpc=true`.
  Autenticación en dos capas: token compartido (`INCPC_SHARED_TOKEN` en Propiedades
  del script de ambos proyectos) + `Authorization: Bearer` con el OAuth token del
  propio INCPC contra el deployment `DOMAIN` existente — sin abrir ningún acceso
  público nuevo. Nueva columna Supabase `pendiente_impresion_incpc boolean not null
  default false` (mismo proceso que `razon_flujo` en v32: `ALTER TABLE` a mano en el
  SQL Editor de Supabase antes de este despliegue). Pestaña nueva "INCPC" en
  `Index.html` (`?vista=incpc`) lista esas etiquetas con botón "Imprimir todas"
  (reutiliza `htmlUnaEtiqueta_`/`envolverEtiquetasHtml_` sin cambios) que limpia el
  flag al imprimir — desde ahí pasan a comportarse como cualquier etiqueta normal
  (Buscar/Pendientes). `registrarLote`/`guardarContenidoSoporte` ganan un
  `creadoPor`/`creadoPorOverride` opcional (`'INCPC · <operario>'`) porque la llamada
  es servidor-a-servidor, sin `Session.getActiveUser()`. Subtipo Taisa deja de ser
  una lista fija en `Index.html`: `obtenerSubtiposConocidos()` combina la lista base
  con los subtipos ya existentes en Supabase, así un tipo nuevo traído por INCPC
  aparece seleccionable sin tocar código. Ver spec/plan en
  `docs/superpowers/specs/2026-08-05-integracion-incpc-hodos-design.md` y
  `docs/superpowers/plans/2026-08-05-integracion-incpc-hodos.md`.) → v39 la pestaña
  INCPC gana edición/borrado/reimpresión individual, reutilizando exactamente el mismo
  mecanismo que ya tenía el Buscador Interno (`renderizarResultados` ahora trata
  `resultadosIncpc` igual que `resultadosInterno`; `obtenerEtiquetasPendientesIncpc`
  pasa a ser un envoltorio de `buscarEtiquetas({pendienteImpresionIncpc:true})` para
  compartir el mismo shape de datos). `borrarSeleccionadosUI_`/`guardarEdicionSoporte_`/
  `borrarSoporteUI_`/el botón "Cancelar" de edición ya no refrescan siempre "interno" a
  fuego — una función nueva `refrescarListaConAcciones_` decide según qué pestaña esté
  visible (bug real: antes de este fix, borrar/editar desde INCPC habría refrescado la
  pestaña equivocada). Sin cambios de esquema en Supabase. → v40 botón "🔄 Actualizar"
  en Cargar lote (junto a "Historial reciente"), Pendientes y INCPC — cada uno llama a
  su propia función de carga (`cargarHistorial`/`cargarPendientes_`/`cargarIncpc_`) para
  refrescar sin cambiar de pestaña. En Buscar no se añadió uno nuevo: el botón "Buscar"
  ya reconsulta con los filtros actuales, sería un duplicado exacto. La columna "Creado"
  (Buscar e INCPC, y la fila de edición inline) pasa de `formatearFecha` a
  `formatearFechaHora` — ahora muestra hora:minuto además del día. → v41 cierre
  forzado oculto: `cerrarCarga(idCarga, forzar)` gana un 2º parámetro opcional — con
  `forzar=true` se salta el bloqueo de pedidos incompletos/MECO sin completar (nunca en
  silencio: `forzado`/`avisosOmitidos` en la respuesta, más un aviso en rojo en el
  resumen de cierre, más `Logger.log` en el servidor). Se dispara con el mismo patrón
  ya usado para "carga masiva oculta" — pulsación larga (2s) sobre el botón "Cerrar
  carga" + `confirm()` con el riesgo explícito ("cualquier pedido que falte quedará
  marcado como enviado aunque no lo esté"); un toque normal sigue cerrando con las
  validaciones de siempre. Pensado para bloqueos reales sin salida normal (soporte
  perdido, pedido que ya no va a llegar). Smoke test nuevo en `Pruebas.gs` verifica
  que el forzado realmente salta el bloqueo Y que la carga queda CERRADA de verdad.
  → v42 búsqueda masiva de pedidos en Buscador Interno (bug real, no una feature nueva):
  el textarea "Nº Pedido (uno o varios, uno por línea)" ya existía en `Index.html` desde
  antes, pero `buscarEtiquetas` (Backend.gs) nunca llegó a trocear el texto pegado —
  comparaba el bloque multilínea completo como un único substring contra cada fila, así
  que pegar más de un pedido nunca encontraba nada. Arreglado reutilizando
  `parsearLotePedidos` (Utilidades.gs, la misma función que ya usa Cargar Lote) para
  partir por líneas y hacer match si CUALQUIERA de los pedidos pegados coincide (mismo
  criterio substring que ya tenía la búsqueda de un solo valor, ahora aplicado a cada
  token — compatible con grupos "a+b+c" y con el caso de un solo pedido). Combinado con
  el `<select>` de Destino ya existente, cubre pegar varios pedidos y filtrar por una
  tienda a la vez. 3 tests nuevos en `test/backendAdmin.test.js` (TDD, confirmado en rojo
  antes del fix). Placeholder de ejemplo añadido al textarea para que el uso sea
  descubrible sin instrucciones.
  → v43 botón "Copiar resultados" en Buscador Interno: junto a "Borrar seleccionados",
  copia al portapapeles la última tabla de resultados (`ultimosResultadosInterno_`, el
  mismo caché que ya usaba la edición inline) como texto separado por tabuladores —
  cabecera + una fila por soporte, mismas columnas que la tabla en pantalla (Nº Pedido,
  Soporte, Origen con la razón del flujo entre paréntesis, Destino, Estado, ID único,
  Creado, Cargado, Llegó, Contenido) — pensado para pegar directo en Excel/Sheets o en un
  chat. Intenta primero `navigator.clipboard.writeText` y si el WebView (típicamente
  Android) lo deniega, cae automáticamente a `document.execCommand('copy')` vía un
  textarea oculto; si ambos fallan, avisa para copiar a mano de la tabla en vez de fallar
  en silencio. El propio botón confirma con "¡Copiado! (N)" durante 1.8s en vez de un
  alert() bloqueante.) → v44 dos arreglos en el informe de cierre de carga
  (`ReporteCarga.gs`/`Backend.gs`, el PDF+email que manda `cerrarCarga`): (1) el logo
  Taisa no se veía en el CUERPO del email (confirmado con el usuario que el PDF adjunto
  sí lo mostraba bien) — causa real: `cerrarCarga` reutilizaba el mismo HTML con el logo
  como `data:image/png;base64,...` tanto para el PDF (vía conversión de Drive, que sí
  soporta data:URI) como para `htmlBody` del email (que NO pasa por ese conversor —
  Gmail/Outlook bloquean imágenes en base64 incrustadas en el cuerpo). Arreglado
  generando un HTML de email aparte (`htmlEmail`, un `.replace()` sobre el mismo
  `htmlPdf`) que cambia esa única URI por `cid:logoTaisa`, con la imagen real mandada
  como `inlineImages` de `MailApp.sendEmail` — el PDF adjunto sigue exactamente igual
  que antes. (2) la banda de color debajo de la cabecera (destino/fecha/horario) estaba
  fija en rojo Taisa (`#e30613`) para las 4 tiendas; ahora usa `COLOR_BANDA_TIENDA_`
  (Málaga `#147638` verde, Marbella `#1f5b83` azul, Mijas `#5d356d` morado, Granada
  `#925e0b` naranja) — mismos colores exactos que ya usan los botones de selección de
  tienda en `Index.html` (`.tienda-btn.sel-*`, ya ajustados a contraste WCAG), con rojo
  como fallback defensivo si `destino` no coincidiera con ninguna tienda conocida. Solo
  toca `htmlInformeCarga` — la "silueta" de pendientes (`htmlPendientesTienda`, que se
  imprime pero no se envía por email) se queda con la banda roja fija, sin tocar.) → v45
  filtro de orden ("Más nueva primero" / "Más antigua primero") en el Buscador Interno
  — `buscarEtiquetas` gana `filtros.ordenAscendente` (por defecto descendente, igual
  comportamiento que siempre tenía si no se pasa el filtro). Al reutilizar esta misma
  función para la pestaña INCPC (v39) su orden había pasado sin querer de "más antigua
  primero" (FIFO, el original) a "más nueva primero" (el nuevo valor por defecto) —
  corregido pasando `ordenAscendente:true` explícito desde `obtenerEtiquetasPendientesIncpc`.
  → v46 auditoría rápida de consistencia UI (skill ui-ux-pro-max): los 3 botones
  "Actualizar" de v40 llevaban emoji 🔄 — único caso en toda la app de un `.btn-link`
  con icono; el resto (Reimprimir/Editar/Borrar/Guardar/Cancelar) son siempre texto
  plano. Quitado el emoji por consistencia. Nota pendiente sin resolver (no urgente,
  el panel admin es de uso mayoritariamente desktop, no táctil): los `.btn-link` en
  general tienen un área clicable bastante por debajo de 44×44px — si en el futuro se
  usa este panel más desde un móvil/tablet, revisar `padding`/`font-size` de
  `.btn-link` en el bloque `<style>`.
  → v47 defensa de idempotencia en `crearEtiquetaDesdeIncpc_` (`IntegracionIncpc.gs`) —
  bug real (2026-08-11): pedido 514281 llegó duplicado como HODOS-001584/HODOS-001585
  pese a tres arreglos ya hechos del lado de INCPC (guarda de reentrada en los
  formularios + idempotencia en `guardarIncidencia` + no tragar errores en
  `onEditIncpcHodos_`). La causa real resultó ser otra, en el propio
  `onEditIncpcHodos_` de INCPC: faltaba `SpreadsheetApp.flush()` tras escribir el
  idUnico en la columna O, así que una segunda ejecución que adquiría el lock justo
  después de que la primera lo soltara podía seguir leyendo la fila sin el idUnico aún
  confirmado y crear una segunda etiqueta (confirmado en real: dos ejecuciones de
  `onEditIncpcHodos_` solapadas en segundos, ambas con duración de llamada de red
  completa). Ver CLAUDE.md de INCPC para el detalle de ese arreglo. Esta v47 añade una
  segunda capa de defensa en HODOS, independiente de que INCPC nunca vuelva a fallar:
  `_etiquetaIncpcReciente_(pedido, destino, tipo)` consulta si ya existe una etiqueta
  `origen=Taisa` con ese mismo pedido+destino+subtipo creada en los últimos 3 minutos
  (`UMBRAL_DUPLICADO_INCPC_MS_`) — si la hay, `crearEtiquetaDesdeIncpc_` devuelve su
  idUnico sin llamar a `registrarLote` ni crear nada nuevo. Ventana corta a propósito:
  cubre cualquier reintento/race real sin bloquear que el mismo pedido tenga
  legítimamente el mismo tipo de incidencia otra vez más tarde el mismo día. 5 tests
  nuevos en `test/integracion-incpc-dedup.test.js` (TDD, con `leerEtiquetas_`/
  `registrarLote` mockeados vía `vm`).)
  → v48 bug real (2026-08-12): etiquetas recién creadas dejaron de aparecer en el
  Buscador Interno. Causa: la tabla `etiquetas` en Supabase pasó de 1000 filas (1084 en
  el momento del fix) — `buscarEtiquetas` lee TODA la tabla sin filtro
  (`leerEtiquetas_(null)`) para filtrar en memoria, y PostgREST trunca en SILENCIO
  cualquier respuesta sin `limit`/`Range` más allá de su máximo por defecto, sin
  devolver error. Por eso `obtenerPendientesPorTienda` (filtra por
  `estado=eq.REGISTRADO`, un subconjunto mucho más pequeño) nunca lo sufrió, pero
  `buscarEtiquetas` sí — confirmado con un caso real (HODOS-001734, pedido 977080:
  visible en Pendientes, ausente en Buscar). Arreglado en `supaGet_`
  (`SupabaseCliente.gs`): ahora pagina automáticamente vía cabecera `Range` hasta traer
  la tabla completa, exigiendo un `order=` determinista (usa `id_unico.asc` por defecto
  si el caller no especifica uno) para que las páginas no se solapen ni dejen huecos.
  Si el `filtroPostgrest` ya trae un `limit=` explícito (2 casos: `_etiquetaIncpcReciente_`
  en IntegracionIncpc.gs, y un test en Pruebas.gs) se respeta tal cual, una sola
  petición, sin paginar — evita romper esas consultas deliberadamente acotadas. 6 tests
  nuevos en `test/supabaseCliente.test.js` (mock de `UrlFetchApp`, cubre multi-página,
  límite explícito, order ya presente, tabla vacía, y el caso borde de un total exacto a
  un múltiplo del tamaño de página). De paso, revisando INCPC fila por fila se encontró
  un huérfano histórico (pedido 974419, fila 2 de la hoja "Incidencias", del 6/08 —
  anterior a los arreglos de v107/v108): la etiqueta HODOS-000597 ya existía en HODOS
  (creada a mano por una persona, no por INCPC) pero la columna O de esa fila seguía
  vacía. Se corrigió a mano escribiendo el id_unico real en esa celda — sin esto, un
  futuro retoque de M/N en esa fila habría vuelto a crear una etiqueta duplicada.)
  → v49 HOTFIX de v48, mismo día: la paginación nueva forzaba "order=id_unico.asc" por
  defecto en CUALQUIER lectura sin filtro — pero id_unico solo existe en la tabla
  `etiquetas`. Cualquier búsqueda en el Buscador Interno rompía con "column
  cargas.id_unico does not exist", porque buscarEtiquetas también llama a
  obtenerMapaCargas_() (para la columna "Llegó"), que lee la tabla `cargas` sin filtro
  — esa tabla usa id_carga, no id_unico. Mismo problema latente en
  leerTodoContenidoCrudo_() (tabla `contenido`). Arreglado quitando el order por
  defecto por completo en vez de intentar adivinar la columna correcta por tabla —
  supaGet_ es genérico y no debe acoplarse al esquema de una tabla concreta; si algún
  caller necesita orden estable entre páginas, que lo pida él mismo (como ya hace
  obtenerPendientesPorTienda). No reintroduce el bug de v47 (verificado con un test
  nuevo que reproduce exactamente el error real contra una tabla sin id_unico). 131/131
  tests en verde.) → v50 destinatarios reales DEFINITIVOS por tienda (el usuario los pasó
  directamente, ver `ConfigEntregas.gs`): Marbella (7), Málaga (6), Mijas (5) y Granada
  (3), sustituyendo la lista temporal común de v34; el CC de plataforma también se
  actualiza a 9 personas (cambia respecto al anterior: sale `pedro.gil@ext...`, entra
  `pedidocliente.alm-malaga@...` y `administracion.alm-malaga@...` como CC explícito, y
  `daniel.simo@ext...` pasa a `maria-daniel.simo@ext...`). De paso, rediseño del
  documento/email de cierre de carga (`ReporteCarga.gs`/`Backend.gs`, skill
  ui-ux-pro-max): el nombre pasa de "Pedido Cliente" a "Informe de Carga" (asunto, título
  de cabecera y nombre de fichero PDF) — una carga real incluye soportes de cualquier
  origen (MECO, cesiones entre tiendas, etc.), no solo pedido cliente, así que el nombre
  anterior era engañoso para quien lo recibía. Se añade una línea de contexto bajo la
  banda de color aclarando el alcance real del documento, y se sube el contraste del
  texto de cabecera de la tabla (`#888`→`#64748b`) para acercarse a WCAG AA. **Modo
  prueba DESACTIVADO en producción a partir de este despliegue** (2026-08-12,
  confirmado explícitamente por el usuario antes de ejecutar `desactivarModoPrueba()`
  desde el editor — log de ejecución verificado: "Modo prueba DESACTIVADO: cerrarCarga
  enviará emails reales a los destinatarios configurados"): desde ahora, cerrar
  cualquier carga en cualquiera de las 4 tiendas manda el email de verdad, ya no es una
  simulación. `activarModoPrueba()` sigue disponible en `ConfigEntregas.gs` si hiciera
  falta volver a pruebas.) → v51 fix del CC de plataforma: `maria-daniel.simo@ext...`
  (error al transcribir la lista en v50) corregido a `daniel.simo@ext.leroymerlin.es`,
  la dirección correcta.) → v52/v53 bug real reportado con foto (etiqueta de Mijas,
  ~12 pedidos agrupados con "+" desbordando el borde físico): `htmlUnaEtiqueta_`
  (Backend.gs) apilaba TODOS los números del grupo a fuente fija
  (`.numero-pedido-grupo`, 22px) sin ningún límite — con muchos pedidos en el mismo
  soporte la lista no cabía en la etiqueta 100×150mm. `lineasNumeroPedidoEtiqueta`
  nueva en Utilidades.gs (pura, TDD): grupos de más de `UMBRAL_AGRUPACION_ETIQUETA_`
  (5, decisión explícita del usuario) pedidos se resumen como "AGRUPACIÓN (N)" en vez
  de listarlos — el barcode sigue codificando `idUnico` (no `numeroPedido`), así que el
  soporte se identifica igual de bien al escanear, y el recuento entre paréntesis evita
  perder esa información en la etiqueta física. De paso, `htmlUnaEtiqueta_` reutiliza
  `tokensPedido_` (ya existía, usada por `pedidosPendientesEnCarga`) en vez de repetir
  el mismo `split('+')` inline. 3 tests nuevos en `test/utilidades.test.js`, incluido
  el caso real de 12 pedidos.) → v54 nueva función: agrupar soportes YA EXISTENTES
  (selección múltiple en Interno/INCPC/Preparación — mismo checkbox `.chk-soporte` que
  ya usaba "Borrar seleccionados", botón nuevo "Agrupar seleccionados" al lado) en una
  sola etiqueta nueva con `numeroPedido` unido por "+" (mismo formato que un grupo
  creado de una vez en Cargar Lote; reutiliza `lineasNumeroPedidoEtiqueta`/el umbral de
  v53 en la etiqueta impresa sin cambios). Reglas de compatibilidad — decisión explícita
  del usuario, tan estricto como un lote de una sola vez —
  en `validarAgrupacion` (Utilidades.gs, TDD): mismo destino/origen/subtipo/
  origenTienda/razonFlujo y todos REGISTRADO (nada ya cargado en un camión).
  `agruparSoportesAdmin` (Backend.gs) crea la etiqueta nueva, combina el `contenido` de
  todos los soportes originales bajo el idUnico nuevo (se lee ANTES de borrar — Supabase
  tiene `ON DELETE CASCADE` en `contenido`, se perdería si se leyera después), hereda la
  bandera `pendienteImpresionIncpc` si algún original la tenía, y borra los originales al
  final. **Parte nueva de verdad — primera comunicación en sentido HODOS → INCPC** (hasta
  ahora solo existía INCPC → HODOS): si algún original fue creado por esa integración
  (`creadoPor` empieza por `"INCPC · "`), `notificarAgrupacionAIncpc_`
  (IntegracionIncpc.gs) avisa al proyecto INCPC (nuevo `doPost`/`_actualizarIdAgrupacion_`
  en su `Código.js`, ver su CLAUDE.md) para que actualice la columna O de "Incidencias"
  del idUnico borrado al nuevo — si no, esa fila quedaría apuntando a una etiqueta ya
  inexistente. **Decisión explícita del usuario: best-effort, NO bloqueante** — si INCPC
  no responde, la agrupación sigue adelante igualmente y el aviso vuelve en
  `avisosIncpc` (se muestra en el `alert()` de confirmación) para corregir la hoja a
  mano. Requiere una propiedad nueva en HODOS, `INCPC_WEBAPP_URL` (la URL de despliegue
  real de INCPC — **pendiente de configurar**, ver nota en INCPC/CLAUDE.md sobre por qué
  no se ha hardcodeado ninguna de las que aparecen en `clasp deployments`). 11 tests
  nuevos en `test/utilidades.test.js` (validarAgrupacion/numeroPedidoAgrupado) + 5 en
  `test/integracion-incpc-agrupacion.test.js` (notificarAgrupacionAIncpc_, mock de
  UrlFetchApp). Smoke test nuevo en `Pruebas.gs` (verde en real, incluye el caso de
  rechazo por destinos distintos).) → v55 fix real (mismo día): `notificarAgrupacionAIncpc_`
  daba 401/HTML en vez de JSON — la doc de INCPC (su CLAUDE.md) decía
  `access:ANYONE_ANONYMOUS`, pero su `appsscript.json` real dice `DOMAIN` (ambos proyectos
  igual). Añadida la cabecera `Authorization: Bearer ' + ScriptApp.getOAuthToken()`, mismo
  patrón que ya usa `enviarEtiquetaAHodos_` en INCPC para la dirección contraria — no basta
  el token compartido del cuerpo para pasar del nivel de acceso de Google. Propiedad
  `INCPC_WEBAPP_URL` ya configurada en Propiedades del script. **Pendiente sin resolver:**
  probando el round-trip real contra el deployment que el CLAUDE.md de INCPC documentaba
  como "confirmado 2026-08-11"
  (`AKfycbzGkXksWk04e7Tny8nbigHxXPEHJPUP0jBfTJEG_sVlrblf4YgbKecLc5xxO_BYlf8L`), la respuesta
  fue una página de error de Google Drive, no JSON — ese deployment ya no resuelve (ni con
  el token OAuth real). El proyecto INCPC tiene un histórico de ~50 implementaciones sin
  descripción — no se puede adivinar cuál es la real actual sin confirmarlo con el usuario
  (mismo aviso que ya tenía el propio CLAUDE.md de INCPC). Hasta que se actualice
  `INCPC_WEBAPP_URL` con la URL real, `notificarAgrupacionAIncpc_` seguirá fallando — sin
  bloquear `agruparSoportesAdmin` (decisión explícita del usuario, ver v54), solo apareciendo
  en `avisosIncpc` para corregir la hoja de Incidencias a mano mientras tanto.) → v56
  el subtipo deja de ser una condición de compatibilidad para agrupar (decisión
  explícita del usuario, mismo día): dos soportes Taisa con subtipos distintos
  (p.ej. "Devolución" y "Rotura") ya se pueden agrupar. `CAMPOS_AGRUPACION_`
  (Utilidades.gs) pasa de `[destino, origen, subtipo, origenTienda, razonFlujo]` a
  `[destino, origen, origenTienda, razonFlujo]` — sigue exigiendo mismo destino/origen
  (y tienda de origen/razón del flujo cuando aplican) y todos `REGISTRADO`, solo se
  quita el subtipo. La etiqueta resultante hereda el subtipo/origenTexto del PRIMER
  soporte seleccionado — no es una fusión de subtipos, es una elección arbitraria entre
  los presentes. Test actualizado en `test/utilidades.test.js` (antes comprobaba que
  se RECHAZARA un subtipo distinto, ahora comprueba que se PERMITA).)
- Integración con Carta de Portes SIE (proyecto hermano
  `Desktop\Proyectos\CartadePortesSIE`): bidireccional vía parámetros de URL
  (`?vista=operario&tienda=...&fecha=...&horario=...` en HODOS,
  `?tienda=...&fecha=...&horario=...` en Carta de Portes SIE). Cada app puede "continuar"
  la carga del mismo camión en la otra sin volver a pedir tienda/fecha/hora. Desplegado
  también en Carta de Portes SIE como v39 (deployment
  `AKfycbw_n8DjFoq7EyVhnQ9l2AmrIFcMxiWpmhmFlMa8pYSbmhz66VXfW0S9c11GOSRUwN4`) —
  **ese proyecto está en producción real (Marbella/Mijas lo usan a diario)** — desde
  v50 (2026-08-12), HODOS también está en producción real para el envío de email de
  cierre de carga (modo prueba desactivado, destinatarios reales en las 4 tiendas).
- **Nota (2026-09-23): el changelog de arriba se quedó parado en v56 aunque el
  deployment real ya iba por v75 al empezar esta sesión** (`clasp deployments`
  confirma v75 en vivo, no v56 — faltan ~19 versiones sin documentar aquí, no
  reconstruidas por no haber registro de qué cambió en ellas). Desplegado como **v76**
  el pase completo de la entrada "Revisión de seguridad/concurrencia 2026-09-23" (ver
  arriba, antes de "## Estructura") — `clasp push -f` + `clasp deploy -i
  AKfycbwpv1biSoYqG_OuhQx9_rC6izIEGqaz9vIdD8VTYFAU_qkJ-provc7fm61JslVO2XRQ` ya
  ejecutados, ya en producción real para las 4 tiendas.
