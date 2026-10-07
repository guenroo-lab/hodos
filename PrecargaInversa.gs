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
      tipo: String(fila[4] == null ? '' : fila[4]).trim() || 'Otros',
      fotoId: extraerIdDriveFoto_(fila[2])
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

// ── Torres predeterminadas ────────────────────────────────────────────────────────────────
// Botones del formulario que lo rellenan con una torre tipo (se puede ajustar antes de crearla).
// IMPORTANTE: solo valen ids del catálogo que HODOS ofrece, los mismos que tiene la pantalla de
// Torija de Plataforma: así al bipar la torre se SUMAN a lo cargado. Por eso la torre SVP no se
// define como «5 palets + 10 laterales + 35 barras» (S18_L/S18_B no existen en esa pantalla y no
// se sumarían) sino como 5 × S18 «SVP (Completo)»: Plataforma despieza cada SVP completo en
// 1 palet europeo + 2 laterales + 7 barras al escribir SALIDAS_A (Backend_Inversa.js).
var TORRES_PREDETERMINADAS_INVERSA_ = [
  { clave: 'euro-17', titulo: 'Torre palet Euro', lineas: [{ id: 'S01', cantidad: 17 }] },
  { clave: 'paletina-17', titulo: 'Torre paletinas', lineas: [{ id: 'S02', cantidad: 17 }] },
  { clave: 'svp-5', titulo: 'Torre SVP', lineas: [{ id: 'S18', cantidad: 5 }], despiecePorUnidad: { palets: 1, laterales: 2, barras: 7 } }
];

function detalleTorrePredeterminada_(plantilla, lineas) {
  var texto = lineas.map(function (l) { return l.cantidad + ' × ' + l.nombre; }).join(' + ');
  var d = plantilla.despiecePorUnidad;
  if (d) {
    var n = lineas[0].cantidad;
    texto += ' = ' + (n * d.palets) + ' palets euro + ' + (n * d.laterales) + ' laterales + ' + (n * d.barras) + ' barras';
  }
  return texto;
}

// catalogo: lo que devuelve obtenerCatalogoInversa. Una plantilla cuyo tipo no está en el catálogo
// (Plataforma lo quitó o cambió su id) no se ofrece; el nombre sale siempre del catálogo.
function torresPredeterminadasInversa_(catalogo) {
  var porId = {};
  catalogo.forEach(function (c) { porId[c.id] = c; });
  return TORRES_PREDETERMINADAS_INVERSA_.filter(function (p) {
    return p.lineas.every(function (l) { return porId[l.id]; });
  }).map(function (p) {
    var lineas = p.lineas.map(function (l) { return { id: l.id, nombre: porId[l.id].nombre, cantidad: l.cantidad }; });
    return { clave: p.clave, titulo: p.titulo, detalle: detalleTorrePredeterminada_(p, lineas), lineas: lineas, total: totalSoportesTorre_(lineas) };
  });
}

