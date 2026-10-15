const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Segunda parte de las pruebas de cargas (2026-10-15): panel de cargas abiertas, cierre de una carga
// reabierta (informe «ACTUALIZADO» y B2B sin contar dos veces) y los campos nuevos de la tabla `cargas`.
const DIR = process.env.HODOS_DIR || path.join(__dirname, '..');
const aLocal = (v) => JSON.parse(JSON.stringify(v));
const FUTURO = '2099-10-15';
const PASADO = '2000-10-15';

// stubs: se definen ANTES de cargar los .gs; sobrescribir: DESPUÉS (para sustituir funciones que sí
// define algún .gs cargado, p. ej. actualizarB2BSIE_ de IntegracionB2B.gs).
function contexto(stubs, sobrescribir, ficheros) {
  const ctx = Object.assign({
    Logger: { log: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'muelle@x.com' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    CacheService: { getScriptCache: () => ({ put: () => {}, remove: () => {}, get: () => null }) }
  }, stubs);
  vm.createContext(ctx);
  (ficheros || ['Utilidades.gs', 'IntegracionB2B.gs', 'Backend.gs']).forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
  Object.assign(ctx, sobrescribir || {});
  return ctx;
}

function cargaBase(cambios) {
  return Object.assign({
    idCarga: 'CARGA-000100', destino: 'Marbella', fechaEntrega: FUTURO, horario: '22:00', estado: 'ABIERTA',
    cargador: '', fechaCreacion: '2099-10-14T08:00:00.000Z', fechaCierre: null, cerradaPor: null, reabiertaEn: null, reabiertaPor: null, b2bConteo: null
  }, cambios || {});
}

// ───────────────────────── mapeo de la tabla cargas ─────────────────────────

test('EstructuraCargas: lee y escribe los campos nuevos (cargador, reabierta_por, reabierta_en, b2b_conteo)', () => {
  const ctx = contexto({}, null, ['EstructuraCargas.gs']);
  const leida = aLocal(ctx.filaCargaDesdeSupabase_({
    id_carga: 'CARGA-1', destino: 'Marbella', fecha_entrega: FUTURO, horario: '22:00', estado: 'ABIERTA',
    cargador: 'Juanlu, Alberto', reabierta_por: 'a@b.com', reabierta_en: '2099-10-14T09:00:00Z', b2b_conteo: { 1: 2 }
  }));
  assert.strictEqual(leida.cargador, 'Juanlu, Alberto');
  assert.strictEqual(leida.reabiertaPor, 'a@b.com');
  assert.strictEqual(leida.reabiertaEn, '2099-10-14T09:00:00Z');
  assert.deepStrictEqual(leida.b2bConteo, { 1: 2 });

  const escrita = aLocal(ctx.filaCargaHaciaSupabase_({ cargador: 'Juanlu', reabiertaPor: 'a@b.com', reabiertaEn: '2099-10-14T09:00:00Z', b2bConteo: { 1: 2 } }));
  assert.deepStrictEqual(escrita, { cargador: 'Juanlu', reabierta_por: 'a@b.com', reabierta_en: '2099-10-14T09:00:00Z', b2b_conteo: { 1: 2 } });
  assert.deepStrictEqual(aLocal(ctx.filaCargaHaciaSupabase_({ b2bConteo: null })), { b2b_conteo: null }, 'null se puede escribir (borrar); undefined no se manda');
  assert.deepStrictEqual(aLocal(ctx.filaCargaHaciaSupabase_({ estado: 'ABIERTA' })), { estado: 'ABIERTA' });
});

// ───────────────────────── panel de cargas ─────────────────────────
// Tres listas que NO se mezclan: abiertas (arriba), cerradas de hoy y por revisar (cargas sin terminar).

function contextoPanel(cargas, soportesPorCarga, paletsPorCarga, extra) {
  const consultas = [];
  const ctx = contexto({
    leerCargas_: (f, columnas) => { consultas.push({ tabla: 'cargas', filtro: f, columnas: columnas }); return cargas; },
    supaGet_: (tabla, filtro, columnas) => {
      consultas.push({ tabla: tabla, filtro: filtro, columnas: columnas });
      const por = tabla === 'etiquetas' ? soportesPorCarga : paletsPorCarga;
      const ids = /batea_id=in\.\(([^)]*)\)/.exec(filtro)[1].split(',').map(decodeURIComponent);
      const filas = [];
      ids.forEach((id) => { for (let i = 0; i < (por[id] || 0); i++) filas.push({ batea_id: id }); });
      return filas;
    },
    _consultas: consultas
  }, extra);
  return ctx;
}

// Reloj fijo para probar «hoy» y «ya llegó» con datos reales de un momento concreto.
function relojFijo(ms) {
  const Real = Date;
  return class FechaFija extends Real {
    constructor(...a) { if (a.length === 0) super(ms); else super(...a); }
    static now() { return ms; }
  };
}

const ids = (lista) => lista.map((c) => c.idCarga);

