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
