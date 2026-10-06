// IntegracionIncpc.gs — recibe peticiones del proyecto INCPC (Taisa Málaga,
// C:\Users\30081048\Desktop\Proyectos\INCPC) para crear etiquetas HODOS
// automáticamente a partir de incidencias/devoluciones marcadas para envío.
// Ver docs/superpowers/specs/2026-08-05-integracion-incpc-hodos-design.md.

function doPost(e) {
  var respuesta;
  try {
    var datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('INCPC_SHARED_TOKEN');
    if (!tokenEsperado || datos.token !== tokenEsperado) {
      respuesta = { ok: false, error: 'Token inválido' };
    } else if (datos.accion === 'registrarLoteArrastre') {
      respuesta = crearLoteArrastreDesdeMacroArrastres_(datos);
    } else if (datos.accion === 'registrarLoteMeco') {
      respuesta = crearLoteMecoDesdeMacroArrastres_(datos);
    // Gestión de etiquetas de arrastres desde fuera de HODOS (Panel Arrastres,
    // pestaña "Hodos", 2026-09-10): mismo webhook y token, 4 acciones nuevas
    // que envuelven las funciones que ya usa el propio Index.html de HODOS.
    } else if (datos.accion === 'listarPendientesArrastre') {
      respuesta = { ok: true, etiquetas: obtenerEtiquetasPendientesArrastre(datos.origen) };
    } else if (datos.accion === 'htmlPendientesArrastre') {
      respuesta = { ok: true, html: htmlPendientesArrastre(datos.origen) };
    } else if (datos.accion === 'marcarImpresasArrastre') {
      respuesta = { ok: true, resultado: marcarImpresasArrastre(datos.origen) };
    } else if (datos.accion === 'borrarEtiquetasArrastre') {
      respuesta = { ok: true, resultado: borrarSoportesAdmin(datos.idsUnicos) };
    // Insignias numéricas de las pestañas de arrastres de Panel Arrastres
    // (2026-10-05): los mismos contadores que la barra lateral de HODOS, en una
    // sola consulta ligera (en vez de 4 listados completos, que releen la tabla
    // `etiquetas` entera cada uno).
    } else if (datos.accion === 'contarPendientesArrastre') {
      respuesta = { ok: true, cuentas: contarEtiquetasPendientesPorPestana() };
    // Imprimir las "Petición Reserva" desde fuera de HODOS (Kairos, pestaña HODOS
    // del jefe, 2026-10-05): la etiqueta sale IGUAL que desde la pestaña "Prep.
    // Pedidos" porque la genera este mismo código (htmlUnaEtiqueta_); solo cambia
    // que se piden por id en vez de "todas las pendientes".
    } else if (datos.accion === 'htmlEtiquetasPreparacion') {
      respuesta = { ok: true, html: htmlEtiquetasPreparacionPorIds_(datos.idsUnicos) };
    } else if (datos.accion === 'marcarImpresasPreparacion') {
      respuesta = { ok: true, resultado: marcarImpresasPreparacionPorIds_(datos.idsUnicos) };
    // Precarga Inversa (2026-10-06): la app de Plataforma consume/devuelve torres al
    // bipar su etiqueta en el camión de Torija. Ver PrecargaInversa.gs.
    } else if (datos.accion === 'consumirTorreInversa' || datos.accion === 'devolverTorreInversa') {
      respuesta = procesarAccionInversa_(datos);
    } else {
      var idUnico = crearEtiquetaDesdeIncpc_(datos);
      respuesta = { ok: true, idUnico: idUnico };
    }
  } catch (err) {
    respuesta = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

// Defensa adicional del lado HODOS (2026-08-11, ver CLAUDE.md — bug real: pedido 514281
// duplicado en HODOS-001584/001585 pese a los arreglos del lado INCPC). No depende de que
// INCPC nunca vuelva a mandar la misma incidencia dos veces — si ya existe una etiqueta
// para el mismo pedido+destino+tipo creada por esta integración en los últimos
// UMBRAL_DUPLICADO_INCPC_MS_, se devuelve esa en vez de crear otra. Ventana corta a
// propósito: de sobra para cualquier reintento/race real, pero no bloquea un pedido que
// legítimamente vuelva a tener el mismo tipo de incidencia más tarde el mismo día.
var UMBRAL_DUPLICADO_INCPC_MS_ = 3 * 60 * 1000;

function _etiquetaIncpcReciente_(pedido, destino, tipo) {
  var desdeIso = new Date(Date.now() - UMBRAL_DUPLICADO_INCPC_MS_).toISOString();
  var filtro = 'origen=eq.Taisa'
    + '&destino=eq.' + encodeURIComponent(destino)
    + '&subtipo=eq.' + encodeURIComponent(tipo)
    + '&numero_pedido=eq.' + encodeURIComponent(pedido)
    + '&fecha_creacion=gte.' + encodeURIComponent(desdeIso)
    + '&order=fecha_creacion.desc&limit=1';
  var filas = leerEtiquetas_(filtro);
  return filas.length > 0 ? filas[0].idUnico : null;
}

// Punto de entrada compartido por dos integraciones externas de Taisa:
// - INCPC (incidencias/devoluciones): un único {referencia, cantidad} por etiqueta.
// - Preparación de Pedidos (2026-08-13, subtipo fijo "Petición Reserva"): un pedido
//   puede tener varias referencias, así que admite `datos.items` (array) además del
//   `datos.referencia` único original — ambas formas conviven, retrocompatible.
function crearEtiquetaDesdeIncpc_(datos) {
  var destino = normalizarDestinoIncpc_(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  if (!datos.pedido) throw new Error('Falta el número de pedido');
  if (!datos.tipo) throw new Error('Falta el tipo de incidencia');

  var pedido = String(datos.pedido).trim();
  var tipo = String(datos.tipo).trim();

  var existente = _etiquetaIncpcReciente_(pedido, destino, tipo);
  if (existente) return existente;

  var esPreparacion = datos.origenIntegracion === 'preparacion';
  var creadoPor = (esPreparacion ? 'Preparación Pedidos · ' : 'INCPC · ') + (datos.operario || 'desconocido');

  var resultado = registrarLote({
    origen: 'Taisa',
    subtipo: tipo,
    destino: destino,
    pedidosTexto: pedido,
    creadoPor: creadoPor
  });
  var idUnico = resultado.ids[0];

  // Contenido: uno o varios {referencia, cantidad}.
  var itemsBrutos = Array.isArray(datos.items) && datos.items.length
    ? datos.items
    : (String(datos.referencia || '').trim() ? [{ referencia: datos.referencia, cantidad: datos.cantidad }] : []);
  if (itemsBrutos.length) {
    var contenido = itemsBrutos
      .filter(function (it) { return String(it.referencia || '').trim(); })
      .map(function (it) { return { descripcion: String(it.referencia).trim(), cantidad: Number(it.cantidad) || 0 }; });
    if (contenido.length) guardarContenidoSoporte(idUnico, contenido, creadoPor);
  }

  // Misma bandera "pendiente de imprimir" para las dos integraciones — las pestañas
  // INCPC y Prep. Pedidos del panel se separan filtrando por subtipo (ver
  // obtenerEtiquetasPendientesIncpc/Preparacion más abajo), no hace falta una columna
  // nueva en Supabase.
  actualizarEtiquetaCondicional_(idUnico, { pendienteImpresionIncpc: true });

  return idUnico;
}

// Plataformas de arrastre. Cada una tiene su propia pestaña en Index.html, bajo el
// rótulo ARRASTRES, y su propio valor en la columna `origen` de Supabase.
//
// OJO CON LAS MAYÚSCULAS — comprobado contra los datos reales antes de escribir esto
// (2026-09-07): "Cargar lote" ya deja crear Valencia/Torija/Antequera a mano desde
// hace semanas (738/341/565 etiquetas ya existentes), y las tres usan mayúscula solo
// en la inicial, exactamente como en <option value="Valencia">Valencia</option> del
// propio Index.html. Solo MECO va en mayúsculas — así lo hardcodeaba
// crearLoteMecoDesdeMacroArrastres_ desde el principio, independiente de lo que mande
// MacroArrastres. Esta lista usa las cuatro grafías EXACTAS que ya hay en producción;
// escribir 'VALENCIA' aquí habría dejado sin pestaña a las etiquetas que ya existen.
var ORIGENES_ARRASTRE_ = ['MECO', 'Valencia', 'Torija', 'Antequera'];

// Un origen que no esté en la lista es un error, no una consulta sin filtro: si se
// dejara pasar, marcarImpresasArrastre marcaría como impresas etiquetas que no son.
// Comparación insensible a mayúsculas en la ENTRADA (para que MacroArrastres no tenga
// que acertar la grafía exacta), pero SIEMPRE devuelve la grafía canónica de la lista,
// que es la que hay que guardar y comparar en Supabase.
function _validarOrigenArrastre_(origen) {
  var limpio = String(origen || '').trim();
  for (var i = 0; i < ORIGENES_ARRASTRE_.length; i++) {
    if (ORIGENES_ARRASTRE_[i].toLowerCase() === limpio.toLowerCase()) return ORIGENES_ARRASTRE_[i];
  }
  throw new Error('Origen de arrastre no reconocido: "' + origen + '"');
}

// Integración con MacroArrastres: un lote de pedidos por tienda y plataforma, sin
// subtipo (el subtipo solo tiene sentido para origen Taisa, ver subtipoEfectivo en
// Utilidades.gs). Ver
// MacroArrastres/docs/superpowers/specs/2026-09-07-arrastres-web-y-hodos-design.md.
function crearLoteArrastreDesdeMacroArrastres_(datos) {
  var origen = _validarOrigenArrastre_(datos.origen);
  var destino = validarTienda(datos.destino);
  if (!destino) throw new Error('Tienda destino no reconocida: "' + datos.destino + '"');
  var pedidosTexto = String(datos.pedidosTexto || '').trim();
  if (!pedidosTexto) throw new Error('Falta la lista de pedidos');

  var expedicion = String(datos.expedicion || '').trim();
  var nombreBonito = origen.charAt(0) + origen.slice(1).toLowerCase();
  var creadoPor = 'MacroArrastres (' + nombreBonito + ') · ' + (datos.operario || 'desconocido');

  // Antiduplicado por EXPEDICIÓN, no por fecha: un mismo pedido puede llegar varias
  // veces el mismo día, pero cada llegada es una expedición distinta y necesita su
  // etiqueta (dato de Pedro, 2026-09-07). Sin expedición no se deduplica: mejor una
  // etiqueta de más, que se ve y se tira, que una de menos, que no se ve.
  var lineas = parsearLotePedidos(pedidosTexto);
  // Línea de abajo de la etiqueta (Antequera: "PED. PROV. 81406165", 2026-10-06): MacroArrastres manda
  // `sufijosOrigen`, un array alineado 1:1 con las líneas de pedidosTexto. Solo se usa si llega EXACTAMENTE
  // alineado; cualquier otra cosa se ignora (nunca descoloca etiquetas) y la etiqueta sale como siempre.
  var sufijos = (Array.isArray(datos.sufijosOrigen) && datos.sufijosOrigen.length === lineas.length)
    ? datos.sufijosOrigen.map(function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().substring(0, 60); })
    : [];

  // Solo MECO (dato del usuario, 2026-09-18): a diferencia del resto de orígenes, el
  // "número de pedido" de MECO identifica ya un SOPORTE físico, no un pedido con
  // posibles varios soportes — nunca debería repetirse dentro del mismo documento. Si
  // se repite, es un error del documento de origen, no un soporte real de más:
  // calcularSoportes (Utilidades.gs) trataría la repetición como "2 soportes del mismo
  // pedido" (1/2, 2/2) y generaría una etiqueta física de sobra. Se colapsa a la
  // primera aparición y se descartan las siguientes antes de seguir.
  if (origen === 'MECO') {
    var vistosMeco_ = {};
    var lineasSinDuplicar_ = lineas.filter(function (l) {
      if (vistosMeco_[l]) return false;
      vistosMeco_[l] = true;
      return true;
    });
    if (lineasSinDuplicar_.length !== lineas.length) {
      Logger.log('crearLoteArrastreDesdeMacroArrastres_ (MECO): ' + (lineas.length - lineasSinDuplicar_.length)
        + ' línea(s) duplicada(s) en el documento de origen, ignoradas: ' + lineas.join(','));
    }
    lineas = lineasSinDuplicar_;
    sufijos = [];   // MECO no manda sufijos; y al colapsar duplicados dejarían de estar alineados
  }

  var omitidos = [];
  // Bug real (2026-09-23, revisión de seguridad), dos partes:
  // (1) El antiduplicado leía+decidía+insertaba sin lock — check-then-act. Dos
  // llamadas casi simultáneas para la MISMA expedición (reintento de red desde el
  // Panel Arrastres tras un timeout, o doble clic en "Procesar") podían ver ambas
  // "nada creado todavía" e insertar el lote entero por duplicado — mismo tipo de
  // incidente ya documentado en CLAUDE.md (pedido 514281 duplicado, v47), pero sin
  // ninguna de las defensas que se añadieron entonces (esas solo cubren
  // crearEtiquetaDesdeIncpc_, el flujo de una sola etiqueta, no este de lotes).
  // LockService.getScriptLock() es barato aquí: esta función no se llama por cada
  // pedido escaneado (como escanearSoporte, que por eso usa concurrencia optimista),
  // solo una vez por lote de MacroArrastres.
  // (2) El antiduplicado era "por presencia" (mapa de booleanos): si el mismo
  // numeroPedido aparecía 3 veces en `lineas` (reprocesión corregida con soportes
  // adicionales legítimos) pero solo 1 fila ya existía en Supabase para esa
  // expedición, las 3 se omitían enteras — los 2 soportes nuevos y reales se
  // perdían en silencio. Ahora es "por cantidad": se omite una aparición por cada
  // fila que YA existe, y el resto (soportes de verdad nuevos) sí se crea.
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (expedicion) {
      var yaCreados = _conteoPedidosYaCreadosEnExpedicion_(origen, destino, expedicion);
      var nuevas = [], nuevosSufijos = [];
      lineas.forEach(function (l, i) {
        if (yaCreados[l] > 0) { yaCreados[l]--; omitidos.push(l); } else { nuevas.push(l); nuevosSufijos.push(sufijos[i] || ''); }
      });
      lineas = nuevas;
      if (sufijos.length) sufijos = nuevosSufijos;
    }
    if (lineas.length === 0) {
      return { ok: true, idsCreados: [], omitidos: omitidos };
    }

    var datosLote = {
      origen: origen, destino: destino, pedidosTexto: lineas.join('\n'),
      creadoPor: creadoPor, expedicion: expedicion
    };
    if (sufijos.length) datosLote.sufijosOrigen = sufijos;
    var resultado = registrarLote(datosLote);

    // Marca TODO el lote de una vez (por loteId) como pendiente de imprimir, para que
    // salga en la pestaña de su plataforma. Misma bandera que Incidencias/Peticiones de
    // Reserva; lo que cambia es el filtro de cada pestaña.
    supaActualizar_('etiquetas', 'lote_id=eq.' + encodeURIComponent(resultado.loteId), { pendiente_impresion_incpc: true });

    return { ok: true, idsCreados: resultado.ids, omitidos: omitidos };
  } finally {
    lock.releaseLock();
  }
}

// Devuelve { '99143242': 2, ... } con cuántas filas ya existen de cada pedido para esa
// plataforma, tienda y expedición (antes era un booleano — ver nota de bug arriba). El
// texto del pedido se compara entero: "99143242" y "99143242+99143337" son etiquetas
// físicas distintas y deben tratarse como distintas.
function _conteoPedidosYaCreadosEnExpedicion_(origen, destino, expedicion) {
  var filtro = 'origen=eq.' + encodeURIComponent(origen)
    + '&destino=eq.' + encodeURIComponent(destino)
    + '&expedicion=eq.' + encodeURIComponent(expedicion);
  var conteo = {};
  leerEtiquetas_(filtro).forEach(function (f) { conteo[f.numeroPedido] = (conteo[f.numeroPedido] || 0) + 1; });
  return conteo;
}

// Alias histórico: MacroArrastres todavía puede estar desplegado llamando a
// 'registrarLoteMeco' sin mandar expedición. En ese caso se conserva la vieja ventana
// de 3 minutos como red; en cuanto llega expedición, manda el criterio bueno.
function crearLoteMecoDesdeMacroArrastres_(datos) {
  datos = datos || {};
  if (!String(datos.expedicion || '').trim()) {
    var destinoLegacy = validarTienda(datos.destino);
    if (destinoLegacy && _loteMecoReciente_(destinoLegacy)) {
      return { ok: true, idsCreados: [], duplicado: true, motivo: 'Ya se procesó un ZIP de Meco para ' + destinoLegacy + ' hace menos de 3 min.' };
    }
  }
  var copia = {};
  Object.keys(datos).forEach(function (k) { copia[k] = datos[k]; });
  copia.origen = 'MECO';
  return crearLoteArrastreDesdeMacroArrastres_(copia);
}

// Antiduplicado si el mismo ZIP se sube dos veces (doble clic, reintento de
// red) — mismo espíritu que _etiquetaIncpcReciente_, pero por destino
// (un lote entero, no una etiqueta individual). Solo se usa cuando el ZIP no manda
// expedición (compatibilidad hacia atrás, ver crearLoteMecoDesdeMacroArrastres_).
function _loteMecoReciente_(destino) {
  var desdeIso = new Date(Date.now() - UMBRAL_DUPLICADO_INCPC_MS_).toISOString();
  var filtro = 'origen=eq.MECO&destino=eq.' + encodeURIComponent(destino)
    + '&creado_por=like.MacroArrastres*'
    + '&fecha_creacion=gte.' + encodeURIComponent(desdeIso) + '&limit=1';
  return leerEtiquetas_(filtro).length > 0;
}

// 2026-08-21: dirección NUEVA (HODOS -> INCPC) — hasta ahora la integración solo
// funcionaba al revés. Cuando agruparSoportesAdmin (Backend.gs) fusiona etiquetas y
// alguna venía de esta integración, hay que avisar a INCPC para que actualice la
// columna O de "Incidencias" (que si no, quedaría apuntando a un idUnico ya borrado).
// CORREGIDO (2026-08-21, en real): el CLAUDE.md de INCPC documentaba
// access:ANYONE_ANONYMOUS, pero su appsscript.json actual dice DOMAIN (comprobado con
// una llamada real: sin la cabecera Authorization, INCPC devolvía 401) — doc
// desactualizada, no el comportamiento real. Misma cabecera que ya usa la dirección
// contraria (enviarEtiquetaAHodos_ en INCPC): el propio OAuth token de HODOS como
// Bearer, más el token compartido de siempre en el cuerpo (dos capas, igual que
// siempre). Best-effort, no bloqueante (decisión explícita del usuario): el caller
// decide qué hacer si esto falla, aquí solo se reporta ok:false con el motivo, nunca
// se lanza un Error.
function notificarAgrupacionAIncpc_(idViejo, idNuevo) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INCPC_WEBAPP_URL');
  var token = props.getProperty('INCPC_SHARED_TOKEN');
  if (!url || !token) {
    return { ok: false, error: 'Faltan INCPC_WEBAPP_URL o INCPC_SHARED_TOKEN en Propiedades del script de HODOS' };
  }
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ accion: 'actualizarIdAgrupacion', idViejo: idViejo, idNuevo: idNuevo, token: token }),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    var json = JSON.parse(resp.getContentText());
    if (!json.ok) return { ok: false, error: json.error || 'INCPC devolvió un error sin detalle' };
    return { ok: true, actualizado: !!json.actualizado };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

