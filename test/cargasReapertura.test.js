const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Cargas (2026-10-15): cargador obligatorio, reapertura de cargas cerradas sin duplicar el camión
// (destino+fecha+horario) hasta la hora y día de llegada, y panel de cargas abiertas.
// Utilidades.gs + IntegracionB2B.gs + Backend.gs se cargan de verdad (comparten espacio global igual que
// en Apps Script); Supabase, Lock, Cache y Session se sustituyen por stubs en memoria.
const DIR = process.env.HODOS_DIR || path.join(__dirname, '..');
const aLocal = (v) => JSON.parse(JSON.stringify(v));

function contexto(stubs) {
  const eventos = [];
  const ctx = Object.assign({
    Logger: { log: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'muelle@x.com' }) },
    LockService: { getScriptLock: () => ({ waitLock: () => eventos.push('lock'), releaseLock: () => eventos.push('unlock') }) },
    CacheService: { getScriptCache: () => ({ put: (k) => eventos.push('cache-put:' + k), remove: (k) => eventos.push('cache-remove:' + k), get: () => null }) },
    _eventos: eventos
  }, stubs);
  vm.createContext(ctx);
  ['Utilidades.gs', 'IntegracionB2B.gs', 'Backend.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

const FUTURO = '2099-10-15'; // día de llegada que nunca ha pasado
const PASADO = '2000-10-15'; // día de llegada que ya pasó

function cargaBase(cambios) {
  return Object.assign({
    idCarga: 'CARGA-000100', destino: 'Marbella', fechaEntrega: FUTURO, horario: '22:00', estado: 'ABIERTA',
    cargador: '', fechaCreacion: '2099-10-14T08:00:00.000Z', fechaCierre: null, cerradaPor: null, reabiertaEn: null, reabiertaPor: null, b2bConteo: null
  }, cambios || {});
}

// ───────────────────────── Utilidades.gs: hora de llegada ─────────────────────────

test('fechaLlegadaCarga_: hora de Madrid con horario de verano (octubre = UTC+2)', () => {
  const c = contexto({});
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-15', '22:00'), Date.UTC(2026, 9, 15, 20, 0));
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-15', '6:00'), Date.UTC(2026, 9, 15, 4, 0), 'admite horas de una cifra (6:00)');
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-24', '23:55'), Date.UTC(2026, 9, 24, 21, 55));
});

test('fechaLlegadaCarga_: horario de invierno (UTC+1) y los dos cambios de hora', () => {
  const c = contexto({});
  assert.strictEqual(c.fechaLlegadaCarga_('2026-12-15', '16:00'), Date.UTC(2026, 11, 15, 15, 0));
  assert.strictEqual(c.fechaLlegadaCarga_('2026-03-28', '10:00'), Date.UTC(2026, 2, 28, 9, 0), 'víspera del cambio de marzo: UTC+1');
  assert.strictEqual(c.fechaLlegadaCarga_('2026-03-29', '10:00'), Date.UTC(2026, 2, 29, 8, 0), 'día del cambio de marzo, ya UTC+2');
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-24', '10:00'), Date.UTC(2026, 9, 24, 8, 0), 'víspera del cambio de octubre: UTC+2');
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-25', '10:00'), Date.UTC(2026, 9, 25, 9, 0), 'día del cambio de octubre, ya UTC+1');
});

test('fechaLlegadaCarga_: sin hora concreta («Envío único diario», Granada) cuenta hasta el final de ese día; fecha rara -> null', () => {
  const c = contexto({});
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-15', 'Envío único diario'), Date.UTC(2026, 9, 15, 21, 59));
  assert.strictEqual(c.fechaLlegadaCarga_('2026-10-15T00:00:00.000Z', '22:00'), Date.UTC(2026, 9, 15, 20, 0), 'acepta la fecha en ISO completo');
  assert.strictEqual(c.fechaLlegadaCarga_('', '22:00'), null);
  assert.strictEqual(c.fechaLlegadaCarga_('15/10/2026', '22:00'), null);
});

test('cargaModificablePorLlegada_: se puede mientras no se cumpla la hora de llegada, y no desde ese instante', () => {
  const c = contexto({});
  const carga = { fechaEntrega: '2026-10-15', horario: '22:00' };
  const llegada = Date.UTC(2026, 9, 15, 20, 0);
  assert.strictEqual(c.cargaModificablePorLlegada_(carga, llegada - 1), true);
  assert.strictEqual(c.cargaModificablePorLlegada_(carga, llegada), false);
  assert.strictEqual(c.cargaModificablePorLlegada_(carga, llegada + 3600000), false);
  assert.strictEqual(c.cargaModificablePorLlegada_({ fechaEntrega: 'rara', horario: '22:00' }, 0), false, 'sin fecha válida se bloquea (lado seguro)');
});

// ───────────────────────── Utilidades.gs: cargadores ─────────────────────────

test('validarCargadores_: acepta 1 o 2 personas de la lista (array o texto), sin repetir y recortando espacios', () => {
  const c = contexto({});
  assert.deepStrictEqual(aLocal(c.validarCargadores_(['Manuel Rosas'])), ['Manuel Rosas']);
  assert.deepStrictEqual(aLocal(c.validarCargadores_(' Juanlu , Alberto ')), ['Juanlu', 'Alberto']);
  assert.deepStrictEqual(aLocal(c.validarCargadores_(['Juanlu', 'Juanlu'])), ['Juanlu']);
  assert.deepStrictEqual(aLocal(c.validarCargadores_(['Rafa Perez'])), ['Rafa Perez'], 'también los auxiliares de Cargas/Descargas');
});

test('validarCargadores_: rechaza vacío, desconocidos y más de 2', () => {
  const c = contexto({});
  assert.throws(() => c.validarCargadores_([]), /Indica quién carga/);
  assert.throws(() => c.validarCargadores_(undefined), /Indica quién carga/);
  assert.throws(() => c.validarCargadores_(['  ']), /Indica quién carga/);
  assert.throws(() => c.validarCargadores_(['Pepito Grillo']), /no está en la lista.*Pepito Grillo/);
  assert.throws(() => c.validarCargadores_(['Juanlu', 'Alberto', 'Sebas']), /Máximo 2/);
});

test('la lista de cargadores es la de Cargas/Descargas (4 principales + 26 auxiliares, sin repetidos)', () => {
  const c = contexto({});
  assert.strictEqual(c.CARGADORES_PRINCIPALES_.length, 4);
  assert.strictEqual(c.CARGADORES_AUXILIARES_.length, 26);
  const todos = c.CARGADORES_PRINCIPALES_.concat(c.CARGADORES_AUXILIARES_);
  assert.strictEqual(new Set(todos).size, 30);
});

test('la lista de cargadores coincide con la del proyecto Cargas/Descargas (si está en este equipo)', (t) => {
  const origen = process.env.CARGAS_DESCARGAS_SRC || 'C:\\Users\\30081048\\Desktop\\Proyectos\\proyecto_cargas\\src\\CargasDescargas.gs';
  if (!fs.existsSync(origen)) { t.skip('no está el proyecto Cargas/Descargas en este equipo'); return; }
  const fuente = fs.readFileSync(origen, 'utf8');
  const sacar = (nombre) => {
    const m = new RegExp('const ' + nombre + ' = \\[([\\s\\S]*?)\\];').exec(fuente);
    assert.ok(m, 'no se encuentra ' + nombre + ' en CargasDescargas.gs');
    return Array.from(m[1].matchAll(/'([^']+)'/g)).map((x) => x[1]);
  };
  const c = contexto({});
  assert.deepStrictEqual(aLocal(c.CARGADORES_PRINCIPALES_), sacar('OPERARIOS_CARGAS'), 'principales distintos de OPERARIOS_CARGAS: actualizar Utilidades.gs');
  assert.deepStrictEqual(aLocal(c.CARGADORES_AUXILIARES_), sacar('CARGADORES_AUX'), 'auxiliares distintos de CARGADORES_AUX: actualizar Utilidades.gs');
});

test('obtenerCargadores: sirve a la pantalla las listas (copias, no las originales) y el máximo por carga', () => {
  const c = contexto({});
  vm.runInContext(fs.readFileSync(path.join(DIR, 'ConfigEntregas.gs'), 'utf8'), c, { filename: 'ConfigEntregas.gs' });
  const r = aLocal(c.obtenerCargadores());
  assert.deepStrictEqual(r.principales, aLocal(c.CARGADORES_PRINCIPALES_));
  assert.deepStrictEqual(r.auxiliares, aLocal(c.CARGADORES_AUXILIARES_));
  assert.strictEqual(r.max, 2);
  c.obtenerCargadores().principales.push('Intruso');
  assert.strictEqual(c.CARGADORES_PRINCIPALES_.length, 4, 'modificar lo que recibe la pantalla no cambia la lista del servidor');
});

test('unirCargadores_: añade los nuevos a los ya anotados sin repetir y respetando el orden', () => {
  const c = contexto({});
  assert.strictEqual(c.unirCargadores_('', ['Juanlu']), 'Juanlu');
  assert.strictEqual(c.unirCargadores_(null, ['Juanlu', 'Alberto']), 'Juanlu, Alberto');
  assert.strictEqual(c.unirCargadores_('Juanlu, Alberto', ['Alberto', 'Sebas']), 'Juanlu, Alberto, Sebas');
});

test('elegirCargaExistente_: manda la abierta más reciente; si no hay abierta, la cerrada más reciente; sin cargas, null', () => {
  const c = contexto({});
  const a1 = cargaBase({ idCarga: 'A1', estado: 'ABIERTA', fechaCreacion: '2099-10-14T08:00:00Z' });
  const a2 = cargaBase({ idCarga: 'A2', estado: 'ABIERTA', fechaCreacion: '2099-10-14T09:00:00Z' });
  const c1 = cargaBase({ idCarga: 'C1', estado: 'CERRADA', fechaCreacion: '2099-10-14T07:00:00Z' });
  const c2 = cargaBase({ idCarga: 'C2', estado: 'CERRADA', fechaCreacion: '2099-10-14T10:00:00Z' });
  assert.strictEqual(c.elegirCargaExistente_([c1, a1, c2, a2]).idCarga, 'A2');
  assert.strictEqual(c.elegirCargaExistente_([c1, c2]).idCarga, 'C2');
  assert.strictEqual(c.elegirCargaExistente_([]), null);
});

// ───────────────────────── obtenerOCrearCarga ─────────────────────────

test('obtenerOCrearCarga: sin cargador no hace nada (ni lock ni consulta)', () => {
  let consultas = 0;
  const c = contexto({ leerCargas_: () => { consultas++; return []; } });
  assert.throws(() => c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', []), /Indica quién carga/);
  assert.throws(() => c.obtenerOCrearCarga('Marbella', FUTURO, '22:00'), /Indica quién carga/);
  assert.strictEqual(consultas, 0);
  assert.deepStrictEqual(c._eventos, []);
});

test('obtenerOCrearCarga: busca la terna destino+fecha+horario en cualquier estado (no solo las abiertas)', () => {
  let filtro = null;
  const c = contexto({ leerCargas_: (f) => { filtro = f; return [cargaBase({})]; }, actualizarCarga_: () => ({}) });
  c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']);
  assert.match(filtro, /destino=eq\.Marbella/);
  assert.match(filtro, /fecha_entrega=eq\.2099-10-15/);
  assert.match(filtro, /horario=eq\.22%3A00/);
  assert.doesNotMatch(filtro, /estado=/, 'no filtra por estado: si solo mirara las abiertas se duplicaría el camión');
});

test('obtenerOCrearCarga: carga abierta -> continúa esa misma, anota al cargador y libera el lock', () => {
  let cambios = null;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'ABIERTA', cargador: 'Alberto' })],
    actualizarCarga_: (id, ch) => { cambios = { id: id, ch: ch }; return {}; }
  });
  const r = aLocal(c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000100', reutilizada: true });
  assert.strictEqual(cambios.id, 'CARGA-000100');
  assert.strictEqual(cambios.ch.cargador, 'Alberto, Juanlu');
  assert.deepStrictEqual(c._eventos.filter((e) => e === 'lock' || e === 'unlock'), ['lock', 'unlock']);
});

