const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FILAS_CATALOGO = [
  ['ID_Soporte', 'Nombre_Soporte', 'Imagen', 'Volumen_M3', 'Tipo_Soporte'],
  ['S01', 'EUROPEO', '', '', 'Palet'],
  ['S16', 'JAULA', '', '', 'Jaula Completa']
];

// Tabla en memoria: permite probar el consumo único de verdad (la segunda llamada no encuentra nada).
function cargarConTabla(filasIniciales, extra) {
  const tabla = filasIniciales.slice();
  const llamadas = { borrar: [], insertar: [] };
  const ctx = Object.assign({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: {
      createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }),
      MimeType: { JSON: 'JSON' }
    },
    Utilities: { formatDate: () => '06/10/2026' },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    supaBorrar_: (nombreTabla, filtro) => {
      llamadas.borrar.push({ tabla: nombreTabla, filtro: filtro });
      const id = decodeURIComponent(filtro.split('eq.')[1]);
      const i = tabla.findIndex((f) => f.id_unico === id);
      return i === -1 ? [] : tabla.splice(i, 1);
    },
    supaInsertar_: (nombreTabla, filas) => {
      llamadas.insertar.push({ tabla: nombreTabla, filas: filas });
      filas.forEach((f) => {
        if (tabla.some((t) => t.id_unico === f.id_unico)) {
          throw new Error('supaInsertar_(torres_inversa): {"code":"23505","message":"duplicate key value violates unique constraint"}');
        }
        tabla.push(f);
      });
      return filas;
    }
  }, extra);
  vm.createContext(ctx);
  ['Utilidades.gs', 'PrecargaInversa.gs', 'IntegracionIncpc.gs'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  });
  ctx.leerFilasCatalogoInversa_ = () => FILAS_CATALOGO;
  return { ctx: ctx, tabla: tabla, llamadas: llamadas };
}

function llamarDoPost(ctx, cuerpo) {
  const resp = ctx.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(resp.getContent());
}

const TORRE = {
  id_unico: 'INV-000007',
  lineas: [{ id: 'S01', nombre: 'EUROPEO', cantidad: 5 }, { id: 'S16', nombre: 'JAULA', cantidad: 5 }],
  total_soportes: 10,
  creado_por: 'ana@taisa.test',
  fecha_creacion: '2026-10-06T08:00:00.000Z'
};

test('consumirTorreInversa: borra la torre y devuelve su contenido', () => {
  const { ctx, tabla, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'inv-000007' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.id, 'INV-000007');
  assert.strictEqual(r.total, 10);
  assert.strictEqual(r.lineas.length, 2);
  assert.strictEqual(r.lineas[0].nombre, 'EUROPEO');
  assert.strictEqual(r.creadaEn, '2026-10-06T08:00:00.000Z');
  assert.strictEqual(tabla.length, 0);
  assert.strictEqual(llamadas.borrar[0].tabla, 'torres_inversa');
  assert.strictEqual(llamadas.borrar[0].filtro, 'id_unico=eq.INV-000007');
});

test('consumirTorreInversa: dos bips de la misma torre — solo el primero la consume', () => {
  const { ctx } = cargarConTabla([Object.assign({}, TORRE)]);
  const primero = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000007' });
  const segundo = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000007' });
  assert.strictEqual(primero.ok, true);
  assert.strictEqual(segundo.ok, false);
  assert.strictEqual(segundo.motivo, 'NO_EXISTE');
});

test('consumirTorreInversa: torre inexistente -> NO_EXISTE', () => {
  const { ctx } = cargarConTabla([]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'INV-000999' });
  assert.deepStrictEqual(r, { ok: false, motivo: 'NO_EXISTE' });
});

test('consumirTorreInversa: código que no es de torre -> error legible y no toca Supabase', () => {
  const { ctx, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'consumirTorreInversa', token: 'token-real', id: 'HODOS-000001' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no válido/);
  assert.strictEqual(llamadas.borrar.length, 0);
});

test('consumir/devolver: token inválido no ejecuta nada', () => {
  const { ctx, llamadas } = cargarConTabla([Object.assign({}, TORRE)]);
  ['consumirTorreInversa', 'devolverTorreInversa'].forEach((accion) => {
    const r = llamarDoPost(ctx, { accion: accion, token: 'malo', id: 'INV-000007', lineas: TORRE.lineas });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /[Tt]oken/);
  });
  assert.strictEqual(llamadas.borrar.length, 0);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('devolverTorreInversa: recrea la torre con el mismo id, validando contra el catálogo', () => {
  const { ctx, tabla, llamadas } = cargarConTabla([]);
  const r = llamarDoPost(ctx, {
    accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007',
    lineas: [{ id: 'S01', nombre: 'LO QUE SEA', cantidad: 5 }, { id: 'S16', cantidad: 5 }],
    creadaEn: '2026-10-06T08:00:00Z'
  });
  assert.deepStrictEqual(r, { ok: true, id: 'INV-000007' });
  assert.strictEqual(tabla.length, 1);
  const fila = llamadas.insertar[0].filas[0];
  assert.strictEqual(fila.id_unico, 'INV-000007');
  assert.strictEqual(fila.total_soportes, 10);
  assert.strictEqual(fila.fecha_creacion, '2026-10-06T08:00:00.000Z');
  assert.strictEqual(fila.lineas[0].nombre, 'EUROPEO', 'el nombre sale del catálogo, no del cliente');
});

test('devolverTorreInversa: si la torre ya existe -> YA_EXISTE y no la toca', () => {
  const { ctx, tabla } = cargarConTabla([Object.assign({}, TORRE)]);
  const r = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007', lineas: [{ id: 'S01', cantidad: 1 }] });
  assert.deepStrictEqual(r, { ok: false, motivo: 'YA_EXISTE' });
  assert.strictEqual(tabla.length, 1);
  assert.strictEqual(tabla[0].total_soportes, 10);
});

test('devolverTorreInversa: líneas inválidas o tipo desconocido -> error y no inserta', () => {
  const { ctx, llamadas } = cargarConTabla([]);
  const mal = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007', lineas: [{ id: 'S77', cantidad: 1 }] });
  assert.strictEqual(mal.ok, false);
  assert.match(mal.error, /desconocido/);
  const sin = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000007' });
  assert.strictEqual(sin.ok, false);
  assert.match(sin.error, /Faltan los soportes/);
  assert.strictEqual(llamadas.insertar.length, 0);
});

test('devolverTorreInversa: sin fecha válida no manda fecha_creacion (la pone la base)', () => {
  const { ctx, llamadas } = cargarConTabla([]);
  llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000008', lineas: [{ id: 'S01', cantidad: 2 }], creadaEn: 'basura' });
  assert.ok(!('fecha_creacion' in llamadas.insertar[0].filas[0]));
});

test('devolverTorreInversa: un error de Supabase distinto de duplicado sube como error', () => {
  const { ctx } = cargarConTabla([], {
    supaInsertar_: () => { throw new Error('supaInsertar_(torres_inversa): connection refused'); }
  });
  const r = llamarDoPost(ctx, { accion: 'devolverTorreInversa', token: 'token-real', id: 'INV-000009', lineas: [{ id: 'S01', cantidad: 2 }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /connection refused/);
});
