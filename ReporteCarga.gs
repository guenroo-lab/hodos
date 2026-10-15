// ReporteCarga.gs — informe de cierre de carga, mismo estilo visual que
// CartadePortesSIE/CartaPortes.gs (buildPDFHtml): cabecera oscura con logo Taisa,
// banda de color con tienda/fecha/horario, tabla de pedidos, aviso si no hay nada.

// Mismos colores (ya con contraste WCAG ajustado) que usan los botones de selección
// de tienda en Index.html (.tienda-btn.sel-*) — así la banda del informe combina con
// el resto de la identidad visual de cada tienda en HODOS.
var COLOR_BANDA_TIENDA_ = { 'Málaga': '#147638', 'Marbella': '#1f5b83', 'Mijas': '#5d356d', 'Granada': '#925e0b' };

function htmlInformeCarga(idCarga) {
  var carga = obtenerCarga(idCarga);
  var colorBanda = COLOR_BANDA_TIENDA_[carga.destino] || '#e30613';
  // Calculado aquí arriba (no solo donde se usa el bloque SIE más abajo) porque el
  // resumen de cabecera y el aviso de "carga vacía" también necesitan saber si hay
  // palets — una carga 100% refill SIE, sin ningún pedido cliente, es un caso real y
  // válido, no debe marcarse como "cerrada sin ningún soporte escaneado".
  var palets = leerPaletesPorCarga_(idCarga);
  var solicitantesPedidos = _solicitantesPorIdUnico_(carga.escaneados.map(function (e) { return e.idUnico; }));
  var solicitantesPalets = _solicitantesPorSscc_(carga.destino, palets.map(function (p) { return p.sscc; }));

  var filas = carga.escaneados.map(function (e, i) {
    var bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    var hora = e.fechaEnvio ? Utilities.formatDate(new Date(e.fechaEnvio), 'GMT+1', 'HH:mm') : '';
    var contenidoTxt = (e.contenido || []).map(function (c) {
      return esc_(c.cantidad) + 'x ' + esc_(c.descripcion);
    }).join(', ');
    var contenidoHtml = contenidoTxt
      ? '<div style="font-size:10px;color:#888;margin-top:2px;">' + contenidoTxt + '</div>'
      : '';
    var sol = solicitantesPedidos[e.idUnico];
    var solHtml = '<td style="padding:8px 12px;font-size:10px;color:#666;border-bottom:1px solid #eee;">'
      + (sol ? '<b>' + esc_(sol.ldap) + '</b>' + (sol.motivo ? '<br><span style="color:#999;">' + esc_(sol.motivo) + '</span>' : '') : '—')
      + '</td>';
    return '<tr style="background:' + bg + ';">'
      + '<td style="padding:8px 10px;font-size:11px;text-align:center;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;width:32px;">' + (i + 1) + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:12px;font-weight:bold;color:#1a1a2e;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.numeroPedido) + contenidoHtml + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:10px;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.idUnico) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(e.origenTexto) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + hora + '</td>'
      + solHtml
      + '</tr>';
  }).join('');

  // Solo "vacía" si no lleva NADA — ni pedidos ni palets. Antes de la fusión SIE,
  // escaneados.length === 0 era suficiente porque no existía otro tipo de contenido;
  // una carga 100% refill (cero pedidos, solo palets) es válida y no debe salir como
  // "carga cerrada sin ningún soporte escaneado".
  var avisoVacio = (carga.escaneados.length === 0 && palets.length === 0)
    ? '<tr><td colspan="2" style="padding:12px 20px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fdf2f2;border:1px solid #f5c6c6;border-left:4px solid #e30613;padding:10px 14px;font-size:11px;color:#c0392b;"><strong>Carga cerrada sin ningún soporte escaneado.</strong></td></tr></table></td></tr>'
    : '';

  // Resumen a simple vista de lo que lleva este envío — mismos colores que la
  // pantalla de escaneo (HODOS en el color de la tienda, SIE en azul) para que el
  // documento y la app se lean como el mismo sistema.
  var chipResumen = '<span style="display:inline-block;background:' + colorBanda + ';color:#fff;font-size:11px;font-weight:bold;padding:5px 14px;border-radius:20px;margin-right:8px;">'
    + carga.escaneados.length + ' PEDIDO' + (carga.escaneados.length === 1 ? '' : 'S') + ' CLIENTE</span>'
    + (palets.length > 0
      ? '<span style="display:inline-block;background:#2f8fd6;color:#fff;font-size:11px;font-weight:bold;padding:5px 14px;border-radius:20px;">' + palets.length + ' PALET' + (palets.length === 1 ? '' : 'S') + ' SIE (REFILL)</span>'
      : '');

  // Fusión Carta de Portes SIE (2026-09-15): si esta carga tiene también palets
  // refill (mismo destino+fecha+horario que un camión SIE), se añade una segunda
  // tabla debajo — mismo documento único, no un segundo email. Sin palets, salida
  // idéntica a antes de esta fusión.
  var bloqueSie = '';
  if (palets.length) {
    var okCount = palets.filter(function (p) { return p.encontrado; }).length;
    var nokCount = palets.length - okCount;
    var filasSie = palets.map(function (p, i) {
      var bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
      var noEnc = !p.encontrado;
      var colorSec = noEnc ? '#c0392b' : '#1a1a2e';
      var nota = noEnc ? '<br><span style="font-size:9px;color:#c0392b;font-style:italic;">No encontrado en inventario</span>' : '';
      var sol = solicitantesPalets[p.sscc];
      var solHtml = '<td style="padding:8px 12px;font-size:10px;color:#666;border-bottom:1px solid #eee;">'
        + (sol ? '<b>' + esc_(sol.ldap) + '</b>' + (sol.motivo ? '<br><span style="color:#999;">' + esc_(sol.motivo) + '</span>' : '') : '—')
        + '</td>';
      return '<tr style="background:' + bg + ';">'
        + '<td style="padding:8px 10px;font-size:11px;text-align:center;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;width:32px;">' + (i + 1) + '</td>'
        + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:11px;color:#c0770a;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(p.sscc) + '</td>'
        + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:11px;color:#0d6efd;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(p.codigoLm || '—') + '</td>'
        + '<td style="padding:8px 12px;font-size:12px;font-weight:bold;color:' + colorSec + ';border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(p.seccion || '') + nota + '</td>'
        + solHtml
        + '</tr>';
    }).join('');

    bloqueSie = '<tr><td style="padding:10px 20px;font-size:11px;color:#555;background:#f8fafc;border-top:1px solid #eee;border-bottom:1px solid #eee;">'
      + 'Refill SIE — palets escaneados en este mismo camión: <strong>' + palets.length + '</strong>'
      + (nokCount > 0 ? ' &middot; <strong style="color:#c0392b;">' + nokCount + ' no encontrado' + (nokCount > 1 ? 's' : '') + ' en inventario</strong>' : '')
      + '</td></tr>'
      + '<tr><td style="padding:10px 20px 20px;">'
      + '<table width="100%" cellpadding="0" cellspacing="0">'
      + '<tr style="background:#f3f4f6;"><th style="padding:8px 10px;font-size:10px;color:#64748b;">#</th>'
      + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">SSCC</th>'
      + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">CÓDIGO LM</th>'
      + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">SECCIÓN</th>'
      + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">SOLICITADO POR</th></tr>'
      + filasSie
      + '</table></td></tr>';
  }

  // Carga reabierta y vuelta a cerrar (2026-10-15): el informe nuevo sustituye al que ya se envió.
  var bannerReapertura = carga.reabierta
    ? '<tr><td style="padding:10px 20px;background:#fff7e6;border-bottom:1px solid #f0d9a8;font-size:11px;color:#8a5a00;">'
      + '<strong>INFORME ACTUALIZADO</strong> — esta carga se reabrió el '
      + esc_(Utilities.formatDate(new Date(carga.reabiertaEn), 'Europe/Madrid', 'dd/MM/yyyy HH:mm'))
      + ' para modificarla; este informe sustituye al anterior.</td></tr>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
    + '<style>body{margin:0;padding:0;font-family:Arial,sans-serif;font-size:12px;}table{border-collapse:collapse;}</style>'
    + '</head><body style="background:#ffffff;margin:0;padding:20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd;">'
    + '<tr><td style="background:#080a10;padding:16px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="width:140px;"><img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" height="30" style="background:white;padding:4px 12px;display:block;"></td>'
    + '<td style="text-align:right;"><span style="font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">HODOS &middot; Informe de Carga</span><br>'
    + '<span style="font-size:8px;color:#6b7899;letter-spacing:1px;">Taisa Logistics</span></td>'
    + '</tr></table></td></tr>'
    + '<tr><td style="background:' + colorBanda + ';padding:14px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:3px;text-transform:uppercase;">' + esc_(carga.destino) + '</td>'
    + '<td style="text-align:right;font-size:11px;color:rgba(255,255,255,0.9);line-height:1.8;">'
    + '<strong>Fecha entrega:</strong> ' + esc_(Utilities.formatDate(new Date(carga.fechaEntrega), 'GMT+1', 'dd/MM/yyyy'))
    + (carga.horario ? '<br><strong>Horario:</strong> ' + esc_(carga.horario) : '')
    + (carga.cargador ? '<br><strong>Cargador:</strong> ' + esc_(carga.cargador) : '')
    + '</td></tr></table></td></tr>'
    + bannerReapertura
    + '<tr><td style="padding:14px 20px 4px;">' + chipResumen + '</td></tr>'
    // Línea de contexto (2026-08-12): antes el documento se llamaba "Pedido Cliente", pero
    // una carga incluye soportes de cualquier origen (MECO, cesiones entre tiendas, etc.),
    // no solo pedido cliente — esta línea deja claro el alcance real nada más abrir el
    // documento/correo, sin depender de que el destinatario lo infiera de la tabla.
    + '<tr><td style="padding:10px 20px;font-size:11px;color:#555;background:#f8fafc;border-bottom:1px solid #eee;">'
    + 'Detalle de todos los soportes cargados en este envío: pedidos de cliente y cualquier otro origen registrado (MECO, cesiones entre tiendas, etc.).'
    + '</td></tr>'
    + avisoVacio
    + '<tr><td style="padding:10px 20px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0">'
    + '<tr style="background:#f3f4f6;"><th style="padding:8px 10px;font-size:10px;color:#64748b;">#</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">Nº PEDIDO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">ID ÚNICO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">ORIGEN</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">CARGADO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#64748b;text-align:left;">SOLICITADO POR</th></tr>'
    + filas
    + '</table></td></tr>'
    + '<tr><td style="padding:10px 20px;font-size:10px;color:#999;">Total soportes: ' + carga.escaneados.length + ' &middot; Carga ' + esc_(idCarga) + '</td></tr>'
    + bloqueSie
    + '</table></body></html>';
}

