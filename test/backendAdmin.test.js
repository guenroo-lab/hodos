const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Backend.gs llama a funciones de Utilidades.gs (formatearOrigenTexto, subtipoEfectivo,
// validarTienda, validarCesionEntreTiendas, mensajeCesionInvalida_) y a funciones de
// EstructuraSheets.gs (leerEtiquetas_, actualizarEtiquetaCondicional_,
// borrarEtiquetaPorIdUnico_) — estas últimas se sustituyen aquí por stubs en memoria,
// las de Utilidades.gs se cargan de verdad porque son puras.
function contextoBackend(stubs) {
  const ctx = Object.assign({}, stubs);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Backend.gs'), 'utf8'), ctx);
  return ctx;
}

// htmlEtiquetaUnica también necesita code128SVG (Barcode.gs) y Utilities.formatDate,
// que en producción da Apps Script — aquí se stubea con un formateador simple.
function contextoBackendConBarcode(stubs) {
  const ctx = Object.assign({
    Utilities: { formatDate: function (d) { return d.toISOString().slice(0, 10); } }
  }, stubs);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Utilidades.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Barcode.gs'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Backend.gs'), 'utf8'), ctx);
  return ctx;
}

function filaBase(cambios) {
  return Object.assign({
    idUnico: 'HODOS-000001', numeroPedido: '286676', soporteNum: 1, soporteTotal: 1,
    origen: 'MECO', subtipo: '', origenTienda: '', origenTexto: 'MECO', destino: 'Málaga',
    estado: 'REGISTRADO', bateaId: null
  }, cambios || {});
}

function contextoBackendConSupabase(stubs) {
  return contextoBackend(Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.com' }) },
    Utilities: { getUuid: () => 'uuid-1', formatDate: (d) => d.toISOString().slice(0, 10) },
    siguienteBloqueIdsEtiquetas_: (cantidad) => Array.from({ length: cantidad }, (_, i) => 'HODOS-' + String(i + 1).padStart(6, '0'))
  }, stubs));
}

test('registrarLote: guarda razonFlujo cuando se envía una opción válida', () => {
  let filasInsertadas = null;
  const ctx = contextoBackendConSupabase({
    insertarEtiquetas_: (filas) => { filasInsertadas = filas; return filas; }
  });
  ctx.registrarLote({ pedidosTexto: '111111', origen: 'MECO', destino: 'Málaga', razonFlujo: 'Sobrante' });
  assert.strictEqual(filasInsertadas[0].razonFlujo, 'Sobrante');
});

test('registrarLote: razonFlujo es opcional y nunca viene por defecto', () => {
  let filasInsertadas = null;
  const ctx = contextoBackendConSupabase({
    insertarEtiquetas_: (filas) => { filasInsertadas = filas; return filas; }
  });
  ctx.registrarLote({ pedidosTexto: '111111', origen: 'MECO', destino: 'Málaga' });
  assert.strictEqual(filasInsertadas[0].razonFlujo, '');
});

test('registrarLote: descarta un valor de razonFlujo que no esté en la lista cerrada', () => {
  let filasInsertadas = null;
  const ctx = contextoBackendConSupabase({
    insertarEtiquetas_: (filas) => { filasInsertadas = filas; return filas; }
  });
  ctx.registrarLote({ pedidosTexto: '111111', origen: 'MECO', destino: 'Málaga', razonFlujo: 'Cualquier cosa' });
  assert.strictEqual(filasInsertadas[0].razonFlujo, '');
});

test('registrarLote: razonFlujo no aplica a Taisa, aunque se envíe un valor válido', () => {
  let filasInsertadas = null;
  const ctx = contextoBackendConSupabase({
    insertarEtiquetas_: (filas) => { filasInsertadas = filas; return filas; }
  });
  ctx.registrarLote({ pedidosTexto: '111111', origen: 'Taisa', subtipo: 'Devolución', destino: 'Málaga', razonFlujo: 'Sobrante' });
  assert.strictEqual(filasInsertadas[0].razonFlujo, '');
});

