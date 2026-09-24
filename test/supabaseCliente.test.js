const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function filaFake(i) { return { id_unico: 'HODOS-' + String(i).padStart(6, '0') }; }
function paginaFake(n) { return Array.from({ length: n }, (_, i) => filaFake(i)); }

// contentRangesPorLlamada (opcional): array paralelo a respuestasPorLlamada con el
// valor de la cabecera Content-Range que devolvería PostgREST en cada llamada (p.ej.
// "0-499/1200"). Si se omite, simula un servidor viejo que no la manda (getHeaders()
// devuelve {}) — así los tests existentes (escritos antes del fix de Content-Range)
// siguen probando el heurístico de respaldo sin tocarlos.
function cargarConMockFetch(respuestasPorLlamada, contentRangesPorLlamada) {
  const llamadas = [];
  const ctx = {
    console,
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (nombre) {
            if (nombre === 'SUPABASE_URL') return 'https://fake.supabase.co';
            if (nombre === 'SUPABASE_SERVICE_KEY') return 'fake-key';
            return null;
          }
        };
      }
    },
    UrlFetchApp: {
      fetch: function (url, opciones) {
        const indice = llamadas.length;
        llamadas.push({ url: url, headers: opciones.headers });
        const cuerpo = typeof respuestasPorLlamada === 'function'
          ? respuestasPorLlamada(indice, opciones.headers)
          : respuestasPorLlamada[indice];
        const contentRange = contentRangesPorLlamada ? contentRangesPorLlamada[indice] : undefined;
        return {
          getResponseCode: function () { return 200; },
          getContentText: function () { return JSON.stringify(cuerpo); },
          getHeaders: function () { return contentRange ? { 'Content-Range': contentRange } : {}; }
        };
      }
    }
  };
  const src = fs.readFileSync(path.join(__dirname, '..', 'SupabaseCliente.gs'), 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'SupabaseCliente.gs' });
  return { ctx: ctx, llamadas: llamadas };
}

test('supaGet_: con "limit=" explícito hace UNA sola petición, sin cabecera Range', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(1)]);
  const resultado = ctx.supaGet_('cargas', 'limit=1');
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(llamadas[0].headers.Range, undefined);
  assert.strictEqual(resultado.length, 1);
});

test('supaGet_: sin filtro, tabla con menos de una página -> UNA petición, sin forzar ningún order', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(5)]);
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 1);
  assert.doesNotMatch(llamadas[0].url, /order=/);
  assert.strictEqual(llamadas[0].headers.Range, '0-999');
  assert.strictEqual(resultado.length, 5);
});

test('supaGet_: bug real (2026-08-12) — sin filtro contra una tabla SIN columna id_unico (p.ej. cargas) no rompe', () => {
  // La primera versión de la paginación forzaba "order=id_unico.asc" por defecto,
  // asumiendo que esa columna existe en todas las tablas — `cargas` usa id_carga, no
  // id_unico, y cualquier lectura sin filtro explotaba con "column cargas.id_unico
  // does not exist". Este test reproduce exactamente ese caso.
  const filasCarga = [{ id_carga: 'CARGA-000001', destino: 'Málaga' }, { id_carga: 'CARGA-000002', destino: 'Mijas' }];
  const { ctx, llamadas } = cargarConMockFetch([filasCarga]);
  const resultado = ctx.supaGet_('cargas', null);
  assert.strictEqual(llamadas.length, 1);
  assert.doesNotMatch(llamadas[0].url, /order=/);
  assert.doesNotMatch(llamadas[0].url, /id_unico/);
  assert.strictEqual(resultado.length, 2);
  assert.strictEqual(resultado[0].id_carga, 'CARGA-000001');
});

test('supaGet_: tabla con MÁS de una página (1084 filas) -> pagina hasta traerlas todas', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(1000), paginaFake(84)]);
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[0].headers.Range, '0-999');
  assert.strictEqual(llamadas[1].headers.Range, '1000-1999');
  assert.strictEqual(resultado.length, 1084);
  // La fila 1083 (la última, la más "reciente" si se ordena por id_unico) debe llegar —
  // exactamente el caso que antes se perdía en silencio.
  assert.strictEqual(resultado[resultado.length - 1].id_unico, 'HODOS-000083');
});

test('supaGet_: total EXACTO a un múltiplo de página -> hace una petición extra vacía para confirmar el final', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(1000), paginaFake(0)]);
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(resultado.length, 1000);
});

test('supaGet_: respeta un "order=" ya presente en el filtro, no lo duplica ni lo sobrescribe', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(3)]);
  ctx.supaGet_('etiquetas', 'estado=eq.REGISTRADO&order=fecha_creacion.asc');
  assert.match(llamadas[0].url, /order=fecha_creacion\.asc/);
  assert.doesNotMatch(llamadas[0].url, /order=id_unico\.asc/);
  // No se duplica "order=" dos veces
  const numOrders = (llamadas[0].url.match(/order=/g) || []).length;
  assert.strictEqual(numOrders, 1);
});

test('supaGet_: tabla vacía -> una petición, devuelve array vacío', () => {
  const { ctx, llamadas } = cargarConMockFetch([[]]);
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 1);
  assert.strictEqual(resultado.length, 0);
});

// Bug real (2026-09-23, revisión de seguridad): si el "Max Rows" real del proyecto
// Supabase fuera menor que SUPA_PAGE_SIZE_ (1000), una página pedida como 0-999
// volvería truncada por el SERVIDOR a, p.ej., 500 filas — sin Content-Range,
// "500 < 1000" hacía creer que ya no quedaba nada más (truncado silencioso, mismo
// incidente que v48). Con Content-Range (Prefer: count=exact) el cliente conoce el
// total real y sigue pidiendo hasta alcanzarlo, avanzando por lo que el servidor
// devolvió de verdad en cada página (no por SUPA_PAGE_SIZE_), así que nunca se salta
// las filas que el servidor capó.
test('supaGet_: Max Rows del servidor menor que SUPA_PAGE_SIZE_ (1000) -> con Content-Range, pagina hasta el total real sin saltarse filas', () => {
  const { ctx, llamadas } = cargarConMockFetch(
    [paginaFake(500), paginaFake(500), paginaFake(200)],
    ['0-499/1200', '500-999/1200', '1000-1199/1200']
  );
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 3);
  assert.strictEqual(llamadas[0].headers.Range, '0-999');
  // Clave del fix: la 2ª petición avanza por lo que el servidor devolvió (500), no
  // por SUPA_PAGE_SIZE_ (1000) — si avanzara por 1000 se saltaría las filas 500-999.
  assert.strictEqual(llamadas[1].headers.Range, '500-1499');
  assert.strictEqual(llamadas[2].headers.Range, '1000-1999');
  assert.strictEqual(resultado.length, 1200);
});

test('supaGet_: sin Content-Range (servidor viejo), sigue con el heurístico de respaldo (comportamiento previo al fix)', () => {
  const { ctx, llamadas } = cargarConMockFetch([paginaFake(1000), paginaFake(84)]);
  const resultado = ctx.supaGet_('etiquetas', null);
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(resultado.length, 1084);
});

test('supaGet_: pide "count=exact" en Prefer para poder confiar en el total de Content-Range', () => {
  const { llamadas } = (() => {
    const r = cargarConMockFetch([paginaFake(3)], ['0-2/3']);
    r.ctx.supaGet_('etiquetas', null);
    return r;
  })();
  assert.match(llamadas[0].headers.Prefer, /count=exact/);
});
