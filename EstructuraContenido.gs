// EstructuraContenido.gs — mappers y acceso a la tabla `contenido` en Supabase.

function filaContenidoDesdeSupabase_(f) {
  return { descripcion: f.descripcion, cantidad: f.cantidad };
}

function filaContenidoHaciaSupabase_(idUnico, linea, creadoPor, fechaCreacion) {
  return { id_unico: idUnico, descripcion: linea.descripcion, cantidad: linea.cantidad, creado_por: creadoPor, fecha_creacion: fechaCreacion };
}

function leerTodoContenidoCrudo_() {
  // Nombre "Crudo" a propósito: a diferencia de sus hermanas (leerCargas_/leerEtiquetas_),
  // esta NO mapea a camelCase. obtenerMapaContenido_ (Backend.gs, task posterior) necesita
  // id_unico (snake_case) como clave del mapa, y filaContenidoDesdeSupabase_ lo descarta
  // a propósito (solo expone descripcion/cantidad hacia el resto de la app). No "arreglar"
  // añadiendo .map(filaContenidoDesdeSupabase_) aquí — perdería la clave del mapa.
  return supaGet_('contenido', null);
}

// Fase 2 del recorte de egress (2026-10-06): el contenido de UNAS etiquetas concretas
// (id_unico=in.(...)) en vez de la tabla entera (~2.000 filas, varias páginas) cada vez
// que se busca o se abre una carga. Misma forma que leerTodoContenidoCrudo_ (filas
// crudas, snake_case, con id_unico). Se pide en lotes de LOTE_IDS_CONTENIDO_ ids para
// que cada URL quede muy por debajo del límite de UrlFetchApp (~2 KB).
var LOTE_IDS_CONTENIDO_ = 60;

function leerContenidoCrudoPorIds_(idsUnico) {
  var vistos = {};
  var ids = [];
  (idsUnico || []).forEach(function (id) {
    var k = String(id);
    if (!vistos[k]) { vistos[k] = true; ids.push(k); }
  });
  var filas = [];
  for (var i = 0; i < ids.length; i += LOTE_IDS_CONTENIDO_) {
    var trozo = ids.slice(i, i + LOTE_IDS_CONTENIDO_);
    supaGet_('contenido', 'id_unico=in.(' + trozo.map(function (id) { return encodeURIComponent(id); }).join(',') + ')')
      .forEach(function (f) { filas.push(f); });
  }
  return filas;
}

function borrarContenidoPorIdUnico_(idUnico) {
  supaBorrar_('contenido', 'id_unico=eq.' + encodeURIComponent(idUnico));
}

function insertarContenido_(idUnico, lineas, creadoPor) {
  // El caller (guardarContenidoSoporte, Backend.gs) debe garantizar lineas no vacío;
  // este guard es solo una red de seguridad para evitar un POST vacío a Supabase.
  if (!lineas.length) return;
  var ahora = new Date().toISOString();
  var filas = lineas.map(function (l) { return filaContenidoHaciaSupabase_(idUnico, l, creadoPor, ahora); });
  supaInsertar_('contenido', filas);
}
