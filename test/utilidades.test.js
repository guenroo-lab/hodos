const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function cargarGs(nombre) {
  const src = fs.readFileSync(path.join(__dirname, '..', nombre), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: nombre });
  return ctx;
}

// Ver la nota en test/barcode.test.js: vm.createContext crea un realm nuevo, así que
// los arrays que devuelve necesitan este round-trip antes de deepStrictEqual.
function aRealmLocal(valor) {
  return JSON.parse(JSON.stringify(valor));
}

test('parsearLotePedidos separa por líneas, recorta espacios y quita vacías', () => {
  const ctx = cargarGs('Utilidades.gs');
  const entrada = '  286676 \n\n123456\n   \n007890\n';
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos(entrada)), ['286676', '123456', '007890']);
});

test('parsearLotePedidos NO normaliza a 6 dígitos (decisión explícita del proyecto)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos('42\nABC123\n1234567')), ['42', 'ABC123', '1234567']);
});

test('parsearLotePedidos con texto vacío devuelve array vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.parsearLotePedidos('   \n  \n')), []);
});

test('formatearOrigenTexto para Taisa compone "TAISA - SUBTIPO"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearOrigenTexto('Taisa', 'Devolución'), 'TAISA - DEVOLUCIÓN');
});

test('formatearOrigenTexto para plataforma normal usa el nombre en mayúsculas', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearOrigenTexto('Torija', ''), 'TORIJA');
});

test('formatearOrigenTexto para Cesión compone "CESIÓN - TIENDA ORIGEN"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearOrigenTexto('Cesión', 'Marbella'), 'CESIÓN - MARBELLA');
});

test('validarCesionEntreTiendas: ok si origen es una tienda válida del circuito distinta del destino', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.validarCesionEntreTiendas('Marbella', 'Mijas')), { ok: true });
});

test('validarCesionEntreTiendas: ORIGEN_INVALIDO si la tienda de origen no está en el circuito', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.validarCesionEntreTiendas('Sevilla', 'Mijas')), { ok: false, motivo: 'ORIGEN_INVALIDO' });
});

test('validarCesionEntreTiendas: ORIGEN_IGUAL_DESTINO si se intenta ceder a la misma tienda', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.validarCesionEntreTiendas('Mijas', 'Mijas')), { ok: false, motivo: 'ORIGEN_IGUAL_DESTINO' });
});

test('validarCesionEntreTiendas: DESTINO_INVALIDO si el destino no está en el circuito (bug: antes no se comprobaba)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.validarCesionEntreTiendas('Marbella', 'Sevilla')), { ok: false, motivo: 'DESTINO_INVALIDO' });
});

test('formatearIdUnico compone el correlativo con padding a 6 dígitos', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearIdUnico(123), 'HODOS-000123');
  assert.strictEqual(ctx.formatearIdUnico(7), 'HODOS-000007');
  assert.strictEqual(ctx.formatearIdUnico(1234567), 'HODOS-1234567');
});

test('calcularSoportes: pedido único -> soporte 1 de 1', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.calcularSoportes(['200']);
  assert.deepStrictEqual(aRealmLocal(r), [{ numeroPedido: '200', soporteNum: 1, soporteTotal: 1 }]);
});

test('calcularSoportes: un pedido repetido en el lote son varios soportes, numerados en orden de aparición', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.calcularSoportes(['100', '100', '200', '100']);
  assert.deepStrictEqual(aRealmLocal(r), [
    { numeroPedido: '100', soporteNum: 1, soporteTotal: 3 },
    { numeroPedido: '100', soporteNum: 2, soporteTotal: 3 },
    { numeroPedido: '200', soporteNum: 1, soporteTotal: 1 },
    { numeroPedido: '100', soporteNum: 3, soporteTotal: 3 }
  ]);
});

test('calcularSoportes con lista vacía devuelve array vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.calcularSoportes([])), []);
});

test('validarTienda acepta solo las 4 tiendas conocidas', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarTienda('Málaga'), 'Málaga');
  assert.strictEqual(ctx.validarTienda('Marbella'), 'Marbella');
  assert.strictEqual(ctx.validarTienda('otra-cosa'), '');
  assert.strictEqual(ctx.validarTienda(undefined), '');
  assert.strictEqual(ctx.validarTienda(''), '');
});

