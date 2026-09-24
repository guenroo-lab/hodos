# HODOS — Rediseño "Cargar camión" + fecha rápida + entrada manual + carga masiva oculta + informe sin Drive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar visualmente el Paso 1/2 de "Cargar camión" (indicador de pasos, chips de
fecha con hoy por defecto, colores de tienda sólidos), añadir un modo de entrada manual
sin autoenvío en el escaneo, añadir una carga masiva accesible solo por gesto oculto
(pulsación larga de 2s sobre el título de la carga, sin ninguna pista visual), simplificar
la lista de soportes en pantalla a solo ID+Origen, y cambiar el informe de cierre de carga
para que ya no se guarde copia en Drive y llegue por ahora solo al equipo de la
plataforma (10 destinatarios fijos), blindando las pruebas automáticas para que nunca
puedan enviar un correo real mientras tanto.

**Architecture:** Todo el trabajo de UI vive en `Index.html` (una sola vista `#vistaCamion`,
sin vistas nuevas). No se crean funciones de backend nuevas — la carga masiva reutiliza
`escanearSoporte`/`obtenerPendientesPorTienda` ya existentes, llamando a `escanearSoporte`
una vez por soporte seleccionado (hereda gratis las validaciones de destino/duplicado). El
cambio de informe toca `cerrarCarga` (`Backend.gs`) y las listas de `ConfigEntregas.gs`.
`Pruebas.gs` se blinda envolviendo `verificarSistema()` en un guardado/restaurado del
modo prueba, para que las pruebas nunca dependan del estado real de producción.

**Tech Stack:** GAS V8 + HtmlService + clasp (igual que el resto de HODOS). No se puede
ejecutar GAS en local — cada tarea termina con `clasp push -f` y la verificación final se
hace ejecutando `verificarSistema()` desde el editor de Apps Script más un recorrido
manual en el navegador (mismo patrón que los planes anteriores de este proyecto). No hay
lógica pura nueva que amerite `node --test` — todo lo añadido es UI cliente o reutiliza
funciones de servidor ya testeadas en planes previos.

**Referencias:**
- Diseño: `docs/superpowers/specs/2026-08-04-rediseno-carga-camion-design.md`
- Plan/spec de la fase que esto extiende: `docs/superpowers/plans/2026-07-28-carga-camion.md`
- `.clasp.json` ya tiene el `scriptId` configurado — no hace falta pedirlo.

---

## Task 1: `ConfigEntregas.gs` — destinatarios temporales del informe

**Files:**
- Modify: `Desktop/Proyectos/hodos/ConfigEntregas.gs`

- [ ] **Step 1: Sustituir las listas de destinatarios**

Reemplazar las líneas 1–58 (desde el comentario de cabecera hasta el cierre de
`EMAILS_PEDIDO_CLIENTE_CC`, sin tocar `HORARIOS_ENTREGA_TIENDA` ni las funciones de modo
prueba que vienen después) por:

```js
// ConfigEntregas.gs — destinatarios y horarios del informe de cierre de carga.
// Marbella/Mijas copiado literal de CartaPortes.gs (EMAILS_CARTA_TIENDA / EMAILS_CARTA_CC /
// HORARIOS_CAMIONES) para mantener coherencia con quién recibe hoy la Carta de Portes.
//
// 2026-08-04: sustituidas TEMPORALMENTE las 4 listas por tienda por una única lista común
// (solo el equipo de la plataforma) — el usuario añadirá las listas específicas de cada
// tienda "en próximas semanas". Las listas reales anteriores (con gente de cada tienda)
// quedan documentadas aquí, sin usarse, por si hace falta recuperarlas:
//
//   Marbella: francisco-damian.sedeno@leroymerlin.es, miguel-angel.gonzalez5@leroymerlin.es,
//             logistica.marbella@leroymerlin.es
//   Mijas:    hector.andres@leroymerlin.es, salvador.gonzalez2@leroymerlin.es,
//             carlos.fuentes@leroymerlin.es, logistica.mijas@leroymerlin.es,
//             carlos.verastegui2@leroymerlin.es, daniel.arrastio@ext.leroymerlin.es,
//             daniel.simo@ext.leroymerlin.es, david.jimenez2@leroymerlin.es,
//             david.martin4@leroymerlin.es, diego-jose.ramos@leroymerlin.es,
//             estefania.barranco@leroymerlin.es, estefania.fortuna@leroymerlin.es,
//             francisco-javier.camara@ext.leroymerlin.es, francisco-javier.valero@leroymerlin.es,
//             gema-pilar.arredondo@leroymerlin.es, hugo-miguel.ponce@leroymerlin.es,
//             ignacio.lorite@leroymerlin.es, maite.perez@leroymerlin.es, marta.diaz@leroymerlin.es,
//             paola-valeria.rodriguez@leroymerlin.es, patricia.vilchez@leroymerlin.es,
//             pedro.guzman@leroymerlin.es, purificacion.estepa@leroymerlin.es,
//             sandra.longhi@leroymerlin.es, sebastian.gelvis@ext.leroymerlin.es,
//             vicente.amador@leroymerlin.es
//   Málaga:   javier.navarro@leroymerlin.es, adolfo.garcia@leroymerlin.es,
//             samuel.guerrero@leroymerlin.es, ivan.perez2@leroymerlin.es
//   Granada:  pedro.lopez2@leroymerlin.es, liliana.garcia@leroymerlin.es,
//             macarena.jimenez@leroymerlin.es
//   CC anterior: administracion.alm-malaga@leroymerlin.es, jose-manuel.lachambre@leroymerlin.es,
//                pedro.gil@ext.leroymerlin.es, david.delcampo@ext.leroymerlin.es,
//                jose-antonio.alcaide@ext.leroymerlin.es

var EMAILS_PLATAFORMA_TEMPORAL_ = [
  'administracion.alm-malaga@leroymerlin.es',
  'pedidocliente.alm-malaga@leroymerlin.es'
];

var EMAILS_PEDIDO_CLIENTE_TIENDA = {
  'Marbella': EMAILS_PLATAFORMA_TEMPORAL_,
  'Mijas': EMAILS_PLATAFORMA_TEMPORAL_,
  'Málaga': EMAILS_PLATAFORMA_TEMPORAL_,
  'Granada': EMAILS_PLATAFORMA_TEMPORAL_
};

var EMAILS_PEDIDO_CLIENTE_CC = [
  'jose-manuel.lachambre@leroymerlin.es',
  'pedro.gil@ext.leroymerlin.es',
  'jose-antonio.alcaide@ext.leroymerlin.es',
  'david.delcampo@ext.leroymerlin.es',
  'daniel.arrastio@ext.leroymerlin.es',
  'sebastian.gelvis@ext.leroymerlin.es',
  'daniel.simo@ext.leroymerlin.es',
  'francisco-javier.camara@ext.leroymerlin.es'
];
```

