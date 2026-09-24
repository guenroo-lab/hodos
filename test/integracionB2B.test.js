const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Construye una hoja falsa con el mismo layout que la real (columnas 1-indexadas:
// A=fecha, B=tipo, D=destino, G=hora, O..AA=secciones 1-13). `filas` es un array de
// objetos {fecha, tipo, destino, hora, secciones:[13 números]}; los datos "reales"
// empiezan en la fila 3 (cabecera ocupa 1-2), igual que IntegracionB2B.gs asume.
function hojaFake(filas) {
  var datos = filas.map(function (f) {
    var fila = new Array(27).fill('');
    fila[0] = f.fecha;               // A: fecha (col 1)
    fila[1] = f.tipo;                // B: tipo (col 2)
    fila[3] = f.destino;             // D: destino (col 4)
    fila[6] = f.hora;                // G: hora (col 7)
    for (var i = 0; i < 13; i++) fila[14 + i] = (f.secciones && f.secciones[i]) || 0; // O..AA
    return fila;
  });
  return {
    getLastRow: function () { return datos.length + 2; },
    getRange: function (row, col, numRows, numCols) {
      // col===1 (columna A, fecha): la lectura completa de todas las filas de datos.
      // col===15 (O, inicio de secciones): lectura/escritura de la fila concreta ya
      // encontrada — distinguirlos por columna, no por "numRows===1", porque con una
      // sola fila de prueba ambas llamadas tendrían numRows===1 y serían ambiguas.
      if (col === 1) {
        return { getValues: function () { return datos.map(function (f) { return f.slice(0, numCols); }); } };
      }
      var fila = datos[row - 3];
      return {
        getValues: function () { return [fila.slice(col - 1, col - 1 + numCols)]; },
        setValues: function (vals) { for (var i = 0; i < numCols; i++) fila[col - 1 + i] = vals[0][i]; }
      };
    },
    _datos: datos
  };
}

function cargarConMocks(hojasPorNombre) {
  var nombresConsultados = [];
  var ctx = {
    console: console,
    Logger: { log: function () {} },
    Utilities: {
      formatDate: function (d) {
        var pad = function (n) { return String(n).padStart(2, '0'); };
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
      }
    },
    Session: { getScriptTimeZone: function () { return 'Europe/Madrid'; } },
    SpreadsheetApp: {
      openById: function () {
        return {
          getSheetByName: function (nombre) {
            nombresConsultados.push(nombre);
            return hojasPorNombre[nombre] || null;
          }
        };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionB2B.gs'), 'utf8'), ctx, { filename: 'IntegracionB2B.gs' });
  return { ctx: ctx, nombresConsultados: nombresConsultados };
}

test('actualizarB2BSIE_: abre la hoja del MES DE LA FECHA DE ENTREGA, no del mes de ejecución (bug real 2026-09-23)', () => {
  const { ctx, nombresConsultados } = cargarConMocks({}); // ninguna hoja existe
  const r = ctx.actualizarB2BSIE_('Marbella', '31/08/2026', '16:00', []);
  assert.deepStrictEqual(nombresConsultados, ['Agosto 2026']);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Agosto 2026/);
});

test('actualizarB2BSIE_: devuelve {ok:false} legible si la hoja del mes no existe (antes solo Logger.log, sin retorno)', () => {
  const { ctx } = cargarConMocks({});
  const r = ctx.actualizarB2BSIE_('Mijas', '05/03/2026', '10:00', []);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Marzo 2026/);
});

test('actualizarB2BSIE_: devuelve {ok:false} legible si no encuentra la fila (fecha+destino+hora)', () => {
  // La celda de fecha se modela como string "dd/MM/yyyy" ya formateado (una de las dos
  // formas reales que soporta el código — la otra es un Date, pero un Date creado en
  // este realm de Node no es "instanceof Date" dentro del contexto vm de la celda
  // cargada, así que el string evita ese falso negativo de test sin cambiar lo que
  // se está probando: el emparejamiento fecha+destino+hora).
  const hoja = hojaFake([
    { fecha: '15/09/2026', tipo: 'Expedición', destino: 'LM Marbella', hora: '16:00', secciones: [] }
  ]);
  const { ctx } = cargarConMocks({ 'Septiembre 2026': hoja });
  const r = ctx.actualizarB2BSIE_('Marbella', '15/09/2026', '17:30', []); // hora no coincide
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Fila no encontrada/);
});

test('actualizarB2BSIE_: éxito — encuentra la fila y suma el conteo por sección a lo que ya había', () => {
  const hoja = hojaFake([
    { fecha: '15/09/2026', tipo: 'Expedición', destino: 'LM Marbella', hora: '16:00', secciones: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
  ]);
  const { ctx } = cargarConMocks({ 'Septiembre 2026': hoja });
  const paletsCotejados = [
    { encontrado: true, seccion: 'CARPINTERIA Y MADERA', codSeccion: '1' },
    { encontrado: true, seccion: 'CARPINTERIA Y MADERA', codSeccion: '1' },
    { encontrado: false, seccion: 'NO ENCONTRADO EN INVENTARIO', codSeccion: '' },
    { encontrado: true, seccion: 'SANITARIO', codSeccion: '3' }
  ];
  const r = ctx.actualizarB2BSIE_('Marbella', '15/09/2026', '16:00', paletsCotejados);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(hoja._datos[0][14], 7); // Sección 1: 5 ya había + 2 nuevos encontrados
  assert.strictEqual(hoja._datos[0][16], 1); // Sección 3: 0 + 1
});

test('actualizarB2BSIE_: un palet con NOMBRE de sección pero sin codSeccion no cuenta (bug real 2026-09-24 — el inventario cambió a dar nombres de departamento, "CARPINTERIA Y MADERA", y el número real viaja aparte en Cod_Seccion/codSeccion, no dentro del nombre)', () => {
  const hoja = hojaFake([
    { fecha: '15/09/2026', tipo: 'Expedición', destino: 'LM Mijas', hora: '6:30', secciones: [] }
  ]);
  const { ctx } = cargarConMocks({ 'Septiembre 2026': hoja });
  const r = ctx.actualizarB2BSIE_('Mijas', '15/09/2026', '6:30', [
    { encontrado: true, seccion: 'CARPINTERIA Y MADERA' } // sin codSeccion -> no cuenta en ninguna sección
  ]);
  assert.strictEqual(r.ok, true);
  assert.match(r.aviso, /1 palets SIE/);
  assert.deepStrictEqual(hoja._datos[0].slice(14, 27), new Array(13).fill(0));
});

test('actualizarB2BSIE_: {ok:true, aviso} si hubo palets pero ninguno se sumó a ninguna sección (bug real 2026-09-24: antes {ok:true} sin más, sin aviso)', () => {
  const hoja = hojaFake([
    { fecha: '15/09/2026', tipo: 'Expedición', destino: 'LM Marbella', hora: '16:00', secciones: [] }
  ]);
  const { ctx } = cargarConMocks({ 'Septiembre 2026': hoja });
  const paletsCotejados = [
    { encontrado: false, seccion: 'NO ENCONTRADO EN INVENTARIO', codSeccion: '' },
    { encontrado: true, seccion: 'Departamento raro', codSeccion: 'N/A' } // sin dígito -> no cuenta
  ];
  const r = ctx.actualizarB2BSIE_('Marbella', '15/09/2026', '16:00', paletsCotejados);
  assert.strictEqual(r.ok, true);
  assert.match(r.aviso, /2 palets SIE/);
  assert.match(r.aviso, /LM Marbella/);
  assert.deepStrictEqual(hoja._datos[0].slice(14, 27), new Array(13).fill(0)); // nada escrito de verdad
});

test('actualizarB2BSIE_: sin aviso si al menos un palet sí se sumó a una sección', () => {
  const hoja = hojaFake([
    { fecha: '15/09/2026', tipo: 'Expedición', destino: 'LM Marbella', hora: '16:00', secciones: [] }
  ]);
  const { ctx } = cargarConMocks({ 'Septiembre 2026': hoja });
  const r = ctx.actualizarB2BSIE_('Marbella', '15/09/2026', '16:00', [{ encontrado: true, seccion: 'PINTURA-DROGUERIA', codSeccion: '2' }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.aviso, undefined);
});

test('actualizarB2BSIE_: una excepción interna se captura y se devuelve como {ok:false, error}, no se propaga', () => {
  const ctx = (function () {
    const c = { console: console, Logger: { log: function () {} } };
    c.SpreadsheetApp = { openById: function () { throw new Error('Sin permiso al Sheet'); } };
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'IntegracionB2B.gs'), 'utf8'), c, { filename: 'IntegracionB2B.gs' });
    return c;
  })();
  const r = ctx.actualizarB2BSIE_('Marbella', '15/09/2026', '16:00', []);
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Sin permiso al Sheet/);
});
