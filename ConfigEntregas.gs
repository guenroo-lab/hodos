// ConfigEntregas.gs — destinatarios y horarios del informe de cierre de carga.
//
// 2026-08-12: listas DEFINITIVAS por tienda, facilitadas directamente por el usuario —
// sustituyen a la lista temporal común (solo plataforma) usada desde el 04/08 mientras
// se recopilaban. El CC de plataforma también se actualiza a esta fecha. El detalle
// exacto de las listas anteriores (tanto las reales pre-04/08 como la temporal
// post-04/08) queda en el historial de `CLAUDE.md` (entradas v34 en adelante) por si
// hace falta recuperarlo.

var EMAILS_PEDIDO_CLIENTE_TIENDA = {
  'Marbella': [
    'pedcliente.marbella@leroymerlin.es',
    'miguel-angel.gonzalez5@leroymerlin.es',
    'jose-maria.marandino@leroymerlin.es',
    'logistica.marbella@leroymerlin.es',
    'francisco-damian.sedeno@leroymerlin.es',
    'david.jimenez2@leroymerlin.es',
    'francisco.alvarez2@leroymerlin.es'
  ],
  'Málaga': [
    'adolfo.garcia@leroymerlin.es',
    'javier.navarro@leroymerlin.es',
    'pedcliente.malaga@leroymerlin.es',
    'logistica.malaga@leroymerlin.es',
    'ivan.perez2@leroymerlin.es',
    'samuel.guerrero@leroymerlin.es'
  ],
  'Mijas': [
    'salvador.gonzalez2@leroymerlin.es',
    'pedcliente.mijas@leroymerlin.es',
    'logistica.mijas@leroymerlin.es',
    'hector.andres@leroymerlin.es',
    'david.jimenez2@leroymerlin.es'
  ],
  'Granada': [
    'pedro.lopez2@leroymerlin.es',
    'liliana.garcia@leroymerlin.es',
    'macarena.jimenez@leroymerlin.es'
  ]
};

var EMAILS_PEDIDO_CLIENTE_CC = [
  'jose-manuel.lachambre@leroymerlin.es',
  'jose-antonio.alcaide@ext.leroymerlin.es',
  'daniel.simo@ext.leroymerlin.es',
  'pedidocliente.alm-malaga@leroymerlin.es',
  'david.delcampo@ext.leroymerlin.es',
  'sebastian.gelvis@ext.leroymerlin.es',
  'daniel.arrastio@ext.leroymerlin.es',
  'francisco-javier.camara@ext.leroymerlin.es',
  'administracion.alm-malaga@leroymerlin.es'
];

// Fusión Carta de Portes SIE (2026-09-15): destinatarios de la carta diaria de refill
// SIE, portados sin cambios de CartadePortesSIE/CartaPortes.gs (EMAILS_CARTA_TIENDA/CC).
// Solo Marbella/Mijas tienen refill SIE — Málaga/Granada no aparecen aquí.
var EMAILS_CARTA_TIENDA = {
  'Marbella': [
    'francisco-damian.sedeno@leroymerlin.es',
    'miguel-angel.gonzalez5@leroymerlin.es',
    'logistica.marbella@leroymerlin.es'
  ],
  'Mijas': [
    'hector.andres@leroymerlin.es',
    'salvador.gonzalez2@leroymerlin.es',
    'carlos.fuentes@leroymerlin.es',
    'logistica.mijas@leroymerlin.es',
    'carlos.verastegui2@leroymerlin.es',
    'daniel.arrastio@ext.leroymerlin.es',
    'daniel.simo@ext.leroymerlin.es',
    'david.jimenez2@leroymerlin.es',
    'david.martin4@leroymerlin.es',
    'diego-jose.ramos@leroymerlin.es',
    'estefania.barranco@leroymerlin.es',
    'estefania.fortuna@leroymerlin.es',
    'francisco-javier.camara@ext.leroymerlin.es',
    'francisco-javier.valero@leroymerlin.es',
    'gema-pilar.arredondo@leroymerlin.es',
    'hugo-miguel.ponce@leroymerlin.es',
    'ignacio.lorite@leroymerlin.es',
    'maite.perez@leroymerlin.es',
    'marta.diaz@leroymerlin.es',
    'paola-valeria.rodriguez@leroymerlin.es',
    'patricia.vilchez@leroymerlin.es',
    'pedro.guzman@leroymerlin.es',
    'purificacion.estepa@leroymerlin.es',
    'sandra.longhi@leroymerlin.es',
    'sebastian.gelvis@ext.leroymerlin.es'
  ]
};

