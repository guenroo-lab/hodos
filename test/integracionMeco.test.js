const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// IntegracionIncpc.gs necesita Utilidades.gs de verdad (validarTienda) y
// PropertiesService/ContentService/UMBRAL_DUPLICADO_INCPC_MS_/registrarLote/
// leerEtiquetas_/supaActualizar_/crearEtiquetaDesdeIncpc_ como stubs (los
// últimos se sustituyen por defecto, salvo que el test los pase).
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    supaActualizar_: () => []
  }, mocks);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionIncpc.gs'), 'utf8'), ctx);
  return ctx;
}

test('registrarLoteMeco: llama a registrarLote con origen MECO y sin subtipo, y marca el lote pendiente de imprimir', () => {
  const llamadas = [];
  const llamadasSupaActualizar = [];
  const sb = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1', 'HODOS-2'], loteId: 'LOTE-XYZ' }; },
    leerEtiquetas_: () => [],
    supaActualizar_: (tabla, filtro, cambios) => { llamadasSupaActualizar.push({ tabla, filtro, cambios }); return []; }
  });
  const resultado = sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111\n222', operario: 'pedro@x.com' });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].origen, 'MECO');
  assert.strictEqual(llamadas[0].subtipo, undefined);
  assert.strictEqual(llamadas[0].destino, 'Marbella');
  assert.strictEqual(llamadas[0].pedidosTexto, '111\n222');
  assert.match(llamadas[0].creadoPor, /^MacroArrastres \(Meco\) · pedro@x\.com$/);
  // Desde la generalización a crearLoteArrastreDesdeMacroArrastres_ (2026-09-07), la
  // respuesta siempre lleva `omitidos` (aquí vacío: sin expedición no hay antiduplicado).
  assert.strictEqual(JSON.stringify(resultado), JSON.stringify({ ok: true, idsCreados: ['HODOS-1', 'HODOS-2'], omitidos: [] }));

  assert.strictEqual(llamadasSupaActualizar.length, 1, 'marca el lote entero pendiente de imprimir en una sola llamada');
  assert.strictEqual(llamadasSupaActualizar[0].tabla, 'etiquetas');
  assert.strictEqual(llamadasSupaActualizar[0].filtro, 'lote_id=eq.LOTE-XYZ');
  assert.strictEqual(llamadasSupaActualizar[0].cambios.pendiente_impresion_incpc, true);
});

test('registrarLoteMeco: tienda no reconocida da error sin llamar a registrarLote', () => {
  const llamadas = [];
  const sb = cargarConMocks({ registrarLote: (d) => { llamadas.push(d); }, leerEtiquetas_: () => [] });
  assert.throws(() => sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Sevilla', pedidosTexto: '111' }), /Tienda destino no reconocida/);
  assert.strictEqual(llamadas.length, 0);
});

test('registrarLoteMeco: pedidosTexto vacío da error sin llamar a registrarLote', () => {
  const llamadas = [];
  const sb = cargarConMocks({ registrarLote: (d) => { llamadas.push(d); }, leerEtiquetas_: () => [] });
  assert.throws(() => sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '   ' }), /Falta la lista de pedidos/);
  assert.strictEqual(llamadas.length, 0);
});

test('registrarLoteMeco: si ya hay un lote MECO reciente para esa tienda, no duplica', () => {
  const llamadas = [];
  const sb = cargarConMocks({
    registrarLote: (d) => { llamadas.push(d); return { ids: ['NUEVO'], loteId: 'X' }; },
    leerEtiquetas_: () => [{ idUnico: 'HODOS-VIEJO' }]
  });
  const resultado = sb.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111' });
  assert.strictEqual(llamadas.length, 0, 'no debe llamar a registrarLote si hay uno reciente');
  assert.strictEqual(resultado.duplicado, true);
});

