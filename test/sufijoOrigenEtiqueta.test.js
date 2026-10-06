const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// "Línea de abajo" de la etiqueta de arrastres (Antequera, 2026-10-06): MacroArrastres manda, junto a pedidosTexto,
// `sufijosOrigen` (array alineado 1:1) con el nº de pedido proveedor de cada etiqueta ("PED. PROV. 81406165"). Se guarda
// tras " · " en origenTexto y la etiqueta lo pinta en una línea aparte, más pequeña, justo bajo el origen.

function aRealmLocal(valor) { return JSON.parse(JSON.stringify(valor)); }

function cargar(ficheros, stubs) {
  const ctx = Object.assign({
    Utilities: { getUuid: () => 'uuid-1', formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getActiveUser: () => ({ getEmail: () => 'a@b.com' }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'token-real' }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    supaActualizar_: () => [],
    siguienteBloqueIdsEtiquetas_: (n) => Array.from({ length: n }, (_, i) => 'HODOS-' + String(i + 1).padStart(6, '0'))
  }, stubs);
  vm.createContext(ctx);
  ficheros.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx));
  return ctx;
}

test('origenTextoConSufijo: sin sufijo devuelve el origen tal cual; con sufijo lo añade tras " · " y limpia espacios', () => {
  const ctx = cargar(['Utilidades.gs']);
  assert.strictEqual(ctx.origenTextoConSufijo('ANTEQUERA', ''), 'ANTEQUERA');
  assert.strictEqual(ctx.origenTextoConSufijo('ANTEQUERA', undefined), 'ANTEQUERA');
  assert.strictEqual(ctx.origenTextoConSufijo('ANTEQUERA', null), 'ANTEQUERA');
  assert.strictEqual(ctx.origenTextoConSufijo('ANTEQUERA', '  PED. PROV.   81406165 '), 'ANTEQUERA · PED. PROV. 81406165');
});

test('registrarLote: cada etiqueta guarda SU sufijo en origenTexto (alineado con las líneas)', () => {
  let filas = null;
  const ctx = cargar(['Utilidades.gs', 'Backend.gs'], { insertarEtiquetas_: (f) => { filas = f; return f; } });
  ctx.registrarLote({
    pedidosTexto: '986016\n986950+986917\n987051', origen: 'Antequera', destino: 'Marbella', expedicion: '73142',
    sufijosOrigen: ['PED. PROV. 81406165', 'PED. PROV. 81402974 / 81402975', '']
  });
  assert.deepStrictEqual(aRealmLocal(filas.map(f => f.origenTexto)), [
    'ANTEQUERA · PED. PROV. 81406165', 'ANTEQUERA · PED. PROV. 81402974 / 81402975', 'ANTEQUERA'
  ]);
});

test('registrarLote: sufijosOrigen que NO está alineado con las líneas se ignora (nunca descoloca etiquetas)', () => {
  let filas = null;
  const ctx = cargar(['Utilidades.gs', 'Backend.gs'], { insertarEtiquetas_: (f) => { filas = f; return f; } });
  ctx.registrarLote({ pedidosTexto: '111\n222', origen: 'Antequera', destino: 'Marbella', sufijosOrigen: ['PED. PROV. 1'] });
  assert.deepStrictEqual(aRealmLocal(filas.map(f => f.origenTexto)), ['ANTEQUERA', 'ANTEQUERA']);
});

test('registrarLote sin sufijosOrigen: origenTexto exactamente como siempre (MECO, Taisa, Cesión no cambian)', () => {
  let filas = null;
  const ctx = cargar(['Utilidades.gs', 'Backend.gs'], { insertarEtiquetas_: (f) => { filas = f; return f; } });
  ctx.registrarLote({ pedidosTexto: '111', origen: 'MECO', destino: 'Málaga' });
  assert.strictEqual(filas[0].origenTexto, 'MECO');
  ctx.registrarLote({ pedidosTexto: '111', origen: 'Taisa', subtipo: 'Devolución', destino: 'Málaga' });
  assert.strictEqual(filas[0].origenTexto, 'TAISA - DEVOLUCIÓN');
});

