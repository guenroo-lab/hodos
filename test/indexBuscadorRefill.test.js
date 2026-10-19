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

const LLEGADA = '2026-10-20T06:00:00.000Z'; // las 8:00 de Madrid del 20/10
const refill = (extra) => Object.assign({
  sscc: '00184000227900304411', codigoLm: '92186704', seccion: 'JARDIN', cotejo: 'COINCIDE', escaneadoEn: '2026-10-19T07:46:12.911+00:00',
  idCarga: 'CARGA-000657', destino: 'Mijas', fechaEntrega: '2026-10-20', horario: '8:00', llegadaEn: LLEGADA,
  cargaEmpezadaEn: '2026-10-19T07:46:08.802+00:00', cerradaEn: '2026-10-19T08:23:50.665+00:00', cerradaPor: 'rafael.perez3', informe: 'ENVIADO',
  lleva: { palets: 19, pedidos: 6 }, estado: 'ENVIADO',
  estadoTexto: 'Enviado (carga cerrada, el camión aún no ha llegado)', cargador: '', solicitadoPor: null
}, extra);
const AHORA = Date.parse(LLEGADA) - 22 * 3600000; // 22 horas antes de la llegada

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
  const h = ctx.htmlResultadosRefill_({ hayMas: false, resultados: [refill()] }, AHORA);
  assert.match(h, /<span class="refill-badge refill-badge-ENVIADO">Enviado<\/span><span class="valor-sscc">00184000227900304411<\/span>/);
  assert.match(h, /<div class="refill-estado-texto">Enviado \(carga cerrada, el camión aún no ha llegado\)<\/div>/);
  assert.match(h, /<dt>Código LM<\/dt><dd>92186704<\/dd>/);
  assert.match(h, /<dt>Sección<\/dt><dd>JARDIN<\/dd>/);
  assert.match(h, /<dt>Escaneado<\/dt><dd>\d{2}\/\d{2} \d{2}:\d{2}<\/dd>/);
  assert.match(h, /<dt>Inventario<\/dt><dd>Coincide con el inventario<\/dd>/);
  assert.match(h, /<span class="tabla-contador">1<\/span>/);
  assert.doesNotMatch(h, /Cargador|Solicitado por|refill-aviso-mas/);
});

test('cada tarjeta tiene dos bloques, «Palet» y «Camión», y en el camión salen la carga, el cierre, la llegada y lo que lleva', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ cargador: 'Sergio Sánchez' })] }, AHORA);
  assert.match(h, /<div class="refill-seccion">Palet<\/div><dl class="refill-datos">.*<\/dl><div class="refill-seccion">Camión<\/div><dl class="refill-datos">/);
  const camion = h.split('<div class="refill-seccion">Camión</div>')[1];
  assert.match(camion, /<dt>Camión \(carga\)<\/dt><dd>CARGA-000657 · Mijas<\/dd>/);
  assert.match(camion, /<dt>Empezó a cargarse<\/dt><dd>\d{2}\/\d{2} \d{2}:\d{2}<\/dd>/);
  assert.match(camion, /<dt>Cargado y cerrado<\/dt><dd>\d{2}\/\d{2} \d{2}:\d{2} · rafael\.perez3<\/dd>/);
  assert.match(camion, /<dt>Informe a la tienda<\/dt><dd>Enviado a la tienda<\/dd>/);
  assert.match(camion, /<dt>Llega a destino<\/dt><dd>Mijas · 20\/10\/2026 8:00<span class="refill-relativo">llega en 22 h<\/span><\/dd>/);
  assert.match(camion, /<dt>Lleva<\/dt><dd>19 palets refill · 6 pedidos cliente<\/dd>/);
  assert.match(camion, /<dt>Cargador<\/dt><dd>Sergio Sánchez<\/dd>/);
  // y nada del palet se cuela en el bloque del camión (ni al revés)
  assert.doesNotMatch(camion, /Código LM|Sección|Inventario|Escaneado/);
  assert.doesNotMatch(h.split('<div class="refill-seccion">Camión</div>')[0], /Llega a destino|Lleva|Cargador/);
});

test('cuánto falta o cuánto hace de la llegada: minutos, horas y días; ahora; sin fecha válida no se dice nada', () => {
  const ctx = pantalla();
  const t = Date.parse(LLEGADA);
  const dicho = (ahora, llegadaEn) => ctx.textoRelativoLlegadaRefill_(llegadaEn === undefined ? LLEGADA : llegadaEn, ahora);
  assert.strictEqual(dicho(t - 35 * 60000), 'llega en 35 min');
  assert.strictEqual(dicho(t - 3 * 60000), 'llega en 3 min'); // pocos minutos no es «ahora»
  assert.strictEqual(dicho(t + 2 * 60000), 'llegó hace 2 min');
  assert.strictEqual(dicho(t - 60000), 'llega en 1 min'); // justo el minuto: ya no es «ahora»
  assert.strictEqual(dicho(t - 75 * 60000), 'llega en 1 h'); // pasada la hora se habla en horas
  assert.strictEqual(dicho(t - 59 * 60000), 'llega en 59 min');
  assert.strictEqual(dicho(t - 22.5 * 3600000), 'llega en 23 h'); // las horas se redondean, no se cortan
  assert.strictEqual(dicho(t - 22.4 * 3600000), 'llega en 22 h');
  assert.strictEqual(dicho(t - 22 * 3600000), 'llega en 22 h');
  assert.strictEqual(dicho(t - 47 * 3600000), 'llega en 47 h');
  assert.strictEqual(dicho(t - 3 * 86400000), 'llega en 3 días');
  assert.strictEqual(dicho(t + 3 * 3600000), 'llegó hace 3 h');
  assert.strictEqual(dicho(t + 10 * 60000), 'llegó hace 10 min');
  assert.strictEqual(dicho(t + 5 * 86400000), 'llegó hace 5 días');
  assert.strictEqual(dicho(t - 30000), 'llega ahora');
  assert.strictEqual(dicho(t + 30000), 'llega ahora');
  assert.strictEqual(dicho(t, ''), '');
  assert.strictEqual(dicho(t, 'no es una fecha'), '');
  assert.strictEqual(dicho(t, null), '');
});