test('validarVista acepta solo carga/interno/tienda/operario/incpc, por defecto carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarVista('carga'), 'carga');
  assert.strictEqual(ctx.validarVista('interno'), 'interno');
  assert.strictEqual(ctx.validarVista('tienda'), 'tienda');
  assert.strictEqual(ctx.validarVista('operario'), 'operario');
  assert.strictEqual(ctx.validarVista('incpc'), 'incpc');
  assert.strictEqual(ctx.validarVista('otra-cosa'), 'carga');
  assert.strictEqual(ctx.validarVista(undefined), 'carga');
});

test('subtipoEfectivo devuelve el subtipo solo cuando el origen es Taisa', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.subtipoEfectivo('Taisa', 'Devolución'), 'Devolución');
});

test('subtipoEfectivo ignora el subtipo si el origen NO es Taisa (bug reportado)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.subtipoEfectivo('MECO', 'Devolución'), '');
  assert.strictEqual(ctx.subtipoEfectivo('Torija', 'Inventario'), '');
});

test('razonFlujoEfectiva acepta las opciones válidas para cualquier origen que no sea Taisa', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.razonFlujoEfectiva('MECO', 'Sobrante'), 'Sobrante');
  assert.strictEqual(ctx.razonFlujoEfectiva('Valencia', 'Soporte No documentado cargado'), 'Soporte No documentado cargado');
  assert.strictEqual(ctx.razonFlujoEfectiva('Cesión', 'Anulado'), 'Anulado');
  assert.strictEqual(ctx.razonFlujoEfectiva('Valencia', 'Libre Servicio'), 'Libre Servicio');
});

test('razonFlujoEfectiva no viene nunca por defecto: vacío o ausente devuelve cadena vacía', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.razonFlujoEfectiva('MECO', ''), '');
  assert.strictEqual(ctx.razonFlujoEfectiva('MECO', undefined), '');
  assert.strictEqual(ctx.razonFlujoEfectiva('MECO', null), '');
});

test('razonFlujoEfectiva descarta cualquier valor fuera de la lista cerrada (defensa server-side)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.razonFlujoEfectiva('MECO', 'Valor inventado'), '');
});

test('razonFlujoEfectiva no aplica a Taisa: siempre devuelve vacío aunque el valor sea válido', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.razonFlujoEfectiva('Taisa', 'Sobrante'), '');
  assert.strictEqual(ctx.razonFlujoEfectiva('Taisa', 'Anulado'), '');
});

test('fechaComoTexto convierte un Date a ISO string (evita que google.script.run devuelva null)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const d = new Date('2026-07-27T11:55:43.274Z');
  assert.strictEqual(ctx.fechaComoTexto(d), '2026-07-27T11:55:43.274Z');
});

test('fechaComoTexto con vacío/undefined devuelve string vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.fechaComoTexto(''), '');
  assert.strictEqual(ctx.fechaComoTexto(undefined), '');
  assert.strictEqual(ctx.fechaComoTexto(null), '');
});

test('fechaComoTexto deja pasar un string tal cual', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.fechaComoTexto('2026-07-27'), '2026-07-27');
});

test('formatearIdCarga compone el correlativo con prefijo CARGA-', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearIdCarga(1), 'CARGA-000001');
  assert.strictEqual(ctx.formatearIdCarga(23), 'CARGA-000023');
});

test('seleccionarSoporteAEscanear: NO_ENCONTRADO si no hay ninguna fila con ese pedido', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.seleccionarSoporteAEscanear([], '260707', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'NO_ENCONTRADO' });
});

test('seleccionarSoporteAEscanear: DESTINO_INCORRECTO si el pedido existe pero para otra tienda', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Marbella', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'DESTINO_INCORRECTO');
  assert.strictEqual(r.detalle.destinoReal, 'Marbella');
});

test('seleccionarSoporteAEscanear: YA_ESCANEADO si todas las filas del destino correcto ya están EN_RUTA', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'YA_ESCANEADO' });
});

test('seleccionarSoporteAEscanear: escoge el soporte pendiente más antiguo (FIFO), ignorando los ya escaneados', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000003', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T12:00:00.000Z' },
    { idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' },
    { idUnico: 'HODOS-000002', numeroPedido: '260707', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: '2026-07-27T11:00:00.000Z' }
  ];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idUnico, 'HODOS-000001');
});