test('buscarEtiquetas: incluye razonFlujo en el resultado', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ razonFlujo: 'Soporte No documentado cargado', fechaCreacion: new Date().toISOString() })],
    leerCargas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => []
  });
  const r = ctx.buscarEtiquetas({});
  assert.strictEqual(r[0].razonFlujo, 'Soporte No documentado cargado');
});

test('buscarEtiquetas: numeroPedido admite búsqueda masiva (varios pedidos, uno por línea)', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [
      filaBase({ idUnico: 'HODOS-A', numeroPedido: '111111', destino: 'Málaga', fechaCreacion: new Date().toISOString() }),
      filaBase({ idUnico: 'HODOS-B', numeroPedido: '222222', destino: 'Málaga', fechaCreacion: new Date().toISOString() }),
      filaBase({ idUnico: 'HODOS-C', numeroPedido: '333333', destino: 'Marbella', fechaCreacion: new Date().toISOString() })
    ],
    leerCargas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => []
  });
  const r = ctx.buscarEtiquetas({ numeroPedido: '111111\n333333\n999999' });
  const ids = r.map((x) => x.idUnico).sort();
  assert.deepStrictEqual(ids, ['HODOS-A', 'HODOS-C']);
});

test('buscarEtiquetas: numeroPedido masivo combinado con destino filtra solo esa tienda', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [
      filaBase({ idUnico: 'HODOS-A', numeroPedido: '111111', destino: 'Málaga', fechaCreacion: new Date().toISOString() }),
      filaBase({ idUnico: 'HODOS-C', numeroPedido: '111111', destino: 'Marbella', fechaCreacion: new Date().toISOString() })
    ],
    leerCargas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => []
  });
  const r = ctx.buscarEtiquetas({ numeroPedido: '111111', destino: 'Málaga' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].idUnico, 'HODOS-A');
});

test('buscarEtiquetas: numeroPedido de un solo valor sigue haciendo match por substring (grupos "a+b")', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [
      filaBase({ idUnico: 'HODOS-D', numeroPedido: '100200+100300', destino: 'Málaga', fechaCreacion: new Date().toISOString() })
    ],
    leerCargas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => []
  });
  const r = ctx.buscarEtiquetas({ numeroPedido: '100300' });
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].idUnico, 'HODOS-D');
});

test('obtenerPendientesPorTienda: incluye razonFlujo en cada pendiente', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ destino: 'Málaga', razonFlujo: 'Sobrante', fechaCreacion: new Date().toISOString() })]
  });
  const r = JSON.parse(JSON.stringify(ctx.obtenerPendientesPorTienda()));
  const malaga = r.find((x) => x.tienda === 'Málaga');
  assert.strictEqual(malaga.pendientes[0].razonFlujo, 'Sobrante');
});

test('actualizarSoporteAdmin: permite fijar razonFlujo aunque el soporte no cambie de origen', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase()],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  ctx.actualizarSoporteAdmin('HODOS-000001', { razonFlujo: 'Sobrante' });
  assert.strictEqual(cambiosEnviados.razonFlujo, 'Sobrante');
});

test('actualizarSoporteAdmin: conserva razonFlujo si no se envía en los cambios', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ razonFlujo: 'Sobrante' })],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '999' });
  assert.strictEqual(cambiosEnviados.razonFlujo, 'Sobrante');
});

test('actualizarSoporteAdmin: al cambiar el origen a Taisa se limpia razonFlujo aunque se envíe un valor válido', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ razonFlujo: 'Sobrante' })],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  ctx.actualizarSoporteAdmin('HODOS-000001', { origen: 'Taisa', subtipo: 'Devolución', razonFlujo: 'Anulado' });
  assert.strictEqual(cambiosEnviados.razonFlujo, '');
});

