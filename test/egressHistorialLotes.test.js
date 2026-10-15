const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Recorte de egress del 2026-10-15: el historial de lotes y los subtipos Taisa los agrupa Postgres
// (RPC historial_lotes / subtipos_taisa_usados, migraciones/2026-10-15-*.sql) en vez de bajar la
// tabla `etiquetas` entera. La equivalencia con el código anterior está en
// herramientas/pruebas-egress-fase2.js (simulador) y herramientas/pruebas-egress-historial-sql.js
// (SQL real); aquí van las piezas pequeñas, sin red.
function contexto(stubs, archivos) {
  const ctx = Object.assign({}, stubs);
  vm.createContext(ctx);
  (archivos || ['Utilidades.gs', 'Backend.gs']).forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  return ctx;
}
const plano = (x) => JSON.parse(JSON.stringify(x));

// `pedidos`: filas {lote_id, numero_pedido} que devolvería la lectura de números de pedido; `lecturas`
// recoge cada lectura de tabla [tabla, filtro, columnas]; `avisos` los Logger.log.
function ctxHistorial(filas, llamadas, pedidos, lecturas, avisos) {
  return contexto({
    supaRpc_: (nombre, params) => { llamadas.push([nombre, plano(params)]); return filas; },
    supaGet_: (tabla, filtro, columnas) => { (lecturas || []).push([tabla, filtro, columnas]); return pedidos || []; },
    leerEtiquetas_: () => { throw new Error('el historial no puede leer las etiquetas enteras'); },
    Logger: { log: (m) => (avisos || []).push(m) }
  });
}

test('obtenerHistorialLotes: pide a Postgres los 10 últimos y mapea los campos tal cual (fecha como texto)', () => {
  const llamadas = [];
  const ctx = ctxHistorial([
    { lote_id: 'L2', cantidad: 3, origen_texto: 'MECO', destino: 'Mijas', fecha_creacion: '2026-10-15T06:34:50.131+00:00' },
    { lote_id: 'L1', cantidad: 1, origen_texto: 'TAISA - DEVOLUCIÓN', destino: 'Málaga', fecha_creacion: new Date('2026-10-14T08:00:00Z') }
  ], llamadas);
  const r = plano(ctx.obtenerHistorialLotes());
  assert.deepStrictEqual(llamadas, [['historial_lotes', { p_limite: 10 }]]);
  assert.deepStrictEqual(r, [
    { loteId: 'L2', cantidad: 3, origenTexto: 'MECO', destino: 'Mijas', fecha: '2026-10-15T06:34:50.131+00:00', pedidos: [] },
    { loteId: 'L1', cantidad: 1, origenTexto: 'TAISA - DEVOLUCIÓN', destino: 'Málaga', fecha: '2026-10-14T08:00:00.000Z', pedidos: [] }
  ]);
  // las claves de siempre y en el mismo orden (lo que lee Index.html), más `pedidos` al final
  assert.deepStrictEqual(Object.keys(r[0]), ['loteId', 'cantidad', 'origenTexto', 'destino', 'fecha', 'pedidos']);
});

const lotes2 = [
  { lote_id: 'L2', cantidad: 4, origen_texto: 'MECO', destino: 'Mijas', fecha_creacion: '2026-10-15T06:00:00+00:00' },
  { lote_id: 'L1', cantidad: 2, origen_texto: 'MECO', destino: 'Málaga', fecha_creacion: '2026-10-14T06:00:00+00:00' }
];

test('obtenerHistorialLotes: cada lote lleva sus números de pedido, en el orden de los soportes y sin repetir', () => {
  const pedidos = [
    { lote_id: 'L1', numero_pedido: '100200' },
    { lote_id: 'L2', numero_pedido: '555' },
    { lote_id: 'L2', numero_pedido: '777' },
    { lote_id: 'L2', numero_pedido: '555' }, // segundo soporte del mismo pedido
    { lote_id: 'L1', numero_pedido: '100300' }
  ];
  const r = plano(ctxHistorial(lotes2, [], pedidos).obtenerHistorialLotes());
  assert.deepStrictEqual(r.map(l => [l.loteId, l.pedidos]), [['L2', ['555', '777']], ['L1', ['100200', '100300']]]);
});

test('obtenerHistorialLotes: un soporte agrupado «a+b+c» aporta cada número por separado (sin espacios ni vacíos)', () => {
  const pedidos = [
    { lote_id: 'L2', numero_pedido: '100+200 + 300+' },
    { lote_id: 'L2', numero_pedido: '200' },
    { lote_id: 'L2', numero_pedido: '400+100' }
  ];
  const r = plano(ctxHistorial(lotes2, [], pedidos).obtenerHistorialLotes());
  assert.deepStrictEqual(r[0].pedidos, ['100', '200', '300', '400']);
  assert.deepStrictEqual(r[1].pedidos, []); // un lote sin filas en la lectura sale con lista vacía
});

test('obtenerHistorialLotes: los números se piden en UNA lectura ligera solo de los lotes que salen, ordenada', () => {
  const lecturas = [];
  ctxHistorial(lotes2, [], [], lecturas).obtenerHistorialLotes();
  assert.deepStrictEqual(lecturas, [['etiquetas', 'lote_id=in.(L2,L1)&order=fecha_creacion.asc,id_unico.asc', 'lote_id,numero_pedido']]);
});

