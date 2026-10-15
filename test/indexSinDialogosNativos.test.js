const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Regla del usuario (Pedro, repetida varias veces): NINGUNA app con diálogos del navegador (alert/confirm/prompt: salen
// con la URL fea de googleusercontent.com y rompen el diseño). Siempre un cuadro propio dentro de la página:
// mostrarModalAviso_ (avisos) y mostrarConfirmacion_ (confirmaciones). Esta prueba lo vigila en todo Index.html y
// comprueba el comportamiento de los flujos de administración que antes usaban alert()/confirm() (2026-10-15).
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const aLocal = (v) => JSON.parse(JSON.stringify(v));
const esperar = () => new Promise((resolver) => setImmediate(resolver));

// ───────────────────────── vigilante estático ─────────────────────────

// Devuelve el JS sin comentarios y con el interior de cadenas y expresiones regulares vaciado: así un «alert(» dentro
// de un comentario o de un texto no cuenta, pero una llamada real sí. El resultado sigue siendo JS válido (se usa
// para comprobar que el escáner no se ha desincronizado).
function limpiarJs(codigo) {
  let salida = '';
  let i = 0;
  let ultimo = '';
  const n = codigo.length;
  const ANTES_DE_REGEX = '(,=:[!&|?{};+-*%<>~^';
  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];
    if (c === '/' && d === '/') { while (i < n && codigo[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const fin = codigo.indexOf('*/', i + 2); i = fin === -1 ? n : fin + 2; salida += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < n && codigo[i] !== c) { if (codigo[i] === '\\') i++; i++; }
      i++;
      salida += c + c;
      ultimo = c;
      continue;
    }
    if (c === '/') {
      const previo = salida.replace(/\s+$/, '');
      const esRegex = ultimo === '' || ANTES_DE_REGEX.indexOf(ultimo) !== -1 || /(^|[^\w$])(return|typeof|case|in|of|void|delete)$/.test(previo);
      if (esRegex) {
        i++;
        let enClase = false;
        while (i < n) {
          const e = codigo[i];
          if (e === '\\') { i += 2; continue; }
          if (e === '[') enClase = true;
          else if (e === ']') enClase = false;
          else if (e === '/' && !enClase) break;
          else if (e === '\n') break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/i.test(codigo[i])) i++;
        salida += '/r/';
        ultimo = '/';
        continue;
      }
    }
    salida += c;
    if (!/\s/.test(c)) ultimo = c;
    i++;
  }
  return salida;
}

const DIALOGO_NATIVO = /\b(alert|confirm|prompt)\s*\(/;

function bloquesScript(texto) {
  const bloques = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(texto))) bloques.push(m[1]);
  return bloques;
}

test('el limpiador de JS ignora comentarios, cadenas y expresiones regulares pero ve las llamadas reales', () => {
  const sucio = "var s = 'alert(1)'; // alert(2)\n/* confirm(3) */ var r = /'alert(4)'/.test(s); var q = a / b; alert(5);\nwindow.confirm ('x'); prompt(\"y\");";
  const limpio = limpiarJs(sucio);
  const encontradas = [];
  const re = /\b(alert|confirm|prompt)\s*\(/g;
  let m;
  while ((m = re.exec(limpio))) encontradas.push(m[1]);
  assert.deepStrictEqual(encontradas, ['alert', 'confirm', 'prompt'], 'solo las 3 llamadas reales: alert(5), window.confirm y prompt');
  assert.doesNotThrow(() => new Function(limpio), 'lo limpio sigue siendo JS válido');
});

test('Index.html: el limpiador no se desincroniza (cada script, ya limpio, sigue parseando)', () => {
  const bloques = bloquesScript(html);
  assert.ok(bloques.length >= 2, 'hay al menos los dos scripts de la página');
  bloques.forEach((b, k) => assert.doesNotThrow(() => new Function(limpiarJs(b)), 'el script ' + (k + 1) + ' limpio no parsea: el escáner se perdió'));
});

test('Index.html no usa alert(), confirm() ni prompt() del navegador (ni en los scripts ni en atributos como onclick)', () => {
  const culpables = [];
  bloquesScript(html).forEach((b, k) => {
    limpiarJs(b).split('\n').forEach((linea, j) => { if (DIALOGO_NATIVO.test(linea)) culpables.push('script ' + (k + 1) + ', línea ' + (j + 1) + ': ' + linea.trim().slice(0, 80)); });
  });
  const sinScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const atributos = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi;
  let m;
  while ((m = atributos.exec(sinScripts))) { if (DIALOGO_NATIVO.test(m[1])) culpables.push('atributo de evento: ' + m[1].slice(0, 80)); }
  assert.deepStrictEqual(culpables, [], 'usar mostrarModalAviso_(titulo, texto) o mostrarConfirmacion_(mensaje, alConfirmar, titulo, textoBoton, peligro):\n' + culpables.join('\n'));
});

// ───────────────────────── entorno de ejecución (DOM de mentira) ─────────────────────────

function funcionReal(nombre) {
  const m = new RegExp('function ' + nombre + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(html);
  assert.ok(m, 'no encuentro function ' + nombre + ' en Index.html');
  return m[0];
}

class Elemento {
  constructor(id) {
    this.id = id; this.textContent = ''; this.enfocado = false; this.onclick = null; this.clases = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this.clases.add(x)),
      remove: (...c) => c.forEach((x) => this.clases.delete(x)),
      contains: (c) => this.clases.has(c),
      toggle: (c, forzar) => {
        const poner = forzar === undefined ? !this.clases.has(c) : !!forzar;
        if (poner) this.clases.add(c); else this.clases.delete(c);
        return poner;
      }
    };
  }
  focus() { this.enfocado = true; }
}

