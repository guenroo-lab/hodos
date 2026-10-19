const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Pestaña «Buscar refill» (2026-10-19): palets SIE por SSCC y/o código LM, SOLO consulta. El servidor está en
// buscadorRefill.test.js; aquí, lo que hace la pantalla con él. Se prueba el JS real de Index.html.
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const esperar = () => new Promise((resolver) => setImmediate(resolver));

function bloqueRefill() {
  const m = /\/\/ ══ BUSCADOR DE REFILL: inicio ══([\s\S]*?)\/\/ ══ BUSCADOR DE REFILL: fin ══/.exec(html);
  assert.ok(m, 'faltan las marcas de inicio/fin del bloque JS del buscador de refill');
  return m[1];
}
function funcionReal(nombre) {
  const m = new RegExp('function ' + nombre + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(html);
  assert.ok(m, 'no encuentro function ' + nombre + ' en Index.html');
  return m[0];
}

// Un DOM de mentira con solo lo que toca el bloque.
function pantalla(respuestaServidor) {
  const el = (id) => ({ id, value: '', textContent: '', innerHTML: '', enfocado: 0, focus() { this.enfocado++; } });
  const elementos = {};
  ['refillSscc', 'refillCodigoLm', 'refillAviso', 'resultadosRefill'].forEach((id) => { elementos[id] = el(id); });
  const llamadas = [];
  const pendientes = [];
  const ctx = {
    document: { getElementById: (id) => elementos[id] },
    gas: (nombre, ...args) => {
      llamadas.push([nombre, args]);
      return respuestaServidor ? respuestaServidor(nombre, args) : new Promise((resolver, rechazar) => pendientes.push({ resolver, rechazar }));
    },
    llamadas, pendientes, elementos
  };
  vm.createContext(ctx);
  vm.runInContext([funcionReal('escapeHtml_'), funcionReal('mensajeError_'), funcionReal('formatearFechaHora_'), bloqueRefill()].join('\n'), ctx);
  return ctx;
}

const refill = (extra) => Object.assign({
  sscc: '00184000227900304411', codigoLm: '92186704', seccion: 'JARDIN', cotejo: 'COINCIDE', escaneadoEn: '2026-10-19T07:46:12.911+00:00',
  idCarga: 'CARGA-000657', destino: 'Mijas', fechaEntrega: '2026-10-20', horario: '8:00', estado: 'ENVIADO',
  estadoTexto: 'Enviado (carga cerrada, el camión aún no ha llegado)', cargador: '', solicitadoPor: null
}, extra);

// ── la pestaña está colocada y cableada ────────────────────────────────────────────────────────────────────────
test('la pestaña «Buscar refill» está en la barra, con su vista, y cambiarPestana la enseña/oculta', () => {
  assert.match(html, /<button data-tab="refill" onclick="cambiarPestana\('refill'\)">/);
  assert.match(html, /<span>Buscar refill<\/span>/);
  assert.match(html, /id="vistaRefill" class="vista-oculta"/);
  assert.match(html, /getElementById\('vistaRefill'\)\.classList\.toggle\('vista-oculta', nombre !== 'refill'\)/);
  assert.match(html, /if \(nombre === 'refill'\) \{ document\.getElementById\('refillSscc'\)\.focus\(\); \}/);
  // al abrir la pestaña NO se busca nada (a diferencia de «Buscar», que sí carga): solo se pone el cursor
  const cambiar = /function cambiarPestana\(nombre\) \{[\s\S]*?\n  \}/.exec(html)[0];
  assert.doesNotMatch(cambiar, /buscarRefill/);
});

test('Intro (la pistola lo manda al leer) lanza la búsqueda desde los dos campos', () => {
  assert.match(html, /\['refillSscc', 'refillCodigoLm'\]\.forEach\(function \(id\) \{ activarIntroComoAccion_\(id, buscarRefillUI_\); \}\);/);
  assert.match(html, /<button type="button" id="btnBuscarRefill" onclick="buscarRefillUI_\(\)">/);
});

test('es solo consulta: el bloque del buscador únicamente llama a buscarRefill en el servidor', () => {
  const llamadas = bloqueRefill().match(/gas\('[A-Za-z_]+'/g) || [];
  assert.deepStrictEqual(Array.from(new Set(llamadas)), ["gas('buscarRefill'"]);
  assert.doesNotMatch(bloqueRefill(), /reabrir|quitar|borrar|cerrarCarga|confirm\(|alert\(|prompt\(/i);
});

// ── tarjetas ────────────────────────────────────────────────────────────────────────────────────────────────────
test('cada resultado enseña su estado a la vista, el SSCC y los datos de su carga', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ hayMas: false, resultados: [refill()] });
  assert.match(h, /<span class="refill-badge refill-badge-ENVIADO">Enviado<\/span><span class="valor-sscc">00184000227900304411<\/span>/);
  assert.match(h, /<div class="refill-estado-texto">Enviado \(carga cerrada, el camión aún no ha llegado\)<\/div>/);
  assert.match(h, /<dt>Código LM<\/dt><dd>92186704<\/dd>/);
  assert.match(h, /<dt>Sección<\/dt><dd>JARDIN<\/dd>/);
  assert.match(h, /<dt>Carga<\/dt><dd>CARGA-000657 · Mijas<\/dd>/);
  assert.match(h, /<dt>Llegada prevista<\/dt><dd>20\/10\/2026 8:00<\/dd>/);
  assert.match(h, /<dt>Escaneado<\/dt><dd>\d{2}\/\d{2} \d{2}:\d{2}<\/dd>/);
  assert.match(h, /<dt>Inventario<\/dt><dd>Coincide con el inventario<\/dd>/);
  assert.match(h, /<span class="tabla-contador">1<\/span>/);
  assert.doesNotMatch(h, /Cargador|Solicitado por|refill-aviso-mas/);
});

test('los cuatro estados tienen su color y su etiqueta; uno desconocido se trata como «Sin carga»', () => {
  const ctx = pantalla();
  const de = (estado) => ctx.htmlResultadosRefill_({ resultados: [refill({ estado })] });
  [['EN_CARGA', 'En carga'], ['ENVIADO', 'Enviado'], ['ENTREGADO', 'Entregado'], ['SIN_CARGA', 'Sin carga']].forEach(([cod, texto]) => {
    assert.match(de(cod), new RegExp('<div class="refill-card refill-' + cod + '">'));
    assert.match(de(cod), new RegExp('refill-badge-' + cod + '">' + texto + '<'));
  });
  assert.match(de('LO_QUE_SEA'), /refill-card refill-SIN_CARGA/);
  assert.match(de(undefined), /refill-badge-SIN_CARGA">Sin carga</);
});

test('el cotejo: «No encontrado en inventario» se marca en rojo; «Sin cotejar» y lo desconocido no', () => {
  const ctx = pantalla();
  const de = (cotejo) => ctx.htmlResultadosRefill_({ resultados: [refill({ cotejo })] });
  assert.match(de('NO_ENCONTRADO'), /<dd class="refill-no-coincide">No encontrado en inventario<\/dd>/);
  assert.match(de('SIN_COTEJAR'), /<dd>Sin cotejar todavía<\/dd>/);
  assert.match(de('???'), /<dd>Sin cotejar todavía<\/dd>/);
  assert.doesNotMatch(de('COINCIDE'), /refill-no-coincide/);
});

test('cargador y «Solicitado por» salen solo si los hay', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ cargador: 'Ana, Luis', solicitadoPor: { ldap: 'jperez', motivo: 'Rotura' } })] });
  assert.match(h, /<dt>Cargador<\/dt><dd>Ana, Luis<\/dd>/);
  assert.match(h, /<dt>Solicitado por<\/dt><dd>jperez — Rotura<\/dd>/);
  const sinMotivo = ctx.htmlResultadosRefill_({ resultados: [refill({ solicitadoPor: { ldap: 'jperez', motivo: '' } })] });
  assert.match(sinMotivo, /<dd>jperez<\/dd>/);
  const vacio = ctx.htmlResultadosRefill_({ resultados: [refill({ solicitadoPor: { ldap: '', motivo: '' } })] });
  assert.doesNotMatch(vacio, /Solicitado por/);
});