test('obtenerOCrearCarga: carga abierta cuyo cargador ya figura -> continúa sin escribir nada en la base', () => {
  let escrituras = 0;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'ABIERTA', cargador: 'Alberto, Juanlu' })],
    actualizarCarga_: () => { escrituras++; return {}; }
  });
  const r = aLocal(c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000100', reutilizada: true });
  assert.strictEqual(escrituras, 0);
});

test('obtenerOCrearCarga: carga cerrada que aún no ha llegado -> NO crea otra ni la reabre sola: avisa de que se puede reabrir', () => {
  let creada = false; let tocada = false;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', fechaCierre: '2099-10-14T10:12:00.000Z', cerradaPor: 'a@b.com' })],
    supaRpc_: () => { creada = true; return 'CARGA-X'; }, insertarCarga_: () => { creada = true; return {}; },
    actualizarCarga_: () => { tocada = true; return {}; }, actualizarCargaCondicional_: () => { tocada = true; return {}; }
  });
  const r = aLocal(c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']));
  assert.strictEqual(r.idCarga, 'CARGA-000100');
  assert.strictEqual(r.cerrada, true);
  assert.strictEqual(r.reabrible, true);
  assert.strictEqual(r.destino, 'Marbella');
  assert.strictEqual(r.horario, '22:00');
  assert.strictEqual(r.fechaCierre, '2099-10-14T10:12:00.000Z');
  assert.ok(r.llegada, 'devuelve la hora de llegada para mostrarla');
  assert.strictEqual(creada, false);
  assert.strictEqual(tocada, false);
  assert.deepStrictEqual(c._eventos.filter((e) => e === 'lock' || e === 'unlock'), ['lock', 'unlock']);
});

