const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Cargas activas, cargador obligatorio y reapertura (2026-10-15), lado pantalla del muelle (?vista=operario).
// La lógica del servidor está en cargasReapertura.test.js; aquí se comprueba lo que hace la pantalla con ella.
// El JS nuevo va entre dos marcas en Index.html para poder ejecutarlo aparte, con un DOM de mentira.
const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const aLocal = (valor) => JSON.parse(JSON.stringify(valor));
const esperar = () => new Promise((resolver) => setImmediate(resolver));

function bloqueCargas() {
  const m = /\/\/ ══ CARGAS ACTIVAS Y CARGADOR: inicio ══([\s\S]*?)\/\/ ══ CARGAS ACTIVAS Y CARGADOR: fin ══/.exec(html);
  assert.ok(m, 'faltan las marcas de inicio/fin del bloque JS de cargas activas');
  return m[1];
}

// Función real de Index.html (se prueba que escapa de verdad, no una copia).
function funcionReal(nombre) {
  const m = new RegExp('function ' + nombre + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(html);
  assert.ok(m, 'no encuentro function ' + nombre + ' en Index.html');
  return m[0];
}

class Elemento {
  constructor(id) {
    this.id = id; this.textContent = ''; this.innerHTML = ''; this.value = ''; this.disabled = false; this.placeholder = '';
    this.attrs = {}; this.oyentes = {}; this.opciones = []; this.clases = new Set(); this.desplazado = false;
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
    Object.defineProperty(this, 'options', { get: () => this.opciones });
  }
  getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; }
  setAttribute(n, v) { this.attrs[n] = String(v); }
  addEventListener(tipo, f) { this.oyentes[tipo] = f; }
  focus() {}
  scrollIntoView() { this.desplazado = true; }
  insertAdjacentHTML(_pos, texto) { const m = /value="([^"]*)"/.exec(texto); this.opciones.push({ value: m ? m[1] : '' }); }
}

function crearEntorno(extra) {
  const elementos = {};
  const chipsCargador = [];
  const document = {
    getElementById: (id) => elementos[id] || (elementos[id] = new Elemento(id)),
    querySelectorAll: (sel) => (sel.indexOf('.cargador-chip') !== -1 ? chipsCargador : [])
  };
  const llamadas = [];
  const respuestas = {};
  const avisos = [];
  const confirmaciones = [];
  const pasos = [];
  const entorno = {
    document, llamadas, respuestas, avisos, confirmaciones, pasos, chipsCargador, elementos,
    el: (id) => document.getElementById(id)
  };
  const ctx = Object.assign({
    document,
    gas: (nombre, ...args) => {
      llamadas.push({ nombre, args: aLocal(args) });
      try { return Promise.resolve(respuestas[nombre] ? respuestas[nombre](...args) : undefined); } catch (e) { return Promise.reject(e); }
    },
    escapeHtml_: undefined,
    TIENDA_SLUG_: { 'Málaga': 'malaga', 'Marbella': 'marbella', 'Mijas': 'mijas', 'Granada': 'granada' },
    fechaComoValorInput_: () => '2026-10-15',
    mostrarModalAviso_: (titulo, texto) => avisos.push({ titulo, texto }),
    mostrarConfirmacion_: (mensaje, alConfirmar, titulo, boton) => confirmaciones.push({ mensaje, alConfirmar, titulo, boton }),
    marcarTiendaCamionSeleccionada_: (t) => { ctx.camionDestinoSeleccionado = t; },
    poblarHorarios_: () => Promise.resolve([]),
    marcarChipSeleccionado_: () => {},
    renderizarListaPalets_: () => {},
    renderizarListaCamion_: () => {},
    actualizarStepper_: (n) => pasos.push(n),
    camionDestinoSeleccionado: '', cargaActualId: null, paletesSsccCargaActual_: [], modoManualActivo_: false, ESCANEO_PROCESANDO_: false
  }, extra);
  vm.createContext(ctx);
  vm.runInContext(funcionReal('escapeHtml_'), ctx);
  if (extra && extra.escapeHtml_) ctx.escapeHtml_ = extra.escapeHtml_;
  vm.runInContext(bloqueCargas(), ctx);
  entorno.ctx = ctx;
  return entorno;
}

