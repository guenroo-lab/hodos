// SupabaseCliente.gs — cliente REST genérico contra PostgREST (Supabase). Ningún otro
// archivo debe llamar a UrlFetchApp para hablar con Supabase: todo pasa por aquí.

var SUPA_CONFIG_MEMO_ = null;

function supaConfig_() {
  // Memoizado por ejecución: PropertiesService no cambia a mitad de una ejecución de
  // Apps Script, y varias llamadas supa*_ dentro de la misma función acaban leyendo la
  // config repetidamente si no se cachea (mismo patrón que lm_producción/Configuracion.gs).
  if (SUPA_CONFIG_MEMO_) return SUPA_CONFIG_MEMO_;
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('SUPABASE_URL');
  var key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL/SUPABASE_SERVICE_KEY en Propiedades del script');
  SUPA_CONFIG_MEMO_ = { url: url, key: key };
  return SUPA_CONFIG_MEMO_;
}

function supaCabeceras_(schema) {
  var cfg = supaConfig_();
  var h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' };
  if (schema) h['Accept-Profile'] = schema;
  return h;
}

// Bug real (2026-08-12): buscarEtiquetas (Backend.gs) lee toda la tabla `etiquetas` sin
// filtro (leerEtiquetas_(null)) para filtrar en memoria. PostgREST limita cualquier
// respuesta sin paginar a un máximo de filas (por defecto en Supabase, 1000) — al pasar
// la tabla de esa cifra (1084 en el momento de este fix), una petición sin más quedaba
// truncada EN SILENCIO, sin error, así que las etiquetas más recientes simplemente no
// llegaban a compararse contra los filtros de búsqueda. Por eso obtenerPendientesPorTienda
// (que filtra por estado=eq.REGISTRADO, un subconjunto mucho más pequeño) nunca lo sufrió,
// pero buscarEtiquetas sí.
var SUPA_PAGE_SIZE_ = 1000;