test('origenInfoHtml_: sin sufijo es el HTML de siempre; con sufijo, un bloque con origen grande y línea de abajo pequeña', () => {
  const ctx = cargar(['Utilidades.gs', 'Backend.gs']);
  assert.strictEqual(ctx.origenInfoHtml_('ANTEQUERA'), '<div class="origen-info">ANTEQUERA</div>');
  assert.strictEqual(ctx.origenInfoHtml_('TAISA - ROTURA'), '<div class="origen-info">TAISA - ROTURA</div>');
  assert.strictEqual(ctx.origenInfoHtml_('ANTEQUERA · PED. PROV. 81406165'),
    '<div class="origen-bloque"><div class="origen-info">ANTEQUERA</div><div class="origen-prov">PED. PROV. 81406165</div></div>');
});

test('origenInfoHtml_ escapa el HTML del sufijo', () => {
  const ctx = cargar(['Utilidades.gs', 'Backend.gs']);
  const h = ctx.origenInfoHtml_('ANTEQUERA · <b>x</b> & y');
  assert.ok(!/<b>/.test(h) && /&lt;b&gt;x&lt;\/b&gt; &amp; y/.test(h), h);
});

test('la etiqueta física imprime la línea de abajo en una línea aparte bajo ANTEQUERA, y las demás no cambian', () => {
  const ctx = cargar(['Utilidades.gs', 'Barcode.gs', 'Backend.gs']);
  const base = { idUnico: 'HODOS-000001', numeroPedido: '986016', soporteNum: 1, soporteTotal: 1, destino: 'Marbella' };
  const con = ctx.htmlUnaEtiqueta_(Object.assign({ origenTexto: 'ANTEQUERA · PED. PROV. 81406165' }, base), '06/10/2026');
  const sin = ctx.htmlUnaEtiqueta_(Object.assign({ origenTexto: 'ANTEQUERA' }, base), '06/10/2026');
  assert.match(con, /<div class="origen-info">ANTEQUERA<\/div><div class="origen-prov">PED\. PROV\. 81406165<\/div>/);
  assert.ok(con.indexOf('origen-prov') < con.indexOf('etiqueta-bottom'), 'la línea de abajo va antes del código de barras');
  assert.ok(sin.indexOf('origen-prov') === -1 && /<div class="origen-info">ANTEQUERA<\/div>/.test(sin));
  // la hoja de estilos de la etiqueta define la clase nueva
  const css = ctx.envolverEtiquetasHtml_(con);
  assert.match(css, /\.origen-prov\{font-size:15px/);
});

test('un grupo de 4-5 pedidos CON línea de abajo se compacta (si no, se salía 3 mm de la etiqueta); sin ella, no cambia', () => {
  const ctx = cargar(['Utilidades.gs', 'Barcode.gs', 'Backend.gs']);
  const e = (num, origenTexto) => ({ idUnico: 'HODOS-000002', numeroPedido: num, soporteNum: 1, soporteTotal: 1, destino: 'Marbella', origenTexto: origenTexto });
  const cinco = '1+2+3+4+5';
  assert.match(ctx.htmlUnaEtiqueta_(e(cinco, 'ANTEQUERA · PED. PROV. 9'), 'f'), /numero-pedido-h numero-pedido-grupo con-prov/);
  assert.match(ctx.htmlUnaEtiqueta_(e('1+2+3+4', 'ANTEQUERA · PED. PROV. 9'), 'f'), /con-prov/);
  assert.ok(!/con-prov/.test(ctx.htmlUnaEtiqueta_(e(cinco, 'ANTEQUERA'), 'f')), 'sin línea de abajo: igual que siempre');
  assert.ok(!/con-prov/.test(ctx.htmlUnaEtiqueta_(e('1+2', 'ANTEQUERA · PED. PROV. 9'), 'f')), 'grupo pequeño: no hace falta');
  assert.ok(!/con-prov/.test(ctx.htmlUnaEtiqueta_(e('986016', 'ANTEQUERA · PED. PROV. 9'), 'f')), 'un solo pedido: no hace falta');
  assert.ok(!/con-prov/.test(ctx.htmlUnaEtiqueta_(e('1+2+3+4+5+6', 'ANTEQUERA · PED. PROV. 9'), 'f')), '6 o más se resumen como AGRUPACIÓN (N): una sola línea');
  assert.match(ctx.envolverEtiquetasHtml_('x'), /\.numero-pedido-grupo\.con-prov\{line-height:1\.15;\}/);
});

test('crearLoteArrastre: pasa los sufijos alineados a registrarLote', () => {
  const llamadas = [];
  const ctx = cargar(['Utilidades.gs', 'IntegracionIncpc.gs'], {
    registrarLote: (d) => { llamadas.push(d); return { ids: ['H1', 'H2'], loteId: 'L1' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Antequera', destino: 'Marbella', pedidosTexto: '111\n222', expedicion: '73142',
    sufijosOrigen: ['PED. PROV. 1', 'PED. PROV. 2']
  });
  assert.deepStrictEqual(aRealmLocal(llamadas[0].sufijosOrigen), ['PED. PROV. 1', 'PED. PROV. 2']);
});

test('crearLoteArrastre: al omitir un pedido ya creado en la expedición, el sufijo de los demás sigue en su sitio', () => {
  const llamadas = [];
  const ctx = cargar(['Utilidades.gs', 'IntegracionIncpc.gs'], {
    registrarLote: (d) => { llamadas.push(d); return { ids: ['H1', 'H2'], loteId: 'L1' }; },
    leerEtiquetas_: () => [{ numeroPedido: '111' }]
  });
  const r = ctx.crearLoteArrastreDesdeMacroArrastres_({
    origen: 'Antequera', destino: 'Marbella', pedidosTexto: '111\n222\n333', expedicion: '73142',
    sufijosOrigen: ['PED. PROV. 1', 'PED. PROV. 2', 'PED. PROV. 3']
  });
  assert.strictEqual(llamadas[0].pedidosTexto, '222\n333');
  assert.deepStrictEqual(aRealmLocal(llamadas[0].sufijosOrigen), ['PED. PROV. 2', 'PED. PROV. 3']);
  assert.deepStrictEqual(aRealmLocal(r.omitidos), ['111']);
});

test('crearLoteArrastre: sin sufijos (Valencia, Torija, Meco…) registrarLote recibe lo de siempre, sin la clave', () => {
  const llamadas = [];
  const ctx = cargar(['Utilidades.gs', 'IntegracionIncpc.gs'], {
    registrarLote: (d) => { llamadas.push(d); return { ids: ['H1'], loteId: 'L1' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteArrastreDesdeMacroArrastres_({ origen: 'Valencia', destino: 'Mijas', pedidosTexto: '111', expedicion: 'E1' });
  assert.ok(!('sufijosOrigen' in llamadas[0]));
  ctx.crearLoteArrastreDesdeMacroArrastres_({ origen: 'Valencia', destino: 'Mijas', pedidosTexto: '111\n222', expedicion: 'E2', sufijosOrigen: ['solo uno'] });
  assert.ok(!('sufijosOrigen' in llamadas[1]), 'desalineado -> se ignora');
});

test('crearLoteArrastre MECO: ignora los sufijos (colapsa duplicados y los desalinearía)', () => {
  const llamadas = [];
  const ctx = cargar(['Utilidades.gs', 'IntegracionIncpc.gs'], {
    registrarLote: (d) => { llamadas.push(d); return { ids: ['H1', 'H2'], loteId: 'L1' }; },
    leerEtiquetas_: () => []
  });
  ctx.crearLoteArrastreDesdeMacroArrastres_({ origen: 'MECO', destino: 'Málaga', pedidosTexto: '111\n111\n222', expedicion: 'E1', sufijosOrigen: ['a', 'b', 'c'] });
  assert.strictEqual(llamadas[0].pedidosTexto, '111\n222');
  assert.ok(!('sufijosOrigen' in llamadas[0]));
});
