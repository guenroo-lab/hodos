// EstructuraSheets.gs — mappers y acceso a la tabla `etiquetas` en Supabase.

function filaEtiquetaDesdeSupabase_(f) {
  return {
    idUnico: f.id_unico,
    numeroPedido: f.numero_pedido,
    soporteNum: f.soporte_num,
    soporteTotal: f.soporte_total,
    origen: f.origen,
    subtipo: f.subtipo,
    origenTexto: f.origen_texto,
    destino: f.destino,
    fechaCreacion: f.fecha_creacion,
    loteId: f.lote_id,
    creadoPor: f.creado_por,
    estado: f.estado,
    bateaId: f.batea_id,
    fechaEnvio: f.fecha_envio,
    origenTienda: f.origen_tienda,
    razonFlujo: f.razon_flujo,
    pendienteImpresionIncpc: f.pendiente_impresion_incpc,
    expedicion: f.expedicion
  };
}

function filaEtiquetaHaciaSupabase_(obj) {
  var fila = {};
  if (obj.idUnico !== undefined) fila.id_unico = obj.idUnico;
  if (obj.numeroPedido !== undefined) fila.numero_pedido = obj.numeroPedido;
  if (obj.soporteNum !== undefined) fila.soporte_num = obj.soporteNum;
  if (obj.soporteTotal !== undefined) fila.soporte_total = obj.soporteTotal;
  if (obj.origen !== undefined) fila.origen = obj.origen;
  if (obj.subtipo !== undefined) fila.subtipo = obj.subtipo;
  if (obj.origenTexto !== undefined) fila.origen_texto = obj.origenTexto;
  if (obj.destino !== undefined) fila.destino = obj.destino;
  if (obj.fechaCreacion !== undefined) fila.fecha_creacion = obj.fechaCreacion;
  if (obj.loteId !== undefined) fila.lote_id = obj.loteId;
  if (obj.creadoPor !== undefined) fila.creado_por = obj.creadoPor;
  if (obj.estado !== undefined) fila.estado = obj.estado;
  if (obj.bateaId !== undefined) fila.batea_id = obj.bateaId;
  if (obj.fechaEnvio !== undefined) fila.fecha_envio = obj.fechaEnvio;
  if (obj.origenTienda !== undefined) fila.origen_tienda = obj.origenTienda;
  if (obj.razonFlujo !== undefined) fila.razon_flujo = obj.razonFlujo;
  if (obj.pendienteImpresionIncpc !== undefined) fila.pendiente_impresion_incpc = obj.pendienteImpresionIncpc;
  if (obj.expedicion !== undefined) fila.expedicion = obj.expedicion;
  return fila;
}

// `columnas` (opcional, 2026-10-06): lista PostgREST de columnas reales ('lote_id,destino') --
// el resultado sigue mapeado a camelCase pero solo con esos campos rellenos (el resto
// queda undefined). Para lecturas que solo usan unos pocos campos de una tabla grande.
function leerEtiquetas_(filtroPostgrest, columnas) {
  return supaGet_('etiquetas', filtroPostgrest, columnas).map(filaEtiquetaDesdeSupabase_);
}

function insertarEtiquetas_(filasEtiquetas) {
  var filas = filasEtiquetas.map(filaEtiquetaHaciaSupabase_);
  var insertadas = supaInsertar_('etiquetas', filas);
  if (insertadas.length === 0) throw new Error('insertarEtiquetas_: Supabase no devolvió las filas insertadas');
  return insertadas.map(filaEtiquetaDesdeSupabase_);
}

function actualizarEtiquetaCondicional_(idUnico, cambios, filtroExtra) {
  // A diferencia de insertarEtiquetas_, aquí un array vacío NO es un error: es la señal
  // de que otro escaneo se llevó esta fila entre la lectura y la escritura (concurrencia
  // optimista en escanearSoporte) — el caller reintenta el ciclo completo. No lanzar aquí.
  var filtro = 'id_unico=eq.' + encodeURIComponent(idUnico) + (filtroExtra ? '&' + filtroExtra : '');
  return supaActualizar_('etiquetas', filtro, filaEtiquetaHaciaSupabase_(cambios)).map(filaEtiquetaDesdeSupabase_);
}

function siguienteBloqueIdsEtiquetas_(cantidad) {
  return supaRpc_('siguiente_bloque_ids_etiquetas', { p_cantidad: cantidad });
}

function borrarEtiquetaPorIdUnico_(idUnico) {
  // El contenido asociado (tabla `contenido`) se borra solo vía ON DELETE CASCADE en
  // Supabase (ver DDL) — no hace falta borrarlo aquí explícitamente.
  supaBorrar_('etiquetas', 'id_unico=eq.' + encodeURIComponent(idUnico));
}

// Variante condicionada (agruparSoportesAdmin, Backend.gs): borra solo si el soporte
// sigue en el estado esperado en el momento exacto del DELETE — devuelve false sin
// lanzar si alguien lo cambió justo antes (p.ej. un escaneo se adelantó), en vez de
// borrarlo a ciegas por debajo de ese cambio.
function borrarEtiquetaCondicionalPorIdUnico_(idUnico, filtroExtra) {
  var filtro = 'id_unico=eq.' + encodeURIComponent(idUnico) + (filtroExtra ? '&' + filtroExtra : '');
  return supaBorrar_('etiquetas', filtro).length > 0;
}

// ── Subtipo dinámico: la lista base + cualquier subtipo Taisa ya usado en Supabase,
// para que un tipo nuevo (ej. traído automáticamente por la integración INCPC) aparezca
// seleccionable en el desplegable sin tener que tocar código. Ver Index.html. ──

var OPCIONES_SUBTIPO_BASE_ = ['Devolución', 'Inventario', 'Demarca', 'Petición Reserva', 'Sobrante', 'Ean Erroneo', 'Anulado', 'Rotura', 'Pedido cliente'];

function obtenerSubtiposConocidos() {
  // Los subtipos distintos los calcula Postgres (función `subtipos_taisa_usados`,
  // migraciones/2026-10-15-*.sql, en orden de primera aparición): antes se bajaba la columna
  // `subtipo` de todas las etiquetas Taisa (2.508 filas en 3 viajes) para quedarse con ~26 valores.
  var filas = supaRpc_('subtipos_taisa_usados', {});
  var vistos = {};
  var todos = OPCIONES_SUBTIPO_BASE_.slice();
  filas.forEach(function (f) {
    var s = f.subtipo;
    if (s && !vistos[s] && todos.indexOf(s) === -1) {
      vistos[s] = true;
      todos.push(s);
    }
  });
  return todos;
}