test('cerrarCarga: bloquea con mensaje combinado si hay pedidos incompletos Y MECO incompleto a la vez', () => {
  const ctx = contextoBackend({
    leerCargas_: () => [{ idCarga: 'CARGA-000001', estado: 'ABIERTA', destino: 'Málaga' }],
    leerEtiquetas_: () => [
      // pedido con 2 soportes (declarado multi-soporte, mismo loteId), solo 1 escaneado
      // en esta carga -> pedido incompleto
      { idUnico: 'HODOS-A', numeroPedido: '111111', origen: 'Valencia', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 2, loteId: 'LOTE-1' },
      { idUnico: 'HODOS-B', numeroPedido: '111111', origen: 'Valencia', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '', soporteTotal: 2, loteId: 'LOTE-1' },
      // MECO: uno escaneado en esta carga, otro de la misma tienda sin escanear
      { idUnico: 'HODOS-C', numeroPedido: '222222', origen: 'MECO', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001' },
      { idUnico: 'HODOS-D', numeroPedido: '333333', origen: 'MECO', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '' }
    ]
  });
  assert.throws(() => ctx.cerrarCarga('CARGA-000001'), (err) => {
    assert.match(err.message, /pedidos incompletos/);
    assert.match(err.message, /origen MECO debe cargarse completo/);
    assert.match(err.message, /HODOS-D/);
    assert.match(err.message, /333333/);
    return true;
  });
});

test('cerrarCarga: bloquea solo por MECO incompleto si los pedidos normales están completos', () => {
  const ctx = contextoBackend({
    leerCargas_: () => [{ idCarga: 'CARGA-000002', estado: 'ABIERTA', destino: 'Mijas' }],
    leerEtiquetas_: () => [
      { idUnico: 'HODOS-E', numeroPedido: '444444', origen: 'MECO', destino: 'Mijas', estado: 'EN_RUTA', bateaId: 'CARGA-000002' },
      { idUnico: 'HODOS-F', numeroPedido: '555555', origen: 'MECO', destino: 'Mijas', estado: 'REGISTRADO', bateaId: '' }
    ]
  });
  assert.throws(() => ctx.cerrarCarga('CARGA-000002'), (err) => {
    assert.doesNotMatch(err.message, /pedidos incompletos/);
    assert.match(err.message, /origen MECO debe cargarse completo/);
    return true;
  });
});

test('cerrarCarga: no bloquea por MECO si esta carga no lleva ningún soporte MECO (aunque haya otros MECO pendientes de la misma tienda)', () => {
  const ctx = contextoBackend({
    leerCargas_: () => [{ idCarga: 'CARGA-000003', estado: 'ABIERTA', destino: 'Granada' }],
    leerEtiquetas_: () => [
      { idUnico: 'HODOS-G', numeroPedido: '666666', origen: 'Valencia', destino: 'Granada', estado: 'EN_RUTA', bateaId: 'CARGA-000003' },
      { idUnico: 'HODOS-H', numeroPedido: '777777', origen: 'MECO', destino: 'Granada', estado: 'REGISTRADO', bateaId: '' }
    ]
  });
  // No debe lanzar por el motivo MECO/pedidos incompletos — puede fallar más adelante
  // (obtenerCarga/DriveApp no están stubeados aquí), pero eso ya no es lo que se prueba.
  assert.throws(() => ctx.cerrarCarga('CARGA-000003'), (err) => {
    assert.doesNotMatch(err.message, /origen MECO debe cargarse completo/);
    assert.doesNotMatch(err.message, /pedidos incompletos/);
    return true;
  });
});

test('obtenerPendientesPorTienda: agrupa por tienda (todas, incluso sin pendientes), ordena por antigüedad y marca alerta a partir de 30h laborables', () => {
  const ahora = Date.now();
  const haceMucho = new Date(ahora - 10 * 24 * 3600 * 1000).toISOString(); // 10 días: alerta segura sea cual sea el día de hoy
  const haceUnaHora = new Date(ahora - 1 * 3600 * 1000).toISOString(); // 1h: sin alerta seguro
  const filas = [
    filaBase({ idUnico: 'HODOS-000001', destino: 'Málaga', fechaCreacion: haceMucho }),
    filaBase({ idUnico: 'HODOS-000002', destino: 'Málaga', fechaCreacion: haceUnaHora }),
    filaBase({ idUnico: 'HODOS-000003', destino: 'Marbella', fechaCreacion: haceMucho }),
    filaBase({ idUnico: 'HODOS-000004', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: haceMucho })
  ];
  const ctx = contextoBackend({
    leerEtiquetas_: () => filas
      .filter((f) => f.estado === 'REGISTRADO')
      .sort((a, b) => new Date(a.fechaCreacion) - new Date(b.fechaCreacion))
  });
  const r = JSON.parse(JSON.stringify(ctx.obtenerPendientesPorTienda()));

  assert.deepStrictEqual(r.map((x) => x.tienda), ['Málaga', 'Marbella', 'Mijas', 'Granada']);

  const malaga = r.find((x) => x.tienda === 'Málaga');
  assert.strictEqual(malaga.pendientes.length, 2);
  assert.strictEqual(malaga.pendientes[0].idUnico, 'HODOS-000001'); // el más antiguo primero
  assert.strictEqual(malaga.pendientes[0].alerta, true);
  assert.strictEqual(malaga.pendientes[1].idUnico, 'HODOS-000002');
  assert.strictEqual(malaga.pendientes[1].alerta, false);
  assert.strictEqual(malaga.totalAlertas, 1);

  const marbella = r.find((x) => x.tienda === 'Marbella');
  assert.strictEqual(marbella.pendientes.length, 1);
  assert.strictEqual(marbella.totalAlertas, 1);

  const mijas = r.find((x) => x.tienda === 'Mijas');
  assert.deepStrictEqual(mijas.pendientes, []);
  assert.strictEqual(mijas.totalAlertas, 0);
});

test('borrarSoporteAdmin: lanza si falta idUnico', () => {
  const ctx = contextoBackend({});
  assert.throws(() => ctx.borrarSoporteAdmin(''), /Falta el idUnico/);
});

test('borrarSoporteAdmin: lanza si no existe', () => {
  const ctx = contextoBackend({ leerEtiquetas_: () => [] });
  assert.throws(() => ctx.borrarSoporteAdmin('HODOS-000001'), /No existe ese soporte/);
});

test('borrarSoporteAdmin: lanza si ya está cargado (no REGISTRADO)', () => {
  const ctx = contextoBackend({ leerEtiquetas_: () => [filaBase({ estado: 'EN_RUTA' })] });
  assert.throws(() => ctx.borrarSoporteAdmin('HODOS-000001'), /aún no se ha cargado/);
});

test('borrarSoporteAdmin: borra y devuelve ok si está REGISTRADO', () => {
  let borradoCon = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase()],
    borrarEtiquetaPorIdUnico_: (id) => { borradoCon = id; }
  });
  const r = JSON.parse(JSON.stringify(ctx.borrarSoporteAdmin('HODOS-000001')));
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(borradoCon, 'HODOS-000001');
});

