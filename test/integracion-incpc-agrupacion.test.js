const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// vm.createContext crea un realm nuevo — los objetos que devuelve necesitan este
// round-trip antes de deepStrictEqual contra un literal del realm local (ver la misma
// nota en test/supabaseCliente.test.js y test/barcode.test.js).
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

function cargarGs(nombre, ctxExtra) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = Object.assign({ console }, ctxExtra);
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

function contextoConPropiedades(props, respuestaFetch) {
  const llamadas = [];
  return {
    ctxExtra: {
      PropertiesService: {
        getScriptProperties: function () {
          return { getProperty: function (nombre) { return props[nombre] || null; } };
        }
      },
      ScriptApp: { getOAuthToken: function () { return 'fake-oauth-token'; } },
      UrlFetchApp: {
        fetch: function (url, opciones) {
          llamadas.push({ url: url, opciones: opciones });
          if (typeof respuestaFetch === 'function') return respuestaFetch(url, opciones);
          return { getContentText: function () { return JSON.stringify(respuestaFetch); } };
        }
      }
    },
    llamadas
  };
}

test('notificarAgrupacionAIncpc_: sin INCPC_WEBAPP_URL/INCPC_SHARED_TOKEN, no llama a UrlFetchApp', () => {
  const { ctxExtra, llamadas } = contextoConPropiedades({}, { ok: true });
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  const r = ctx.notificarAgrupacionAIncpc_('HODOS-000597', 'HODOS-002961');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /INCPC_WEBAPP_URL|INCPC_SHARED_TOKEN/);
  assert.strictEqual(llamadas.length, 0);
});

test('notificarAgrupacionAIncpc_: éxito — manda accion/idViejo/idNuevo/token en el cuerpo, con cabecera Authorization (INCPC es DOMAIN)', () => {
  const props = { INCPC_WEBAPP_URL: 'https://script.google.com/macros/s/FAKE/exec', INCPC_SHARED_TOKEN: 'secreto-123' };
  const { ctxExtra, llamadas } = contextoConPropiedades(props, { ok: true, actualizado: true });
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  const r = ctx.notificarAgrupacionAIncpc_('HODOS-000597', 'HODOS-002961');

  assert.deepStrictEqual(aRealmLocal(r), { ok: true, actualizado: true });
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].url, props.INCPC_WEBAPP_URL);
  assert.strictEqual(llamadas[0].opciones.method, 'post');
  assert.deepStrictEqual(aRealmLocal(llamadas[0].opciones.headers), { Authorization: 'Bearer fake-oauth-token' });
  const cuerpo = JSON.parse(llamadas[0].opciones.payload);
  assert.deepStrictEqual(cuerpo, {
    accion: 'actualizarIdAgrupacion', idViejo: 'HODOS-000597', idNuevo: 'HODOS-002961', token: 'secreto-123'
  });
});

test('notificarAgrupacionAIncpc_: INCPC responde ok:false -> propaga el motivo, no lanza', () => {
  const props = { INCPC_WEBAPP_URL: 'https://fake', INCPC_SHARED_TOKEN: 'x' };
  const { ctxExtra } = contextoConPropiedades(props, { ok: false, error: 'Token inválido' });
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  const r = ctx.notificarAgrupacionAIncpc_('HODOS-000597', 'HODOS-002961');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, error: 'Token inválido' });
});

test('notificarAgrupacionAIncpc_: UrlFetchApp lanza (red caída) -> se captura, no bloquea al caller', () => {
  const props = { INCPC_WEBAPP_URL: 'https://fake', INCPC_SHARED_TOKEN: 'x' };
  const ctxExtra = {
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (n) { return props[n] || null; } }; } },
    ScriptApp: { getOAuthToken: function () { return 'fake-oauth-token'; } },
    UrlFetchApp: { fetch: function () { throw new Error('Servicio no disponible'); } }
  };
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  const r = ctx.notificarAgrupacionAIncpc_('HODOS-000597', 'HODOS-002961');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Servicio no disponible/);
});

test('notificarAgrupacionAIncpc_: respuesta no es JSON válido -> se captura, no lanza', () => {
  const props = { INCPC_WEBAPP_URL: 'https://fake', INCPC_SHARED_TOKEN: 'x' };
  const ctxExtra = {
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (n) { return props[n] || null; } }; } },
    ScriptApp: { getOAuthToken: function () { return 'fake-oauth-token'; } },
    UrlFetchApp: { fetch: function () { return { getContentText: function () { return '<html>Error 500</html>'; } }; } }
  };
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  const r = ctx.notificarAgrupacionAIncpc_('HODOS-000597', 'HODOS-002961');
  assert.strictEqual(r.ok, false);
});