// Rellena el formulario del paso 1 como lo dejaría una persona.
function formularioListo(e, cargadores) {
  e.ctx.camionDestinoSeleccionado = 'Marbella';
  e.el('camionFecha').value = '2026-10-15';
  e.el('camionHorario').value = '22:00';
  e.ctx.cargadoresSeleccionados_ = cargadores || [];
}

// ───────────────────────── estructura de la página ─────────────────────────

test('Index.html: panel de cargas activas, selector de cargador y botones para volver', () => {
  ['camionPanel', 'camionPanelLista', 'camionPanelContador', 'btnPanelActualizar', 'camionContextoAviso', 'camionCargadorGrupo',
    'camionCargadorChips', 'camionCargadorAux', 'btnCargadorMas', 'camionCargadorResumen', 'btnAbrirCarga',
    'camionCargadorLinea', 'camionAvisoReapertura', 'btnVolverInicio'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'falta id=' + id);
  });
  assert.match(html, /onclick="cargarPanelCargas_\(\)"/);
  assert.match(html, /onclick="volverAlPanel_\(false\)"/, 'desde el escaneo se vuelve sin cerrar la carga ni borrar al cargador');
  assert.match(html, /id="btnVolverInicio" onclick="volverAlPanel_\(true\)"/, 'tras cerrar se vuelve y se borra la selección');
  assert.match(html, /onclick="alternarCargadoresAux_\(\)"/);
});