- [ ] **Step 2: Push a Apps Script**

Run: `cd Desktop/Proyectos/hodos && clasp push -f`

---

## Task 2: `Backend.gs` — `cerrarCarga` sin copia permanente en Drive

**Files:**
- Modify: `Desktop/Proyectos/hodos/Backend.gs:548-601`

- [ ] **Step 1: Quitar el guardado permanente y `pdfUrl`**

Reemplazar desde `var carga = obtenerCarga(idCarga);` hasta el `return` final de
`cerrarCarga` por:

```js
  var carga = obtenerCarga(idCarga);
  var htmlPdf = htmlInformeCarga(idCarga);
  var fechaArchivo = carga.fechaEntrega.split('T')[0];

  // Sin copia permanente en Drive (2026-08-04): el archivo temporal sigue siendo
  // necesario porque Apps Script solo sabe convertir HTML a PDF a través de un archivo
  // de Drive, pero se borra igual que antes — pdfFile (el blob PDF resultante) se usa
  // directamente como adjunto de MailApp y nunca se guarda con createFile().
  var tempFile = DriveApp.getRootFolder().createFile('_temp_hodos_informe.html', htmlPdf, 'text/html');
  var pdfFile = tempFile.getAs('application/pdf');
  pdfFile.setName('HODOS_PedidoCliente_' + carga.destino + '_' + fechaArchivo + '_' + idCarga + '.pdf');
  DriveApp.getFileById(tempFile.getId()).setTrashed(true);

  var destinatarios = EMAILS_PEDIDO_CLIENTE_TIENDA[carga.destino] || [];
  var emailEnviado = 'NO';
  if (modoPruebaActivo()) {
    emailEnviado = 'MODO_PRUEBA (no enviado)';
  } else if (destinatarios.length > 0) {
    try {
      MailApp.sendEmail({
        to: destinatarios.join(','),
        cc: EMAILS_PEDIDO_CLIENTE_CC.join(','),
        subject: 'HODOS · Pedido Cliente · ' + carga.destino + ' · ' + fechaArchivo + (carga.horario ? ' · ' + carga.horario : ''),
        htmlBody: htmlPdf,
        attachments: [pdfFile]
      });
      emailEnviado = 'SI';
    } catch (e) {
      emailEnviado = 'ERROR: ' + e.message;
    }
  }

  actualizarCarga_(idCarga, {
    estado: 'CERRADA',
    cerradaPor: Session.getActiveUser().getEmail() || 'desconocido',
    fechaCierre: new Date().toISOString(),
    emailEnviado: emailEnviado
  });
  try {
    CacheService.getScriptCache().remove(claveCacheCarga_(idCarga));
  } catch (e) {
    // No debe impedir informar del cierre correcto: la carga ya quedó CERRADA en
    // Supabase. Peor caso si esto falla: la entrada de caché sigue diciendo ABIERTA
    // hasta que expire su TTL — degradación aceptable (un escaneo posterior erróneo
    // sobre una carga ya cerrada seguiría siendo posible durante ese tiempo, pero no
    // es peor que el riesgo ya aceptado en el spec de migración), no una escritura
    // incorrecta nueva.
  }

  return {
    idCarga: idCarga, cantidad: carga.escaneados.length,
    emailEnviado: emailEnviado, destinatariosConfigurados: destinatarios.length
  };
}
```

Nota: la columna `pdf_url` de Supabase no se toca (ya existe) — simplemente deja de
recibir valores nuevos desde este momento. No hace falta ninguna migración.

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

---

## Task 3: `Pruebas.gs` — blindar `verificarSistema()` frente a envíos reales

**Files:**
- Modify: `Desktop/Proyectos/hodos/Pruebas.gs:12-247`

- [ ] **Step 1: Reemplazar `verificarSistema()` completa**

Sustituir toda la función `verificarSistema()` (desde `function verificarSistema() {`
hasta su `}` de cierre) por la versión de abajo. Cambios respecto a la actual: (a) envuelve
todo el cuerpo en un guardado/restaurado del modo prueba, forzándolo activo mientras
corren las pruebas, sea cual sea el estado real en producción; (b) el bloque de "fase 3"
ya no muestra `pdfUrl` (se ha eliminado, ver Task 2); (c) el bloque de "regresión de
seguridad" de Mijas se simplifica porque el blindaje garantiza que el modo prueba está
activo durante la prueba — ya no hace falta la rama que la saltaba con un aviso.