test('obtenerOCrearCarga: carga cerrada cuya hora de llegada ya pasó -> tampoco crea otra, y dice que no es reabrible', () => {
  let creada = false;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', fechaEntrega: PASADO })],
    supaRpc_: () => { creada = true; return 'CARGA-X'; }, insertarCarga_: () => { creada = true; return {}; }
  });
  const r = aLocal(c.obtenerOCrearCarga('Marbella', PASADO, '22:00', ['Juanlu']));
  assert.strictEqual(r.cerrada, true);
  assert.strictEqual(r.reabrible, false);
  assert.strictEqual(creada, false);
});

test('obtenerOCrearCarga: sin carga para ese camión -> la crea con el cargador', () => {
  let insertada = null;
  const c = contexto({
    leerCargas_: () => [],
    supaRpc_: () => 'CARGA-000200',
    insertarCarga_: (d) => { insertada = d; return d; }
  });
  const r = aLocal(c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu', 'Alberto']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000200', reutilizada: false });
  assert.strictEqual(insertada.destino, 'Marbella');
  assert.strictEqual(insertada.fechaEntrega, FUTURO);
  assert.strictEqual(insertada.horario, '22:00');
  assert.strictEqual(insertada.estado, 'ABIERTA');
  assert.strictEqual(insertada.cargador, 'Juanlu, Alberto');
  assert.ok(c._eventos.indexOf('cache-put:carga_CARGA-000200') !== -1);
});