test('seleccionarSoporteAEscanear: ignora filas de otros números de pedido', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' },
    { idUnico: 'HODOS-000002', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' }
  ];
  const r = ctx.seleccionarSoporteAEscanear(filas, '260707', 'Málaga');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idUnico, 'HODOS-000002');
});

test('pedidosPendientesEnCarga: sin pendientes si el pedido de un solo soporte ya está escaneado en esta carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 1, loteId: 'L1' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('pedidosPendientesEnCarga: detecta un pedido de 3 soportes con 1 sin escanear todavía en esta carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 3, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 3, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '', idUnico: 'HODOS-000010', origenTexto: 'TAISA - INVENTARIO', soporteTotal: 3, loteId: 'L1' }
  ];
  const r = ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001');
  assert.deepStrictEqual(aRealmLocal(r), [{
    numeroPedido: '280606', soportesPendientes: 1,
    soportes: [{ idUnico: 'HODOS-000010', origenTexto: 'TAISA - INVENTARIO' }]
  }]);
});

test('pedidosPendientesEnCarga: ignora soportes hermanos que ya salieron EN_RUTA en OTRA carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 2, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000002', soporteTotal: 2, loteId: 'L1' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

// Bug real (2026-09-22): un mismo numeroPedido puede repetirse en registros
// INDEPENDIENTES (loteId distinto, soporteTotal=1 cada uno — nunca declarados como
// multi-soporte juntos: llegada por distinta expedición/día, ver comentario en
// IntegracionIncpc.gs sobre MacroArrastres). Antes del fix, pedidosPendientesEnCarga
// los trataba como si fueran soportes hermanos del mismo pedido y bloqueaba el cierre
// de una carga que no tenía nada que ver con el otro registro.
test('pedidosPendientesEnCarga: NO bloquea si el numeroPedido coincide por casualidad entre dos registros independientes (soporteTotal=1, loteId distinto)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 1, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '', idUnico: 'HODOS-000099', origenTexto: 'VALENCIA', soporteTotal: 1, loteId: 'L2' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

// Caso residual que detectó la revisión de Codex: aunque soporteTotal>1 en ambas
// filas, si vienen de loteId distinto (dos expediciones separadas que CADA UNA
// declaró su propio multi-soporte, coincidiendo en numeroPedido+destino por
// casualidad) tampoco deben tratarse como hermanas.
test('pedidosPendientesEnCarga: NO bloquea si soporteTotal>1 en ambas filas pero pertenecen a loteId distinto', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 2, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '', idUnico: 'HODOS-000098', origenTexto: 'VALENCIA', soporteTotal: 2, loteId: 'L2' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('seleccionarSoporteAEscanear: escaneando un idUnico (prefijo HODOS-) resuelve exacto, sin ambigüedad FIFO', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' },
    { idUnico: 'HODOS-000002', numeroPedido: '260707', destino: 'Málaga', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T11:00:00.000Z' }
  ];
  // Aunque HODOS-000002 es más reciente (el FIFO por numeroPedido elegiría el 000001),
  // escanear el idUnico exacto debe devolver ESE, no el más antiguo.
  const r = ctx.seleccionarSoporteAEscanear(filas, 'HODOS-000002', 'Málaga');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.idUnico, 'HODOS-000002');
});

test('seleccionarSoporteAEscanear: idUnico inexistente -> NO_ENCONTRADO', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.seleccionarSoporteAEscanear([], 'HODOS-999999', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'NO_ENCONTRADO' });
});

test('seleccionarSoporteAEscanear: idUnico de otro destino -> DESTINO_INCORRECTO', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Marbella', estado: 'REGISTRADO', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, 'HODOS-000001', 'Málaga');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.motivo, 'DESTINO_INCORRECTO');
  assert.strictEqual(r.detalle.destinoReal, 'Marbella');
});

test('seleccionarSoporteAEscanear: idUnico ya EN_RUTA -> YA_ESCANEADO', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [{ idUnico: 'HODOS-000001', numeroPedido: '260707', destino: 'Málaga', estado: 'EN_RUTA', fechaCreacion: '2026-07-27T10:00:00.000Z' }];
  const r = ctx.seleccionarSoporteAEscanear(filas, 'HODOS-000001', 'Málaga');
  assert.deepStrictEqual(aRealmLocal(r), { ok: false, motivo: 'YA_ESCANEADO' });
});