```js
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
      // verifica justo el mecanismo de coincidencia FIFO — pero por eso mismo pedidosPendientesEnCarga/
      // escanearSoporte buscan en TODA la hoja por ese número, así que se genera único por
      // ejecución (timestamp) para no acumular filas huérfanas de ejecuciones anteriores
      // (la prueba de "pedido incompleto", más abajo, tenía justo este bug con "930001" fijo).
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
      // pedidosPendientesEnCarga busca en TODA la hoja por número de pedido (no solo en
      // esta carga) — un valor de pedido fijo tipo "930001" reutilizado en cada ejecución
      // acumula filas REGISTRADO huérfanas de ejecuciones anteriores (esto pasó de verdad:
      // 2026-07-29, "faltan 2 soporte(s)" venía de dos ejecuciones previas a este mismo
      // fix, no de esta ejecución). Por eso el número de pedido se genera único por
      // ejecución (timestamp) — así esta prueba nunca puede ensuciarse ni ensuciar
      // ejecuciones futuras. Se escanea por idUnico (exacto), y al final se completa y
      // cierra de verdad (autolimpieza: sin esto, la carga quedaría ABIERTA para siempre).
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
      // Limpieza defensiva PRIMERO: versiones anteriores de esta prueba nunca cerraban la
      // carga de prueba, así que podría quedar una ABIERTA de una ejecución antigua — si no
      // se cierra antes, r1 la "reutilizaría" y la aserción de abajo daría un falso ERROR.
      var abiertaPrevia = listarCargasAbiertas().filter(function (c) {
        return c.destino === 'Málaga' && c.fechaEntrega === '2026-07-30' && c.horario === '18:00';
      })[0];
      if (abiertaPrevia) cerrarCarga(abiertaPrevia.idCarga);

      var r1 = obtenerOCrearCarga('Málaga', '2026-07-30', '18:00');
      var r2 = obtenerOCrearCarga('Málaga', '2026-07-30', '18:00');
      var okReutiliza = !r1.reutilizada && r2.reutilizada && r1.idCarga === r2.idCarga;
      resultados.push(okReutiliza
        ? 'OK: obtenerOCrearCarga reutiliza la carga abierta con mismo destino+fecha+horario'
        : 'ERROR obtenerOCrearCarga: ' + JSON.stringify([r1, r2]));
      // Autolimpieza: sin esto, esta carga de prueba quedaría ABIERTA para siempre y
      // rompería la próxima ejecución de esta misma prueba (bug real encontrado en revisión).
      cerrarCarga(r1.idCarga);
    } catch (e) {
      resultados.push('ERROR obtenerOCrearCarga: ' + e.toString());
    }

    try {
      // Regresión de seguridad: Mijas SÍ tiene destinatarios reales configurados. Con el
      // blindaje de arriba, verificarSistema() SIEMPRE corre con el modo prueba forzado a
      // activo, así que cerrar una carga para Mijas aquí NUNCA debe enviar un email real
      // aunque haya destinatarios — solo generar el PDF. Se mantiene esta aserción como
      // red de seguridad por si el blindaje se rompiera en el futuro.
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

    Logger.log(resultados.join('\n'));
    return resultados;
  } finally {
    if (!modoPruebaOriginal) desactivarModoPrueba();
  }
}
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

- [ ] **Step 3: Ejecutar desde el editor y revisar el resultado**

Abrir el proyecto en el editor de Apps Script (`clasp open`), seleccionar la función
`verificarSistema` y ejecutarla. Revisar el log: todas las líneas deben empezar por "OK:"
— ninguna "ERROR". Confirmar en particular la línea de "modo prueba activo -> ... NO
envía email de verdad" (prueba de que el blindaje funciona) y que no hay ninguna mención
a `pdfUrl` en la salida.

---

## Task 4: `Index.html` — CSS nuevo (stepper, tienda sólida, chips de fecha, modo manual, carga masiva)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html:170-179`

- [ ] **Step 1: Sustituir el bloque de color de `.tienda-btn.sel-*` y añadir el resto de estilos nuevos**

Reemplazar (líneas 170–179):

```css
    .tienda-btn.sel-malaga   { border-color:#22c55e; background:rgba(34,197,94,0.12);  box-shadow:0 0 16px rgba(34,197,94,0.25); }
    .tienda-btn.sel-marbella { border-color:#3498db; background:rgba(52,152,219,0.12); box-shadow:0 0 16px rgba(52,152,219,0.25); }
    .tienda-btn.sel-mijas    { border-color:#9b59b6; background:rgba(155,89,182,0.12); box-shadow:0 0 16px rgba(155,89,182,0.25); }
    .tienda-btn.sel-granada  { border-color:#f39c12; background:rgba(243,156,18,0.12); box-shadow:0 0 16px rgba(243,156,18,0.25); }
    .tienda-btn.sel-malaga .tienda-check, .tienda-btn.sel-marbella .tienda-check,
    .tienda-btn.sel-mijas .tienda-check, .tienda-btn.sel-granada .tienda-check { display:inline; }
    .tienda-btn.sel-malaga .tienda-name   { color:#22c55e; }
    .tienda-btn.sel-marbella .tienda-name { color:#3498db; }
    .tienda-btn.sel-mijas .tienda-name    { color:#9b59b6; }
    .tienda-btn.sel-granada .tienda-name  { color:#f39c12; }
```

Por (nótese que sigue siendo el mismo selector CSS, solo cambia relleno tenue → sólido, y
se añaden los bloques nuevos de stepper/chips/modo manual/carga masiva a continuación):

```css
    .tienda-btn.sel-malaga   { border-color:#22c55e; background:#22c55e; box-shadow:0 4px 14px rgba(34,197,94,0.35); }
    .tienda-btn.sel-marbella { border-color:#3498db; background:#3498db; box-shadow:0 4px 14px rgba(52,152,219,0.35); }
    .tienda-btn.sel-mijas    { border-color:#9b59b6; background:#9b59b6; box-shadow:0 4px 14px rgba(155,89,182,0.35); }
    .tienda-btn.sel-granada  { border-color:#f39c12; background:#f39c12; box-shadow:0 4px 14px rgba(243,156,18,0.35); }
    .tienda-btn.sel-malaga .tienda-check, .tienda-btn.sel-marbella .tienda-check,
    .tienda-btn.sel-mijas .tienda-check, .tienda-btn.sel-granada .tienda-check { display:inline; }
    .tienda-btn.sel-malaga .tienda-name, .tienda-btn.sel-marbella .tienda-name,
    .tienda-btn.sel-mijas .tienda-name, .tienda-btn.sel-granada .tienda-name { color:#fff; }
    .tienda-btn.sel-malaga .tienda-dot, .tienda-btn.sel-marbella .tienda-dot,
    .tienda-btn.sel-mijas .tienda-dot, .tienda-btn.sel-granada .tienda-dot { background:#fff; }

    /* ── Indicador de pasos (Cargar camión) ── */
    .camion-stepper { display:flex; align-items:center; margin-bottom:24px; }
    .camion-stepper .paso { display:flex; align-items:center; gap:10px; opacity:0.45; }
    .camion-stepper .paso.activo, .camion-stepper .paso.hecho { opacity:1; }
    .camion-stepper .paso .num {
      width:26px; height:26px; border-radius:50%; flex-shrink:0;
      background:var(--input-bg); border:2px solid var(--input-border);
      display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;
    }
    .camion-stepper .paso.activo .num { background:var(--color-accent); border-color:var(--color-accent); color:#fff; }
    .camion-stepper .paso.hecho .num { background:#22c55e; border-color:#22c55e; color:#fff; }
    .camion-stepper .paso .etiqueta { font-size:12.5px; font-weight:600; white-space:nowrap; }
    .camion-stepper .linea { flex:1; height:2px; background:var(--input-border); margin:0 10px; }

    /* ── Chips de fecha rápida (Cargar camión) ── */
    .fecha-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
    .fecha-chip {
      padding:10px 14px; border-radius:999px; font-size:12.5px; font-weight:600;
      background:var(--input-bg); border:1px solid var(--input-border); color:var(--text-primary);
      cursor:pointer;
    }
    .fecha-chip.sel { background:var(--color-accent); border-color:var(--color-accent); color:#fff; }
    .fecha-chip.fecha-chip-otra { border-style:dashed; }

    /* ── Modo manual en el escaneo (Cargar camión) ── */
    #btnModoManual.activo { background:var(--color-accent); border-color:var(--color-accent); color:#fff; }

    /* ── Panel de carga masiva (Cargar camión, acceso por gesto oculto) ── */
    .item-carga-masiva { display:flex; align-items:center; gap:10px; padding:9px 4px; border-bottom:1px solid var(--input-border); font-size:13px; }
    .item-carga-masiva .info { flex:1; }
    .item-carga-masiva .info .id { font-weight:600; }
    .item-carga-masiva .info .origen { opacity:0.7; font-size:11.5px; }
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

---

## Task 5: `Index.html` — Paso 1: indicador de pasos + chips de fecha (hoy por defecto)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html:387-409` (markup de `#camionPaso1`)
- Modify: `Desktop/Proyectos/hodos/Index.html` (JS: nuevas funciones + `iniciarVistaOperario_`)