var SUBTIPO_PREPARACION_PEDIDOS_ = 'Petición Reserva';

// Normaliza el valor bruto de la columna "Tienda/Batea" de INCPC (que puede llegar
// como "Malaga 1", "Malaga Sabado", con o sin acentos/mayúsculas) a una de las 4
// tiendas válidas de HODOS. Cualquier variante que empiece por "malaga" colapsa a
// "Málaga" (deliberado: en INCPC, Málaga tiene varias bateas/turnos, pero en HODOS
// solo existe una tienda Málaga). Devuelve '' si no reconoce el valor.
function normalizarDestinoIncpc_(valorBruto) {
  var limpio = String(valorBruto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  if (limpio.indexOf('malaga') === 0) return 'Málaga';
  if (limpio === 'marbella') return 'Marbella';
  if (limpio === 'granada') return 'Granada';
  if (limpio === 'mijas') return 'Mijas';
  return '';
}

// ── Pestañas "INCPC" y "Prep. Pedidos" en Index.html: etiquetas creadas por
// cada integración, pendientes de imprimirse en lote. Comparten la misma
// bandera pendiente_impresion_incpc (histórica, del nombre original) — se
// separan filtrando por subtipo, ya que "Petición Reserva" solo lo usa la
// integración de Preparación de Pedidos (ningún subtipo de INCPC coincide). ──

function obtenerEtiquetasPendientesIncpc() {
  // Reutiliza buscarEtiquetas (mismo shape completo que usa el Buscador Interno:
  // soporteNum/soporteTotal/estado/bateaId/etc.) para que la pestaña de Incidencias
  // pueda editar/borrar/reimprimir con exactamente el mismo mecanismo, sin duplicarlo.
  // ordenAscendente:true = más antigua primero (FIFO).
  // Excluye Peticiones de Reserva (mismo origen Taisa, subtipo fijo) Y las cuatro
  // plataformas de arrastre (sin subtipo -> pasarían el filtro de subtipo sin este 2º
  // exclude). Antes solo se excluía MECO, que era la única que existía: bug real, en
  // cuanto Valencia/Torija/Antequera empezaran a marcar pendienteImpresionIncpc se
  // habrían colado aquí.
  return buscarEtiquetas({ pendienteImpresionIncpc: true, ordenAscendente: true })
    .filter(function (f) {
      return f.subtipo !== SUBTIPO_PREPARACION_PEDIDOS_ && ORIGENES_ARRASTRE_.indexOf(f.origen) === -1;
    });
}

function _filtroNoArrastre_() {
  return 'origen=not.in.(' + ORIGENES_ARRASTRE_.join(',') + ')';
}

function htmlPendientesIncpc() {
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&subtipo=neq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) + '&' + _filtroNoArrastre_() + '&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de Incidencias PedidoCliente pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasIncpc() {
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&subtipo=neq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) + '&' + _filtroNoArrastre_(), { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}

