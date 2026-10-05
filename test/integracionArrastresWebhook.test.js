const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Mismo patrón que test/integracionArrastres.test.js: gestión de etiquetas de
// arrastres desde FUERA de HODOS (Panel Arrastres, pestaña "Hodos",
// 2026-09-10) — 4 acciones nuevas en el mismo webhook (doPost) y token que ya
// usa registrarLoteArrastre.
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '10/09/2026' },
    supaActualizar_: () => [],
    htmlUnaEtiqueta_: (e) => '<div>' + e.idUnico + '</div>',
    envolverEtiquetasHtml_: (t) => '<html>' + t + '</html>',
    leerEtiquetas_: () => [],
    buscarEtiquetas: () => [],
    borrarSoportesAdmin: () => ({ borrados: [], rechazados: [] })
  }, mocks);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionIncpc.gs'), 'utf8'), ctx);
  return ctx;
}

function llamarDoPost(ctx, cuerpo) {
  const resp = ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(resp.getContent());
}

test('listarPendientesArrastre: token válido, devuelve las etiquetas del origen', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => [
      { idUnico: 'A', origen: 'Valencia' },
      { idUnico: 'B', origen: 'Torija' }
    ]
  });
  const r = llamarDoPost(ctx, { accion: 'listarPendientesArrastre', token: 'token-real', origen: 'Valencia' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.etiquetas.length, 1);
  assert.strictEqual(r.etiquetas[0].idUnico, 'A');
});

test('listarPendientesArrastre: token inválido no ejecuta nada', () => {
  const ctx = cargarConMocks({
    buscarEtiquetas: () => { throw new Error('no debería llamarse con token malo'); }
  });
  const r = llamarDoPost(ctx, { accion: 'listarPendientesArrastre', token: 'malo', origen: 'Valencia' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /[Tt]oken/);
});

test('htmlPendientesArrastre: devuelve el HTML de impresión ya montado', () => {
  const ctx = cargarConMocks({
    leerEtiquetas_: () => [{ idUnico: 'X', fechaCreacion: new Date().toISOString() }]
  });
  const r = llamarDoPost(ctx, { accion: 'htmlPendientesArrastre', token: 'token-real', origen: 'Meco' });
  assert.strictEqual(r.ok, true);
  assert.match(r.html, /<html>/);
  assert.match(r.html, /X/);
});

test('htmlPendientesArrastre: sin etiquetas pendientes -> error legible, no revienta el webhook', () => {
  const ctx = cargarConMocks({ leerEtiquetas_: () => [] });
  const r = llamarDoPost(ctx, { accion: 'htmlPendientesArrastre', token: 'token-real', origen: 'Meco' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /pendientes de imprimir/);
});

test('marcarImpresasArrastre: devuelve cuántas se marcaron', () => {
  const ctx = cargarConMocks({
    supaActualizar_: () => [{ idUnico: 'A' }, { idUnico: 'B' }]
  });
  const r = llamarDoPost(ctx, { accion: 'marcarImpresasArrastre', token: 'token-real', origen: 'Torija' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resultado.cantidad, 2);
});

test('borrarEtiquetasArrastre: reenvía los idsUnicos y devuelve borrados/rechazados', () => {
  // JSON.parse dentro del propio doPost crea el array de idsUnicos en el realm
  // del vm.createContext — deepStrictEqual contra un array de ESTE realm falla
  // por "same structure but not reference-equal" aunque el contenido sea
  // idéntico (mismo aviso que test/integracionArrastres.test.js). Viaje por
  // JSON para comparar en el realm local.
  let recibidos = null;
  const ctx = cargarConMocks({
    borrarSoportesAdmin: (ids) => { recibidos = JSON.parse(JSON.stringify(ids)); return { borrados: ids, rechazados: [] }; }
  });
  const r = llamarDoPost(ctx, { accion: 'borrarEtiquetasArrastre', token: 'token-real', idsUnicos: ['A', 'B'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(recibidos, ['A', 'B']);
  assert.deepStrictEqual(r.resultado.borrados, ['A', 'B']);
});

test('borrarEtiquetasArrastre: un origen/soporte inválido llega como error, no rompe el webhook', () => {
  const ctx = cargarConMocks({
    borrarSoportesAdmin: () => { throw new Error('No existe ese soporte: Z'); }
  });
  const r = llamarDoPost(ctx, { accion: 'borrarEtiquetasArrastre', token: 'token-real', idsUnicos: ['Z'] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /No existe ese soporte/);
});

test('contarPendientesArrastre: devuelve los contadores de las 4 pestañas de arrastres (una sola consulta ligera)', () => {
  let consultas = 0;
  const ctx = cargarConMocks({
    supaGet_: () => {
      consultas++;
      return [
        { origen: 'MECO' }, { origen: 'MECO' }, { origen: 'MECO' },
        { origen: 'Valencia' }, { origen: 'Torija' }, { origen: 'Torija' },
        { origen: 'Taisa', subtipo: 'Devolución' } // no es arrastre: no cuenta en las 4
      ];
    }
  });
  const r = llamarDoPost(ctx, { accion: 'contarPendientesArrastre', token: 'token-real' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.cuentas.meco, 3);
  assert.strictEqual(r.cuentas.valencia, 1);
  assert.strictEqual(r.cuentas.torija, 2);
  assert.strictEqual(r.cuentas.antequera, 0);
  assert.strictEqual(consultas, 1, 'una sola consulta, no una por origen');
});

test('contarPendientesArrastre: token inválido no consulta nada', () => {
  const ctx = cargarConMocks({
    supaGet_: () => { throw new Error('no debería consultarse con token malo'); }
  });
  const r = llamarDoPost(ctx, { accion: 'contarPendientesArrastre', token: 'malo' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /[Tt]oken/);
});

test('un origen desconocido en cualquiera de las 4 acciones nuevas da error claro', () => {
  const ctx = cargarConMocks({ buscarEtiquetas: () => [] });
  const r = llamarDoPost(ctx, { accion: 'listarPendientesArrastre', token: 'token-real', origen: 'Sevilla' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Origen de arrastre no reconocido/);
});