- [ ] **Step 1: Markup — añadir el stepper y sustituir el campo de fecha por chips**

Reemplazar el bloque completo de `#camionPaso1` (líneas 388–409):

```html
      <div id="camionPaso1">
        <label>Tienda destino</label>
        <div class="tienda-selector" id="camionTiendaSelector">
          <button type="button" class="tienda-btn tienda-malaga" data-tienda="Málaga" onclick="seleccionarTiendaCamion_('Málaga')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Málaga</span>
          </button>
          <button type="button" class="tienda-btn tienda-marbella" data-tienda="Marbella" onclick="seleccionarTiendaCamion_('Marbella')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Marbella</span>
          </button>
          <button type="button" class="tienda-btn tienda-mijas" data-tienda="Mijas" onclick="seleccionarTiendaCamion_('Mijas')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Mijas</span>
          </button>
          <button type="button" class="tienda-btn tienda-granada" data-tienda="Granada" onclick="seleccionarTiendaCamion_('Granada')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Granada</span>
          </button>
        </div>
        <div class="busqueda-form">
        <div class="form-group"><label>Fecha de entrega</label><input type="date" id="camionFecha"></div>
        <div class="form-group"><label>Horario</label><select id="camionHorario"></select></div>
        <button onclick="crearCargaUI()">Abrir carga</button>
        </div>
      </div>
```

Por:

```html
      <div id="camionPaso1">
        <div class="camion-stepper" id="camionStepper">
          <div class="paso" data-paso="1"><div class="num">1</div><div class="etiqueta">Tienda y fecha</div></div>
          <div class="linea"></div>
          <div class="paso" data-paso="2"><div class="num">2</div><div class="etiqueta">Escanear</div></div>
          <div class="linea"></div>
          <div class="paso" data-paso="3"><div class="num">3</div><div class="etiqueta">Cerrar</div></div>
        </div>
        <label>Tienda destino</label>
        <div class="tienda-selector" id="camionTiendaSelector">
          <button type="button" class="tienda-btn tienda-malaga" data-tienda="Málaga" onclick="seleccionarTiendaCamion_('Málaga')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Málaga</span>
          </button>
          <button type="button" class="tienda-btn tienda-marbella" data-tienda="Marbella" onclick="seleccionarTiendaCamion_('Marbella')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Marbella</span>
          </button>
          <button type="button" class="tienda-btn tienda-mijas" data-tienda="Mijas" onclick="seleccionarTiendaCamion_('Mijas')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Mijas</span>
          </button>
          <button type="button" class="tienda-btn tienda-granada" data-tienda="Granada" onclick="seleccionarTiendaCamion_('Granada')">
            <span class="tienda-check">✓</span><span class="tienda-dot"></span><span class="tienda-name">Granada</span>
          </button>
        </div>
        <div class="busqueda-form">
        <div class="form-group">
          <label>Fecha de entrega</label>
          <div class="fecha-chips" id="camionFechaChips"></div>
          <input type="date" id="camionFecha" class="vista-oculta" style="margin-top:8px;">
        </div>
        <div class="form-group"><label>Horario</label><select id="camionHorario"></select></div>
        <button onclick="crearCargaUI()">Abrir carga</button>
        </div>
      </div>
```

- [ ] **Step 2: JS — funciones de chips de fecha y del stepper**

Insertar, justo antes de `function crearCargaUI() {` (esa función queda intacta debajo):

```js
  var DIAS_CORTOS_ = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  function fechaComoValorInput_(d) {
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function generarChipsFecha_() {
    var hoy = new Date();
    var chips = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
      var valor = fechaComoValorInput_(d);
      var etiqueta = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : (DIAS_CORTOS_[d.getDay()] + ' ' + d.getDate());
      chips.push({ valor: valor, etiqueta: etiqueta });
    }
    var cont = document.getElementById('camionFechaChips');
    cont.innerHTML = chips.map(function (c) {
      return '<div class="fecha-chip" data-valor="' + c.valor + '" onclick="seleccionarChipFecha_(\'' + c.valor + '\')">' + c.etiqueta + '</div>';
    }).join('') + '<div class="fecha-chip fecha-chip-otra" id="chipOtraFecha" onclick="activarOtraFecha_()">📅 Otra fecha</div>';
    // Por defecto, "Hoy" queda seleccionado y camionFecha.value se inicializa a hoy.
    document.getElementById('camionFecha').value = chips[0].valor;
    marcarChipSeleccionado_(chips[0].valor);
  }

  function marcarChipSeleccionado_(valor) {
    var cont = document.getElementById('camionFechaChips');
    var encontrado = false;
    cont.querySelectorAll('.fecha-chip[data-valor]').forEach(function (el) {
      var sel = el.dataset.valor === valor;
      el.classList.toggle('sel', sel);
      if (sel) encontrado = true;
    });
    var chipOtra = document.getElementById('chipOtraFecha');
    chipOtra.classList.toggle('sel', !encontrado);
    chipOtra.textContent = encontrado ? '📅 Otra fecha' : '📅 ' + valor;
    document.getElementById('camionFecha').classList.toggle('vista-oculta', encontrado);
  }

  function seleccionarChipFecha_(valor) {
    document.getElementById('camionFecha').value = valor;
    marcarChipSeleccionado_(valor);
  }

  function activarOtraFecha_() {
    document.getElementById('camionFecha').classList.remove('vista-oculta');
    document.getElementById('camionFecha').focus();
  }

  // Si se elige la fecha a mano desde "Otra fecha", refleja la selección en los chips
  // (puede coincidir con uno de los 7 chips o quedar como fecha suelta).
  document.getElementById('camionFecha').addEventListener('change', function () {
    marcarChipSeleccionado_(this.value);
  });

  function actualizarStepper_(pasoActivo) {
    document.querySelectorAll('#camionStepper .paso').forEach(function (el) {
      var n = parseInt(el.dataset.paso, 10);
      el.classList.toggle('hecho', n < pasoActivo);
      el.classList.toggle('activo', n === pasoActivo);
    });
  }

```

