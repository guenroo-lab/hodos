const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Fase 2 del recorte de egress (2026-10-06): buscarEtiquetas/obtenerCarga/cerrarCarga ya no
// leen `etiquetas`/`contenido`/`cargas` enteras. La equivalencia contra el código anterior se
// comprueba en herramientas/pruebas-egress-fase2.js (PostgREST simulado + mutaciones); aquí van
// las piezas pequeñas, sin red.
function contexto(stubs, archivos) {
  const ctx = Object.assign({}, stubs);
  vm.createContext(ctx);
  (archivos || ['Utilidades.gs', 'Backend.gs']).forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  return ctx;
}

test('distintosTexto_: quita repetidos y vacíos, y devuelve texto', () => {
  const ctx = contexto({});
  assert.deepStrictEqual(Array.from(ctx.distintosTexto_(['a', 'b', 'a', '', null, undefined, 3, '3'])), ['a', 'b', '3']);
  assert.deepStrictEqual(Array.from(ctx.distintosTexto_(null)), []);
});

test('filtroPrevioBuscarEtiquetas_: sin criterios no filtra nada', () => {
  const ctx = contexto({});
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({}), '');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ ordenAscendente: true }), '');
});

test('filtroPrevioBuscarEtiquetas_: destino/origen/estado exactos y pendiente solo si es true', () => {
  const ctx = contexto({});
  assert.strictEqual(
    ctx.filtroPrevioBuscarEtiquetas_({ destino: 'Málaga', origen: 'MECO', estado: 'REGISTRADO', pendienteImpresionIncpc: true }),
    'destino=eq.M%C3%A1laga&origen=eq.MECO&estado=eq.REGISTRADO&pendiente_impresion_incpc=eq.true'
  );
  // pendiente=false incluye los NULL: no se empuja al servidor (lo decide el filtro JS)
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ pendienteImpresionIncpc: false }), '');
});

test('filtroPrevioBuscarEtiquetas_: idUnico y pedidos por ilike (sobre-aproximan: no distinguen mayúsculas)', () => {
  const ctx = contexto({});
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ idUnico: '0001' }), 'id_unico=ilike.*0001*');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: '286676' }), 'numero_pedido=ilike.*286676*');
  assert.strictEqual(
    ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: '111\n222+333' }),
    'or=(numero_pedido.ilike.*111*,numero_pedido.ilike.*222%2B333*)'
  );
});

test('filtroPrevioBuscarEtiquetas_: un criterio con caracteres peligrosos NO se empuja (la búsqueda lee más, nunca mal)', () => {
  const ctx = contexto({});
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ idUnico: '00*1' }), '');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ idUnico: 'a\\' }), '');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: '111,222' }), '');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: '12(3)' }), '');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: '\n\n' }), '');
  // más de 20 pedidos pegados: la URL se pasaría del límite -> sin pre-filtro
  const muchos = Array.from({ length: 21 }, (_, i) => String(100000 + i)).join('\n');
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ numeroPedido: muchos }), '');
});

test('filtroPrevioBuscarEtiquetas_: la fecha lleva un día de margen por cada lado (huso GMT+1)', () => {
  const ctx = contexto({});
  assert.strictEqual(
    ctx.filtroPrevioBuscarEtiquetas_({ fecha: '2026-10-05' }),
    'fecha_creacion=gte.2026-10-04T00%3A00%3A00.000Z&fecha_creacion=lt.2026-10-06T00%3A00%3A00.000Z'
  );
  assert.strictEqual(ctx.filtroPrevioBuscarEtiquetas_({ fecha: '05/10/2026' }), '');
});

