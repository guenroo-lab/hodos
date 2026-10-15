// SolicitantesKairos.gs — cruce de solo lectura contra el esquema
// `preparacion` de Kairos (mismo proyecto Supabase) para mostrar quién
// pidió cada soporte/palet en la Carta de Portes. Aditivo: si algo falla
// o no hay match, se degrada a "—", nunca rompe el documento.

var TIENDA_KAIROS_POR_NOMBRE_ = { 'Marbella': '014', 'Mijas': '279' };

// Las listas viajan en la URL (id=in.(uuid,…), or=(sscc.ilike.*…*,…)) y UrlFetchApp rechaza
// URLs de más de ~2 KB: se piden por lotes. Con estos tamaños el filtro ocupa ~1.200
// caracteres aun con todo percent-encoded (mismo criterio que los lotes de 30 de Kairos).
var KAIROS_UUID_POR_PETICION_ = 30;
var KAIROS_SSCC_POR_PETICION_ = 20;

function _trozosKairos_(lista, tamano) {
  var trozos = [];
  for (var i = 0; i < lista.length; i += tamano) trozos.push(lista.slice(i, i + tamano));
  return trozos;
}

function _unicosKairos_(lista) {
  return lista.filter(function (v, i, a) { return a.indexOf(v) === i; });
}

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

/** idsPeticion: uuids de preparacion.peticiones (sin repetir).
 *  Devuelve mapa idPeticion -> {ldap, motivo}. Lee por lotes (ver KAIROS_UUID_POR_PETICION_). */
function _textosPorPeticion_(idsPeticion) {
  var porPeticion = {};
  _trozosKairos_(idsPeticion, KAIROS_UUID_POR_PETICION_).forEach(function (trozo) {
    var peticiones = supaGet_('peticiones', 'id=in.(' + trozo.map(encodeURIComponent).join(',') + ')',
      'id,tipo,solicitante_ldap,motivo,comentario', 'preparacion');
    peticiones.forEach(function (p) {
      porPeticion[p.id] = _textoSolicitante_({ tipo: p.tipo, solicitanteLdap: p.solicitante_ldap, motivo: p.motivo, comentario: p.comentario });
    });
  });
  return porPeticion;
}

/** idsUnico: array de etiquetas.id_unico de esta carga.
 *  Devuelve mapa idUnico -> {ldap, motivo} (ausente si no hay match). */
function _solicitantesPorIdUnico_(idsUnico) {
  if (!idsUnico.length) return {};
  try {
    var lineas = supaGet_('lineas', 'hodos_id=in.(' + idsUnico.map(encodeURIComponent).join(',') + ')',
      'hodos_id,peticion_id', 'preparacion');
    if (!lineas.length) return {};
    var porPeticion = _textosPorPeticion_(_unicosKairos_(lineas.map(function (l) { return l.peticion_id; })));
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
  var buscados = _unicosKairos_((ssccList || []).map(function (s) { return String(s || '').trim(); }).filter(Boolean));
  if (!tienda || !buscados.length) return {};
  try {
    // Solo las líneas refill de esta tienda que mencionan algún SSCC de ESTA carga. lineas.sscc
    // es texto libre ("sscc (Xud) + sscc2 (Yud)"), de ahí ilike y no in.(). Las columnas van en
    // el 3.er argumento de supaGet_, que ya antepone su propio select=: meter otro select=
    // dentro del filtro daba HTTP 400 en cada cierre y el catch lo disfrazaba de "sin
    // coincidencias" (bug real 2026-10-15). Antes también se leía todo el historial de refill de
    // la tienda en cada cierre.
    var lineas = [];
    _trozosKairos_(buscados, KAIROS_SSCC_POR_PETICION_).forEach(function (trozo) {
      var alguno = trozo.map(function (s) { return 'sscc.ilike.*' + encodeURIComponent(s) + '*'; }).join(',');
      lineas = lineas.concat(supaGet_('lineas',
        'peticiones.tipo=eq.refill&peticiones.tienda_origen=eq.' + encodeURIComponent(tienda) + '&or=(' + alguno + ')',
        'sscc,peticion_id,peticiones!inner(tienda_origen,tipo)', 'preparacion'));
    });
    if (!lineas.length) return {};
    var porPeticion = _textosPorPeticion_(_unicosKairos_(lineas.map(function (l) { return l.peticion_id; })));
    var porBareSscc = {};
    lineas.forEach(function (l) {
      var info = porPeticion[l.peticion_id];
      if (!info) return;
      _bareSscc_(l.sscc).forEach(function (bare) { porBareSscc[bare] = info; });
    });
    var mapa = {};
    // ilike es "contiene": la coincidencia exacta con el SSCC suelto se decide aquí.
    buscados.forEach(function (s) { if (porBareSscc[s]) mapa[s] = porBareSscc[s]; });
    return mapa;
  } catch (err) {
    Logger.log('AVISO: no se pudo cruzar solicitantes Kairos (refill): ' + err);
    return {};
  }
}
