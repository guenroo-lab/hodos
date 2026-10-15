// EstructuraCargas.gs — mappers y acceso a la tabla `cargas` en Supabase.

function filaCargaDesdeSupabase_(f) {
  return {
    idCarga: f.id_carga,
    destino: f.destino,
    fechaEntrega: f.fecha_entrega,
    horario: f.horario,
    estado: f.estado,
    creadaPor: f.creada_por,
    fechaCreacion: f.fecha_creacion,
    cerradaPor: f.cerrada_por,
    fechaCierre: f.fecha_cierre,
    pdfUrl: f.pdf_url,
    emailEnviado: f.email_enviado,
    cargador: f.cargador,
    reabiertaPor: f.reabierta_por,
    reabiertaEn: f.reabierta_en,
    b2bConteo: f.b2b_conteo
  };
}

function filaCargaHaciaSupabase_(obj) {
  var fila = {};
  if (obj.idCarga !== undefined) fila.id_carga = obj.idCarga;
  if (obj.destino !== undefined) fila.destino = obj.destino;
  if (obj.fechaEntrega !== undefined) fila.fecha_entrega = obj.fechaEntrega;
  if (obj.horario !== undefined) fila.horario = obj.horario;
  if (obj.estado !== undefined) fila.estado = obj.estado;
  if (obj.creadaPor !== undefined) fila.creada_por = obj.creadaPor;
  if (obj.cerradaPor !== undefined) fila.cerrada_por = obj.cerradaPor;
  if (obj.fechaCierre !== undefined) fila.fecha_cierre = obj.fechaCierre;
  if (obj.pdfUrl !== undefined) fila.pdf_url = obj.pdfUrl;
  if (obj.emailEnviado !== undefined) fila.email_enviado = obj.emailEnviado;
  if (obj.cargador !== undefined) fila.cargador = obj.cargador;
  if (obj.reabiertaPor !== undefined) fila.reabierta_por = obj.reabiertaPor;
  if (obj.reabiertaEn !== undefined) fila.reabierta_en = obj.reabiertaEn;
  if (obj.b2bConteo !== undefined) fila.b2b_conteo = obj.b2bConteo;
  return fila;
}

function insertarCarga_(datosCarga) {
  var insertadas = supaInsertar_('cargas', [filaCargaHaciaSupabase_(datosCarga)]);
  if (insertadas.length === 0) throw new Error('insertarCarga_: Supabase no devolvió la fila insertada');
  return filaCargaDesdeSupabase_(insertadas[0]);
}

function leerCargas_(filtroPostgrest) {
  return supaGet_('cargas', filtroPostgrest).map(filaCargaDesdeSupabase_);
}

function actualizarCarga_(idCarga, cambios) {
  var actualizadas = supaActualizar_('cargas', 'id_carga=eq.' + encodeURIComponent(idCarga), filaCargaHaciaSupabase_(cambios));
  if (actualizadas.length === 0) throw new Error('actualizarCarga_: no se encontró la carga ' + idCarga);
  return filaCargaDesdeSupabase_(actualizadas[0]);
}

// Concurrencia optimista para cargas (mismo patrón que actualizarEtiquetaCondicional_
// en EstructuraSheets.gs, usado por escanearSoporte): PATCH condicionado a un filtro
// extra (p.ej. "estado=eq.ABIERTA"). Un array vacío NO es un error aquí — es la señal
// de que otra ejecución ya cambió esa carga entre la lectura y la escritura (dos
// cierres casi simultáneos, doble clic). El caller decide qué hacer con eso.
function actualizarCargaCondicional_(idCarga, cambios, filtroExtra) {
  var filtro = 'id_carga=eq.' + encodeURIComponent(idCarga) + (filtroExtra ? '&' + filtroExtra : '');
  var actualizadas = supaActualizar_('cargas', filtro, filaCargaHaciaSupabase_(cambios));
  return actualizadas.length > 0 ? filaCargaDesdeSupabase_(actualizadas[0]) : null;
}