function obtenerEtiquetasPendientesPreparacion() {
  return buscarEtiquetas({ pendienteImpresionIncpc: true, ordenAscendente: true })
    .filter(function (f) { return f.subtipo === SUBTIPO_PREPARACION_PEDIDOS_; });
}

function htmlPendientesPreparacion() {
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&subtipo=eq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) + '&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de Preparación de Pedidos pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasPreparacion() {
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&subtipo=eq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_), { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}

// ── Peticiones de Reserva pedidas POR ID (desde Kairos, vía webhook) ──
// Imprimir "todas las pendientes" (htmlPendientesPreparacion + marcarImpresasPreparacion)
// tiene un hueco: si se crea una etiqueta entre generar el HTML y marcar, queda marcada
// como impresa sin haberse impreso. Pedir exactamente los ids que se imprimen lo evita.
// Solo etiquetas de subtipo "Petición Reserva": este canal no sirve para ninguna otra.
var MAX_IDS_PREPARACION_ = 200;
var TROZO_IDS_PREPARACION_ = 30; // la URL de UrlFetchApp admite ~2 KB

function _idsUnicosPreparacion_(idsUnicos) {
  if (!Array.isArray(idsUnicos) || !idsUnicos.length) throw new Error('Faltan los ids de las etiquetas');
  var vistos = {};
  var ids = [];
  idsUnicos.forEach(function (id) {
    var limpio = String(id == null ? '' : id).trim();
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(limpio)) throw new Error('Id de etiqueta no válido: "' + limpio + '"');
    if (!vistos[limpio]) { vistos[limpio] = true; ids.push(limpio); }
  });
  if (ids.length > MAX_IDS_PREPARACION_) throw new Error('Demasiadas etiquetas de una vez (máximo ' + MAX_IDS_PREPARACION_ + ')');
  return ids;
}

