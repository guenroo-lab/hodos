const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// EstructuraPaletes.gs define sus propias leerPaletesPorCarga_/insertarPalet_ — un
// stub puesto directo en el ctx antes de runInContext se pierde (la declaración de
// función del propio archivo lo pisa al cargar). Hay que stubear su dependencia real:
// supaGet_/supaInsertar_ (SupabaseCliente.gs, no cargado aquí).
function contextoPaletes(stubs) {
  const llamadasLock = [];
  const ctx = Object.assign({
    console: console,
    Session: { getActiveUser: () => ({ getEmail: () => 'op@x.com' }) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => llamadasLock.push('waitLock'),
        releaseLock: () => llamadasLock.push('releaseLock')
      })
    },
    _llamadasLock: llamadasLock
  }, stubs);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'EstructuraPaletes.gs'), 'utf8'), ctx, { filename: 'EstructuraPaletes.gs' });
  return ctx;
}

test('escanearPaletSSCC_: toma y libera el lock, inserta si el SSCC no estaba ya en esta carga', () => {
  let insertado = null;
  const ctx = contextoPaletes({
    supaGet_: () => [],
    supaInsertar_: (tabla, filas) => { insertado = { tabla, filas }; return filas; }
  });
  const r = ctx.escanearPaletSSCC_('CARGA-1', '030176010452797723');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, tipo: 'palet', sscc: '030176010452797723' });
  assert.strictEqual(insertado.tabla, 'palets');
  assert.strictEqual(insertado.filas[0].sscc, '030176010452797723');
  assert.strictEqual(insertado.filas[0].batea_id, 'CARGA-1');
  assert.strictEqual(insertado.filas[0].creado_por, 'op@x.com');
  assert.deepStrictEqual(ctx._llamadasLock, ['waitLock', 'releaseLock']);
});

test('escanearPaletSSCC_: reintentar el mismo SSCC no inserta de nuevo, marca repetido:true', () => {
  let vecesInsertado = 0;
  const ctx = contextoPaletes({
    supaGet_: () => [{ id: 1, sscc: '030176010452797723', batea_id: 'CARGA-1' }],
    supaInsertar_: () => { vecesInsertado++; return []; }
  });
  const r = ctx.escanearPaletSSCC_('CARGA-1', '030176010452797723');
  assert.strictEqual(vecesInsertado, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, tipo: 'palet', sscc: '030176010452797723', repetido: true });
});

// Bug real (2026-09-23, revisión de seguridad): sin el lock, dos escaneos casi
// simultáneos del mismo SSCC podían leer ambos "no existe todavía" e insertar dos
// filas duplicadas (sin UNIQUE en `sscc` a nivel de Supabase). Este test no reproduce
// la carrera real (Node es single-thread), pero confirma que el lock se toma ANTES de
// leer y se libera SIEMPRE, incluso si la escritura falla — la propiedad que cierra la
// ventana en producción (mismo patrón que obtenerOCrearCarga en Backend.gs).
test('escanearPaletSSCC_: libera el lock incluso si supaInsertar_ lanza', () => {
  const ctx = contextoPaletes({
    supaGet_: () => [],
    supaInsertar_: () => { throw new Error('Supabase caída'); }
  });
  assert.throws(() => ctx.escanearPaletSSCC_('CARGA-1', '030176010452797723'), /Supabase caída/);
  assert.deepStrictEqual(ctx._llamadasLock, ['waitLock', 'releaseLock']);
});

test('esFormatoSSCC_: acepta un SSCC de 18 dígitos con dígito de control válido', () => {
  const ctx = contextoPaletes({});
  assert.strictEqual(ctx.esFormatoSSCC_('030176010452797723'), true);
});

test('esFormatoSSCC_: rechaza un número de pedido normal (no tiene forma de SSCC)', () => {
  const ctx = contextoPaletes({});
  assert.strictEqual(ctx.esFormatoSSCC_('286676'), false);
});

test('esFormatoSSCC_: rechaza 18 dígitos con dígito de control incorrecto', () => {
  const ctx = contextoPaletes({});
  assert.strictEqual(ctx.esFormatoSSCC_('030176010452797720'), false);
});

// Bug real (2026-09-24): codSeccion (número de sección, para el B2B) es un campo
// DISTINTO de seccion (nombre del departamento, para el informe) — confirma que
// actualizarPalet_ manda ambos por separado a Supabase (cod_seccion/seccion) y que la
// lectura los separa igual de vuelta, sin que uno se pise con el otro.
test('actualizarPalet_: manda seccion y codSeccion como columnas separadas (cod_seccion/seccion)', () => {
  let enviado = null;
  const ctx = contextoPaletes({
    supaActualizar_: (tabla, filtro, cambios) => {
      enviado = { tabla, filtro, cambios };
      return [{ id: 5, sscc: 'X', seccion: cambios.seccion, cod_seccion: cambios.cod_seccion, encontrado: true }];
    }
  });
  const r = ctx.actualizarPalet_(5, { seccion: 'CARPINTERIA Y MADERA', codSeccion: '1', encontrado: true });
  assert.strictEqual(enviado.cambios.seccion, 'CARPINTERIA Y MADERA');
  assert.strictEqual(enviado.cambios.cod_seccion, '1');
  assert.strictEqual(r.seccion, 'CARPINTERIA Y MADERA');
  assert.strictEqual(r.codSeccion, '1');
});
