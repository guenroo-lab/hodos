// IntegracionCentinela.gs — endpoint de SOLO LECTURA para Centinela (Taisa Málaga,
// C:\Users\30081048\Desktop\Proyectos\FindeTurno). Centinela, al imprimir la plantilla de
// carga de una tienda, pide aquí los soportes "vivos" de esa tienda (REGISTRADO, aún no
// cargados en ningún camión) para imprimir su "silueta" junto a la plantilla.
//
// Llamada: GET <webapp>?accion=pendientesTienda&tienda=Marbella
//
// No escribe nada. Sin token compartido a propósito: el web app es de acceso DOMAIN
// (solo cuentas de la empresa) y los datos son exactamente los que ya ve cualquiera en
// la pestaña "Pendientes" — a diferencia de doPost (IntegracionIncpc.gs), que sí escribe
// y por eso exige INCPC_SHARED_TOKEN.

function respuestaPendientesTienda_(tienda) {
  var respuesta;
  try {
    var t = validarTienda(String(tienda || '').trim());
    if (!t) throw new Error('Tienda no válida: "' + tienda + '"');
    respuesta = {
      ok: true,
      tienda: t,
      generado: new Date().toISOString(),
      umbralHoras: UMBRAL_ALERTA_HORAS_,
      pendientes: pendientesDeTiendaParaCentinela_(t)
    };
  } catch (err) {
    respuesta = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(respuesta)).setMimeType(ContentService.MimeType.JSON);
}

// Mismos campos y mismo criterio de antigüedad/aviso que obtenerPendientesPorTienda
// (Backend.gs), pero filtrando en Supabase por tienda en vez de traer todas y agrupar.
function pendientesDeTiendaParaCentinela_(tienda) {
  var filas = leerEtiquetas_('estado=eq.REGISTRADO&destino=eq.' + encodeURIComponent(tienda) + '&order=fecha_creacion.asc');
  var ahora = new Date();
  return filas.map(function (f) {
    var horas = horasLaborablesTranscurridas(f.fechaCreacion, ahora);
    return {
      idUnico: f.idUnico,
      numeroPedido: f.numeroPedido,
      soporteNum: f.soporteNum,
      soporteTotal: f.soporteTotal,
      origenTexto: f.origenTexto,
      razonFlujo: f.razonFlujo,
      fechaCreacion: fechaComoTexto(f.fechaCreacion),
      horasTranscurridas: Math.round(horas * 10) / 10,
      nivelAviso: nivelAvisoPorHoras(horas, UMBRAL_ALERTA_HORAS_)
    };
  });
}
