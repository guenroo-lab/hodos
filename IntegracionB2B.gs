// IntegracionB2B.gs — escritura en el documento B2B externo de Leroy Merlin (refill SIE,
// fusión con CartaPortesSIE). Puerto directo de actualizarB2B (CartadePortesSIE/
// CartaPortes.gs:733-834) — misma lógica sin cambios, es un contrato externo (formato y
// ubicación del Sheets los controla Leroy Merlin, no migra a Supabase bajo ningún
// concepto). Único cambio: recibe filas `palets` (camelCase de EstructuraPaletes.gs) en
// vez de la lista en memoria de CartaPortesSIE — misma forma de datos (sscc/encontrado/
// seccion), así que la lógica de conteo por sección es idéntica.

var SHEETS_ID_B2B_SIE_ = '1HIYNp2SSpXbIvwfRpFcHI7y4rqZqcrEUu8d-_4WTpeY';

var B2B_COL_FECHA_SIE_   = 1;   // A
var B2B_COL_TIPO_SIE_    = 2;   // B
var B2B_COL_DESTINO_SIE_ = 4;   // D
var B2B_COL_HORA_SIE_    = 7;   // G — Hora posicionamiento
var B2B_COL_SEC1_SIE_    = 15;  // O — Sección 1
var B2B_NUM_SECS_SIE_    = 13;  // Secciones 1-13 → cols O(15) a AA(27)