test('obtenerOCrearCarga: libera el lock aunque falle la consulta', () => {
  const c = contexto({ leerCargas_: () => { throw new Error('Supabase caída'); } });
  assert.throws(() => c.obtenerOCrearCarga('Marbella', FUTURO, '22:00', ['Juanlu']), /Supabase caída/);
  assert.deepStrictEqual(c._eventos.filter((e) => e === 'lock' || e === 'unlock'), ['lock', 'unlock']);
});

test('obtenerOCrearCarga: valida tienda, fecha y horario como siempre', () => {
  const c = contexto({ leerCargas_: () => [] });
  assert.throws(() => c.obtenerOCrearCarga('Sevilla', FUTURO, '22:00', ['Juanlu']), /no es válida/);
  assert.throws(() => c.obtenerOCrearCarga('Marbella', '', '22:00', ['Juanlu']), /fecha/i);
  assert.throws(() => c.obtenerOCrearCarga('Marbella', FUTURO, '', ['Juanlu']), /horario/i);
});

// ───────────────────────── reabrirCarga ─────────────────────────

test('reabrirCarga: reabre una carga cerrada (PATCH condicionado a CERRADA), anota quién y cuándo, y NO toca el caché de «carga abierta»', () => {
  let patch = null;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', cargador: 'Alberto' })],
    leerPaletesPorCarga_: () => [],
    actualizarCargaCondicional_: (id, ch, filtro) => { patch = { id: id, ch: ch, filtro: filtro }; return cargaBase({ estado: 'ABIERTA' }); }
  });
  const r = aLocal(c.reabrirCarga('CARGA-000100', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000100', reabierta: true });
  assert.strictEqual(patch.id, 'CARGA-000100');
  assert.match(patch.filtro, /estado=eq\.CERRADA/);
  assert.strictEqual(patch.ch.estado, 'ABIERTA');
  assert.strictEqual(patch.ch.reabiertaPor, 'muelle@x.com');
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(patch.ch.reabiertaEn));
  assert.strictEqual(patch.ch.cargador, 'Alberto, Juanlu');
  // El caché de «carga abierta» solo lo escribe crearCarga y solo lo borra cerrarCarga (ver cachearCargaAbierta_):
  // un segundo escritor podría dejarlo en ABIERTA tras un cierre simultáneo desde otro móvil.
  assert.deepStrictEqual(c._eventos.filter((e) => e.indexOf('cache-') === 0), [], 'reabrir no repuebla ni borra el caché');
  assert.deepStrictEqual(c._eventos.filter((e) => e === 'lock' || e === 'unlock'), ['lock', 'unlock']);
});

