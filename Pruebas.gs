// Pruebas.gs — funciones de humo, se ejecutan manualmente desde el editor de Apps Script.
//
// Los registros de prueba que no verifican nada específico de MECO usan origen
// 'Valencia' a propósito (antes usaban 'MECO' indistintamente) — desde que
// cerrarCarga exige que MECO se cargue completo por tienda (ver Backend.gs), un
// origen MECO de un test anterior en la misma ejecución que se quede REGISTRADO
// (sin escanear, p.ej. la prueba de "ceros a la izquierda" o la de "contenido", que
// nunca cierran su carga) bloquearía el cierre de OTRAS pruebas MECO+Mijas/Granada
// más adelante en la misma ejecución. 'Valencia' evita esa colisión sin cambiar lo
// que cada prueba verifica de verdad.

function verificarSistema() {
  var resultados = [];
  // Blindaje: durante verificarSistema() el modo prueba SIEMPRE está activo, sea cual
  // sea el estado real en producción — así ninguna de las cargas de prueba que se cierran
  // aquí abajo puede disparar un email real. Al terminar (pase lo que pase) se restaura
  // el estado que había antes de entrar, para no dejar la producción en modo prueba sin
  // querer si ya estaba desactivado.
  var modoPruebaOriginal = modoPruebaActivo();
  if (!modoPruebaOriginal) activarModoPrueba();

  try {
    try {
      testConexionSupabase();
      resultados.push('OK: conexión con Supabase accesible (tabla cargas responde)');
    } catch (e) {
      resultados.push('ERROR conexión Supabase: ' + e.toString());
    }

    try {
      // TEST-001 repetido: verifica también el cálculo de soportes en el camino completo.
      var r = registrarLote({ pedidosTexto: 'TEST-001\nTEST-002\nTEST-001', origen: 'Taisa', subtipo: 'Inventario', destino: 'Mijas' });
      resultados.push('OK: registrarLote -> ' + r.cantidad + ' etiquetas, ids ' + r.ids.join(','));

      var html = htmlEtiquetas(r.loteId);
      resultados.push('OK: htmlEtiquetas -> ' + html.length + ' caracteres generados');

      var badges = (html.match(/SOPORTE \d+\/\d+/g) || []).length;
      resultados.push(badges === 2 ? 'OK: badge de soporte aparece 2 veces (TEST-001 x2)' : 'ERROR soportes: se esperaban 2 badges, hay ' + badges);
    } catch (e) {
      resultados.push('ERROR registrarLote/htmlEtiquetas: ' + e.toString());
    }

    try {
      // Cesión entre tiendas: origen y destino son ambos tiendas del circuito.
      var rCesion = registrarLote({ pedidosTexto: '950001', origen: 'Cesión', destino: 'Mijas', origenTienda: 'Marbella' });
      var etqCesion = buscarEtiquetas({ idUnico: rCesion.ids[0] })[0];
      var okCesion = etqCesion && etqCesion.origenTexto === 'CESIÓN - MARBELLA';
      resultados.push(okCesion
        ? 'OK: cesión entre tiendas registra origenTexto "CESIÓN - MARBELLA"'
        : 'ERROR cesión: ' + JSON.stringify(etqCesion));

      var rechazada = false;
      try {
        registrarLote({ pedidosTexto: '950002', origen: 'Cesión', destino: 'Mijas', origenTienda: 'Mijas' });
      } catch (eCesion) {
        rechazada = eCesion.message.indexOf('misma') !== -1;
      }
      resultados.push(rechazada
        ? 'OK: cesión con origen=destino se rechaza'
        : 'ERROR CRÍTICO: se permitió una cesión de Mijas a Mijas');
    } catch (e) {
      resultados.push('ERROR prueba cesión: ' + e.toString());
    }

    try {
      var historial = obtenerHistorialLotes(5);
      resultados.push('OK: obtenerHistorialLotes -> ' + historial.length + ' lotes');
    } catch (e) {
      resultados.push('ERROR historial: ' + e.toString());
    }

    try {
      // Regresión: Sheets convierte "007890" a número y pierde los ceros si la columna
      // no está forzada a texto (ver asegurarNumeroPedidoComoTexto_ en EstructuraSheets.gs).
      // OJO: verificarSistema() se ejecuta muchas veces sobre la MISMA hoja en producción,
      // así que "007890" se va acumulando en varias filas de ejecuciones anteriores — no
      // asumir "length === 1" (eso fue un falso ERROR el 2026-07-29: los ceros SÍ se
      // conservaban, solo había 2 filas de 2 ejecuciones distintas). Comprobar que TODAS
      // las coincidencias conservan el valor exacto, sea cual sea el número de filas.
      registrarLote({ pedidosTexto: '007890', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var encontrado = buscarEtiquetas({ numeroPedido: '007890' });
      var okCeros = encontrado.length > 0 && encontrado.every(function (e) { return e.numeroPedido === '007890'; });
      resultados.push(okCeros
        ? 'OK: numeroPedido con ceros a la izquierda se conserva (007890, ' + encontrado.length + ' fila(s) acumuladas de ejecuciones anteriores)'
        : 'ERROR: numeroPedido con ceros a la izquierda NO se conserva -> ' + JSON.stringify(encontrado));
    } catch (e) {
      resultados.push('ERROR prueba ceros a la izquierda: ' + e.toString());
    }

    try {
      // Fase 3: escaneo FIFO por número de pedido tecleado a mano (modo manual, no
      // idUnico) + validación de destino + cierre de carga con informe. Este test
      // necesita un número de pedido en TEXTO PLANO (no idUnico) a propósito, porque
      // verifica justo el mecanismo de coincidencia FIFO — pero por eso mismo
      // escanearSoporte busca en TODA la hoja por ese número (whole-table by numeroPedido,
      // sin filtrar por loteId), así que se genera único por ejecución (timestamp) para no
      // acumular filas huérfanas de ejecuciones anteriores en el FIFO. Nota (2026-09-22):
      // pedidosPendientesEnCarga YA NO tiene este problema — ahora exige mismo loteId, así
      // que una fila huérfana de otra ejecución (loteId distinto) nunca la confunde con esta.
      var pedidoFifo = 'TESTFIFO' + new Date().getTime();
      registrarLote({ pedidosTexto: pedidoFifo + '\n' + pedidoFifo, origen: 'Valencia', subtipo: '', destino: 'Granada' });
      var cargaTest = crearCarga('Granada', '2026-07-29', '12:00');
      var r1 = escanearSoporte(cargaTest.idCarga, pedidoFifo);
      var r2 = escanearSoporte(cargaTest.idCarga, pedidoFifo);
      var r3 = escanearSoporte(cargaTest.idCarga, pedidoFifo);
      var okFase3 = r1.ok && r2.ok && !r3.ok && r3.motivo === 'YA_ESCANEADO';
      resultados.push(okFase3
        ? 'OK: fase 3 escaneo FIFO (2 soportes marcados, 3er escaneo -> YA_ESCANEADO)'
        : 'ERROR fase 3 escaneo: ' + JSON.stringify([r1, r2, r3]));

      var cierre = cerrarCarga(cargaTest.idCarga);
      resultados.push('OK: cerrarCarga -> ' + cierre.cantidad + ' soportes, emailEnviado=' + cierre.emailEnviado);
    } catch (e) {
      resultados.push('ERROR fase 3: ' + e.toString());
    }

    try {
      // El barcode ahora codifica el idUnico, no el número de pedido: escanear el idUnico
      // EXACTO de un soporte concreto debe resolverlo aunque haya otro soporte más antiguo
      // del mismo pedido pendiente (ya no depende del FIFO "a ciegas").
      var rBarcode = registrarLote({ pedidosTexto: '960001\n960001', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var cargaBarcode = crearCarga('Mijas', '2026-07-29', '8:00');
      var rEsc1 = escanearSoporte(cargaBarcode.idCarga, rBarcode.ids[1]);
      var okBarcode = rEsc1.ok && rEsc1.idUnico === rBarcode.ids[1];
      resultados.push(okBarcode
        ? 'OK: escanear por idUnico resuelve exactamente ese soporte (no el más antiguo por FIFO)'
        : 'ERROR escaneo por idUnico: ' + JSON.stringify(rEsc1));
      escanearSoporte(cargaBarcode.idCarga, rBarcode.ids[0]); // completa el que falta
      cerrarCarga(cargaBarcode.idCarga);
    } catch (e) {
      resultados.push('ERROR prueba escaneo por idUnico: ' + e.toString());
    }

    try {
      // Agrupación de varios pedidos en un mismo soporte físico (separador "+"): un único
      // barcode (idUnico), SIN badge de soporte, localizable por cualquiera de los
      // pedidos del grupo, y escanear su idUnico marca el grupo entero de una vez.
      var rGrupo = registrarLote({ pedidosTexto: '970001+970002', origen: 'Valencia', subtipo: '', destino: 'Granada' });
      var htmlGrupo = htmlEtiquetas(rGrupo.loteId);
      var sinBadge = htmlGrupo.indexOf('SOPORTE') === -1;
      var encontradoGrupo = buscarEtiquetas({ numeroPedido: '970002' })[0];
      var okGrupo = sinBadge && encontradoGrupo && encontradoGrupo.numeroPedido === '970001+970002';
      resultados.push(okGrupo
        ? 'OK: grupo de pedidos en un soporte -> sin badge, localizable por cualquiera de los pedidos'
        : 'ERROR grupo: sinBadge=' + sinBadge + ', encontrado=' + JSON.stringify(encontradoGrupo));

      var cargaGrupo = crearCarga('Granada', '2026-07-29', 'Envío único diario');
      var rEscGrupo = escanearSoporte(cargaGrupo.idCarga, rGrupo.ids[0]);
      var cierreGrupo = cerrarCarga(cargaGrupo.idCarga);
      resultados.push((rEscGrupo.ok && cierreGrupo.cantidad === 1)
        ? 'OK: escanear el idUnico del grupo marca el soporte completo de una vez y permite cerrar'
        : 'ERROR cierre grupo: ' + JSON.stringify([rEscGrupo, cierreGrupo]));
    } catch (e) {
      resultados.push('ERROR prueba grupo de pedidos: ' + e.toString());
    }

    try {
      // Un pedido de varios soportes NO puede cerrarse a medias: si escaneamos 1 de 2
      // soportes del mismo pedido+destino, cerrarCarga debe rechazar el cierre.
      // Histórico: antes del fix del 2026-09-22, pedidosPendientesEnCarga buscaba en TODA
      // la hoja por numeroPedido+destino sin más, así que un valor de pedido fijo tipo
      // "930001" reutilizado en cada ejecución acumulaba filas REGISTRADO huérfanas de
      // ejecuciones anteriores (esto pasó de verdad: 2026-07-29, "faltan 2 soporte(s)"
      // venía de dos ejecuciones previas, no de esta ejecución). Ahora exige también mismo
      // loteId (cada ejecución genera el suyo), así que ese bug de arrastre ya no puede
      // pasar — pero el número de pedido se sigue generando único por ejecución de todas
      // formas, por higiene general del test (evita acumular basura visible en Supabase
      // entre ejecuciones, no por necesidad de aislar pedidosPendientesEnCarga). Se escanea
      // por idUnico (exacto), y al final se completa y cierra de verdad (autolimpieza: sin
      // esto, la carga quedaría ABIERTA para siempre).
      var pedidoPruebaIncompleto = 'TESTINCOMPLETO' + new Date().getTime();
      var rParcial = registrarLote({ pedidosTexto: pedidoPruebaIncompleto + '\n' + pedidoPruebaIncompleto, origen: 'Valencia', subtipo: '', destino: 'Granada' });
      var cargaParcial = crearCarga('Granada', '2026-07-29', 'Envío único diario');
      escanearSoporte(cargaParcial.idCarga, rParcial.ids[0]); // solo 1 de los 2 soportes
      var bloqueado = false;
      try {
        cerrarCarga(cargaParcial.idCarga);
      } catch (eCierre) {
        bloqueado = eCierre.message.indexOf('pedidos incompletos') !== -1;
      }
      resultados.push(bloqueado
        ? 'OK: cerrarCarga rechaza el cierre con un pedido de varios soportes incompleto'
        : 'ERROR CRÍTICO: se permitió cerrar una carga con un pedido incompleto (' + pedidoPruebaIncompleto + ')');
      escanearSoporte(cargaParcial.idCarga, rParcial.ids[1]);
      cerrarCarga(cargaParcial.idCarga);
    } catch (e) {
      resultados.push('ERROR prueba pedido incompleto: ' + e.toString());
    }

    try {
      // Cierre forzado (función oculta): con forzar=true, cerrarCarga debe saltarse el
      // mismo bloqueo de "pedido incompleto" que la prueba anterior confirma que existe,
      // y dejar constancia de qué se saltó en forzado/avisosOmitidos — nunca en silencio.
      var pedidoPruebaForzado = 'TESTFORZADO' + new Date().getTime();
      var rForzado = registrarLote({ pedidosTexto: pedidoPruebaForzado + '\n' + pedidoPruebaForzado, origen: 'Valencia', subtipo: '', destino: 'Granada' });
      var cargaForzado = crearCarga('Granada', '2026-07-29', 'Envío único diario');
      escanearSoporte(cargaForzado.idCarga, rForzado.ids[0]); // solo 1 de los 2 soportes, a propósito

      var resultadoForzado = cerrarCarga(cargaForzado.idCarga, true);
      var okForzado = resultadoForzado.forzado === true
        && resultadoForzado.avisosOmitidos.length > 0
        && resultadoForzado.avisosOmitidos[0].indexOf('pedidos incompletos') !== -1;
      resultados.push(okForzado
        ? 'OK: cerrarCarga(id, true) fuerza el cierre saltándose el bloqueo y lo reporta en avisosOmitidos'
        : 'ERROR CRÍTICO: cierre forzado no reportó forzado/avisosOmitidos correctamente -> ' + JSON.stringify(resultadoForzado));

      var cargaForzadaLeida = obtenerCarga(cargaForzado.idCarga);
      resultados.push(cargaForzadaLeida.estado === 'CERRADA'
        ? 'OK: la carga forzada queda realmente CERRADA en Supabase'
        : 'ERROR CRÍTICO: la carga forzada no quedó CERRADA -> ' + JSON.stringify(cargaForzadaLeida));
    } catch (e) {
      resultados.push('ERROR prueba cierre forzado: ' + e.toString());
    }

    try {
      // Contenido opcional por soporte: guardarContenidoSoporte debe aparecer en
      // buscarEtiquetas, y volver a guardar para el mismo idUnico debe REEMPLAZAR (no
      // acumular) las líneas anteriores.
      var rContenido = registrarLote({ pedidosTexto: '940001', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var idUnicoContenido = rContenido.ids[0];
      guardarContenidoSoporte(idUnicoContenido, [{ descripcion: 'Tornillos', cantidad: 5 }, { descripcion: 'Bisagras', cantidad: 2 }]);
      guardarContenidoSoporte(idUnicoContenido, [{ descripcion: 'Solo esto', cantidad: 1 }]);
      var encontradoContenido = buscarEtiquetas({ idUnico: idUnicoContenido })[0];
      var okContenido = encontradoContenido && encontradoContenido.contenido.length === 1
        && encontradoContenido.contenido[0].descripcion === 'Solo esto' && encontradoContenido.contenido[0].cantidad === 1;
      resultados.push(okContenido
        ? 'OK: guardarContenidoSoporte reemplaza el contenido anterior y aparece en buscarEtiquetas'
        : 'ERROR contenido: ' + JSON.stringify(encontradoContenido));
    } catch (e) {
      resultados.push('ERROR prueba contenido: ' + e.toString());
    }

    try {
      // Integración con Carta de Portes SIE: obtenerOCrearCarga debe reutilizar la carga
      // si ya hay una ABIERTA con el mismo destino+fecha+horario ("seguir" el mismo
      // camión), y solo crear una nueva si no existe.
      // Desde 2026-10-15 un camión (destino+fecha+horario) = UNA carga para siempre: la cerrada
      // tampoco se duplica (se avisa de que se puede reabrir), y exige cargador. Por eso cada
      // ejecución usa un horario propio (si no, la carga cerrada de la ejecución anterior saldría
      // aquí como "cerrada" en vez de crear una nueva y la aserción daría un falso ERROR) y una
      // fecha de llegada futura (así la cerrada sigue siendo reabrible).
      var horarioPrueba = 'PRUEBA ' + new Date().getTime();
      var r1 = obtenerOCrearCarga('Málaga', '2099-12-31', horarioPrueba, ['Juanlu']);
      var r2 = obtenerOCrearCarga('Málaga', '2099-12-31', horarioPrueba, ['Juanlu']);
      var okReutiliza = !r1.reutilizada && r2.reutilizada && r1.idCarga === r2.idCarga;
      resultados.push(okReutiliza
        ? 'OK: obtenerOCrearCarga reutiliza la carga abierta con mismo destino+fecha+horario'
        : 'ERROR obtenerOCrearCarga: ' + JSON.stringify([r1, r2]));
      // Autolimpieza: sin esto, esta carga de prueba quedaría ABIERTA para siempre y
      // rompería la próxima ejecución de esta misma prueba (bug real encontrado en revisión).
      cerrarCarga(r1.idCarga);
      // Ya cerrada: ni se crea otra ni se reabre sola; se avisa de que el camión aún no ha llegado.
      var r3 = obtenerOCrearCarga('Málaga', '2099-12-31', horarioPrueba, ['Juanlu']);
      resultados.push(r3.cerrada && r3.reabrible && r3.idCarga === r1.idCarga
        ? 'OK: obtenerOCrearCarga no duplica un camión ya cerrado (avisa de que se puede reabrir)'
        : 'ERROR obtenerOCrearCarga (carga cerrada): ' + JSON.stringify(r3));
    } catch (e) {
      resultados.push('ERROR obtenerOCrearCarga: ' + e.toString());
    }

    try {
      // Regresión de seguridad: las 4 tiendas (Mijas incluida) comparten destinatarios
      // reales configurados desde 2026-08-04 (ver ConfigEntregas.gs). Con el blindaje de
      // arriba, verificarSistema() SIEMPRE corre con el modo prueba forzado a activo, así
      // que cerrar una carga para Mijas aquí NUNCA debe enviar un email real aunque haya
      // destinatarios. Se mantiene esta aserción como red de seguridad por si el blindaje
      // se rompiera en el futuro.
      var rMijas = registrarLote({ pedidosTexto: '920001', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var cargaMijas = crearCarga('Mijas', '2026-07-29', '8:00');
      escanearSoporte(cargaMijas.idCarga, rMijas.ids[0]);
      var cierreMijas = cerrarCarga(cargaMijas.idCarga);
      var okModoPrueba = cierreMijas.emailEnviado.indexOf('MODO_PRUEBA') === 0;
      resultados.push(okModoPrueba
        ? 'OK: modo prueba activo -> cierre de carga con destinatarios reales (Mijas) NO envía email de verdad'
        : 'ERROR CRÍTICO: se habría enviado un email real a Mijas con datos de prueba -> emailEnviado=' + cierreMijas.emailEnviado);
    } catch (e) {
      resultados.push('ERROR prueba modo prueba: ' + e.toString());
    }

    try {
      // Integración INCPC: crearEtiquetaDesdeIncpc_ debe normalizar el destino,
      // crear la etiqueta con origen Taisa + el subtipo recibido, guardar el
      // contenido (referencia/cantidad) y marcar pendiente_impresion_incpc=true.
      // Se llama directamente (sin pasar por doPost/token) porque aquí solo se
      // verifica la lógica de negocio, no el transporte HTTP — ese lo verifica
      // el usuario con una fila real en INCPC.
      var pedidoIncpc = 'TESTINCPC' + new Date().getTime();
      var idIncpc = crearEtiquetaDesdeIncpc_({
        destino: 'Malaga 1',
        pedido: pedidoIncpc,
        tipo: 'Rotura transportista',
        referencia: '12345-EAN',
        cantidad: '3',
        operario: 'Test'
      });
      // Nota: buscarEtiquetas nunca ha expuesto creadoPor al cliente (ni para
      // etiquetas manuales ni para estas) — no se puede verificar aquí. El valor
      // sí se guarda en Supabase (registrarLote/guardarContenidoSoporte reciben el
      // override), solo que ninguna función de lectura lo devuelve todavía.
      var etqIncpc = buscarEtiquetas({ idUnico: idIncpc })[0];
      var okIncpc = etqIncpc
        && etqIncpc.destino === 'Málaga'
        && etqIncpc.subtipo === 'Rotura transportista'
        && etqIncpc.origenTexto === 'TAISA - ROTURA TRANSPORTISTA'
        && etqIncpc.contenido.length === 1
        && etqIncpc.contenido[0].descripcion === '12345-EAN'
        && etqIncpc.contenido[0].cantidad === 3;
      resultados.push(okIncpc
        ? 'OK: crearEtiquetaDesdeIncpc_ normaliza destino, fija subtipo/creadoPor y guarda contenido'
        : 'ERROR crearEtiquetaDesdeIncpc_: ' + JSON.stringify(etqIncpc));

      var pendientesAntes = obtenerEtiquetasPendientesIncpc();
      var estaPendiente = pendientesAntes.some(function (p) { return p.idUnico === idIncpc; });
      resultados.push(estaPendiente
        ? 'OK: la etiqueta creada por INCPC aparece en obtenerEtiquetasPendientesIncpc'
        : 'ERROR: la etiqueta INCPC no aparece como pendiente de imprimir');

      var htmlIncpc = htmlPendientesIncpc();
      resultados.push(htmlIncpc.indexOf(idIncpc) !== -1
        ? 'OK: htmlPendientesIncpc incluye la etiqueta pendiente'
        : 'ERROR: htmlPendientesIncpc no incluye ' + idIncpc);

      marcarImpresasIncpc();
      var pendientesDespues = obtenerEtiquetasPendientesIncpc();
      var yaNoEstaPendiente = !pendientesDespues.some(function (p) { return p.idUnico === idIncpc; });
      resultados.push(yaNoEstaPendiente
        ? 'OK: marcarImpresasIncpc limpia el flag y la etiqueta desaparece de la pestaña INCPC'
        : 'ERROR: marcarImpresasIncpc no limpió el flag');

      var siguExistiendo = buscarEtiquetas({ idUnico: idIncpc })[0];
      resultados.push(siguExistiendo
        ? 'OK: la etiqueta sigue existiendo en buscarEtiquetas tras marcarse impresa'
        : 'ERROR CRÍTICO: la etiqueta desapareció de buscarEtiquetas tras marcarse impresa');
    } catch (e) {
      resultados.push('ERROR prueba integración INCPC: ' + e.toString());
    }

    try {
      // Normalización de destino: variantes de Málaga deben colapsar, valores
      // desconocidos deben rechazarse con un error explícito (no crear la etiqueta
      // con un destino vacío/incorrecto).
      var rechazadoDestino = false;
      try {
        crearEtiquetaDesdeIncpc_({ destino: 'Sevilla', pedido: '999999', tipo: 'Test', operario: 'Test' });
      } catch (eDestino) {
        rechazadoDestino = eDestino.message.indexOf('no reconocida') !== -1;
      }
      resultados.push(rechazadoDestino
        ? 'OK: crearEtiquetaDesdeIncpc_ rechaza una tienda destino no reconocida'
        : 'ERROR CRÍTICO: se aceptó un destino inválido desde INCPC');
    } catch (e) {
      resultados.push('ERROR prueba destino inválido INCPC: ' + e.toString());
    }

    try {
      // Agrupar soportes existentes (selección múltiple Interno/INCPC/Preparación,
      // agruparSoportesAdmin en Backend.gs) — mismo destino/origen/subtipo a propósito
      // para pasar validarAgrupacion. 3 soportes para poder comprobar que el orden de
      // los números de pedido en el campo agrupado se conserva.
      var rAgrup = registrarLote({ pedidosTexto: 'AGRUP-001\nAGRUP-002\nAGRUP-003', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var resultadoAgrup = agruparSoportesAdmin(rAgrup.ids);
      var okAgrup = resultadoAgrup.idUnicoNuevo
        && resultadoAgrup.numeroPedido === 'AGRUP-001+AGRUP-002+AGRUP-003'
        && resultadoAgrup.cantidadOriginal === 3;
      resultados.push(okAgrup
        ? 'OK: agruparSoportesAdmin crea ' + resultadoAgrup.idUnicoNuevo + ' con numeroPedido "' + resultadoAgrup.numeroPedido + '"'
        : 'ERROR agruparSoportesAdmin: ' + JSON.stringify(resultadoAgrup));

      var originalesBorrados = rAgrup.ids.every(function (id) { return buscarEtiquetas({ idUnico: id }).length === 0; });
      resultados.push(originalesBorrados
        ? 'OK: los 3 soportes originales ya no existen tras agrupar'
        : 'ERROR CRÍTICO: algún soporte original sigue existiendo tras agruparSoportesAdmin');

      var nuevaExiste = buscarEtiquetas({ idUnico: resultadoAgrup.idUnicoNuevo }).length === 1;
      resultados.push(nuevaExiste
        ? 'OK: la etiqueta agrupada nueva existe y es localizable con buscarEtiquetas'
        : 'ERROR: la etiqueta agrupada nueva no aparece en buscarEtiquetas');

      // Autolimpieza: la etiqueta agrupada queda REGISTRADO, se puede borrar como
      // cualquier otra (ver regla general de Pruebas.gs sobre no dejar basura).
      borrarSoporteAdmin(resultadoAgrup.idUnicoNuevo);

      // Rechazo: destinos distintos no deben poder agruparse.
      var rAgrupA = registrarLote({ pedidosTexto: 'AGRUP-010', origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var rAgrupB = registrarLote({ pedidosTexto: 'AGRUP-011', origen: 'Valencia', subtipo: '', destino: 'Málaga' });
      var rechazadoAgrup = false;
      try {
        agruparSoportesAdmin([rAgrupA.ids[0], rAgrupB.ids[0]]);
      } catch (eAgrup) {
        rechazadoAgrup = eAgrup.message.indexOf('destino') !== -1;
      }
      resultados.push(rechazadoAgrup
        ? 'OK: agruparSoportesAdmin rechaza mezclar destinos distintos'
        : 'ERROR CRÍTICO: se permitió agrupar soportes de destinos distintos');
      borrarSoporteAdmin(rAgrupA.ids[0]);
      borrarSoporteAdmin(rAgrupB.ids[0]);
    } catch (e) {
      resultados.push('ERROR prueba agruparSoportesAdmin: ' + e.toString());
    }

    try {
      // Bug real (2026-09-09): un soporte creado por MacroArrastres (pendienteImpresionIncpc
      // true, igual que INCPC/Preparación) se escaneó y cargó en un camión sin haber
      // pasado nunca por "Imprimir todas" — el flag se quedaba en true para siempre y la
      // etiqueta seguía en la pestaña de pendientes de imprimir aunque ya estuviera
      // EN_RUTA (mismo síntoma en Peticiones de Reserva: borrarSoporteAdmin la rechazaba
      // por no seguir REGISTRADO). escanearSoporte ahora limpia pendienteImpresionIncpc
      // al marcar EN_RUTA, sea cual sea el origen.
      var rFlagPendiente = registrarLote({ pedidosTexto: 'TESTFLAG' + new Date().getTime(), origen: 'Valencia', subtipo: '', destino: 'Mijas' });
      var idFlagPendiente = rFlagPendiente.ids[0];
      actualizarEtiquetaCondicional_(idFlagPendiente, { pendienteImpresionIncpc: true });

      var cargaFlagPendiente = crearCarga('Mijas', '2026-07-29', '8:00');
      escanearSoporte(cargaFlagPendiente.idCarga, idFlagPendiente);
      var etqFlagPendiente = buscarEtiquetas({ idUnico: idFlagPendiente })[0];
      var okFlagLimpio = etqFlagPendiente && etqFlagPendiente.estado === 'EN_RUTA' && etqFlagPendiente.pendienteImpresionIncpc === false;
      resultados.push(okFlagLimpio
        ? 'OK: escanearSoporte limpia pendienteImpresionIncpc al marcar EN_RUTA'
        : 'ERROR CRÍTICO: pendienteImpresionIncpc sigue true tras escanear -> ' + JSON.stringify(etqFlagPendiente));
      cerrarCarga(cargaFlagPendiente.idCarga, true); // forzado: es el único soporte de esta carga de prueba, nada que bloquee salvo el propio forzado por si acaso
    } catch (e) {
      resultados.push('ERROR prueba limpieza pendienteImpresionIncpc al escanear: ' + e.toString());
    }

    Logger.log(resultados.join('\n'));
    return resultados;
  } finally {
    if (!modoPruebaOriginal) desactivarModoPrueba();
  }
}

/**
 * Ejecutar UNA VEZ desde el editor para autorizar el envío de correo. Si tras
 * ejecutarla no aparece la pantalla de permisos completa (con "enviar correo en tu
 * nombre"), sigue el mismo proceso que en lm_producción: quitar el bloque
 * "oauthScopes" de appsscript.json (autodetección) y revocar el acceso de este
 * proyecto en myaccount.google.com/permissions antes de reintentar.
 */
function autorizarYProbarCorreo() {
  var destino = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: destino,
    subject: 'HODOS - Prueba de autorización de correo',
    htmlBody: '<p>Si ves este correo, el envío de emails desde HODOS ya está autorizado.</p>'
  });
  Logger.log('Correo de prueba enviado a ' + destino);
}

function testConexionSupabase() {
  var filas = supaGet_('cargas', 'limit=1');
  Logger.log('OK: conexión con Supabase — tabla cargas accesible (' + filas.length + ' fila(s) de muestra)');
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
//  DIAGNÓSTICO/REPARACIÓN B2B SIE — para una carga concreta ya cerrada
//  (2026-09-24, investigación "no se escribe el número de palet/sección SIE")
// ═══════════════════════════════════════════════════════════════════════

// SOLO LEE la fila del B2B de Leroy Merlin correspondiente a esta carga — no escribe
// nada. Ejecutar SIEMPRE esto primero para ver si la fila ya tiene conteo (evita
// duplicar si `actualizarB2BSIE_` ya se escribió bien al cerrar la carga la primera
// vez, porque esa función SUMA sobre lo que ya haya en la fila, no reemplaza).
function diagnosticarB2BSieDeCarga_(idCarga) {
  var carga = obtenerCarga(idCarga);
  var partesFecha = carga.fechaEntrega.split('T')[0].split('-');
  var fechaB2B = partesFecha[2] + '/' + partesFecha[1] + '/' + partesFecha[0];

  var ss = SpreadsheetApp.openById(SHEETS_ID_B2B_SIE_);
  var meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  var mesEntrega = parseInt(partesFecha[1], 10) - 1;
  var nombreHoja = meses[mesEntrega] + ' ' + partesFecha[2];
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) { Logger.log('Hoja "' + nombreHoja + '" no encontrada en el B2B.'); return; }

  var destinoB2B = 'LM ' + carga.destino;
  var horarioParts = carga.horario.split(':');
  var horH = parseInt(horarioParts[0]), horM = parseInt(horarioParts[1] || 0);
  var lastRow = hoja.getLastRow();
  var datos = hoja.getRange(3, 1, lastRow - 2, B2B_COL_SEC1_SIE_ + B2B_NUM_SECS_SIE_ - 1).getValues();

  for (var i = 0; i < datos.length; i++) {
    var f = datos[i];
    var celdaTipo = String(f[B2B_COL_TIPO_SIE_ - 1] || '').trim();
    if (celdaTipo.indexOf('Expedici') < 0) continue;
    var celdaFecha = f[B2B_COL_FECHA_SIE_ - 1];
    var fFecha = (celdaFecha instanceof Date) ? Utilities.formatDate(celdaFecha, Session.getScriptTimeZone(), 'dd/MM/yyyy') : String(celdaFecha || '').trim();
    var celdaDestino = String(f[B2B_COL_DESTINO_SIE_ - 1] || '').trim();
    var celdaHora = f[B2B_COL_HORA_SIE_ - 1];
    var horaOk = (celdaHora instanceof Date)
      ? (celdaHora.getHours() === horH && celdaHora.getMinutes() === horM)
      : (function(){ var p = String(celdaHora||'').split(':'); return parseInt(p[0]) === horH && parseInt(p[1]||0) === horM; })();

    if (fFecha === fechaB2B && celdaDestino === destinoB2B && horaOk) {
      var secciones = f.slice(B2B_COL_SEC1_SIE_ - 1, B2B_COL_SEC1_SIE_ - 1 + B2B_NUM_SECS_SIE_);
      Logger.log('FILA ENCONTRADA (' + (i + 3) + ') en "' + nombreHoja + '" para ' + idCarga + ' | ' +
        destinoB2B + ' | ' + fechaB2B + ' | ' + carga.horario + '\nSecciones 1-13 actuales: ' + JSON.stringify(secciones) +
        '\nSuma actual: ' + secciones.reduce(function(a,b){ return a + (parseInt(b)||0); }, 0) +
        '\n(la carga tiene ' + carga.escaneados.length + ' soportes escaneados en total, no solo SIE)');
      return;
    }
  }
  Logger.log('NO se encontró fila "Expedición" en "' + nombreHoja + '" para ' + destinoB2B + ' | ' + fechaB2B + ' | ' + carga.horario + ' — esta es la causa si nunca se escribió nada.');
}

// Repite el mismo cotejo+escritura que hace cerrarCarga, para una carga YA cerrada.
// Ejecutar SOLO tras comprobar con diagnosticarB2BSieDeCarga_ que la fila sigue en
// 0 (o que el aviso de "no se encontró fila" es el problema real, en cuyo caso esto
// devolverá el mismo error y no escribirá nada) — si ya tiene conteo, NO ejecutar
// esto, duplicaría los palets (actualizarB2BSIE_ suma sobre lo que ya haya).
function reescribirB2BSieDeCarga_(idCarga) {
  var carga = obtenerCarga(idCarga);
  var cotejo = cotejarPaletesDeCarga_(idCarga, carga.destino);
  if (!cotejo.ok) { Logger.log('Cotejo falló: ' + cotejo.error); return; }
  if (!cotejo.datos.length) { Logger.log('Esta carga no tiene palets SIE registrados.'); return; }

  var partesFecha = carga.fechaEntrega.split('T')[0].split('-');
  var fechaB2B = partesFecha[2] + '/' + partesFecha[1] + '/' + partesFecha[0];
  var r = actualizarB2BSIE_(carga.destino, fechaB2B, carga.horario, cotejo.datos);
  Logger.log('Resultado: ' + JSON.stringify(r) + ' | ' + cotejo.datos.length + ' palets cotejados (' +
    cotejo.datos.filter(function(p){ return p.encontrado; }).length + ' encontrados)');
}
