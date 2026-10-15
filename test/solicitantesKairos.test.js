const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// SolicitantesKairos.gs (cruce LDAP/motivo contra el esquema `preparacion` de Kairos) junto
// con SupabaseCliente.gs de verdad, con UrlFetchApp simulado como se comportan PostgREST y
// Apps Script en producción:
//  - dos parámetros `select` en la misma URL => HTTP 400 (bug real 2026-10-15: el cruce de
//    palets refill metía `select=` dentro del filtro y supaGet_ ya antepone el suyo; el
//    try/catch lo disfrazaba de "sin coincidencias" y la columna SOLICITADO POR salía en "—")
//  - URL de más de 2.048 caracteres => UrlFetchApp lanza una excepción. Se mide con el peor
//    caso de percent-encoding (( ) * ! , pasan a 3 caracteres) y con el host real de Supabase.
const DIR = process.env.HODOS_DIR || path.join(__dirname, '..');
const LIMITE_URL = 2048;
const HOST = 'https://dbxlrnupiwemnarlxmcv.supabase.co';

function longitudCodificada(url) {
  return url.replace(/[()*!,]/g, '%XX').length;
}

function cargar(datos) {
  const llamadas = [];
  const ctx = {
    Logger: { log: function () {} },
    PropertiesService: {
      getScriptProperties: function () {
        return { getProperty: function (n) { return ({ SUPABASE_URL: HOST, SUPABASE_SERVICE_KEY: 'k' })[n] || null; } };
      }
    },
    UrlFetchApp: {
      fetch: function (url, opciones) {
        llamadas.push({ url: url, cabeceras: opciones.headers });
        if (longitudCodificada(url) > LIMITE_URL) throw new Error('Exception: URL demasiado larga (' + longitudCodificada(url) + ' caracteres)');
        const u = new URL(url);
        const resp = function (codigo, cuerpo) {
          return { getResponseCode: function () { return codigo; }, getContentText: function () { return JSON.stringify(cuerpo); }, getHeaders: function () { return {}; } };
        };
        if (u.searchParams.getAll('select').length !== 1) return resp(400, { code: 'PGRST100', message: 'parámetro select repetido' });
        if (opciones.headers['Accept-Profile'] !== 'preparacion') return resp(404, { message: 'esquema incorrecto' });
        const tabla = u.pathname.split('/').pop();
        const p = u.searchParams;
        if (tabla === 'lineas') {
          let filas = datos.lineas.slice();
          if (p.get('peticiones.tipo')) filas = filas.filter(function (f) { return 'eq.' + f.peticiones.tipo === p.get('peticiones.tipo'); });
          if (p.get('peticiones.tienda_origen')) filas = filas.filter(function (f) { return 'eq.' + f.peticiones.tienda_origen === p.get('peticiones.tienda_origen'); });
          if (p.get('sscc') === 'not.is.null') filas = filas.filter(function (f) { return f.sscc != null; });
          if (p.get('hodos_id')) {
            const ids = p.get('hodos_id').replace(/^in\.\(/, '').replace(/\)$/, '').split(',');
            filas = filas.filter(function (f) { return ids.indexOf(f.hodos_id) >= 0; });
          }
          if (p.get('or')) {
            const patrones = p.get('or').replace(/^\(/, '').replace(/\)$/, '').split(',').map(function (c) {
              const m = c.match(/^sscc\.ilike\.\*(.*)\*$/);
              return m ? m[1].toLowerCase() : null;
            });
            filas = filas.filter(function (f) { return f.sscc != null && patrones.some(function (pat) { return pat && f.sscc.toLowerCase().indexOf(pat) >= 0; }); });
          }
          return resp(200, filas);
        }
        if (tabla === 'peticiones') {
          const ids = (p.get('id') || '').replace(/^in\.\(/, '').replace(/\)$/, '').split(',');
          return resp(200, datos.peticiones.filter(function (f) { return ids.indexOf(f.id) >= 0; }));
        }
        return resp(404, { message: 'tabla desconocida' });
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DIR, 'SupabaseCliente.gs'), 'utf8'), ctx, { filename: 'SupabaseCliente.gs' });
  vm.runInContext(fs.readFileSync(path.join(DIR, 'SolicitantesKairos.gs'), 'utf8'), ctx, { filename: 'SolicitantesKairos.gs' });
  return { ctx: ctx, llamadas: llamadas };
}

function lineaRefill(sscc, peticionId, tienda, tipo) {
  return { sscc: sscc, hodos_id: null, peticion_id: peticionId, peticiones: { tienda_origen: tienda || '014', tipo: tipo || 'refill' } };
}
function peticion(id, ldap, motivo, tipo) {
  return { id: id, tipo: tipo || 'refill', solicitante_ldap: ldap, motivo: motivo, comentario: null };
}
function sscc20(n) { return '0018400020140' + String(n).padStart(7, '0'); }
function selects(url) { return new URL(url).searchParams.getAll('select').length; }