test('lo que falta se ve como «—» (código LM, sección, carga, llegada, escaneo)', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ codigoLm: '', seccion: '', idCarga: '', destino: '', fechaEntrega: '', horario: '', escaneadoEn: '', estado: 'SIN_CARGA', estadoTexto: 'Sin carga asociada' })] });
  ['Código LM', 'Sección', 'Carga', 'Llegada prevista', 'Escaneado'].forEach((t) => assert.match(h, new RegExp('<dt>' + t + '</dt><dd>—</dd>')));
});

test('todo lo que viene de la base se escapa (SSCC, códigos, carga, tienda, cargador, solicitante, motivo, estado)', () => {
  const ctx = pantalla();
  const malo = '<img src=x onerror=alert(1)>';
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ sscc: malo, codigoLm: malo, seccion: malo, idCarga: malo, destino: malo, horario: malo, cargador: malo, estadoTexto: malo, solicitadoPor: { ldap: malo, motivo: malo } })] });
  assert.doesNotMatch(h, /<img/);
  assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 8);
});

test('sin resultados lo dice; con «hayMas» avisa y marca el contador con +', () => {
  const ctx = pantalla();
  assert.match(ctx.htmlResultadosRefill_({ hayMas: false, resultados: [] }), /No hay ningún refill con esos datos/);
  assert.match(ctx.htmlResultadosRefill_(null), /No hay ningún refill con esos datos/);
  assert.match(ctx.htmlResultadosRefill_(undefined), /No hay ningún refill con esos datos/);
  const h = ctx.htmlResultadosRefill_({ hayMas: true, resultados: [refill(), refill({ sscc: '2' })] });
  assert.match(h, /<span class="tabla-contador">2\+<\/span>/);
  assert.match(h, /<p class="refill-aviso-mas">Hay más resultados de los que se muestran/);
  assert.doesNotMatch(ctx.htmlResultadosRefill_({ hayMas: false, resultados: [refill()] }), /refill-aviso-mas/);
});

