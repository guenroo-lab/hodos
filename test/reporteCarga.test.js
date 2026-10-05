const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// ReporteCarga.gs llama a funciones de Utilidades.gs (validarTienda,
// horasLaborablesTranscurridas, formatearHorasTexto), a esc_/LOGO_TAISA_B64/
// UMBRAL_ALERTA_HORAS_ (Backend.gs) y a leerEtiquetas_ (EstructuraSheets.gs, aquí
// stubeada) — mismo patrón que test/backendAdmin.test.js: cargar Utilidades.gs +
// Backend.gs de verdad (comparten espacio global, igual que en Apps Script real) y
// añadir ReporteCarga.gs encima.
function contexto(stubs) {
  const ctx = Object.assign({
    Utilities: { formatDate: function (d) { return d.toISOString().slice(0, 16).replace('T', ' '); } },
    // SolicitantesKairos.gs (cruce LDAP/motivo, Kairos) degrada solo a "—" con su
    // propio try/catch cuando supaGet_ falla — pero ese catch llama a Logger.log,
    // así que sin este stub el catch en sí revienta con ReferenceError.
    Logger: { log: function () {} }
  }, stubs);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Backend.gs'), 'utf8'), ctx);
  // supaGet_ no está stubeado (no es lo que testean estos casos): sin él,
  // _solicitantesPorIdUnico_/_solicitantesPorSscc_ fallan al llamarlo y su propio
  // catch los degrada a {} — mismo comportamiento que producción cuando Supabase no
  // responde, no hace falta simularlo aparte.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'SolicitantesKairos.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ReporteCarga.gs'), 'utf8'), ctx);
  return ctx;
}

function filaBase(cambios) {
  return Object.assign({
    idUnico: 'HODOS-000001', numeroPedido: '286676', soporteNum: 1, soporteTotal: 1,
    origenTexto: 'MECO', destino: 'Málaga', estado: 'REGISTRADO',
    fechaCreacion: new Date().toISOString()
  }, cambios || {});
}

test('htmlPendientesTienda: lanza si la tienda no es válida', () => {
  const ctx = contexto({ leerEtiquetas_: () => [] });
  assert.throws(() => ctx.htmlPendientesTienda('Sevilla'), /Tienda no válida/);
});

test('htmlPendientesTienda: sin pendientes muestra el aviso de vacío', () => {
  const ctx = contexto({ leerEtiquetas_: () => [] });
  const html = ctx.htmlPendientesTienda('Málaga');
  assert.match(html, /Sin soportes pendientes de cargar/);
  assert.match(html, /Total pendientes: 0/);
});

test('htmlPendientesTienda: lista los soportes de esa tienda con nº de pedido e idUnico', () => {
  const ahora = Date.now();
  const ctx = contexto({
    leerEtiquetas_: () => [
      filaBase({ idUnico: 'HODOS-000010', numeroPedido: '111111', fechaCreacion: new Date(ahora - 10 * 24 * 3600 * 1000).toISOString() }),
      filaBase({ idUnico: 'HODOS-000011', numeroPedido: '222222', fechaCreacion: new Date(ahora - 1 * 3600 * 1000).toISOString() })
    ]
  });
  const html = ctx.htmlPendientesTienda('Málaga');
  assert.match(html, /111111/);
  assert.match(html, /HODOS-000010/);
  assert.match(html, /222222/);
  assert.match(html, /HODOS-000011/);
  assert.match(html, /Málaga/); // el uppercase de la banda de color es solo CSS (text-transform), no del HTML
  assert.match(html, /Total pendientes: 2/);
});

