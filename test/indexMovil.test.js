const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

// Cuerpo de un bloque @media con las llaves equilibradas (los bloques llevan reglas dentro).
function bloqueMedia(consulta) {
  const inicio = html.indexOf('@media (' + consulta + ')');
  assert.ok(inicio !== -1, 'falta @media (' + consulta + ')');
  const apertura = html.indexOf('{', inicio);
  let nivel = 0;
  for (let k = apertura; k < html.length; k++) {
    if (html[k] === '{') nivel++;
    else if (html[k] === '}') { nivel--; if (nivel === 0) return html.slice(apertura + 1, k); }
  }
  throw new Error('llaves sin cerrar en @media (' + consulta + ')');
}

// Estos tests protegen lo que se arregló el 2026-10-06 tras ver HODOS en un móvil de 375 px: la barra de
// pestañas (10 botones, ~1050 px en una fila) ensanchaba la página entera y las tarjetas de las listas
// quedaban recortadas por la derecha. El comportamiento real se comprobó midiendo en Chrome dentro de
// marcos de 375/360/320 px; aquí se vigilan las reglas que lo logran.

test('móvil: la barra de pestañas se desliza de lado dentro de sí misma, en una fila y sin romper la página', () => {
  const css = bloqueMedia('max-width:860px');
  assert.match(css, /\.app-sidebar \{[^}]*overflow-x:auto/, 'la barra debe tener overflow-x:auto');
  assert.match(css, /\.app-sidebar \{[^}]*flex-direction:row/);
  assert.match(css, /\.app-sidebar button \{[^}]*flex:0 0 auto; white-space:nowrap/, 'los botones no se encogen ni parten el texto');
  assert.ok(!/\.app-sidebar button \{ flex:1;/.test(css), 'ya no deben repartirse el ancho con flex:1 (no caben 10)');
});

test('móvil: al cambiar de pestaña se deja a la vista la elegida (solo en pantalla estrecha)', () => {
  assert.match(html, /var btnActivo = document\.querySelector\('#tabBar button\.active'\);/);
  assert.match(html, /window\.matchMedia\('\(max-width:860px\)'\)\.matches/);
  assert.match(html, /btnActivo\.scrollIntoView\(\{ block: 'nearest', inline: 'center', behavior: sinAnimar \? 'auto' : 'smooth' \}\);/);
  assert.match(html, /prefers-reduced-motion: reduce/);
});

test('móvil: las tarjetas de las listas no se salen por la derecha y Pendientes no fuerza un ancho mínimo', () => {
  const css = bloqueMedia('max-width:700px');
  assert.match(css, /\.resultados-tabla tr \{ margin:12px 0;/, 'margen lateral 0: con 12px la tarjeta se recortaba');
  assert.ok(!/\.resultados-tabla tr \{ margin:12px;/.test(css));
  assert.match(css, /\.pendientes-tabla-wrap \.resultados-tabla \{ min-width:0; \}/);
  assert.match(css, /\.resultados-tabla td \{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.badge-razon-flujo \{ white-space:normal; max-width:100%; \}/);
  assert.match(css, /\.busqueda-form button \{ margin-left:0 !important; \}/);
});

test('móvil: la rejilla de Pendientes se ajusta al ancho en vez de exigir 380 px por tarjeta', () => {
  assert.match(html, /\.pendientes-grid \{[^}]*minmax\(min\(380px, 100%\), 1fr\)/);
});

test('móvil: en la Precarga Inversa la fila de cada soporte se apila (foto+nombre arriba, cantidad debajo)', () => {
  const css = bloqueMedia('max-width:520px');
  assert.match(css, /\.inversa-fila \{ flex-wrap:wrap; \}/);
  assert.match(css, /\.inversa-ficha \{ flex:1 1 100%; \}/);
  assert.match(css, /\.inversa-cantidad \{ margin-left:auto; \}/);
});