test('actualizarSoporteAdmin: lanza si ya está cargado (no REGISTRADO)', () => {
  const ctx = contextoBackend({ leerEtiquetas_: () => [filaBase({ estado: 'EN_RUTA' })] });
  assert.throws(() => ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '999' }), /aún no se ha cargado/);
});

test('actualizarSoporteAdmin: lanza si el número de pedido queda vacío', () => {
  const ctx = contextoBackend({ leerEtiquetas_: () => [filaBase()] });
  assert.throws(() => ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '   ' }), /no puede quedar vacío/);
});

test('actualizarSoporteAdmin: recalcula origenTexto al cambiar de MECO a Taisa/Devolución', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase()],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  const r = ctx.actualizarSoporteAdmin('HODOS-000001', { origen: 'Taisa', subtipo: 'Devolución' });
  assert.strictEqual(cambiosEnviados.origenTexto, 'TAISA - DEVOLUCIÓN');
  assert.strictEqual(r.origenTexto, 'TAISA - DEVOLUCIÓN');
});

test('actualizarSoporteAdmin: Cesión con origen==destino lanza el mensaje de mensajeCesionInvalida_', () => {
  const ctx = contextoBackend({ leerEtiquetas_: () => [filaBase()] });
  assert.throws(
    () => ctx.actualizarSoporteAdmin('HODOS-000001', { origen: 'Cesión', origenTienda: 'Málaga', destino: 'Málaga' }),
    /no pueden ser la misma/
  );
});