test('el bloque JS de cargas activas parsea, no usa diálogos nativos y no lleva "/*" (HtmlService corta la página)', () => {
  const codigo = bloqueCargas();
  assert.doesNotThrow(() => new Function(codigo));
  assert.ok(!/\balert\(|\bconfirm\(|\bprompt\(/.test(codigo), 'no debe usar alert/confirm/prompt');
  assert.ok(!codigo.includes('/*'), 'no usar "/*" en una cadena: HtmlService corta la página');
  assert.ok(!codigo.includes('<?'), 'no escribir una apertura de scriptlet dentro del JS');
});

test('la llegada cruzada desde Carta de Portes SIE rellena el formulario pero ya NO abre la carga sola', () => {
  const m = /function iniciarVistaOperario_\(\) \{[\s\S]*?\n  \}/.exec(html);
  assert.ok(m, 'no encuentro iniciarVistaOperario_');
  assert.ok(!/abrirCargaDirecta_\(/.test(m[0]), 'abrir la carga exige cargador: no puede ocurrir sola');
  assert.match(m[0], /mostrarAvisoContexto_\(TIENDA_FILTRO, HORARIO_CONTEXTO\)/);
  assert.match(m[0], /cargarCargadores_\(\);/);
  assert.match(m[0], /cargarPanelCargas_\(\);/);
});

test('mostrarConfirmacion_ admite el texto del botón y por defecto sigue diciendo «Aceptar»', () => {
  // (el comportamiento, incluido el modo «peligro», se ejecuta de verdad en test/indexSinDialogosNativos.test.js)
  assert.match(html, /function mostrarConfirmacion_\(mensaje, alConfirmar, titulo, textoBoton, peligro\)/);
  assert.match(html, /botonOk\.textContent = textoBoton \|\| 'Aceptar';/);
});

test('quitar un soporte o un palet de la carga avisa con el cuadro propio, no con alert()', () => {
  const quitarSoporte = /function quitarSoporteUI_\(idUnico\) \{[\s\S]*?\n  \}/.exec(html)[0];
  const quitarPalet = /function quitarPaletUI_\(sscc\) \{[\s\S]*?\n  \}/.exec(html)[0];
  [quitarSoporte, quitarPalet].forEach((codigo) => {
    assert.ok(!/\balert\(/.test(codigo));
    assert.match(codigo, /mostrarModalAviso_\(/);
  });
});

test('el resumen de cierre avisa de que el informe es el actualizado cuando la carga se reabrió', () => {
  assert.match(html, /var avisoReapertura = r\.reabierta/);
  assert.match(html, /Informe actualizado:<\/strong> este informe sustituye al que se envió/);
});

// ───────────────────────── selección de cargadores ─────────────────────────

test('alternarSeleccionCargador_: añade, quita y rechaza a un tercero sin tocar la selección', () => {
  const e = crearEntorno();
  const alt = (lista, n) => aLocal(e.ctx.alternarSeleccionCargador_(lista, n, 2));
  assert.deepStrictEqual(alt([], 'Juanlu'), { lista: ['Juanlu'], rechazado: false });
  assert.deepStrictEqual(alt(['Juanlu'], 'Sebas'), { lista: ['Juanlu', 'Sebas'], rechazado: false });
  assert.deepStrictEqual(alt(['Juanlu', 'Sebas'], 'Oscar'), { lista: ['Juanlu', 'Sebas'], rechazado: true });
  assert.deepStrictEqual(alt(['Juanlu', 'Sebas'], 'Juanlu'), { lista: ['Sebas'], rechazado: false });
});

test('pulsar chips de cargador: se eligen hasta 2, el resumen lo dice y el tercero da el aviso de máximo', () => {
  const e = crearEntorno();
  e.ctx.CARGADORES_ = { principales: ['Juanlu', 'Sergio Sánchez'], auxiliares: ['Sebas', 'Oscar'], max: 2 };
  const chip = (nombre) => { const c = new Elemento('chip-' + nombre); c.attrs['data-nombre'] = nombre; c.closest = () => c; e.chipsCargador.push(c); return c; };
  const juanlu = chip('Juanlu'); const sebas = chip('Sebas'); const oscar = chip('Oscar');
  const pulsar = (c) => e.el('camionCargadorGrupo').oyentes.click({ target: c });

  pulsar(juanlu);
  assert.strictEqual(e.el('camionCargadorResumen').textContent, 'Cargan: Juanlu');
  assert.strictEqual(juanlu.getAttribute('aria-pressed'), 'true');
  pulsar(sebas);
  assert.strictEqual(e.el('camionCargadorResumen').textContent, 'Cargan: Juanlu y Sebas');
  pulsar(oscar);
  assert.match(e.el('camionCargadorResumen').textContent, /Máximo 2 personas por carga/);
  assert.ok(e.el('camionCargadorResumen').classList.contains('error'));
  assert.strictEqual(oscar.getAttribute('aria-pressed'), 'false');
  assert.deepStrictEqual(aLocal(e.ctx.cargadoresElegidos_()), ['Juanlu', 'Sebas']);
  pulsar(sebas);
  assert.strictEqual(e.el('camionCargadorResumen').textContent, 'Cargan: Juanlu');
  assert.ok(!e.el('camionCargadorResumen').classList.contains('error'));
});

test('un clic fuera de los chips (el texto, el botón «Más cargadores») no cambia la selección', () => {
  const e = crearEntorno();
  e.ctx.cargadoresSeleccionados_ = ['Juanlu'];
  e.el('camionCargadorGrupo').oyentes.click({ target: { closest: () => null } });
  e.el('camionCargadorGrupo').oyentes.click({ target: {} });
  assert.deepStrictEqual(aLocal(e.ctx.cargadoresElegidos_()), ['Juanlu']);
});

test('chipCargadorHtml_ escapa el nombre (no se cuela HTML) y marca los elegidos', () => {
  const e = crearEntorno();
  e.ctx.cargadoresSeleccionados_ = ['Juanlu'];
  assert.match(e.ctx.chipCargadorHtml_('Juanlu'), /aria-pressed="true"/);
  assert.match(e.ctx.chipCargadorHtml_('Sebas'), /aria-pressed="false"/);
  const raro = e.ctx.chipCargadorHtml_('"><img src=x onerror=alert(1)>');
  assert.ok(!/<img/.test(raro), 'el nombre se escapa');
});

test('cargarCargadores_: pinta los 4 principales y los auxiliares que sirve el servidor; si falla, ofrece reintentar', async () => {
  const e = crearEntorno();
  e.respuestas.obtenerCargadores = () => ({ principales: ['Manuel Rosas', 'Juanlu'], auxiliares: ['Alberto', 'Carlos. Osuna'], max: 2 });
  e.ctx.cargarCargadores_();
  await esperar();
  assert.strictEqual((e.el('camionCargadorChips').innerHTML.match(/class="cargador-chip"/g) || []).length, 2);
  assert.strictEqual((e.el('camionCargadorAux').innerHTML.match(/class="cargador-chip"/g) || []).length, 2);
  assert.match(e.el('camionCargadorAux').innerHTML, /data-nombre="Carlos\. Osuna"/);

  const f = crearEntorno();
  f.respuestas.obtenerCargadores = () => { throw new Error('sin red'); };
  f.ctx.cargarCargadores_();
  await esperar();
  assert.match(f.el('camionCargadorChips').innerHTML, /sin red/);
  assert.match(f.el('camionCargadorChips').innerHTML, /cargarCargadores_\(\)/);
});

// ───────────────────────── panel de cargas ─────────────────────────

test('etiquetaDiaCarga_: Hoy, Mañana, Ayer y, para el resto, día de la semana y fecha', () => {
  const e = crearEntorno();
  const dia = (f) => e.ctx.etiquetaDiaCarga_(f, '2026-10-15');
  assert.strictEqual(dia('2026-10-15'), 'Hoy');
  assert.strictEqual(dia('2026-10-16'), 'Mañana');
  assert.strictEqual(dia('2026-10-14'), 'Ayer');
  assert.strictEqual(dia('2026-10-17'), 'Sáb 17/10');
  assert.strictEqual(dia('2026-11-02'), 'Lun 02/11');
  assert.strictEqual(e.ctx.etiquetaDiaCarga_('2026-10-01', '2026-09-30'), 'Mañana', 'cruza de mes');
});

test('textoCifrasCarga_: singular y plural, y los palets SIE solo si los hay', () => {
  const e = crearEntorno();
  assert.strictEqual(e.ctx.textoCifrasCarga_({ soportes: 1, palets: 0 }), '1 soporte');
  assert.strictEqual(e.ctx.textoCifrasCarga_({ soportes: 0, palets: 0 }), '0 soportes');
  assert.strictEqual(e.ctx.textoCifrasCarga_({ soportes: 14, palets: 1 }), '14 soportes · 1 palet SIE');
  assert.strictEqual(e.ctx.textoCifrasCarga_({ soportes: 22, palets: 6 }), '22 soportes · 6 palets SIE');
});

test('estadoVisualCarga_: abierta, abierta que ya pasó su hora y cerrada reabrible', () => {
  const e = crearEntorno();
  assert.deepStrictEqual(aLocal(e.ctx.estadoVisualCarga_({ estado: 'ABIERTA', vencida: false })), { clase: 'est-abierta', texto: 'ABIERTA', accion: 'Continuar ›' });
  assert.deepStrictEqual(aLocal(e.ctx.estadoVisualCarga_({ estado: 'ABIERTA', vencida: true })), { clase: 'est-vencida', texto: 'ABIERTA · PASÓ SU HORA', accion: 'Continuar ›' });
  assert.deepStrictEqual(aLocal(e.ctx.estadoVisualCarga_({ estado: 'CERRADA' })), { clase: 'est-cerrada', texto: 'CERRADA', accion: 'Reabrir ›' });
});

const CARGA = { idCarga: 'CARGA-000638', destino: 'Marbella', fechaEntrega: '2026-10-15', horario: '22:00', estado: 'ABIERTA', cargador: 'Juanlu, Sebas', soportes: 10, palets: 0, vencida: false, reabierta: false };

test('tarjetaCargaHtml_: lleva tienda, hora, día, estado, cifras, cargador, id y los datos para rellenar el formulario', () => {
  const e = crearEntorno();
  const t = e.ctx.tarjetaCargaHtml_(CARGA, '2026-10-15');
  assert.match(t, /class="carga-card tienda-marbella"/);
  assert.match(t, /data-destino="Marbella" data-fecha="2026-10-15" data-horario="22:00"/);
  assert.match(t, /carga-card-hora">22:00</);
  assert.match(t, /carga-card-dia">Hoy</);
  assert.match(t, /est-abierta">ABIERTA</);
  assert.match(t, /10 soportes/);
  assert.match(t, /Juanlu, Sebas/);
  assert.match(t, /CARGA-000638/);
  assert.match(t, /Continuar ›/);
});

test('tarjetaCargaHtml_: reabierta, sin cargador y cerrada se distinguen', () => {
  const e = crearEntorno();
  const reabierta = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { reabierta: true }), '2026-10-15');
  assert.match(reabierta, /ABIERTA · REABIERTA/);
  const sinCargador = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { cargador: '' }), '2026-10-15');
  assert.match(sinCargador, /Sin cargador anotado/);
  const cerrada = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { estado: 'CERRADA', palets: 3 }), '2026-10-15');
  assert.match(cerrada, /est-cerrada">CERRADA/);
  assert.match(cerrada, /3 palets SIE/);
  assert.match(cerrada, /Reabrir ›/);
});

test('tarjetaCargaHtml_ escapa todos los datos que vienen de la base (no se cuela HTML)', () => {
  const e = crearEntorno();
  const mala = '"><img src=x onerror=alert(1)>';
  const t = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { destino: mala, horario: mala, cargador: mala, idCarga: mala, fechaEntrega: '2026-10-15' }), '2026-10-15');
  assert.ok(!/<img/.test(t), 'no debe quedar ninguna etiqueta img sin escapar');
});

test('pintarPanelCargas_: cuenta las abiertas, pinta las tarjetas y avisa cuando no hay ninguna', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_([CARGA, Object.assign({}, CARGA, { idCarga: 'CARGA-000639', estado: 'CERRADA' })]);
  assert.strictEqual(e.el('camionPanelContador').textContent, '(1 abierta)');
  assert.strictEqual((e.el('camionPanelLista').innerHTML.match(/class="carga-card /g) || []).length, 2);
  e.ctx.pintarPanelCargas_([CARGA, Object.assign({}, CARGA, { idCarga: 'CARGA-000640' })]);
  assert.strictEqual(e.el('camionPanelContador').textContent, '(2 abiertas)');
  e.ctx.pintarPanelCargas_([]);
  assert.strictEqual(e.el('camionPanelContador').textContent, '');
  assert.match(e.el('camionPanelLista').innerHTML, /No hay ninguna carga abierta/);
});

test('cargarPanelCargas_: pide la lista al servidor, bloquea el botón mientras tanto y muestra el error si falla', async () => {
  const e = crearEntorno();
  e.respuestas.listarCargasPanel = () => [CARGA];
  e.ctx.cargarPanelCargas_();
  assert.strictEqual(e.el('btnPanelActualizar').disabled, true);
  assert.strictEqual(e.el('btnPanelActualizar').textContent, 'Actualizando…');
  await esperar();
  assert.strictEqual(e.el('btnPanelActualizar').disabled, false);
  assert.strictEqual(e.el('btnPanelActualizar').textContent, 'Actualizar');
  assert.match(e.el('camionPanelLista').innerHTML, /CARGA-000638/);

  const f = crearEntorno();
  f.respuestas.listarCargasPanel = () => { throw new Error('Supabase caída'); };
  f.ctx.cargarPanelCargas_();
  await esperar();
  assert.match(f.el('camionPanelLista').innerHTML, /No se pudo cargar la lista de cargas: Supabase caída/);
  assert.strictEqual(f.el('btnPanelActualizar').disabled, false);
});

test('cargarPanelCargas_: si llegan dos respuestas, la más antigua no pisa a la más nueva', async () => {
  const e = crearEntorno();
  const pendientes = [];
  e.ctx.gas = (nombre) => new Promise((resolver) => { pendientes.push(resolver); });
  e.ctx.cargarPanelCargas_(); // 1.ª petición
  e.ctx.cargarPanelCargas_(); // 2.ª petición (más nueva)
  pendientes[1]([Object.assign({}, CARGA, { idCarga: 'CARGA-NUEVA' })]);
  await esperar();
  pendientes[0]([Object.assign({}, CARGA, { idCarga: 'CARGA-VIEJA' })]);
  await esperar();
  assert.match(e.el('camionPanelLista').innerHTML, /CARGA-NUEVA/);
  assert.ok(!/CARGA-VIEJA/.test(e.el('camionPanelLista').innerHTML));
});

test('pulsar una tarjeta del panel rellena tienda, fecha y horario del formulario (aunque el horario no esté en la lista) y lleva a «¿Quién carga?»', async () => {
  const e = crearEntorno();
  e.el('camionHorario').opciones.push({ value: '16:00' });
  const tarjeta = new Elemento('tarjeta');
  tarjeta.attrs = { 'data-destino': 'Marbella', 'data-fecha': '2026-10-17', 'data-horario': '22:00' };
  tarjeta.closest = () => tarjeta;
  let chipFecha = null;
  e.ctx.marcarChipSeleccionado_ = (f) => { chipFecha = f; };
  e.el('camionPanelLista').oyentes.click({ target: tarjeta });
  await esperar();
  assert.strictEqual(e.ctx.camionDestinoSeleccionado, 'Marbella');
  assert.strictEqual(e.el('camionHorario').value, '22:00');
  assert.deepStrictEqual(e.el('camionHorario').opciones.map((o) => o.value), ['16:00', '22:00'], 'se añade el horario que faltaba');
  assert.strictEqual(e.el('camionFecha').value, '2026-10-17');
  assert.strictEqual(chipFecha, '2026-10-17');
  assert.strictEqual(e.el('camionCargadorGrupo').desplazado, true);
});

test('mostrarAvisoContexto_: dice de dónde viene el operario y que falta elegir quién carga', () => {
  const e = crearEntorno();
  e.ctx.mostrarAvisoContexto_('Marbella', '22:00');
  assert.match(e.el('camionContextoAviso').textContent, /Carta de Portes SIE con Marbella · 22:00/);
  assert.match(e.el('camionContextoAviso').textContent, /Elige quién carga/);
  assert.ok(!e.el('camionContextoAviso').classList.contains('vista-oculta'));
});

// ───────────────────────── abrir, continuar y reabrir ─────────────────────────

test('crearCargaUI: sin tienda, fecha, horario o cargador avisa con el cuadro propio y no llama al servidor', async () => {
  const e = crearEntorno();
  e.ctx.crearCargaUI();
  assert.strictEqual(e.avisos[0].titulo, 'Falta la tienda');
  e.ctx.camionDestinoSeleccionado = 'Marbella';
  e.ctx.crearCargaUI();
  assert.strictEqual(e.avisos[1].titulo, 'Falta la fecha');
  e.el('camionFecha').value = '2026-10-15';
  e.ctx.crearCargaUI();
  assert.strictEqual(e.avisos[2].titulo, 'Falta el horario');
  e.el('camionHorario').value = '22:00';
  e.ctx.crearCargaUI();
  assert.strictEqual(e.avisos[3].titulo, '¿Quién carga?');
  assert.match(e.avisos[3].texto, /Elige quién realiza la carga/);
  assert.ok(e.el('camionCargadorChips').classList.contains('necesario'), 'se resalta dónde elegir');
  await esperar();
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'obtenerOCrearCarga').length, 0);
});

test('crearCargaUI: con todo relleno pide la carga al servidor con los cargadores y entra en el escaneo', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu', 'Sebas']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000700', reutilizada: false });
  e.respuestas.obtenerCarga = () => ({ escaneados: [], cargador: 'Juanlu, Sebas', reabierta: false });
  e.respuestas.obtenerPaletesCarga = () => [];
  e.respuestas.modoPruebaActivo = () => true;
  e.ctx.crearCargaUI();
  await esperar();
  const llamada = e.llamadas.filter((l) => l.nombre === 'obtenerOCrearCarga')[0];
  assert.deepStrictEqual(llamada.args, ['Marbella', '2026-10-15', '22:00', ['Juanlu', 'Sebas']]);
  assert.strictEqual(e.ctx.cargaActualId, 'CARGA-000700');
  assert.strictEqual(e.el('camionTitulo').textContent, 'CARGA-000700 — Marbella 2026-10-15 22:00');
  assert.ok(e.el('camionPaso1').classList.contains('vista-oculta'));
  assert.ok(!e.el('camionPaso2').classList.contains('vista-oculta'));
  assert.deepStrictEqual(e.pasos, [2]);
  assert.strictEqual(e.el('camionCargadorLinea').textContent, 'Cargador: Juanlu, Sebas');
  assert.strictEqual(e.el('btnAbrirCarga').disabled, false, 'el botón vuelve a estar disponible');
});