// ── la búsqueda ─────────────────────────────────────────────────────────────────────────────────────────────────
test('sin SSCC ni código no se llama al servidor y se avisa', () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = '   ';
  ctx.elementos.resultadosRefill.innerHTML = 'resultado anterior';
  ctx.buscarRefillUI_();
  assert.strictEqual(ctx.llamadas.length, 0);
  assert.strictEqual(ctx.elementos.refillAviso.textContent, 'Escribe un SSCC o un código LM.');
  assert.strictEqual(ctx.elementos.resultadosRefill.innerHTML, '');
});

test('buscar manda el SSCC y el código sin espacios, muestra «Buscando…» y luego los resultados', async () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = ' 00184000227900304411 ';
  ctx.elementos.refillCodigoLm.value = ' 92186704 ';
  ctx.buscarRefillUI_();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.llamadas)), [['buscarRefill', [{ sscc: '00184000227900304411', codigoLm: '92186704' }]]]);
  assert.match(ctx.elementos.resultadosRefill.innerHTML, /Buscando…/);
  ctx.pendientes[0].resolver({ hayMas: false, resultados: [refill()] });
  await esperar();
  assert.match(ctx.elementos.resultadosRefill.innerHTML, /refill-badge-ENVIADO/);
  assert.doesNotMatch(ctx.elementos.resultadosRefill.innerHTML, /Buscando/);
  assert.strictEqual(ctx.elementos.refillAviso.textContent, '');
});

test('si el servidor falla (o pide más datos) se enseña su mensaje, sin resultados viejos', async () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = '123';
  ctx.buscarRefillUI_();
  ctx.pendientes[0].rechazar(new Error('El SSCC necesita al menos 4 dígitos.'));
  await esperar();
  assert.strictEqual(ctx.elementos.refillAviso.textContent, 'El SSCC necesita al menos 4 dígitos.');
  assert.strictEqual(ctx.elementos.resultadosRefill.innerHTML, '');
  // y un error sin mensaje (texto suelto) también sale
  ctx.buscarRefillUI_();
  ctx.pendientes[1].rechazar('Fallo de red');
  await esperar();
  assert.strictEqual(ctx.elementos.refillAviso.textContent, 'Fallo de red');
});

test('una búsqueda nueva borra el aviso anterior', async () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = '123';
  ctx.buscarRefillUI_();
  ctx.pendientes[0].rechazar(new Error('mal'));
  await esperar();
  assert.strictEqual(ctx.elementos.refillAviso.textContent, 'mal');
  ctx.elementos.refillSscc.value = '304411';
  ctx.buscarRefillUI_();
  assert.strictEqual(ctx.elementos.refillAviso.textContent, '');
});

test('la búsqueda más reciente gana: una respuesta vieja que llega tarde no pisa a la nueva', async () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = '111111';
  ctx.buscarRefillUI_();
  ctx.elementos.refillSscc.value = '222222';
  ctx.buscarRefillUI_();
  ctx.pendientes[1].resolver({ resultados: [refill({ sscc: 'NUEVA' })] });
  await esperar();
  ctx.pendientes[0].resolver({ resultados: [refill({ sscc: 'VIEJA' })] });
  await esperar();
  assert.match(ctx.elementos.resultadosRefill.innerHTML, /NUEVA/);
  assert.doesNotMatch(ctx.elementos.resultadosRefill.innerHTML, /VIEJA/);
  // lo mismo con un error viejo
  ctx.elementos.refillSscc.value = '333333';
  ctx.buscarRefillUI_();
  ctx.elementos.refillSscc.value = '444444';
  ctx.buscarRefillUI_();
  ctx.pendientes[3].resolver({ resultados: [refill({ sscc: 'ULTIMA' })] });
  await esperar();
  ctx.pendientes[2].rechazar(new Error('error viejo'));
  await esperar();
  assert.match(ctx.elementos.resultadosRefill.innerHTML, /ULTIMA/);
  assert.strictEqual(ctx.elementos.refillAviso.textContent, '');
});

test('Limpiar vacía los campos, el aviso y los resultados, y descarta una respuesta que aún esté de camino', async () => {
  const ctx = pantalla();
  ctx.elementos.refillSscc.value = '304411';
  ctx.elementos.refillCodigoLm.value = '9218';
  ctx.buscarRefillUI_();
  ctx.limpiarRefillUI_();
  ctx.pendientes[0].resolver({ resultados: [refill()] });
  await esperar();
  assert.strictEqual(ctx.elementos.refillSscc.value, '');
  assert.strictEqual(ctx.elementos.refillCodigoLm.value, '');
  assert.strictEqual(ctx.elementos.refillAviso.textContent, '');
  assert.strictEqual(ctx.elementos.resultadosRefill.innerHTML, '');
  assert.strictEqual(ctx.elementos.refillSscc.enfocado, 1);
});
