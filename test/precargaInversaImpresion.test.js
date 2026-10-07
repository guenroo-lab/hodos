// Precarga Inversa: crear torres SIN sacar la etiqueta y imprimirlas después (todas, las que faltan o una selección).
// Cada torre guarda cuándo se imprimió su etiqueta (columna etiqueta_impresa_en, migración aparte): null = sin imprimir.

const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '', 'Palet'],
  ['S02', 'PALETINA', '', '', 'Palet']
];

function cargar(extra) {
  const llamadas = { insertar: [], actualizar: [], get: [] };
  const ctx = Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'ana@taisa.test' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    Utilities: { formatDate: () => '07/10/2026' },
    LOGO_TAISA_B64: 'AAAA',
    code128SVG: () => '<svg></svg>',
    esc_: (s) => String(s),
    envolverEtiquetasHtml_: (tarjetas) => '<html>' + tarjetas + '</html>',
    supaRpc_: () => 'INV-000007',
    supaInsertar_: (tabla, filas) => { llamadas.insertar.push({ tabla: tabla, filas: filas }); return filas.map((f) => Object.assign({ fecha_creacion: '2026-10-07T08:00:00Z' }, f)); },
    supaActualizar_: (tabla, filtro, cambios) => {
      llamadas.actualizar.push({ tabla: tabla, filtro: filtro, cambios: cambios });
      return [{ id_unico: 'INV-000007', lineas: cambios.lineas || [], total_soportes: cambios.total_soportes || 0, creado_por: 'x', fecha_creacion: '2026-10-07T08:00:00Z', etiqueta_impresa_en: cambios.etiqueta_impresa_en }];
    },
    supaGet_: (tabla, filtro) => { llamadas.get.push({ tabla: tabla, filtro: filtro }); return []; }
  }, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(process.env.HODOS_DIR || path.join(__dirname, '..'), 'PrecargaInversa.gs'), 'utf8'), ctx);
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, llamadas: llamadas };
}
const aLocal = (v) => JSON.parse(JSON.stringify(v));
const idsDe = (n, desde) => Array.from({ length: n }, (_, i) => 'INV-' + String((desde || 1) + i).padStart(6, '0'));
const fila = (id, extra) => Object.assign({ id_unico: id, lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 3 }], total_soportes: 3, creado_por: 'a', fecha_creacion: '2026-10-07T07:00:00Z', etiqueta_impresa_en: null }, extra);

test('listarTorresInversa: cada torre dice cuándo se imprimió su etiqueta (null = sin imprimir)', () => {
  const { ctx } = cargar({
    supaGet_: () => [fila('INV-000001'), fila('INV-000002', { etiqueta_impresa_en: '2026-10-07T09:30:00Z' })]
  });
  const r = aLocal(ctx.listarTorresInversa());
  assert.deepStrictEqual(r.torres.map((t) => [t.idUnico, t.impresaEn]), [['INV-000001', null], ['INV-000002', '2026-10-07T09:30:00Z']]);
});

test('una torre nueva nace sin imprimir: crearTorreInversa no manda etiqueta_impresa_en', () => {
  const { ctx, llamadas } = cargar();
  const torre = aLocal(ctx.crearTorreInversa([{ id: 'S01', cantidad: 3 }]));
  assert.ok(!('etiqueta_impresa_en' in llamadas.insertar[0].filas[0]), 'la base la deja en null');
  assert.strictEqual(torre.impresaEn, null);
});

test('actualizarTorreInversa: cambiar el contenido deja la etiqueta vieja desfasada, así que vuelve a «sin imprimir»', () => {
  const { ctx, llamadas } = cargar();
  ctx.actualizarTorreInversa('INV-000007', [{ id: 'S02', cantidad: 4 }]);
  assert.strictEqual(llamadas.actualizar[0].cambios.etiqueta_impresa_en, null);
  assert.ok('etiqueta_impresa_en' in llamadas.actualizar[0].cambios);
});

