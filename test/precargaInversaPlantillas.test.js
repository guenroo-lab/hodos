// Torres predeterminadas de la Precarga Inversa (PrecargaInversa.gs): botones que rellenan el formulario con
// una torre tipo para crearla rápido. Lo importante es que cada plantilla use ids que Plataforma SÍ suma al
// bipar (los del catálogo que HODOS ofrece), no piezas sueltas que la pantalla de Torija no tiene.

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargar(extra) {
  const ctx = Object.assign({}, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(process.env.HODOS_DIR || path.join(__dirname, '..'), 'PrecargaInversa.gs'), 'utf8'), ctx);
  return ctx;
}
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

// Filas reales de CATALOGO_SOPORTES (documento de soportes de Plataforma, 2026-10-07): id, nombre, tipo.
// Incluye las piezas sueltas del SVP/SVR, que el catálogo de HODOS descarta.
const FILAS_REALES = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '1.440', 'Palet'],
  ['S02', 'PALETINA', '', '1.152', 'Palet'],
  ['S05', 'AMERICANO', '', '1.560', 'Palet'],
  ['S17', 'SVR (Completo)', '', '', 'Jaula Completa'],
  ['S17_L', 'SVR_LAT (Lateral)', '', '', 'Pieza Suelta'],
  ['S17_B', 'SVR_BARRA (Barra)', '', '', 'Pieza Suelta'],
  ['S18', 'SVP (Completo)', '', '', 'Jaula Completa'],
  ['S18_L', 'SVP_LAT (Lateral)', '', '', 'Pieza Suelta'],
  ['S18_B', 'SVP_BARRA (Barra)', '', '', 'Pieza Suelta'],
  ['S19', 'SVP_DOBLE (Completo)', '', '', 'Jaula Completa'],
  ['S19_B', 'SVP_BAR_DO (Barra doble)', '', '', 'Pieza Suelta'],
  ['S16', 'JAULA (Jaula Metálica)', '', '', 'Jaula Completa']
];

function catalogoReal(ctx) { return ctx.parsearCatalogoSoportes_(FILAS_REALES); }

test('las tres torres predeterminadas: palet Euro 17, paletinas 17 y SVP (5 completos), por este orden', () => {
  const ctx = cargar();
  const plantillas = aLocal(ctx.torresPredeterminadasInversa_(catalogoReal(ctx)));
  assert.deepStrictEqual(plantillas.map((p) => p.titulo), ['Torre palet Euro', 'Torre paletinas', 'Torre SVP']);
  assert.deepStrictEqual(plantillas.map((p) => p.lineas), [
    [{ id: 'S01', nombre: 'EUROPEO', cantidad: 17 }],
    [{ id: 'S02', nombre: 'PALETINA', cantidad: 17 }],
    [{ id: 'S18', nombre: 'SVP (Completo)', cantidad: 5 }]
  ]);
  assert.deepStrictEqual(plantillas.map((p) => p.total), [17, 17, 5]);
});

test('la torre SVP lleva 5 SVP completos (Plataforma los despieza en 5 palets, 10 laterales y 35 barras) y lo dice en el botón', () => {
  const ctx = cargar();
  const svp = aLocal(ctx.torresPredeterminadasInversa_(catalogoReal(ctx))).filter((p) => p.clave === 'svp-5')[0];
  assert.ok(svp, 'existe la plantilla SVP');
  assert.match(svp.detalle, /5 × SVP \(Completo\)/);
  assert.match(svp.detalle, /5 palets euro/);
  assert.match(svp.detalle, /10 laterales/);
  assert.match(svp.detalle, /35 barras/);
});

