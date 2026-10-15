const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Informe de carga (2026-10-15): lleva el cargador en la cabecera y, si la carga se reabrió y se volvió a
// cerrar, una franja que avisa de que este informe sustituye al anterior. Mismo montaje que reporteCarga.test.js.
const DIR = process.env.HODOS_DIR || path.join(__dirname, '..');

function contexto(cargaFila) {
  const ctx = {
    Utilities: { formatDate: function (d) { return d.toISOString().slice(0, 16).replace('T', ' '); } },
    Logger: { log: function () {} },
    leerCargas_: () => [Object.assign({ idCarga: 'CARGA-1', estado: 'CERRADA', destino: 'Marbella', fechaEntrega: '2026-10-15T00:00:00.000Z', horario: '22:00' }, cargaFila)],
    leerEtiquetas_: () => [], leerTodoContenidoCrudo_: () => [], leerContenidoCrudoPorIds_: () => [], leerPaletesPorCarga_: () => []
  };
  vm.createContext(ctx);
  ['Utilidades.gs', 'Backend.gs', 'SolicitantesKairos.gs', 'ReporteCarga.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

test('htmlInformeCarga: la cabecera muestra quién ha cargado', () => {
  const html = contexto({ cargador: 'Juanlu, Alberto' }).htmlInformeCarga('CARGA-1');
  assert.match(html, /<strong>Cargador:<\/strong> Juanlu, Alberto/);
});

test('htmlInformeCarga: sin cargador (cargas anteriores a esta mejora) no aparece esa línea', () => {
  const html = contexto({ cargador: null }).htmlInformeCarga('CARGA-1');
  assert.doesNotMatch(html, /Cargador:/);
});

test('htmlInformeCarga: una carga reabierta lleva la franja «Informe actualizado» con cuándo y quién la reabrió', () => {
  const html = contexto({ reabiertaEn: '2026-10-15T08:30:00.000Z', reabiertaPor: 'muelle@x.com' }).htmlInformeCarga('CARGA-1');
  assert.match(html, /INFORME ACTUALIZADO/);
  assert.match(html, /sustituye al anterior/);
  assert.match(html, /2026-10-15 08:30/);
});

test('htmlInformeCarga: una carga que nunca se reabrió no lleva esa franja', () => {
  const html = contexto({ reabiertaEn: null }).htmlInformeCarga('CARGA-1');
  assert.doesNotMatch(html, /INFORME ACTUALIZADO/);
});

test('htmlInformeCarga: el cargador y el motivo del aviso se escapan (no se cuela HTML)', () => {
  const html = contexto({ cargador: '<img src=x onerror=alert(1)>' }).htmlInformeCarga('CARGA-1');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
