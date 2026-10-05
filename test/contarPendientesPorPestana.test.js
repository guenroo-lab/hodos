const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Mismo patrón que test/integracionArrastres.test.js: Utilidades.gs e IntegracionIncpc.gs
// de verdad, el resto como stubs.
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '05/10/2026' },
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

// Un objeto creado dentro del .gs cargado por vm pertenece a otro realm: deepStrictEqual
// lo trata como distinto aunque el contenido sea idéntico. El viaje por JSON lo arregla.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

const FILAS = [
  { origen: 'Taisa', subtipo: 'Devolución' },
  { origen: 'Taisa', subtipo: 'Devolución' },
  { origen: 'Taisa', subtipo: 'Pedido cliente' },
  { origen: 'Taisa', subtipo: 'Petición Reserva' },
  { origen: 'Taisa', subtipo: 'Petición Reserva' },
  { origen: 'Taisa', subtipo: 'Petición Reserva' },
  { origen: 'MECO', subtipo: null },
  { origen: 'Valencia', subtipo: null },
  { origen: 'Valencia', subtipo: null },
  { origen: 'Torija', subtipo: null },
  { origen: 'Antequera', subtipo: null },
  { origen: 'Antequera', subtipo: null },
  { origen: 'Antequera', subtipo: null },
  { origen: 'Antequera', subtipo: null }
];

test('contarPendientesPorPestana_ reparte cada fila en su pestaña', () => {
  const ctx = cargarConMocks({});
  assert.deepStrictEqual(aRealmLocal(ctx.contarPendientesPorPestana_(FILAS)), {
    incpc: 3, preparacion: 3, meco: 1, valencia: 2, torija: 1, antequera: 4
  });
});

test('sin etiquetas pendientes las seis pestañas valen 0', () => {
  const ctx = cargarConMocks({});
  assert.deepStrictEqual(aRealmLocal(ctx.contarPendientesPorPestana_([])), {
    incpc: 0, preparacion: 0, meco: 0, valencia: 0, torija: 0, antequera: 0
  });
});

test('un arrastre sin subtipo NO cuenta como Incidencia, y un subtipo nulo no-arrastre SÍ (como en su lista)', () => {
  const ctx = cargarConMocks({});
  const cuentas = aRealmLocal(ctx.contarPendientesPorPestana_([
    { origen: 'Torija', subtipo: null },
    { origen: 'Cesión', subtipo: null }
  ]));
  assert.strictEqual(cuentas.incpc, 1);
  assert.strictEqual(cuentas.torija, 1);
});

test('cada cifra coincide con la longitud de la lista que muestra su pestaña', () => {
  // La garantía real: la insignia nunca puede discrepar de lo que se ve al abrir la pestaña.
  // Se alimenta buscarEtiquetas con las mismas filas y se compara contra las funciones
  // que usan las listas de verdad.
  const conId = FILAS.map((f, i) => Object.assign({ idUnico: 'ID' + i }, f));
  const ctx = cargarConMocks({ buscarEtiquetas: () => conId });
  const cuentas = aRealmLocal(ctx.contarPendientesPorPestana_(FILAS));
  assert.strictEqual(cuentas.incpc, ctx.obtenerEtiquetasPendientesIncpc().length);
  assert.strictEqual(cuentas.preparacion, ctx.obtenerEtiquetasPendientesPreparacion().length);
  assert.strictEqual(cuentas.meco, ctx.obtenerEtiquetasPendientesArrastre('MECO').length);
  assert.strictEqual(cuentas.valencia, ctx.obtenerEtiquetasPendientesArrastre('Valencia').length);
  assert.strictEqual(cuentas.torija, ctx.obtenerEtiquetasPendientesArrastre('Torija').length);
  assert.strictEqual(cuentas.antequera, ctx.obtenerEtiquetasPendientesArrastre('Antequera').length);
});

test('contarEtiquetasPendientesPorPestana hace UNA lectura ligera: solo pendientes, solo origen+subtipo', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaGet_: (tabla, filtro, columnas) => { llamadas.push({ tabla, filtro, columnas }); return FILAS; }
  });
  const cuentas = aRealmLocal(ctx.contarEtiquetasPendientesPorPestana());
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].tabla, 'etiquetas');
  assert.match(llamadas[0].filtro, /pendiente_impresion_incpc=eq\.true/);
  assert.strictEqual(llamadas[0].columnas, 'origen,subtipo');
  assert.strictEqual(cuentas.antequera, 4);
});