test('_solicitantesPorSscc_: bug real 2026-10-15 — cada petición lleva UN solo select (con dos, PostgREST da 400 y la columna sale siempre en "—")', () => {
  const { ctx, llamadas } = cargar({
    lineas: [lineaRefill(sscc20(1) + ' (24ud)', 'p1')],
    peticiones: [peticion('p1', '30124787', 'Reposición pasillo 3')]
  });
  const mapa = ctx._solicitantesPorSscc_('Marbella', [sscc20(1)]);
  assert.ok(llamadas.length >= 2, 'hace la consulta de líneas y la de peticiones');
  llamadas.forEach(function (l) { assert.strictEqual(selects(l.url), 1, 'select repetido en ' + l.url); });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapa)), { [sscc20(1)]: { ldap: '30124787', motivo: 'Reposición pasillo 3' } });
});

test('_solicitantesPorSscc_: cruza solo los palets de ESTA carga, también cuando una línea de Kairos trae varios SSCC ("a (3ud) + b (5ud)")', () => {
  const { ctx } = cargar({
    lineas: [
      lineaRefill(sscc20(1) + ' (24ud)', 'p1'),
      lineaRefill(sscc20(9) + ' (10ud) + ' + sscc20(2) + ' (5ud)', 'p2'),
      lineaRefill(sscc20(7) + ' (1ud)', 'p3'), // otro palet que no va en esta carga
      lineaRefill(sscc20(3) + ' (1ud)', 'p4', '279'), // otra tienda
      lineaRefill(sscc20(4) + ' (1ud)', 'p5', '014', 'pedido_cliente') // no es refill
    ],
    peticiones: [peticion('p1', '30124787', 'Reposición'), peticion('p2', '30055555', 'Rotura'), peticion('p3', '30000003', 'otro'), peticion('p4', '30000004', 'otra tienda'), peticion('p5', '30000005', 'no refill', 'pedido_cliente')]
  });
  const mapa = ctx._solicitantesPorSscc_('Marbella', [sscc20(1), sscc20(2), sscc20(3), sscc20(4), sscc20(5)]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapa)), {
    [sscc20(1)]: { ldap: '30124787', motivo: 'Reposición' },
    [sscc20(2)]: { ldap: '30055555', motivo: 'Rotura' }
  });
});

test('_solicitantesPorSscc_: no lee todo el historial de refill de la tienda — la consulta de líneas lleva los SSCC de la carga', () => {
  const { ctx, llamadas } = cargar({
    lineas: [lineaRefill(sscc20(1) + ' (24ud)', 'p1')],
    peticiones: [peticion('p1', '30124787', 'Reposición')]
  });
  ctx._solicitantesPorSscc_('Marbella', [sscc20(1)]);
  const consultaLineas = llamadas.filter(function (l) { return /\/lineas\?/.test(l.url); });
  assert.ok(consultaLineas.length >= 1);
  consultaLineas.forEach(function (l) {
    assert.ok(decodeURIComponent(l.url).indexOf(sscc20(1)) >= 0, 'filtra por el SSCC de la carga: ' + l.url);
  });
});

test('_solicitantesPorSscc_: una carga grande se reparte en varias peticiones y ninguna URL supera el límite de UrlFetchApp', () => {
  const lineas = []; const peticiones = []; const lista = [];
  for (let i = 1; i <= 70; i++) {
    lineas.push(lineaRefill(sscc20(i) + ' (10ud)', '3f2a9c1e-7b4d-4e8a-9c3f-' + String(i).padStart(12, '0')));
    peticiones.push(peticion('3f2a9c1e-7b4d-4e8a-9c3f-' + String(i).padStart(12, '0'), '3000' + String(i).padStart(4, '0'), 'motivo ' + i));
    lista.push(sscc20(i));
  }
  const { ctx, llamadas } = cargar({ lineas: lineas, peticiones: peticiones });
  const mapa = ctx._solicitantesPorSscc_('Marbella', lista);
  assert.strictEqual(Object.keys(mapa).length, 70, 'los 70 palets quedan resueltos');
  assert.strictEqual(mapa[sscc20(70)].ldap, '30000070');
  llamadas.forEach(function (l) { assert.ok(longitudCodificada(l.url) <= LIMITE_URL, 'URL de ' + longitudCodificada(l.url) + ' caracteres'); });
  assert.ok(llamadas.filter(function (l) { return /\/lineas\?/.test(l.url); }).length >= 4, 'las líneas se piden en varios lotes de SSCC');
  assert.ok(llamadas.filter(function (l) { return /\/peticiones\?/.test(l.url); }).length >= 3, 'las peticiones se piden en varios lotes de uuid');
});

