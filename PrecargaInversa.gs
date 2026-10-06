// PrecargaInversa.gs — Precarga Inversa: torres de soportes para la inversa a Torija.
// Spec: docs/superpowers/specs/2026-10-06-precarga-inversa-design.md
//
// Una "torre" es un montón de soportes (mezcla de tipos del catálogo de Plataforma) con una
// sola etiqueta INV-000123. Se registra aquí, se imprime, y se ELIMINA cuando la app de
// Plataforma la bipa al cargar el camión (webhook al final de este archivo). HODOS no guarda
// rastro de lo cargado: ese histórico lo escribe Plataforma en su control de soportes.

var PREFIJO_TORRE_INVERSA_ = 'INV-';
var REGEX_ID_TORRE_INVERSA_ = /^INV-[0-9]{6,}$/;

// Piezas sueltas que la pantalla de Torija de Plataforma ya no ofrece (barras y laterales de
// jaula) más dos ids basura que el lector de catálogo de Plataforma también descarta.
var IDS_SOPORTE_EXCLUIDOS_INVERSA_ = ['S17_L', 'S17_B', 'S18_L', 'S18_B', 'S19_B', 'S19_L', 'S19_LSVP_LAT_DO'];

function validarIdTorreInversa_(id) {
  var limpio = String(id == null ? '' : id).trim().toUpperCase();
  if (!REGEX_ID_TORRE_INVERSA_.test(limpio)) throw new Error('Código de torre no válido: "' + id + '"');
  return limpio;
}

// filas: valores de la pestaña CATALOGO_SOPORTES (primera fila = cabecera).
// Columnas: A id, B nombre, C imagen, D volumen, E tipo.
function parsearCatalogoSoportes_(filas) {
  var resultado = [];
  var vistos = {};
  for (var i = 1; i < filas.length; i++) {
    var fila = filas[i];
    var id = String(fila[0] == null ? '' : fila[0]).trim();
    if (!id || IDS_SOPORTE_EXCLUIDOS_INVERSA_.indexOf(id) !== -1 || vistos[id]) continue;
    vistos[id] = true;
    resultado.push({
      id: id,
      nombre: String(fila[1] == null ? '' : fila[1]).trim() || id,
      tipo: String(fila[4] == null ? '' : fila[4]).trim() || 'Otros'
    });
  }
  return resultado;
}

// Reglas: casilla vacía / 0 / negativa no cuenta; cantidad no entera es un error; tipo fuera del
// catálogo es un error; tipos repetidos se suman; el nombre sale SIEMPRE del catálogo.
function normalizarLineasTorre_(lineas, catalogo) {
  if (!Array.isArray(lineas)) throw new Error('Faltan los soportes de la torre');
  var porId = {};
  catalogo.forEach(function (c) { porId[c.id] = c; });
  var acumulado = {};
  var orden = [];
  lineas.forEach(function (l) {
    var id = String(l && l.id != null ? l.id : '').trim();
    var bruto = l ? l.cantidad : '';
    if (bruto === '' || bruto == null) return;
    var cantidad = Number(bruto);
    if (!isFinite(cantidad) || Math.floor(cantidad) !== cantidad) {
      throw new Error('Cantidad no válida para ' + (id || 'un soporte') + ': ' + bruto);
    }
    if (cantidad <= 0) return;
    if (!porId[id]) throw new Error('Tipo de soporte desconocido: ' + id);
    if (acumulado[id] === undefined) { acumulado[id] = 0; orden.push(id); }
    acumulado[id] += cantidad;
  });
  if (orden.length === 0) throw new Error('La torre no tiene ningún soporte');
  return orden.map(function (id) {
    return { id: id, nombre: porId[id].nombre, cantidad: acumulado[id] };
  });
}

function totalSoportesTorre_(lineas) {
  return lineas.reduce(function (suma, l) { return suma + (Number(l.cantidad) || 0); }, 0);
}

// Total por tipo entre todas las torres pendientes (el resumen "Total precargado").
function resumenPorTipoTorres_(torres) {
  var porId = {};
  torres.forEach(function (t) {
    (t.lineas || []).forEach(function (l) {
      if (!porId[l.id]) porId[l.id] = { id: l.id, nombre: l.nombre, cantidad: 0 };
      porId[l.id].cantidad += Number(l.cantidad) || 0;
    });
  });
  return Object.keys(porId).sort().map(function (id) { return porId[id]; });
}