function supaGet_(tabla, filtroPostgrest, columnas, schema) {
  var cfg = supaConfig_();
  var select = 'select=' + (columnas || '*');
  var filtro = filtroPostgrest || '';

  // Si el caller ya pide un límite explícito (p.ej. "...&limit=1"), es una consulta
  // deliberadamente acotada — se respeta tal cual, una sola petición, sin paginar.
  if (/(^|&)limit=/.test(filtro)) {
    var urlAcotada = cfg.url + '/rest/v1/' + tabla + '?' + select + (filtro ? '&' + filtro : '');
    var respAcotada = UrlFetchApp.fetch(urlAcotada, { method: 'get', headers: supaCabeceras_(schema), muteHttpExceptions: true });
    if (respAcotada.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + respAcotada.getContentText());
    return JSON.parse(respAcotada.getContentText());
  }

  // Bug real (2026-08-12, mismo día del fix anterior): la primera versión de este fix
  // añadía "order=id_unico.asc" por defecto cuando el caller no pedía orden — pero
  // id_unico solo existe en la tabla `etiquetas`. Cualquier otra tabla sin esa columna
  // (p.ej. `cargas`, que usa id_carga) rompía con "column X.id_unico does not exist" en
  // CUALQUIER lectura sin filtro (buscarYMostrar('tienda'), listarCargasAbiertas_, etc.).
  // No hay una columna "obviamente correcta" común a todas las tablas de este proyecto
  // sin acoplar supaGet_ (genérico) al esquema de una tabla concreta — se pagina sin
  // forzar ningún order() por defecto. Esto no empeora nada respecto a antes de este
  // fix (leerEtiquetas_(null) tampoco pedía order antes), solo arregla el truncado
  // silencioso; si el caller quiere un orden estable entre páginas, que lo pida él
  // mismo en filtroPostgrest, como ya hace obtenerPendientesPorTienda.
  var url = cfg.url + '/rest/v1/' + tabla + '?' + select + (filtro ? '&' + filtro : '');

  // Bug real (2026-09-23, revisión de seguridad), dos partes que solo se arreglan
  // juntas:
  // (1) "pagina.length < SUPA_PAGE_SIZE_" para decidir "última página" asume que el
  // tamaño de página que de verdad aplica PostgREST es siempre SUPA_PAGE_SIZE_ (1000)
  // — pero eso es solo lo que ESTE cliente pidió, no lo que el servidor puede haber
  // devuelto de verdad si el "Max Rows" configurado en el proyecto Supabase (Project
  // Settings → API) fuera menor. Si eso pasara, una página pedida como 0-999 podría
  // volver truncada (p.ej. 500 filas) y "500 < 1000" haría creer que ya no quedan más
  // páginas — mismo truncado silencioso que el incidente real ya documentado (ver
  // comentario de arriba, v48).
  // (2) Aunque se detecte que quedan más páginas, seguir pidiendo "desde += 1000" a
  // ciegas SALTARÍA las filas 500-999 de este ejemplo (el servidor las capó, nunca
  // llegaron a `todas`, y la siguiente petición empezaría en 1000). El avance real
  // tiene que ser por lo que el servidor DEVOLVIÓ (pagina.length), no por lo que este
  // cliente pidió.
  // Prefer: count=exact hace que PostgREST devuelva el total real en la cabecera
  // Content-Range ("0-499/1234") — se seguimos pidiendo mientras lo acumulado no
  // llegue a ese total. Si por lo que sea no viene (versión vieja de PostgREST,
  // cabecera ausente), se cae al heurístico anterior (longitud de página) como red de
  // seguridad — ni mejor ni peor que el comportamiento ya aceptado antes de este fix.
  var todas = [];
  var desde = 0;
  while (true) {
    var cabeceras = supaCabeceras_(schema);
    cabeceras.Range = desde + '-' + (desde + SUPA_PAGE_SIZE_ - 1);
    cabeceras.Prefer = 'count=exact';
    var resp = UrlFetchApp.fetch(url, { method: 'get', headers: cabeceras, muteHttpExceptions: true });
    if (resp.getResponseCode() >= 300) throw new Error('supaGet_(' + tabla + '): ' + resp.getContentText());
    var pagina = JSON.parse(resp.getContentText());
    todas = todas.concat(pagina);
    if (pagina.length === 0) break; // red de seguridad: nunca bucle infinito si el rango pedido ya no devuelve nada

    var cabecerasResp = resp.getHeaders ? resp.getHeaders() : {};
    var contentRange = cabecerasResp['Content-Range'] || cabecerasResp['content-range'] || '';
    var totalConocido = /\/(\d+)$/.exec(contentRange);
    if (totalConocido) {
      if (todas.length >= Number(totalConocido[1])) break;
    } else if (pagina.length < SUPA_PAGE_SIZE_) {
      break;
    }
    desde += pagina.length;
  }
  return todas;
}

function supaInsertar_(tabla, filas) {
  var cfg = supaConfig_();
  var cabeceras = supaCabeceras_();
  cabeceras.Prefer = 'return=representation';
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla, {
    method: 'post',
    headers: cabeceras,
    payload: JSON.stringify(filas),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaInsertar_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function supaActualizar_(tabla, filtroPostgrest, cambios) {
  var cfg = supaConfig_();
  var cabeceras = supaCabeceras_();
  cabeceras.Prefer = 'return=representation';
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla + '?' + filtroPostgrest, {
    method: 'patch',
    headers: cabeceras,
    payload: JSON.stringify(cambios),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaActualizar_(' + tabla + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}

function supaBorrar_(tabla, filtroPostgrest) {
  var cabeceras = supaCabeceras_();
  cabeceras.Prefer = 'return=representation';
  var cfg = supaConfig_();
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + tabla + '?' + filtroPostgrest, {
    method: 'delete',
    headers: cabeceras,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaBorrar_(' + tabla + '): ' + resp.getContentText());
  // return=representation: las filas realmente borradas (puede ser un array vacío si
  // el filtro no encontró ninguna, p.ej. un borrado condicionado a un estado que ya
  // cambió). El caller que necesite saberlo puede mirar la longitud del array.
  return JSON.parse(resp.getContentText());
}

function supaRpc_(nombreFuncion, parametros) {
  var cfg = supaConfig_();
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + nombreFuncion, {
    method: 'post',
    headers: supaCabeceras_(),
    payload: JSON.stringify(parametros || {}),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) throw new Error('supaRpc_(' + nombreFuncion + '): ' + resp.getContentText());
  return JSON.parse(resp.getContentText());
}
