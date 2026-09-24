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

test('filaContenidoDesdeSupabase_ se queda solo con descripcion y cantidad', () => {
  const ctx = cargarGs('EstructuraContenido.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaContenidoDesdeSupabase_({
    id_unico: 'HODOS-000001', descripcion: 'Tornillos', cantidad: 5, creado_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z'
  })), { descripcion: 'Tornillos', cantidad: 5 });
});

test('filaContenidoHaciaSupabase_ añade id_unico/creado_por/fecha_creacion a la línea', () => {
  const ctx = cargarGs('EstructuraContenido.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaContenidoHaciaSupabase_(
    'HODOS-000001', { descripcion: 'Tornillos', cantidad: 5 }, 'a@b.com', '2026-07-29T10:00:00Z'
  )), {
    id_unico: 'HODOS-000001', descripcion: 'Tornillos', cantidad: 5, creado_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z'
  });
});