function fechaIsoONulo_(valor) {
  if (!valor) return null;
  var d = new Date(valor);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Catálogo de soportes (el mismo documento que usa Plataforma) ──────────────────────────

var CATALOGO_INVERSA_SHEET_ID_ = '1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY';
var CATALOGO_INVERSA_PESTANA_ = 'CATALOGO_SOPORTES';
var CATALOGO_INVERSA_CACHE_CLAVE_ = 'catalogo_inversa_v1';
var CATALOGO_INVERSA_CACHE_SEGUNDOS_ = 21600; // 6 h, el máximo de CacheService

// Capa fina sobre SpreadsheetApp (los tests la sustituyen).
function leerFilasCatalogoInversa_() {
  var hoja = SpreadsheetApp.openById(CATALOGO_INVERSA_SHEET_ID_).getSheetByName(CATALOGO_INVERSA_PESTANA_);
  if (!hoja) throw new Error('No se encontró la pestaña ' + CATALOGO_INVERSA_PESTANA_ + ' en el documento de soportes de Plataforma');
  return hoja.getDataRange().getDisplayValues();
}

function obtenerCatalogoInversa() {
  var cache = CacheService.getScriptCache();
  try {
    var guardado = cache.get(CATALOGO_INVERSA_CACHE_CLAVE_);
    if (guardado) return JSON.parse(guardado);
  } catch (e) {
    // Una caché ilegible no debe impedir leer la hoja.
  }
  var catalogo = parsearCatalogoSoportes_(leerFilasCatalogoInversa_());
  if (catalogo.length === 0) throw new Error('El catálogo de soportes está vacío o no se pudo leer');
  try {
    cache.put(CATALOGO_INVERSA_CACHE_CLAVE_, JSON.stringify(catalogo), CATALOGO_INVERSA_CACHE_SEGUNDOS_);
  } catch (e2) {
    // Sin caché solo se pierde velocidad.
  }
  return catalogo;
}

// Para forzar la relectura si el equipo de Plataforma añade un tipo nuevo (se ejecuta a mano
// desde el editor; si no, el catálogo nuevo llega solo en un máximo de 6 horas).
function limpiarCacheCatalogoInversa() {
  CacheService.getScriptCache().remove(CATALOGO_INVERSA_CACHE_CLAVE_);
}

// ── Datos de torres (tabla public.torres_inversa) ─────────────────────────────────────────
// Una fila existe SOLO mientras la torre está pendiente: cargarla es borrarla.

function torreDesdeSupabase_(f) {
  return {
    idUnico: f.id_unico,
    lineas: f.lineas,
    total: f.total_soportes,
    creadoPor: f.creado_por,
    fechaCreacion: f.fecha_creacion
  };
}

function crearTorreInversa(lineas) {
  var limpias = normalizarLineasTorre_(lineas, obtenerCatalogoInversa());
  var idUnico = supaRpc_('siguiente_id_torre_inversa', {});
  var creadoPor = Session.getActiveUser().getEmail() || 'desconocido';
  var filas = supaInsertar_('torres_inversa', [{
    id_unico: idUnico,
    lineas: limpias,
    total_soportes: totalSoportesTorre_(limpias),
    creado_por: creadoPor
  }]);
  if (filas.length === 0) throw new Error('crearTorreInversa: Supabase no devolvió la torre insertada');
  return torreDesdeSupabase_(filas[0]);
}

function listarTorresInversa() {
  var filas = supaGet_('torres_inversa', 'order=fecha_creacion.asc,id_unico.asc');
  var torres = filas.map(torreDesdeSupabase_);
  return { torres: torres, resumen: resumenPorTipoTorres_(torres) };
}

function actualizarTorreInversa(idUnico, lineas) {
  var id = validarIdTorreInversa_(idUnico);
  var limpias = normalizarLineasTorre_(lineas, obtenerCatalogoInversa());
  var filas = supaActualizar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id), {
    lineas: limpias,
    total_soportes: totalSoportesTorre_(limpias)
  });
  if (filas.length === 0) throw new Error('Esa torre ya no existe (puede que ya se haya cargado en un camión)');
  return torreDesdeSupabase_(filas[0]);
}

function borrarTorreInversa(idUnico) {
  var id = validarIdTorreInversa_(idUnico);
  var borradas = supaBorrar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id));
  if (borradas.length === 0) throw new Error('Esa torre ya no existe (puede que ya se haya cargado en un camión)');
  return { ok: true };
}

// Para la insignia de la barra lateral: solo la columna id_unico (el egress de Supabase
// importa: el proyecto está en plan Free).
function contarTorresInversaPendientes() {
  return supaGet_('torres_inversa', 'order=id_unico.asc', 'id_unico').length;
}
