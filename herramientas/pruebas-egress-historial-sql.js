#!/usr/bin/env node
/**
 * Banco del SQL de la migración 2026-10-15 (historial de lotes y subtipos Taisa), contra
 * Postgres de verdad: PGlite (Postgres 17 compilado a WebAssembly, en memoria, sin red).
 *
 * El banco de herramientas/pruebas-egress-fase2.js simula las dos RPC en JS; este comprueba que el
 * SQL real (el archivo de migraciones/, tal cual se aplicaría) hace lo que ese simulador supone:
 *
 *   A. historial_lotes(n) == la ESPECIFICACIÓN (implementada aparte, en JS): agrupar por lote_id, primer
 *      registro = menor (fecha_creacion, id_unico), los n lotes más recientes, el más reciente primero.
 *   B. El resultado de obtenerHistorialLotes con el código NUEVO + este SQL == el del código ANTERIOR
 *      (git OLD_REF) leyendo la tabla con las mismas consultas paginadas que hace PostgREST. Donde la
 *      respuesta antigua depende del orden de los EMPATES de Postgres (lotes cuyas filas tienen distinto
 *      origen_texto/destino, o dos lotes con la misma fecha) no hay "valor antiguo" estable: ahí solo se
 *      exige que el nuevo cumpla la especificación y se cuenta cuántas veces el antiguo habría dado otra cosa.
 *   C. subtipos_taisa_usados() == lo que sacaba el código anterior (primera aparición en un barrido
 *      secuencial sin ORDER BY), también después de UPDATE/DELETE (que cambian el orden físico).
 *   D. Permisos: ni anon ni authenticated ni public pueden ejecutarlas; service_role sí.
 *   E. Mutaciones del SQL: cada una planta un error típico y el banco tiene que detectarlo.
 *
 * Necesita PGlite (no se instala en el repo: es un proyecto de Apps Script, sin package.json):
 *     npm install --prefix <carpeta> @electric-sql/pglite
 *     PGLITE_DIR=<carpeta> node herramientas/pruebas-egress-historial-sql.js
 * Sin PGlite el banco se omite avisando (no falla).
 *
 * Variables: OLD_REF (por defecto 5ac0edc = producción v100), SEMILLAS (por defecto 60).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OLD_REF = process.env.OLD_REF || '5ac0edc';
const SEMILLAS = Number(process.env.SEMILLAS || 60);
const MIGRACION = path.join(ROOT, 'migraciones', '2026-10-15-egress-historial-lotes-y-subtipos.sql');
const LIMITES = [1, 3, 10, 25, 1000];

function cargarPglite() {
  try {
    const ruta = require.resolve('@electric-sql/pglite', { paths: [process.env.PGLITE_DIR || ROOT] });
    return require(ruta).PGlite;
  } catch (e) { return null; }
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- código Apps Script (viejo y nuevo)
function leerFuente(archivo, ref) {
  const t = ref ? execFileSync('git', ['show', ref + ':' + archivo], { cwd: ROOT, maxBuffer: 1 << 28 }).toString('utf8') : fs.readFileSync(path.join(ROOT, archivo), 'utf8');
  return t.replace(/\r\n/g, '\n');
}
function contexto(ref, stubs) {
  const ctx = Object.assign({ Math, JSON, Object, Array, String, Number, Date, Error, encodeURIComponent }, stubs);
  vm.createContext(ctx);
  ['Utilidades.gs', 'EstructuraSheets.gs', 'Backend.gs'].forEach(f => vm.runInContext(leerFuente(f, ref), ctx, { filename: f }));
  return ctx;
}

// ---------------------------------------------------------------- Postgres
const DDL = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table public.etiquetas (
  id_unico text primary key, numero_pedido text not null, soporte_num integer not null, soporte_total integer not null,
  origen text not null, subtipo text, origen_texto text not null, destino text not null,
  fecha_creacion timestamptz not null default now(), lote_id text not null, creado_por text,
  estado text not null default 'REGISTRADO', batea_id text, fecha_envio timestamptz, origen_tienda text, razon_flujo text,
  pendiente_impresion_incpc boolean not null default false, expedicion text);
create index idx_etiquetas_lote on public.etiquetas using btree (lote_id);
create index idx_etiquetas_pedido on public.etiquetas using btree (numero_pedido);
create index idx_etiquetas_batea on public.etiquetas using btree (batea_id);
alter table public.etiquetas enable row level security;`;
const COLS = ['id_unico', 'numero_pedido', 'soporte_num', 'soporte_total', 'origen', 'subtipo', 'origen_texto', 'destino', 'fecha_creacion', 'lote_id', 'estado'];
const TEXTO = { parsers: { 1184: v => v } }; // timestamptz tal cual, como texto (PostgREST también lo da como texto)

async function nuevaBase(PGlite, sqlMigracion) {
  const db = new PGlite();
  await db.exec(DDL);
  await db.exec(sqlMigracion);
  return db;
}

// ---------------------------------------------------------------- datos
const TIENDAS = ['Málaga', 'Marbella', 'Mijas', 'Granada'];
const ORIGENES = ['Taisa', 'Cesión', 'MECO', 'Valencia', 'Torija', 'Antequera'];
const SUBTIPOS = ['Devolución', 'Inventario', 'Petición Reserva', 'Pedido cliente', 'SOBRANTE', 'Otros', 'ROTO', 'Cambio directo/Recogida', 'ÑU', ''];

function generar(semilla) {
  const r = mulberry32(semilla * 7919 + 13);
  const ent = (a, b) => a + Math.floor(r() * (b - a + 1));
  const el = arr => arr[Math.floor(r() * arr.length)];
  const T0 = Date.UTC(2026, 9, 1, 8, 0, 0), MIN = 60000;
  const nLotes = semilla % 17 === 0 ? 0 : semilla % 13 === 0 ? 1 : ent(2, 90);
  const heterogeneo = r() < 0.6, empates = r() < 0.5;
  const filas = []; let n = 0; const fechasLote = [];
  for (let l = 1; l <= nLotes; l++) {
    // fechas con milisegundos (como las de Postgres); cada lote lleva la suya salvo empates deliberados
    let ms = T0 + ent(0, 40 * 24 * 60) * MIN + ent(0, 999);
    if (empates && fechasLote.length && r() < 0.25) ms = fechasLote[ent(0, fechasLote.length - 1)];
    fechasLote.push(ms);
    const origen = el(ORIGENES), destino = el(TIENDAS);
    const subtipo = origen === 'Taisa' ? (r() < 0.1 ? null : el(SUBTIPOS)) : (r() < 0.05 ? 'ANOMALO' : null);
    const total = r() < 0.6 ? 1 : ent(2, 12);
    for (let s = 1; s <= total; s++) {
      n++;
      let origenTexto = origen.toUpperCase() + (subtipo ? ' - ' + subtipo.toUpperCase() : '');
      let destinoFila = destino;
      if (heterogeneo && origen === 'Antequera' && r() < 0.8) origenTexto = 'ANTEQUERA · PED. PROV. ' + ent(81000000, 93999999);
      if (heterogeneo && r() < 0.05) destinoFila = el(TIENDAS);
      // algún soporte con fecha propia (la fecha de un lote NO siempre es común)
      const ms2 = heterogeneo && r() < 0.04 ? ms + ent(-5, 5) * MIN : ms;
      filas.push({ id_unico: 'HODOS-' + String(n).padStart(6, '0'), numero_pedido: String(ent(100000, 999999)), soporte_num: s, soporte_total: total, origen, subtipo,
        origen_texto: origenTexto, destino: destinoFila, fecha_creacion: new Date(ms2).toISOString(), lote_id: 'lote-' + l + (empates && r() < 0.3 ? '-' + ent(1, 3) : ''), estado: 'REGISTRADO' });
    }
  }
  // se insertan desordenadas (el orden físico no es el de id_unico ni el de la fecha)
  const insercion = filas.slice();
  for (let i = insercion.length - 1; i > 0; i--) { if (r() < 0.5) { const j = Math.floor(r() * (i + 1)); [insercion[i], insercion[j]] = [insercion[j], insercion[i]]; } }
  return { filas: insercion, ids: filas.map(f => f.id_unico), semilla };
}
async function cargar(db, datos) {
  await db.exec('truncate table public.etiquetas');
  for (let i = 0; i < datos.filas.length; i += 200) {
    const trozo = datos.filas.slice(i, i + 200);
    const params = []; const vals = trozo.map((f, k) => { COLS.forEach(c => params.push(f[c])); return '(' + COLS.map((_, j) => '$' + (k * COLS.length + j + 1)).join(',') + ')'; });
    await db.query('insert into public.etiquetas (' + COLS.join(',') + ') values ' + vals.join(','), params);
  }
  // UPDATE y DELETE: cambian el orden físico (ctid) como los escaneos de producción
  const r = mulberry32(datos.semilla * 31 + 5);
  const n = datos.filas.length;
  for (let k = 0; k < Math.floor(n / 4); k++) { const f = datos.filas[Math.floor(r() * n)]; await db.query("update public.etiquetas set estado = 'EN_RUTA' where id_unico = $1", [f.id_unico]); }
  for (let k = 0; k < Math.floor(n / 10); k++) { const f = datos.filas[Math.floor(r() * n)]; await db.query('delete from public.etiquetas where id_unico = $1', [f.id_unico]); }
}

// ---------------------------------------------------------------- referencias
// Las lecturas del código viejo, exactamente como las pagina PostgREST (Range de 1000 en 1000).
async function leerComoPostgrest(db, selectSql) {
  const total = Number((await db.query('select count(*)::int c from public.etiquetas')).rows[0].c);
  let todas = [];
  for (let off = 0; off < Math.max(total, 1); off += 1000) todas = todas.concat((await db.query(selectSql + ' limit 1000 offset ' + off, [], TEXTO)).rows);
  return todas;
}
// La ESPECIFICACIÓN, aparte del SQL: para detectar si el SQL se aparta de ella.
function especificacion(filas, n) {
  const antes = (a, b) => (Date.parse(a.fecha_creacion) - Date.parse(b.fecha_creacion)) || (a.id_unico < b.id_unico ? -1 : a.id_unico > b.id_unico ? 1 : 0);
  const primeros = new Map(), cuenta = new Map();
  filas.forEach(e => { cuenta.set(e.lote_id, (cuenta.get(e.lote_id) || 0) + 1); const q = primeros.get(e.lote_id); if (!q || antes(e, q) < 0) primeros.set(e.lote_id, e); });
  return Array.from(primeros.values()).sort((a, b) => antes(b, a)).slice(0, n).map(e => ({ lote_id: e.lote_id, cantidad: cuenta.get(e.lote_id), origen_texto: e.origen_texto, destino: e.destino, fecha_ms: Date.parse(e.fecha_creacion) }));
}
const ms = t => Date.parse(String(t).replace(' ', 'T').replace(/\+00$/, 'Z'));

async function comprobarConjunto(db, datos, ctxViejo, ctxNuevo, est, res) {
  await cargar(db, datos);
  const vivas = (await db.query('select id_unico, lote_id, origen_texto, destino, fecha_creacion, origen, subtipo from public.etiquetas', [], TEXTO)).rows;

  // --- código viejo: la tabla entera, paginada, en el orden de PostgREST
  est.viejoHistorial = await leerComoPostgrest(db, 'select lote_id, origen_texto, destino, fecha_creacion from public.etiquetas order by fecha_creacion asc');
  est.viejoSubtipos = await leerComoPostgrest(db, "select subtipo from public.etiquetas where origen = 'Taisa' and subtipo is not null");
  const subViejo = ctxViejo.obtenerSubtiposConocidos();
  // --- código nuevo + SQL
  est.rpc = {};
  for (const n of LIMITES) est.rpc['historial:' + n] = (await db.query('select * from public.historial_lotes($1)', [n], TEXTO)).rows;
  est.rpc['subtipos'] = (await db.query('select * from public.subtipos_taisa_usados()', [], TEXTO)).rows;
  const subNuevo = ctxNuevo.obtenerSubtiposConocidos();
  res.subtipos++;
  // la RPC en crudo = los valores distintos de lo que leía el código viejo, en orden de primera aparición (sin NULL)
  const crudoViejo = []; est.viejoSubtipos.forEach(f => { if (crudoViejo.indexOf(f.subtipo) === -1) crudoViejo.push(f.subtipo); });
  if (JSON.stringify(crudoViejo) !== JSON.stringify(est.rpc['subtipos'].map(f => f.subtipo))) { res.subtiposMal++; if (res.subtiposMal <= 3) res.detalle.push('subtipos (en crudo) semilla ' + datos.semilla + ': viejo=' + JSON.stringify(crudoViejo) + ' sql=' + JSON.stringify(est.rpc['subtipos'].map(f => f.subtipo))); }
  if (JSON.stringify(subViejo) !== JSON.stringify(subNuevo)) { res.subtiposMal++; if (res.subtiposMal <= 3) res.detalle.push('subtipos semilla ' + datos.semilla + ': viejo=' + JSON.stringify(subViejo) + ' nuevo=' + JSON.stringify(subNuevo)); }

  // ¿hay empates que hagan ambigua la respuesta antigua?
  const porLote = new Map(); vivas.forEach(f => { (porLote.get(f.lote_id) || porLote.set(f.lote_id, []).get(f.lote_id)).push(f); });
  const minPorLote = new Map(); porLote.forEach((fs, id) => minPorLote.set(id, Math.min(...fs.map(f => ms(f.fecha_creacion)))));
  const lotesAmbiguos = new Set();
  porLote.forEach((fs, id) => { const enMin = fs.filter(f => ms(f.fecha_creacion) === minPorLote.get(id)); if (new Set(enMin.map(f => f.origen_texto + '|' + f.destino)).size > 1) lotesAmbiguos.add(id); });
  const fechasRepetidas = new Set(); { const vistos = new Map(); minPorLote.forEach((t, id) => { if (vistos.has(t)) { fechasRepetidas.add(id); fechasRepetidas.add(vistos.get(t)); } else vistos.set(t, id); }); }

  for (const n of LIMITES) {
    res.historial++;
    const nuevoFilas = est.rpc['historial:' + n];
    // A. contra la especificación (estricto)
    const esp = especificacion(vivas, n);
    const crudo = nuevoFilas.map(f => ({ lote_id: f.lote_id, cantidad: f.cantidad, origen_texto: f.origen_texto, destino: f.destino, fecha_ms: ms(f.fecha_creacion) }));
    if (JSON.stringify(esp) !== JSON.stringify(crudo)) { res.especMal++; if (res.especMal <= 3) res.detalle.push('historial_lotes(' + n + ') semilla ' + datos.semilla + ' no cumple la especificación:\n   esp=' + JSON.stringify(esp).slice(0, 400) + '\n   sql=' + JSON.stringify(crudo).slice(0, 400)); }
    // B. código viejo (JS sobre la tabla entera) contra código nuevo (JS sobre el SQL)
    const viejo = JSON.parse(JSON.stringify(ctxViejo.obtenerHistorialLotes(n)));
    const nuevo = JSON.parse(JSON.stringify(ctxNuevo.obtenerHistorialLotes(n)));
    const ambiguo = nuevo.some(l => lotesAmbiguos.has(l.loteId)) || viejo.some(l => lotesAmbiguos.has(l.loteId)) || nuevo.some(l => fechasRepetidas.has(l.loteId)) || viejo.some(l => fechasRepetidas.has(l.loteId));
    if (!ambiguo) {
      res.sinEmpates++;
      if (JSON.stringify(viejo) !== JSON.stringify(nuevo)) { res.viejoNuevoMal++; if (res.viejoNuevoMal <= 3) res.detalle.push('historial(' + n + ') semilla ' + datos.semilla + ' viejo≠nuevo sin empates:\n   viejo=' + JSON.stringify(viejo).slice(0, 400) + '\n   nuevo=' + JSON.stringify(nuevo).slice(0, 400)); }
    } else {
      res.conEmpates++;
      // con empates: mismo conjunto de lotes y mismas cantidades/fechas; lo que puede cambiar es QUÉ fila de un lote empatado hace de primera
      const clave = l => l.loteId + '|' + l.cantidad + '|' + ms(l.fecha);
      const a = viejo.map(clave).sort().join(';'), b = nuevo.map(clave).sort().join(';');
      const mismoOrden = viejo.map(l => l.loteId).join(',') === nuevo.map(l => l.loteId).join(',');
      if (a !== b && viejo.length === nuevo.length && !nuevo.some(l => fechasRepetidas.has(l.loteId)) && !viejo.some(l => fechasRepetidas.has(l.loteId))) { res.empatesMal++; if (res.empatesMal <= 3) res.detalle.push('historial(' + n + ') semilla ' + datos.semilla + ' difiere en algo más que el desempate'); }
      if (!mismoOrden) res.empatesOrdenDistinto++;
      const campos = l => l.loteId + '|' + l.origenTexto + '|' + l.destino;
      const mapaV = new Map(viejo.map(l => [l.loteId, campos(l)]));
      nuevo.forEach(l => { if (mapaV.has(l.loteId) && mapaV.get(l.loteId) !== campos(l)) res.empatesOtraFila++; });
    }
  }
}

function nuevoResultado() {
  return { historial: 0, especMal: 0, viejoNuevoMal: 0, sinEmpates: 0, conEmpates: 0, empatesMal: 0, empatesOrdenDistinto: 0, empatesOtraFila: 0, subtipos: 0, subtiposMal: 0, detalle: [] };
}
async function pasada(PGlite, sqlMigracion, semillas, soloDetectar) {
  const db = await nuevaBase(PGlite, sqlMigracion);
  const est = { viejoHistorial: [], viejoSubtipos: [], rpc: {} };
  const ctxViejo = contexto(OLD_REF, {
    supaGet_: (tabla, filtro, cols) => (cols === 'subtipo' ? est.viejoSubtipos : est.viejoHistorial),
    supaRpc_: () => { throw new Error('el código viejo no usa RPC aquí'); }
  });
  // el viejo lee con leerEtiquetas_ -> supaGet_ (tabla entera); sus filas ya llevan las 4 columnas
  const ctxNuevo = contexto(null, {
    supaGet_: () => { throw new Error('el código nuevo no debería leer tablas enteras aquí'); },
    supaRpc_: (nombre, params) => {
      if (nombre === 'historial_lotes') return est.rpc['historial:' + params.p_limite] || (() => { throw new Error('límite no precargado: ' + params.p_limite); })();
      if (nombre === 'subtipos_taisa_usados') return est.rpc['subtipos'];
      throw new Error('RPC inesperada ' + nombre);
    }
  });
  const res = nuevoResultado();
  for (const s of semillas) {
    await comprobarConjunto(db, generar(s), ctxViejo, ctxNuevo, est, res);
    if (soloDetectar && (res.especMal || res.viejoNuevoMal || res.subtiposMal)) break;
  }
  if (!soloDetectar) {
    // D. permisos y valores límite del parámetro
    const priv = (await db.query(`select
      has_function_privilege('anon','public.historial_lotes(integer)','execute') a1, has_function_privilege('authenticated','public.historial_lotes(integer)','execute') a2,
      has_function_privilege('anon','public.subtipos_taisa_usados()','execute') b1, has_function_privilege('authenticated','public.subtipos_taisa_usados()','execute') b2,
      has_function_privilege('service_role','public.historial_lotes(integer)','execute') s1, has_function_privilege('service_role','public.subtipos_taisa_usados()','execute') s2`)).rows[0];
    res.permisos = priv;
  }
  await cargar(db, generar(5));
  const total = Number((await db.query('select count(distinct lote_id)::int c from public.etiquetas')).rows[0].c);
  const cuenta = async sql => (await db.query(sql)).rows.length;
  res.parametros = { defecto: await cuenta('select * from public.historial_lotes()'), nulo: await cuenta('select * from public.historial_lotes(null)'), cero: await cuenta('select * from public.historial_lotes(0)'), negativo: await cuenta('select * from public.historial_lotes(-5)'), grande: await cuenta('select * from public.historial_lotes(100000)'), lotes: total };
  await db.close();
  return res;
}

async function main() {
  const PGlite = cargarPglite();
  if (!PGlite) {
    console.log('OMITIDO: no está @electric-sql/pglite (npm install --prefix <carpeta> @electric-sql/pglite; PGLITE_DIR=<carpeta>).');
    return process.exit(0);
  }
  if (!fs.existsSync(MIGRACION)) { console.log('FALTA ' + MIGRACION); return process.exit(1); }
  const sql = fs.readFileSync(MIGRACION, 'utf8').replace(/\r\n/g, '\n');
  let fallos = 0;
  const ok = (c, m) => { console.log((c ? '  OK   ' : '  FALLA ') + m); if (!c) fallos++; };
  const semillas = Array.from({ length: SEMILLAS }, (_, i) => i + 1);

  console.log('== A/B/C. SQL real contra especificación y contra el código anterior (' + OLD_REF + '): ' + SEMILLAS + ' conjuntos × límites ' + LIMITES.join('/') + ' ==');
  const r = await pasada(PGlite, sql, semillas, false);
  r.detalle.forEach(d => console.log('   ' + d));
  ok(r.especMal === 0, 'historial_lotes cumple la especificación en ' + r.historial + ' consultas (' + r.especMal + ' incumplimientos)');
  ok(r.viejoNuevoMal === 0, 'sin empates: código anterior == nuevo en ' + r.sinEmpates + ' consultas (' + r.viejoNuevoMal + ' distintas)');
  ok(r.empatesMal === 0, 'con empates (' + r.conEmpates + ' consultas): mismos lotes, cantidades y fechas (' + r.empatesMal + ' distintas); solo cambia la fila que hace de «primera» en ' + r.empatesOtraFila + ' lotes y el orden entre lotes con la misma fecha en ' + r.empatesOrdenDistinto + ' consultas');
  ok(r.subtiposMal === 0, 'subtipos: código anterior == nuevo en ' + r.subtipos + ' conjuntos (con UPDATE/DELETE que mueven el orden físico) (' + r.subtiposMal + ' distintos)');
  ok(r.sinEmpates > 50 && r.conEmpates > 20, 'el banco ejercita datos con y sin empates (' + r.sinEmpates + ' / ' + r.conEmpates + ')');
  console.log('== D. Permisos y parámetro ==');
  const p = r.permisos;
  ok(!p.a1 && !p.a2 && !p.b1 && !p.b2, 'anon y authenticated NO pueden ejecutarlas');
  ok(p.s1 && p.s2, 'service_role SÍ');
  const parametrosOk = q => q.defecto === Math.min(10, q.lotes) && q.nulo === q.defecto && q.cero === Math.min(1, q.lotes) && q.negativo === Math.min(1, q.lotes) && q.grande === q.lotes;
  ok(parametrosOk(r.parametros), 'límite: por defecto 10, null→10, 0 y negativo→1, enorme→todos ' + JSON.stringify(r.parametros));

  console.log('== E. Mutaciones del SQL: el banco tiene que detectarlas ==');
  const mutaciones = [
    ['desempate del primer registro por id_unico desc', s => s.replace('order by e.lote_id, e.fecha_creacion asc, e.id_unico asc', 'order by e.lote_id, e.fecha_creacion asc, e.id_unico desc')],
    ['primer registro = el más reciente del lote', s => s.replace('order by e.lote_id, e.fecha_creacion asc, e.id_unico asc', 'order by e.lote_id, e.fecha_creacion desc, e.id_unico asc')],
    ['lotes del más antiguo al más reciente', s => s.replace(/order by p\.fecha_creacion desc, p\.primer_id desc\n    limit/, 'order by p.fecha_creacion asc, p.primer_id asc\n    limit')],
    ['un lote de más', s => s.replace('limit greatest(coalesce(p_limite, 10), 1)', 'limit greatest(coalesce(p_limite, 10), 1) + 1')],
    ['sin límite por defecto (null = 5)', s => s.replace('coalesce(p_limite, 10)', 'coalesce(p_limite, 5)')],
    ['la cantidad cuenta solo el primer registro', s => s.replace('(select count(*) from public.etiquetas c where c.lote_id = u.lote_id)::integer', '1')],
    ['la cantidad no es la del lote (cuenta las del mismo destino)', s => s.replace('where c.lote_id = u.lote_id)', 'where c.destino = u.destino)')],
    ['orden final por fecha ascendente', s => s.replace(/order by u\.fecha_creacion desc, u\.primer_id desc\n\$\$/, 'order by u.fecha_creacion asc, u.primer_id asc\n$$')],
    ['subtipos: cualquier origen', s => s.replace("where e.origen = 'Taisa' and e.subtipo is not null", 'where e.subtipo is not null')],
    ['subtipos: alfabético en vez de por primera aparición', s => s.replace('order by min(e.ctid)', 'order by e.subtipo')],
    ['subtipos: por última aparición', s => s.replace('order by min(e.ctid)', 'order by max(e.ctid) desc')],
    ['subtipos: incluye los NULL', s => s.replace("where e.origen = 'Taisa' and e.subtipo is not null", "where e.origen = 'Taisa'")]
  ];
  for (const [nombre, f] of mutaciones) {
    const mut = f(sql);
    if (mut === sql) { ok(false, nombre + ' (la mutación no se aplicó: el SQL cambió, actualizarla)'); continue; }
    let detectada = false;
    try {
      const m = await pasada(PGlite, mut, semillas.slice(0, Math.min(SEMILLAS, 30)), true);
      detectada = m.especMal > 0 || m.viejoNuevoMal > 0 || m.subtiposMal > 0 || m.empatesMal > 0 || !parametrosOk(m.parametros);
    } catch (e) { detectada = true; }
    ok(detectada, 'mutación detectada: ' + nombre);
  }
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' COMPROBACIONES FALLAN');
  process.exit(fallos === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
