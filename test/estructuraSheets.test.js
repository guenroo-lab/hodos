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

function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('filaEtiquetaDesdeSupabase_ convierte snake_case a camelCase', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const fila = {
    id_unico: 'HODOS-000001', numero_pedido: '100200', soporte_num: 1, soporte_total: 1,
    origen: 'Taisa', subtipo: 'Inventario', origen_texto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fecha_creacion: '2026-07-29T10:00:00Z', lote_id: 'uuid-1', creado_por: 'a@b.com',
    estado: 'REGISTRADO', batea_id: null, fecha_envio: null, origen_tienda: ''
  };
  assert.deepStrictEqual(aRealmLocal(ctx.filaEtiquetaDesdeSupabase_(fila)), {
    idUnico: 'HODOS-000001', numeroPedido: '100200', soporteNum: 1, soporteTotal: 1,
    origen: 'Taisa', subtipo: 'Inventario', origenTexto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fechaCreacion: '2026-07-29T10:00:00Z', loteId: 'uuid-1', creadoPor: 'a@b.com',
    estado: 'REGISTRADO', bateaId: null, fechaEnvio: null, origenTienda: ''
  });
});

test('filaEtiquetaHaciaSupabase_ mapea un objeto completo (registrarLote)', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const resultado = ctx.filaEtiquetaHaciaSupabase_({
    idUnico: 'HODOS-000001', numeroPedido: '100200', soporteNum: 1, soporteTotal: 1,
    origen: 'Taisa', subtipo: 'Inventario', origenTexto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fechaCreacion: '2026-07-29T10:00:00Z', loteId: 'uuid-1', creadoPor: 'a@b.com',
    estado: 'REGISTRADO', bateaId: null, fechaEnvio: null, origenTienda: ''
  });
  assert.deepStrictEqual(aRealmLocal(resultado), {
    id_unico: 'HODOS-000001', numero_pedido: '100200', soporte_num: 1, soporte_total: 1,
    origen: 'Taisa', subtipo: 'Inventario', origen_texto: 'TAISA - INVENTARIO', destino: 'Mijas',
    fecha_creacion: '2026-07-29T10:00:00Z', lote_id: 'uuid-1', creado_por: 'a@b.com',
    estado: 'REGISTRADO', batea_id: null, fecha_envio: null, origen_tienda: ''
  });
});

test('filaEtiquetaHaciaSupabase_ con objeto parcial (escaneo) solo mapea esos campos', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaEtiquetaHaciaSupabase_({
    estado: 'EN_RUTA', bateaId: 'CARGA-000001', fechaEnvio: '2026-07-29T12:00:00Z'
  })), {
    estado: 'EN_RUTA', batea_id: 'CARGA-000001', fecha_envio: '2026-07-29T12:00:00Z'
  });
});

test('filaEtiquetaDesdeSupabase_ mapea razon_flujo a razonFlujo', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const r = ctx.filaEtiquetaDesdeSupabase_({ id_unico: 'HODOS-000001', razon_flujo: 'Sobrante' });
  assert.strictEqual(r.razonFlujo, 'Sobrante');
});

test('filaEtiquetaHaciaSupabase_ mapea razonFlujo a razon_flujo, incluso cadena vacía', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ razonFlujo: 'Sobrante' }).razon_flujo, 'Sobrante');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ razonFlujo: '' }).razon_flujo, '');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({}).razon_flujo, undefined);
});

test('filaEtiquetaDesdeSupabase_ mapea expedicion', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  const r = ctx.filaEtiquetaDesdeSupabase_({ id_unico: 'HODOS-000001', expedicion: '02828945' });
  assert.strictEqual(r.expedicion, '02828945');
});

test('filaEtiquetaHaciaSupabase_ mapea expedicion, incluida cadena vacía y null', () => {
  const ctx = cargarGs('EstructuraSheets.gs');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: '02828945' }).expedicion, '02828945');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: '' }).expedicion, '');
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({ expedicion: null }).expedicion, null);
  assert.strictEqual(ctx.filaEtiquetaHaciaSupabase_({}).expedicion, undefined);
});