function entorno(funciones, extra) {
  const elementos = {};
  const marcados = [];
  const llamadas = [];
  const respuestas = {};
  const avisos = [];
  const confirmaciones = [];
  const contadores = { refrescos: 0, copias: 0 };
  const document = {
    getElementById: (id) => elementos[id] || (elementos[id] = new Elemento(id)),
    querySelectorAll: (sel) => (sel === '.chk-soporte:checked' ? marcados : []),
    querySelector: () => null
  };
  const ctx = Object.assign({
    document,
    setTimeout: () => 0,
    gas: (nombre, ...args) => {
      llamadas.push({ nombre, args: aLocal(args) });
      try { return Promise.resolve(respuestas[nombre] ? respuestas[nombre](...args) : undefined); } catch (e) { return Promise.reject(e); }
    },
    mostrarModalAviso_: (titulo, texto) => avisos.push({ titulo, texto }),
    mostrarConfirmacion_: (mensaje, alConfirmar, titulo, textoBoton, peligro) => confirmaciones.push({ mensaje, alConfirmar, titulo, textoBoton, peligro }),
    refrescarListaConAcciones_: () => { contadores.refrescos++; },
    ultimosResultadosInterno_: [],
    formatearFecha: () => '01/01/2026', formatearFechaHora: () => '01/01/2026 10:00', estadoMostrado_: () => 'Registrado',
    copiarTextoAlPortapapeles_: (texto, cb) => { contadores.copias++; cb(true); }
  }, extra);
  vm.createContext(ctx);
  vm.runInContext(funcionReal('mensajeError_'), ctx);
  funciones.forEach((f) => vm.runInContext(funcionReal(f), ctx));
  return { ctx, document, elementos, marcados, llamadas, respuestas, avisos, confirmaciones, contadores, el: (id) => document.getElementById(id) };
}

const marcar = (e, ids) => ids.forEach((id) => e.marcados.push({ value: id }));

// ───────────────────────── los cuadros propios ─────────────────────────

test('mostrarConfirmacion_: normal = botón «Aceptar» sin rojo ni foco forzado; al aceptar cierra y ejecuta la acción una sola vez', () => {
  const e = entorno(['mostrarConfirmacion_', 'cerrarModalConfirmar_']);
  e.el('modalConfirmar').classList.add('vista-oculta');
  let hecho = 0;
  e.ctx.mostrarConfirmacion_('¿Seguro?', () => { hecho++; }, 'Título');
  assert.strictEqual(e.el('modalConfirmarTitulo').textContent, 'Título');
  assert.strictEqual(e.el('modalConfirmarTexto').textContent, '¿Seguro?');
  assert.strictEqual(e.el('modalConfirmarBtnOk').textContent, 'Aceptar');
  assert.ok(!e.el('modalConfirmarBtnOk').classList.contains('btn-peligro'));
  assert.ok(!e.el('modalConfirmarBtnCancelar').enfocado);
  assert.ok(!e.el('modalConfirmar').classList.contains('vista-oculta'), 'el cuadro se ve');
  e.el('modalConfirmarBtnOk').onclick();
  assert.strictEqual(hecho, 1);
  assert.ok(e.el('modalConfirmar').classList.contains('vista-oculta'), 'se cierra al aceptar');
});