// CAMBIO DE COMPORTAMIENTO (2026-09-22, decisión explícita del usuario): antes este
// caso bloqueaba el cierre (aviso "dejaste un soporte suelto sin agrupar"). Una
// etiqueta agrupada siempre nace con soporteTotal=1 (agruparSoportesAdmin, Backend.gs)
// — nunca fue "declarada multi-soporte" — así que ya no participa en el bloqueo. El
// usuario aceptó perder este aviso a cambio de arreglar el bug real (ver test de más
// arriba): no puede distinguirse de dos registros independientes que coinciden en
// numeroPedido por casualidad, así que had que elegir uno de los dos comportamientos.
test('pedidosPendientesEnCarga: un grupo con "+" ya NO arrastra el aviso de un soporte suelto sin agrupar (soporteTotal=1, no es multi-soporte declarado)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    // Grupo escaneado en esta carga: contiene 100200 y 100300.
    { numeroPedido: '100200+100300', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 1, loteId: 'L1' },
    // 100300 vuelve a aparecer suelto en otra fila, sin escanear todavía.
    { numeroPedido: '100300', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '', idUnico: 'HODOS-000020', origenTexto: 'VALENCIA', soporteTotal: 1, loteId: 'L2' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('pedidosPendientesEnCarga: un grupo completo escaneado de una vez no deja pendientes de sus propios miembros', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '100200+100300+100450', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 1, loteId: 'L1' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('pedidosPendientesEnCarga: no afecta a pedidos de otras cargas ni de otros destinos', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { numeroPedido: '111111', destino: 'Mijas', estado: 'REGISTRADO', bateaId: '', soporteTotal: 2, loteId: 'L1' },
    { numeroPedido: '280606', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001', soporteTotal: 2, loteId: 'L2' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.pedidosPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('soportesMecoPendientesEnCarga: sin soportes MECO en esta carga, no bloquea nada', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', origen: 'MECO', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '' },
    { idUnico: 'HODOS-000002', numeroPedido: '222222', origen: 'Valencia', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.soportesMecoPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('soportesMecoPendientesEnCarga: detecta soportes MECO de la misma tienda que faltan por cargar', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', origen: 'MECO', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001' },
    { idUnico: 'HODOS-000002', numeroPedido: '222222', origen: 'MECO', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.soportesMecoPendientesEnCarga(filas, 'CARGA-000001')), [
    { idUnico: 'HODOS-000002', numeroPedido: '222222', destino: 'Málaga' }
  ]);
});

test('soportesMecoPendientesEnCarga: no afecta a otras tiendas ni a otros orígenes', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', origen: 'MECO', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001' },
    { idUnico: 'HODOS-000002', numeroPedido: '222222', origen: 'MECO', destino: 'Marbella', estado: 'REGISTRADO', bateaId: '' },
    { idUnico: 'HODOS-000003', numeroPedido: '333333', origen: 'Taisa', destino: 'Málaga', estado: 'REGISTRADO', bateaId: '' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.soportesMecoPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('soportesMecoPendientesEnCarga: ignora soportes MECO ya EN_RUTA en otra carga', () => {
  const ctx = cargarGs('Utilidades.gs');
  const filas = [
    { idUnico: 'HODOS-000001', numeroPedido: '111111', origen: 'MECO', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000001' },
    { idUnico: 'HODOS-000002', numeroPedido: '222222', origen: 'MECO', destino: 'Málaga', estado: 'EN_RUTA', bateaId: 'CARGA-000002' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.soportesMecoPendientesEnCarga(filas, 'CARGA-000001')), []);
});

test('nivelAvisoPorHoras: por debajo del 60% del umbral es "ok"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.nivelAvisoPorHoras(17.9, 30), 'ok');
});

test('nivelAvisoPorHoras: entre 60% y 85% del umbral es "amarillo"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.nivelAvisoPorHoras(18, 30), 'amarillo'); // exactamente 60%
  assert.strictEqual(ctx.nivelAvisoPorHoras(22, 30), 'amarillo');
});

test('nivelAvisoPorHoras: entre 85% y 100% del umbral es "naranja"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.nivelAvisoPorHoras(25.5, 30), 'naranja'); // exactamente 85%
  assert.strictEqual(ctx.nivelAvisoPorHoras(29, 30), 'naranja');
});

test('nivelAvisoPorHoras: a partir del 100% del umbral es "rojo"', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.nivelAvisoPorHoras(30, 30), 'rojo'); // exactamente el umbral
  assert.strictEqual(ctx.nivelAvisoPorHoras(50, 30), 'rojo');
});

