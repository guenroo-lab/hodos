const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Endpoint de solo lectura para Centinela (2026-09-21): doGet?accion=pendientesTienda&tienda=X
function cargar(mocks) {
  const ctx = Object.assign({
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    HtmlService: { createTemplateFromFile: () => { throw new Error('no debe servir HTML en este camino'); } },
    leerEtiquetas_: () => []
  }, mocks);
  vm.createContext(ctx);
  ['Utilidades.gs', 'ReporteCarga.gs', 'Backend.gs', 'IntegracionCentinela.gs'].forEach((f) => {
    try { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx); } catch (e) { /* ReporteCarga/Backend dependen de globals de GAS; solo necesitamos las funciones */ }
  });
  return ctx;
}

function llamar(ctx, parametros) {
  return JSON.parse(ctx.doGet({ parameter: parametros }).getContent());
}

test('pendientesTienda: devuelve los soportes REGISTRADO de la tienda pedida', () => {
  let filtroUsado = '';
  const ctx = cargar({
    leerEtiquetas_: (filtro) => {
      filtroUsado = filtro;
      return [{ idUnico: 'HODOS-000001', numeroPedido: '514281', soporteNum: 1, soporteTotal: 2, origenTexto: 'Taisa', razonFlujo: '', fechaCreacion: '2026-09-18T09:00:00.000Z' }];
    }
  });
  const r = llamar(ctx, { accion: 'pendientesTienda', tienda: 'Marbella' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tienda, 'Marbella');
  assert.strictEqual(r.pendientes.length, 1);
  assert.strictEqual(r.pendientes[0].numeroPedido, '514281');
  assert.strictEqual(r.pendientes[0].soporteTotal, 2);
  assert.ok(['ok', 'amarillo', 'naranja', 'rojo'].indexOf(r.pendientes[0].nivelAviso) >= 0);
  assert.ok(/estado=eq\.REGISTRADO/.test(filtroUsado), filtroUsado);
  assert.ok(/destino=eq\.Marbella/.test(filtroUsado), filtroUsado);
});

test('pendientesTienda: tienda con tilde (Málaga) se codifica bien en el filtro', () => {
  let filtroUsado = '';
  const ctx = cargar({ leerEtiquetas_: (f) => { filtroUsado = f; return []; } });
  const r = llamar(ctx, { accion: 'pendientesTienda', tienda: 'Málaga' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.pendientes, []);
  assert.ok(/destino=eq\.M%C3%A1laga/.test(filtroUsado), filtroUsado);
});

test('pendientesTienda: tienda no válida → ok:false y NO consulta Supabase', () => {
  let consultas = 0;
  const ctx = cargar({ leerEtiquetas_: () => { consultas++; return []; } });
  const r = llamar(ctx, { accion: 'pendientesTienda', tienda: 'Inventada' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Tienda no válida/);
  assert.strictEqual(consultas, 0);
});

test('pendientesTienda: error de Supabase → ok:false con el mensaje, sin lanzar', () => {
  const ctx = cargar({ leerEtiquetas_: () => { throw new Error('supaGet_(etiquetas): caído'); } });
  const r = llamar(ctx, { accion: 'pendientesTienda', tienda: 'Mijas' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /caído/);
});
