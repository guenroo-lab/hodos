// CotejoInventarioSIE.gs — cotejo de palets SSCC contra el inventario diario de Drive
// (refill SIE, fusión con CartaPortesSIE). Puerto directo de leerInventarioDrive/
// cotejarSSCC (CartadePortesSIE/CartaPortes.gs) — misma lógica; solo se adapta el
// punto de entrada: en SIE se cotejaba una lista en memoria contra un solo botón
// "Generar carta", aquí se cotejan los `palets` ya guardados de una carga (mismo
// momento: al cerrar, no al escanear — abrir el inventario es caro, igual que en
// SIE, así que sigue siendo una sola apertura por carga, no una por escaneo).
//
// 2026-09-17: fuente cambiada de Power BI (.xlsx) al csv del robot StockSearch
// (API MyIso) — mismos datos, cabecera con nombre en vez de posición fija.

var DRIVE_FOLDER_ID_SIE_ = '10A5-v9FmN2MasXjbG3hvWdQeIYfPZGIg';

var NOMBRES_INVENTARIO_SIE_ = {
  'Marbella': '014',
  'Mijas':    '279'
};

// Nombres de cabecera del CSV (StockSearch_bucle.ps1) que usamos aquí. "Seccion" es el
// NOMBRE del departamento (departmentLabel, p.ej. "CARPINTERIA Y MADERA" — el que se
// enseña en el informe de cierre); "Cod_Seccion" es el número (departmentCode, 1-13) que
// hace falta para sumar en la columna correcta del B2B externo de Leroy Merlin — no
// vale sacar un número del nombre, el CSV ya trae el código aparte desde 2026-09-17.
var CSV_HEADERS_SIE_ = { SSCC: 'SSCC', LM: 'Ref_LM', SECCION: 'Seccion', COD_SECCION: 'Cod_Seccion' };

// Quita el truco Excel de forzar texto que trae el CSV del robot: ="12345" -> 12345
function _limpiarCampoCsvSie_(v) {
  var s = String(v || '').trim();
  var m = s.match(/^="(.*)"$/);
  return m ? m[1] : s;
}

// Lee el CSV (delimitador ";", cabecera en fila 1) directo del blob del archivo
// -- sin pasar por Drive.Files.create/Sheets, evita depender de que el
// conversor de Google detecte bien el delimitador ";".
function _leerCsvConCabeceraSie_(archivo) {
  var texto = archivo.getBlob().getDataAsString('UTF-8');
  // El CSV del robot StockSearch trae BOM UTF-8 (EF BB BF) delante de la
  // primera celda de cabecera ("SSCC"). getDataAsString('UTF-8') no lo quita
  // solo, y queda como ﻿ pegado al nombre -> el indice[] de esa columna
  // no coincide nunca con CSV_HEADERS_SIE_.SSCC y revienta el cotejo entero
  // (todos los palets salen "NO ENCONTRADO EN INVENTARIO", no solo el SSCC).
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  var filas = Utilities.parseCsv(texto, ';');
  if (!filas.length) throw new Error('CSV vacío: ' + archivo.getName());
  var indice = {};
  filas[0].forEach(function (h, i) { indice[String(h).trim()] = i; });
  return { indice: indice, filas: filas };
}

function leerInventarioDriveSIE_(tienda) {
  var tiendaStr  = String(tienda || '').trim();
  var nombreBase = NOMBRES_INVENTARIO_SIE_[tiendaStr];
  if (!nombreBase) throw new Error('Tienda no reconocida para inventario SIE: "' + tiendaStr + '". Valores válidos: ' + Object.keys(NOMBRES_INVENTARIO_SIE_).join(', '));

  var carpeta = DriveApp.getFolderById(DRIVE_FOLDER_ID_SIE_);
  var nombreArchivo = nombreBase + '.csv';
  var iter = carpeta.getFilesByName(nombreArchivo);
  if (!iter.hasNext()) {
    throw new Error('No se encontró el archivo de inventario para ' + tiendaStr + ' en la carpeta Drive (' + nombreArchivo + ').');
  }
  var archivo = iter.next();

  var mapa = {};
  var csv = _leerCsvConCabeceraSie_(archivo);
  var colSscc       = csv.indice[CSV_HEADERS_SIE_.SSCC];
  var colLm         = csv.indice[CSV_HEADERS_SIE_.LM];
  var colSeccion    = csv.indice[CSV_HEADERS_SIE_.SECCION];
  var colCodSeccion = csv.indice[CSV_HEADERS_SIE_.COD_SECCION];
  if (colSscc === undefined || colLm === undefined || colSeccion === undefined || colCodSeccion === undefined) {
    throw new Error('Cabecera inesperada en ' + nombreArchivo + '. Se esperaban las columnas: ' +
      CSV_HEADERS_SIE_.SSCC + ', ' + CSV_HEADERS_SIE_.LM + ', ' + CSV_HEADERS_SIE_.SECCION + ', ' + CSV_HEADERS_SIE_.COD_SECCION);
  }

  for (var i = 1; i < csv.filas.length; i++) {
    var row = csv.filas[i];
    var s  = _limpiarCampoCsvSie_(row[colSscc]);
    var lm = _limpiarCampoCsvSie_(row[colLm]);
    var d  = String(row[colSeccion] || '').trim();
    var cd = _limpiarCampoCsvSie_(row[colCodSeccion]);
    if (s && d && !mapa[s]) mapa[s] = { seccion: d, codSeccion: cd, codigoLM: lm };
  }

  return mapa;
}

// El palet se guarda con el valor escaneado tal cual (20 dígitos: AI "00" de
// GS1-128 + los 18 del SSCC — ver esFormatoSSCC_, EstructuraPaletes.gs, que
// valida el dígito de control quitando el AI pero NO persiste esa forma
// corta). El CSV del robot StockSearch en cambio trae el SSCC "pelado", ya
// sin el AI (18 dígitos). Sin normalizar aquí, la comparación de claves
// nunca coincide y el cotejo entero sale "NO ENCONTRADO", aunque el palet sí
// esté en inventario (confirmado con datos reales: CARGA-000393, 2026-09-18).
function _ssccParaCotejo_(valor) {
  var s = String(valor || '').trim();
  if (/^[0-9]{20}$/.test(s) && s.substring(0, 2) === '00') s = s.substring(2);
  return s;
}

// Cotejo en bloque de todos los palets pendientes de una carga — una sola apertura
// del inventario, igual que hacía cotejarSSCC en CartaPortesSIE. Se llama al cerrar
// la carga (cerrarCarga, Backend.gs), no al escanear cada palet.
function cotejarPaletesDeCarga_(idCarga, tienda) {
  var palets = leerPaletesPorCarga_(idCarga);
  if (!palets.length) return { ok: true, datos: [] };

  try {
    var mapa = leerInventarioDriveSIE_(tienda);
    palets.forEach(function (p) {
      var info = mapa[_ssccParaCotejo_(p.sscc)];
      actualizarPalet_(p.id, {
        encontrado: !!info,
        seccion:    info ? info.seccion    : 'NO ENCONTRADO EN INVENTARIO',
        codSeccion: info ? info.codSeccion : '',
        codigoLm:   info ? info.codigoLM   : ''
      });
    });
    return { ok: true, datos: leerPaletesPorCarga_(idCarga) };
  } catch (err) {
    return { ok: false, error: 'Error leyendo inventario SIE de ' + tienda + ': ' + err.message };
  }
}