test('listarCargasPanel: devuelve tres listas, pide las cargas de los últimos 7 días con solo las columnas del panel y cuenta soportes y palets', () => {
  const ctx = contextoPanel(
    [cargaBase({ idCarga: 'A1', estado: 'ABIERTA', cargador: 'Juanlu' })],
    { A1: 10 }, { A1: 3 });
  const r = aLocal(ctx.listarCargasPanel());
  const consultaCargas = ctx._consultas.filter((c) => c.tabla === 'cargas')[0];
  assert.strictEqual(consultaCargas.filtro, 'fecha_entrega=gte.' + ctx.fechaMadridISO_(Date.now() - 7 * 24 * 3600000));
  assert.strictEqual(consultaCargas.columnas, 'id_carga,destino,fecha_entrega,horario,estado,cargador,fecha_creacion,fecha_cierre,cerrada_por,reabierta_en', 'no baja pdf_url, b2b_conteo ni lo demás (egress)');
  const conteo = ctx._consultas.filter((c) => c.tabla === 'etiquetas')[0];
  assert.strictEqual(conteo.columnas, 'batea_id', 'solo trae la columna batea_id (egress mínimo)');
  assert.deepStrictEqual(Object.keys(r).sort(), ['abiertas', 'cerradas', 'porRevisar']);
  assert.deepStrictEqual(ids(r.abiertas), ['A1']);
  assert.deepStrictEqual([r.cerradas.length, r.porRevisar.length], [0, 0]);
  assert.strictEqual(r.abiertas[0].soportes, 10);
  assert.strictEqual(r.abiertas[0].palets, 3);
  assert.strictEqual(r.abiertas[0].vacia, false);
  assert.strictEqual(r.abiertas[0].cargador, 'Juanlu');
  assert.strictEqual(r.abiertas[0].estado, 'ABIERTA');
  assert.ok(r.abiertas[0].llegada, 'cada carga lleva su hora de llegada en ISO');
});

test('listarCargasPanel: las abiertas salen por hora de llegada y las cerradas aparte, primero las que aún se pueden reabrir', () => {
  const hoy = contextoPanel([], {}, {}).fechaMadridISO_(Date.now());
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'C1', estado: 'CERRADA', horario: '16:00', fechaCierre: '2099-10-14T10:12:00Z', cerradaPor: 'a@b.com' }),
    cargaBase({ idCarga: 'A2', estado: 'ABIERTA', horario: '22:00' }),
    cargaBase({ idCarga: 'CLLEGO', estado: 'CERRADA', fechaEntrega: hoy, horario: '00:00' }),
    cargaBase({ idCarga: 'A1', estado: 'ABIERTA', horario: '17:30' }),
    cargaBase({ idCarga: 'C0', estado: 'CERRADA', horario: '6:00' })
  ], {}, {});
  const r = aLocal(ctx.listarCargasPanel());
  assert.deepStrictEqual(ids(r.abiertas), ['A1', 'A2']);
  assert.deepStrictEqual(ids(r.cerradas), ['C0', 'C1', 'CLLEGO'], 'reabribles por hora de llegada y, al final, la que ya llegó');
  const por = {}; r.cerradas.forEach((c) => { por[c.idCarga] = c; });
  assert.strictEqual(por.C1.reabrible, true);
  assert.strictEqual(por.C1.yaLlego, false);
  assert.strictEqual(por.C1.fechaCierre, '2099-10-14T10:12:00Z');
  assert.strictEqual(por.C1.cerradaPor, 'a@b.com');
  assert.strictEqual(por.CLLEGO.reabrible, false, 'ya llegó: solo consulta');
  assert.strictEqual(por.CLLEGO.yaLlego, true);
});

test('listarCargasPanel: las cerradas de días anteriores no salen; las de hoy y las futuras sí', () => {
  const hoy = contextoPanel([], {}, {}).fechaMadridISO_(Date.now());
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'AYER', estado: 'CERRADA', fechaEntrega: PASADO, horario: '19:00' }),
    cargaBase({ idCarga: 'HOY', estado: 'CERRADA', fechaEntrega: hoy, horario: '00:00' }),
    cargaBase({ idCarga: 'FUTURA', estado: 'CERRADA' })
  ], {}, {});
  assert.deepStrictEqual(ids(aLocal(ctx.listarCargasPanel()).cerradas), ['FUTURA', 'HOY'], 'primero la que aún no ha llegado, luego la de hoy que ya llegó');
});