test('el camión según el estado: abierta = «Aún no», informe de prueba o fallido, y singular/plural de lo que lleva', () => {
  const ctx = pantalla();
  const camion = (extra) => ctx.htmlResultadosRefill_({ resultados: [refill(extra)] }, AHORA).split('<div class="refill-seccion">Camión</div>')[1];
  const abierta = camion({ estado: 'EN_CARGA', cerradaEn: '', cerradaPor: '', informe: '' });
  assert.match(abierta, /<dt>Cargado y cerrado<\/dt><dd>Aún no: la carga sigue abierta<\/dd>/);
  assert.doesNotMatch(abierta, /Informe a la tienda/);
  assert.match(camion({ informe: 'PRUEBA' }), /<dd>Modo prueba \(no se envió\)<\/dd>/);
  assert.match(camion({ informe: 'ERROR' }), /<dd>Falló el envío<\/dd>/);
  assert.match(camion({ informe: 'NO_ENVIADO' }), /<dd>No enviado<\/dd>/);
  assert.doesNotMatch(camion({ informe: 'RARO' }), /Informe a la tienda/); // un valor que no conocemos no se inventa
  assert.match(camion({ lleva: { palets: 1, pedidos: 1 } }), /<dd>1 palet refill · 1 pedido cliente<\/dd>/);
  assert.match(camion({ lleva: { palets: 0, pedidos: 0 } }), /<dd>0 palets refill · 0 pedidos cliente<\/dd>/);
  assert.doesNotMatch(camion({ lleva: null }), /Lleva/); // el conteo es un añadido: si no llegó, no se enseña
  assert.doesNotMatch(camion({ cerradaPor: '' }), /rafael/);
  assert.match(camion({ cerradaPor: '' }), /<dt>Cargado y cerrado<\/dt><dd>\d{2}\/\d{2} \d{2}:\d{2}<\/dd>/);
});

test('ya llegó: la llegada dice hace cuánto (reloj de este equipo)', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ estado: 'ENTREGADO' })] }, Date.parse(LLEGADA) + 3 * 3600000);
  assert.match(h, /<span class="refill-relativo">llegó hace 3 h<\/span>/);
  assert.match(h, /refill-badge-ENTREGADO">Entregado</);
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

test('lo que falta se ve como «—» (código LM, sección, escaneo, camión) y sin carga no salen filas inventadas del camión', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ codigoLm: '', seccion: '', idCarga: '', destino: '', fechaEntrega: '', horario: '', escaneadoEn: '', llegadaEn: '', cargaEmpezadaEn: '', cerradaEn: '', cerradaPor: '', informe: '', lleva: null, estado: 'SIN_CARGA', estadoTexto: 'Sin carga asociada' })] }, AHORA);
  ['Código LM', 'Sección', 'Escaneado', 'Camión \\(carga\\)'].forEach((t) => assert.match(h, new RegExp('<dt>' + t + '</dt><dd>—</dd>')));
  assert.doesNotMatch(h, /Empezó a cargarse|Cargado y cerrado|Informe a la tienda|Llega a destino|Lleva|refill-relativo/);
});

test('con la carga pero sin fecha de llegada válida: «Llega a destino» en «—», sin frase de cuánto falta', () => {
  const ctx = pantalla();
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ fechaEntrega: '', horario: '', llegadaEn: '' })] }, AHORA);
  assert.match(h, /<dt>Llega a destino<\/dt><dd>—<\/dd>/);
  assert.doesNotMatch(h, /refill-relativo/);
  const sinHora = ctx.htmlResultadosRefill_({ resultados: [refill({ horario: '', llegadaEn: '' })] }, AHORA);
  assert.match(sinHora, /<dd>Mijas · 20\/10\/2026<\/dd>/);
});

test('todo lo que viene de la base se escapa (SSCC, códigos, carga, tienda, cargador, solicitante, motivo, estado)', () => {
  const ctx = pantalla();
  const malo = '<img src=x onerror=alert(1)>';
  const h = ctx.htmlResultadosRefill_({ resultados: [refill({ sscc: malo, codigoLm: malo, seccion: malo, idCarga: malo, destino: malo, horario: malo, cargador: malo, cerradaPor: malo, estadoTexto: malo, solicitadoPor: { ldap: malo, motivo: malo } })] }, AHORA);
  assert.doesNotMatch(h, /<img/);
  // sscc, código, sección, carga, tienda (en «Camión» y en «Llega»), horario, cargador, quien cerró, estado, solicitante y motivo
  assert.ok((h.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 12);
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
