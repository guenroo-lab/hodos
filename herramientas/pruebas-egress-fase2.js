#!/usr/bin/env node
/**
 * Banco de pruebas de la FASE 2 del recorte de egress de HODOS (2026-10-06).
 *
 * Medido el 06/10 en los logs de Supabase: buscarEtiquetas, obtenerCarga y
 * cerrarCarga bajaban la tabla `etiquetas` ENTERA (~6.200 filas, 7 viajes), la
 * de `contenido` (~2.000) y la de `cargas` en cada llamada para quedarse con
 * unas pocas filas (~850.000 filas de etiquetas al día, ~75 % de lo que sale
 * de Supabase hacia HODOS). La Fase 2 pide solo lo que cada una usa.
 *
 * Carga el código Apps Script de HODOS en un `vm` de Node con un PostgREST
 * SIMULADO en memoria (GET/POST/PATCH/DELETE/RPC, filtros eq/neq/in/not.in/
 * ilike/gte/lt/or, select, order, Range con Max Rows=1000, Content-Range,
 * return=representation) y ejecuta cada acción sobre los MISMOS datos con el
 * código ANTERIOR (git ref OLD_REF) y con el código ACTUAL del disco. Exige
 * IDÉNTICO: valor devuelto (o mensaje de error), estado final de todas las
 * tablas, secuencia de escrituras al servidor y líneas de Logger. Lo único que
 * puede cambiar es QUÉ SE LEE. Después aplica MUTACIONES al código nuevo y
 * exige que el banco las detecte.
 *
 * 2026-10-15: ampliado con el historial de lotes y los subtipos Taisa, que ahora los agrupa
 * Postgres (RPC `historial_lotes` y `subtipos_taisa_usados`, migraciones/2026-10-15-*.sql). El
 * simulador implementa esas dos RPC en JS con la semántica del SQL; que el SQL real la cumple lo
 * comprueba herramientas/pruebas-egress-historial-sql.js contra Postgres de verdad (PGlite). Los
 * datos sintéticos incluyen lotes con origen_texto distinto por fila (Antequera), empates de
 * fecha entre lotes, subtipos fuera de la lista base y un subtipo en un origen que no es Taisa.
 *
 * Uso:  node herramientas/pruebas-egress-fase2.js
 *       OLD_REF=7f81f28 SEMILLAS=60 node herramientas/pruebas-egress-fase2.js
 *       # contra producción v100 (ya con la Fase 2): UMBRAL_BYTES=1 solo exige que los bytes no suban
 *       OLD_REF=5ac0edc UMBRAL_BYTES=1 node herramientas/pruebas-egress-fase2.js
 *       # contra producción v104 (RPC ya desplegadas; el historial ahora lee además los números de pedido de SUS
 *       # lotes, así que los bytes suben un poco y los topes por acción no aplican):
 *       OLD_REF=4ddeeef UMBRAL_BYTES=1.05 SIN_TOPES_ACCION=1 node herramientas/pruebas-egress-fase2.js
 *       # (con una base que no devuelve `pedidos` se compara sin ese campo y los números se verifican aparte)
 *
 * No toca Supabase, Sheets ni Drive reales.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OLD_REF = process.env.OLD_REF || '7f81f28'; // HODOS antes de la Fase 2
const SEMILLAS = Number(process.env.SEMILLAS || 40);
const ARCHIVOS = ['Utilidades.gs', 'SupabaseCliente.gs', 'EstructuraSheets.gs', 'EstructuraCargas.gs', 'EstructuraContenido.gs', 'Backend.gs', 'IntegracionIncpc.gs'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clonar = x => JSON.parse(JSON.stringify(x));
function leerNuevo() {
  const m = {};
  ARCHIVOS.forEach(f => { m[f] = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'); });
  return m;
}
function leerViejo() {
  const m = {};
  ARCHIVOS.forEach(f => { m[f] = execFileSync('git', ['show', OLD_REF + ':' + f], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); });
  return m;
}

// ------------------------------------------------------- PostgREST simulado
const MAX_ROWS = 1000;
const PK = { etiquetas: ['id_unico'], cargas: ['id_carga'], contenido: null, palets: ['id'] };

function trozosNivelCero(s) {
  const out = []; let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}
function comparar(valFila, op, val) {
  if (op === 'is') {
    if (val === 'null') return valFila === null || valFila === undefined;
    if (val === 'true') return valFila === true;
    if (val === 'false') return valFila === false;
    throw new Error('is.' + val + ' no soportado');
  }
  if (valFila === null || valFila === undefined) return false;
  const sFila = typeof valFila === 'object' ? JSON.stringify(valFila) : String(valFila);
  switch (op) {
    case 'eq': return sFila === val;
    case 'neq': return sFila !== val;
    case 'in': return trozosNivelCero(val.slice(1, -1)).map(x => x.replace(/^"|"$/g, '')).includes(sFila);
    case 'ilike': {
      const re = new RegExp('^' + val.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      return re.test(sFila);
    }
    case 'gte': case 'gt': case 'lte': case 'lt': {
      const a = Date.parse(sFila), b = Date.parse(val);
      if (isNaN(a) || isNaN(b)) throw new Error('fecha no parseable: ' + sFila + ' / ' + val);
      return op === 'gte' ? a >= b : op === 'gt' ? a > b : op === 'lte' ? a <= b : a < b;
    }
    default: throw new Error('operador no soportado: ' + op);
  }
}
function predicado(cond) {
  let m;
  if ((m = cond.match(/^and\((.*)\)$/s))) { const ps = trozosNivelCero(m[1]).map(predicado); return f => ps.every(p => p(f)); }
  if ((m = cond.match(/^or\((.*)\)$/s))) { const ps = trozosNivelCero(m[1]).map(predicado); return f => ps.some(p => p(f)); }
  const i = cond.indexOf('.'); const col = cond.slice(0, i); let resto = cond.slice(i + 1);
  let neg = false;
  if (resto.startsWith('not.')) { neg = true; resto = resto.slice(4); }
  const j = resto.indexOf('.'); const op = resto.slice(0, j); const val = resto.slice(j + 1);
  return f => {
    const r = comparar(f[col], op, val);
    if (!neg) return r;
    if (op === 'is') return !r;
    return (f[col] === null || f[col] === undefined) ? false : !r;
  };
}
function ordenar(filas, order) {
  if (!order) return filas;
  const claves = order.split(',').map(s => { const p = s.split('.'); return { col: p[0], desc: p.includes('desc') }; });
  return filas.slice().sort((a, b) => {
    for (const k of claves) {
      const x = a[k.col], y = b[k.col];
      const nx = x === null || x === undefined, ny = y === null || y === undefined;
      if (nx || ny) { if (nx && ny) continue; return (nx ? 1 : -1) * (k.desc ? -1 : 1); }
      const sx = typeof x === 'number' ? x : String(x), sy = typeof y === 'number' ? y : String(y);
      if (sx < sy) return k.desc ? 1 : -1;
      if (sx > sy) return k.desc ? -1 : 1;
    }
    return 0;
  });
}
function parseQS(qs) {
  const preds = []; let order = null, limit = null, select = '*';
  (qs || '').split('&').filter(Boolean).forEach(kv => {
    const k = kv.indexOf('=');
    const nombre = decodeURIComponent(kv.slice(0, k)), v = decodeURIComponent(kv.slice(k + 1));
    if (nombre === 'select') { select = v; return; }
    if (nombre === 'order') { order = v; return; }
    if (nombre === 'limit') { limit = Number(v); return; }
    if (nombre === 'or') { preds.push(predicado('or' + v)); return; }
    preds.push(predicado(nombre + '.' + v));
  });
  return { preds, order, limit, select };
}

function crearMotor(estado, registro) {
  const resp = (codigo, texto, cab) => ({ getResponseCode: () => codigo, getContentText: () => texto, getHeaders: () => cab || {} });
  function fetch(url, opts) {
    opts = opts || {};
    const metodo = (opts.method || 'get').toLowerCase();
    if (url.length > 2048) throw new Error('URL de ' + url.length + ' bytes: UrlFetchApp revienta pasados ~2 KB');
    const T = estado.tablas;
    const mRpc = url.match(/\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/);
    if (mRpc) {
      registro.push({ metodo: 'rpc', tabla: mRpc[1], url: '', payload: opts.payload || '' });
      if (mRpc[1] === 'siguiente_bloque_ids_etiquetas') {
        const n = JSON.parse(opts.payload).p_cantidad;
        let mx = T.etiquetas.reduce((a, e) => Math.max(a, Number(String(e.id_unico).replace('HODOS-', '')) || 0), 0);
        return resp(200, JSON.stringify(Array.from({ length: n }, () => 'HODOS-' + String(++mx).padStart(6, '0'))), {});
      }
      // Lecturas agregadas en el servidor (migraciones/2026-10-15-*.sql). Aquí van en JS con la
      // MISMA semántica que el SQL; que el SQL de verdad la cumple lo comprueba
      // herramientas/pruebas-egress-historial-sql.js contra Postgres real (PGlite).
      if (mRpc[1] === 'historial_lotes' || mRpc[1] === 'subtipos_taisa_usados') {
        let filas;
        if (mRpc[1] === 'historial_lotes') {
          const p = JSON.parse(opts.payload || '{}').p_limite;
          const limite = Math.max(p === null || p === undefined ? 10 : p, 1);
          // primer registro de cada lote = el de menor (fecha_creacion, id_unico)
          const antes = (a, b) => (Date.parse(a.fecha_creacion) - Date.parse(b.fecha_creacion)) || (a.id_unico < b.id_unico ? -1 : a.id_unico > b.id_unico ? 1 : 0);
          const primeros = new Map(), cuenta = new Map();
          T.etiquetas.forEach(e => { cuenta.set(e.lote_id, (cuenta.get(e.lote_id) || 0) + 1); const q = primeros.get(e.lote_id); if (!q || antes(e, q) < 0) primeros.set(e.lote_id, e); });
          filas = Array.from(primeros.values()).sort((a, b) => antes(b, a)).slice(0, limite)
            .map(e => ({ lote_id: e.lote_id, cantidad: cuenta.get(e.lote_id), origen_texto: e.origen_texto, destino: e.destino, fecha_creacion: e.fecha_creacion }));
        } else {
          // orden de primera aparición en la tabla (ctid) = el orden del array simulado
          const vistos = new Set(); filas = [];
          T.etiquetas.forEach(e => { if (e.origen === 'Taisa' && e.subtipo !== null && e.subtipo !== undefined && !vistos.has(e.subtipo)) { vistos.add(e.subtipo); filas.push({ subtipo: e.subtipo }); } });
        }
        const texto = JSON.stringify(filas);
        registro[registro.length - 1].lectura = true; registro[registro.length - 1].filas = filas.length; registro[registro.length - 1].bytes = texto.length;
        return resp(200, texto, {});
      }
      throw new Error('RPC no simulada: ' + mRpc[1]);
    }
    const m = url.match(/\/rest\/v1\/([A-Za-z0-9_]+)(?:\?(.*))?$/);
    if (!m) throw new Error('URL no soportada: ' + url);
    const tabla = m[1];
    if (!T[tabla]) throw new Error('tabla simulada inexistente: ' + tabla);
    const q = parseQS(m[2]);
    const cab = opts.headers || {};
    const prefer = cab.Prefer || '';
    const coincide = f => q.preds.every(p => p(f));
    if (metodo === 'get') {
      const ord = ordenar(T[tabla].filter(coincide), q.order);
      let a = 0, b = Infinity;
      if (cab.Range) { const mm = cab.Range.match(/^(\d+)-(\d+)$/); a = Number(mm[1]); b = Number(mm[2]); }
      let n = Math.min(b - a + 1, MAX_ROWS); if (q.limit !== null) n = Math.min(n, q.limit);
      let pagina = ord.slice(a, a + n);
      if (q.select !== '*') { const cols = q.select.split(','); pagina = pagina.map(f => { const o = {}; cols.forEach(c => { o[c] = f[c]; }); return o; }); }
      const cr = (pagina.length ? (a + '-' + (a + pagina.length - 1)) : '*') + '/' + (prefer.includes('count=exact') ? ord.length : '*');
      const texto = JSON.stringify(pagina);
      registro.push({ metodo: 'get', tabla, url: m[2] || '', filas: pagina.length, bytes: texto.length, entera: tabla === 'etiquetas' || tabla === 'contenido' || tabla === 'cargas' ? !/(^|&)(?!select=|order=)[a-z_]+=/.test(m[2] || '') : false });
      return resp(cab.Range && pagina.length < ord.length ? 206 : 200, texto, { 'Content-Range': cr });
    }
    if (metodo === 'patch') {
      const cambios = JSON.parse(opts.payload);
      const afectadas = T[tabla].filter(coincide);
      afectadas.forEach(f => Object.assign(f, cambios));
      registro.push({ metodo: 'patch', tabla, url: m[2] || '', payload: opts.payload });
      return resp(200, prefer.includes('return=representation') ? JSON.stringify(afectadas) : '', {});
    }
    if (metodo === 'delete') {
      if (!q.preds.length) throw new Error('DELETE sin filtro');
      const borradas = T[tabla].filter(coincide);
      T[tabla] = T[tabla].filter(f => !coincide(f));
      registro.push({ metodo: 'delete', tabla, url: m[2] || '', payload: '' });
      return resp(200, prefer.includes('return=representation') ? JSON.stringify(borradas) : '', {});
    }
    if (metodo === 'post') {
      let filas = JSON.parse(opts.payload);
      if (!Array.isArray(filas)) filas = [filas];
      const claves = PK[tabla];
      filas.forEach(f => { if (claves && T[tabla].some(x => claves.every(c => String(x[c]) === String(f[c])))) throw new Error('clave duplicada en ' + tabla); });
      const nuevas = filas.map(f => Object.assign({}, f));
      nuevas.forEach(f => T[tabla].push(f));
      registro.push({ metodo: 'post', tabla, url: m[2] || '', payload: opts.payload });
      return resp(201, prefer.includes('return=representation') ? JSON.stringify(nuevas) : '', {});
    }
    throw new Error('método no soportado: ' + metodo);
  }
  return { fetch };
}

// ------------------------------------------------------- contexto GAS
const T0 = Date.UTC(2026, 9, 6, 10, 0, 0);
class FakeDate extends Date {
  constructor(...a) { if (a.length === 0) super(T0); else super(...a); }
  static now() { return T0; }
}
function crearContexto(fuentes) {
  const estado = { tablas: null };
  const registro = [], logs = [], efectos = [];
  const motor = crearMotor(estado, registro);
  const ctx = {
    console: { log() {}, error() {}, warn() {}, info() {} },
    Date: FakeDate, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Set, Map, parseInt, parseFloat, isNaN,
    encodeURIComponent, decodeURIComponent, Intl,
    Logger: { log(x) { logs.push(String(x)); } },
    UrlFetchApp: { fetch: motor.fetch, fetchAll: reqs => reqs.map(r => motor.fetch(r.url, r)) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k === 'SUPABASE_URL' ? 'https://simulado.supabase.co' : k === 'SUPABASE_SERVICE_KEY' ? 'clave-simulada' : null) }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'admin@simulado' }) },
    CacheService: { getScriptCache: () => ({ put() {}, get() { return null; }, remove() {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate(fecha, tz, fmt) {
        const p = {};
        new Intl.DateTimeFormat('en-GB', { timeZone: tz === 'GMT+1' ? 'Etc/GMT-1' : tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
          .formatToParts(fecha).forEach(x => { p[x.type] = x.value; });
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour === '24' ? '00' : p.hour).replace('mm', p.minute).replace('ss', p.second);
      },
      getUuid: () => 'uuid-fijo', sleep() {}
    }
  };
  vm.createContext(ctx);
  ARCHIVOS.forEach(f => vm.runInContext(fuentes[f], ctx, { filename: f }));
  // Lo que sale fuera (INCPC por HTTP) y la reclamación del cierre -> stubs idénticos en viejo y nuevo.
  ctx.notificarAgrupacionAIncpc_ = function (a, b) { efectos.push('incpc:' + a + '>' + b); return { ok: true }; };
  ctx.actualizarCargaCondicional_ = function (idCarga, cambios, filtro) { efectos.push('reclamar:' + idCarga + ':' + JSON.stringify(cambios) + ':' + filtro); return null; };
  return { ctx, estado, registro, logs, efectos };
}

// ------------------------------------------------------- datos sintéticos
const TIENDAS = ['Málaga', 'Marbella', 'Mijas', 'Granada'];
const ORIGENES = ['Taisa', 'Cesión', 'MECO', 'Valencia', 'Torija', 'Antequera'];
// Los 4 primeros están en la lista base de obtenerSubtiposConocidos; el resto la amplían (como los
// «SOBRANTE»/«Otros»/«ROTO» que ya hay en producción) y '' es un subtipo vacío (se ignora).
const SUBTIPOS = ['Devolución', 'Inventario', 'Petición Reserva', 'Pedido cliente', 'SOBRANTE', 'Otros', 'ROTO', 'Cambio directo/Recogida', ''];

function generarDatos(semilla, opciones) {
  opciones = opciones || {};
  const r = mulberry32(semilla);
  const ent = (a, b) => a + Math.floor(r() * (b - a + 1));
  const el = arr => arr[Math.floor(r() * arr.length)];
  const H = 3600 * 1000;
  const iso = ms => new Date(ms).toISOString();

  const nCargas = opciones.nCargas !== undefined ? opciones.nCargas : ent(4, 50);
  const cargas = [];
  for (let i = 1; i <= nCargas; i++) {
    cargas.push({
      id_carga: 'CARGA-' + String(i).padStart(6, '0'), destino: el(TIENDAS), fecha_entrega: iso(T0 + ent(-5, 3) * 24 * H).slice(0, 10), horario: el(['10:00', '16:00']),
      estado: i > nCargas - ent(1, 3) ? 'ABIERTA' : 'CERRADA', creada_por: 'a@b.com', fecha_creacion: iso(T0 - r() * 20 * 24 * H), cerrada_por: null, fecha_cierre: null, pdf_url: null, email_enviado: null
    });
  }
  const abiertas = cargas.filter(c => c.estado === 'ABIERTA');

  const etiquetas = []; let n = 0;
  const nEt = opciones.nEtiquetas !== undefined ? opciones.nEtiquetas : ent(40, 700);
  let lote = 0;
  while (etiquetas.length < nEt) {
    lote++;
    const origen = el(ORIGENES);
    const destino = el(TIENDAS);
    const fecha = iso(T0 - (r() < 0.3 ? r() * 30 * H : r() * 12 * 24 * H));
    const subtipo = origen === 'Taisa' ? el(SUBTIPOS) : (r() < 0.04 ? 'ANOMALO' : null); // 'ANOMALO': subtipo en un origen que no es Taisa (no debe salir)
    const pend = r() < 0.12;
    // Un lote real lleva varios pedidos (la lista que se pega) y todos comparten fecha_creacion; los hay de uno solo.
    const nPed = r() < 0.35 ? ent(2, 7) : 1;
    for (let q = 0; q < nPed; q++) {
    const ped = r() < 0.12 ? String(ent(100000, 999999)) + '+' + String(ent(100000, 999999)) : String(ent(100000, 999999));
    const total = r() < 0.7 ? 1 : ent(2, 4);
    for (let s = 1; s <= total; s++) {
      n++;
      const registrado = r() < 0.55;
      const carga = registrado ? null : el(cargas);
      // Llegadas de Antequera: cada soporte lleva su pedido de proveedor en el origen_texto, así que
      // las filas de UN lote pueden tener origen_texto distinto (16 de 2.418 lotes el 15/10).
      const origenTexto = origen === 'Antequera' && r() < 0.7 ? 'ANTEQUERA · PED. PROV. ' + ent(81000000, 93999999) : origen.toUpperCase() + (subtipo ? ' - ' + subtipo.toUpperCase() : '');
      etiquetas.push({
        id_unico: 'HODOS-' + String(n).padStart(6, '0'), numero_pedido: ped, soporte_num: s, soporte_total: total, origen, subtipo,
        origen_texto: origenTexto, destino, fecha_creacion: fecha, lote_id: 'lote-' + lote,
        creado_por: r() < 0.3 ? 'INCPC · x' : 'a@b.com', estado: registrado ? 'REGISTRADO' : 'EN_RUTA', batea_id: carga ? carga.id_carga : null,
        fecha_envio: carga ? iso(T0 - r() * 5 * 24 * H) : null, origen_tienda: origen === 'Cesión' ? el(TIENDAS) : null,
        razon_flujo: r() < 0.1 ? 'Sobrante' : null, pendiente_impresion_incpc: pend ? true : (r() < 0.5 ? false : null), expedicion: r() < 0.2 ? 'EXP' + ent(1, 9) : null
      });
    }
    }
  }
  // dos lotes con exactamente la misma fecha_creacion (empate entre lotes; sin esto, el orden del historial no se prueba)
  const lotes = Array.from(new Set(etiquetas.map(e => e.lote_id)));
  if (lotes.length > 6) {
    const x = lotes[ent(0, lotes.length - 1)], y = lotes[ent(0, lotes.length - 1)];
    if (x !== y) { const f = etiquetas.find(e => e.lote_id === x).fecha_creacion; etiquetas.forEach(e => { if (e.lote_id === y) e.fecha_creacion = f; }); }
  }
  // soportes de borde alrededor de la medianoche GMT+1 (23:00Z): para el filtro por fecha
  [-30, -1, 1, 30].forEach((min, k) => {
    if (!etiquetas[k]) return;
    etiquetas[k].fecha_creacion = iso(Date.UTC(2026, 9, 4, 23, 0, 0) + min * 60000);
  });
  // cargas ABIERTAS con soportes dentro y hermanos pendientes (para los bloqueos de cierre)
  abiertas.forEach(c => {
    etiquetas.filter(() => r() < 0.08).forEach(e => { e.estado = 'EN_RUTA'; e.batea_id = c.id_carga; e.fecha_envio = iso(T0 - r() * 3 * H); });
  });
  const contenido = [];
  etiquetas.forEach(e => { if (r() < 0.7) for (let k = ent(1, 3); k > 0; k--) contenido.push({ id_unico: e.id_unico, descripcion: 'Art ' + ent(1, 99), cantidad: ent(1, 20), creado_por: 'a@b.com', fecha_creacion: iso(T0 - r() * H * 100) }); });
  // intercalar el contenido para que no esté agrupado por etiqueta
  for (let i = contenido.length - 1; i > 0; i--) { if (r() < 0.2) { const j = Math.floor(r() * (i + 1)); [contenido[i], contenido[j]] = [contenido[j], contenido[i]]; } }
  return { etiquetas, cargas, contenido, palets: [] };
}

// ------------------------------------------------------- escenarios
function escenarios(datos, semilla) {
  const r = mulberry32(semilla * 6151 + 7);
  const ent = (a, b) => a + Math.floor(r() * (b - a + 1));
  const el = arr => arr[Math.floor(r() * arr.length)];
  const E = datos.etiquetas;
  const out = [];
  const add = (nombre, fn) => out.push([nombre, fn]);
  const e0 = E.length ? el(E) : null;
  const fechaMadrid = e => new FakeDate(e.fecha_creacion).toISOString().slice(0, 10);

  // --- buscarEtiquetas: todos los criterios y combinaciones
  const filtros = [
    ['{}', {}], ['ordenAscendente', { ordenAscendente: true }],
    ['destino', { destino: el(TIENDAS) }], ['origen', { origen: el(ORIGENES) }], ['estado REGISTRADO', { estado: 'REGISTRADO' }], ['estado EN_RUTA', { estado: 'EN_RUTA' }],
    ['pendiente true', { pendienteImpresionIncpc: true, ordenAscendente: true }], ['pendiente false', { pendienteImpresionIncpc: false }],
    ['destino+origen+estado', { destino: el(TIENDAS), origen: el(ORIGENES), estado: 'REGISTRADO' }],
    ['pedido inexistente', { numeroPedido: '000001' }], ['texto raro', { destino: 'Málaga%' }]
  ];
  if (e0) {
    const idFrag = e0.id_unico.slice(6, 9);
    const peds = E.filter(() => r() < 0.02).slice(0, 6).map(e => e.numero_pedido);
    const pedsLargo = E.slice(0, 30).map(e => e.numero_pedido);
    filtros.push(['idUnico completo', { idUnico: e0.id_unico }], ['idUnico fragmento', { idUnico: idFrag }], ['idUnico minúsculas', { idUnico: e0.id_unico.toLowerCase() }],
      ['pedido', { numeroPedido: e0.numero_pedido }], ['pedido con espacios', { numeroPedido: '  ' + e0.numero_pedido + '  ' }],
      ['pedido parcial', { numeroPedido: e0.numero_pedido.slice(0, 4) }], ['varios pedidos', { numeroPedido: peds.concat([e0.numero_pedido]).join('\n') }],
      ['pedido con +', { numeroPedido: (E.find(e => e.numero_pedido.includes('+')) || e0).numero_pedido }],
      ['pedidos (>20 números)', { numeroPedido: pedsLargo.join('\n') }], ['pedido con comodín', { numeroPedido: e0.numero_pedido.slice(0, 3) + '*' }],
      ['pedido con coma', { numeroPedido: e0.numero_pedido + ',' + e0.numero_pedido }], ['pedido solo saltos de línea', { numeroPedido: '\n\n' }],
      ['pedido + destino', { numeroPedido: e0.numero_pedido, destino: e0.destino }], ['idUnico + origen', { idUnico: idFrag, origen: e0.origen }],
      ['fecha', { fecha: fechaMadrid(e0) }], ['fecha + destino', { fecha: fechaMadrid(e0), destino: e0.destino }],
      ['fecha frontera 04/10', { fecha: '2026-10-04' }], ['fecha frontera 05/10', { fecha: '2026-10-05' }], ['fecha mal escrita', { fecha: '04/10/2026' }],
      ['todo junto', { destino: e0.destino, origen: e0.origen, estado: e0.estado, idUnico: idFrag, numeroPedido: e0.numero_pedido, fecha: fechaMadrid(e0), pendienteImpresionIncpc: !!e0.pendiente_impresion_incpc }]);
  }
  filtros.forEach(([nombre, f]) => add('buscarEtiquetas(' + nombre + ')', c => c.buscarEtiquetas(clonar(f))));

  // --- pestañas pendientes (usan buscarEtiquetas)
  add('obtenerEtiquetasPendientesIncpc', c => c.obtenerEtiquetasPendientesIncpc());
  add('obtenerEtiquetasPendientesPreparacion', c => c.obtenerEtiquetasPendientesPreparacion());
  ['MECO', 'Valencia', 'Torija', 'Antequera'].forEach(o => add('obtenerEtiquetasPendientesArrastre(' + o + ')', c => c.obtenerEtiquetasPendientesArrastre(o)));

  // --- cargas
  datos.cargas.slice().sort(() => r() - 0.5).slice(0, 6).forEach(cg => add('obtenerCarga(' + cg.id_carga + ')', c => c.obtenerCarga(cg.id_carga)));
  add('obtenerCarga(no existe)', c => c.obtenerCarga('CARGA-999999'));
  add('obtenerHistorialLotes()', c => c.obtenerHistorialLotes());
  add('obtenerHistorialLotes(3)', c => c.obtenerHistorialLotes(3));
  // límites de verdad (el cliente manda 10; la prueba de humo, 5), el valor por defecto y los bordes
  [1, 7, 25].forEach(n => add('obtenerHistorialLotes(' + n + ')', c => c.obtenerHistorialLotes(n)));
  add('obtenerHistorialLotesMaximo(1000)', c => c.obtenerHistorialLotes(1000)); // el tope: sale aparte en el recuento porque lee casi todos los lotes
  add('obtenerHistorialLotes(0)', c => c.obtenerHistorialLotes(0));
  add('obtenerHistorialLotes(null)', c => c.obtenerHistorialLotes(null));
  add("obtenerHistorialLotes('4')", c => c.obtenerHistorialLotes('4'));
  add('obtenerSubtiposConocidos()', c => c.obtenerSubtiposConocidos());
  datos.cargas.filter(cg => cg.estado === 'ABIERTA').forEach(cg => {
    add('cerrarCarga(' + cg.id_carga + ')', c => c.cerrarCarga(cg.id_carga, false));
    add('cerrarCarga(' + cg.id_carga + ', forzar)', c => c.cerrarCarga(cg.id_carga, true));
  });
  const cerr = datos.cargas.find(cg => cg.estado === 'CERRADA');
  if (cerr) add('cerrarCarga(carga cerrada)', c => c.cerrarCarga(cerr.id_carga, false));
  add('cerrarCarga(no existe)', c => c.cerrarCarga('CARGA-999999', false));

  // --- agrupar soportes (lee contenido de los originales)
  const registrados = E.filter(e => e.estado === 'REGISTRADO' && e.soporte_total === 1);
  const mismo = registrados.length > 3 ? registrados.filter(e => e.origen === registrados[0].origen && e.destino === registrados[0].destino && e.numero_pedido !== registrados[0].numero_pedido).slice(0, 3) : [];
  if (mismo.length >= 2) add('agruparSoportesAdmin', c => c.agruparSoportesAdmin(mismo.map(e => e.id_unico)));
  if (registrados.length >= 2) add('agruparSoportesAdmin(sin comprobar compatibilidad)', c => c.agruparSoportesAdmin([registrados[0].id_unico, registrados[1].id_unico]));
  add('agruparSoportesAdmin(uno no existe)', c => c.agruparSoportesAdmin(['HODOS-999998', 'HODOS-999999']));
  return out;
}

// ------------------------------------------------------- ejecución comparada
const reemplazo = (k, v) => (v === undefined ? '__undef__' : v);
// obtenerHistorialLotes devuelve además `pedidos` (2026-10-15, v105). Contra una base que aún no los devuelve se
// compara SIN ese campo (solo en esas acciones: otras llevan campos con ese nombre) y los números se comprueban
// aparte, contra los datos (pedidosDelHistorialMal).
const reemplazoSinPedidos = (k, v) => (k === 'pedidos' ? undefined : reemplazo(k, v));
const esHistorial = (nombre) => /^obtenerHistorialLotes/.test(nombre);
function ejecutar(cx, datos, fn, sinPedidos) {
  cx.estado.tablas = clonar(datos);
  cx.registro.length = 0; cx.logs.length = 0; cx.efectos.length = 0;
  let ret, retCompleto;
  try {
    const valor = fn(cx.ctx);
    ret = JSON.stringify(valor, sinPedidos ? reemplazoSinPedidos : reemplazo);
    retCompleto = sinPedidos ? JSON.stringify(valor, reemplazo) : ret;
  } catch (e) { ret = retCompleto = 'ERROR: ' + e.message; }
  const lect = cx.registro.filter(p => p.metodo === 'get' || p.lectura); // GET + RPC de solo lectura
  return {
    ret, retCompleto, db: JSON.stringify(cx.estado.tablas),
    escrituras: JSON.stringify(cx.registro.filter(p => p.metodo !== 'get' && !p.lectura).map(p => [p.metodo, p.tabla, p.url, p.payload])),
    logs: JSON.stringify(cx.logs), efectos: JSON.stringify(cx.efectos),
    reg: cx.registro.map(p => p.metodo + ' ' + p.tabla + ' ' + (p.url || '').slice(0, 100) + (p.filas !== undefined ? ' -> ' + p.filas : '')),
    filas: lect.reduce((s, p) => s + p.filas, 0), bytes: lect.reduce((s, p) => s + p.bytes, 0), peticiones: lect.length,
    enteras: lect.filter(p => p.entera && p.tabla === 'etiquetas').length
  };
}
const comparar2 = (a, b) => ['ret', 'db', 'escrituras', 'logs', 'efectos'].filter(k => a[k] !== b[k]);

// Los números de pedido que debe llevar cada lote del historial, calculados aquí desde los datos (no con el código
// del servidor): los de sus soportes por (fecha_creacion, id_unico), un soporte agrupado «a+b» aporta a y b, sin repetir.
// Devuelve cuántos lotes del resultado llevan una lista distinta de esa.
function pedidosDelHistorialMal(datos, retJson) {
  let lotes;
  try { lotes = JSON.parse(retJson); } catch (e) { return 1; }
  if (!Array.isArray(lotes)) return 0; // un error u otra respuesta: lo cubre la comparación normal
  const antes = (a, b) => (Date.parse(a.fecha_creacion) - Date.parse(b.fecha_creacion)) || (a.id_unico < b.id_unico ? -1 : a.id_unico > b.id_unico ? 1 : 0);
  return lotes.filter(l => {
    const esperados = [];
    datos.etiquetas.filter(e => e.lote_id === l.loteId).sort(antes)
      .forEach(e => String(e.numero_pedido).split('+').map(t => t.trim()).filter(Boolean).forEach(t => { if (esperados.indexOf(t) === -1) esperados.push(t); }));
    return JSON.stringify(l.pedidos) !== JSON.stringify(esperados);
  }).length;
}

function main() {
  const nuevo = leerNuevo(), viejo = leerViejo();
  let fallos = 0;
  const ok = (cond, msg) => { console.log((cond ? '  OK   ' : '  FALLA ') + msg); if (!cond) fallos++; };
  const cxV = crearContexto(viejo), cxN = crearContexto(nuevo);

  console.log('== 0. Sanidad: el código viejo (' + OLD_REF + ') ejecuta los escenarios en el simulador ==');
  const d0 = generarDatos(3), esc0 = escenarios(d0, 3);
  const errs = esc0.map(([n, fn]) => [n, ejecutar(cxV, d0, fn).ret]).filter(([, rr]) => /^ERROR/.test(rr) && !/(Carga no encontrada|ya está cerrada|No se puede cerrar|Alguno de los soportes|No hay|Selecciona|Todos los soportes deben|Solo se puede agrupar)/.test(rr));
  console.log('   ' + esc0.length + ' escenarios; errores inesperados: ' + errs.length + (errs.length ? ' -> ' + JSON.stringify(errs.slice(0, 3)).slice(0, 500) : ''));
  ok(errs.length === 0, 'sin errores del simulador en el código viejo');

  console.log('== 1. Equivalencia viejo vs nuevo: ' + SEMILLAS + ' conjuntos de datos × todos los escenarios ==');
  const conjuntos = [];
  for (let s = 1; s <= SEMILLAS; s++) conjuntos.push([s, generarDatos(s), 'semilla ' + s]);
  conjuntos.push([901, generarDatos(901, { nEtiquetas: 6, nCargas: 2 }), 'conjunto mínimo']);
  conjuntos.push([902, generarDatos(902, { nEtiquetas: 2500, nCargas: 60 }), 'conjunto grande (>1000 etiquetas)']);
  conjuntos.push([903, generarDatos(903, { nEtiquetas: 0, nCargas: 0 }), 'vacío']);
  const porNombre = {};
  let historiales = 0, pedidosMalos = 0;
  let total = 0, malas = 0, filasV = 0, filasN = 0, bytesV = 0, bytesN = 0, petV = 0, petN = 0, enterasV = 0, enterasN = 0;
  for (const [seed, datos, etiqueta] of conjuntos) {
    for (const [nombre, fn] of escenarios(datos, seed)) {
      if (process.env.SOLO && !new RegExp(process.env.SOLO).test(nombre)) continue;
      const hist = esHistorial(nombre);
      const a = ejecutar(cxV, datos, fn, hist), b = ejecutar(cxN, datos, fn, hist);
      const difs = comparar2(a, b);
      if (hist) { historiales++; pedidosMalos += pedidosDelHistorialMal(datos, b.retCompleto); }
      if (process.env.VERBOSO && difs.length) { console.log('--- ' + etiqueta + ' · ' + nombre + ' · viejo:'); a.reg.forEach(x => console.log('   V ' + x)); console.log('--- nuevo:'); b.reg.forEach(x => console.log('   N ' + x)); }
      total++;
      const base = nombre.replace(/\(CARGA-\d+/, '(CARGA-n').replace(/\(.*\)$/, '(…)');
      const f = porNombre[base] = porNombre[base] || { n: 0, filasV: 0, filasN: 0, bytesV: 0, bytesN: 0, enterasV: 0, enterasN: 0 };
      f.n++; f.filasV += a.filas; f.filasN += b.filas; f.bytesV += a.bytes; f.bytesN += b.bytes; f.enterasV += a.enteras; f.enterasN += b.enteras;
      filasV += a.filas; filasN += b.filas; bytesV += a.bytes; bytesN += b.bytes; petV += a.peticiones; petN += b.peticiones; enterasV += a.enteras; enterasN += b.enteras;
      if (difs.length) {
        malas++;
        if (malas <= 4) {
          console.log('   ' + etiqueta + ' · ' + nombre + ' difiere en: ' + difs.join(', '));
          difs.slice(0, 2).forEach(k => console.log('      ' + k + ': viejo=' + String(a[k]).slice(0, 300) + '\n      ' + ' '.repeat(k.length) + '  nuevo=' + String(b[k]).slice(0, 300)));
        }
      }
    }
  }
  ok(malas === 0, malas + ' de ' + total + ' ejecuciones con resultado/estado/escrituras distintos (esperado 0)');
  ok(historiales > 0 && pedidosMalos === 0, 'números de pedido del historial: ' + pedidosMalos + ' lotes con una lista distinta de la calculada desde los datos, en ' + historiales + ' llamadas (esperado 0)');

  console.log('== 2. Lo que se lee, por acción (suma de todas las ejecuciones) ==');
  Object.keys(porNombre).forEach(n => {
    const f = porNombre[n];
    console.log('   ' + n.padEnd(46) + ' filas ' + String(f.filasV).padStart(8) + ' -> ' + String(f.filasN).padStart(7) + '   KB ' + String(Math.round(f.bytesV / 1024)).padStart(6) + ' -> ' + String(Math.round(f.bytesN / 1024)).padStart(5));
  });
  console.log('   TOTAL filas: ' + filasV + ' -> ' + filasN + ' (' + Math.round(100 * (1 - filasN / filasV)) + ' % menos) · bytes JSON: ' + Math.round(bytesV / 1024) + ' KB -> ' + Math.round(bytesN / 1024) + ' KB (' + Math.round(100 * (1 - bytesN / bytesV)) + ' % menos) · peticiones: ' + petV + ' -> ' + petN + ' · lecturas enteras de etiquetas: ' + enterasV + ' -> ' + enterasN);
  // Contra la base de la Fase 2 (7f81f28) se exige −60 %; contra una base que ya la incluye (p.ej. producción
  // 5ac0edc, para el historial de lotes y los subtipos) solo que no suba: lo que baja ahí se ve en la sección 2.
  const umbralBytes = Number(process.env.UMBRAL_BYTES || 0.4);
  ok(bytesN < bytesV * umbralBytes, umbralBytes < 1 ? 'los bytes leídos bajan más de un ' + Math.round(100 * (1 - umbralBytes)) + ' %' : 'los bytes leídos no suben más de un ' + Math.round(100 * (umbralBytes - 1)) + ' %');
  // Historial: del orden de la tabla entera a ≤10 filas por llamada (−98 % aquí; en producción 7.246 -> 10).
  // Subtipos: de una fila por etiqueta Taisa a una por subtipo distinto (los datos sintéticos son pequeños:
  // en producción 2.508 -> 26, −99 %).
  // (Solo contra una base ANTERIOR a las RPC, p.ej. OLD_REF=5ac0edc; contra una que ya las lleva, SIN_TOPES_ACCION=1.)
  if (process.env.SIN_TOPES_ACCION !== '1') {
    [['obtenerHistorialLotes', 0.1], ['obtenerSubtiposConocidos', 0.25]].forEach(([accion, tope]) => {
      const f = porNombre[accion + '(…)'];
      if (f) ok(f.filasN <= f.filasV * tope && f.bytesN <= f.bytesV * tope, accion + ': filas ' + f.filasV + ' -> ' + f.filasN + ' y bytes ' + f.bytesV + ' -> ' + f.bytesN + ' (esperado: −' + Math.round(100 * (1 - tope)) + ' % o más)');
    });
  }
  // Sea cual sea la base: ni el historial (con sus números de pedido) ni los subtipos leen jamás la tabla entera.
  ['obtenerHistorialLotes(…)', 'obtenerHistorialLotesMaximo(…)', 'obtenerSubtiposConocidos(…)'].forEach(accion => {
    const f = porNombre[accion];
    if (f) ok(f.enterasN === 0, accion + ': lecturas enteras de etiquetas = ' + f.enterasN + ' (esperado 0)');
  });
  // El historial lee, además de las 10 filas de los lotes, solo los números de pedido de ESOS lotes.
  { const f = porNombre['obtenerHistorialLotes(…)'];
    if (f) { console.log('   historial con números de pedido: ' + Math.round(f.filasN / f.n) + ' filas y ' + (f.bytesN / f.n / 1024).toFixed(1) + ' KB por llamada de media (' + f.n + ' llamadas simuladas)'); } }
  ok(petN <= petV * 1.6, 'el nº de peticiones no se dispara (' + petV + ' -> ' + petN + ')');

  console.log('== 3. Mutaciones: el banco tiene que detectarlas ==');
  const conjuntoMut = conjuntos.slice(0, Math.min(SEMILLAS, 25)).concat(conjuntos.slice(-3));
  require('./pruebas-egress-fase2-mutaciones.js').forEach(([nombre, archivo, f]) => {
    if (process.env.MUT && !nombre.includes(process.env.MUT)) return;
    const mutado = Object.assign({}, nuevo);
    const antes = mutado[archivo]; mutado[archivo] = f(antes);
    if (mutado[archivo] === antes) { ok(false, nombre + ' (la mutación no se aplicó: el texto del código cambió, actualizar la mutación)'); return; }
    let detectada = false, cxM;
    try { cxM = crearContexto(mutado); } catch (e) { detectada = true; }
    for (const [seed, datos] of conjuntoMut) {
      if (detectada) break;
      for (const [nombreEsc, fn] of escenarios(datos, seed)) {
        const hist = esHistorial(nombreEsc);
        const a = ejecutar(cxV, datos, fn, hist);
        let b; try { b = ejecutar(cxM, datos, fn, hist); } catch (e) { detectada = true; break; }
        if (comparar2(a, b).length) { detectada = true; break; }
        if (hist && (pedidosDelHistorialMal(datos, b.retCompleto) || b.enteras > 0)) { detectada = true; break; } // números mal, o lee la tabla entera
      }
    }
    ok(detectada, 'mutación detectada: ' + nombre);
  });
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' COMPROBACIONES FALLAN');
  process.exit(fallos === 0 ? 0 : 1);
}
main();
