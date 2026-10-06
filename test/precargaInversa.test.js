const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargar(extra) {
  const ctx = Object.assign({}, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PrecargaInversa.gs'), 'utf8'), ctx);
  return ctx;
}

// Los objetos creados dentro del .gs cargado por vm viven en otro realm: deepStrictEqual los
// trata como distintos aunque el contenido sea idéntico. El viaje por JSON los trae al local.
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

const CATALOGO = [
  { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' },
  { id: 'S02', nombre: 'PALETINA', tipo: 'Palet' },
  { id: 'S16', nombre: 'JAULA', tipo: 'Jaula Completa' }
];

test('validarIdTorreInversa_: acepta INV- con 6 o más dígitos, normaliza y rechaza el resto', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.validarIdTorreInversa_(' inv-000123 '), 'INV-000123');
  assert.strictEqual(ctx.validarIdTorreInversa_('INV-1234567'), 'INV-1234567');
  ['', null, undefined, 'HODOS-000123', 'INV-123', 'INV-12345A', '00184000227900315462'].forEach((malo) => {
    assert.throws(() => ctx.validarIdTorreInversa_(malo), /Código de torre no válido/, String(malo));
  });
});

test('parsearCatalogoSoportes_: salta la cabecera, recorta, excluye piezas sueltas y repetidos', () => {
  const ctx = cargar();
  const filas = [
    ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
    [' S01 ', ' EUROPEO ', 'x', '1.440', 'Palet'],
    ['S17', 'SVR (Completo)', 'x', '2.667', 'Jaula Completa'],
    ['S17_L', 'SVR_LAT (Lateral)', 'x', '1.310', 'Pieza Suelta'],
    ['S19_LSVP_LAT_DO', 'basura', '', '', ''],
    ['', 'sin id', '', '', 'Palet'],
    ['S01', 'EUROPEO repetido', '', '', 'Palet'],
    ['S99', '', '', '', '']
  ];
  assert.deepStrictEqual(aLocal(ctx.parsearCatalogoSoportes_(filas)), [
    { id: 'S01', nombre: 'EUROPEO', tipo: 'Palet', fotoId: '' },
    { id: 'S17', nombre: 'SVR (Completo)', tipo: 'Jaula Completa', fotoId: '' },
    { id: 'S99', nombre: 'S99', tipo: 'Otros', fotoId: '' }
  ]);
});

test('normalizarLineasTorre_: suma repetidos, ignora vacíos/cero/negativos y usa el nombre del catálogo', () => {
  const ctx = cargar();
  const r = ctx.normalizarLineasTorre_([
    { id: 'S01', cantidad: '5', nombre: 'LO QUE MANDE EL CLIENTE' },
    { id: 'S16', cantidad: 5 },
    { id: 'S02', cantidad: '' },
    { id: 'S02', cantidad: 0 },
    { id: 'S02', cantidad: -3 },
    { id: 'S01', cantidad: 2 }
  ], CATALOGO);
  assert.deepStrictEqual(aLocal(r), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 7 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
});

test('normalizarLineasTorre_: cantidad no entera es un error, no se redondea', () => {
  const ctx = cargar();
  [2.5, 'abc', '1,5'].forEach((mala) => {
    assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S01', cantidad: mala }], CATALOGO), /Cantidad no válida/, String(mala));
  });
});

test('normalizarLineasTorre_: tipo fuera del catálogo es un error', () => {
  const ctx = cargar();
  assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S77', cantidad: 1 }], CATALOGO), /Tipo de soporte desconocido: S77/);
});

test('normalizarLineasTorre_: sin ningún soporte (o sin lista) es un error', () => {
  const ctx = cargar();
  assert.throws(() => ctx.normalizarLineasTorre_([], CATALOGO), /ningún soporte/);
  assert.throws(() => ctx.normalizarLineasTorre_([{ id: 'S01', cantidad: 0 }, { id: 'S02', cantidad: '' }], CATALOGO), /ningún soporte/);
  assert.throws(() => ctx.normalizarLineasTorre_(null, CATALOGO), /Faltan los soportes/);
});

test('totalSoportesTorre_: suma las cantidades', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.totalSoportesTorre_([{ cantidad: 5 }, { cantidad: 12 }]), 17);
  assert.strictEqual(ctx.totalSoportesTorre_([]), 0);
});

test('resumenPorTipoTorres_: agrega por tipo entre todas las torres, ordenado por id', () => {
  const ctx = cargar();
  const torres = [
    { lineas: [{ id: 'S16', nombre: 'JAULA', cantidad: 5 }, { id: 'S01', nombre: 'EUROPEO', cantidad: 5 }] },
    { lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 17 }] }
  ];
  assert.deepStrictEqual(aLocal(ctx.resumenPorTipoTorres_(torres)), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 22 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.deepStrictEqual(aLocal(ctx.resumenPorTipoTorres_([])), []);
});

test('fechaIsoONulo_: devuelve ISO si la fecha es válida y null si no', () => {
  const ctx = cargar();
  assert.strictEqual(ctx.fechaIsoONulo_('2026-10-06T08:15:00Z'), '2026-10-06T08:15:00.000Z');
  assert.strictEqual(ctx.fechaIsoONulo_('no es fecha'), null);
  assert.strictEqual(ctx.fechaIsoONulo_(null), null);
  assert.strictEqual(ctx.fechaIsoONulo_(''), null);
});