test('reabrirCarga: pasada la hora de llegada NO se puede (ni se escribe nada)', () => {
  let escrito = false;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', fechaEntrega: PASADO })],
    actualizarCargaCondicional_: () => { escrito = true; return {}; }
  });
  assert.throws(() => c.reabrirCarga('CARGA-000100', ['Juanlu']), /ya ha pasado/);
  assert.strictEqual(escrito, false);
});

test('reabrirCarga: exige cargador y una carga que exista', () => {
  const c = contexto({ leerCargas_: () => [] });
  assert.throws(() => c.reabrirCarga('CARGA-000100', []), /Indica quién carga/);
  assert.throws(() => c.reabrirCarga('CARGA-000100', ['Juanlu']), /Carga no encontrada/);
});

test('reabrirCarga: si ya está abierta (doble clic) no escribe nada y lo dice', () => {
  let escrito = false;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'ABIERTA' })],
    actualizarCargaCondicional_: () => { escrito = true; return {}; }
  });
  const r = aLocal(c.reabrirCarga('CARGA-000100', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000100', yaAbierta: true });
  assert.strictEqual(escrito, false);
});

test('reabrirCarga: si otra ejecución cambió la carga entre la lectura y la escritura, no pisa nada', () => {
  const lecturas = [[cargaBase({ estado: 'CERRADA' })], [cargaBase({ estado: 'ABIERTA' })]];
  const c = contexto({
    leerCargas_: () => lecturas.shift(),
    leerPaletesPorCarga_: () => [],
    actualizarCargaCondicional_: () => null
  });
  const r = aLocal(c.reabrirCarga('CARGA-000100', ['Juanlu']));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000100', yaAbierta: true });
});

test('reabrirCarga: guarda lo que ya se aplicó al B2B (palets SIE por sección) si la carga es anterior a esta mejora; si ya lo tenía, no lo toca', () => {
  const palets = [
    { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '1' }, { encontrado: true, codSeccion: '3' }, { encontrado: false, codSeccion: '' }
  ];
  let cambios = null;
  const c = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', b2bConteo: null })],
    leerPaletesPorCarga_: () => palets,
    actualizarCargaCondicional_: (id, ch) => { cambios = ch; return {}; }
  });
  c.reabrirCarga('CARGA-000100', ['Juanlu']);
  assert.strictEqual(cambios.b2bConteo[1], 2);
  assert.strictEqual(cambios.b2bConteo[3], 1);
  assert.strictEqual(cambios.b2bConteo[2], 0);

  const previo = { 1: 9 };
  const c2 = contexto({
    leerCargas_: () => [cargaBase({ estado: 'CERRADA', b2bConteo: previo })],
    leerPaletesPorCarga_: () => palets,
    actualizarCargaCondicional_: (id, ch) => { cambios = ch; return {}; }
  });
  c2.reabrirCarga('CARGA-000100', ['Juanlu']);
  assert.strictEqual(cambios.b2bConteo, undefined, 'no se sobrescribe lo que se aplicó de verdad');
});
