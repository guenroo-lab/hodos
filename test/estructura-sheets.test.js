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

test('filaEtiquetaDesdeSupabase_ mapea pendiente_impresion_incpc -> pendienteImpresionIncpc', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const fila = { id_unico: 'HODOS-000001', pendiente_impresion_incpc: true };
  assert.strictEqual(ctx.filaEtiquetaDesdeSupabase_(fila).pendienteImpresionIncpc, true);
});

test('filaEtiquetaHaciaSupabase_ mapea pendienteImpresionIncpc -> pendiente_impresion_incpc', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const obj = { idUnico: 'HODOS-000001', pendienteImpresionIncpc: false };
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_(obj).pendiente_impresion_incpc, false);
});

test('filaEtiquetaHaciaSupabase_ omite pendiente_impresion_incpc si no viene en el objeto', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const obj = { idUnico: 'HODOS-000001' };
  assert.strictEqual('pendiente_impresion_incpc' in ctx.filaEtiquetaHaciaSupabase_(obj), false);
});