test('htmlPendientesTienda: marca con aviso (⚠) el que supera el umbral y no el reciente', () => {
  const ahora = Date.now();
  const ctx = contexto({
    leerEtiquetas_: () => [
      filaBase({ idUnico: 'HODOS-000010', fechaCreacion: new Date(ahora - 10 * 24 * 3600 * 1000).toISOString() }), // antiguo, alerta segura
      filaBase({ idUnico: 'HODOS-000011', fechaCreacion: new Date(ahora - 1 * 3600 * 1000).toISOString() }) // reciente, sin alerta
    ]
  });
  const html = ctx.htmlPendientesTienda('Málaga');
  assert.strictEqual((html.match(/&#9888;/g) || []).length, 1);
  assert.match(html, /1 con aviso/);
});

test('htmlPendientesTienda: solo pide a leerEtiquetas_ el destino y estado correctos', () => {
  let filtroRecibido = null;
  const ctx = contexto({
    leerEtiquetas_: (filtro) => { filtroRecibido = filtro; return []; }
  });
  ctx.htmlPendientesTienda('Marbella');
  assert.match(filtroRecibido, /estado=eq\.REGISTRADO/);
  assert.match(filtroRecibido, /destino=eq\.Marbella/);
  assert.match(filtroRecibido, /order=fecha_creacion\.asc/);
});

// ── htmlInformeCarga: sin ningún test hasta ahora, pese a estar en producción con
// envíos de email reales desde v50 (hueco de cobertura detectado en revisión,
// 2026-09-23). obtenerCarga/leerPaletesPorCarga_ se stubean directamente: la primera
// es real (Backend.gs) y necesita leerCargas_+leerEtiquetas_+leerTodoContenidoCrudo_;
// la segunda es de EstructuraPaletes.gs, no cargado en este contexto. ──

function contextoInforme(cargaFila, escaneados, palets, stubsExtra) {
  return contexto(Object.assign({
    leerCargas_: () => [Object.assign({ idCarga: 'CARGA-1', estado: 'CERRADA' }, cargaFila)],
    leerEtiquetas_: () => escaneados || [],
    leerTodoContenidoCrudo_: () => [],
    leerPaletesPorCarga_: () => palets || []
  }, stubsExtra));
}

test('htmlInformeCarga: colorBanda usa el color de la tienda cuando está en COLOR_BANDA_TIENDA_', () => {
  const ctx = contextoInforme({ destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }, [], []);
  const html = ctx.htmlInformeCarga('CARGA-1');
  assert.match(html, /background:#147638/); // color real de Málaga en COLOR_BANDA_TIENDA_
});

test('htmlInformeCarga: colorBanda cae al rojo por defecto (#e30613) si el destino no está en COLOR_BANDA_TIENDA_', () => {
  // Hoy las 4 tiendas reales están todas en el mapa (rama defensiva, no alcanzable vía
  // la UI normal desde que registrarLote/crearCarga validan destino) — se prueba
  // igual porque es la rama de seguridad ante datos históricos o una tienda futura.
  const ctx = contextoInforme({ destino: 'TiendaFutura', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }, [], []);
  const html = ctx.htmlInformeCarga('CARGA-1');
  assert.match(html, /background:#e30613/);
});

test('htmlInformeCarga: avisoVacio SÍ aparece si no hay ni pedidos ni palets', () => {
  const ctx = contextoInforme({ destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }, [], []);
  const html = ctx.htmlInformeCarga('CARGA-1');
  assert.match(html, /Carga cerrada sin ningún soporte escaneado/);
});

test('htmlInformeCarga: avisoVacio NO aparece si hay 0 pedidos pero SÍ palets SIE (carga 100% refill, caso real tras la fusión)', () => {
  const ctx = contextoInforme(
    { destino: 'Marbella', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '16:00' },
    [],
    [{ sscc: '030176010452797723', encontrado: true, seccion: 'Sección 1' }]
  );
  const html = ctx.htmlInformeCarga('CARGA-1');
  assert.doesNotMatch(html, /Carga cerrada sin ningún soporte escaneado/);
});

test('htmlInformeCarga: chipResumen usa singular con 1 pedido y plural con 2+', () => {
  const filaEscaneado = { idUnico: 'HODOS-A', numeroPedido: '111111', origenTexto: 'MECO', fechaEnvio: new Date().toISOString(), bateaId: 'CARGA-1' };
  const ctxUno = contextoInforme({ destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }, [filaEscaneado], []);
  assert.match(ctxUno.htmlInformeCarga('CARGA-1'), /1 PEDIDO CLIENTE/);
  assert.doesNotMatch(ctxUno.htmlInformeCarga('CARGA-1'), /1 PEDIDOS CLIENTE/);

  const ctxDos = contextoInforme(
    { destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' },
    [filaEscaneado, Object.assign({}, filaEscaneado, { idUnico: 'HODOS-B', numeroPedido: '222222' })],
    []
  );
  assert.match(ctxDos.htmlInformeCarga('CARGA-1'), /2 PEDIDOS CLIENTE/);
});

test('htmlInformeCarga: chipResumen de palets SIE también singular/plural, y solo aparece con palets', () => {
  const ctxSinPalets = contextoInforme({ destino: 'Marbella', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '16:00' }, [], []);
  assert.doesNotMatch(ctxSinPalets.htmlInformeCarga('CARGA-1'), /PALET/);

  const ctxUnPalet = contextoInforme({ destino: 'Marbella', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '16:00' }, [], [{ sscc: '1', encontrado: true, seccion: '1' }]);
  assert.match(ctxUnPalet.htmlInformeCarga('CARGA-1'), /1 PALET SIE/);
  assert.doesNotMatch(ctxUnPalet.htmlInformeCarga('CARGA-1'), /1 PALETS SIE/);

  const ctxDosPalets = contextoInforme({ destino: 'Marbella', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '16:00' }, [], [
    { sscc: '1', encontrado: true, seccion: '1' }, { sscc: '2', encontrado: true, seccion: '2' }
  ]);
  assert.match(ctxDosPalets.htmlInformeCarga('CARGA-1'), /2 PALETS SIE/);
});

test('htmlInformeCarga: bloqueSie muestra okCount/nokCount y avisa de los "no encontrado en inventario"', () => {
  const ctx = contextoInforme(
    { destino: 'Mijas', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '8:00' },
    [],
    [
      { sscc: 'SSCC-1', encontrado: true, seccion: 'Sección 2', codigoLm: 'LM1' },
      { sscc: 'SSCC-2', encontrado: false, seccion: 'NO ENCONTRADO EN INVENTARIO', codigoLm: '' }
    ]
  );
  const html = ctx.htmlInformeCarga('CARGA-1');
  assert.match(html, /Refill SIE — palets escaneados en este mismo camión: <strong>2<\/strong>/);
  assert.match(html, /1 no encontrado en inventario/);
  assert.match(html, /No encontrado en inventario/); // nota por fila
  assert.match(html, /SSCC-1/);
  assert.match(html, /SSCC-2/);
});