test('listarCargasPanel: una abierta cuyo camión ya llegó NO está arriba: va a «por revisar», con su mercancía para saber si hay que cerrarla o descartarla', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'CON', estado: 'ABIERTA', fechaEntrega: PASADO, horario: '19:00' }),
    cargaBase({ idCarga: 'VACIA', estado: 'ABIERTA', fechaEntrega: PASADO, horario: '6:00' }),
    cargaBase({ idCarga: 'OK', estado: 'ABIERTA', horario: '22:00' })
  ], { CON: 4 }, { CON: 2 });
  const r = aLocal(ctx.listarCargasPanel());
  assert.deepStrictEqual(ids(r.abiertas), ['OK']);
  assert.deepStrictEqual(ids(r.porRevisar), ['VACIA', 'CON'], 'la que llegó antes, primero');
  const por = {}; r.porRevisar.forEach((c) => { por[c.idCarga] = c; });
  assert.strictEqual(por.CON.motivo, 'LLEGO');
  assert.strictEqual(por.CON.vacia, false);
  assert.strictEqual(por.CON.soportes, 4);
  assert.strictEqual(por.CON.palets, 2);
  assert.strictEqual(por.VACIA.motivo, 'LLEGO');
  assert.strictEqual(por.VACIA.vacia, true);
  assert.strictEqual(por.VACIA.principal, '');
});

test('listarCargasPanel: las abiertas repetidas de un camión que ya tiene su carga van a «por revisar» (vacías = REPETIDA, con mercancía = REPETIDA_CON_MERCANCIA)', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'BUENA', estado: 'CERRADA', horario: '19:00', fechaCreacion: '2099-10-14T06:00:00Z' }),
    cargaBase({ idCarga: 'DUP-VACIA', estado: 'ABIERTA', horario: '19:00', fechaCreacion: '2099-10-14T09:00:00Z' }),
    cargaBase({ idCarga: 'PRINCIPAL', estado: 'ABIERTA', horario: '22:00', fechaCreacion: '2099-10-14T10:00:00Z' }),
    cargaBase({ idCarga: 'DUP-CON', estado: 'ABIERTA', horario: '22:00', fechaCreacion: '2099-10-14T08:00:00Z' })
  ], { BUENA: 6, PRINCIPAL: 3, 'DUP-CON': 1 }, {});
  const r = aLocal(ctx.listarCargasPanel());
  assert.deepStrictEqual(ids(r.abiertas), ['PRINCIPAL']);
  assert.deepStrictEqual(ids(r.cerradas), ['BUENA']);
  const por = {}; r.porRevisar.forEach((c) => { por[c.idCarga] = c; });
  assert.deepStrictEqual(Object.keys(por).sort(), ['DUP-CON', 'DUP-VACIA']);
  assert.strictEqual(por['DUP-VACIA'].motivo, 'REPETIDA');
  assert.strictEqual(por['DUP-VACIA'].principal, 'BUENA');
  assert.strictEqual(por['DUP-VACIA'].vacia, true);
  assert.strictEqual(por['DUP-CON'].motivo, 'REPETIDA_CON_MERCANCIA');
  assert.strictEqual(por['DUP-CON'].principal, 'PRINCIPAL');
  assert.strictEqual(por['DUP-CON'].vacia, false);
});

test('listarCargasPanel: las cerradas repetidas y las descartadas no salen en ningún sitio ni obligan a contar', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'A1', estado: 'ABIERTA', horario: '16:00' }),
    cargaBase({ idCarga: 'DESC', estado: 'DESCARTADA', horario: '16:00' }),
    cargaBase({ idCarga: 'C-VIEJA', estado: 'CERRADA', horario: '19:00' }),
    cargaBase({ idCarga: 'C-REP', estado: 'CERRADA', horario: '19:00', fechaCreacion: '2099-10-13T08:00:00Z' })
  ], { 'C-VIEJA': 2 }, {});
  const r = aLocal(ctx.listarCargasPanel());
  assert.deepStrictEqual(ids(r.abiertas), ['A1']);
  assert.deepStrictEqual(ids(r.cerradas), ['C-VIEJA']);
  assert.deepStrictEqual(r.porRevisar, []);
  const contadas = [];
  ctx._consultas.filter((c) => c.tabla === 'etiquetas').forEach((c) => /batea_id=in\.\(([^)]*)\)/.exec(c.filtro)[1].split(',').forEach((id) => contadas.push(id)));
  assert.strictEqual(contadas.indexOf('DESC'), -1, 'una descartada no se cuenta');
});

test('listarCargasPanel: marca las que se reabrieron alguna vez', () => {
  const ctx = contextoPanel([cargaBase({ idCarga: 'A1', reabiertaEn: '2099-10-14T09:00:00Z' }), cargaBase({ idCarga: 'A2', horario: '19:00' })], {}, {});
  const r = aLocal(ctx.listarCargasPanel());
  const por = {}; r.abiertas.forEach((c) => { por[c.idCarga] = c; });
  assert.strictEqual(por.A1.reabierta, true);
  assert.strictEqual(por.A2.reabierta, false);
});

test('listarCargasPanel: entre las cerradas que ya llegaron, la última en llegar va primero', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'L-0600', estado: 'CERRADA', fechaEntrega: '2026-10-15', horario: '6:00' }),
    cargaBase({ idCarga: 'L-0900', estado: 'CERRADA', fechaEntrega: '2026-10-15', horario: '9:00' }),
    cargaBase({ idCarga: 'L-0730', estado: 'CERRADA', fechaEntrega: '2026-10-15', horario: '7:30' })
  ], {}, {}, { Date: relojFijo(Date.UTC(2026, 9, 15, 9, 50)) });
  assert.deepStrictEqual(ids(aLocal(ctx.listarCargasPanel()).cerradas), ['L-0900', 'L-0730', 'L-0600']);
});