function _trozosIdsPreparacion_(ids) {
  var trozos = [];
  for (var i = 0; i < ids.length; i += TROZO_IDS_PREPARACION_) trozos.push(ids.slice(i, i + TROZO_IDS_PREPARACION_));
  return trozos;
}

function _filtroIdsPreparacion_(trozo) {
  return 'subtipo=eq.' + encodeURIComponent(SUBTIPO_PREPARACION_PEDIDOS_) +
    '&id_unico=in.(' + trozo.map(encodeURIComponent).join(',') + ')';
}

function htmlEtiquetasPreparacionPorIds_(idsUnicos) {
  var ids = _idsUnicosPreparacion_(idsUnicos);
  var etiquetas = [];
  _trozosIdsPreparacion_(ids).forEach(function (trozo) {
    leerEtiquetas_(_filtroIdsPreparacion_(trozo)).forEach(function (e) { etiquetas.push(e); });
  });
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de Preparación de Pedidos con esos ids');
  // Más antigua primero (FIFO), igual que htmlPendientesPreparacion.
  etiquetas.sort(function (a, b) { return String(a.fechaCreacion) < String(b.fechaCreacion) ? -1 : (String(a.fechaCreacion) > String(b.fechaCreacion) ? 1 : 0); });
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasPreparacionPorIds_(idsUnicos) {
  var ids = _idsUnicosPreparacion_(idsUnicos);
  var cantidad = 0;
  _trozosIdsPreparacion_(ids).forEach(function (trozo) {
    var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&' + _filtroIdsPreparacion_(trozo), { pendiente_impresion_incpc: false });
    cantidad += actualizadas.length;
  });
  return { cantidad: cantidad };
}

// ── Pestañas de ARRASTRES en Index.html (Meco, Valencia, Torija, Antequera):
// mismo patrón que Incidencias/Peticiones de Reserva, pero filtrando por origen
// (los arrastres no llevan subtipo, ver crearLoteArrastreDesdeMacroArrastres_). ──

function obtenerEtiquetasPendientesArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  return buscarEtiquetas({ pendienteImpresionIncpc: true, ordenAscendente: true })
    .filter(function (f) { return f.origen === o; });
}

function htmlPendientesArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  var etiquetas = leerEtiquetas_('pendiente_impresion_incpc=eq.true&origen=eq.' + encodeURIComponent(o) + '&order=fecha_creacion.asc');
  if (etiquetas.length === 0) throw new Error('No hay etiquetas de ' + o + ' pendientes de imprimir');
  var tarjetas = etiquetas.map(function (e) {
    var fechaTxt = Utilities.formatDate(new Date(e.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaEtiqueta_(e, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas);
}

function marcarImpresasArrastre(origen) {
  var o = _validarOrigenArrastre_(origen);
  var actualizadas = supaActualizar_('etiquetas', 'pendiente_impresion_incpc=eq.true&origen=eq.' + encodeURIComponent(o), { pendiente_impresion_incpc: false });
  return { cantidad: actualizadas.length };
}

// ── Insignias numéricas de la barra lateral de Index.html: cuántas etiquetas
// pendientes de imprimir tiene cada pestaña con cola de impresión. Una sola consulta
// ligera (solo origen+subtipo de las filas con la bandera activa) en vez de llamar a
// las seis obtenerEtiquetasPendientes*, que releen la tabla `etiquetas` entera cada una.
//
// Cada pestaña cuenta EXACTAMENTE lo que lista (mismos criterios que
// obtenerEtiquetasPendientesIncpc/Preparacion/Arrastre), así la cifra de la insignia y
// la de la lista no pueden discrepar. Por eso no es un reparto exclusivo: una fila
// "Petición Reserva" con origen de arrastre (no debería existir) saldría en las dos
// pestañas, igual que sale en las dos listas. Las claves son las de data-tab/ARRASTRES_. ──
function contarPendientesPorPestana_(filas) {
  var cuentas = { incpc: 0, preparacion: 0, meco: 0, valencia: 0, torija: 0, antequera: 0 };
  filas.forEach(function (f) {
    var esArrastre = ORIGENES_ARRASTRE_.indexOf(f.origen) !== -1;
    if (f.subtipo === SUBTIPO_PREPARACION_PEDIDOS_) cuentas.preparacion++;
    else if (!esArrastre) cuentas.incpc++;
    if (esArrastre) cuentas[String(f.origen).toLowerCase()]++;
  });
  return cuentas;
}

function contarEtiquetasPendientesPorPestana() {
  // order=id_unico.asc: orden estable entre páginas de supaGet_ (ver nota en
  // buscarEtiquetas), por si algún día hay más de 1000 pendientes.
  var filas = supaGet_('etiquetas', 'pendiente_impresion_incpc=eq.true&order=id_unico.asc', 'origen,subtipo');
  return contarPendientesPorPestana_(filas);
}

// Alias históricos de Meco: los mantiene vivos porque Index.html y cualquier
// despliegue anterior pueden seguir llamándolos.
function obtenerEtiquetasPendientesMeco() { return obtenerEtiquetasPendientesArrastre('MECO'); }
function htmlPendientesMeco() { return htmlPendientesArrastre('MECO'); }
function marcarImpresasMeco() { return marcarImpresasArrastre('MECO'); }