test('prepararLineasContenido: descarta líneas sin descripción y normaliza cantidad a número', () => {
  const ctx = cargarGs('Utilidades.gs');
  const items = [
    { descripcion: '  Tornillos  ', cantidad: '5' },
    { descripcion: '', cantidad: 3 },
    { descripcion: '   ', cantidad: 2 },
    { descripcion: 'Bisagras', cantidad: 'no-es-numero' }
  ];
  assert.deepStrictEqual(aRealmLocal(ctx.prepararLineasContenido(items)), [
    { descripcion: 'Tornillos', cantidad: 5 },
    { descripcion: 'Bisagras', cantidad: 0 }
  ]);
});

test('prepararLineasContenido con vacío/undefined devuelve array vacío', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.prepararLineasContenido(undefined)), []);
  assert.deepStrictEqual(aRealmLocal(ctx.prepararLineasContenido([])), []);
});

// horasLaborablesTranscurridas: construye instantes a partir de "fecha/hora local
// GMT+1" (el mismo desfase fijo sin DST que usa el resto de la app), restando 1h al
// UTC equivalente. 2024-01-01 es lunes (dato conocido y verificable), así que toda
// la semana siguiente 01-01(lun)..01-07(dom) tiene día de la semana conocido sin
// depender de que la función bajo test acierte con eso.
function localGMT1(y, m, d, h, min) {
  return new Date(Date.UTC(y, m - 1, d, h - 1, min || 0));
}

test('horasLaborablesTranscurridas: mismo día laborable, cuenta las horas tal cual', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 2, 10, 0); // martes 10:00
  const fin = localGMT1(2024, 1, 2, 15, 0);    // martes 15:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 5);
});

test('horasLaborablesTranscurridas: fin anterior o igual a inicio devuelve 0', () => {
  const ctx = cargarGs('Utilidades.gs');
  const t = localGMT1(2024, 1, 2, 10, 0);
  assert.strictEqual(ctx.horasLaborablesTranscurridas(t, t), 0);
  assert.strictEqual(ctx.horasLaborablesTranscurridas(localGMT1(2024, 1, 2, 10, 0), localGMT1(2024, 1, 2, 8, 0)), 0);
});

test('horasLaborablesTranscurridas: viernes noche a lunes mañana NO cuenta el fin de semana', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 5, 22, 0); // viernes 22:00
  const fin = localGMT1(2024, 1, 8, 8, 0);     // lunes 08:00
  // viernes 22:00->24:00 (2h) + sábado(0) + domingo(0) + lunes 00:00->08:00 (8h) = 10h
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 10);
});

test('horasLaborablesTranscurridas: creado y consultado dentro del mismo fin de semana da 0', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 6, 3, 0);  // sábado 03:00
  const fin = localGMT1(2024, 1, 6, 20, 0);    // sábado 20:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 0);
});

test('horasLaborablesTranscurridas: fin de semana entero + tramo parcial del lunes', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 6, 0, 0);  // sábado 00:00
  const fin = localGMT1(2024, 1, 8, 5, 0);     // lunes 05:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 5);
});

test('horasLaborablesTranscurridas: una semana completa lunes a lunes son 120h (5 días x 24h)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 1, 0, 0);  // lunes 00:00
  const fin = localGMT1(2024, 1, 8, 0, 0);     // lunes siguiente 00:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 120);
});

test('horasLaborablesTranscurridas: viernes completo cuenta las 24h', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 5, 0, 0);  // viernes 00:00
  const fin = localGMT1(2024, 1, 6, 0, 0);     // sábado 00:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 24);
});