test('mostrarConfirmacion_: si destruye algo sale en rojo, con su texto y el foco en «Cancelar»; el siguiente cuadro normal lo deja como estaba', () => {
  const e = entorno(['mostrarConfirmacion_', 'cerrarModalConfirmar_']);
  e.ctx.mostrarConfirmacion_('¿Borrar?', () => {}, 'Borrar soporte', 'Borrar', true);
  assert.strictEqual(e.el('modalConfirmarBtnOk').textContent, 'Borrar');
  assert.ok(e.el('modalConfirmarBtnOk').classList.contains('btn-peligro'));
  assert.ok(e.el('modalConfirmarBtnCancelar').enfocado, 'foco inicial en Cancelar: un Intro sin querer no borra');
  e.ctx.mostrarConfirmacion_('Otra', () => {});
  assert.strictEqual(e.el('modalConfirmarBtnOk').textContent, 'Aceptar');
  assert.ok(!e.el('modalConfirmarBtnOk').classList.contains('btn-peligro'), 'el rojo no se queda pegado');
});

test('Esc cierra el cuadro abierto (primero el de confirmación) y nunca confirma; otras teclas no hacen nada', () => {
  const e = entorno(['cerrarModalAviso_', 'cerrarModalConfirmar_', 'cerrarModalesConEscape_']);
  const abrir = (...ids) => ['modalConfirmar', 'modalAviso'].forEach((id) => { if (ids.indexOf(id) !== -1) e.el(id).classList.remove('vista-oculta'); else e.el(id).classList.add('vista-oculta'); });
  const oculto = (id) => e.el(id).classList.contains('vista-oculta');
  let confirmado = 0;
  e.el('modalConfirmarBtnOk').onclick = () => { confirmado++; };

  abrir('modalConfirmar', 'modalAviso');
  e.ctx.cerrarModalesConEscape_({ key: 'Escape' });
  assert.ok(oculto('modalConfirmar') && !oculto('modalAviso'), 'con los dos abiertos cierra primero la confirmación');
  e.ctx.cerrarModalesConEscape_({ key: 'Escape' });
  assert.ok(oculto('modalAviso'));
  abrir('modalConfirmar');
  e.ctx.cerrarModalesConEscape_({ key: 'Enter' });
  assert.ok(!oculto('modalConfirmar'), 'otra tecla no cierra');
  e.ctx.cerrarModalesConEscape_({ key: 'Escape' });
  assert.ok(oculto('modalConfirmar'));
  assert.strictEqual(confirmado, 0, 'Esc cancela, no acepta');
  assert.doesNotThrow(() => e.ctx.cerrarModalesConEscape_({ key: 'Escape' }), 'sin ningún cuadro abierto no pasa nada');
  assert.match(html, /document\.addEventListener\('keydown', cerrarModalesConEscape_\);/, 'el manejador está enganchado');
});

test('el botón de «Cancelar» tiene su id (para el foco) y el botón rojo tiene estilo', () => {
  assert.match(html, /id="modalConfirmarBtnCancelar" onclick="cerrarModalConfirmar_\(\)"/);
  assert.match(html, /\.btn-primary\.btn-peligro \{ background:#c62828; color:#fff; \}/);
});

// ───────────────────────── flujos de administración que antes usaban alert()/confirm() ─────────────────────────

test('borrarSoporteUI_: pide confirmar en rojo y solo borra al aceptar; si falla avisa con el cuadro propio', async () => {
  const e = entorno(['borrarSoporteUI_']);
  e.ctx.borrarSoporteUI_('HODOS-000123');
  assert.strictEqual(e.confirmaciones.length, 1);
  const c = e.confirmaciones[0];
  assert.match(c.mensaje, /¿Borrar el soporte HODOS-000123\? Esta acción no se puede deshacer\./);
  assert.deepStrictEqual([c.titulo, c.textoBoton, c.peligro], ['Borrar soporte', 'Borrar', true]);
  assert.strictEqual(e.llamadas.length, 0, 'no se borra nada hasta que se acepta');
  e.respuestas.borrarSoporteAdmin = () => ({});
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.llamadas.map((l) => [l.nombre, l.args]), [['borrarSoporteAdmin', ['HODOS-000123']]]);
  assert.strictEqual(e.contadores.refrescos, 1);
  assert.strictEqual(e.avisos.length, 0);

  e.respuestas.borrarSoporteAdmin = () => { throw new Error('ya se cargó en un camión'); };
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.avisos, [{ titulo: 'No se pudo borrar', texto: 'ya se cargó en un camión' }]);
});

