const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// «Historial reciente» (pestaña Cargar etiquetas): debajo de cada lote salen los números de pedido que se
// registraron en él (2026-10-15). El servidor está en egressHistorialLotes.test.js; aquí, lo que hace la pantalla.
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const esperar = () => new Promise((resolver) => setImmediate(resolver));

// Funciones reales de Index.html (se prueba el código que se sirve, no una copia).
function funcionReal(nombre) {
  const m = new RegExp('function ' + nombre + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(html);
  assert.ok(m, 'no encuentro function ' + nombre + ' en Index.html');
  return m[0];
}
function constanteReal(nombre) {
  const m = new RegExp('var ' + nombre + ' = [^;]+;').exec(html);
  assert.ok(m, 'no encuentro var ' + nombre + ' en Index.html');
  return m[0];
}

function pantalla(lotesDelServidor) {
  const cont = { innerHTML: '' };
  const ctx = {
    document: { getElementById: (id) => (id === 'historialPedidos' ? cont : null) },
    console: { error: () => {} },
    gas: (nombre, ...args) => { ctx.llamadas.push([nombre, args]); return Promise.resolve(lotesDelServidor); },
    llamadas: []
  };
  vm.createContext(ctx);
  vm.runInContext([funcionReal('escapeHtml_'), constanteReal('MAX_PEDIDOS_HISTORIAL_'), funcionReal('htmlNumerosPedidoHistorial_'), funcionReal('cargarHistorial')].join('\n'), ctx);
  return { ctx, cont };
}

const lote = (extra) => Object.assign({ loteId: 'L1', cantidad: 3, origenTexto: 'MECO', destino: 'Mijas', fecha: '2026-10-15T06:00:00Z', pedidos: ['100200', '100300', '100400'] }, extra);

test('historial: cada lote enseña sus números de pedido debajo de la línea de siempre', async () => {
  const { ctx, cont } = pantalla([lote()]);
  ctx.cargarHistorial();
  await esperar();
  assert.deepStrictEqual(ctx.llamadas, [['obtenerHistorialLotes', [10]]]);
  assert.match(cont.innerHTML, /<strong>3 pedidos<\/strong> \| MECO &rarr; Mijas/);
  assert.match(cont.innerHTML, /<span class="historial-numeros">100200 &middot; 100300 &middot; 100400<\/span>/);
});

test('historial: un lote sin números (o un servidor anterior que no los manda) sale como antes, sin línea vacía', async () => {
  const { ctx, cont } = pantalla([lote({ pedidos: [] }), lote({ loteId: 'L2', pedidos: undefined })]);
  ctx.cargarHistorial();
  await esperar();
  assert.doesNotMatch(cont.innerHTML, /historial-numeros/);
  assert.strictEqual((cont.innerHTML.match(/class="pedido-item"/g) || []).length, 2);
});

test('historial: los números se escapan (nada de HTML suelto desde la base de datos)', async () => {
  const { ctx, cont } = pantalla([lote({ pedidos: ['<img src=x onerror=alert(1)>', 'a"b'] })]);
  ctx.cargarHistorial();
  await esperar();
  assert.doesNotMatch(cont.innerHTML, /<img/);
  assert.match(cont.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt; &middot; a&quot;b/);
});

test('historial: hasta 30 números a la vista; el resto, tras «+N más» en un <details>', () => {
  const { ctx } = pantalla([]);
  const numeros = (n) => Array.from({ length: n }, (_, i) => String(100000 + i));
  assert.doesNotMatch(ctx.htmlNumerosPedidoHistorial_(numeros(30)), /details/);
  const html31 = ctx.htmlNumerosPedidoHistorial_(numeros(31));
  assert.match(html31, /<details class="historial-mas"><summary>\+1 más<\/summary>100030<\/details>/);
  const html75 = ctx.htmlNumerosPedidoHistorial_(numeros(75));
  assert.match(html75, /<summary>\+45 más<\/summary>/);
  // los 30 primeros fuera del <details>, en su orden
  const antes = html75.split('<details')[0];
  assert.strictEqual((antes.match(/\d{6}/g) || []).length, 30);
  assert.match(antes, /100000 &middot; 100001/);
  // y los 45 restantes dentro
  assert.strictEqual((html75.split('<details')[1].match(/\d{6}/g) || []).length, 45);
});

test('historial: también se escapan los números que quedan dentro del «+N más»', () => {
  const { ctx } = pantalla([]);
  const numeros = Array.from({ length: 30 }, (_, i) => String(100000 + i)).concat(['<script>x</script>', 'z&w']);
  const resultado = ctx.htmlNumerosPedidoHistorial_(numeros);
  assert.doesNotMatch(resultado, /<script>/);
  assert.match(resultado, /<summary>\+2 más<\/summary>&lt;script&gt;x&lt;\/script&gt; &middot; z&amp;w<\/details>/);
});

test('historial: sin lotes sigue diciendo «Sin lotes recientes.»', async () => {
  const { ctx, cont } = pantalla([]);
  ctx.cargarHistorial();
  await esperar();
  assert.match(cont.innerHTML, /Sin lotes recientes/);
});