function fechaIsoONulo_(valor) {
  if (!valor) return null;
  var d = new Date(valor);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Catálogo de soportes (el mismo documento que usa Plataforma) ──────────────────────────

var CATALOGO_INVERSA_SHEET_ID_ = '1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY';
var CATALOGO_INVERSA_PESTANA_ = 'CATALOGO_SOPORTES';
var CATALOGO_INVERSA_CACHE_CLAVE_ = 'catalogo_inversa_v2'; // v2: el catálogo ya trae fotoId
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

// Para los botones de torres predeterminadas del formulario (comparten la caché del catálogo).
function obtenerTorresPredeterminadasInversa() {
  return torresPredeterminadasInversa_(obtenerCatalogoInversa());
}

// Para forzar la relectura si el equipo de Plataforma añade un tipo nuevo (se ejecuta a mano
// desde el editor; si no, el catálogo nuevo llega solo en un máximo de 6 horas).
function limpiarCacheCatalogoInversa() {
  CacheService.getScriptCache().remove(CATALOGO_INVERSA_CACHE_CLAVE_);
}

// ── Fotos del catálogo ────────────────────────────────────────────────────────────────────
// Las fotos del catálogo de Plataforma son archivos PRIVADOS de Drive: el navegador solo las ve con sesión
// de Google (y con cookies de terceros, que un móvil suele bloquear). Por eso las miniaturas las baja el
// servidor, que sí tiene acceso, y las manda dentro de la propia respuesta como data URI.

var FOTO_INVERSA_CACHE_PREFIJO_ = 'foto_inversa_v1_';
var FOTO_INVERSA_CACHE_SEGUNDOS_ = 21600;      // 6 h
var FOTO_INVERSA_CACHE_FALLO_SEGUNDOS_ = 300;  // un fallo se recuerda 5 min para no insistir en cada pantalla
var FOTO_INVERSA_MARCA_FALLO_ = '-';
// Dos topes distintos (error del 2026-10-06: con uno solo de 70 KB, la miniatura de JAULA —82 KB— y otras dos
// no llegaban nunca y en el móvil se quedaban en gris):
//  - FOTO_INVERSA_MAX_BYTES_: lo máximo que se ENVÍA al navegador. Las miniaturas de Drive miden 4-96 KB.
//  - FOTO_INVERSA_MAX_CHARS_CACHE_: lo máximo que se GUARDA en caché. CacheService admite 100 KB (102.400) por
//    entrada y el data URI es texto (base64 pesa un tercio más que los bytes). Una miniatura mayor se sirve
//    igual, pero se vuelve a pedir a Drive cada vez.
var FOTO_INVERSA_MAX_BYTES_ = 400000;
var FOTO_INVERSA_MAX_CHARS_CACHE_ = 95000;
var FOTO_INVERSA_MAX_POR_LLAMADA_ = 10;
var REGEX_ID_DRIVE_FOTO_ = /^[A-Za-z0-9_-]{10,100}$/;

// Id del archivo de Drive a partir de los enlaces habituales (file/d/ID, open?id=ID, uc?id=ID). '' si no hay.
function extraerIdDriveFoto_(url) {
  var u = String(url == null ? '' : url).trim();
  if (!u) return '';
  var m = u.match(/\/d\/([A-Za-z0-9_-]{10,100})/) || u.match(/[?&]id=([A-Za-z0-9_-]{10,100})/);
  return m ? m[1] : '';
}

// Capa fina sobre Drive (los tests la sustituyen o simulan DriveApp). null si no hay foto utilizable.
function miniaturaDriveComoDataUri_(idArchivo) {
  try {
    var archivo = DriveApp.getFileById(idArchivo);
    var blob = archivo.getThumbnail();
    if (!blob) blob = archivo.getBlob(); // sin miniatura: sirve la imagen entera si no es enorme
    if (!blob) return null;
    var bytes = blob.getBytes();
    if (!bytes || bytes.length === 0 || bytes.length > FOTO_INVERSA_MAX_BYTES_) return null;
    var tipo = String(blob.getContentType() || '');
    if (tipo.indexOf('image/') !== 0) return null;
    return 'data:' + tipo + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    return null;
  }
}

// Lo llama la pestaña por tandas (máximo 10 ids). Devuelve {idDrive: dataUri | null}. Solo se leen las fotos
// que figuran en el catálogo: un id cualquiera no se pide nunca a Drive.
function obtenerFotosCatalogoInversa(idsFoto) {
  if (!Array.isArray(idsFoto)) throw new Error('Faltan las fotos a pedir');
  if (idsFoto.length > FOTO_INVERSA_MAX_POR_LLAMADA_) {
    throw new Error('Demasiadas fotos en una sola petición (máximo ' + FOTO_INVERSA_MAX_POR_LLAMADA_ + ')');
  }
  var permitidos = {};
  obtenerCatalogoInversa().forEach(function (c) { if (c.fotoId) permitidos[c.fotoId] = true; });

  var ids = [];
  idsFoto.forEach(function (x) {
    var id = String(x == null ? '' : x).trim();
    if (ids.indexOf(id) === -1) ids.push(id);
  });

  var resultado = {};
  var pedibles = [];
  ids.forEach(function (id) {
    if (!REGEX_ID_DRIVE_FOTO_.test(id) || !permitidos[id]) { resultado[id] = null; return; }
    pedibles.push(id);
  });

  var cache = CacheService.getScriptCache();
  var guardadas = {};
  try {
    if (pedibles.length) guardadas = cache.getAll(pedibles.map(function (id) { return FOTO_INVERSA_CACHE_PREFIJO_ + id; })) || {};
  } catch (e) {
    guardadas = {};
  }
  pedibles.forEach(function (id) {
    var clave = FOTO_INVERSA_CACHE_PREFIJO_ + id;
    var valor = guardadas[clave];
    if (valor === FOTO_INVERSA_MARCA_FALLO_) { resultado[id] = null; return; }
    if (valor) { resultado[id] = valor; return; }
    var uri = miniaturaDriveComoDataUri_(id);
    try {
      if (!uri) cache.put(clave, FOTO_INVERSA_MARCA_FALLO_, FOTO_INVERSA_CACHE_FALLO_SEGUNDOS_);
      else if (uri.length <= FOTO_INVERSA_MAX_CHARS_CACHE_) cache.put(clave, uri, FOTO_INVERSA_CACHE_SEGUNDOS_);
      // Una miniatura mayor que una entrada de caché se sirve igual, pero no se guarda (ni se marca como fallo).
    } catch (e2) {
      // Sin caché solo se pierde velocidad.
    }
    resultado[id] = uri;
  });
  return resultado;
}

// ── Datos de torres (tabla public.torres_inversa) ─────────────────────────────────────────
// Una fila existe SOLO mientras la torre está pendiente: cargarla es borrarla.

// etiqueta_impresa_en (migración 2026-10-07): cuándo se imprimió la etiqueta de la torre; null = todavía
// sin imprimir (se puede crear una torre y sacar las etiquetas después, todas juntas o por selección).
function torreDesdeSupabase_(f) {
  return {
    idUnico: f.id_unico,
    lineas: f.lineas,
    total: f.total_soportes,
    creadoPor: f.creado_por,
    fechaCreacion: f.fecha_creacion,
    impresaEn: f.etiqueta_impresa_en || null
  };
}

var MAX_TORRES_POR_LOTE_INVERSA_ = 200;
var TROZO_IDS_TORRES_INVERSA_ = 30; // UrlFetchApp rechaza URLs de más de ~2 KB

// Lista de ids de torre → ids válidos, sin repetidos y en el orden dado.
function validarIdsTorresInversa_(ids, mensajeVacio) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error(mensajeVacio || 'Faltan las torres');
  if (ids.length > MAX_TORRES_POR_LOTE_INVERSA_) {
    throw new Error('Demasiadas torres de golpe (máximo ' + MAX_TORRES_POR_LOTE_INVERSA_ + ')');
  }
  var unicos = [];
  ids.map(validarIdTorreInversa_).forEach(function (id) { if (unicos.indexOf(id) === -1) unicos.push(id); });
  return unicos;
}