test('_solicitantesPorSscc_: Mijas consulta SU tienda (279), no la de Marbella (014)', () => {
  const { ctx, llamadas } = cargar({
    lineas: [lineaRefill(sscc20(1) + ' (24ud)', 'pm', '279'), lineaRefill(sscc20(2) + ' (24ud)', 'pk', '014')],
    peticiones: [peticion('pm', '30000279', 'de Mijas'), peticion('pk', '30000014', 'de Marbella')]
  });
  const mapa = ctx._solicitantesPorSscc_('Mijas', [sscc20(1), sscc20(2)]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(mapa)), { [sscc20(1)]: { ldap: '30000279', motivo: 'de Mijas' } });
  assert.ok(llamadas.some(function (l) { return /tienda_origen=eq\.279/.test(l.url); }));
});

test('_solicitantesPorSscc_: tienda sin Kairos (Málaga) o lista vacía -> {} sin tocar Supabase', () => {
  const { ctx, llamadas } = cargar({ lineas: [], peticiones: [] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx._solicitantesPorSscc_('Málaga', [sscc20(1)]))), {});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx._solicitantesPorSscc_('Marbella', []))), {});
  assert.strictEqual(llamadas.length, 0);
});

test('_solicitantesPorSscc_: si Supabase falla degrada a {} (nunca rompe el cierre de carga)', () => {
  const { ctx } = cargar({ lineas: [], peticiones: [] });
  ctx.UrlFetchApp.fetch = function () { throw new Error('sin red'); };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx._solicitantesPorSscc_('Marbella', [sscc20(1)]))), {});
});

test('_solicitantesPorSscc_: sin coincidencias en Kairos devuelve {} y no pide peticiones', () => {
  const { ctx, llamadas } = cargar({ lineas: [lineaRefill(sscc20(8) + ' (1ud)', 'p8')], peticiones: [peticion('p8', '1', 'x')] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx._solicitantesPorSscc_('Marbella', [sscc20(1)]))), {});
  assert.strictEqual(llamadas.filter(function (l) { return /\/peticiones\?/.test(l.url); }).length, 0);
});

test('_solicitantesPorIdUnico_: pedido cliente/cesión por hodos_id sigue funcionando (un select) y usa el comentario de la petición', () => {
  const { ctx, llamadas } = cargar({
    lineas: [
      { sscc: null, hodos_id: 'HODOS-000010', peticion_id: 'p1', peticiones: { tienda_origen: '014', tipo: 'pedido_cliente' } },
      { sscc: null, hodos_id: 'HODOS-000011', peticion_id: 'p2', peticiones: { tienda_origen: '014', tipo: 'cesion' } }
    ],
    peticiones: [peticion('p1', '30124787', null, 'pedido_cliente'), peticion('p2', '30055555', null, 'cesion')]
  });
  const mapa = ctx._solicitantesPorIdUnico_(['HODOS-000010', 'HODOS-000011', 'HODOS-000099']);
  llamadas.forEach(function (l) { assert.strictEqual(selects(l.url), 1); });
  assert.strictEqual(mapa['HODOS-000010'].ldap, '30124787');
  assert.strictEqual(mapa['HODOS-000011'].ldap, '30055555');
  assert.strictEqual(mapa['HODOS-000099'], undefined);
});

test('_solicitantesPorIdUnico_: muchas peticiones distintas en una carga se leen por lotes (la lista id=in.(uuid,…) no cabe en una URL)', () => {
  const lineas = []; const peticiones = []; const ids = [];
  for (let i = 1; i <= 70; i++) {
    const idU = 'HODOS-' + String(i).padStart(6, '0');
    const uuid = '3f2a9c1e-7b4d-4e8a-9c3f-' + String(i).padStart(12, '0');
    lineas.push({ sscc: null, hodos_id: idU, peticion_id: uuid, peticiones: { tienda_origen: '014', tipo: 'pedido_cliente' } });
    peticiones.push(peticion(uuid, '3000' + String(i).padStart(4, '0'), null, 'pedido_cliente'));
    ids.push(idU);
  }
  const { ctx, llamadas } = cargar({ lineas: lineas, peticiones: peticiones });
  const mapa = ctx._solicitantesPorIdUnico_(ids);
  assert.strictEqual(Object.keys(mapa).length, 70);
  llamadas.forEach(function (l) { assert.ok(l.url.length <= LIMITE_URL, 'URL de ' + l.url.length + ' caracteres'); });
});
