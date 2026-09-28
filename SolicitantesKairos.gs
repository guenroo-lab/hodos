// SolicitantesKairos.gs — cruce de solo lectura contra el esquema
// `preparacion` de Kairos (mismo proyecto Supabase) para mostrar quién
// pidió cada soporte/palet en la Carta de Portes. Aditivo: si algo falla
// o no hay match, se degrada a "—", nunca rompe el documento.

var TIENDA_KAIROS_POR_NOMBRE_ = { 'Marbella': '014', 'Mijas': '279' };

function _bareSscc_(valorSscc) {
  return String(valorSscc || '').split(' + ').map(function (parte) {
    var m = parte.trim().match(/^(.+?)\s*\(/);
    return m ? m[1].trim() : parte.trim();
  });
}

function _textoSolicitante_(peticion) {
  if (!peticion) return null;
  var motivo = peticion.tipo === 'refill' ? peticion.motivo : peticion.comentario;
  return { ldap: peticion.solicitanteLdap, motivo: motivo || null };
}

/** idsUnico: array de etiquetas.id_unico de esta carga.
 *  Devuelve mapa idUnico -> {ldap, motivo} (ausente si no hay match). */
function _solicitantesPorIdUnico_(idsUnico) {
  if (!idsUnico.length) return {};
  try {
    var lineas = supaGet_('lineas', 'hodos_id=in.(' + idsUnico.map(encodeURIComponent).join(',') + ')',
      'hodos_id,peticion_id', 'preparacion');
    if (!lineas.length) return {};
    var idsPeticion = lineas.map(function (l) { return l.peticion_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var peticiones = supaGet_('peticiones', 'id=in.(' + idsPeticion.map(encodeURIComponent).join(',') + ')',
      'id,tipo,solicitante_ldap,motivo,comentario', 'preparacion');
    var porPeticion = {};
    peticiones.forEach(function (p) {
      porPeticion[p.id] = _textoSolicitante_({ tipo: p.tipo, solicitanteLdap: p.solicitante_ldap, motivo: p.motivo, comentario: p.comentario });
    });
    var mapa = {};
    lineas.forEach(function (l) { if (porPeticion[l.peticion_id]) mapa[l.hodos_id] = porPeticion[l.peticion_id]; });
    return mapa;
  } catch (err) {
    Logger.log('AVISO: no se pudo cruzar solicitantes Kairos (pedidos): ' + err);
    return {};
  }
}

/** destino: carga.destino (nombre de tienda HODOS, p.ej. "Marbella").
 *  ssccList: array de public.palets.sscc de esta carga.
 *  Devuelve mapa sscc -> {ldap, motivo}. Sin match si la tienda no es de
 *  Kairos (Málaga/Granada no tienen refill Kairos hoy) o no hay palets. */
function _solicitantesPorSscc_(destino, ssccList) {
  var tienda = TIENDA_KAIROS_POR_NOMBRE_[destino];
  if (!tienda || !ssccList.length) return {};
  try {
    var lineas = supaGet_('lineas',
      'sscc=not.is.null&peticiones.tipo=eq.refill&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) +
      '&select=sscc,peticion_id,peticiones!inner(tienda_origen,tipo)',
      null, 'preparacion');
    if (!lineas.length) return {};
    var idsPeticion = lineas.map(function (l) { return l.peticion_id; })
      .filter(function (v, i, a) { return a.indexOf(v) === i; });
    var peticiones = supaGet_('peticiones', 'id=in.(' + idsPeticion.map(encodeURIComponent).join(',') + ')',
      'id,tipo,solicitante_ldap,motivo,comentario', 'preparacion');
    var porPeticion = {};
    peticiones.forEach(function (p) {
      porPeticion[p.id] = _textoSolicitante_({ tipo: p.tipo, solicitanteLdap: p.solicitante_ldap, motivo: p.motivo, comentario: p.comentario });
    });
    var porBareSscc = {};
    lineas.forEach(function (l) {
      var info = porPeticion[l.peticion_id];
      if (!info) return;
      _bareSscc_(l.sscc).forEach(function (bare) { porBareSscc[bare] = info; });
    });
    var mapa = {};
    ssccList.forEach(function (s) { if (porBareSscc[s]) mapa[s] = porBareSscc[s]; });
    return mapa;
  } catch (err) {
    Logger.log('AVISO: no se pudo cruzar solicitantes Kairos (refill): ' + err);
    return {};
  }
}