test('listarCargasPanel: la fecha de entrega sale siempre como yyyy-MM-dd aunque en la base venga con hora pegada', () => {
  const ctx = contextoPanel([cargaBase({ idCarga: 'A1', fechaEntrega: '2099-10-15T00:00:00.000Z', horario: '22:00' })], {}, {});
  assert.strictEqual(aLocal(ctx.listarCargasPanel()).abiertas[0].fechaEntrega, '2099-10-15');
});

test('listarCargasPanel: los recuentos se piden por lotes para que la URL no pase de ~2 KB', () => {
  const cargas = [];
  for (let i = 1; i <= 85; i++) cargas.push(cargaBase({ idCarga: 'CARGA-' + String(i).padStart(6, '0'), horario: i + ':00' })); // un camión cada una
  const ctx = contextoPanel(cargas, {}, {});
  ctx.listarCargasPanel();
  const deEtiquetas = ctx._consultas.filter((c) => c.tabla === 'etiquetas');
  assert.ok(deEtiquetas.length >= 3, 'se reparte en varias peticiones');
  deEtiquetas.forEach((c) => assert.ok(c.filtro.length < 900, 'filtro de ' + c.filtro.length + ' caracteres'));
});

test('listarCargasPanel: sin cargas devuelve las tres listas vacías y no pide recuentos', () => {
  const ctx = contextoPanel([], {}, {});
  assert.deepStrictEqual(aLocal(ctx.listarCargasPanel()), { abiertas: [], cerradas: [], porRevisar: [] });
  assert.strictEqual(ctx._consultas.filter((c) => c.tabla !== 'cargas').length, 0);
});

test('listarCargasPanel: solo cuenta soportes y palets de lo que se ve y de las cargas repetidas (no de las cerradas de días anteriores)', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'VISTA', estado: 'ABIERTA', horario: '22:00' }),
    cargaBase({ idCarga: 'DE-AYER', estado: 'CERRADA', fechaEntrega: PASADO, horario: '10:00' }),
    cargaBase({ idCarga: 'REP-A', estado: 'CERRADA', horario: '16:00' }),
    cargaBase({ idCarga: 'REP-B', estado: 'ABIERTA', horario: '16:00' })
  ], { VISTA: 1, 'REP-A': 3 }, {});
  ctx.listarCargasPanel();
  const pedidas = [];
  ctx._consultas.filter((c) => c.tabla === 'etiquetas').forEach((c) => {
    /batea_id=in\.\(([^)]*)\)/.exec(c.filtro)[1].split(',').forEach((id) => pedidas.push(decodeURIComponent(id)));
  });
  assert.ok(pedidas.indexOf('VISTA') !== -1);
  assert.ok(pedidas.indexOf('REP-A') !== -1 && pedidas.indexOf('REP-B') !== -1, 'las repetidas se cuentan para decidir');
  assert.strictEqual(pedidas.indexOf('DE-AYER'), -1, 'una cerrada de otro día no se ve: no se cuenta');
});

test('listarCargasPanel: sin cargas repetidas no hace falta decidir y cada carga se cuenta una sola vez', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'A1', horario: '16:00' }), cargaBase({ idCarga: 'A2', horario: '19:00' })
  ], { A1: 2, A2: 5 }, {});
  ctx.listarCargasPanel();
  assert.strictEqual(ctx._consultas.filter((c) => c.tabla === 'etiquetas').length, 1);
  assert.strictEqual(ctx._consultas.filter((c) => c.tabla === 'palets').length, 1);
});

