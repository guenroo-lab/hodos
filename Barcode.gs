// Barcode.gs — Encoder CODE128 (subset B), SVG. Sin dependencias externas.
// Tabla de patrones estándar de la simbología Code 128 (107 símbolos: 103 datos +
// START A/B/C + STOP). Verificada contra la librería JsBarcode y Wikipedia.

var PATRONES_CODE128 = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100","1100011101011"
];

var CODE128_START_B = 104;
var CODE128_STOP = 106;

function code128ValoresDesdeTexto_(texto) {
  var valores = [];
  for (var i = 0; i < texto.length; i++) {
    var codigo = texto.charCodeAt(i);
    if (codigo < 32 || codigo > 127) {
      throw new Error('CODE128-B solo admite ASCII 32-127: carácter no válido "' + texto[i] + '"');
    }
    valores.push(codigo - 32);
  }
  return valores;
}

function code128Checksum_(valores) {
  var suma = CODE128_START_B;
  for (var i = 0; i < valores.length; i++) {
    suma += valores[i] * (i + 1);
  }
  return suma % 103;
}

function code128Secuencia(texto) {
  if (!texto) throw new Error('code128Secuencia: texto vacío');
  var valores = code128ValoresDesdeTexto_(texto);
  var checksum = code128Checksum_(valores);
  return [CODE128_START_B].concat(valores, [checksum, CODE128_STOP]);
}

function code128Anchos(texto) {
  var secuencia = code128Secuencia(texto);
  var bits = secuencia.map(function (valor) { return PATRONES_CODE128[valor]; }).join('');
  var anchos = [];
  var actual = bits.charAt(0);
  var contador = 0;
  for (var i = 0; i < bits.length; i++) {
    if (bits.charAt(i) === actual) {
      contador++;
    } else {
      anchos.push(contador);
      actual = bits.charAt(i);
      contador = 1;
    }
  }
  anchos.push(contador);
  return anchos;
}

function code128SVG(texto, opciones) {
  opciones = opciones || {};
  var anchoModulo = opciones.anchoModulo || 2;
  var alto = opciones.alto || 60;
  var anchos = code128Anchos(texto);
  var x = 0;
  var barras = '';
  var esBarra = true; // el bitstring completo siempre empieza en barra ('1')
  anchos.forEach(function (ancho) {
    var anchoPx = ancho * anchoModulo;
    if (esBarra) {
      barras += '<rect x="' + x + '" y="0" width="' + anchoPx + '" height="' + alto + '" fill="#000"/>';
    }
    x += anchoPx;
    esBarra = !esBarra;
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + x + ' ' + alto +
    '" width="' + x + '" height="' + alto + '">' + barras + '</svg>';
}
