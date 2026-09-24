const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGs(nombre) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

// vm.createContext crea un realm nuevo: los arrays que devuelve tienen un Array
// distinto al de este archivo, y deepStrictEqual los rechaza aunque el contenido sea
// idéntico ("same structure but are not reference-equal"). El round-trip por JSON
// reconstruye el valor con el Array de este realm antes de comparar.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('code128Checksum_ calcula el checksum correcto para un solo carácter', () => {
  const ctx = cargarGs('Barcode.gs');
  // '5' -> charCode 53 -> valor 53-32=21. checksum = 104 (START_B) + 21*1 = 125. 125 % 103 = 22.
  const checksum = ctx.code128Checksum_(ctx.code128ValoresDesdeTexto_('5'));
  assert.strictEqual(checksum, 22);
});

test('code128Secuencia incluye START_B, valores, checksum y STOP', () => {
  const ctx = cargarGs('Barcode.gs');
  const secuencia = ctx.code128Secuencia('5');
  assert.deepStrictEqual(aRealmLocal(secuencia), [104, 21, 22, 106]);
});

test('code128Secuencia: texto vacío lanza (hueco de cobertura detectado en revisión, 2026-09-23)', () => {
  const ctx = cargarGs('Barcode.gs');
  assert.throws(() => ctx.code128Secuencia(''), /texto vacío/);
});

test('code128Secuencia: null/undefined también lanzan (misma rama que texto vacío)', () => {
  const ctx = cargarGs('Barcode.gs');
  assert.throws(() => ctx.code128Secuencia(null), /texto vacío/);
  assert.throws(() => ctx.code128Secuencia(undefined), /texto vacío/);
});

test('code128Anchos/code128SVG: texto vacío también lanza (propagan el mismo guard de code128Secuencia)', () => {
  const ctx = cargarGs('Barcode.gs');
  assert.throws(() => ctx.code128Anchos(''), /texto vacío/);
  assert.throws(() => ctx.code128SVG(''), /texto vacío/);
});

test('code128Anchos: la suma de anchos coincide con el nº de módulos esperado (11*n+35)', () => {
  const ctx = cargarGs('Barcode.gs');
  const texto = '286676';
  const anchos = ctx.code128Anchos(texto);
  const total = anchos.reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 11 * texto.length + 35);
});

test('code128Anchos: decodificar los anchos reconstruye exactamente los patrones de PATRONES_CODE128', () => {
  const ctx = cargarGs('Barcode.gs');
  const texto = 'AB12';
  const secuencia = ctx.code128Secuencia(texto);
  const bitsEsperados = secuencia.map((v) => ctx.PATRONES_CODE128[v]).join('');
  const anchos = ctx.code128Anchos(texto);
  let bitsReconstruidos = '';
  let bit = '1';
  anchos.forEach((ancho) => {
    bitsReconstruidos += bit.repeat(ancho);
    bit = bit === '1' ? '0' : '1';
  });
  assert.strictEqual(bitsReconstruidos, bitsEsperados);
});

test('code128ValoresDesdeTexto_ rechaza caracteres fuera de ASCII 32-127', () => {
  const ctx = cargarGs('Barcode.gs');
  assert.throws(() => ctx.code128ValoresDesdeTexto_('ñ'), /ASCII 32-127/);
});

test('code128SVG produce un elemento <svg> con al menos un <rect>', () => {
  const ctx = cargarGs('Barcode.gs');
  const svg = ctx.code128SVG('123456');
  assert.match(svg, /^<svg /);
  assert.match(svg, /<rect /);
});
