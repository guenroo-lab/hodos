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