test('actualizarSoporteAdmin: si otro escaneo se adelantó (0 filas devueltas), avisa a recargar', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase()],
    actualizarEtiquetaCondicional_: () => []
  });
  assert.throws(() => ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '999' }), /recarga y vuelve a intentarlo/);
});

test('mensajeCesionInvalida_ cubre los tres motivos conocidos y un valor por defecto', () => {
  const ctx = contextoBackend({});
  assert.match(ctx.mensajeCesionInvalida_('ORIGEN_IGUAL_DESTINO'), /no pueden ser la misma/);
  assert.match(ctx.mensajeCesionInvalida_('DESTINO_INVALIDO'), /destino.*no es válida/);
  assert.match(ctx.mensajeCesionInvalida_('ORIGEN_INVALIDO'), /origen.*no es válida/);
  assert.strictEqual(ctx.mensajeCesionInvalida_('ALGO_RARO'), 'Cesión no válida');
});

test('borrarSoportesAdmin: lanza si la lista está vacía', () => {
  const ctx = contextoBackend({});
  assert.throws(() => ctx.borrarSoportesAdmin([]), /No hay soportes seleccionados/);
});

test('borrarSoportesAdmin: borra los REGISTRADO y reporta aparte los que no se pudieron borrar', () => {
  const filas = {
    'HODOS-000001': filaBase({ idUnico: 'HODOS-000001', estado: 'REGISTRADO' }),
    'HODOS-000002': filaBase({ idUnico: 'HODOS-000002', estado: 'REGISTRADO' }),
    'HODOS-000003': filaBase({ idUnico: 'HODOS-000003', estado: 'EN_RUTA' })
  };
  const borradosReal = [];
  const ctx = contextoBackend({
    leerEtiquetas_: (filtro) => {
      const id = decodeURIComponent(filtro.split('eq.')[1]);
      return filas[id] ? [filas[id]] : [];
    },
    borrarEtiquetaPorIdUnico_: (id) => { borradosReal.push(id); }
  });
  const r = JSON.parse(JSON.stringify(ctx.borrarSoportesAdmin(['HODOS-000001', 'HODOS-000002', 'HODOS-000003', 'HODOS-999999'])));
  assert.deepStrictEqual(r.borrados.sort(), ['HODOS-000001', 'HODOS-000002']);
  assert.strictEqual(r.rechazados.length, 2);
  assert.deepStrictEqual(borradosReal.sort(), ['HODOS-000001', 'HODOS-000002']);
  const motivos = r.rechazados.map((x) => x.idUnico).sort();
  assert.deepStrictEqual(motivos, ['HODOS-000003', 'HODOS-999999']);
});

test('htmlEtiquetaUnica: lanza si el idUnico no existe', () => {
  const ctx = contextoBackendConBarcode({ leerEtiquetas_: () => [] });
  assert.throws(() => ctx.htmlEtiquetaUnica('HODOS-000001'), /Etiqueta no encontrada/);
});

test('htmlEtiquetaUnica: genera un documento con esa etiqueta y su barcode, no toda la hoja', () => {
  const ctx = contextoBackendConBarcode({
    leerEtiquetas_: () => [filaBase({ idUnico: 'HODOS-000042', numeroPedido: '555555', fechaCreacion: new Date().toISOString() })]
  });
  const html = ctx.htmlEtiquetaUnica('HODOS-000042');
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /HODOS-000042/);
  assert.match(html, /555555/);
  assert.match(html, /<svg/);
  assert.strictEqual((html.match(/class="etiqueta-wrapper"/g) || []).length, 1);
});

// ── registrarLote/crearCarga: destino contra TIENDAS_VALIDAS (bug real, 2026-09-23) ──

test('registrarLote: rechaza un destino que no está en TIENDAS_VALIDAS (antes solo comprobaba que no viniera vacío)', () => {
  const ctx = contextoBackendConSupabase({ insertarEtiquetas_: (filas) => filas });
  assert.throws(
    () => ctx.registrarLote({ pedidosTexto: '111111', origen: 'MECO', destino: 'Sevilla' }),
    /tienda destino no es válida/
  );
});

