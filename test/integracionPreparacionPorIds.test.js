const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Imprimir las "Petición Reserva" POR ID desde fuera de HODOS (Kairos, pestaña HODOS del
// jefe, 2026-10-05): dos acciones nuevas del webhook (doPost), mismo token. La etiqueta
// la genera htmlUnaEtiqueta_/envolverEtiquetasHtml_, igual que la pestaña "Prep. Pedidos".
function cargarConMocks(mocks) {
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '05/10/2026' },
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

const ids = (n) => Array.from({ length: n }, (_, i) => 'HODOS-' + String(i + 1).padStart(6, '0'));

test('htmlEtiquetasPreparacion: token inválido no lee nada', () => {
  const ctx = cargarConMocks({ leerEtiquetas_: () => { throw new Error('no debería llamarse'); } });
  const r = llamarDoPost(ctx, { accion: 'htmlEtiquetasPreparacion', token: 'malo', idsUnicos: ['HODOS-000001'] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /[Tt]oken/);
});

test('htmlEtiquetasPreparacion: monta el HTML con la etiqueta de siempre, más antigua primero', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    leerEtiquetas_: (filtro) => {
      llamadas.push(filtro);
      return [
        { idUnico: 'HODOS-000002', fechaCreacion: '2026-10-05T10:00:00Z' },
        { idUnico: 'HODOS-000001', fechaCreacion: '2026-10-05T09:00:00Z' }
      ];
    }
  });
  const r = llamarDoPost(ctx, { accion: 'htmlEtiquetasPreparacion', token: 'token-real', idsUnicos: ['HODOS-000002', 'HODOS-000001'] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.html, '<html><div>HODOS-000001</div>\n<div>HODOS-000002</div></html>');
  assert.strictEqual(llamadas.length, 1);
  assert.match(llamadas[0], /subtipo=eq\.Petici%C3%B3n%20Reserva/);
  assert.match(llamadas[0], /id_unico=in\.\(HODOS-000002,HODOS-000001\)/);
});

test('htmlEtiquetasPreparacion: ids en trozos de 30 (URL corta) y sin repetidos', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    leerEtiquetas_: (filtro) => { llamadas.push(filtro); return [{ idUnico: 'X' + llamadas.length, fechaCreacion: '2026-10-05T0' + llamadas.length + ':00:00Z' }]; }
  });
  const lista = ids(70).concat(['HODOS-000001', 'HODOS-000002']); // dos repetidos
  const r = llamarDoPost(ctx, { accion: 'htmlEtiquetasPreparacion', token: 'token-real', idsUnicos: lista });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(llamadas.length, 3);
  llamadas.forEach((f) => assert.ok(f.match(/id_unico=in\.\(([^)]*)\)/)[1].split(',').length <= 30));
  assert.strictEqual(llamadas.join('').split('HODOS-000001').length - 1, 1, 'un id repetido solo se pide una vez');
});

test('htmlEtiquetasPreparacion: sin etiquetas, error claro', () => {
  const ctx = cargarConMocks({ leerEtiquetas_: () => [] });
  const r = llamarDoPost(ctx, { accion: 'htmlEtiquetasPreparacion', token: 'token-real', idsUnicos: ['HODOS-000009'] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /No hay etiquetas/);
});

test('ids no válidos, vacíos o demasiados se rechazan antes de consultar nada', () => {
  const ctx = cargarConMocks({
    leerEtiquetas_: () => { throw new Error('no debería consultar'); },
    supaActualizar_: () => { throw new Error('no debería escribir'); }
  });
  ['htmlEtiquetasPreparacion', 'marcarImpresasPreparacion'].forEach((accion) => {
    [undefined, [], 'HODOS-000001', ['a,b)'], ['HODOS-1)&subtipo=neq.x'], ['']].forEach((malos) => {
      const r = llamarDoPost(ctx, { accion, token: 'token-real', idsUnicos: malos });
      assert.strictEqual(r.ok, false, accion + ' con ' + JSON.stringify(malos));
    });
    const r = llamarDoPost(ctx, { accion, token: 'token-real', idsUnicos: ids(201) });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Demasiadas/);
  });
});

test('marcarImpresasPreparacion: solo esos ids, solo pendientes y solo Petición Reserva', () => {
  const llamadas = [];
  const ctx = cargarConMocks({
    supaActualizar_: (tabla, filtro, cambios) => { llamadas.push({ tabla, filtro, cambios }); return [{}, {}]; }
  });
  const r = llamarDoPost(ctx, { accion: 'marcarImpresasPreparacion', token: 'token-real', idsUnicos: ['HODOS-000001', 'HODOS-000002'] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resultado.cantidad, 2);
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].tabla, 'etiquetas');
  assert.match(llamadas[0].filtro, /^pendiente_impresion_incpc=eq\.true&/);
  assert.match(llamadas[0].filtro, /subtipo=eq\.Petici%C3%B3n%20Reserva/);
  assert.match(llamadas[0].filtro, /id_unico=in\.\(HODOS-000001,HODOS-000002\)/);
  assert.strictEqual(JSON.stringify(llamadas[0].cambios), '{"pendiente_impresion_incpc":false}');
});

test('marcarImpresasPreparacion: suma entre trozos', () => {
  let n = 0;
  const ctx = cargarConMocks({ supaActualizar_: () => { n++; return [{}, {}, {}]; } });
  const r = llamarDoPost(ctx, { accion: 'marcarImpresasPreparacion', token: 'token-real', idsUnicos: ids(65) });
  assert.strictEqual(n, 3);
  assert.strictEqual(r.resultado.cantidad, 9);
});

test('las acciones antiguas siguen intactas (marcarImpresasPreparacion() sin ids no se toca)', () => {
  const ctx = cargarConMocks({ supaActualizar_: (t, f) => { ctx.__filtro = f; return [{}]; } });
  const r = ctx.marcarImpresasPreparacion();
  assert.strictEqual(r.cantidad, 1);
  assert.doesNotMatch(ctx.__filtro, /id_unico=in/);
});