// Caso real del 15/10/2026 a las 11:50 (Madrid), con las cargas que había en ese momento en la base: así se vio el
// lío de la pantalla (abiertas, cerradas y huérfanas mezcladas). Ahora: arriba solo la abierta con mercancía.
test('listarCargasPanel: con las cargas reales del 15/10 a las 11:50, arriba solo lo abierto y las huérfanas van a «por revisar»', () => {
  const f = (n, destino, fecha, horario, estado, creada) => cargaBase({ idCarga: 'CARGA-000' + n, destino, fechaEntrega: fecha, horario, estado, fechaCreacion: creada });
  const cargas = [
    f(639, 'Málaga', '2026-10-15', '23:55', 'CERRADA', '2026-10-15T08:48:00Z'),
    f(638, 'Marbella', '2026-10-15', '22:00', 'ABIERTA', '2026-10-15T08:11:00Z'),
    f(637, 'Marbella', '2026-10-15', '17:30', 'ABIERTA', '2026-10-15T07:49:00Z'),
    f(636, 'Marbella', '2026-10-15', '19:00', 'ABIERTA', '2026-10-15T07:48:00Z'),
    f(635, 'Marbella', '2026-10-15', '22:00', 'CERRADA', '2026-10-15T07:45:00Z'),
    f(634, 'Marbella', '2026-10-15', '16:00', 'CERRADA', '2026-10-15T07:14:00Z'),
    f(633, 'Málaga', '2026-10-15', '18:00', 'CERRADA', '2026-10-15T06:57:00Z'),
    f(632, 'Mijas', '2026-10-16', '6:30', 'CERRADA', '2026-10-15T05:37:00Z'),
    f(631, 'Marbella', '2026-10-15', '19:00', 'CERRADA', '2026-10-15T04:37:00Z'),
    f(630, 'Málaga', '2026-10-15', '6:00', 'ABIERTA', '2026-10-14T17:32:00Z'),
    f(629, 'Granada', '2026-10-14', 'Envío único diario', 'CERRADA', '2026-10-14T15:01:00Z'),
    f(628, 'Marbella', '2026-10-15', '17:30', 'CERRADA', '2026-10-14T13:28:00Z'),
    f(627, 'Marbella', '2026-10-14', '19:00', 'CERRADA', '2026-10-14T10:34:00Z')
  ];
  const soportes = { 'CARGA-000639': 18, 'CARGA-000638': 10, 'CARGA-000633': 3, 'CARGA-000632': 22, 'CARGA-000631': 6, 'CARGA-000629': 19, 'CARGA-000627': 17 };
  const palets = { 'CARGA-000632': 4, 'CARGA-000631': 13, 'CARGA-000628': 16 };
  const ctx = contextoPanel(cargas, soportes, palets, { Date: relojFijo(Date.UTC(2026, 9, 15, 9, 50)) });
  const r = aLocal(ctx.listarCargasPanel());
  const num = (lista) => lista.map((c) => c.idCarga.slice(-3));
  assert.deepStrictEqual(num(r.abiertas), ['638'], 'arriba solo la carga abierta de Marbella 22:00 (10 soportes)');
  assert.deepStrictEqual(num(r.cerradas), ['634', '628', '633', '631', '639', '632'], 'cerradas por hora de llegada; 629 y 627 son de ayer y no salen');
  assert.deepStrictEqual(num(r.porRevisar), ['630', '637', '636'], 'huérfanas: Málaga 6:00 (llegó y sigue abierta) y las repetidas vacías de 17:30 y 19:00');
  const por = {}; r.porRevisar.forEach((c) => { por[c.idCarga.slice(-3)] = c; });
  assert.deepStrictEqual([por['630'].motivo, por['630'].vacia], ['LLEGO', true]);
  assert.deepStrictEqual([por['637'].motivo, por['637'].principal], ['REPETIDA', 'CARGA-000628']);
  assert.deepStrictEqual([por['636'].motivo, por['636'].principal], ['REPETIDA', 'CARGA-000631']);
  const cerr = {}; r.cerradas.forEach((c) => { cerr[c.idCarga.slice(-3)] = c; });
  assert.deepStrictEqual([cerr['631'].soportes, cerr['631'].palets, cerr['631'].reabrible], [6, 13, true]);
  assert.deepStrictEqual([cerr['628'].soportes, cerr['628'].palets], [0, 16]);
  assert.strictEqual(cerr['634'].vacia, true, 'la de las 16:00 quedó vacía tras mover sus soportes a las 22:00');
});

// ───────────────────────── clasificarCargasPanel_ (reparto puro) ─────────────────────────

test('clasificarCargasPanel_: abiertas, cerradas y por revisar; sin contenidos solo cuentan abierta/reciente', () => {
  const ctx = contexto({});
  const ahora = Date.UTC(2026, 9, 15, 9, 50);
  const mk = (idCarga, estado, fechaEntrega, horario, extra) => cargaBase(Object.assign({ idCarga, estado, fechaEntrega, horario }, extra));
  const r = aLocal(ctx.clasificarCargasPanel_([
    mk('A', 'ABIERTA', '2026-10-15', '22:00'),
    mk('LL', 'ABIERTA', '2026-10-15', '06:00'),
    mk('C', 'CERRADA', '2026-10-15', '16:00'),
    mk('CV', 'CERRADA', '2026-10-14', '16:00'),
    mk('D', 'DESCARTADA', '2026-10-15', '16:00')
  ], null, ahora, '2026-10-15'));
  assert.deepStrictEqual(r.abiertas.map((c) => c.idCarga), ['A']);
  assert.deepStrictEqual(r.cerradas.map((c) => c.idCarga), ['C']);
  assert.deepStrictEqual(r.porRevisar.map((x) => [x.carga.idCarga, x.motivo]), [['LL', 'LLEGO']]);
});