- [ ] **Step 3: JS — inicializar los chips y el stepper al entrar en la vista de operario**

`iniciarVistaOperario_` queda así (se añaden las 2 líneas iniciales y las 2 líneas dentro
del `.then()` marcadas más abajo; el resto de la función no cambia):

```js
  function iniciarVistaOperario_() {
    generarChipsFecha_();
    actualizarStepper_(1);
    if (TIENDA_FILTRO) {
      marcarTiendaCamionSeleccionada_(TIENDA_FILTRO);
    }
    poblarHorarios_().then(function () {
      if (FECHA_CONTEXTO) {
        document.getElementById('camionFecha').value = FECHA_CONTEXTO;
        marcarChipSeleccionado_(FECHA_CONTEXTO);
      }
      if (HORARIO_CONTEXTO) document.getElementById('camionHorario').value = HORARIO_CONTEXTO;

      if (TIENDA_FILTRO && FECHA_CONTEXTO && HORARIO_CONTEXTO) {
        // Contexto completo (llegada cruzada desde Carta de Portes SIE): sin volver a
        // preguntar destino/fecha/hora, seguir directamente la carga de ese camión.
        abrirCargaDirecta_(TIENDA_FILTRO, FECHA_CONTEXTO, HORARIO_CONTEXTO);
      }
    });
  }
```

- [ ] **Step 4: Push a Apps Script**

Run: `clasp push -f`

---

## Task 6: `Index.html` — Paso 2: modo manual en el escaneo (sin autoenvío)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html` (markup del campo de escaneo)
- Modify: `Desktop/Proyectos/hodos/Index.html` (JS: toggle + listener de autoenvío + `abrirCargaDirecta_`)

- [ ] **Step 1: Markup — botones junto al campo de escaneo**

Reemplazar:

```html
          <div class="form-group">
            <label>Escanea aquí (lector de código de barras)</label>
            <input type="text" id="camionEscaneo" autocomplete="off" placeholder="Esperando lectura...">
          </div>
```

Por:

```html
          <div class="form-group">
            <label>Escanea aquí (lector de código de barras)</label>
            <div style="display:flex;gap:8px;align-items:stretch;">
              <input type="text" id="camionEscaneo" autocomplete="off" placeholder="Esperando lectura..." style="flex:1;">
              <button type="button" class="btn-secundario btn-modo-manual" id="btnModoManual" onclick="toggleModoManual_()" style="white-space:nowrap;">⌨ Introducir a mano</button>
              <button type="button" class="btn-secundario vista-oculta" id="btnAnadirManual" onclick="procesarEscaneo_(document.getElementById('camionEscaneo'))" style="white-space:nowrap;">Añadir</button>
            </div>
          </div>
```

- [ ] **Step 2: JS — toggle del modo manual**

Insertar justo antes de `var camionEscaneoInput_ = document.getElementById('camionEscaneo');`:

```js
  var modoManualActivo_ = false;

  function toggleModoManual_() {
    modoManualActivo_ = !modoManualActivo_;
    document.getElementById('btnModoManual').classList.toggle('activo', modoManualActivo_);
    document.getElementById('btnAnadirManual').classList.toggle('vista-oculta', !modoManualActivo_);
    document.getElementById('camionEscaneo').placeholder = modoManualActivo_
      ? 'Modo manual: escribe y pulsa Intro o Añadir'
      : 'Esperando lectura...';
  }

```

- [ ] **Step 3: JS — el listener de autoenvío respeta el modo manual**

Reemplazar:

```js
  camionEscaneoInput_.addEventListener('input', function () {
    // Autointro: si la pistola de código de barras no manda Intro al terminar de leer,
    // esto detecta el patrón típico de una lectura (ráfaga de caracteres seguida de un
    // silencio, toda ella muy rápida) y envía el escaneo sola, sin esperar a que nadie
    // pulse nada. Si en cambio el valor se tecleó a mano y se tardó más de
    // ESCANEO_MAX_DURACION_MS_ en total, NO se autoenvía al hacer la pausa: se asume
    // que es tecleo manual y sigue haciendo falta Intro (para no disparar el envío a
    // medias mientras alguien corrige un número).
    var el = this;
    if (ESCANEO_BUFFER_.timer) clearTimeout(ESCANEO_BUFFER_.timer);
    if (!ESCANEO_BUFFER_.inicio) ESCANEO_BUFFER_.inicio = Date.now();
    ESCANEO_BUFFER_.timer = setTimeout(function () {
      var duracion = Date.now() - ESCANEO_BUFFER_.inicio;
      ESCANEO_BUFFER_.inicio = 0;
      if (duracion <= ESCANEO_MAX_DURACION_MS_ && el.value.trim()) {
        procesarEscaneo_(el);
      }
    }, ESCANEO_PAUSA_MS_);
  });
```

Por:

