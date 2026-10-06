const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '', 'Palet'],
  ['S02', 'PALETINA', '', '', 'Palet'],
  ['S16', 'JAULA', '', '', 'Jaula Completa']
];

function cargarDatos(extra) {
  const llamadas = { insertar: [], actualizar: [], borrar: [], get: [], rpc: [] };
  const ctx = Object.assign({
    Session: { getActiveUser: () => ({ getEmail: () => 'ana@taisa.test' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    supaRpc_: (nombre) => { llamadas.rpc.push(nombre); return 'INV-000007'; },
    supaInsertar_: (tabla, filas) => {
      llamadas.insertar.push({ tabla: tabla, filas: filas });
      return filas.map((f) => Object.assign({ fecha_creacion: '2026-10-06T08:00:00Z' }, f));
    },
    supaActualizar_: (tabla, filtro, cambios) => {
      llamadas.actualizar.push({ tabla: tabla, filtro: filtro, cambios: cambios });
      return [{ id_unico: 'INV-000007', lineas: cambios.lineas, total_soportes: cambios.total_soportes, creado_por: 'x', fecha_creacion: '2026-10-06T08:00:00Z' }];
    },
    supaBorrar_: (tabla, filtro) => { llamadas.borrar.push({ tabla: tabla, filtro: filtro }); return [{ id_unico: 'INV-000007' }]; },
    supaGet_: (tabla, filtro, columnas) => { llamadas.get.push({ tabla: tabla, filtro: filtro, columnas: columnas }); return []; }
  }, extra);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'PrecargaInversa.gs'), 'utf8'), ctx);
  // Funciones que define el propio .gs: se sustituyen DESPUÉS de cargarlo.
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, llamadas: llamadas };
}

const aLocal = (valor) => JSON.parse(JSON.stringify(valor));

test('obtenerCatalogoInversa: lee la hoja, parsea y guarda en caché 6 horas', () => {
  let guardado = null;
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => null, put: (clave, valor, seg) => { guardado = { clave: clave, valor: valor, seg: seg }; } }) }
  });
  const catalogo = ctx.obtenerCatalogoInversa();
  assert.strictEqual(catalogo.length, 3);
  assert.strictEqual(guardado.seg, 21600);
  assert.strictEqual(JSON.parse(guardado.valor).length, 3);
});

test('obtenerCatalogoInversa: si hay caché no vuelve a leer la hoja', () => {
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => JSON.stringify([{ id: 'S01', nombre: 'EUROPEO', tipo: 'Palet' }]), put: () => {} }) }
  });
  let hojaLeida = 0;
  ctx.leerFilasCatalogoInversa_ = () => { hojaLeida++; return FILAS_CATALOGO; };
  assert.strictEqual(ctx.obtenerCatalogoInversa().length, 1);
  assert.strictEqual(hojaLeida, 0);
});

test('obtenerCatalogoInversa: un catálogo vacío es un error y no se cachea', () => {
  let puesto = false;
  const { ctx } = cargarDatos({
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => { puesto = true; } }) }
  });
  ctx.leerFilasCatalogoInversa_ = () => [['ID_Soporte', 'Nombre_Soporte']];
  assert.throws(() => ctx.obtenerCatalogoInversa(), /catálogo de soportes está vacío/);
  assert.strictEqual(puesto, false);
});