// Bug real (2026-09-23, revisión de seguridad): la hoja mensual se localizaba con la
// fecha de EJECUCIÓN (new Date(), el instante en que se cierra la carga), mientras que
// la fila dentro de esa hoja se busca por la fecha de ENTREGA de la carga (parámetro
// `fecha`, ya en formato dd/MM/yyyy — ver cerrarCarga en Backend.gs). Si una carga se
// cierra en un mes distinto al de su entrega (p.ej. entrega 31/08, cierre procesado el
// 01/09), abría la hoja "Septiembre" pero buscaba una fila con fecha de agosto: nunca
// la encontraba. Ahora la hoja se localiza con la MISMA fecha de entrega que ya se usa
// para la fila, no con el instante de ejecución. Bug heredado sin cambios del puerto
// directo de CartaPortesSIE (CartaPortes.gs) — no es un cambio de contrato con Leroy
// Merlin, solo arregla qué hoja se abre dentro del mismo documento.
function actualizarB2BSIE_(tienda, fecha, horario, paletsCotejados) {
  try {
    var ss = SpreadsheetApp.openById(SHEETS_ID_B2B_SIE_);

    var meses        = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    var partesFecha   = fecha.split('/'); // dd/MM/yyyy
    var mesEntrega    = parseInt(partesFecha[1], 10) - 1;
    var nombreHoja    = meses[mesEntrega] + ' ' + partesFecha[2];
    var hoja          = ss.getSheetByName(nombreHoja);

    if (!hoja) {
      Logger.log('B2B SIE: hoja "' + nombreHoja + '" no encontrada.');
      return { ok: false, error: 'Hoja "' + nombreHoja + '" no encontrada en el B2B de Leroy Merlin' };
    }

    var destinoB2B = 'LM ' + tienda;

    var horarioParts = horario.split(':');
    var horH = parseInt(horarioParts[0]);
    var horM = parseInt(horarioParts[1] || 0);

    var lastRow = hoja.getLastRow();
    if (lastRow < 3) { Logger.log('B2B SIE: hoja vacía'); return { ok: false, error: 'Hoja "' + nombreHoja + '" vacía' }; }

    var numRows = lastRow - 2;
    var datos   = hoja.getRange(3, 1, numRows, B2B_COL_SEC1_SIE_ + B2B_NUM_SECS_SIE_ - 1).getValues();

    var filaTarget = -1;
    for (var i = 0; i < datos.length; i++) {
      var celdaFecha   = datos[i][B2B_COL_FECHA_SIE_   - 1];
      var celdaDestino = String(datos[i][B2B_COL_DESTINO_SIE_ - 1] || '').trim();
      var celdaHora    = datos[i][B2B_COL_HORA_SIE_    - 1];
      var celdaTipo    = String(datos[i][B2B_COL_TIPO_SIE_ - 1] || '').trim();

      if (celdaTipo.indexOf('Expedici') < 0) continue;

      var fFecha = '';
      if (celdaFecha instanceof Date) {
        fFecha = Utilities.formatDate(celdaFecha, Session.getScriptTimeZone(), 'dd/MM/yyyy');
      } else {
        fFecha = String(celdaFecha || '').trim();
      }

      var horaOk = false;
      if (celdaHora instanceof Date) {
        horaOk = (celdaHora.getHours() === horH && celdaHora.getMinutes() === horM);
      } else if (typeof celdaHora === 'string' && celdaHora) {
        var parts = celdaHora.split(':');
        horaOk = (parseInt(parts[0]) === horH && parseInt(parts[1] || 0) === horM);
      }

      if (fFecha === fecha && celdaDestino === destinoB2B && horaOk) {
        filaTarget = i + 3;
        break;
      }
    }

    if (filaTarget < 0) {
      Logger.log('B2B SIE: fila no encontrada — ' + destinoB2B + ' | ' + fecha + ' | ' + horario);
      return { ok: false, error: 'Fila no encontrada en el B2B (' + destinoB2B + ' | ' + fecha + ' | ' + horario + ')' };
    }

    var conteo = {};
    for (var s = 1; s <= B2B_NUM_SECS_SIE_; s++) conteo[s] = 0;

    // Bug real (2026-09-24): esto sacaba el número con una regex del NOMBRE del
    // departamento (`p.seccion`, p.ej. "CARPINTERIA Y MADERA") — funcionaba mientras el
    // inventario traía números ("Sección 3"), pero desde que el CSV de StockSearch trae
    // nombres (17/09/2026) nunca encontraba dígito y el conteo salía siempre a cero. El
    // número correcto es `p.codSeccion` (Cod_Seccion del CSV / departmentCode de MyIso),
    // que YA viaja en el inventario aparte del nombre — confirmado con Pedro 2026-09-24.
    paletsCotejados.forEach(function (p) {
      if (!p.encontrado) return;
      var match = String(p.codSeccion || '').match(/(\d+)/);
      if (match) {
        var num = parseInt(match[1]);
        if (num >= 1 && num <= B2B_NUM_SECS_SIE_) conteo[num]++;
      }
    });

    var rangoSecs  = hoja.getRange(filaTarget, B2B_COL_SEC1_SIE_, 1, B2B_NUM_SECS_SIE_);
    var secsActual = rangoSecs.getValues()[0];

    var nuevasSecs = [];
    for (var s2 = 1; s2 <= B2B_NUM_SECS_SIE_; s2++) {
      var actual = parseInt(secsActual[s2 - 1]) || 0;
      nuevasSecs.push(actual + (conteo[s2] || 0));
    }

    rangoSecs.setValues([nuevasSecs]);

    var totalContado = 0;
    for (var s3 = 1; s3 <= B2B_NUM_SECS_SIE_; s3++) totalContado += (conteo[s3] || 0);
    Logger.log('B2B SIE OK: fila ' + filaTarget + ' | ' + destinoB2B + ' | ' + horario + ' | ' +
      paletsCotejados.length + ' SIE cotejados, ' + totalContado + ' sumados a sección');

    // Bug real (2026-09-24): con la fila encontrada, la función SIEMPRE devolvía
    // {ok:true} aunque el conteo sumado a las 13 secciones fuera 0 (todos los palets
    // "NO ENCONTRADO EN INVENTARIO", o con sección sin número parseable) — cerrarCarga
    // lo trataba como éxito y NO mostraba ningún aviso, así que en el B2B de Leroy
    // Merlin no cambiaba nada y nadie se enteraba. Ahora, si hubo palets cotejados
    // pero ninguno se sumó a ninguna sección, se devuelve igualmente {ok:true} (la
    // escritura en sí no falló) pero con un aviso para que cerrarCarga lo muestre.
    if (paletsCotejados.length > 0 && totalContado === 0) {
      return {
        ok: true,
        aviso: 'Se cotejaron ' + paletsCotejados.length + ' palets SIE para ' + destinoB2B +
          ' pero ninguno se sumó a una sección del B2B (sin coincidencia en el inventario o sección sin número) — revísalo a mano.'
      };
    }

    return { ok: true };

  } catch (err) {
    Logger.log('ERROR actualizarB2BSIE_: ' + err.toString());
    return { ok: false, error: err.message };
  }
}