test('clasificarCargasPanel_: un camión se reconoce aunque la fecha de entrega venga con hora pegada (datos antiguos)', () => {
  const ctx = contexto({});
  const ahora = Date.UTC(2026, 9, 15, 9, 50);
  const mk = (idCarga, estado, fechaEntrega, extra) => cargaBase(Object.assign({ idCarga, estado, fechaEntrega, horario: '16:00' }, extra));
  const r = aLocal(ctx.clasificarCargasPanel_([
    mk('BUENA', 'CERRADA', '2026-10-15', { fechaCreacion: '2026-10-15T07:00:00Z' }),
    mk('REP', 'ABIERTA', '2026-10-15T00:00:00.000Z', { fechaCreacion: '2026-10-15T08:00:00Z' })
  ], { BUENA: 5 }, ahora, '2026-10-15'));
  assert.deepStrictEqual(r.cerradas.map((c) => c.idCarga), ['BUENA']);
  assert.deepStrictEqual(r.abiertas, []);
  assert.deepStrictEqual(r.porRevisar.map((x) => [x.carga.idCarga, x.motivo, x.principal]), [['REP', 'REPETIDA', 'BUENA']]);
});

// ───────────────────────── descartarCarga ─────────────────────────

function contextoDescartar(carga, opciones) {
  const o = Object.assign({ soportes: [0, 0], palets: [0, 0], patch: () => ({}) }, opciones);
  const eventos = []; const escrituras = []; const lecturas = { etiquetas: 0, palets: 0 };
  const ctx = contexto({
    LockService: { getScriptLock: () => ({ waitLock: () => eventos.push('lock'), releaseLock: () => eventos.push('unlock') }) },
    CacheService: { getScriptCache: () => ({ put: (k) => eventos.push('cache-put:' + k), remove: (k) => eventos.push('cache-remove:' + k), get: () => null }) },
    leerCargas_: () => (carga ? [carga] : []),
    supaGet_: (tabla, filtro) => {
      const veces = o[tabla === 'etiquetas' ? 'soportes' : 'palets'];
      const n = veces[Math.min(lecturas[tabla]++, veces.length - 1)];
      const id = /batea_id=in\.\(([^)]*)\)/.exec(filtro)[1];
      const filas = [];
      for (let i = 0; i < n; i++) filas.push({ batea_id: id });
      return filas;
    },
    actualizarCargaCondicional_: (id, cambios, filtro) => { escrituras.push({ id, cambios, filtro }); return o.patch(id, cambios, filtro, escrituras.length); },
    _eventos: eventos, _escrituras: escrituras
  });
  return ctx;
}

test('descartarCarga: descarta una carga abierta y vacía (PATCH condicionado a ABIERTA), anota quién y cuándo, borra su caché y libera el lock', () => {
  const ctx = contextoDescartar(cargaBase({ idCarga: 'CARGA-000636', estado: 'ABIERTA' }));
  const r = aLocal(ctx.descartarCarga('CARGA-000636'));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000636', descartada: true });
  assert.strictEqual(ctx._escrituras.length, 1);
  const e = ctx._escrituras[0];
  assert.strictEqual(e.id, 'CARGA-000636');
  assert.strictEqual(e.cambios.estado, 'DESCARTADA');
  assert.strictEqual(e.cambios.cerradaPor, 'muelle@x.com');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(e.cambios.fechaCierre));
  assert.match(e.filtro, /estado=eq\.ABIERTA/);
  assert.ok(ctx._eventos.indexOf('cache-remove:carga_CARGA-000636') !== -1, 'ningún escaneo la da por abierta');
  assert.deepStrictEqual(ctx._eventos.filter((x) => x === 'lock' || x === 'unlock'), ['lock', 'unlock']);
});

test('descartarCarga: una carga con soportes o con palets NO se descarta (hay que cerrarla para que salga su informe)', () => {
  const conSoportes = contextoDescartar(cargaBase({ idCarga: 'C1', estado: 'ABIERTA' }), { soportes: [2, 2] });
  assert.throws(() => conSoportes.descartarCarga('C1'), /tiene mercancía.*ciérrala/);
  assert.strictEqual(conSoportes._escrituras.length, 0);
  const conPalets = contextoDescartar(cargaBase({ idCarga: 'C2', estado: 'ABIERTA' }), { palets: [1, 1] });
  assert.throws(() => conPalets.descartarCarga('C2'), /tiene mercancía/);
  assert.strictEqual(conPalets._escrituras.length, 0);
  assert.deepStrictEqual(conPalets._eventos.filter((x) => x === 'lock' || x === 'unlock'), ['lock', 'unlock'], 'el lock se libera aunque falle');
});

test('descartarCarga: solo las abiertas; una cerrada no, una ya descartada no hace nada y una que no existe avisa', () => {
  const cerrada = contextoDescartar(cargaBase({ idCarga: 'C1', estado: 'CERRADA' }));
  assert.throws(() => cerrada.descartarCarga('C1'), /Solo se puede descartar una carga abierta.*CERRADA/);
  assert.strictEqual(cerrada._escrituras.length, 0);
  const yaDescartada = contextoDescartar(cargaBase({ idCarga: 'C2', estado: 'DESCARTADA' }));
  assert.deepStrictEqual(aLocal(yaDescartada.descartarCarga('C2')), { idCarga: 'C2', yaDescartada: true });
  assert.strictEqual(yaDescartada._escrituras.length, 0);
  assert.throws(() => contextoDescartar(null).descartarCarga('NO-EXISTE'), /Carga no encontrada/);
});