test('crearTorreInversa: pide el id, inserta con el nombre del catálogo y devuelve la torre', () => {
  const { ctx, llamadas } = cargarDatos();
  const torre = aLocal(ctx.crearTorreInversa([
    { id: 'S01', cantidad: '5', nombre: 'LO QUE MANDE EL CLIENTE' },
    { id: 'S16', cantidad: 5 }
  ]));
  assert.deepStrictEqual(llamadas.rpc, ['siguiente_id_torre_inversa']);
  assert.strictEqual(llamadas.insertar[0].tabla, 'torres_inversa');
  const fila = llamadas.insertar[0].filas[0];
  assert.strictEqual(fila.id_unico, 'INV-000007');
  assert.strictEqual(fila.total_soportes, 10);
  assert.strictEqual(fila.creado_por, 'ana@taisa.test');
  assert.deepStrictEqual(aLocal(fila.lineas), [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 5 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.strictEqual(torre.idUnico, 'INV-000007');
  assert.strictEqual(torre.total, 10);
  assert.strictEqual(torre.fechaCreacion, '2026-10-06T08:00:00Z');
});

test('crearTorreInversa: con líneas inválidas no pide id ni inserta', () => {
  const { ctx, llamadas } = cargarDatos();
  assert.throws(() => ctx.crearTorreInversa([{ id: 'S01', cantidad: '' }]), /ningún soporte/);
  assert.throws(() => ctx.crearTorreInversa([{ id: 'S77', cantidad: 2 }]), /desconocido/);
  assert.strictEqual(llamadas.rpc.length, 0);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('listarTorresInversa: devuelve las torres (más antigua primero) y el resumen por tipo', () => {
  const { ctx, llamadas } = cargarDatos({
    supaGet_: (tabla, filtro) => {
      assert.strictEqual(tabla, 'torres_inversa');
      assert.strictEqual(filtro, 'order=fecha_creacion.asc,id_unico.asc');
      return [
        { id_unico: 'INV-000001', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 17 }], total_soportes: 17, creado_por: 'a', fecha_creacion: '2026-10-06T07:00:00Z' },
        { id_unico: 'INV-000002', lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 5 }], total_soportes: 10, creado_por: 'a', fecha_creacion: '2026-10-06T08:00:00Z' }
      ];
    }
  });
  const r = aLocal(ctx.listarTorresInversa());
  assert.strictEqual(r.torres.length, 2);
  assert.strictEqual(r.torres[0].idUnico, 'INV-000001');
  assert.deepStrictEqual(r.resumen, [
    { id: 'S01', nombre: 'EUROPEO', cantidad: 22 },
    { id: 'S16', nombre: 'JAULA', cantidad: 5 }
  ]);
  assert.strictEqual(llamadas.get.length, 0, 'supaGet_ propio del test no debe contarse en llamadas');
});

test('actualizarTorreInversa: reemplaza el contenido y avisa si la torre ya no existe', () => {
  const { ctx, llamadas } = cargarDatos();
  const torre = aLocal(ctx.actualizarTorreInversa('inv-000007', [{ id: 'S02', cantidad: 4 }]));
  assert.strictEqual(llamadas.actualizar[0].filtro, 'id_unico=eq.INV-000007');
  assert.strictEqual(llamadas.actualizar[0].cambios.total_soportes, 4);
  assert.strictEqual(torre.total, 4);

  const { ctx: ctx2 } = cargarDatos({ supaActualizar_: () => [] });
  assert.throws(() => ctx2.actualizarTorreInversa('INV-000007', [{ id: 'S02', cantidad: 4 }]), /ya no existe/);
});

test('borrarTorreInversa: borra por id y avisa si ya no existe; id inválido ni llama', () => {
  const { ctx, llamadas } = cargarDatos();
  assert.deepStrictEqual(aLocal(ctx.borrarTorreInversa('INV-000007')), { ok: true });
  assert.strictEqual(llamadas.borrar[0].filtro, 'id_unico=eq.INV-000007');

  const { ctx: ctx2, llamadas: ll2 } = cargarDatos({ supaBorrar_: () => [] });
  assert.throws(() => ctx2.borrarTorreInversa('INV-000007'), /ya no existe/);
  assert.throws(() => ctx2.borrarTorreInversa('HODOS-000001'), /no válido/);
  assert.strictEqual(ll2.borrar.length, 0);
});

test('contarTorresInversaPendientes: pide solo la columna id_unico y cuenta filas', () => {
  let pedido = null;
  const { ctx } = cargarDatos({
    supaGet_: (tabla, filtro, columnas) => { pedido = { tabla: tabla, filtro: filtro, columnas: columnas }; return [{ id_unico: 'a' }, { id_unico: 'b' }, { id_unico: 'c' }]; }
  });
  assert.strictEqual(ctx.contarTorresInversaPendientes(), 3);
  assert.strictEqual(pedido.tabla, 'torres_inversa');
  assert.strictEqual(pedido.columnas, 'id_unico');
});