// "Silueta" de una tienda: informe imprimible (mismo estilo que htmlInformeCarga)
// con TODOS los soportes REGISTRADO (aún no cargados en ningún camión) de esa
// tienda, para la revisión diaria de qué queda pendiente de cargar — ver pestaña
// "Pendientes" en Index.html, que reutiliza la misma antigüedad/alerta.
function htmlPendientesTienda(tienda) {
  if (!validarTienda(tienda)) throw new Error('Tienda no válida: ' + tienda);
  var filas = leerEtiquetas_('estado=eq.REGISTRADO&destino=eq.' + encodeURIComponent(tienda) + '&order=fecha_creacion.asc');
  var ahora = new Date();

  // Colores de texto (no de fondo: muchos navegadores omiten el color de fondo al
  // imprimir salvo que se active "gráficos de fondo" a mano) para la escalada
  // amarillo/naranja/rojo — mismos tres niveles que la pestaña Pendientes en
  // Index.html (nivelAvisoPorHoras).
  var COLOR_POR_NIVEL_ = { ok: '#666', amarillo: '#b7950b', naranja: '#d35400', rojo: '#c0392b' };

  var conAntiguedad = filas.map(function (f) {
    var horas = horasLaborablesTranscurridas(f.fechaCreacion, ahora);
    var nivel = nivelAvisoPorHoras(horas, UMBRAL_ALERTA_HORAS_);
    return { fila: f, horas: horas, nivel: nivel, alerta: nivel === 'rojo' };
  });
  var totalAlertas = conAntiguedad.filter(function (x) { return x.alerta; }).length;

  var filasHtml = conAntiguedad.map(function (x, i) {
    var f = x.fila;
    var bg = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    var colorAntiguedad = COLOR_POR_NIVEL_[x.nivel];
    var soporteTxt = f.soporteTotal > 1
      ? ' <span style="color:#999;font-weight:normal;">(' + esc_(f.soporteNum) + '/' + esc_(f.soporteTotal) + ')</span>'
      : '';
    return '<tr style="background:' + bg + ';">'
      + '<td style="padding:8px 10px;font-size:11px;text-align:center;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;width:32px;">' + (i + 1) + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:12px;font-weight:bold;color:#1a1a2e;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(f.numeroPedido) + soporteTxt + '</td>'
      + '<td style="padding:8px 12px;font-family:Courier New,monospace;font-size:10px;color:#999;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(f.idUnico) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(f.origenTexto) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;color:#666;border-right:1px solid #eee;border-bottom:1px solid #eee;">' + esc_(Utilities.formatDate(new Date(f.fechaCreacion), 'GMT+1', 'dd/MM/yyyy HH:mm')) + '</td>'
      + '<td style="padding:8px 12px;font-size:11px;font-weight:' + (x.nivel === 'ok' ? 'normal' : 'bold') + ';color:' + colorAntiguedad + ';border-bottom:1px solid #eee;">' + esc_(formatearHorasTexto(x.horas)) + (x.alerta ? ' &#9888;' : '') + '</td>'
      + '</tr>';
  }).join('');

  var avisoVacio = filas.length === 0
    ? '<tr><td colspan="2" style="padding:12px 20px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#fdf2f2;border:1px solid #f5c6c6;border-left:4px solid #e30613;padding:10px 14px;font-size:11px;color:#c0392b;"><strong>Sin soportes pendientes de cargar para esta tienda.</strong></td></tr></table></td></tr>'
    : '';

  return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">'
    + '<style>body{margin:0;padding:0;font-family:Arial,sans-serif;font-size:12px;}table{border-collapse:collapse;}</style>'
    + '</head><body style="background:#ffffff;margin:0;padding:20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ddd;">'
    + '<tr><td style="background:#080a10;padding:16px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="width:140px;"><img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" height="30" style="background:white;padding:4px 12px;display:block;"></td>'
    + '<td style="text-align:right;"><span style="font-size:16px;font-weight:bold;color:#ffffff;letter-spacing:2px;text-transform:uppercase;">HODOS &middot; Pendientes de Carga</span><br>'
    + '<span style="font-size:8px;color:#6b7899;letter-spacing:1px;">Taisa Logistics</span></td>'
    + '</tr></table></td></tr>'
    + '<tr><td style="background:#e30613;padding:14px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td style="font-size:24px;font-weight:bold;color:#ffffff;letter-spacing:3px;text-transform:uppercase;">' + esc_(tienda) + '</td>'
    + '<td style="text-align:right;font-size:11px;color:rgba(255,255,255,0.9);line-height:1.8;">'
    + '<strong>Generado:</strong> ' + esc_(Utilities.formatDate(ahora, 'GMT+1', 'dd/MM/yyyy HH:mm'))
    + '</td></tr></table></td></tr>'
    + avisoVacio
    + '<tr><td style="padding:10px 20px 20px;">'
    + '<table width="100%" cellpadding="0" cellspacing="0">'
    + '<tr style="background:#f3f4f6;"><th style="padding:8px 10px;font-size:10px;color:#888;">#</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">Nº PEDIDO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">ID ÚNICO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">ORIGEN</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">CREADO</th>'
    + '<th style="padding:8px 12px;font-size:10px;color:#888;text-align:left;">ANTIGÜEDAD</th></tr>'
    + filasHtml
    + '</table></td></tr>'
    + '<tr><td style="padding:10px 20px;font-size:10px;color:#999;">Total pendientes: ' + filas.length
    + (totalAlertas > 0 ? ' &middot; <strong style="color:#c0392b;">' + totalAlertas + ' con aviso (&gt;' + UMBRAL_ALERTA_HORAS_ + 'h laborables)</strong>' : '')
    + '</td></tr>'
    + '</table></body></html>';
}
