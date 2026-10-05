const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');

const ESTILOS = ['retro80s', 'taisa', 'obsidiana', 'oceano'];
const MODOS = ['dark', 'light'];
const TOKENS = ['--bg-panel', '--bg-primary', '--input-bg', '--input-border', '--text-primary',
  '--color-accent', '--on-accent', '--color-accent-text', '--color-error'];

function bloqueTema(estilo, modo) {
  const re = new RegExp('\\[data-kmode="' + modo + '"\\]\\[data-ktheme="' + estilo + '"\\]\\s*\\{([^}]*)\\}');
  const m = re.exec(html);
  return m ? m[1] : null;
}

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
}

function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function valor(bloque, token) {
  const m = new RegExp(token.replace(/-/g, '\\-') + ':\\s*(#[0-9a-fA-F]{6})').exec(bloque);
  return m ? m[1] : null;
}

test('los cuatro estilos x dos modos definen los nueve tokens', () => {
  ESTILOS.forEach((e) => MODOS.forEach((m) => {
    const b = bloqueTema(e, m);
    assert.ok(b, 'falta el bloque ' + e + '/' + m);
    TOKENS.forEach((t) => assert.ok(valor(b, t), e + '/' + m + ' no define ' + t));
  }));
});

test('contraste WCAG de cada combinación: cuerpo 7:1, acento-texto y texto sobre acento 4,5:1, borde 3:1', () => {
  ESTILOS.forEach((e) => MODOS.forEach((m) => {
    const b = bloqueTema(e, m);
    const v = (t) => valor(b, t);
    const nom = e + '/' + m;
    assert.ok(contraste(v('--text-primary'), v('--bg-panel')) >= 7, nom + ' texto/página');
    assert.ok(contraste(v('--text-primary'), v('--bg-primary')) >= 7, nom + ' texto/superficie');
    assert.ok(contraste(v('--text-primary'), v('--input-bg')) >= 7, nom + ' texto/campo');
    assert.ok(contraste(v('--color-accent-text'), v('--bg-primary')) >= 4.5, nom + ' acento-texto/superficie');
    assert.ok(contraste(v('--color-accent-text'), v('--input-bg')) >= 4.5, nom + ' acento-texto/campo');
    assert.ok(contraste(v('--on-accent'), v('--color-accent')) >= 4.5, nom + ' texto sobre acento');
    assert.ok(contraste(v('--color-error'), v('--bg-primary')) >= 4.5, nom + ' error/superficie');
    assert.ok(contraste(v('--input-border'), v('--input-bg')) >= 3, nom + ' borde/campo');
  }));
});

test('el estilo por defecto es Fresh Prince (retro80s) en oscuro, en el <head> y en el JS', () => {
  assert.match(html, /var m = 'dark', t = 'retro80s';/);
  assert.match(html, /var TEMA_ESTILO_DEFECTO_ = 'retro80s';/);
  assert.match(html, /var TEMA_MODO_DEFECTO_ = 'dark';/);
  // :root (lo que se ve si el JS fallara) = Fresh Prince oscuro, no otro estilo
  const raiz = /:root \{[^}]*\}/.exec(html.slice(html.indexOf('TEMAS: modo')))[0];
  assert.strictEqual(valor(raiz, '--color-accent'), valor(bloqueTema('retro80s', 'dark'), '--color-accent'));
});

test('el estilo retro80s se muestra con el nombre Fresh Prince y no queda "Retro 80s" visible', () => {
  assert.match(html, /data-for="retro80s"[^>]*><span class="dot"><\/span>Fresh Prince<\/button>/);
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/Retro 80s/.test(visible), 'queda un "Retro 80s" visible');
});

test('el texto sobre el color de acento usa --on-accent, no un blanco fijo', () => {
  const reglas = html.match(/[^{}\n]*\{[^{}]*background:var\(--color-accent\)[^{}]*\}/g) || [];
  assert.ok(reglas.length >= 4, 'esperaba varias reglas con fondo de acento');
  reglas.forEach((r) => {
    if (/color:#fff/.test(r.replace(/background:[^;]*;/g, ''))) assert.fail('texto blanco fijo sobre el acento: ' + r.trim());
  });
});