test('descartarCarga: si otra ejecución cambió la carga entre leer y escribir, no pisa nada y lo dice', () => {
  const ctx = contextoDescartar(cargaBase({ idCarga: 'C1', estado: 'ABIERTA' }), { patch: () => null });
  assert.throws(() => ctx.descartarCarga('C1'), /cambió mientras tanto/);
  assert.ok(ctx._eventos.indexOf('cache-remove:carga_C1') === -1, 'si no se descartó no se toca el caché');
});

test('descartarCarga: si un escaneo se coló entre contar y descartar, se deshace y la carga vuelve a estar abierta', () => {
  const ctx = contextoDescartar(cargaBase({ idCarga: 'C1', estado: 'ABIERTA' }), { soportes: [0, 1] });
  assert.throws(() => ctx.descartarCarga('C1'), /tiene mercancía/);
  assert.strictEqual(ctx._escrituras.length, 2);
  assert.strictEqual(ctx._escrituras[0].cambios.estado, 'DESCARTADA');
  assert.strictEqual(ctx._escrituras[1].cambios.estado, 'ABIERTA', 'se devuelve a ABIERTA');
  assert.strictEqual(ctx._escrituras[1].cambios.cerradaPor, null);
  assert.strictEqual(ctx._escrituras[1].cambios.fechaCierre, null);
  assert.match(ctx._escrituras[1].filtro, /estado=eq\.DESCARTADA/, 'solo deshace lo que ella misma descartó');
});

test('una carga descartada no cuenta como la carga de su camión: se puede abrir otra', () => {
  let creada = null;
  const ctx = contexto({
    leerCargas_: () => [cargaBase({ idCarga: 'DESC', estado: 'DESCARTADA' })],
    supaRpc_: () => 'CARGA-000900',
    insertarCarga_: (d) => { creada = d; return d; }
  });
  const r = aLocal(ctx.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000900', reutilizada: false });
  assert.strictEqual(creada.estado, 'ABIERTA');
});

test('reabrirCarga: una carga descartada no se puede reabrir', () => {
  const ctx = contexto({ leerCargas_: () => [cargaBase({ idCarga: 'DESC', estado: 'DESCARTADA' })] });
  assert.throws(() => ctx.reabrirCarga('DESC', ['Juanlu']), /no se puede reabrir.*DESCARTADA/);
});

// ───────────────────────── cerrarCarga de una carga reabierta ─────────────────────────

function contextoCierre(cargaLeida, opciones) {
  const o = Object.assign({ palets: [], modoPrueba: false, b2b: () => ({ ok: true, conteo: {} }) }, opciones);
  const enviados = []; const cambiosFinales = []; const llamadasB2B = [];
  const ctx = contexto({
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10), newBlob: () => ({}), base64Decode: () => [] },
    LOGO_TAISA_B64: 'ZmFrZQ==',
    EMAILS_PEDIDO_CLIENTE_TIENDA: { Marbella: ['tienda@x.com'] },
    EMAILS_CARTA_TIENDA: { Marbella: ['carta@x.com'] },
    EMAILS_PEDIDO_CLIENTE_CC: [], EMAILS_CARTA_CC: [],
    unirListasEmail_: (a, b) => (a || []).concat(b || []),
    MailApp: { sendEmail: (m) => enviados.push(m) },
    DriveApp: {
      getRootFolder: () => ({ createFile: () => ({ getAs: () => ({ setName: () => {} }), getId: () => 'f1' }) }),
      getFileById: () => ({ setTrashed: () => {} })
    },
    leerCargas_: () => [cargaLeida],
    leerEtiquetas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => [],
    actualizarCargaCondicional_: () => cargaLeida,
    actualizarCarga_: (id, cambios) => { cambiosFinales.push(cambios); return {}; },
    cotejarPaletesDeCarga_: () => ({ ok: true, datos: o.palets }),
    htmlInformeCarga: () => '<html></html>'
  }, {
    modoPruebaActivo: () => o.modoPrueba,
    actualizarB2BSIE_: (tienda, fecha, horario, palets, previo) => { llamadasB2B.push({ tienda, fecha, horario, palets, previo }); return o.b2b(); }
  });
  ctx._enviados = enviados; ctx._cambiosFinales = cambiosFinales; ctx._llamadasB2B = llamadasB2B;
  return ctx;
}

const CARGA_LEIDA = (c) => cargaBase(Object.assign({ fechaEntrega: '2026-10-15T00:00:00.000Z', horario: '22:00', estado: 'ABIERTA' }, c));

test('cerrarCarga: la primera vez el asunto es el de siempre; tras reabrirla dice «ACTUALIZADO»', () => {
  const primera = contextoCierre(CARGA_LEIDA({}));
  primera.cerrarCarga('CARGA-000100');
  assert.doesNotMatch(primera._enviados[0].subject, /ACTUALIZADO/);
  assert.match(primera._enviados[0].subject, /Informe de carga · Marbella/);

  const reabierta = contextoCierre(CARGA_LEIDA({ reabiertaEn: '2026-10-15T08:30:00.000Z' }));
  reabierta.cerrarCarga('CARGA-000100');
  assert.match(reabierta._enviados[0].subject, /Informe de carga ACTUALIZADO · Marbella/);
});

