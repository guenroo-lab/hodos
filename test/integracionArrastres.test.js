const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Un array/objeto creado DENTRO del .gs cargado por vm.runInContext pertenece al realm
// de ese contexto, no al de este archivo — deepStrictEqual los trata como distintos
// aunque el contenido sea idéntico ("same structure but not reference-equal"). .slice()
// no lo arregla (usa el Array del propio realm). El viaje por JSON sí, porque
// reconstruye los valores con los constructores de ESTE realm.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

// Mismo patrón que test/integracionMeco.test.js: Utilidades.gs de verdad
// (validarTienda, parsearLotePedidos) y el resto como stubs.
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '07/09/2026' },
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    supaActualizar_: () => [],
    htmlUnaEtiqueta_: (e) => '<div>' + e.idUnico + '</div>',
    envolverEtiquetasHtml_: (t) => '<html>' + t + '</html>'
  }, mocks);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionIncpc.gs'), 'utf8'), ctx);
  return ctx;
}

test('obtenerEtiquetasPendientesArrastre filtra por el origen pedido', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO' },
      { idUnico: 'B', origen: 'Valencia' },
      { idUnico: 'C', origen: 'Torija' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesArrastre('Valencia');
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].idUnico, 'B');
});

test('obtenerEtiquetasPendientesArrastre acepta el origen en minúsculas y devuelve la grafía canónica', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [{ idUnico: 'B', origen: 'Valencia' }]
  });
  assert.strictEqual(ctx.obtenerEtiquetasPendientesArrastre('valencia').length, 1);
  assert.strictEqual(ctx.obtenerEtiquetasPendientesArrastre('VALENCIA').length, 1);
});

test('un origen desconocido es un error, no una consulta abierta', () => {
  const ctx = cargarConMocks({ buscarEtiquetas: () => [] });
  assert.throws(
    () => ctx.obtenerEtiquetasPendientesArrastre('SEVILLA'),
    /Origen de arrastre no reconocido/
  );
});

test('obtenerEtiquetasPendientesMeco sigue existiendo y devuelve solo MECO', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO' },
      { idUnico: 'B', origen: 'Valencia' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesMeco();
  assert.strictEqual(filas.length, 1);
  assert.strictEqual(filas[0].idUnico, 'A');
});

test('la pestaña de Incidencias excluye TODAS las plataformas de arrastre, no solo Meco (bug real: Valencia/Torija/Antequera ya tienen 738/341/565 etiquetas en producción, en formato título)', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'MECO', subtipo: '' },
      { idUnico: 'B', origen: 'Valencia', subtipo: '' },
      { idUnico: 'C', origen: 'Torija', subtipo: '' },
      { idUnico: 'D', origen: 'Antequera', subtipo: '' },
      { idUnico: 'E', origen: 'Taisa', subtipo: 'Rotura' },
      { idUnico: 'F', origen: 'Taisa', subtipo: 'Petición Reserva' }
    ]
  });
  const filas = ctx.obtenerEtiquetasPendientesIncpc();
  assert.deepStrictEqual(filas.map(function (f) { return f.idUnico; }), ['E']);
});

test('marcarImpresasArrastre filtra por origen en el propio PostgREST, con la grafía canónica', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaActualizar_: (tabla, filtro, cambios) => { llamadas.push({ tabla, filtro, cambios }); return [{}, {}]; }
  });
  const r = ctx.marcarImpresasArrastre('Torija');
  assert.strictEqual(r.cantidad, 2);
  assert.strictEqual(llamadas[0].tabla, 'etiquetas');
  assert.match(llamadas[0].filtro, /origen=eq\.Torija/);
  assert.deepStrictEqual(aRealmLocal(llamadas[0].cambios), { pendiente_impresion_incpc: false });
});

test('marcarImpresasIncpc excluye las cuatro plataformas de arrastre, con sus grafías reales', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaActualizar_: (tabla, filtro, cambios) => { llamadas.push(filtro); return []; }
  });
  ctx.marcarImpresasIncpc();
  assert.match(llamadas[0], /origen=not\.in\.\(MECO,Valencia,Torija,Antequera\)/);
});

test('htmlPendientesArrastre avisa con el nombre de la plataforma si no hay nada', () => {
  const ctx = cargarConMocks({ leerEtiquetas_: () => [] });
  assert.throws(
    () => ctx.htmlPendientesArrastre('Antequera'),
    /No hay etiquetas de Antequera pendientes/
  );
});