test('marcarTorresInversaImpresas: pone la fecha de impresión solo a esas torres y devuelve cuántas', () => {
  const { ctx, llamadas } = cargar({
    supaActualizar_: function (tabla, filtro, cambios) { llamadas.actualizar.push({ tabla: tabla, filtro: filtro, cambios: cambios }); return filtro.match(/INV-\d+/g).map((id) => ({ id_unico: id })); }
  });
  const antes = Date.now();
  const r = aLocal(ctx.marcarTorresInversaImpresas(['inv-000002', 'INV-000005', 'INV-000002']));
  assert.deepStrictEqual(r, { marcadas: 2 });
  assert.strictEqual(llamadas.actualizar.length, 1);
  assert.strictEqual(llamadas.actualizar[0].tabla, 'torres_inversa');
  assert.strictEqual(llamadas.actualizar[0].filtro, 'id_unico=in.(INV-000002,INV-000005)');
  const fecha = Date.parse(llamadas.actualizar[0].cambios.etiqueta_impresa_en);
  assert.ok(fecha >= antes - 1000 && fecha <= Date.now() + 1000, 'fecha de ahora en ISO');
  assert.deepStrictEqual(Object.keys(llamadas.actualizar[0].cambios), ['etiqueta_impresa_en'], 'no toca nada más');
});

test('marcarTorresInversaImpresas: trocea en lotes de 30 (la URL de UrlFetchApp no admite más de ~2 KB)', () => {
  const peticiones = [];
  const { ctx } = cargar({
    supaActualizar_: (tabla, filtro) => { peticiones.push(filtro); return filtro.match(/INV-\d+/g).map((id) => ({ id_unico: id })); }
  });
  const r = aLocal(ctx.marcarTorresInversaImpresas(idsDe(75)));
  assert.deepStrictEqual(r, { marcadas: 75 });
  assert.deepStrictEqual(peticiones.map((f) => f.match(/INV-\d+/g).length), [30, 30, 15]);
  peticiones.forEach((f) => assert.ok(f.length < 600, 'cada URL corta'));
});

test('marcarTorresInversaImpresas: ids vacíos, inválidos o demasiados son un error y no tocan la base', () => {
  const { ctx, llamadas } = cargar();
  assert.throws(() => ctx.marcarTorresInversaImpresas([]), /Faltan las torres/);
  assert.throws(() => ctx.marcarTorresInversaImpresas(null), /Faltan las torres/);
  assert.throws(() => ctx.marcarTorresInversaImpresas(['INV-000001', 'HODOS-000001']), /no válido/);
  assert.throws(() => ctx.marcarTorresInversaImpresas(idsDe(201)), /Demasiadas torres/);
  assert.strictEqual(llamadas.actualizar.length, 0);
});

test('htmlEtiquetasTorresInversa: con muchas torres pide en lotes de 30 y saca todas las etiquetas por orden de id', () => {
  const filtros = [];
  const { ctx } = cargar({
    supaGet_: (tabla, filtro) => {
      filtros.push(filtro);
      return filtro.match(/INV-\d+/g).map((id) => fila(id));
    }
  });
  // Se piden desordenadas y con un repetido: salen una sola vez y ordenadas.
  const pedidas = idsDe(45).reverse().concat(['INV-000001']);
  const html = ctx.htmlEtiquetasTorresInversa(pedidas);
  assert.deepStrictEqual(filtros.map((f) => f.match(/INV-\d+/g).length), [30, 15]);
  filtros.forEach((f) => assert.match(f, /^id_unico=in\.\(.*\)&order=id_unico\.asc$/));
  const idsEnHtml = html.match(/id-unico">INV-\d+/g).map((x) => x.slice(-10));
  assert.deepStrictEqual(idsEnHtml, idsDe(45));
});

test('htmlEtiquetasTorresInversa: más de 200 torres de golpe es un error', () => {
  const { ctx } = cargar();
  assert.throws(() => ctx.htmlEtiquetasTorresInversa(idsDe(201)), /Demasiadas torres/);
});

test('devolverTorreInversa (Plataforma «Quitar»): la torre vuelve YA con la etiqueta impresa — la física existe', () => {
  const tabla = [];
  const ctxExtra = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log: () => {} },
    supaInsertar_: (t, filas) => { filas.forEach((f) => tabla.push(f)); return filas; }
  };
  const { ctx } = cargar(ctxExtra);
  const antes = Date.now();
  const r = aLocal(ctx.procesarAccionInversa_({ accion: 'devolverTorreInversa', id: 'INV-000007', lineas: [{ id: 'S01', cantidad: 3 }], creadaEn: '2026-10-07T08:00:00Z' }));
  assert.deepStrictEqual(r, { ok: true, id: 'INV-000007' });
  const impresa = Date.parse(tabla[0].etiqueta_impresa_en);
  assert.ok(impresa >= antes - 1000 && impresa <= Date.now() + 1000, 'marcada como impresa ahora');
});
