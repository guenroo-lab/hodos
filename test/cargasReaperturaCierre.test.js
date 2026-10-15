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

function contextoPanel(cargas, soportesPorCarga, paletsPorCarga, extra) {
  const consultas = [];
  const ctx = contexto({
    leerCargas_: (f) => { consultas.push({ tabla: 'cargas', filtro: f }); return cargas; },
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

test('listarCargasPanel: pide las abiertas desde ayer y todo lo de hoy en adelante, con recuento de soportes y palets', () => {
  const ctx = contextoPanel(
    [cargaBase({ idCarga: 'A1', estado: 'ABIERTA', cargador: 'Juanlu' })],
    { A1: 10 }, { A1: 3 });
  const r = aLocal(ctx.listarCargasPanel());
  const consulta = ctx._consultas.filter((c) => c.tabla === 'cargas')[0].filtro;
  assert.match(consulta, /or=\(/);
  assert.match(consulta, /estado\.eq\.ABIERTA/);
  assert.match(consulta, /fecha_entrega\.gte\.\d{4}-\d{2}-\d{2}/);
  const conteo = ctx._consultas.filter((c) => c.tabla === 'etiquetas')[0];
  assert.strictEqual(conteo.columnas, 'batea_id', 'solo trae la columna batea_id (egress mínimo)');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].idCarga, 'A1');
  assert.strictEqual(r[0].soportes, 10);
  assert.strictEqual(r[0].palets, 3);
  assert.strictEqual(r[0].cargador, 'Juanlu');
  assert.strictEqual(r[0].estado, 'ABIERTA');
});

test('listarCargasPanel: abiertas primero (por hora de llegada), luego las cerradas que aún se pueden reabrir; las cerradas que ya llegaron no salen', () => {
  const ctx = contextoPanel([
    cargaBase({ idCarga: 'C1', estado: 'CERRADA', horario: '16:00', fechaCierre: '2099-10-14T10:12:00Z' }),
    cargaBase({ idCarga: 'A2', estado: 'ABIERTA', horario: '22:00' }),
    cargaBase({ idCarga: 'C2', estado: 'CERRADA', fechaEntrega: PASADO }),
    cargaBase({ idCarga: 'A1', estado: 'ABIERTA', horario: '17:30' }),
    cargaBase({ idCarga: 'A3', estado: 'ABIERTA', fechaEntrega: PASADO, horario: '6:00' })
  ], {}, {});
  const r = aLocal(ctx.listarCargasPanel());
  assert.deepStrictEqual(r.map((c) => c.idCarga), ['A3', 'A1', 'A2', 'C1']);
  const por = {}; r.forEach((c) => { por[c.idCarga] = c; });
  assert.strictEqual(por.A3.vencida, true, 'abierta cuya hora de llegada ya pasó');
  assert.strictEqual(por.A1.vencida, false);
  assert.strictEqual(por.C1.reabrible, true);
  assert.strictEqual(por.C1.fechaCierre, '2099-10-14T10:12:00Z');
  assert.strictEqual(por.A1.reabrible, false, 'las abiertas no se "reabren"');
  assert.ok(por.A1.llegada, 'cada tarjeta lleva su hora de llegada en ISO');
});

test('listarCargasPanel: marca las que se reabrieron alguna vez', () => {
  const ctx = contextoPanel([cargaBase({ idCarga: 'A1', reabiertaEn: '2099-10-14T09:00:00Z' }), cargaBase({ idCarga: 'A2' })], {}, {});
  const r = aLocal(ctx.listarCargasPanel());
  const por = {}; r.forEach((c) => { por[c.idCarga] = c; });
  assert.strictEqual(por.A1.reabierta, true);
  assert.strictEqual(por.A2.reabierta, false);
});

test('listarCargasPanel: los recuentos se piden por lotes para que la URL no pase de ~2 KB', () => {
  const cargas = [];
  for (let i = 1; i <= 85; i++) cargas.push(cargaBase({ idCarga: 'CARGA-' + String(i).padStart(6, '0') }));
  const ctx = contextoPanel(cargas, {}, {});
  ctx.listarCargasPanel();
  const deEtiquetas = ctx._consultas.filter((c) => c.tabla === 'etiquetas');
  assert.ok(deEtiquetas.length >= 3, 'se reparte en varias peticiones');
  deEtiquetas.forEach((c) => assert.ok(c.filtro.length < 900, 'filtro de ' + c.filtro.length + ' caracteres'));
});

test('listarCargasPanel: sin cargas no pide recuentos', () => {
  const ctx = contextoPanel([], {}, {});
  assert.deepStrictEqual(aLocal(ctx.listarCargasPanel()), []);
  assert.strictEqual(ctx._consultas.filter((c) => c.tabla !== 'cargas').length, 0);
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