test('horasLaborablesTranscurridas: sábado completo cuenta 0h', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 6, 0, 0);  // sábado 00:00
  const fin = localGMT1(2024, 1, 7, 0, 0);     // domingo 00:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 0);
});

// Hueco de cobertura detectado en revisión (2026-09-23): los 8 tests de arriba cruzan
// como máximo UN fin de semana completo. Este cubre DOS (un soporte "olvidado" 2
// semanas sin escanear, el caso real que le interesa a la pestaña Pendientes), para
// confirmar que el bucle día-a-día no acumula error al iterar más veces.
test('horasLaborablesTranscurridas: dos semanas completas (lunes a lunes) cruzando DOS fines de semana -> 240h (10 días laborables x 24h)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 1, 0, 0);  // lunes 00:00
  const fin = localGMT1(2024, 1, 15, 0, 0);    // lunes de la semana siguiente a esa, 00:00
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 240);
});

test('horasLaborablesTranscurridas: 10 días completos "olvidado" desde un viernes, cruzando dos fines de semana', () => {
  const ctx = cargarGs('Utilidades.gs');
  const inicio = localGMT1(2024, 1, 5, 9, 0);   // viernes 09:00
  const fin = localGMT1(2024, 1, 15, 9, 0);     // lunes de la semana siguiente, 09:00 (10 días después)
  // viernes 09:00->24:00 (15h) + finde(0) + lun-vie completos (5*24=120h) + finde(0) + lunes 00:00->09:00 (9h) = 144h
  assert.strictEqual(ctx.horasLaborablesTranscurridas(inicio, fin), 144);
});

test('formatearHorasTexto: menos de 1h se muestra en minutos', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearHorasTexto(0.5), '30 min');
});

test('formatearHorasTexto: entre 1 y 24h se muestra en horas con un decimal', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearHorasTexto(5), '5 h');
  assert.strictEqual(ctx.formatearHorasTexto(5.26), '5.3 h');
});

test('formatearHorasTexto: 24h o más se muestra en días y horas', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.formatearHorasTexto(24), '1d 0h');
  assert.strictEqual(ctx.formatearHorasTexto(35), '1d 11h');
  assert.strictEqual(ctx.formatearHorasTexto(50), '2d 2h');
});

test('lineasNumeroPedidoEtiqueta: con 5 pedidos o menos, lista todos tal cual (sin resumir)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.lineasNumeroPedidoEtiqueta(['100200'])), ['100200']);
  assert.deepStrictEqual(
    aRealmLocal(ctx.lineasNumeroPedidoEtiqueta(['100200', '100300', '100450', '100500', '100600'])),
    ['100200', '100300', '100450', '100500', '100600']
  );
});

test('lineasNumeroPedidoEtiqueta: con 6 pedidos o más, resume como "AGRUPACIÓN (N)"', () => {
  const ctx = cargarGs('Utilidades.gs');
  const seis = ['1', '2', '3', '4', '5', '6'];
  assert.deepStrictEqual(aRealmLocal(ctx.lineasNumeroPedidoEtiqueta(seis)), ['AGRUPACIÓN (6)']);
});

test('lineasNumeroPedidoEtiqueta: caso real reportado (foto de Mijas, 12 pedidos agrupados)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const doce = ['285616', '273998', '277661', '276338', '282580', '282239', '280016', '288248', '279151', '279153', '281234', '283456'];
  assert.deepStrictEqual(aRealmLocal(ctx.lineasNumeroPedidoEtiqueta(doce)), ['AGRUPACIÓN (12)']);
});

// ── Agrupar soportes existentes (selección múltiple en Interno/INCPC/Preparación) ──

function etiquetaFake_(over) {
  return Object.assign({
    idUnico: 'HODOS-000001', numeroPedido: '100200', estado: 'REGISTRADO',
    destino: 'Mijas', origen: 'Taisa', subtipo: 'Devolución', origenTienda: '', razonFlujo: ''
  }, over);
}

test('validarAgrupacion: rechaza con menos de 2 soportes seleccionados', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.strictEqual(ctx.validarAgrupacion([]).ok, false);
  assert.strictEqual(ctx.validarAgrupacion([etiquetaFake_()]).ok, false);
});