test('doPost: accion registrarLoteMeco usa origen MECO, sin accion sigue el camino de siempre (INCPC, origen Taisa)', () => {
  // OJO: no se puede mockear crearEtiquetaDesdeIncpc_ — al cargar el archivo
  // real con vm, su `function crearEtiquetaDesdeIncpc_(...)` SOBRESCRIBE
  // cualquier mock puesto en el contexto con ese mismo nombre (comprobado:
  // las funciones de nivel superior de un script cargado con vm.runInContext
  // siempre ganan). Por eso aquí se deja correr la función real (necesita
  // actualizarEtiquetaCondicional_, que sí se mockea) y se distingue el
  // camino por el `origen` con el que termina llamando a registrarLote.
  const llamadasRegistrarLote = [];
  const sb = cargarConMocks({
    registrarLote: (d) => { llamadasRegistrarLote.push(d); return { ids: ['HODOS-X'], loteId: 'L1' }; },
    leerEtiquetas_: () => [],
    actualizarEtiquetaCondicional_: () => {}
  });

  const eMeco = { postData: { contents: JSON.stringify({ token: 'token-real', accion: 'registrarLoteMeco', destino: 'Mijas', pedidosTexto: '999' }) } };
  const rMeco = JSON.parse(sb.doPost(eMeco).getContent());
  assert.strictEqual(rMeco.ok, true);
  assert.strictEqual(llamadasRegistrarLote.length, 1);
  assert.strictEqual(llamadasRegistrarLote[0].origen, 'MECO', 'con accion=registrarLoteMeco, origen MECO');

  const eIncpc = { postData: { contents: JSON.stringify({ token: 'token-real', destino: 'Mijas', pedido: '123', tipo: 'Devolución' }) } };
  const rIncpc = JSON.parse(sb.doPost(eIncpc).getContent());
  assert.strictEqual(rIncpc.ok, true, 'doPost sin accion responde ok (camino INCPC de siempre, sin romperse)');
  assert.strictEqual(llamadasRegistrarLote.length, 2);
  assert.strictEqual(llamadasRegistrarLote[1].origen, 'Taisa', 'sin accion, sigue siendo origen Taisa (INCPC/Preparación), no MECO');
});

// ═══════════ Pestaña "Meco" (Fase 2) ═══════════

test('obtenerEtiquetasPendientesMeco: filtra por origen MECO, sin importar subtipo', () => {
  const sb = cargarConMocks({
    buscarEtiquetas: () => ([
      { idUnico: 'A', origen: 'MECO', subtipo: '' },
      { idUnico: 'B', origen: 'Taisa', subtipo: 'Devolución' },
      { idUnico: 'C', origen: 'Taisa', subtipo: 'Petición Reserva' },
      { idUnico: 'D', origen: 'MECO', subtipo: '' }
    ])
  });
  const resultado = sb.obtenerEtiquetasPendientesMeco();
  assert.deepStrictEqual(resultado.map(f => f.idUnico), ['A', 'D']);
});

test('obtenerEtiquetasPendientesIncpc: ya NO incluye etiquetas MECO (regresión del cambio de hoy)', () => {
  const sb = cargarConMocks({
    buscarEtiquetas: () => ([
      { idUnico: 'A', origen: 'MECO', subtipo: '' },
      { idUnico: 'B', origen: 'Taisa', subtipo: 'Devolución' },
      { idUnico: 'C', origen: 'Taisa', subtipo: 'Petición Reserva' }
    ])
  });
  const resultado = sb.obtenerEtiquetasPendientesIncpc();
  assert.deepStrictEqual(resultado.map(f => f.idUnico), ['B'], 'ni MECO (A) ni Preparación (C)');
});

test('htmlPendientesMeco: filtro correcto y error claro si no hay ninguna', () => {
  let filtroUsado = null;
  const sb = cargarConMocks({
    leerEtiquetas_: (f) => { filtroUsado = f; return []; }
  });
  // "MECO" en mayúsculas: es la grafía canónica real (ORIGENES_ARRASTRE_ en
  // IntegracionIncpc.gs), no "Meco" — htmlPendientesArrastre la usa tal cual en el mensaje.
  assert.throws(() => sb.htmlPendientesMeco(), /No hay etiquetas de MECO pendientes/);
  assert.strictEqual(filtroUsado, 'pendiente_impresion_incpc=eq.true&origen=eq.MECO&order=fecha_creacion.asc');
});

test('marcarImpresasMeco: solo desmarca las de origen MECO', () => {
  let filtroUsado = null;
  const sb = cargarConMocks({
    supaActualizar_: (tabla, filtro) => { filtroUsado = filtro; return [{ idUnico: 'A' }, { idUnico: 'D' }]; }
  });
  const resultado = sb.marcarImpresasMeco();
  assert.strictEqual(filtroUsado, 'pendiente_impresion_incpc=eq.true&origen=eq.MECO');
  assert.strictEqual(resultado.cantidad, 2);
});