test('crearLoteArrastre: pasa origen y expedicion a registrarLote y marca el lote pendiente', () => {
  const llamadas = [];
  const supa = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1', 'HODOS-2'], loteId: 'LOTE-1' }; },
    leerEtiquetas_: () => [],
    supaActualizar_: (tabla, filtro, cambios) => { supa.push({ tabla, filtro, cambios }); return []; }
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Marbella', pedidosTexto: '111\n222',
    expedicion: '02828945', operario: 'pedro@x.com'
  });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].origen, 'Valencia');
  assert.strictEqual(llamadas[0].expedicion, '02828945');
  assert.strictEqual(llamadas[0].subtipo, undefined);
  assert.strictEqual(llamadas[0].creadoPor, 'MacroArrastres (Valencia) · pedro@x.com');
  assert.deepStrictEqual(r.idsCreados.slice(), ['HODOS-1', 'HODOS-2']);
  assert.match(supa[0].filtro, /lote_id=eq\.LOTE-1/);
  assert.deepStrictEqual(aRealmLocal(supa[0].cambios), { pendiente_impresion_incpc: true });
});

test('crearLoteArrastre: omite los pedidos que ya existen en esa misma expedicion', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-2' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Torija', destino: 'Mijas', pedidosTexto: '111\n222', expedicion: 'EXP-1'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '222');
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: el MISMO pedido en OTRA expedicion sí crea etiqueta', () => {
  const filtros = [];
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-3' }; },
    // Simula la tabla: solo devuelve el 111 cuando se pregunta por EXP-1.
    leerEtiquetas_: (filtro) => {
      filtros.push(filtro);
      return filtro.indexOf('expedicion=eq.EXP-1') !== -1 ? [{ numeroPedido: '111' }] : [];
    }
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Torija', destino: 'Mijas', pedidosTexto: '111', expedicion: 'EXP-2'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '111');
  assert.strictEqual(r.omitidos.length, 0);
});

test('crearLoteArrastre: sin expedicion NO deduplica, inserta', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-9'], loteId: 'LOTE-4' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Málaga', pedidosTexto: '111'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '111');
  assert.strictEqual(r.omitidos.length, 0);
});

test('crearLoteArrastre (MECO): un pedido repetido en el documento de origen es un error de documento, se colapsa a 1', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1'], loteId: 'LOTE-M1' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'MECO', destino: 'Marbella', pedidosTexto: '111\n222\n111\n333\n222'
  });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].pedidosTexto, '111\n222\n333', 'colapsa duplicados, conserva orden de primera aparición');
});

test('crearLoteArrastre (Valencia): un pedido repetido SÍ son varios soportes reales — solo MECO se colapsa', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1', 'HODOS-2'], loteId: 'LOTE-V1' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Marbella', pedidosTexto: '111\n111'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '111\n111', 'Valencia no deduplica: dos soportes reales del mismo pedido');
});

test('crearLoteArrastre (MECO): duplicado y antiduplicado por expedición conviven (dedup de documento va primero)', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1'], loteId: 'LOTE-M2' }; },
    // 111 ya existe en Supabase para esta expedición -> se omite; 222 aparece
    // duplicado dentro del propio documento -> se colapsa a 1 antes de mirar Supabase.
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'MECO', destino: 'Marbella', pedidosTexto: '111\n222\n222', expedicion: 'EXP-M'
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '222');
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: si todo estaba ya creado, no llama a registrarLote', () => {
  let llamado = false;
  const ctx = cargarConMocks({
    registrarLote: () => { llamado = true; return { ids: [], loteId: 'X' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Valencia', destino: 'Málaga', pedidosTexto: '111', expedicion: 'EXP-1'
  });
  assert.strictEqual(llamado, false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idsCreados.length, 0);
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: tienda no reconocida es un error', () => {
  const ctx = cargarConMocks({ registrarLote: () => ({ ids: [], loteId: 'X' }), leerEtiquetas_: () => [] });
  assert.throws(
    () => ctx.crearLoteArrastreDesdeMacroArrastres_({ origen: 'Valencia', destino: 'Sevilla', pedidosTexto: '111' }),
    /Tienda destino no reconocida/
  );
});

test('el alias registrarLoteMeco sigue creando con origen MECO', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    registrarLote: (datos) => { llamadas.push(datos); return { ids: ['HODOS-1'], loteId: 'LOTE-5' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteMecoDesdeMacroArrastres_({ destino: 'Marbella', pedidosTexto: '111', expedicion: 'EXP-9' });
  assert.strictEqual(llamadas[0].origen, 'MECO');
  assert.strictEqual(llamadas[0].creadoPor, 'MacroArrastres (Meco) · desconocido');
});

test('doPost enruta registrarLoteArrastre', () => {
  const ctx = cargarConMocks({
    registrarLote: () => ({ ids: ['HODOS-1'], loteId: 'LOTE-6' }),
    leerEtiquetas_: () => []
  });
  const salida = ctx.doPost({ postData: { contents: JSON.stringify({
    token: 'token-real', accion: 'registrarLoteArrastre',
    origen: 'Antequera', destino: 'Mijas', pedidosTexto: '111', expedicion: 'EXP-3'
  }) } });
  assert.deepStrictEqual(JSON.parse(salida.getContent()).idsCreados, ['HODOS-1']);
});