test('abrir una carga que ya está abierta la continúa (título «continuando»)', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000638', reutilizada: true });
  e.respuestas.obtenerCarga = () => ({ escaneados: [], cargador: 'Alberto, Juanlu', reabierta: false });
  e.ctx.crearCargaUI();
  await esperar();
  assert.strictEqual(e.el('camionTitulo').textContent, 'CARGA-000638 — Marbella 2026-10-15 22:00 (continuando)');
});

test('carga cerrada cuyo camión YA llegó: avisa de que no se puede modificar, no pide reabrir ni crea otra', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000634', cerrada: true, reabrible: false, destino: 'Marbella', fechaEntrega: '2026-10-15', horario: '22:00', textoLlegada: '15/10/2026 22:00' });
  e.ctx.crearCargaUI();
  await esperar();
  assert.strictEqual(e.avisos.length, 1);
  assert.strictEqual(e.avisos[0].titulo, 'Carga ya cerrada');
  assert.match(e.avisos[0].texto, /CARGA-000634 de Marbella \(15\/10\/2026 22:00\) ya está cerrada y su camión ya ha llegado/);
  assert.match(e.avisos[0].texto, /Tampoco se crea otra carga para el mismo camión/);
  assert.strictEqual(e.confirmaciones.length, 0);
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'reabrirCarga').length, 0);
  assert.strictEqual(e.ctx.cargaActualId, null);
  assert.strictEqual(e.el('btnAbrirCarga').disabled, false);
});