```js
  camionEscaneoInput_.addEventListener('input', function () {
    // Modo manual (botón "Introducir a mano"): nunca autoenvía, sea cual sea la
    // velocidad de tecleo — solo se añade con Intro o el botón "Añadir".
    if (modoManualActivo_) return;
    // Autointro: si la pistola de código de barras no manda Intro al terminar de leer,
    // esto detecta el patrón típico de una lectura (ráfaga de caracteres seguida de un
    // silencio, toda ella muy rápida) y envía el escaneo sola, sin esperar a que nadie
    // pulse nada. Si en cambio el valor se tecleó a mano y se tardó más de
    // ESCANEO_MAX_DURACION_MS_ en total, NO se autoenvía al hacer la pausa: se asume
    // que es tecleo manual y sigue haciendo falta Intro (para no disparar el envío a
    // medias mientras alguien corrige un número).
    var el = this;
    if (ESCANEO_BUFFER_.timer) clearTimeout(ESCANEO_BUFFER_.timer);
    if (!ESCANEO_BUFFER_.inicio) ESCANEO_BUFFER_.inicio = Date.now();
    ESCANEO_BUFFER_.timer = setTimeout(function () {
      var duracion = Date.now() - ESCANEO_BUFFER_.inicio;
      ESCANEO_BUFFER_.inicio = 0;
      if (duracion <= ESCANEO_MAX_DURACION_MS_ && el.value.trim()) {
        procesarEscaneo_(el);
      }
    }, ESCANEO_PAUSA_MS_);
  });
```

- [ ] **Step 4: JS — resetear el modo manual y avanzar el stepper al abrir una carga**

En `abrirCargaDirecta_`, reemplazar:

```js
  function abrirCargaDirecta_(destino, fecha, horario) {
    // Compartida entre el flujo manual (Paso 1) y la llegada cruzada desde Carta de
    // Portes SIE (vista operario): usa obtenerOCrearCarga para "seguir" una carga ya
    // abierta con el mismo destino+fecha+horario en vez de duplicarla.
    gas('obtenerOCrearCarga', destino, fecha, horario).then(function (r) {
      cargaActualId = r.idCarga;
      document.getElementById('camionPaso1').classList.add('vista-oculta');
      document.getElementById('camionPaso2').classList.remove('vista-oculta');
      document.getElementById('camionTitulo').textContent =
        r.idCarga + ' — ' + destino + ' ' + fecha + ' ' + horario + (r.reutilizada ? ' (continuando)' : '');
      actualizarEnlaceCartaPortes_(destino, fecha, horario);
      var input = document.getElementById('camionEscaneo');
      input.value = '';
      input.focus();
      gas('modoPruebaActivo').then(function (activo) {
        document.getElementById('camionBadgePrueba').classList.toggle('vista-oculta', !activo);
      });
      // Si se reutiliza una carga ya empezada, mostrar lo que ya se había escaneado.
      gas('obtenerCarga', cargaActualId).then(function (c) { renderizarListaCamion_(c.escaneados); });
    }).catch(function (err) { alert('Error al abrir la carga: ' + err.message); });
  }
```

Por:

```js
  function abrirCargaDirecta_(destino, fecha, horario) {
    // Compartida entre el flujo manual (Paso 1) y la llegada cruzada desde Carta de
    // Portes SIE (vista operario): usa obtenerOCrearCarga para "seguir" una carga ya
    // abierta con el mismo destino+fecha+horario en vez de duplicarla.
    gas('obtenerOCrearCarga', destino, fecha, horario).then(function (r) {
      cargaActualId = r.idCarga;
      document.getElementById('camionPaso1').classList.add('vista-oculta');
      document.getElementById('camionPaso2').classList.remove('vista-oculta');
      actualizarStepper_(2);
      document.getElementById('camionTitulo').textContent =
        r.idCarga + ' — ' + destino + ' ' + fecha + ' ' + horario + (r.reutilizada ? ' (continuando)' : '');
      actualizarEnlaceCartaPortes_(destino, fecha, horario);
      var input = document.getElementById('camionEscaneo');
      input.value = '';
      input.focus();
      modoManualActivo_ = false;
      document.getElementById('btnModoManual').classList.remove('activo');
      document.getElementById('btnAnadirManual').classList.add('vista-oculta');
      gas('modoPruebaActivo').then(function (activo) {
        document.getElementById('camionBadgePrueba').classList.toggle('vista-oculta', !activo);
      });
      // Si se reutiliza una carga ya empezada, mostrar lo que ya se había escaneado.
      gas('obtenerCarga', cargaActualId).then(function (c) { renderizarListaCamion_(c.escaneados); });
    }).catch(function (err) { alert('Error al abrir la carga: ' + err.message); });
  }
```

- [ ] **Step 5: Push a Apps Script**

Run: `clasp push -f`

---