test('borrarSeleccionadosUI_: sin selección avisa; con selección confirma en rojo, borra, cuenta lo rechazado y refresca', async () => {
  const vacio = entorno(['borrarSeleccionadosUI_']);
  vacio.ctx.borrarSeleccionadosUI_();
  assert.deepStrictEqual(vacio.avisos, [{ titulo: 'Nada seleccionado', texto: 'No hay soportes seleccionados.' }]);
  assert.strictEqual(vacio.confirmaciones.length, 0);

  const e = entorno(['borrarSeleccionadosUI_']);
  marcar(e, ['HODOS-1', 'HODOS-2']);
  e.ctx.borrarSeleccionadosUI_();
  const c = e.confirmaciones[0];
  assert.match(c.mensaje, /¿Borrar 2 soporte\(s\) seleccionados\? Esta acción no se puede deshacer\./);
  assert.deepStrictEqual([c.titulo, c.textoBoton, c.peligro], ['Borrar soportes', 'Borrar', true]);
  assert.strictEqual(e.llamadas.length, 0);
  e.respuestas.borrarSoportesAdmin = () => ({ borrados: ['HODOS-1'], rechazados: ['HODOS-2'] });
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.llamadas[0].args, [['HODOS-1', 'HODOS-2']]);
  assert.strictEqual(e.avisos[0].titulo, 'Borrado de soportes');
  assert.match(e.avisos[0].texto, /^1 soporte\(s\) borrado\(s\)\. 1 no se pudieron borrar/);
  assert.strictEqual(e.contadores.refrescos, 1);

  e.respuestas.borrarSoportesAdmin = () => { throw new Error('sin permiso'); };
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.avisos[1], { titulo: 'No se pudo borrar', texto: 'sin permiso' });
});

test('agruparSeleccionadosUI_: pide al menos 2; confirma en rojo (los originales se borran); muestra el resultado y los avisos de INCPC', async () => {
  const uno = entorno(['agruparSeleccionadosUI_']);
  marcar(uno, ['HODOS-1']);
  uno.ctx.agruparSeleccionadosUI_();
  assert.deepStrictEqual(uno.avisos, [{ titulo: 'Faltan soportes', texto: 'Selecciona al menos 2 soportes para agrupar.' }]);
  assert.strictEqual(uno.confirmaciones.length, 0);

  const e = entorno(['agruparSeleccionadosUI_']);
  marcar(e, ['HODOS-1', 'HODOS-2']);
  e.ctx.agruparSeleccionadosUI_();
  const c = e.confirmaciones[0];
  assert.match(c.mensaje, /¿Agrupar 2 soporte\(s\) en una única etiqueta nueva\? Los soportes originales se borran\./);
  assert.deepStrictEqual([c.titulo, c.textoBoton, c.peligro], ['Agrupar soportes', 'Agrupar', true]);
  e.respuestas.agruparSoportesAdmin = () => ({ cantidadOriginal: 2, idUnicoNuevo: 'HODOS-9', avisosIncpc: ['INCPC no respondió'] });
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.llamadas[0].args, [['HODOS-1', 'HODOS-2']]);
  assert.strictEqual(e.avisos[0].titulo, 'Soportes agrupados');
  assert.match(e.avisos[0].texto, /^2 soporte\(s\) agrupados en HODOS-9\.\n\n⚠ INCPC no respondió$/);
  assert.strictEqual(e.contadores.refrescos, 1);

  e.respuestas.agruparSoportesAdmin = () => { throw new Error('destinos distintos'); };
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.avisos[1], { titulo: 'No se pudo agrupar', texto: 'destinos distintos' });
});