test('carga cerrada que aún no ha llegado: pide confirmar y, al aceptar, la reabre con los mismos cargadores y entra', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000634', cerrada: true, reabrible: true, destino: 'Marbella', fechaEntrega: '2026-10-15', horario: '22:00', cerradaPor: 'muelle@x.com', textoLlegada: '15/10/2026 22:00' });
  e.respuestas.reabrirCarga = () => ({ idCarga: 'CARGA-000634', reabierta: true });
  e.respuestas.obtenerCarga = () => ({ escaneados: [], cargador: 'Alberto, Juanlu', reabierta: true, reabiertaEn: '2026-10-15T09:30:00.000Z' });
  e.ctx.crearCargaUI();
  await esperar();
  assert.strictEqual(e.confirmaciones.length, 1);
  const c = e.confirmaciones[0];
  assert.strictEqual(c.titulo, 'Reabrir carga');
  assert.strictEqual(c.boton, 'Reabrir');
  assert.match(c.mensaje, /CARGA-000634 de Marbella \(15\/10\/2026 22:00\) ya está cerrada \(la cerró muelle@x\.com\)/);
  assert.match(c.mensaje, /se enviará el informe actualizado/);
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'reabrirCarga').length, 0, 'no se reabre hasta que se acepta');
  assert.strictEqual(e.ctx.cargaActualId, null);

  c.alConfirmar();
  await esperar();
  const reapertura = e.llamadas.filter((l) => l.nombre === 'reabrirCarga')[0];
  assert.deepStrictEqual(reapertura.args, ['CARGA-000634', ['Juanlu']]);
  assert.strictEqual(e.ctx.cargaActualId, 'CARGA-000634');
  assert.strictEqual(e.el('camionTitulo').textContent, 'CARGA-000634 — Marbella 2026-10-15 22:00 (reabierta)');
  assert.ok(!e.el('camionAvisoReapertura').classList.contains('vista-oculta'), 'se ve la franja de carga reabierta');
  assert.strictEqual(e.el('btnAbrirCarga').disabled, false);
});

