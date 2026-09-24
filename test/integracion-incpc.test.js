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

test('normalizarDestinoIncpc_ colapsa variantes de Malaga a Málaga', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga 1'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga 2'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Malaga Sabado'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('MALAGA'), 'Málaga');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('málaga'), 'Málaga');
});

test('normalizarDestinoIncpc_ reconoce Marbella/Granada/Mijas sin importar mayúsculas', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('marbella'), 'Marbella');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('GRANADA'), 'Granada');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(' Mijas '), 'Mijas');
});

test('normalizarDestinoIncpc_ devuelve cadena vacía si no reconoce el valor', () => {
  const ctx = cargarGs('IntegracionIncpc.gs');
  assert.strictEqual(ctx.normalizarDestinoIncpc_('Sevilla'), '');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(''), '');
  assert.strictEqual(ctx.normalizarDestinoIncpc_(undefined), '');
});
