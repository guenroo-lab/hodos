const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Reapertura de cargas (2026-10-15): al cerrar otra vez una carga con palets SIE, el B2B de Leroy Merlin
// (que SUMA a las celdas de sección) no puede contarlos dos veces: solo se aplica la diferencia con lo que
// ya se aplicó en el cierre anterior. Mismo hojaFake que integracionB2B.test.js.
const DIR = process.env.HODOS_DIR || path.join(__dirname, '..');

function hojaFake(filas) {
  const datos = filas.map(function (f) {
    const fila = new Array(27).fill('');
    fila[0] = f.fecha; fila[1] = f.tipo; fila[3] = f.destino; fila[6] = f.hora;
    for (let i = 0; i < 13; i++) fila[14 + i] = (f.secciones && f.secciones[i]) || 0;
    return fila;
  });
  return {
    getLastRow: function () { return datos.length + 2; },
    getRange: function (row, col, numRows, numCols) {
      if (col === 1) return { getValues: function () { return datos.map(function (f) { return f.slice(0, numCols); }); } };
      const fila = datos[row - 3];
      return {
        getValues: function () { return [fila.slice(col - 1, col - 1 + numCols)]; },
        setValues: function (vals) { for (let i = 0; i < numCols; i++) fila[col - 1 + i] = vals[0][i]; }
      };
    },
    _datos: datos
  };
}

function cargar(hoja) {
  const ctx = {
    console: console,
    Logger: { log: function () {} },
    Utilities: { formatDate: function () { return ''; } },
    Session: { getScriptTimeZone: function () { return 'Europe/Madrid'; } },
    SpreadsheetApp: { openById: function () { return { getSheetByName: function () { return hoja; } }; } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'IntegracionB2B.gs'), 'utf8'), ctx, { filename: 'IntegracionB2B.gs' });
  return ctx;
}

const FILA = { fecha: '15/10/2026', tipo: 'Expedición', destino: 'LM Marbella', hora: '22:00' };
const secs = (hoja) => hoja._datos[0].slice(14, 27);
const aLocal = (v) => JSON.parse(JSON.stringify(v));

test('conteoSeccionesSie_: cuenta por sección (1-13) solo los palets encontrados con código válido', () => {
  const ctx = cargar(hojaFake([]));
  const c = aLocal(ctx.conteoSeccionesSie_([
    { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '13' },
    { encontrado: false, codSeccion: '5' }, { encontrado: true, codSeccion: '14' }, { encontrado: true, codSeccion: '' }, { encontrado: true, codSeccion: 'x' }
  ]));
  assert.strictEqual(c[1], 2);
  assert.strictEqual(c[13], 1);
  assert.strictEqual(c[5], 0);
  assert.strictEqual(Object.keys(c).length, 13);
  assert.deepStrictEqual(aLocal(ctx.conteoSeccionesSie_([])), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0, 13: 0 });
});

test('actualizarB2BSIE_: devuelve el conteo aplicado (para guardarlo en la carga)', () => {
  const hoja = hojaFake([Object.assign({ secciones: [] }, FILA)]);
  const r = cargar(hoja).actualizarB2BSIE_('Marbella', '15/10/2026', '22:00', [{ encontrado: true, codSeccion: '2' }, { encontrado: true, codSeccion: '2' }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.conteo[2], 2);
  assert.strictEqual(secs(hoja)[1], 2);
});

test('actualizarB2BSIE_: sin conteo previo suma todo, igual que siempre', () => {
  const hoja = hojaFake([Object.assign({ secciones: [5] }, FILA)]);
  cargar(hoja).actualizarB2BSIE_('Marbella', '15/10/2026', '22:00', [{ encontrado: true, codSeccion: '1' }], null);
  assert.strictEqual(secs(hoja)[0], 6);
});

test('actualizarB2BSIE_: cerrar otra vez aplica solo la diferencia (ya se había sumado 2 en la sección 1; ahora hay 3 -> +1, no +3)', () => {
  const hoja = hojaFake([Object.assign({ secciones: [7] }, FILA)]); // 5 de otros + 2 de esta carga
  const palets = [{ encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }];
  const r = cargar(hoja).actualizarB2BSIE_('Marbella', '15/10/2026', '22:00', palets, { 1: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(secs(hoja)[0], 8);
  assert.strictEqual(r.conteo[1], 3, 'devuelve lo aplicado en total, no la diferencia');
});

test('actualizarB2BSIE_: si se quitan palets al reabrir, la diferencia es negativa y se resta (sin bajar de 0)', () => {
  const hoja = hojaFake([Object.assign({ secciones: [7, 1] }, FILA)]);
  const r = cargar(hoja).actualizarB2BSIE_('Marbella', '15/10/2026', '22:00', [], { 1: 2, 2: 4 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.aviso, undefined, 'quitar todos los palets no es un aviso');
  assert.strictEqual(secs(hoja)[0], 5, '7 - 2');
  assert.strictEqual(secs(hoja)[1], 0, '1 - 4 queda en 0, nunca negativo');
});

test('actualizarB2BSIE_: cerrar otra vez sin cambios no modifica el B2B', () => {
  const hoja = hojaFake([Object.assign({ secciones: [7, 3] }, FILA)]);
  const palets = [{ encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '2' }];
  cargar(hoja).actualizarB2BSIE_('Marbella', '15/10/2026', '22:00', palets, { 1: 2, 2: 1 });
  assert.deepStrictEqual(aLocal(secs(hoja)).slice(0, 3), [7, 3, 0]);
});
