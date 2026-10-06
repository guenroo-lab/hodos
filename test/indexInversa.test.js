const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

// El JS de la pestaña va entre dos marcas para poder probarlo aparte.
function bloqueInversa() {
  const m = /\/\/ ══ PRECARGA INVERSA: inicio ══([\s\S]*?)\/\/ ══ PRECARGA INVERSA: fin ══/.exec(html);
  assert.ok(m, 'faltan las marcas de inicio/fin del bloque JS de Precarga Inversa');
  return m[1];
}

const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

test('Index.html: botón de la barra lateral, insignia y vista de la Precarga Inversa', () => {
  assert.match(html, /data-tab="inversa"/);
  assert.match(html, /onclick="cambiarPestana\('inversa'\)"/);
  assert.match(html, /id="badge-inversa"/);
  assert.match(html, /id="vistaInversa" class="vista-oculta"/);
  ['inversaFormulario', 'inversaCatalogo', 'inversaTotalForm', 'btnInversaGuardar', 'btnInversaCancelarEdicion',
    'inversaContador', 'inversaResumenTipos', 'inversaListaTorres'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'falta id=' + id);
  });
});

test('cambiarPestana: muestra/oculta la vista inversa y carga sus datos', () => {
  assert.match(html, /getElementById\('vistaInversa'\)\.classList\.toggle\('vista-oculta', nombre !== 'inversa'\)/);
  assert.match(html, /if \(nombre === 'inversa'\) \{ cargarPestanaInversa_\(\); \}/);
});

test('el bloque JS de la Precarga Inversa parsea y no usa diálogos nativos', () => {
  const codigo = bloqueInversa();
  assert.doesNotThrow(() => new Function(codigo));
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(codigo), 'no debe usar alert/confirm/prompt');
});

test('pintarBadge_ admite un título propio y actualizarBadges_ cuenta también las torres', () => {
  assert.match(html, /function pintarBadge_\(tab, cantidad, titulo\)/);
  assert.match(html, /el\.title = titulo \|\| \(n \+ ' etiqueta\(s\) pendiente\(s\) de imprimir'\);/);
  assert.match(html, /gas\('contarTorresInversaPendientes'\)/);
});

test('agruparCatalogoInversa_ agrupa por tipo en el orden en que aparecen', () => {
  // El bloque engancha tres eventos al cargar: un document de mentira basta para ejecutarlo en vm.
  const ctx = { document: { getElementById: () => ({ addEventListener: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(bloqueInversa(), ctx);
  const grupos = aLocal(ctx.agruparCatalogoInversa_([
    { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' },
    { id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa' },
    { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' }
  ]));
  assert.deepStrictEqual(grupos, [
    { tipo: 'Palet', items: [{ id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' }, { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' }] },
    { tipo: 'Jaula Completa', items: [{ id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa' }] }
  ]);
});

test('textoDesgloseInversa_ junta las líneas con "cantidad × nombre"', () => {
  // El bloque engancha tres eventos al cargar: un document de mentira basta para ejecutarlo en vm.
  const ctx = { document: { getElementById: () => ({ addEventListener: () => {} }) } };
  vm.createContext(ctx);
  vm.runInContext(bloqueInversa(), ctx);
  assert.strictEqual(
    ctx.textoDesgloseInversa_([{ nombre: 'EUROPEO', cantidad: 5 }, { nombre: 'JAULA', cantidad: 5 }]),
    '5 × EUROPEO · 5 × JAULA'
  );
});
