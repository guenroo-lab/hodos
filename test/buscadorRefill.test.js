const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Buscador de refill (2026-10-19), lado servidor: busca palets SIE por SSCC y/o código LM y dice en qué punto está cada
// uno según su carga. SOLO lectura. La pantalla está en indexBuscadorRefill.test.js.
function contexto(stubs) {
  const ctx = Object.assign({}, stubs);
  vm.createContext(ctx);
  ['Utilidades.gs', 'EstructuraCargas.gs', 'EstructuraPaletes.gs', 'Backend.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f }));
  return ctx;
}
const plano = (x) => JSON.parse(JSON.stringify(x));

const palet = (extra) => Object.assign({ id: 1, sscc: '184000227900304411', codigo_lm: '92186704', seccion: 'JARDIN', encontrado: true, batea_id: 'CARGA-000657', fecha_creacion: '2026-10-19T07:46:12.911+00:00' }, extra);
const carga = (extra) => Object.assign({ id_carga: 'CARGA-000657', destino: 'Mijas', fecha_entrega: '2026-10-20', horario: '8:00', estado: 'CERRADA', cargador: 'Ana', reabierta_en: null }, extra);

// Una «base» mínima: palets y cargas por tabla; las lecturas quedan registradas.
function entorno(palets, cargas, solicitantes) {
  const lecturas = [];
  const llamadasKairos = [];
  const ctx = contexto({
    supaGet_: (tabla, filtro, columnas) => {
      lecturas.push([tabla, filtro, columnas]);
      if (tabla === 'palets') return palets;
      if (tabla === 'cargas') {
        const ids = decodeURIComponent((/id_carga=in\.\(([^)]*)\)/.exec(filtro) || [, ''])[1]).split(',');
        return cargas.filter((c) => ids.indexOf(c.id_carga) !== -1);
      }
      throw new Error('tabla no esperada: ' + tabla);
    },
    _solicitantesPorSscc_: (destino, lista) => { llamadasKairos.push([destino, lista]); return (solicitantes && solicitantes(destino, lista)) || {}; }
  });
  return { ctx, lecturas, llamadasKairos };
}

// ── funciones puras ─────────────────────────────────────────────────────────────────────────────────────────────
test('SSCC de la búsqueda: solo dígitos; el prefijo «00» de los 20 dígitos del código de barras se quita', () => {
  const { ctx } = entorno([], []);
  assert.strictEqual(ctx.normalizarSsccBusqueda_('184000227900304411'), '184000227900304411');
  assert.strictEqual(ctx.normalizarSsccBusqueda_('00184000227900304411'), '184000227900304411');
  assert.strictEqual(ctx.normalizarSsccBusqueda_('(00) 1840 0022 7900 3044 11'), '184000227900304411');
  assert.strictEqual(ctx.normalizarSsccBusqueda_('  304411 '), '304411'); // el final, tecleado a mano
  assert.strictEqual(ctx.normalizarSsccBusqueda_('abc'), '');
  assert.strictEqual(ctx.normalizarSsccBusqueda_(null), '');
  assert.strictEqual(ctx.normalizarSsccBusqueda_(undefined), '');
  // solo se quita el «00» de una lectura de 20 dígitos: no se recorta cualquier cosa que empiece por 00
  assert.strictEqual(ctx.normalizarSsccBusqueda_('0012345'), '0012345');
});

test('código LM de la búsqueda: solo letras y números (nada que se cuele en el filtro de la URL)', () => {
  const { ctx } = entorno([], []);
  assert.strictEqual(ctx.normalizarCodigoLmBusqueda_(' 92186704 '), '92186704');
  assert.strictEqual(ctx.normalizarCodigoLmBusqueda_('9218*67%04,x)&order=id'), '92186704xorderid');
  assert.strictEqual(ctx.normalizarCodigoLmBusqueda_(null), '');
});

