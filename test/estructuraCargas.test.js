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

test('filaCargaDesdeSupabase_ convierte snake_case a camelCase', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  const fila = {
    id_carga: 'CARGA-000001', destino: 'Mijas', fecha_entrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creada_por: 'a@b.com', fecha_creacion: '2026-07-29T10:00:00Z',
    cerrada_por: null, fecha_cierre: null, pdf_url: null, email_enviado: null
  };
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaDesdeSupabase_(fila)), {
    idCarga: 'CARGA-000001', destino: 'Mijas', fechaEntrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creadaPor: 'a@b.com', fechaCreacion: '2026-07-29T10:00:00Z',
    cerradaPor: null, fechaCierre: null, pdfUrl: null, emailEnviado: null
  });
});

test('filaCargaHaciaSupabase_ convierte camelCase a snake_case, solo campos presentes', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaHaciaSupabase_({
    idCarga: 'CARGA-000001', destino: 'Mijas', fechaEntrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creadaPor: 'a@b.com'
  })), {
    id_carga: 'CARGA-000001', destino: 'Mijas', fecha_entrega: '2026-07-30', horario: '8:00',
    estado: 'ABIERTA', creada_por: 'a@b.com'
  });
});

test('filaCargaHaciaSupabase_ con objeto parcial (cierre de carga) solo mapea esos campos', () => {
  const ctx = cargarGs('EstructuraCargas.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.filaCargaHaciaSupabase_({
    estado: 'CERRADA', cerradaPor: 'a@b.com', fechaCierre: '2026-07-29T12:00:00Z', pdfUrl: 'https://x', emailEnviado: 'SI'
  })), {
    estado: 'CERRADA', cerrada_por: 'a@b.com', fecha_cierre: '2026-07-29T12:00:00Z', pdf_url: 'https://x', email_enviado: 'SI'
  });
});