test('si reabrir falla (p. ej. llegó el camión mientras tanto) se avisa y no se entra en la carga', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000634', cerrada: true, reabrible: true, destino: 'Marbella', fechaEntrega: '2026-10-15', horario: '22:00', textoLlegada: '15/10/2026 22:00' });
  e.respuestas.reabrirCarga = () => { throw new Error('No se puede reabrir la carga CARGA-000634: ya ha pasado su hora de llegada'); };
  e.ctx.crearCargaUI();
  await esperar();
  e.confirmaciones[0].alConfirmar();
  await esperar();
  assert.strictEqual(e.avisos.length, 1);
  assert.strictEqual(e.avisos[0].titulo, 'No se pudo reabrir la carga');
  assert.match(e.avisos[0].texto, /ya ha pasado su hora de llegada/);
  assert.strictEqual(e.ctx.cargaActualId, null);
  assert.strictEqual(e.el('btnAbrirCarga').disabled, false);
});

test('abrir una carga no se puede lanzar dos veces seguidas (doble pulsación) y el botón se bloquea mientras tanto', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => ({ idCarga: 'CARGA-000700', reutilizada: false });
  e.respuestas.obtenerCarga = () => ({ escaneados: [], cargador: 'Juanlu', reabierta: false });
  e.ctx.crearCargaUI();
  assert.strictEqual(e.el('btnAbrirCarga').disabled, true);
  e.ctx.crearCargaUI();
  e.ctx.crearCargaUI();
  await esperar();
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'obtenerOCrearCarga').length, 1);
});