test('estado del refill según su carga: en carga / enviado / entregado / sin carga', () => {
  const { ctx } = entorno([], []);
  const c = (extra) => Object.assign({ estado: 'CERRADA', fechaEntrega: '2026-10-20', horario: '8:00' }, extra);
  const llegada = ctx.fechaLlegadaCarga_('2026-10-20', '8:00');
  const est = (carga, ahora) => plano(ctx.estadoRefill_(carga, ahora));
  assert.deepStrictEqual(est(null, 0), { codigo: 'SIN_CARGA', texto: 'Sin carga asociada' });
  assert.strictEqual(est(c({ estado: 'ABIERTA' }), llegada + 1).codigo, 'EN_CARGA'); // abierta: no cuenta la hora
  assert.match(est(c({ estado: 'ABIERTA' }), 0).texto, /la carga sigue abierta/);
  assert.match(est(c({ estado: 'ABIERTA', reabiertaEn: '2026-10-19T10:00:00Z' }), 0).texto, /reabierta/);
  assert.strictEqual(est(c(), llegada - 1).codigo, 'ENVIADO');
  assert.strictEqual(est(c(), llegada).codigo, 'ENTREGADO'); // justo a su hora ya cuenta como llegada
  assert.strictEqual(est(c(), llegada + 3600000).codigo, 'ENTREGADO');
  assert.strictEqual(est(c({ estado: 'DESCARTADA' }), 0).codigo, 'SIN_CARGA');
  assert.match(est(c({ estado: 'DESCARTADA' }), 0).texto, /descartada/);
});

test('estado del refill: un horario sin hora («Envío único diario») cuenta hasta el final del día; sin fecha válida, enviado', () => {
  const { ctx } = entorno([], []);
  const c = (extra) => Object.assign({ estado: 'CERRADA', fechaEntrega: '2026-10-20', horario: 'Envío único diario' }, extra);
  const inicioDia = ctx.fechaLlegadaCarga_('2026-10-20', '0:00');
  assert.strictEqual(plano(ctx.estadoRefill_(c(), inicioDia + 12 * 3600000)).codigo, 'ENVIADO');
  assert.strictEqual(plano(ctx.estadoRefill_(c(), inicioDia + 24 * 3600000)).codigo, 'ENTREGADO');
  assert.strictEqual(plano(ctx.estadoRefill_(c({ fechaEntrega: 'sin fecha' }), 9e15)).codigo, 'ENVIADO');
});

// ── buscarRefill ────────────────────────────────────────────────────────────────────────────────────────────────
test('buscarRefill: sin SSCC ni código, o con muy pocos caracteres, avisa y NO lee nada', () => {
  const { ctx, lecturas } = entorno([], []);
  assert.throws(() => ctx.buscarRefill({}), /SSCC o un código LM/);
  assert.throws(() => ctx.buscarRefill(), /SSCC o un código LM/);
  assert.throws(() => ctx.buscarRefill({ sscc: '   ', codigoLm: '' }), /SSCC o un código LM/);
  assert.throws(() => ctx.buscarRefill({ sscc: '123' }), /SSCC necesita al menos 4 dígitos/);
  assert.throws(() => ctx.buscarRefill({ codigoLm: '12' }), /código LM necesita al menos 4/);
  assert.throws(() => ctx.buscarRefill({ sscc: 'abc' }), /SSCC o un código LM/); // sin dígitos = vacío
  assert.strictEqual(lecturas.length, 0);
});

test('buscarRefill: por SSCC lee los palets que lo contienen, los más recientes primero y de uno en uno hasta 51', () => {
  const { ctx, lecturas } = entorno([palet()], [carga()]);
  ctx.buscarRefill({ sscc: '00184000227900304411' });
  assert.deepStrictEqual(lecturas[0], ['palets', 'sscc=ilike.*184000227900304411*&order=fecha_creacion.desc,id.desc&limit=51', 'id,sscc,codigo_lm,seccion,encontrado,batea_id,fecha_creacion']);
});

test('buscarRefill: por código LM, y con los dos a la vez se piden los dos filtros', () => {
  const a = entorno([palet()], [carga()]);
  a.ctx.buscarRefill({ codigoLm: ' 92186704 ' });
  assert.strictEqual(a.lecturas[0][1], 'codigo_lm=ilike.*92186704*&order=fecha_creacion.desc,id.desc&limit=51');
  const b = entorno([palet()], [carga()]);
  b.ctx.buscarRefill({ sscc: '304411', codigoLm: '92186704' });
  assert.strictEqual(b.lecturas[0][1], 'sscc=ilike.*304411*&codigo_lm=ilike.*92186704*&order=fecha_creacion.desc,id.desc&limit=51');
});

test('buscarRefill: lo que se teclea no se puede colar en el filtro de la URL', () => {
  const { ctx, lecturas } = entorno([], []);
  ctx.buscarRefill({ codigoLm: '9218*67&limit=1000' });
  assert.strictEqual(lecturas[0][1], 'codigo_lm=ilike.*921867limit1000*&order=fecha_creacion.desc,id.desc&limit=51');
});

