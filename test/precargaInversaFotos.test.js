const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ID_A = '1E6x2e3POFTkKeJJLR5xkB9jzS5xXsU5J';
const ID_B = '1dBZIA5TgpjUfwwwY8p2BFTakD1Ohv3W7';
const ID_AJENO = '1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', 'https://drive.google.com/file/d/' + ID_A + '/view?usp=drivesdk', '', 'Palet'],
  ['S02', 'PALETINA', 'https://drive.google.com/open?id=' + ID_B, '', 'Palet'],
  ['S99', 'SIN FOTO', '', '', 'Otros']
];

// Cache en memoria (Map) con getAll/put/get/remove, y Drive simulado.
function cargarFotos(opciones) {
  opciones = opciones || {};
  const almacen = new Map();
  const puestas = [];
  const llamadasDrive = [];
  const cache = {
    get: (k) => (almacen.has(k) ? almacen.get(k) : null),
    getAll: (ks) => { const r = {}; ks.forEach((k) => { if (almacen.has(k)) r[k] = almacen.get(k); }); return r; },
    put: (k, v, seg) => { puestas.push({ clave: k, valor: v, seg: seg }); almacen.set(k, v); },
    remove: (k) => almacen.delete(k)
  };
  const archivos = opciones.archivos || {};
  const ctx = {
    CacheService: { getScriptCache: () => cache },
    Utilities: { base64Encode: (bytes) => Buffer.from(bytes).toString('base64') },
    DriveApp: {
      getFileById: (id) => {
        llamadasDrive.push(id);
        const a = archivos[id];
        if (a === 'ERROR') throw new Error('Sin acceso al archivo');
        return a || { getThumbnail: () => null, getBlob: () => null };
      }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PrecargaInversa.gs'), 'utf8'), ctx);
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, almacen: almacen, puestas: puestas, llamadasDrive: llamadasDrive };
}

const blob = (bytes, tipo) => ({ getBytes: () => bytes, getContentType: () => tipo });
const aLocal = (v) => JSON.parse(JSON.stringify(v));

test('extraerIdDriveFoto_: acepta file/d, open?id y uc?id; el resto da cadena vacía', () => {
  const { ctx } = cargarFotos();
  assert.strictEqual(ctx.extraerIdDriveFoto_('https://drive.google.com/file/d/' + ID_A + '/view?usp=sharing'), ID_A);
  assert.strictEqual(ctx.extraerIdDriveFoto_('https://drive.google.com/open?id=' + ID_B), ID_B);
  assert.strictEqual(ctx.extraerIdDriveFoto_('https://drive.google.com/uc?export=view&id=' + ID_B), ID_B);
  ['', null, undefined, 'x', 'https://ejemplo.com/foto.png', 'https://drive.google.com/file/d/corto/view'].forEach((malo) => {
    assert.strictEqual(ctx.extraerIdDriveFoto_(malo), '', String(malo));
  });
});

test('el catálogo incluye fotoId (vacío si no hay foto) y la caché del catálogo es la v2', () => {
  const { ctx, puestas } = cargarFotos();
  const cat = aLocal(ctx.obtenerCatalogoInversa());
  assert.deepStrictEqual(cat.map((c) => [c.id, c.fotoId]), [['S01', ID_A], ['S02', ID_B], ['S99', '']]);
  assert.strictEqual(puestas[0].clave, 'catalogo_inversa_v2');
});

test('obtenerFotosCatalogoInversa: devuelve data URI de la miniatura y la guarda 6 horas', () => {
  const { ctx, puestas, llamadasDrive } = cargarFotos({ archivos: { [ID_A]: { getThumbnail: () => blob([1, 2, 3], 'image/png'), getBlob: () => { throw new Error('no debe pedir el blob'); } } } });
  const r = aLocal(ctx.obtenerFotosCatalogoInversa([ID_A]));
  assert.deepStrictEqual(r, { [ID_A]: 'data:image/png;base64,AQID' });
  assert.deepStrictEqual(llamadasDrive, [ID_A]);
  const guardada = puestas.find((p) => p.clave === 'foto_inversa_v1_' + ID_A);
  assert.strictEqual(guardada.valor, 'data:image/png;base64,AQID');
  assert.strictEqual(guardada.seg, 21600);
});

test('obtenerFotosCatalogoInversa: con la foto en caché no vuelve a tocar Drive', () => {
  const { ctx, almacen, llamadasDrive } = cargarFotos();
  almacen.set('foto_inversa_v1_' + ID_A, 'data:image/png;base64,AAAA');
  const r = aLocal(ctx.obtenerFotosCatalogoInversa([ID_A]));
  assert.strictEqual(r[ID_A], 'data:image/png;base64,AAAA');
  assert.strictEqual(llamadasDrive.length, 0);
});

test('obtenerFotosCatalogoInversa: un id que NO es del catálogo no se pide a Drive', () => {
  const { ctx, llamadasDrive } = cargarFotos();
  const r = aLocal(ctx.obtenerFotosCatalogoInversa([ID_AJENO, 'no es un id', '../../etc']));
  assert.strictEqual(r[ID_AJENO], null);
  assert.strictEqual(r['no es un id'], null);
  assert.strictEqual(llamadasDrive.length, 0, 'solo se pueden leer las fotos del catálogo');
});

test('obtenerFotosCatalogoInversa: si Drive falla devuelve null, lo recuerda 5 min y no insiste', () => {
  const { ctx, puestas, llamadasDrive } = cargarFotos({ archivos: { [ID_A]: 'ERROR' } });
  assert.strictEqual(ctx.obtenerFotosCatalogoInversa([ID_A])[ID_A], null);
  const marca = puestas.find((p) => p.clave === 'foto_inversa_v1_' + ID_A);
  assert.strictEqual(marca.valor, '-');
  assert.strictEqual(marca.seg, 300);
  ctx.obtenerFotosCatalogoInversa([ID_A]);
  assert.strictEqual(llamadasDrive.length, 1, 'la segunda vez usa la marca de fallo');
});

test('obtenerFotosCatalogoInversa: sin miniatura usa la imagen si no es enorme; si es enorme o no es imagen, null', () => {
  const pequena = { getThumbnail: () => null, getBlob: () => blob([9, 9], 'image/jpeg') };
  const enorme = { getThumbnail: () => blob(new Array(400001).fill(1), 'image/png'), getBlob: () => null };
  const noImagen = { getThumbnail: () => blob([1], 'text/html'), getBlob: () => null };
  const { ctx } = cargarFotos({ archivos: { [ID_A]: pequena, [ID_B]: enorme } });
  assert.strictEqual(ctx.obtenerFotosCatalogoInversa([ID_A])[ID_A], 'data:image/jpeg;base64,CQk=');
  assert.strictEqual(ctx.obtenerFotosCatalogoInversa([ID_B])[ID_B], null);
  const { ctx: ctx2 } = cargarFotos({ archivos: { [ID_A]: noImagen } });
  assert.strictEqual(ctx2.obtenerFotosCatalogoInversa([ID_A])[ID_A], null);
});

// Caso real (2026-10-06): las miniaturas de JAULA (81.786 bytes), R01 (76.453) y R02 (95.663) pasaban de los
// 70 KB que se aceptaban, el servidor las daba por fallidas y en el móvil se quedaban en gris (en el PC salían
// por el enlace directo, que solo funciona con sesión de Google).
test('obtenerFotosCatalogoInversa: una miniatura de 82 KB (la de JAULA) SE ENVÍA, aunque no quepa en la caché', () => {
  const { ctx, puestas, llamadasDrive } = cargarFotos({ archivos: { [ID_A]: { getThumbnail: () => blob(new Array(81786).fill(7), 'image/png'), getBlob: () => null } } });
  const r = ctx.obtenerFotosCatalogoInversa([ID_A]);
  assert.ok(r[ID_A] && r[ID_A].indexOf('data:image/png;base64,') === 0, 'debe llegar el data URI');
  assert.ok(r[ID_A].length > 100000, 'el data URI no cabe en una entrada de caché (100 KB)');
  assert.strictEqual(puestas.filter((p) => p.clave === 'foto_inversa_v1_' + ID_A).length, 0, 'no se guarda ni como foto ni como fallo');
  ctx.obtenerFotosCatalogoInversa([ID_A]);
  assert.strictEqual(llamadasDrive.length, 2, 'al no estar en caché se vuelve a pedir a Drive');
});

test('obtenerFotosCatalogoInversa: lo que cabe en una entrada de caché (~71 KB de imagen) se guarda; lo que no, no', () => {
  // El tope es en caracteres del data URI (95.000, con margen bajo los 102.400 de CacheService): 71.000 bytes
  // dan 94.690 caracteres y 72.000 bytes dan 96.022.
  const cabe = { getThumbnail: () => blob(new Array(71000).fill(3), 'image/png'), getBlob: () => null };
  const noCabe = { getThumbnail: () => blob(new Array(72000).fill(3), 'image/png'), getBlob: () => null };
  const { ctx, puestas } = cargarFotos({ archivos: { [ID_A]: cabe, [ID_B]: noCabe } });
  const r = ctx.obtenerFotosCatalogoInversa([ID_A, ID_B]);
  assert.ok(r[ID_A] && r[ID_B], 'las dos se envían');
  const guardada = puestas.find((p) => p.clave === 'foto_inversa_v1_' + ID_A);
  assert.ok(guardada && guardada.valor === r[ID_A], 'la de 71.000 bytes se guarda');
  assert.ok(guardada.valor.length <= 102400, 'y cabe en una entrada de CacheService');
  assert.strictEqual(puestas.filter((p) => p.clave === 'foto_inversa_v1_' + ID_B).length, 0, 'la de 72.000 bytes no se guarda');
});

test('obtenerFotosCatalogoInversa: entrada inválida o demasiadas fotos de golpe es un error', () => {
  const { ctx } = cargarFotos();
  assert.throws(() => ctx.obtenerFotosCatalogoInversa(null), /Faltan las fotos/);
  assert.throws(() => ctx.obtenerFotosCatalogoInversa(new Array(11).fill(ID_A)), /Demasiadas fotos/);
  assert.doesNotThrow(() => ctx.obtenerFotosCatalogoInversa(new Array(10).fill(ID_A)));
});

test('obtenerFotosCatalogoInversa: pide varias a la vez con getAll y repetidos se piden una sola vez', () => {
  const { ctx, llamadasDrive } = cargarFotos({ archivos: {
    [ID_A]: { getThumbnail: () => blob([1], 'image/png'), getBlob: () => null },
    [ID_B]: { getThumbnail: () => blob([2], 'image/png'), getBlob: () => null }
  } });
  const r = aLocal(ctx.obtenerFotosCatalogoInversa([ID_A, ID_B, ID_A]));
  assert.deepStrictEqual(Object.keys(r).sort(), [ID_A, ID_B].sort());
  assert.deepStrictEqual(llamadasDrive.sort(), [ID_A, ID_B].sort());
});