test('copiarResultadosUI_: sin resultados avisa; si no se puede copiar avisa; si se copia no molesta', () => {
  const sin = entorno(['copiarResultadosUI_']);
  sin.ctx.copiarResultadosUI_({ textContent: 'Copiar' });
  assert.deepStrictEqual(sin.avisos, [{ titulo: 'Nada que copiar', texto: 'No hay resultados para copiar. Busca primero.' }]);
  assert.strictEqual(sin.contadores.copias, 0);

  const fila = { numeroPedido: '1', soporteTotal: 1, origenTexto: 'Taisa', destino: 'Málaga', idUnico: 'HODOS-1', contenido: [] };
  const falla = entorno(['copiarResultadosUI_'], { ultimosResultadosInterno_: [fila], copiarTextoAlPortapapeles_: (t, cb) => cb(false) });
  const btn = { textContent: 'Copiar' };
  falla.ctx.copiarResultadosUI_(btn);
  assert.strictEqual(btn.textContent, 'No se pudo copiar');
  assert.deepStrictEqual(falla.avisos, [{ titulo: 'No se pudo copiar', texto: 'No se pudo copiar automáticamente. Selecciona y copia manualmente desde la tabla.' }]);

  const bien = entorno(['copiarResultadosUI_'], { ultimosResultadosInterno_: [fila] });
  const btn2 = { textContent: 'Copiar' };
  bien.ctx.copiarResultadosUI_(btn2);
  assert.strictEqual(btn2.textContent, '¡Copiado! (1)');
  assert.strictEqual(bien.avisos.length, 0);
});

test('guardarEdicionSoporte_: si el servidor rechaza el cambio avisa con el cuadro propio', async () => {
  const e = entorno(['guardarEdicionSoporte_']);
  const fila = { querySelectorAll: () => [] };
  e.document.querySelector = () => fila;
  e.respuestas.actualizarSoporteAdmin = () => { throw new Error('no se puede cambiar el destino de un multi-soporte'); };
  e.ctx.guardarEdicionSoporte_('HODOS-1');
  await esperar();
  assert.deepStrictEqual(e.avisos, [{ titulo: 'No se pudo guardar', texto: 'no se puede cambiar el destino de un multi-soporte' }]);
});

test('imprimir todas (INCPC, Preparación y las 4 de arrastres): un fallo se avisa con el cuadro propio, no con alert()', async () => {
  const casos = [
    ['imprimirTodasIncpc_', [], 'htmlPendientesIncpc'],
    ['imprimirTodasPreparacion_', [], 'htmlPendientesPreparacion'],
    ['imprimirTodasArrastre_', ['meco'], 'htmlPendientesArrastre']
  ];
  for (const [nombre, args, llamadaServidor] of casos) {
    const e = entorno([nombre], { ARRASTRES_: { meco: { origen: 'MECO', sufijo: 'Meco' } }, imprimirHtmlEtiquetas_: () => {} });
    e.respuestas[llamadaServidor] = () => { throw new Error('sin impresora'); };
    e.ctx[nombre](...args);
    await esperar();
    assert.deepStrictEqual(e.avisos, [{ titulo: 'Error al imprimir', texto: 'sin impresora' }], nombre);
  }
});

test('imprimirHtmlEtiquetas_: si falla y el navegador bloqueó la ventana avisa con el cuadro propio; si hay ventana escribe ahí el error', async () => {
  const sinVentana = entorno(['imprimirHtmlEtiquetas_'], { window: { open: () => null }, imprimirEnMarcoOculto_: () => {}, esperarRenderizadoParaImprimir_: () => {} });
  sinVentana.ctx.imprimirHtmlEtiquetas_(Promise.reject(new Error('Supabase caída')));
  await esperar();
  assert.deepStrictEqual(sinVentana.avisos, [{ titulo: 'Error al generar etiquetas', texto: 'Supabase caída' }]);

  const escrito = [];
  const ventana = { closed: false, document: { open: () => {}, write: (t) => escrito.push(t), close: () => {} } };
  const conVentana = entorno(['imprimirHtmlEtiquetas_'], { window: { open: () => ventana }, imprimirEnMarcoOculto_: () => {}, esperarRenderizadoParaImprimir_: () => {} });
  conVentana.ctx.imprimirHtmlEtiquetas_(Promise.reject(new Error('Supabase caída')));
  await esperar();
  assert.ok(escrito.indexOf('Error al generar etiquetas: Supabase caída') !== -1);
  assert.strictEqual(conVentana.avisos.length, 0, 'con ventana abierta el error va a esa ventana, sin cuadro');
});