test('buscarRefill: cada resultado trae su carga, su estado y el cotejo con el inventario', () => {
  const ahoraPasado = Date.now();
  const palets = [
    palet({ id: 3, sscc: '184000227900300003', encontrado: true, batea_id: 'CARGA-000657' }),
    palet({ id: 2, sscc: '184000227900300002', encontrado: false, batea_id: 'CARGA-000654' }),
    palet({ id: 1, sscc: '184000227900300001', encontrado: null, batea_id: 'CARGA-000700' })
  ];
  const cargas = [
    carga({ id_carga: 'CARGA-000657', fecha_entrega: '2999-01-01', horario: '8:00' }),
    carga({ id_carga: 'CARGA-000654', destino: 'Marbella', fecha_entrega: '2020-01-01', horario: '13:00', cargador: null }),
    carga({ id_carga: 'CARGA-000700', estado: 'ABIERTA', destino: 'Mijas', reabierta_en: '2026-10-19T09:00:00Z' })
  ];
  const { ctx } = entorno(palets, cargas);
  const r = plano(ctx.buscarRefill({ codigoLm: '92186704' }));
  assert.strictEqual(r.hayMas, false);
  assert.strictEqual(r.resultados.length, 3);
  assert.deepStrictEqual(r.resultados[0], {
    sscc: '184000227900300003', codigoLm: '92186704', seccion: 'JARDIN', cotejo: 'COINCIDE', escaneadoEn: '2026-10-19T07:46:12.911+00:00',
    idCarga: 'CARGA-000657', destino: 'Mijas', fechaEntrega: '2999-01-01', horario: '8:00', estado: 'ENVIADO',
    estadoTexto: 'Enviado (carga cerrada, el camión aún no ha llegado)', cargador: 'Ana', solicitadoPor: null
  });
  assert.deepStrictEqual([r.resultados[1].cotejo, r.resultados[1].estado, r.resultados[1].destino, r.resultados[1].cargador], ['NO_ENCONTRADO', 'ENTREGADO', 'Marbella', '']);
  assert.deepStrictEqual([r.resultados[2].cotejo, r.resultados[2].estado], ['SIN_COTEJAR', 'EN_CARGA']);
  assert.ok(Date.now() >= ahoraPasado);
});

test('buscarRefill: un palet cuya carga ya no existe sale como «Sin carga» con los campos de carga vacíos', () => {
  const { ctx } = entorno([palet({ batea_id: 'CARGA-999999' })], []);
  const r = plano(ctx.buscarRefill({ sscc: '304411' })).resultados[0];
  assert.deepStrictEqual([r.estado, r.destino, r.fechaEntrega, r.horario, r.cargador, r.idCarga, r.solicitadoPor], ['SIN_CARGA', '', '', '', '', 'CARGA-999999', null]);
});

test('buscarRefill: un código LM o una sección que faltan salen como texto vacío (no null/undefined)', () => {
  const { ctx } = entorno([palet({ codigo_lm: null, seccion: null })], [carga()]);
  const r = plano(ctx.buscarRefill({ sscc: '304411' })).resultados[0];
  assert.deepStrictEqual([r.codigoLm, r.seccion], ['', '']);
});

test('buscarRefill: si no hay palets no se leen las cargas ni Kairos y sale una lista vacía', () => {
  const { ctx, lecturas, llamadasKairos } = entorno([], [carga()]);
  assert.deepStrictEqual(plano(ctx.buscarRefill({ sscc: '304411' })), { hayMas: false, resultados: [] });
  assert.strictEqual(lecturas.length, 1);
  assert.strictEqual(llamadasKairos.length, 0);
});

test('buscarRefill: con más de 50 coincidencias enseña 50 y avisa de que hay más', () => {
  const muchos = Array.from({ length: 51 }, (_, i) => palet({ id: 100 - i, sscc: '1840002279003' + String(10000 + i) }));
  const { ctx } = entorno(muchos, [carga()]);
  const r = plano(ctx.buscarRefill({ sscc: '1840002279003' }));
  assert.strictEqual(r.hayMas, true);
  assert.strictEqual(r.resultados.length, 50);
  assert.strictEqual(r.resultados[0].sscc, '184000227900310000'); // se conserva el orden en que llegan (el más reciente primero)
  const justo = entorno(muchos.slice(0, 50), [carga()]);
  assert.strictEqual(plano(justo.ctx.buscarRefill({ sscc: '1840002279003' })).hayMas, false);
});