test('leerContenidoCrudoPorIds_: pide por lotes de 60 ids, sin repetidos', () => {
  const urls = [];
  const ctx = contexto({
    supaGet_: (tabla, filtro) => { urls.push(tabla + '?' + filtro); return []; }
  }, ['EstructuraContenido.gs']);
  const ids = Array.from({ length: 130 }, (_, i) => 'HODOS-' + String(i + 1).padStart(6, '0'));
  ctx.leerContenidoCrudoPorIds_(ids.concat(ids.slice(0, 5)));
  assert.strictEqual(urls.length, 3);
  assert.ok(urls.every((u) => u.startsWith('contenido?id_unico=in.(')));
  assert.strictEqual(urls[0].split(',').length, 60);
  assert.strictEqual(urls[2].split(',').length, 10);
});

test('obtenerMapaContenidoDe_: sin ids no pide nada; pocos ids pide por ids; muchísimos vuelve a la lectura entera', () => {
  const llamadas = [];
  const ctx = contexto({
    leerContenidoCrudoPorIds_: (ids) => { llamadas.push('ids:' + ids.length); return [{ id_unico: 'HODOS-000001', descripcion: 'x', cantidad: 2 }]; },
    leerTodoContenidoCrudo_: () => { llamadas.push('todo'); return []; }
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.obtenerMapaContenidoDe_([]))), {});
  assert.deepStrictEqual(llamadas, []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.obtenerMapaContenidoDe_(['HODOS-000001', 'HODOS-000001']))), { 'HODOS-000001': [{ descripcion: 'x', cantidad: 2 }] });
  assert.deepStrictEqual(llamadas, ['ids:1']);
  ctx.obtenerMapaContenidoDe_(Array.from({ length: 401 }, (_, i) => 'HODOS-' + i));
  assert.deepStrictEqual(llamadas, ['ids:1', 'todo']);
});

test('obtenerMapaCargasDe_: solo las cargas citadas; muchísimas vuelve a la lectura entera', () => {
  const filtros = [];
  const ctx = contexto({
    leerCargas_: (f) => { filtros.push(f); return f === null ? [] : [{ idCarga: 'CARGA-000001', fechaEntrega: '2026-10-05', horario: '10:00' }]; }
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.obtenerMapaCargasDe_([null, '']))), {});
  assert.deepStrictEqual(filtros, []);
  const m = JSON.parse(JSON.stringify(ctx.obtenerMapaCargasDe_(['CARGA-000001', 'CARGA-000001'])));
  assert.deepStrictEqual(m, { 'CARGA-000001': { fechaEntrega: '2026-10-05', horario: '10:00' } });
  assert.deepStrictEqual(filtros, ['id_carga=in.(CARGA-000001)']);
  ctx.obtenerMapaCargasDe_(Array.from({ length: 81 }, (_, i) => 'CARGA-' + i));
  assert.strictEqual(filtros[filtros.length - 1], null);
});

test('leerEtiquetasParaChequeoCierre_: junta las de ESTA carga y las REGISTRADO, sin duplicar y por id_unico', () => {
  const pedidos = [];
  const ctx = contexto({
    leerEtiquetas_: (filtro, columnas) => {
      pedidos.push(filtro + ' | ' + columnas);
      if (filtro.indexOf('batea_id=eq.CARGA-000007') === 0) return [{ idUnico: 'HODOS-000009', estado: 'EN_RUTA' }, { idUnico: 'HODOS-000002', estado: 'REGISTRADO' }];
      return [{ idUnico: 'HODOS-000002', estado: 'REGISTRADO' }, { idUnico: 'HODOS-000001', estado: 'REGISTRADO' }];
    }
  });
  const r = ctx.leerEtiquetasParaChequeoCierre_('CARGA-000007');
  assert.deepStrictEqual(Array.from(r.map((f) => f.idUnico)), ['HODOS-000001', 'HODOS-000002', 'HODOS-000009']);
  assert.strictEqual(pedidos.length, 2);
  assert.ok(pedidos[0].startsWith('batea_id=eq.CARGA-000007&order=id_unico.asc | id_unico,numero_pedido,origen,origen_texto,destino,estado,batea_id,soporte_total,lote_id'));
  assert.ok(pedidos[1].startsWith('estado=eq.REGISTRADO&order=id_unico.asc | '));
});