test('cerrarCarga: al cerrar otra vez solo se aplica al B2B la diferencia con lo ya aplicado, y se guarda lo aplicado', () => {
  const palets = [{ encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }];
  const nuevo = { 1: 2, 2: 0 };
  const ctx = contextoCierre(CARGA_LEIDA({ reabiertaEn: '2026-10-15T08:30:00.000Z', b2bConteo: { 1: 1 } }), { palets: palets, b2b: () => ({ ok: true, conteo: nuevo }) });
  const r = ctx.cerrarCarga('CARGA-000100');
  assert.strictEqual(ctx._llamadasB2B.length, 1);
  assert.deepStrictEqual(aLocal(ctx._llamadasB2B[0].previo), { 1: 1 });
  assert.strictEqual(ctx._llamadasB2B[0].fecha, '15/10/2026');
  assert.strictEqual(ctx._llamadasB2B[0].horario, '22:00');
  const final = ctx._cambiosFinales[ctx._cambiosFinales.length - 1];
  assert.strictEqual(final.emailEnviado, 'SI');
  assert.deepStrictEqual(aLocal(final.b2bConteo), { 1: 2, 2: 0 });
  assert.deepStrictEqual(aLocal(r.avisosSie), []);
});

test('cerrarCarga: si ya no queda ningún palet pero antes se aplicó algo al B2B, se vuelve a escribir para restarlo', () => {
  const ctx = contextoCierre(CARGA_LEIDA({ reabiertaEn: '2026-10-15T08:30:00.000Z', b2bConteo: { 1: 2 } }), { palets: [], b2b: () => ({ ok: true, conteo: { 1: 0 } }) });
  ctx.cerrarCarga('CARGA-000100');
  assert.strictEqual(ctx._llamadasB2B.length, 1);
  assert.deepStrictEqual(aLocal(ctx._llamadasB2B[0].palets), []);
  assert.deepStrictEqual(aLocal(ctx._llamadasB2B[0].previo), { 1: 2 });
  assert.deepStrictEqual(aLocal(ctx._cambiosFinales[ctx._cambiosFinales.length - 1].b2bConteo), { 1: 0 });
});

test('cerrarCarga: sin palets y sin nada aplicado antes no toca el B2B (como siempre)', () => {
  const ctx = contextoCierre(CARGA_LEIDA({}), { palets: [] });
  ctx.cerrarCarga('CARGA-000100');
  assert.strictEqual(ctx._llamadasB2B.length, 0);
  assert.strictEqual('b2bConteo' in ctx._cambiosFinales[ctx._cambiosFinales.length - 1], false);
});

test('cerrarCarga: si la escritura en el B2B falla, avisa y NO cambia lo que se daba por aplicado', () => {
  const palets = [{ encontrado: true, codSeccion: '1' }];
  const ctx = contextoCierre(CARGA_LEIDA({ b2bConteo: { 1: 1 } }), { palets: palets, b2b: () => ({ ok: false, error: 'Hoja "Octubre 2026" no encontrada' }) });
  const r = ctx.cerrarCarga('CARGA-000100');
  assert.strictEqual(r.avisosSie.length, 1);
  assert.match(r.avisosSie[0], /Octubre 2026/);
  const final = ctx._cambiosFinales[ctx._cambiosFinales.length - 1];
  assert.strictEqual('b2bConteo' in final, false);
});

test('cerrarCarga: primera vez con palets SIE aplica todo (sin conteo previo) y lo deja anotado', () => {
  const palets = [{ encontrado: true, codSeccion: '3' }];
  const ctx = contextoCierre(CARGA_LEIDA({}), { palets: palets, b2b: () => ({ ok: true, conteo: { 3: 1 } }) });
  ctx.cerrarCarga('CARGA-000100');
  assert.strictEqual(ctx._llamadasB2B[0].previo, null);
  assert.deepStrictEqual(aLocal(ctx._cambiosFinales[ctx._cambiosFinales.length - 1].b2bConteo), { 3: 1 });
});

// ───────────────────────── obtenerCarga ─────────────────────────

test('obtenerCarga: devuelve también el cargador y si la carga se reabrió', () => {
  const ctx = contexto({
    leerCargas_: () => [cargaBase({ cargador: 'Juanlu, Alberto', reabiertaEn: '2099-10-14T09:00:00Z', reabiertaPor: 'a@b.com' })],
    leerEtiquetas_: () => [], leerContenidoCrudoPorIds_: () => [], leerTodoContenidoCrudo_: () => []
  });
  const c = aLocal(ctx.obtenerCarga('CARGA-000100'));
  assert.strictEqual(c.cargador, 'Juanlu, Alberto');
  assert.strictEqual(c.reabierta, true);
  assert.strictEqual(c.reabiertaEn, '2099-10-14T09:00:00Z');
});
