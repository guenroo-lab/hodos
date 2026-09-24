const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGs(nombre, ctxExtra) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = Object.assign({ console }, ctxExtra);
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

function contextoConLeerEtiquetas(filasQueDevuelve) {
  const llamadas = [];
  return {
    ctxExtra: {
      leerEtiquetas_: function (filtro) {
        llamadas.push(filtro);
        return filasQueDevuelve;
      }
    },
    llamadas
  };
}

test('_etiquetaIncpcReciente_ devuelve el idUnico si leerEtiquetas_ encuentra una fila', () => {
  const { ctxExtra } = contextoConLeerEtiquetas([{ idUnico: 'HODOS-001584' }]);
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  assert.strictEqual(ctx._etiquetaIncpcReciente_('514281', 'Granada', 'Roto'), 'HODOS-001584');
});

test('_etiquetaIncpcReciente_ devuelve null si leerEtiquetas_ no encuentra nada', () => {
  const { ctxExtra } = contextoConLeerEtiquetas([]);
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  assert.strictEqual(ctx._etiquetaIncpcReciente_('514281', 'Granada', 'Roto'), null);
});

test('_etiquetaIncpcReciente_ construye el filtro con pedido/destino/tipo/ventana temporal correctos', () => {
  const { ctxExtra, llamadas } = contextoConLeerEtiquetas([]);
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);
  ctx._etiquetaIncpcReciente_('514281', 'Granada', 'Roto');
  assert.strictEqual(llamadas.length, 1);
  const filtro = llamadas[0];
  assert.match(filtro, /origen=eq\.Taisa/);
  assert.match(filtro, /destino=eq\.Granada/);
  assert.match(filtro, /subtipo=eq\.Roto/);
  assert.match(filtro, /numero_pedido=eq\.514281/);
  assert.match(filtro, /fecha_creacion=gte\./);
  assert.match(filtro, /order=fecha_creacion\.desc&limit=1/);
});

test('crearEtiquetaDesdeIncpc_: si ya existe una reciente, NO llama a registrarLote y devuelve el idUnico existente', () => {
  const { ctxExtra } = contextoConLeerEtiquetas([{ idUnico: 'HODOS-001584' }]);
  let registrarLoteLlamado = false;
  ctxExtra.normalizarDestinoIncpc_ = undefined; // se define en el propio archivo, no pisar
  ctxExtra.registrarLote = function () { registrarLoteLlamado = true; return { ids: ['NO-DEBERIA-USARSE'] }; };
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);

  const idUnico = ctx.crearEtiquetaDesdeIncpc_({ destino: 'Granada', pedido: '514281', tipo: 'Roto', operario: 'Luciano' });

  assert.strictEqual(idUnico, 'HODOS-001584');
  assert.strictEqual(registrarLoteLlamado, false);
});

test('crearEtiquetaDesdeIncpc_: si NO existe una reciente, sí llama a registrarLote con normalidad', () => {
  const { ctxExtra } = contextoConLeerEtiquetas([]);
  let datosRegistrarLote = null;
  ctxExtra.registrarLote = function (datos) { datosRegistrarLote = datos; return { ids: ['HODOS-999999'] }; };
  ctxExtra.actualizarEtiquetaCondicional_ = function () {};
  const ctx = cargarGs('IntegracionIncpc.gs', ctxExtra);

  const idUnico = ctx.crearEtiquetaDesdeIncpc_({ destino: 'Granada', pedido: '514281', tipo: 'Roto', operario: 'Luciano' });

  assert.strictEqual(idUnico, 'HODOS-999999');
  assert.ok(datosRegistrarLote, 'registrarLote debería haberse llamado');
  assert.strictEqual(datosRegistrarLote.destino, 'Granada');
  assert.strictEqual(datosRegistrarLote.pedidosTexto, '514281');
  assert.strictEqual(datosRegistrarLote.subtipo, 'Roto');
});
