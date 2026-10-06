const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Utilidades, Barcode y Backend son los de verdad (puros); lo de Google y Supabase, stubs.
function cargarEtiqueta(extra) {
  const ctx = Object.assign({
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.c' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) }
  }, extra);
  vm.createContext(ctx);
  ['Utilidades.gs', 'Barcode.gs', 'Backend.gs', 'PrecargaInversa.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  });
  return ctx;
}

const lineas = (n) => Array.from({ length: n }, (_, i) => ({ id: 'S' + (i + 1), nombre: 'TIPO ' + (i + 1), cantidad: i + 1 }));
const torre = (ls) => ({
  idUnico: 'INV-000007',
  lineas: ls,
  total: ls.reduce((s, l) => s + l.cantidad, 0),
  fechaCreacion: '2026-10-06T08:00:00Z'
});

test('claseTamanoLineasInversa_: letra más pequeña cuantas más líneas', () => {
  const ctx = cargarEtiqueta();
  [1, 2, 3, 4].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-g', String(n)));
  [5, 6].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-m', String(n)));
  [7, 8, 9].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-p', String(n)));
  [10, 14, 30].forEach((n) => assert.strictEqual(ctx.claseTamanoLineasInversa_(n), 'inv-xp', String(n)));
});

test('htmlUnaTorreInversa_: id, destino, desglose, total y código de barras', () => {
  const ctx = cargarEtiqueta();
  const html = ctx.htmlUnaTorreInversa_(torre([
    { id: 'S01', nombre: 'EUROPEO', cantidad: 5 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]), '06/10/2026');
  assert.match(html, /INV-000007/);
  assert.match(html, /INVERSA · TORIJA/);
  assert.match(html, /<span class="inv-cant">5<\/span><span class="inv-nom">EUROPEO<\/span>/);
  assert.match(html, /<span class="inv-cant">5<\/span><span class="inv-nom">JAULA<\/span>/);
  assert.match(html, /TOTAL: 10 SOPORTES/);
  assert.match(html, /Creada: 06\/10\/2026/);
  assert.match(html, /<svg/);
  assert.match(html, /class="inv-lista inv-g"/);
  assert.ok(!/inv-dos-col/.test(html));
});

test('htmlUnaTorreInversa_: singular, dos columnas y letra pequeña con muchas líneas', () => {
  const ctx = cargarEtiqueta();
  assert.match(ctx.htmlUnaTorreInversa_(torre([{ id: 'S01', nombre: 'EUROPEO', cantidad: 1 }]), 'x'), /TOTAL: 1 SOPORTE</);
  const nueve = ctx.htmlUnaTorreInversa_(torre(lineas(9)), 'x');
  assert.match(nueve, /class="inv-lista inv-p inv-dos-col"/);
  const doce = ctx.htmlUnaTorreInversa_(torre(lineas(12)), 'x');
  assert.match(doce, /class="inv-lista inv-xp inv-dos-col"/);
});

test('htmlUnaTorreInversa_: escapa el nombre de los soportes', () => {
  const ctx = cargarEtiqueta();
  const html = ctx.htmlUnaTorreInversa_(torre([{ id: 'S01', nombre: '<b>MALO</b>', cantidad: 2 }]), 'x');
  assert.ok(!/<b>MALO/.test(html));
  assert.match(html, /&lt;b&gt;MALO&lt;\/b&gt;/);
});

test('htmlEtiquetasTorresInversa: pide las torres por id e incluye el CSS propio de la torre', () => {
  let pedido = null;
  const ctx = cargarEtiqueta({
    supaGet_: (tabla, filtro) => {
      pedido = { tabla: tabla, filtro: filtro };
      return [{ id_unico: 'INV-000007', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 3 }], total_soportes: 3, creado_por: 'a', fecha_creacion: '2026-10-06T08:00:00Z' }];
    }
  });
  const html = ctx.htmlEtiquetasTorresInversa(['inv-000007']);
  assert.strictEqual(pedido.tabla, 'torres_inversa');
  assert.strictEqual(pedido.filtro, 'id_unico=in.(INV-000007)&order=id_unico.asc');
  assert.match(html, /@page\{size:100mm 150mm;margin:0;\}/);
  assert.match(html, /\.inv-lista\{/);
  assert.match(html, /INV-000007/);
});

test('htmlEtiquetasTorresInversa: sin ids o sin torres encontradas es un error legible', () => {
  const ctx = cargarEtiqueta({ supaGet_: () => [] });
  assert.throws(() => ctx.htmlEtiquetasTorresInversa([]), /Faltan las torres/);
  assert.throws(() => ctx.htmlEtiquetasTorresInversa(['INV-000007']), /ya no existen/);
  assert.throws(() => ctx.htmlEtiquetasTorresInversa(['HODOS-000001']), /no válido/);
});

test('envolverEtiquetasHtml_: sin CSS extra la salida no cambia; con CSS extra lo añade dentro del <style>', () => {
  const ctx = cargarEtiqueta();
  const base = ctx.envolverEtiquetasHtml_('<x>');
  assert.ok(!/EXTRA/.test(base));
  const conExtra = ctx.envolverEtiquetasHtml_('<x>', '.EXTRA{color:red;}');
  assert.ok(conExtra.indexOf('.EXTRA{color:red;}') > conExtra.indexOf('.barcode-wrap'));
  assert.ok(conExtra.indexOf('.EXTRA{color:red;}') < conExtra.indexOf('</style>'));
  assert.strictEqual(conExtra.replace('.EXTRA{color:red;}', ''), base);
});