test('validarAgrupacion: ok con 2+ soportes REGISTRADO, mismo destino/origen', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', numeroPedido: '100200' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', numeroPedido: '100300' }),
    etiquetaFake_({ idUnico: 'HODOS-000003', numeroPedido: '100450' })
  ]);
  assert.deepStrictEqual(aRealmLocal(r), { ok: true });
});

test('validarAgrupacion: rechaza si alguno ya no está REGISTRADO (ya cargado en un camión)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', estado: 'EN_RUTA' })
  ]);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /REGISTRADO|camión/i);
});

test('validarAgrupacion: rechaza si difiere el destino', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', destino: 'Mijas' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', destino: 'Málaga' })
  ]);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /destino/i);
});

test('validarAgrupacion: rechaza si difiere el origen', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', origen: 'Taisa', subtipo: 'Devolución' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', origen: 'MECO', subtipo: '' })
  ]);
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /origen/i);
});

test('validarAgrupacion: permite subtipos distintos (mismo origen Taisa) — decisión explícita del usuario', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', origen: 'Taisa', subtipo: 'Devolución' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', origen: 'Taisa', subtipo: 'Inventario' })
  ]);
  assert.deepStrictEqual(aRealmLocal(r), { ok: true });
});

test('validarAgrupacion: rechaza si difiere la razón del flujo', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', origen: 'MECO', razonFlujo: 'Sobrante' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', origen: 'MECO', razonFlujo: '' })
  ]);
  assert.strictEqual(r.ok, false);
});

test('validarAgrupacion: rechaza si difiere la tienda de origen (Cesión)', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.validarAgrupacion([
    etiquetaFake_({ idUnico: 'HODOS-000001', origen: 'Cesión', origenTienda: 'Mijas' }),
    etiquetaFake_({ idUnico: 'HODOS-000002', origen: 'Cesión', origenTienda: 'Málaga' })
  ]);
  assert.strictEqual(r.ok, false);
});

test('numeroPedidoAgrupado: une los números de pedido de cada soporte con "+"', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.numeroPedidoAgrupado([
    etiquetaFake_({ numeroPedido: '100200' }),
    etiquetaFake_({ numeroPedido: '100300' }),
    etiquetaFake_({ numeroPedido: '100450' })
  ]);
  assert.strictEqual(r, '100200+100300+100450');
});

test('numeroPedidoAgrupado: aplana un soporte que YA era un grupo (no anida "+")', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.numeroPedidoAgrupado([
    etiquetaFake_({ numeroPedido: '100200+100300' }),
    etiquetaFake_({ numeroPedido: '100450' })
  ]);
  assert.strictEqual(r, '100200+100300+100450');
});

test('numeroPedidoAgrupado: NO deduplica un número de pedido repetido en soportes distintos', () => {
  const ctx = cargarGs('Utilidades.gs');
  const r = ctx.numeroPedidoAgrupado([
    etiquetaFake_({ numeroPedido: '100200' }),
    etiquetaFake_({ numeroPedido: '100200' })
  ]);
  assert.strictEqual(r, '100200+100200');
});

// tokensPedido_: hueco de cobertura detectado en revisión (2026-09-23) — antes solo se
// ejercía indirectamente vía pedidosPendientesEnCarga/numeroPedidoAgrupado. Sin bug de
// comportamiento (el .filter(Boolean) ya maneja los casos límite), solo faltaba test
// directo en aislamiento.
test('tokensPedido_: un solo pedido (sin agrupar) devuelve un array de 1', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_('100200')), ['100200']);
});

test('tokensPedido_: separa un grupo "a+b+c" en sus 3 números', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_('100200+100300+100450')), ['100200', '100300', '100450']);
});

test('tokensPedido_: recorta espacios alrededor de cada token', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_(' 100200 + 100300 ')), ['100200', '100300']);
});

test('tokensPedido_: un "+" al final no deja un token vacío colgando', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_('100200+')), ['100200']);
});

test('tokensPedido_: un "+" duplicado ("++") tampoco deja tokens vacíos', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_('100200++100300')), ['100200', '100300']);
});

test('tokensPedido_: acepta un número (no string) igual que String(numeroPedido)', () => {
  const ctx = cargarGs('Utilidades.gs');
  assert.deepStrictEqual(aRealmLocal(ctx.tokensPedido_(100200)), ['100200']);
});