var EMAILS_CARTA_CC = [
  'administracion.alm-malaga@leroymerlin.es',
  'jose-manuel.lachambre@leroymerlin.es',
  'pedro.gil@ext.leroymerlin.es',
  'david.delcampo@ext.leroymerlin.es',
  'jose-antonio.alcaide@ext.leroymerlin.es'
];

// Unión de listas sin duplicados — usado por cerrarCarga cuando la carga tiene
// tanto pedidos cliente como palets SIE, para que salga UN solo email a la unión
// de ambos públicos en vez de perder destinatarios de cualquiera de los dos.
function unirListasEmail_(listaA, listaB) {
  var vistos = {};
  var resultado = [];
  (listaA || []).concat(listaB || []).forEach(function (email) {
    var clave = String(email || '').toLowerCase();
    if (clave && !vistos[clave]) { vistos[clave] = true; resultado.push(email); }
  });
  return resultado;
}

var HORARIOS_ENTREGA_TIENDA = {
  'Marbella': ['16:00', '17:30', '19:00', '22:00'],
  'Mijas': ['6:30', '8:00', '10:00', '13:00'],
  'Málaga': ['6:00', '7:00', '18:00', '23:55'],
  // Granada solo recibe un camión al día — un único horario "sentinela" en vez de una
  // lista de horas reales, para que el desplegable tenga una opción seleccionable y
  // obtenerOCrearCarga siga distinguiendo cargas por destino+fecha+horario sin cambios.
  'Granada': ['Envío único diario']
};

function obtenerHorariosTienda(destino) {
  return HORARIOS_ENTREGA_TIENDA[destino] || [];
}

// Personas que pueden figurar como cargador de una carga (la lista de Cargas/Descargas, ver Utilidades.gs).
function obtenerCargadores() {
  return {
    principales: CARGADORES_PRINCIPALES_.slice(),
    auxiliares: CARGADORES_AUXILIARES_.slice(),
    max: MAX_CARGADORES_POR_CARGA_
  };
}

// ── Modo prueba ──
// Las 4 tiendas tienen ya destinatarios reales configurados (ver
// EMAILS_PEDIDO_CLIENTE_TIENDA arriba) — sin este interruptor, probar el cierre de
// carga para cualquiera de ellas mandaría un email real. Activo por defecto (más
// seguro): mientras no se llame a
// desactivarModoPrueba(), NINGÚN cierre de carga envía email de verdad, aunque haya
// destinatarios configurados (el PDF se genera igual para adjuntarlo, pero ya no se
// guarda en ningún sitio — desde 2026-08-04 no hay forma de revisarlo aparte del email).
var PROP_MODO_PRUEBA = 'HODOS_MODO_PRUEBA';

function modoPruebaActivo() {
  return PropertiesService.getScriptProperties().getProperty(PROP_MODO_PRUEBA) !== 'NO';
}

function activarModoPrueba() {
  PropertiesService.getScriptProperties().setProperty(PROP_MODO_PRUEBA, 'SI');
  Logger.log('Modo prueba ACTIVADO: cerrarCarga generará el PDF pero NO enviará ningún email.');
}

function desactivarModoPrueba() {
  PropertiesService.getScriptProperties().setProperty(PROP_MODO_PRUEBA, 'NO');
  Logger.log('Modo prueba DESACTIVADO: cerrarCarga enviará emails reales a los destinatarios configurados. Ejecuta esto solo cuando quieras que empiecen a llegar correos de verdad.');
}