test('si el servidor falla al abrir se avisa con el cuadro propio y se puede volver a intentar', async () => {
  const e = crearEntorno();
  formularioListo(e, ['Juanlu']);
  e.respuestas.obtenerOCrearCarga = () => { throw new Error('Cargador no válido, no está en la lista de Cargas/Descargas: Pepe.'); };
  e.ctx.crearCargaUI();
  await esperar();
  assert.strictEqual(e.avisos.length, 1);
  assert.strictEqual(e.avisos[0].titulo, 'No se pudo abrir la carga');
  assert.match(e.avisos[0].texto, /no está en la lista de Cargas\/Descargas/);
  assert.strictEqual(e.el('btnAbrirCarga').disabled, false);
  assert.strictEqual(e.ctx.cargaActualId, null);
});

// ───────────────────────── dentro de la carga ─────────────────────────

test('pintarCabeceraCarga_: muestra quién carga y la franja de reapertura solo si la carga se reabrió', () => {
  const e = crearEntorno();
  e.ctx.pintarCabeceraCarga_({ cargador: 'Juanlu, Sebas', reabierta: false });
  assert.strictEqual(e.el('camionCargadorLinea').textContent, 'Cargador: Juanlu, Sebas');
  assert.ok(e.el('camionAvisoReapertura').classList.contains('vista-oculta'));

  e.ctx.pintarCabeceraCarga_({ cargador: '', reabierta: true, reabiertaEn: '2026-10-15T09:30:00.000Z' });
  assert.strictEqual(e.el('camionCargadorLinea').textContent, '');
  assert.ok(!e.el('camionAvisoReapertura').classList.contains('vista-oculta'));
  assert.match(e.el('camionAvisoReapertura').textContent, /Carga reabierta el \d\d\/\d\d \d\d:\d\d\./);
  assert.match(e.el('camionAvisoReapertura').textContent, /se enviará el informe actualizado/);

  e.ctx.pintarCabeceraCarga_({ cargador: 'Oscar', reabierta: true, reabiertaEn: 'fecha rara' });
  assert.match(e.el('camionAvisoReapertura').textContent, /^Carga reabierta\./, 'sin fecha válida no inventa una');
});