function trozosDeIdsInversa_(ids) {
  var trozos = [];
  for (var i = 0; i < ids.length; i += TROZO_IDS_TORRES_INVERSA_) trozos.push(ids.slice(i, i + TROZO_IDS_TORRES_INVERSA_));
  return trozos;
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
  // Cambiar el contenido deja desfasada la etiqueta que ya estuviera impresa: vuelve a «sin imprimir».
  var filas = supaActualizar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id), {
    lineas: limpias,
    total_soportes: totalSoportesTorre_(limpias),
    etiqueta_impresa_en: null
  });
  if (filas.length === 0) throw new Error('Esa torre ya no existe (puede que ya se haya cargado en un camión)');
  return torreDesdeSupabase_(filas[0]);
}

// Se llama al sacar las etiquetas (de una, varias o todas): apunta cuándo, para saber cuáles faltan.
function marcarTorresInversaImpresas(ids) {
  var limpios = validarIdsTorresInversa_(ids);
  var ahora = new Date().toISOString();
  var marcadas = 0;
  trozosDeIdsInversa_(limpios).forEach(function (trozo) {
    var filas = supaActualizar_('torres_inversa', 'id_unico=in.(' + trozo.map(encodeURIComponent).join(',') + ')', { etiqueta_impresa_en: ahora });
    marcadas += filas.length;
  });
  return { marcadas: marcadas };
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

// ── Etiqueta Zebra 100x150 de la torre ────────────────────────────────────────────────────
// Usa el mismo marco de impresión que el resto de etiquetas (envolverEtiquetasHtml_, @page
// 100x150 con el contenido rotado). Aquí solo se define el interior y su CSS propio.

var ESTILO_ETIQUETA_TORRE_INVERSA_ = [
  '.inv-lista{display:grid;grid-template-columns:1fr;gap:1mm 6mm;align-content:center;padding:0 4mm;}',
  '.inv-lista.inv-dos-col{grid-template-columns:1fr 1fr;}',
  '.inv-linea{display:flex;align-items:baseline;gap:3mm;font-weight:800;}',
  '.inv-cant{min-width:12mm;text-align:right;font-size:1.25em;}',
  '.inv-nom{text-transform:uppercase;}',
  '.inv-g{font-size:24px;}.inv-m{font-size:19px;}.inv-p{font-size:15px;}.inv-xp{font-size:12px;}',
  '.inv-total{font-size:20px;font-weight:900;text-align:center;border-top:2px solid #000;padding-top:1mm;}'
].join('');

// Cuantas más líneas, más pequeña la letra; a partir de 7 se reparten en dos columnas.
function claseTamanoLineasInversa_(n) {
  if (n <= 4) return 'inv-g';
  if (n <= 6) return 'inv-m';
  if (n <= 9) return 'inv-p';
  return 'inv-xp';
}

function htmlUnaTorreInversa_(torre, fechaTxt) {
  var n = torre.lineas.length;
  var barcodeSvg = code128SVG(String(torre.idUnico), { anchoModulo: 2, alto: 60 });
  var lineasHtml = torre.lineas.map(function (l) {
    return '<div class="inv-linea"><span class="inv-cant">' + esc_(l.cantidad) + '</span><span class="inv-nom">' + esc_(l.nombre) + '</span></div>';
  }).join('');
  var clases = 'inv-lista ' + claseTamanoLineasInversa_(n) + (n > 6 ? ' inv-dos-col' : '');
  return '' +
    '<div class="etiqueta-wrapper"><div class="etiqueta">' +
    '<div class="etiqueta-top">' +
    '<img src="data:image/png;base64,' + LOGO_TAISA_B64 + '" class="logo-taisa">' +
    '<div class="fecha-id">Creada: ' + esc_(fechaTxt) + '<div class="id-unico">' + esc_(torre.idUnico) + '</div></div>' +
    '</div>' +
    '<div class="tienda-destino">INVERSA · TORIJA</div>' +
    '<div class="' + clases + '">' + lineasHtml + '</div>' +
    '<div class="inv-total">TOTAL: ' + esc_(torre.total) + (Number(torre.total) === 1 ? ' SOPORTE' : ' SOPORTES') + '</div>' +
    '<div class="etiqueta-bottom"><div class="barcode-wrap">' + barcodeSvg + '</div></div>' +
    '</div></div>';
}

function htmlEtiquetasTorresInversa(ids) {
  var limpios = validarIdsTorresInversa_(ids, 'Faltan las torres a imprimir');
  var filas = [];
  trozosDeIdsInversa_(limpios).forEach(function (trozo) {
    supaGet_('torres_inversa', 'id_unico=in.(' + trozo.map(encodeURIComponent).join(',') + ')&order=id_unico.asc')
      .forEach(function (f) { filas.push(f); });
  });
  filas.sort(function (a, b) { return a.id_unico < b.id_unico ? -1 : a.id_unico > b.id_unico ? 1 : 0; });
  if (filas.length === 0) throw new Error('Esas torres ya no existen (puede que ya se hayan cargado en un camión)');
  var tarjetas = filas.map(function (f) {
    var torre = torreDesdeSupabase_(f);
    var fechaTxt = Utilities.formatDate(new Date(torre.fechaCreacion), 'GMT+1', 'dd/MM/yyyy');
    return htmlUnaTorreInversa_(torre, fechaTxt);
  }).join('\n');
  return envolverEtiquetasHtml_(tarjetas, ESTILO_ETIQUETA_TORRE_INVERSA_);
}

// ── Webhook para la app de Plataforma ─────────────────────────────────────────────────────
// doPost (IntegracionIncpc.gs) valida el token compartido y delega aquí estas dos acciones.
//
//  consumirTorreInversa {id}            -> borra la torre y devuelve su contenido. El DELETE con
//                                           return=representation es atómico: si dos bips llegan a
//                                           la vez, solo uno recibe la fila; el otro, NO_EXISTE.
//  devolverTorreInversa {id,lineas,creadaEn} -> deshace un consumo recreando la torre con el MISMO
//                                           id (la etiqueta física sigue siendo válida).
function procesarAccionInversa_(datos) {
  var id = validarIdTorreInversa_(datos.id);

  if (datos.accion === 'consumirTorreInversa') {
    var borradas = supaBorrar_('torres_inversa', 'id_unico=eq.' + encodeURIComponent(id));
    if (borradas.length === 0) return { ok: false, motivo: 'NO_EXISTE' };
    var torre = torreDesdeSupabase_(borradas[0]);
    return { ok: true, id: torre.idUnico, lineas: torre.lineas, total: torre.total, creadaEn: torre.fechaCreacion };
  }

  if (datos.accion === 'devolverTorreInversa') {
    var lineas = normalizarLineasTorre_(datos.lineas, obtenerCatalogoInversa());
    var fila = {
      id_unico: id,
      lineas: lineas,
      total_soportes: totalSoportesTorre_(lineas),
      creado_por: 'devuelta desde Plataforma',
      // La etiqueta física de esa torre ya existe (se bipó): vuelve como impresa, no como «sin imprimir».
      etiqueta_impresa_en: new Date().toISOString()
    };
    var creadaEn = fechaIsoONulo_(datos.creadaEn);
    if (creadaEn) fila.fecha_creacion = creadaEn;
    try {
      supaInsertar_('torres_inversa', [fila]);
    } catch (e) {
      if (/23505|duplicate key/i.test(String(e && e.message))) return { ok: false, motivo: 'YA_EXISTE' };
      throw e;
    }
    return { ok: true, id: id };
  }

  throw new Error('Acción de inversa desconocida: ' + datos.accion);
}