test('registrarLote: sigue aceptando las 4 tiendas reales', () => {
  let filasInsertadas = null;
  const ctx = contextoBackendConSupabase({
    insertarEtiquetas_: (filas) => { filasInsertadas = filas; return filas; }
  });
  ctx.registrarLote({ pedidosTexto: '111111', origen: 'MECO', destino: 'Granada' });
  assert.strictEqual(filasInsertadas[0].destino, 'Granada');
});

test('crearCarga: rechaza un destino que no está en TIENDAS_VALIDAS', () => {
  const ctx = contextoBackend({});
  assert.throws(
    () => ctx.crearCarga('Sevilla', '2026-09-25', '10:00'),
    /tienda destino no es válida/
  );
});

// ── actualizarSoporteAdmin: no romper la clave soporteTotal+loteId de un multi-soporte
// (bug real, 2026-09-23) ──

test('actualizarSoporteAdmin: bloquea cambiar numeroPedido de un soporte que es parte de un multi-soporte (soporteTotal>1)', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ soporteNum: 1, soporteTotal: 2, loteId: 'LOTE-1' })]
  });
  assert.throws(
    () => ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '999999' }),
    /parte de un pedido con varios soportes/
  );
});

test('actualizarSoporteAdmin: bloquea cambiar destino de un soporte multi-soporte', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ soporteNum: 2, soporteTotal: 2, loteId: 'LOTE-1', destino: 'Málaga' })]
  });
  assert.throws(
    () => ctx.actualizarSoporteAdmin('HODOS-000001', { destino: 'Granada' }),
    /parte de un pedido con varios soportes/
  );
});

test('actualizarSoporteAdmin: permite editar OTROS campos (origen/subtipo/razonFlujo) de un multi-soporte sin tocar numeroPedido/destino', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ soporteNum: 1, soporteTotal: 2, loteId: 'LOTE-1' })],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  ctx.actualizarSoporteAdmin('HODOS-000001', { razonFlujo: 'Sobrante' });
  assert.strictEqual(cambiosEnviados.razonFlujo, 'Sobrante');
});

test('actualizarSoporteAdmin: sigue permitiendo cambiar numeroPedido/destino de un soporte SIN hermanos (soporteTotal=1)', () => {
  let cambiosEnviados = null;
  const ctx = contextoBackend({
    leerEtiquetas_: () => [filaBase({ soporteNum: 1, soporteTotal: 1 })],
    actualizarEtiquetaCondicional_: (id, cambios) => { cambiosEnviados = cambios; return [Object.assign({}, filaBase(), cambios)]; }
  });
  ctx.actualizarSoporteAdmin('HODOS-000001', { numeroPedido: '999999', destino: 'Granada' });
  assert.strictEqual(cambiosEnviados.numeroPedido, '999999');
  assert.strictEqual(cambiosEnviados.destino, 'Granada');
});

// ── obtenerOCrearCarga: LockService cierra la carrera de doble creación (bug real,
// 2026-09-23) ──

function contextoBackendConLock(stubs) {
  const llamadasLock = [];
  return contextoBackend(Object.assign({
    LockService: {
      getScriptLock: () => ({
        waitLock: () => llamadasLock.push('waitLock'),
        releaseLock: () => llamadasLock.push('releaseLock')
      })
    },
    _llamadasLock: llamadasLock
  }, stubs));
}

test('obtenerOCrearCarga: toma y libera el lock, reutiliza si ya existe una carga con ese destino+fecha+horario', () => {
  const ctx = contextoBackendConLock({
    leerCargas_: () => [{ idCarga: 'CARGA-000001', destino: 'Málaga', fechaEntrega: '2026-09-25', horario: '10:00', fechaCreacion: new Date().toISOString() }]
  });
  const r = JSON.parse(JSON.stringify(ctx.obtenerOCrearCarga('Málaga', '2026-09-25', '10:00')));
  assert.deepStrictEqual(r, { idCarga: 'CARGA-000001', reutilizada: true });
  assert.deepStrictEqual(ctx._llamadasLock, ['waitLock', 'releaseLock']);
});