test('volverAlPanel_: vuelve al paso 1 sin cerrar la carga, refresca el panel y conserva al cargador', async () => {
  const e = crearEntorno();
  e.respuestas.listarCargasPanel = () => [CARGA];
  e.ctx.cargaActualId = 'CARGA-000638';
  e.ctx.cargadoresSeleccionados_ = ['Juanlu'];
  e.el('camionPaso2').classList.remove('vista-oculta');
  e.ctx.volverAlPanel_(false);
  await esperar();
  assert.strictEqual(e.ctx.cargaActualId, null);
  assert.ok(e.el('camionPaso2').classList.contains('vista-oculta'));
  assert.ok(!e.el('camionPaso1').classList.contains('vista-oculta'));
  assert.deepStrictEqual(e.pasos, [1]);
  assert.deepStrictEqual(aLocal(e.ctx.cargadoresElegidos_()), ['Juanlu']);
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'listarCargasPanel').length, 1);
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'cerrarCarga').length, 0, 'volver NO cierra la carga');
});

test('volverAlPanel_(true) tras cerrar una carga borra la selección de quién carga', () => {
  const e = crearEntorno();
  e.respuestas.listarCargasPanel = () => [];
  e.ctx.cargadoresSeleccionados_ = ['Juanlu', 'Sebas'];
  e.ctx.volverAlPanel_(true);
  assert.deepStrictEqual(aLocal(e.ctx.cargadoresElegidos_()), []);
  assert.strictEqual(e.el('camionCargadorResumen').textContent, 'Toca tu nombre. Si cargáis dos personas, elige a las dos.');
});

test('volverAlPanel_ no hace nada mientras se está procesando un escaneo', () => {
  const e = crearEntorno({ ESCANEO_PROCESANDO_: true });
  e.ctx.cargaActualId = 'CARGA-000638';
  e.ctx.volverAlPanel_(false);
  assert.strictEqual(e.ctx.cargaActualId, 'CARGA-000638');
  assert.deepStrictEqual(e.pasos, []);
});