test('buscarRefill: las cargas se piden una vez por carga distinta, en trozos de 40 y con los ids codificados', () => {
  const palets = Array.from({ length: 50 }, (_, i) => palet({ id: i + 1, sscc: '1840002279003' + String(10000 + i), batea_id: 'CARGA-' + String(100 + i) }));
  palets.push(palet({ id: 99, sscc: '184000227900399999', batea_id: 'CARGA-100' })); // otra de la misma carga: no se repite el id
  palets.pop(); // 50 en total (el límite de lo que se enseña)
  const { ctx, lecturas } = entorno(palets, []);
  ctx.buscarRefill({ sscc: '1840002279003' });
  const deCargas = lecturas.filter((l) => l[0] === 'cargas');
  assert.strictEqual(deCargas.length, 2);
  const ids = (l) => /id_carga=in\.\(([^)]*)\)/.exec(l[1])[1].split(',').length;
  assert.deepStrictEqual(deCargas.map(ids), [40, 10]);
  assert.strictEqual(deCargas[0][2], 'id_carga,destino,fecha_entrega,horario,estado,cargador,reabierta_en');
  const repetidos = entorno([palet({ id: 1 }), palet({ id: 2, sscc: '184000227900304412' })], [carga()]);
  repetidos.ctx.buscarRefill({ sscc: '3044' });
  assert.strictEqual(repetidos.lecturas.filter((l) => l[0] === 'cargas').length, 1);
  assert.match(repetidos.lecturas.find((l) => l[0] === 'cargas')[1], /^id_carga=in\.\(CARGA-000657\)$/);
});

test('buscarRefill: los ids de carga se codifican en la URL (no se cuela nada de lo que haya en la base)', () => {
  const { ctx, lecturas } = entorno([palet({ batea_id: 'CARGA 1,2)&x=y' })], []);
  ctx.buscarRefill({ sscc: '304411' });
  const filtro = lecturas.find((l) => l[0] === 'cargas')[1];
  assert.strictEqual(filtro, 'id_carga=in.(CARGA%201%2C2)%26x%3Dy)');
});

test('buscarRefill: «Solicitado por» de Kairos, pedido por destino con los SSCC de los palets de esa tienda', () => {
  const palets = [
    palet({ id: 1, sscc: '184000227900300001', batea_id: 'CARGA-000657' }),
    palet({ id: 2, sscc: '184000227900300002', batea_id: 'CARGA-000654' }),
    palet({ id: 3, sscc: '184000227900300003', batea_id: 'CARGA-000657' })
  ];
  const cargas = [carga(), carga({ id_carga: 'CARGA-000654', destino: 'Marbella' })];
  const { ctx, llamadasKairos } = entorno(palets, cargas, (destino, lista) => (destino === 'Mijas' ? { '184000227900300003': { ldap: 'jperez', motivo: 'Rotura' } } : {}));
  const r = plano(ctx.buscarRefill({ codigoLm: '92186704' }));
  assert.deepStrictEqual(plano(llamadasKairos), [['Mijas', ['184000227900300001', '184000227900300003']], ['Marbella', ['184000227900300002']]]);
  assert.deepStrictEqual(r.resultados.map((x) => x.solicitadoPor), [null, null, { ldap: 'jperez', motivo: 'Rotura' }]);
});

test('buscarRefill: solo lee (ninguna escritura ni función de carga)', () => {
  const escrituras = [];
  const ctx = contexto({
    supaGet_: (tabla) => (tabla === 'palets' ? [palet()] : [carga()]),
    supaInsertar_: () => escrituras.push('insertar'), supaActualizar_: () => escrituras.push('actualizar'), supaBorrar_: () => escrituras.push('borrar'), supaRpc_: () => escrituras.push('rpc'),
    reabrirCarga: () => escrituras.push('reabrir'), _solicitantesPorSscc_: () => ({})
  });
  ctx.buscarRefill({ sscc: '304411' });
  assert.deepStrictEqual(escrituras, []);
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'EstructuraPaletes.gs'), 'utf8');
  const cuerpo = /function buscarRefill\(filtros\) \{[\s\S]*?\n\}\n/.exec(fuente)[0];
  assert.doesNotMatch(cuerpo, /supaInsertar_|supaActualizar_|supaBorrar_|supaRpc_|reabrirCarga|actualizarCarga|actualizarPalet|borrarPalet|insertarPalet/);
});