test('obtenerOCrearCarga: libera el lock incluso si crearCarga lanza', () => {
  const ctx = contextoBackendConLock({
    leerCargas_: () => [],
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.com' }) },
    supaRpc_: () => { throw new Error('Supabase caída'); }
  });
  assert.throws(() => ctx.obtenerOCrearCarga('Málaga', '2026-09-25', '10:00'), /Supabase caída/);
  assert.deepStrictEqual(ctx._llamadasLock, ['waitLock', 'releaseLock']);
});

// ── agruparSoportesAdmin: no borra un original que se escaneó durante la agrupación
// (bug real, 2026-09-23) ──

function contextoAgrupacion(filas, stubsExtra) {
  return contextoBackend(Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.com' }) },
    Utilities: { getUuid: () => 'uuid-grupo' },
    siguienteBloqueIdsEtiquetas_: () => ['HODOS-999999'],
    leerEtiquetas_: () => filas,
    insertarEtiquetas_: (fs) => fs,
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => [],
    guardarContenidoSoporte: () => ({ idUnico: 'x', cantidad: 0 })
  }, stubsExtra));
}

test('agruparSoportesAdmin: borra los originales que siguen REGISTRADO con normalidad', () => {
  const filas = [
    filaBase({ idUnico: 'HODOS-A', soporteTotal: 1 }),
    filaBase({ idUnico: 'HODOS-B', soporteTotal: 1 })
  ];
  const borrados = [];
  const ctx = contextoAgrupacion(filas, {
    borrarEtiquetaCondicionalPorIdUnico_: (id) => { borrados.push(id); return true; }
  });
  const r = ctx.agruparSoportesAdmin(['HODOS-A', 'HODOS-B']);
  assert.deepStrictEqual(borrados.sort(), ['HODOS-A', 'HODOS-B']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.avisosIncpc)), []);
});

test('agruparSoportesAdmin: si un original se escaneó justo durante la agrupación, NO lo borra y avisa en vez de fallar en silencio', () => {
  const filas = [
    filaBase({ idUnico: 'HODOS-A', soporteTotal: 1 }),
    filaBase({ idUnico: 'HODOS-B', soporteTotal: 1 })
  ];
  const borrados = [];
  const ctx = contextoAgrupacion(filas, {
    // HODOS-B "se adelantó" (ya no está REGISTRADO cuando llega el DELETE condicionado)
    borrarEtiquetaCondicionalPorIdUnico_: (id) => {
      if (id === 'HODOS-B') return false;
      borrados.push(id);
      return true;
    }
  });
  const r = ctx.agruparSoportesAdmin(['HODOS-A', 'HODOS-B']);
  assert.deepStrictEqual(borrados, ['HODOS-A']);
  assert.strictEqual(r.avisosIncpc.length, 1);
  assert.match(r.avisosIncpc[0], /HODOS-B/);
  assert.match(r.avisosIncpc[0], /NO se borraron/);
});

// ── cerrarCarga: reclamo atómico ANTES del PDF/email/B2B (bug real, 2026-09-23) ──

function contextoCierre(stubsExtra) {
  const orden = [];
  const ctx = contextoBackend(Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'cierre@x.com' }) },
    Utilities: {
      formatDate: (d) => d.toISOString().slice(0, 10),
      newBlob: () => ({}),
      base64Decode: () => []
    },
    Logger: { log: () => {} },
    LOGO_TAISA_B64: 'ZmFrZQ==',
    // ConfigEntregas.gs no se carga aquí (solo Utilidades.gs + Backend.gs) — stubs
    // mínimos. modoPruebaActivo=true evita tener que stubear MailApp: la generación
    // de PDF (lo que interesa comprobar aquí, el orden respecto al reclamo) se hace
    // igual en modo prueba, MailApp.sendEmail es lo único que se salta.
    EMAILS_PEDIDO_CLIENTE_TIENDA: {},
    EMAILS_CARTA_TIENDA: {},
    EMAILS_PEDIDO_CLIENTE_CC: [],
    EMAILS_CARTA_CC: [],
    unirListasEmail_: (a, b) => (a || []).concat(b || []),
    modoPruebaActivo: () => true,
    CacheService: { getScriptCache: () => ({ remove: () => orden.push('cache-remove') }) },
    cotejarPaletesDeCarga_: () => ({ ok: true, datos: [] }),
    htmlInformeCarga: (idCarga) => { orden.push('htmlInformeCarga'); return '<html></html>'; },
    DriveApp: {
      getRootFolder: () => ({
        createFile: () => { orden.push('drive-createFile'); return { getAs: () => ({ setName: () => {} }), getId: () => 'file-1' }; }
      }),
      getFileById: () => ({ setTrashed: () => {} })
    },
    _orden: orden
  }, stubsExtra));
  return ctx;
}