test('ninguna plantilla usa una pieza suelta (Plataforma no las suma al bipar: no están en la pantalla de Torija)', () => {
  const ctx = cargar();
  const ids = [].concat.apply([], aLocal(ctx.torresPredeterminadasInversa_(catalogoReal(ctx))).map((p) => p.lineas.map((l) => l.id)));
  const piezasSueltas = ['S17_L', 'S17_B', 'S18_L', 'S18_B', 'S19_B', 'S19_L', 'S19_LSVP_LAT_DO'];
  piezasSueltas.forEach((id) => assert.ok(ids.indexOf(id) === -1, id + ' no puede estar en una plantilla'));
  // Y el catálogo que ve HODOS no las tiene, así que un formulario con casillas no podría rellenarlas.
  const idsCatalogo = catalogoReal(ctx).map((c) => c.id);
  piezasSueltas.forEach((id) => assert.ok(idsCatalogo.indexOf(id) === -1, id + ' no está en el catálogo de HODOS'));
});

test('las líneas de cada plantilla pasan tal cual por normalizarLineasTorre_ (lo que se guarda es lo que se ve)', () => {
  const ctx = cargar();
  const catalogo = catalogoReal(ctx);
  aLocal(ctx.torresPredeterminadasInversa_(catalogo)).forEach((p) => {
    const limpias = aLocal(ctx.normalizarLineasTorre_(p.lineas.map((l) => ({ id: l.id, cantidad: l.cantidad })), catalogo));
    assert.deepStrictEqual(limpias, p.lineas, p.clave);
    assert.strictEqual(p.total, ctx.totalSoportesTorre_(p.lineas), p.clave);
  });
});

test('una plantilla cuyo tipo ya no está en el catálogo no se ofrece (el resto sí)', () => {
  const ctx = cargar();
  const sinSvp = FILAS_REALES.filter((f) => f[0] !== 'S18');
  const plantillas = aLocal(ctx.torresPredeterminadasInversa_(ctx.parsearCatalogoSoportes_(sinSvp)));
  assert.deepStrictEqual(plantillas.map((p) => p.clave), ['euro-17', 'paletina-17']);
  assert.deepStrictEqual(aLocal(ctx.torresPredeterminadasInversa_([])), []);
});

test('el nombre del soporte sale del catálogo (si Plataforma lo renombra, el botón y la etiqueta lo siguen)', () => {
  const ctx = cargar();
  const renombrado = FILAS_REALES.map((f) => (f[0] === 'S02' ? ['S02', 'PALETINA 80x60', '', '', 'Palet'] : f));
  const p = aLocal(ctx.torresPredeterminadasInversa_(ctx.parsearCatalogoSoportes_(renombrado))).filter((x) => x.clave === 'paletina-17')[0];
  assert.strictEqual(p.lineas[0].nombre, 'PALETINA 80x60');
  assert.match(p.detalle, /PALETINA 80x60/);
});

test('claves únicas y datos serializables (viajan por google.script.run)', () => {
  const ctx = cargar();
  const plantillas = aLocal(ctx.torresPredeterminadasInversa_(catalogoReal(ctx)));
  const claves = plantillas.map((p) => p.clave);
  assert.strictEqual(new Set(claves).size, claves.length);
  plantillas.forEach((p) => {
    assert.ok(p.clave && p.titulo && p.detalle && p.lineas.length > 0 && p.total > 0, p.clave);
  });
});

test('obtenerTorresPredeterminadasInversa lee el catálogo real (con su caché) y devuelve las tres', () => {
  const almacen = new Map();
  const ctx = cargar({
    CacheService: { getScriptCache: () => ({ get: (k) => (almacen.has(k) ? almacen.get(k) : null), put: (k, v) => { almacen.set(k, v); } }) }
  });
  ctx.leerFilasCatalogoInversa_ = () => FILAS_REALES;
  const plantillas = aLocal(ctx.obtenerTorresPredeterminadasInversa());
  assert.deepStrictEqual(plantillas.map((p) => p.clave), ['euro-17', 'paletina-17', 'svp-5']);
  assert.strictEqual(almacen.has('catalogo_inversa_v2'), true, 'reutiliza la caché del catálogo');
});