test('obtenerHistorialLotes: con muchos lotes se piden en trozos de 40 (la URL de UrlFetchApp no pasa de 2 KB)', () => {
  const muchos = Array.from({ length: 85 }, (_, i) => ({ lote_id: 'lote-' + i, cantidad: 1, origen_texto: 'X', destino: 'Y', fecha_creacion: '2026-10-15T06:00:00+00:00' }));
  const lecturas = [];
  ctxHistorial(muchos, [], [], lecturas).obtenerHistorialLotes(85);
  const idsPorLectura = lecturas.map(l => /^lote_id=in\.\(([^)]*)\)/.exec(l[1])[1].split(',').length);
  assert.deepStrictEqual(idsPorLectura, [40, 40, 5]);
});

test('obtenerHistorialLotes: los ids de lote se codifican en la URL', () => {
  const lecturas = [];
  ctxHistorial([{ lote_id: 'a b,c)', cantidad: 1, origen_texto: 'X', destino: 'Y', fecha_creacion: '2026-10-15T06:00:00+00:00' }], [], [], lecturas).obtenerHistorialLotes();
  assert.strictEqual(lecturas[0][1].split('&')[0], 'lote_id=in.(a%20b%2Cc))');
});

test('obtenerHistorialLotes: sin lotes no hace ninguna lectura de tabla', () => {
  const lecturas = [];
  assert.deepStrictEqual(plano(ctxHistorial([], [], [], lecturas).obtenerHistorialLotes()), []);
  assert.strictEqual(lecturas.length, 0);
});

test('obtenerHistorialLotes: si falla la lectura de números el historial sale igual (sin números) y se avisa en el registro', () => {
  const avisos = [];
  const ctx = contexto({
    supaRpc_: () => lotes2,
    supaGet_: () => { throw new Error('supaGet_(etiquetas): HTTP 500'); },
    Logger: { log: (m) => avisos.push(m) }
  });
  const r = plano(ctx.obtenerHistorialLotes());
  assert.deepStrictEqual(r.map(l => [l.loteId, l.cantidad, l.pedidos]), [['L2', 4, []], ['L1', 2, []]]);
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0], /AVISO obtenerHistorialLotes.*HTTP 500/);
});

test('obtenerHistorialLotes: sin lotes devuelve []', () => {
  assert.deepStrictEqual(plano(ctxHistorial([], []).obtenerHistorialLotes(5)), []);
});

test('obtenerHistorialLotes: el límite se normaliza (por defecto 10, entero, entre 1 y 1000)', () => {
  const pedido = (valor) => { const ll = []; ctxHistorial([], ll).obtenerHistorialLotes(valor); return ll[0][1].p_limite; };
  assert.strictEqual(pedido(undefined), 10);
  assert.strictEqual(pedido(0), 10);
  assert.strictEqual(pedido(null), 10);
  assert.strictEqual(pedido(3), 3);
  assert.strictEqual(pedido('4'), 4);
  assert.strictEqual(pedido(2.7), 2);
  assert.strictEqual(pedido(1000), 1000);
  // PostgREST corta en 1000 filas sin avisar y supaRpc_ no pagina: el tope evita pedir lo que no llegaría
  assert.strictEqual(pedido(5000), 1000);
  assert.strictEqual(pedido(-3), 1);
  assert.strictEqual(pedido('abc'), 10);
});

test('obtenerHistorialLotes: si la RPC falla, el error sube (no se traga ni se cae a leer la tabla entera)', () => {
  const ctx = contexto({
    supaRpc_: () => { throw new Error('supaRpc_(historial_lotes): function not found'); },
    supaGet_: () => { throw new Error('NO debería leer la tabla'); }
  });
  assert.throws(() => ctx.obtenerHistorialLotes(), /supaRpc_\(historial_lotes\)/);
});

function ctxSubtipos(filas, llamadas) {
  return contexto({
    supaRpc_: (nombre, params) => { llamadas.push([nombre, plano(params)]); return filas; },
    supaGet_: () => { throw new Error('los subtipos ya no pueden leer la tabla'); }
  }, ['EstructuraSheets.gs']);
}

test('obtenerSubtiposConocidos: la lista base y, detrás, los subtipos nuevos en el orden que da Postgres', () => {
  const llamadas = [];
  const ctx = ctxSubtipos([{ subtipo: 'SOBRANTE' }, { subtipo: 'Devolución' }, { subtipo: 'Otros' }, { subtipo: 'ROTO' }], llamadas);
  const r = Array.from(ctx.obtenerSubtiposConocidos());
  assert.deepStrictEqual(llamadas, [['subtipos_taisa_usados', {}]]);
  assert.deepStrictEqual(r, ['Devolución', 'Inventario', 'Demarca', 'Petición Reserva', 'Sobrante', 'Ean Erroneo', 'Anulado', 'Rotura', 'Pedido cliente', 'SOBRANTE', 'Otros', 'ROTO']);
});

test('obtenerSubtiposConocidos: ignora vacíos y repetidos, y distingue mayúsculas de la lista base', () => {
  const ctx = ctxSubtipos([{ subtipo: '' }, { subtipo: null }, { subtipo: 'Otros' }, { subtipo: 'Otros' }, { subtipo: 'Rotura' }, { subtipo: 'ROTURA' }], []);
  const r = Array.from(ctx.obtenerSubtiposConocidos());
  assert.deepStrictEqual(r.slice(9), ['Otros', 'ROTURA']);
  assert.strictEqual(r.length, 11);
});

test('obtenerSubtiposConocidos: sin ningún subtipo usado devuelve solo la lista base', () => {
  assert.strictEqual(Array.from(ctxSubtipos([], []).obtenerSubtiposConocidos()).length, 9);
});