test('cerrarCarga: reclama el cierre (PATCH condicionado a ABIERTA) ANTES de generar el PDF — no después', () => {
  const ctx = contextoCierre({
    leerCargas_: () => [{ idCarga: 'CARGA-1', estado: 'ABIERTA', destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }],
    leerEtiquetas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => [],
    actualizarCargaCondicional_: (idCarga, cambios, filtroExtra) => {
      ctx._orden.push('claim');
      assert.match(filtroExtra, /estado=eq\.ABIERTA/);
      assert.strictEqual(cambios.estado, 'CERRADA');
      return { idCarga: idCarga, estado: 'CERRADA' };
    },
    actualizarCarga_: () => ({})
  });
  const r = ctx.cerrarCarga('CARGA-1');
  assert.deepStrictEqual(ctx._orden.slice(0, 3), ['claim', 'cache-remove', 'htmlInformeCarga']);
  assert.strictEqual(r.cantidad, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.avisosSie)), []);
});

test('cerrarCarga: si el reclamo no afecta ninguna fila (ya cerrada por otra ejecución), aborta SIN generar PDF ni email — arregla el doble cierre', () => {
  const ctx = contextoCierre({
    leerCargas_: () => [{ idCarga: 'CARGA-2', estado: 'ABIERTA', destino: 'Málaga', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '10:00' }],
    leerEtiquetas_: () => [],
    actualizarCargaCondicional_: () => null // otra ejecución ya cerró esta carga
  });
  assert.throws(() => ctx.cerrarCarga('CARGA-2'), /Esta carga ya está cerrada/);
  assert.deepStrictEqual(ctx._orden, []); // ni PDF, ni Drive, ni email — nada de eso se ejecutó
});

test('cerrarCarga: un fallo en el cotejo SIE se devuelve como aviso al cliente, no solo Logger.log', () => {
  const ctx = contextoCierre({
    leerCargas_: () => [{ idCarga: 'CARGA-3', estado: 'ABIERTA', destino: 'Marbella', fechaEntrega: '2026-09-25T00:00:00.000Z', horario: '16:00' }],
    leerEtiquetas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => [],
    actualizarCargaCondicional_: () => ({ idCarga: 'CARGA-3', estado: 'CERRADA' }),
    actualizarCarga_: () => ({}),
    cotejarPaletesDeCarga_: () => ({ ok: false, error: 'Drive SIE no responde' })
  });
  const r = ctx.cerrarCarga('CARGA-3');
  assert.strictEqual(r.avisosSie.length, 1);
  assert.match(r.avisosSie[0], /Drive SIE no responde/);
});

test('buscarEtiquetas: devuelve expedicion y creadoPor (Panel Arrastres agrupa su listado por expedición)', () => {
  const ctx = contextoBackend({
    leerEtiquetas_: () => [
      filaBase({ expedicion: '73142', creadoPor: 'MacroArrastres (Antequera) · pedro', fechaCreacion: new Date().toISOString() }),
      filaBase({ expedicion: null, creadoPor: null, fechaCreacion: new Date().toISOString() })
    ],
    leerCargas_: () => [],
    leerTodoContenidoCrudo_: () => [],
    leerContenidoCrudoPorIds_: () => []
  });
  const r = ctx.buscarEtiquetas({});
  assert.strictEqual(r[0].expedicion, '73142');
  assert.strictEqual(r[0].creadoPor, 'MacroArrastres (Antequera) · pedro');
  assert.strictEqual(r[1].expedicion, '', 'sin expedición -> texto vacío, no null');
  assert.strictEqual(r[1].creadoPor, '');
});
