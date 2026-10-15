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
    mostrarConfirmacion_: (mensaje, alConfirmar, titulo, boton, peligro) => confirmaciones.push({ mensaje, alConfirmar, titulo, boton, peligro }),
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
  // Como en el HTML de la página: las secciones plegables y sus barras empiezan escondidas.
  ['camionSeccionCerradas', 'camionSeccionRevisar', 'btnSeccionCerradas', 'btnSeccionRevisar'].forEach((id) => entorno.el(id).classList.add('vista-oculta'));
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
  ['camionPanel', 'camionPanelLista', 'camionPanelContador', 'btnPanelActualizar', 'btnSeccionCerradas', 'btnSeccionRevisar', 'camionSeccionCerradas',
    'camionSeccionRevisar', 'camionListaCerradas', 'camionListaRevisar', 'nCerradas', 'nRevisar', 'camionContextoAviso', 'camionCargadorGrupo',
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

const CARGA = { idCarga: 'CARGA-000638', destino: 'Marbella', fechaEntrega: '2026-10-15', horario: '22:00', estado: 'ABIERTA', cargador: 'Juanlu, Sebas', soportes: 10, palets: 0, vacia: false, yaLlego: false, reabrible: false, reabierta: false };
const CERRADA = Object.assign({}, CARGA, { idCarga: 'CARGA-000631', horario: '19:00', estado: 'CERRADA', soportes: 6, palets: 13, reabrible: true });
const CERRADA_LLEGO = Object.assign({}, CERRADA, { idCarga: 'CARGA-000600', horario: '07:00', yaLlego: true, reabrible: false });
const REVISAR_LLEGO_CON = Object.assign({}, CARGA, { idCarga: 'CARGA-000610', destino: 'Málaga', horario: '6:00', motivo: 'LLEGO', principal: '', soportes: 4 });
const REVISAR_LLEGO_VACIA = Object.assign({}, REVISAR_LLEGO_CON, { idCarga: 'CARGA-000630', soportes: 0, vacia: true });
const REPETIDA = Object.assign({}, CARGA, { idCarga: 'CARGA-000636', horario: '19:00', motivo: 'REPETIDA', principal: 'CARGA-000631', soportes: 0, vacia: true });
const REPETIDA_CON = Object.assign({}, REPETIDA, { idCarga: 'CARGA-000650', motivo: 'REPETIDA_CON_MERCANCIA', soportes: 2, vacia: false });
const TRES_LISTAS = (a, c, r) => ({ abiertas: a || [], cerradas: c || [], porRevisar: r || [] });

test('estadoVisualCarga_: abierta, cerrada (también la que ya llegó) y los tres motivos de «por revisar»', () => {
  const e = crearEntorno();
  const ev = (c) => aLocal(e.ctx.estadoVisualCarga_(c));
  assert.deepStrictEqual(ev(CARGA), { clase: 'est-abierta', texto: 'ABIERTA' });
  assert.deepStrictEqual(ev(CERRADA), { clase: 'est-cerrada', texto: 'CERRADA' });
  assert.deepStrictEqual(ev(CERRADA_LLEGO), { clase: 'est-cerrada', texto: 'CERRADA · YA LLEGÓ' });
  assert.deepStrictEqual(ev(REVISAR_LLEGO_CON), { clase: 'est-vencida', texto: 'ABIERTA · LLEGÓ EL CAMIÓN' });
  assert.deepStrictEqual(ev(REPETIDA), { clase: 'est-vencida', texto: 'REPETIDA · VACÍA' });
  assert.deepStrictEqual(ev(REPETIDA_CON), { clase: 'est-vencida', texto: 'REPETIDA · CON MERCANCÍA' });
});

test('tarjetaCargaHtml_: lleva tienda, hora, día, estado, cifras, cargador, id y los datos para rellenar el formulario', () => {
  const e = crearEntorno();
  const t = e.ctx.tarjetaCargaHtml_(CARGA, '2026-10-15');
  assert.match(t, /^<button type="button" class="carga-card tienda-marbella"/);
  assert.match(t, /data-destino="Marbella" data-fecha="2026-10-15" data-horario="22:00"/);
  assert.match(t, /carga-card-hora">22:00</);
  assert.match(t, /carga-card-dia">Hoy</);
  assert.match(t, /est-abierta">ABIERTA</);
  assert.match(t, /10 soportes/);
  assert.match(t, /Juanlu, Sebas/);
  assert.match(t, /CARGA-000638/);
  assert.match(t, /Continuar ›/);
});

test('tarjetaCargaHtml_: reabierta, sin cargador y cerrada reabrible se distinguen', () => {
  const e = crearEntorno();
  const reabierta = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { reabierta: true }), '2026-10-15');
  assert.match(reabierta, /ABIERTA · REABIERTA/);
  const sinCargador = e.ctx.tarjetaCargaHtml_(Object.assign({}, CARGA, { cargador: '' }), '2026-10-15');
  assert.match(sinCargador, /Sin cargador anotado/);
  const cerrada = e.ctx.tarjetaCargaHtml_(CERRADA, '2026-10-15');
  assert.match(cerrada, /est-cerrada">CERRADA/);
  assert.match(cerrada, /13 palets SIE/);
  assert.match(cerrada, /Reabrir ›/);
});

test('tarjetaConsultaHtml_: la cerrada que ya llegó es solo consulta: sin botón, sin datos de camión y apagada', () => {
  const e = crearEntorno();
  const t = e.ctx.tarjetaConsultaHtml_(CERRADA_LLEGO, '2026-10-15');
  assert.match(t, /^<div class="carga-card carga-card-consulta tienda-marbella"/);
  assert.ok(!/<button/.test(t) && !/data-destino/.test(t), 'no se puede pulsar');
  assert.match(t, /CERRADA · YA LLEGÓ/);
  assert.match(t, /Solo consulta/);
  assert.match(t, /6 soportes · 13 palets SIE/);
});

test('tarjetaCargaHtml_, tarjetaConsultaHtml_ y tarjetaRevisarHtml_ escapan todos los datos que vienen de la base (no se cuela HTML)', () => {
  const e = crearEntorno();
  const mala = '"><img src=x onerror=alert(1)>';
  const sucia = Object.assign({}, REPETIDA, { destino: mala, horario: mala, cargador: mala, idCarga: mala, principal: mala });
  [e.ctx.tarjetaCargaHtml_(sucia, '2026-10-15'), e.ctx.tarjetaConsultaHtml_(sucia, '2026-10-15'), e.ctx.tarjetaRevisarHtml_(sucia, '2026-10-15')].forEach((t) => {
    assert.ok(!/<img/.test(t), 'no debe quedar ninguna etiqueta img sin escapar');
  });
});

test('accionesRevisar_: con mercancía y llegó = cerrarla; vacía (llegó o repetida) = descartarla; repetida con mercancía = nada', () => {
  const e = crearEntorno();
  const ac = (c) => aLocal(e.ctx.accionesRevisar_(c));
  assert.deepStrictEqual(ac(REVISAR_LLEGO_CON), { cerrar: true, descartar: false });
  assert.deepStrictEqual(ac(REVISAR_LLEGO_VACIA), { cerrar: false, descartar: true });
  assert.deepStrictEqual(ac(REPETIDA), { cerrar: false, descartar: true });
  assert.deepStrictEqual(ac(REPETIDA_CON), { cerrar: false, descartar: false });
});

test('tarjetaRevisarHtml_: explica el motivo y solo ofrece lo que se puede hacer (abrir para cerrarla, descartar, o nada)', () => {
  const e = crearEntorno();
  const con = e.ctx.tarjetaRevisarHtml_(REVISAR_LLEGO_CON, '2026-10-15');
  assert.match(con, /^<div class="carga-card carga-card-revisar tienda-malaga"/);
  assert.match(con, /El camión ya llegó y la carga sigue abierta: hay que cerrarla\./);
  assert.match(con, /<button type="button" class="carga-accion" data-destino="Málaga" data-fecha="2026-10-15" data-horario="6:00">Abrir para cerrarla ›<\/button>/);
  assert.ok(!/Descartar/.test(con), 'con mercancía NO se ofrece descartar');

  const vacia = e.ctx.tarjetaRevisarHtml_(REVISAR_LLEGO_VACIA, '2026-10-15');
  assert.match(vacia, /El camión ya llegó y la carga está vacía\./);
  assert.match(vacia, /data-accion="descartar" data-id="CARGA-000630" data-etiqueta="Málaga · Hoy · 6:00">Descartar<\/button>/);
  assert.ok(!/Abrir para cerrarla/.test(vacia));

  const rep = e.ctx.tarjetaRevisarHtml_(REPETIDA, '2026-10-15');
  assert.match(rep, /Repetida y vacía: este camión ya tiene su carga \(CARGA-000631\)\./);
  assert.match(rep, />Descartar<\/button>/);

  const repCon = e.ctx.tarjetaRevisarHtml_(REPETIDA_CON, '2026-10-15');
  assert.match(repCon, /Repetida con mercancía.*Avisa a administración\./);
  assert.ok(!/<button/.test(repCon), 'sin botones: no se toca sin avisar');
});

test('pintarPanelCargas_: ARRIBA solo las abiertas; las cerradas y las huérfanas van en sus secciones, que se esconden si están vacías', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_(TRES_LISTAS([CARGA], [CERRADA], [REPETIDA]));
  const arriba = e.el('camionPanelLista').innerHTML;
  assert.strictEqual((arriba.match(/class="carga-card /g) || []).length, 1, 'arriba una sola tarjeta');
  assert.match(arriba, /CARGA-000638/);
  assert.ok(!/CARGA-000631|CARGA-000636/.test(arriba), 'ni la cerrada ni la huérfana se mezclan arriba');
  assert.strictEqual(e.el('camionPanelContador').textContent, '(1 abierta)');
  assert.match(e.el('camionListaCerradas').innerHTML, /CARGA-000631/);
  assert.match(e.el('camionListaRevisar').innerHTML, /CARGA-000636/);
  assert.strictEqual(e.el('nCerradas').textContent, '(1)');
  assert.strictEqual(e.el('nRevisar').textContent, '(1)');
  assert.ok(!e.el('btnSeccionCerradas').classList.contains('vista-oculta'));
  assert.ok(!e.el('btnSeccionRevisar').classList.contains('vista-oculta'));
  assert.ok(e.el('camionSeccionCerradas').classList.contains('vista-oculta'), 'las secciones empiezan plegadas');
  assert.ok(e.el('camionSeccionRevisar').classList.contains('vista-oculta'));

  e.ctx.pintarPanelCargas_(TRES_LISTAS([CARGA, Object.assign({}, CARGA, { idCarga: 'CARGA-000639' })]));
  assert.strictEqual(e.el('camionPanelContador').textContent, '(2 abiertas)');
  assert.ok(e.el('btnSeccionCerradas').classList.contains('vista-oculta'), 'sin cerradas no hay barra');
  assert.ok(e.el('btnSeccionRevisar').classList.contains('vista-oculta'), 'sin huérfanas no hay barra');
  assert.strictEqual(e.el('nRevisar').textContent, '');

  e.ctx.pintarPanelCargas_(TRES_LISTAS());
  assert.strictEqual(e.el('camionPanelContador').textContent, '');
  assert.match(e.el('camionPanelLista').innerHTML, /No hay ninguna carga abierta/);
});

test('pintarPanelCargas_: en «Cerradas» la reabrible es pulsable y la que ya llegó es solo consulta', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_(TRES_LISTAS([], [CERRADA, CERRADA_LLEGO], []));
  const lista = e.el('camionListaCerradas').innerHTML;
  assert.match(lista, /<button type="button" class="carga-card tienda-marbella" data-destino="Marbella" data-fecha="2026-10-15" data-horario="19:00">/);
  assert.match(lista, /<div class="carga-card carga-card-consulta/);
  assert.strictEqual((lista.match(/<button/g) || []).length, 1, 'solo la reabrible es un botón');
});

test('pintarPanelCargas_: si el servidor no manda alguna lista, se trata como vacía (no revienta)', () => {
  const e = crearEntorno();
  assert.doesNotThrow(() => e.ctx.pintarPanelCargas_({}));
  assert.doesNotThrow(() => e.ctx.pintarPanelCargas_(null));
  assert.match(e.el('camionPanelLista').innerHTML, /No hay ninguna carga abierta/);
});

test('alternarSeccionPanel_: acordeón: abrir una cierra la otra, pulsar la abierta la cierra, y aria-expanded lo refleja', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_(TRES_LISTAS([], [CERRADA], [REPETIDA]));
  const abierta = (n) => !e.el(n === 'cerradas' ? 'camionSeccionCerradas' : 'camionSeccionRevisar').classList.contains('vista-oculta');
  const aria = (n) => e.el(n === 'cerradas' ? 'btnSeccionCerradas' : 'btnSeccionRevisar').getAttribute('aria-expanded');
  e.ctx.alternarSeccionPanel_('cerradas');
  assert.deepStrictEqual([abierta('cerradas'), abierta('revisar'), aria('cerradas'), aria('revisar')], [true, false, 'true', 'false']);
  e.ctx.alternarSeccionPanel_('revisar');
  assert.deepStrictEqual([abierta('cerradas'), abierta('revisar'), aria('cerradas'), aria('revisar')], [false, true, 'false', 'true'], 'abrir una cierra la otra: nunca dos a la vez');
  e.ctx.alternarSeccionPanel_('revisar');
  assert.deepStrictEqual([abierta('cerradas'), abierta('revisar')], [false, false]);
});

test('al refrescar el panel la sección abierta sigue abierta mientras tenga algo, y se cierra y esconde cuando se queda vacía', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_(TRES_LISTAS([], [], [REPETIDA, REPETIDA_CON]));
  e.ctx.alternarSeccionPanel_('revisar');
  e.ctx.pintarPanelCargas_(TRES_LISTAS([], [], [REPETIDA_CON]));
  assert.ok(!e.el('camionSeccionRevisar').classList.contains('vista-oculta'), 'sigue abierta tras refrescar');
  assert.strictEqual(e.el('nRevisar').textContent, '(1)');
  e.ctx.pintarPanelCargas_(TRES_LISTAS());
  assert.ok(e.el('camionSeccionRevisar').classList.contains('vista-oculta'));
  assert.ok(e.el('btnSeccionRevisar').classList.contains('vista-oculta'));
  assert.strictEqual(e.el('btnSeccionRevisar').getAttribute('aria-expanded'), 'false');
});

test('cargarPanelCargas_: pide las listas al servidor, bloquea el botón mientras tanto y muestra el error si falla', async () => {
  const e = crearEntorno();
  e.respuestas.listarCargasPanel = () => TRES_LISTAS([CARGA], [CERRADA], [REPETIDA]);
  e.ctx.cargarPanelCargas_();
  assert.strictEqual(e.el('btnPanelActualizar').disabled, true);
  assert.strictEqual(e.el('btnPanelActualizar').textContent, 'Actualizando…');
  await esperar();
  assert.strictEqual(e.el('btnPanelActualizar').disabled, false);
  assert.strictEqual(e.el('btnPanelActualizar').textContent, 'Actualizar');
  assert.match(e.el('camionPanelLista').innerHTML, /CARGA-000638/);
  assert.match(e.el('camionListaCerradas').innerHTML, /CARGA-000631/);
  assert.match(e.el('camionListaRevisar').innerHTML, /CARGA-000636/);

  const f = crearEntorno();
  f.respuestas.listarCargasPanel = () => { throw new Error('Supabase caída'); };
  f.ctx.cargarPanelCargas_();
  await esperar();
  assert.match(f.el('camionPanelLista').innerHTML, /No se pudo cargar la lista de cargas: Supabase caída/);
  assert.strictEqual(f.el('btnPanelActualizar').disabled, false);

  // el texto del error viene de fuera: se escapa antes de ponerlo en la página
  const g = crearEntorno();
  g.respuestas.listarCargasPanel = () => { throw new Error('<img src=x onerror=alert(1)>'); };
  g.ctx.cargarPanelCargas_();
  await esperar();
  assert.ok(!/<img/.test(g.el('camionPanelLista').innerHTML), 'el mensaje de error no puede meter etiquetas en la página');
  assert.match(g.el('camionPanelLista').innerHTML, /&lt;img/);
});

test('cargarPanelCargas_: si llegan dos respuestas, la más antigua no pisa a la más nueva', async () => {
  const e = crearEntorno();
  const pendientes = [];
  e.ctx.gas = (nombre) => new Promise((resolver) => { pendientes.push(resolver); });
  e.ctx.cargarPanelCargas_(); // 1.ª petición
  e.ctx.cargarPanelCargas_(); // 2.ª petición (más nueva)
  pendientes[1](TRES_LISTAS([Object.assign({}, CARGA, { idCarga: 'CARGA-NUEVA' })]));
  await esperar();
  pendientes[0](TRES_LISTAS([Object.assign({}, CARGA, { idCarga: 'CARGA-VIEJA' })]));
  await esperar();
  assert.match(e.el('camionPanelLista').innerHTML, /CARGA-NUEVA/);
  assert.ok(!/CARGA-VIEJA/.test(e.el('camionPanelLista').innerHTML));
});

// El clic en cualquier parte del panel lo recoge un solo oyente: `closest` solo reconoce los selectores que se le indican.
function objetivoClic(atributos, selectoresQueCoinciden) {
  const el = new Elemento('objetivo');
  el.attrs = atributos;
  el.closest = (sel) => (selectoresQueCoinciden.indexOf(sel) !== -1 ? el : null);
  return el;
}

test('pulsar una tarjeta del panel rellena tienda, fecha y horario del formulario (aunque el horario no esté en la lista) y lleva a «¿Quién carga?»', async () => {
  const e = crearEntorno();
  e.el('camionHorario').opciones.push({ value: '16:00' });
  let chipFecha = null;
  e.ctx.marcarChipSeleccionado_ = (f) => { chipFecha = f; };
  e.el('camionPanel').oyentes.click({ target: objetivoClic({ 'data-destino': 'Marbella', 'data-fecha': '2026-10-17', 'data-horario': '22:00' }, ['[data-destino]']) });
  await esperar();
  assert.strictEqual(e.ctx.camionDestinoSeleccionado, 'Marbella');
  assert.strictEqual(e.el('camionHorario').value, '22:00');
  assert.deepStrictEqual(e.el('camionHorario').opciones.map((o) => o.value), ['16:00', '22:00'], 'se añade el horario que faltaba');
  assert.strictEqual(e.el('camionFecha').value, '2026-10-17');
  assert.strictEqual(chipFecha, '2026-10-17');
  assert.strictEqual(e.el('camionCargadorGrupo').desplazado, true);
});

test('pulsar «Abrir para cerrarla» de una carga por revisar rellena el formulario igual que una tarjeta', async () => {
  const e = crearEntorno();
  e.el('camionPanel').oyentes.click({ target: objetivoClic({ 'data-destino': 'Málaga', 'data-fecha': '2026-10-15', 'data-horario': '6:00' }, ['[data-destino]']) });
  await esperar();
  assert.strictEqual(e.ctx.camionDestinoSeleccionado, 'Málaga');
  assert.strictEqual(e.el('camionHorario').value, '6:00');
});

test('pulsar una tarjeta de solo consulta (o fuera de las tarjetas) no hace nada', async () => {
  const e = crearEntorno();
  e.el('camionPanel').oyentes.click({ target: objetivoClic({}, []) });
  e.el('camionPanel').oyentes.click({ target: {} });
  await esperar();
  assert.strictEqual(e.ctx.camionDestinoSeleccionado, '');
  assert.strictEqual(e.confirmaciones.length, 0);
  assert.strictEqual(e.llamadas.length, 0);
});

test('pulsar una barra del panel abre o cierra su sección', () => {
  const e = crearEntorno();
  e.ctx.pintarPanelCargas_(TRES_LISTAS([], [CERRADA], [REPETIDA]));
  e.el('camionPanel').oyentes.click({ target: objetivoClic({ 'data-seccion': 'revisar' }, ['.carga-barra']) });
  assert.ok(!e.el('camionSeccionRevisar').classList.contains('vista-oculta'));
  e.el('camionPanel').oyentes.click({ target: objetivoClic({ 'data-seccion': 'cerradas' }, ['.carga-barra']) });
  assert.ok(!e.el('camionSeccionCerradas').classList.contains('vista-oculta'));
  assert.ok(e.el('camionSeccionRevisar').classList.contains('vista-oculta'), 'solo una abierta a la vez');
});

test('descartar una carga vacía: pide confirmar en rojo y solo descarta al aceptar; después refresca el panel', async () => {
  const e = crearEntorno();
  e.respuestas.descartarCarga = () => ({ idCarga: 'CARGA-000636', descartada: true });
  e.respuestas.listarCargasPanel = () => TRES_LISTAS();
  e.el('camionPanel').oyentes.click({ target: objetivoClic({ 'data-id': 'CARGA-000636', 'data-etiqueta': 'Marbella · Hoy · 19:00' }, ['[data-accion="descartar"]']) });
  assert.strictEqual(e.confirmaciones.length, 1);
  const c = e.confirmaciones[0];
  assert.match(c.mensaje, /La carga CARGA-000636 \(Marbella · Hoy · 19:00\) está vacía: no tiene soportes ni palets\./);
  assert.match(c.mensaje, /no se envía ningún informe/);
  assert.deepStrictEqual([c.titulo, c.boton, c.peligro], ['Descartar carga', 'Descartar', true]);
  assert.strictEqual(e.llamadas.length, 0, 'no se descarta hasta que se acepta');
  c.alConfirmar();
  await esperar();
  assert.deepStrictEqual(e.llamadas.map((l) => [l.nombre, l.args]), [['descartarCarga', ['CARGA-000636']], ['listarCargasPanel', []]]);
  assert.strictEqual(e.avisos.length, 0);
});

test('si el servidor no deja descartar (p. ej. ya tiene mercancía) se avisa con el cuadro propio y el panel se refresca', async () => {
  const e = crearEntorno();
  e.respuestas.descartarCarga = () => { throw new Error('No se puede descartar la carga CARGA-000636: tiene mercancía. Ábrela y ciérrala para que salga su informe.'); };
  e.respuestas.listarCargasPanel = () => TRES_LISTAS();
  e.ctx.descartarCargaUI_('CARGA-000636', 'Marbella · Hoy · 19:00');
  e.confirmaciones[0].alConfirmar();
  await esperar();
  assert.strictEqual(e.avisos.length, 1);
  assert.strictEqual(e.avisos[0].titulo, 'No se pudo descartar la carga');
  assert.match(e.avisos[0].texto, /tiene mercancía/);
  assert.strictEqual(e.llamadas.filter((l) => l.nombre === 'listarCargasPanel').length, 1, 'se refresca para ver el estado real');
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
  e.respuestas.listarCargasPanel = () => TRES_LISTAS([CARGA]);
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
  e.respuestas.listarCargasPanel = () => TRES_LISTAS();
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