## Task 7: `Index.html` — simplificar la lista de soportes a ID + Origen

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html` (función `renderizarListaCamion_`)

- [ ] **Step 1: Reducir columnas**

Reemplazar:

```js
  function renderizarListaCamion_(escaneados) {
    var cont = document.getElementById('camionLista');
    if (!escaneados || escaneados.length === 0) {
      cont.innerHTML = '<p class="sin-resultados">Ningún soporte escaneado todavía.</p>';
      return;
    }
    var filas = escaneados.map(function (e, i) {
      return '<tr><td data-label="#">' + (i + 1) + '</td><td data-label="Nº Pedido">' + e.numeroPedido +
        '</td><td data-label="Origen">' + e.origenTexto + '</td><td data-label="ID único">' + e.idUnico + '</td></tr>';
    }).join('');
    cont.innerHTML = '<table class="resultados-tabla"><thead><tr><th>#</th><th>Nº Pedido</th><th>Origen</th><th>ID único</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }
```

Por:

```js
  function renderizarListaCamion_(escaneados) {
    var cont = document.getElementById('camionLista');
    if (!escaneados || escaneados.length === 0) {
      cont.innerHTML = '<p class="sin-resultados">Ningún soporte escaneado todavía.</p>';
      return;
    }
    var filas = escaneados.map(function (e) {
      return '<tr><td data-label="ID">' + e.idUnico + '</td><td data-label="Origen">' + e.origenTexto + '</td></tr>';
    }).join('');
    cont.innerHTML = '<table class="resultados-tabla"><thead><tr><th>ID</th><th>Origen</th></tr></thead><tbody>' + filas + '</tbody></table>';
  }
```

(El backend `obtenerCarga` sigue devolviendo `numeroPedido` sin cambios — solo se deja de
pintar en esta tabla.)

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

---

## Task 8: `Index.html` — carga masiva oculta (gesto de 2s + panel)

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html` (markup: nuevo modal)
- Modify: `Desktop/Proyectos/hodos/Index.html` (JS: gesto + panel)

- [ ] **Step 1: Markup — modal de carga masiva**

Insertar entre el cierre de `#modalAviso` y la apertura de `<script>`:

```html
<!-- Mensaje centrado (reemplaza al alert() nativo) para avisos que necesitan
     listar varias líneas con claridad, p.ej. qué soportes faltan por cargar. -->
<div id="modalAviso" class="modal-overlay vista-oculta" onclick="if (event.target === this) cerrarModalAviso_();">
  <div class="modal-caja">
    <h3 id="modalAvisoTitulo">Aviso</h3>
    <p id="modalAvisoTexto"></p>
    <button type="button" class="btn-primary" onclick="cerrarModalAviso_()">Entendido</button>
  </div>
</div>

<!-- Panel de carga masiva (Cargar camión) — se abre solo con un gesto que no está
     documentado en ningún sitio de la propia pantalla (mantener pulsado el título de la
     carga 2s), a propósito, para que no sea un botón visible de uso habitual. -->
<div id="modalCargaMasiva" class="modal-overlay vista-oculta" onclick="if (event.target === this) cerrarModalCargaMasiva_();">
  <div class="modal-caja" style="max-width:600px;">
    <h3 style="color:var(--color-accent-text);">Añadir varios soportes pendientes</h3>
    <p style="font-size:13px;opacity:0.85;margin-bottom:14px;">Estos soportes se marcarán como cargados sin necesidad de escanearlos.</p>
    <div style="margin-bottom:10px;">
      <label style="display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:13px;">
        <input type="checkbox" id="chkSeleccionarTodosMasiva" onchange="toggleSeleccionarTodosMasiva_(this)"> Seleccionar todos
      </label>
    </div>
    <div id="listaCargaMasiva" style="max-height:320px;overflow-y:auto;margin-bottom:16px;"></div>
    <div style="display:flex;gap:10px;">
      <button type="button" class="btn-secundario" onclick="cerrarModalCargaMasiva_()" style="flex:1;">Cancelar</button>
      <button type="button" class="btn-primary" style="flex:1;margin-top:0;" onclick="aplicarCargaMasiva_()">Añadir seleccionados</button>
    </div>
  </div>
</div>

<script>
```

- [ ] **Step 2: JS — gesto oculto y lógica del panel**

Insertar justo antes de `function mostrarAvisoCamion_(mensaje, esError) {`:

```js
  var GESTO_MASIVA_MS_ = 2000; // pulsación mantenida sobre el título de la carga
  var gestoMasivaTimer_ = null;

  function iniciarGestoMasiva_() {
    gestoMasivaTimer_ = setTimeout(function () {
      gestoMasivaTimer_ = null;
      abrirModalCargaMasiva_();
    }, GESTO_MASIVA_MS_);
  }

  function cancelarGestoMasiva_() {
    if (gestoMasivaTimer_) { clearTimeout(gestoMasivaTimer_); gestoMasivaTimer_ = null; }
  }

  var camionTituloEl_ = document.getElementById('camionTitulo');
  camionTituloEl_.addEventListener('pointerdown', iniciarGestoMasiva_);
  camionTituloEl_.addEventListener('pointerup', cancelarGestoMasiva_);
  camionTituloEl_.addEventListener('pointerleave', cancelarGestoMasiva_);
  camionTituloEl_.addEventListener('pointercancel', cancelarGestoMasiva_);

  var pendientesMasivaCache_ = [];

  function abrirModalCargaMasiva_() {
    if (!cargaActualId) return;
    var destino = camionDestinoSeleccionado;
    gas('obtenerPendientesPorTienda').then(function (porTienda) {
      var entrada = (porTienda || []).filter(function (t) { return t.tienda === destino; })[0];
      pendientesMasivaCache_ = (entrada && entrada.pendientes) || [];
      renderizarListaCargaMasiva_();
      document.getElementById('chkSeleccionarTodosMasiva').checked = false;
      document.getElementById('modalCargaMasiva').classList.remove('vista-oculta');
    }).catch(function (err) {
      mostrarModalAviso_('Error', 'No se pudieron cargar los soportes pendientes: ' + (err && err.message ? err.message : err));
    });
  }

  function renderizarListaCargaMasiva_() {
    var cont = document.getElementById('listaCargaMasiva');
    if (pendientesMasivaCache_.length === 0) {
      cont.innerHTML = '<p class="sin-resultados">No hay soportes pendientes para esta tienda.</p>';
      return;
    }
    cont.innerHTML = pendientesMasivaCache_.map(function (p) {
      return '<label class="item-carga-masiva"><input type="checkbox" class="chk-masiva" value="' + p.idUnico + '">' +
        '<span class="info"><span class="id">' + p.idUnico + '</span><br><span class="origen">' + p.origenTexto + '</span></span></label>';
    }).join('');
  }

  function toggleSeleccionarTodosMasiva_(chk) {
    document.querySelectorAll('#listaCargaMasiva .chk-masiva').forEach(function (c) { c.checked = chk.checked; });
  }

  function cerrarModalCargaMasiva_() {
    document.getElementById('modalCargaMasiva').classList.add('vista-oculta');
  }

  function aplicarCargaMasiva_() {
    var seleccionados = Array.prototype.slice.call(document.querySelectorAll('#listaCargaMasiva .chk-masiva:checked')).map(function (c) { return c.value; });
    if (seleccionados.length === 0) { cerrarModalCargaMasiva_(); return; }
    var idCarga = cargaActualId;
    var añadidos = 0;
    var rechazados = [];

    function siguiente(i) {
      if (i >= seleccionados.length) {
        cerrarModalCargaMasiva_();
        gas('obtenerCarga', idCarga).then(function (c) { renderizarListaCamion_(c.escaneados); });
        var resumen = añadidos + ' soporte(s) añadido(s).';
        if (rechazados.length > 0) resumen += ' No se pudieron añadir: ' + rechazados.join(', ') + '.';
        mostrarModalAviso_('Carga masiva completada', resumen);
        return;
      }
      gas('escanearSoporte', idCarga, seleccionados[i]).then(function (r) {
        if (r.ok) { añadidos++; } else { rechazados.push(seleccionados[i] + ' (' + r.motivo + ')'); }
        siguiente(i + 1);
      }).catch(function () {
        rechazados.push(seleccionados[i]);
        siguiente(i + 1);
      });
    }
    siguiente(0);
  }

```

- [ ] **Step 3: Push a Apps Script**

Run: `clasp push -f`

---

## Task 9: `Index.html` — Paso 3: quitar el enlace al PDF

**Files:**
- Modify: `Desktop/Proyectos/hodos/Index.html` (función `cerrarCargaUI`)

- [ ] **Step 1: Quitar el enlace y avanzar el stepper**

Reemplazar:

```js
  function cerrarCargaUI() {
    if (!cargaActualId) return;
    if (!confirm('¿Cerrar la carga y enviar el informe?')) return;
    gas('cerrarCarga', cargaActualId).then(function (r) {
      document.getElementById('camionPaso2').classList.add('vista-oculta');
      document.getElementById('camionPaso3').classList.remove('vista-oculta');
      var estadoEmail = r.emailEnviado === 'SI' ? 'Email enviado correctamente.' :
        r.emailEnviado.indexOf('MODO_PRUEBA') === 0 ? 'Modo prueba activo: no se ha enviado ningún email (el PDF se generó igual).' :
        (r.destinatariosConfigurados === 0 ? 'Sin destinatarios configurados para esta tienda — solo se generó el PDF.' : 'No se pudo enviar el email (' + r.emailEnviado + ').');
      document.getElementById('camionResumen').innerHTML =
        '<p>' + r.cantidad + ' soportes cargados.</p><p>' + estadoEmail + '</p><p><a href="' + r.pdfUrl + '" target="_blank">Abrir informe PDF</a></p>';
      cargaActualId = null;
    }).catch(function (err) {
      mostrarModalAviso_('No se puede cerrar la carga', err && err.message ? err.message : String(err));
    });
  }
```

Por:

```js
  function cerrarCargaUI() {
    if (!cargaActualId) return;
    if (!confirm('¿Cerrar la carga y enviar el informe?')) return;
    gas('cerrarCarga', cargaActualId).then(function (r) {
      document.getElementById('camionPaso2').classList.add('vista-oculta');
      document.getElementById('camionPaso3').classList.remove('vista-oculta');
      actualizarStepper_(3);
      var estadoEmail = r.emailEnviado === 'SI' ? 'Email enviado correctamente.' :
        r.emailEnviado.indexOf('MODO_PRUEBA') === 0 ? 'Modo prueba activo: no se ha enviado ningún email (el PDF se generó igual).' :
        (r.destinatariosConfigurados === 0 ? 'Sin destinatarios configurados para esta tienda — solo se generó el PDF.' : 'No se pudo enviar el email (' + r.emailEnviado + ').');
      document.getElementById('camionResumen').innerHTML =
        '<p>' + r.cantidad + ' soportes cargados.</p><p>' + estadoEmail + '</p>';
      cargaActualId = null;
    }).catch(function (err) {
      mostrarModalAviso_('No se puede cerrar la carga', err && err.message ? err.message : String(err));
    });
  }
```

- [ ] **Step 2: Push a Apps Script**

Run: `clasp push -f`

---

## Task 10: Desplegar y checklist final (usuario)

**Files:** ninguno — solo verificación.

- [ ] **Step 1: Confirmar que todas las tareas anteriores están pusheadas**

Run: `clasp push -f` (por si acaso; no debería haber cambios pendientes si cada tarea
anterior ya pusheó).

- [ ] **Step 2: Ejecutar `verificarSistema()` desde el editor**

Ya se hizo una vez en la Task 3, pero repetirlo aquí con TODO el código nuevo desplegado
(Index.html incluido) confirma que nada se ha roto en el camino. Revisar de nuevo que
todas las líneas del log son "OK:".

- [ ] **Step 3: Recorrido manual en el navegador (URL `?vista=operario&tienda=<Tienda>`)**

Abrir la URL de despliegue con `?vista=operario&tienda=Marbella` (o la tienda que se
prefiera) y comprobar:
- El indicador de pasos aparece arriba, con "1 Tienda y fecha" activo.
- El chip "Hoy" está preseleccionado y `Abrir carga` funciona sin tocar nada de fecha.
- Los botones de tienda seleccionados se ven con relleno sólido del color correspondiente
  (verde Málaga / azul Marbella / morado Mijas / naranja Granada).
- El chip "📅 Otra fecha" revela el calendario nativo y, al elegir una fecha fuera de los
  7 chips, ninguno de los 7 queda marcado.
- Al abrir la carga, el stepper avanza a "2 Escanear".
- El botón "⌨ Introducir a mano" cambia de aspecto al activarse, deja de autoenviar
  tecleando algo despacio, y el botón "Añadir" (o Intro) sí lo envía.
- La lista de soportes ya cargados muestra solo ID y Origen (sin nº de fila ni nº de
  pedido).
- Mantener pulsado el título de la carga (p.ej. "CARGA-000041 — Marbella...") durante 2
  segundos abre el panel de carga masiva; soltarlo antes no hace nada. El panel no tiene
  ningún indicio visible en el resto de la pantalla de que ese gesto existe.
- Seleccionar 1–2 soportes pendientes y pulsar "Añadir seleccionados" los incorpora a la
  lista de la carga sin haberlos escaneado.
- Al cerrar la carga (Paso 3), ya no aparece el enlace "Abrir informe PDF" — solo el
  resumen de cantidad y estado del email.

- [ ] **Step 4: Desactivar el modo prueba (el usuario, cuando esté listo)**

Desde el editor de Apps Script (`clasp open`), ejecutar `desactivarModoPrueba()`. A
partir de ese momento, cerrar cualquier carga real enviará un correo real a los 10
destinatarios configurados en `ConfigEntregas.gs` (Task 1). Si el envío falla con un
error de permisos, ejecutar `autorizarYProbarCorreo()` una vez desde el editor y aceptar
el consentimiento de Google; si aun así no aparece la pantalla de permisos completa,
puede hacer falta quitar el bloque `oauthScopes` de `appsscript.json` y revocar el acceso
previo del proyecto en `myaccount.google.com/permissions` (mismo proceso que ya se usó en
`lm_producción`).
