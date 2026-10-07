# Precarga Inversa — Design

## Contexto

Taisa Málaga carga camiones de "inversa" hacia el almacén de Torija con soportes
de vuelta: palet europeo, paletina, jaulas, etc. Hoy esa carga se gestiona en la
app de **Plataforma** (proyecto Apps Script aparte, scriptId
`1EdYXurp0WqrgwqAV-GQZRqt8FeaxvzaNch9ZLsd5VYCQhghHptwrb0NS`, sección
"Expedición a Torija"), que funciona así:

- Se abre un camión escribiendo el **Nº de flete**.
- Se pulsa cada tipo de soporte del catálogo y se **suma una cantidad a mano**.
- El estado vivo del camión está en Firebase Realtime Database
  (`carga_torija/<FLETE>` = `{ flete, soportes: { S01: 17, S16: 5, ... } }`).
- "Finalizar Carga y PDF" (`guardarExpedicionTorija`) escribe una fila en la hoja
  `SALIDAS_A` del documento externo (el **control de soportes**, histórico de
  soportes cargados del equipo), genera la carta de porte en PDF, la envía por
  email a administración y borra el camión de Firebase.

No hay escaneo ni trazabilidad de qué torre va dentro de cada camión: solo un
conteo tecleado.

El usuario quiere más control y trazabilidad: **preparar la carga por adelantado
en HODOS, torre a torre, con etiqueta**, y después, al cargar el camión, **bipar
esas etiquetas en la app de Plataforma** para que se sumen solas. Lo manual se
mantiene.

## Decisiones ya tomadas con el usuario

1. **Torre mixta, una etiqueta.** Una torre puede mezclar tipos de soporte
   ("5 europeo + 5 jaula"); lleva una sola etiqueta con el desglose.
2. **Montón común abierto.** Las torres se registran sin camión asignado. El
   camión se les asigna al bipar.
3. **HODOS no genera ningún informe, PDF ni email.** Eso lo sigue haciendo
   Plataforma al finalizar.
4. **HODOS no guarda ningún rastro de lo cargado.** Al bipar una torre, HODOS la
   elimina sin más. El histórico de soportes cargados ya lo escribe Plataforma en
   su control de soportes (`SALIDAS_A`); duplicarlo en HODOS no aporta nada.
   (Decisión del 2026-10-06; sustituye a una propuesta anterior de ocultar la torre
   guardando flete y hora.)
5. **Se modifica la app de Plataforma** (el usuario confirmó que es suya o de su
   equipo) para añadir el bipado en el camión de Torija.
6. **El escáner de cámara replica el modelo de Kairos** (cámara en directo en
   pestaña nueva), no el de foto de SIE, y trabaja en **modo continuo**: la pestaña
   del escáner se queda abierta leyendo torre tras torre.
7. **Prueba directamente en la app real** de Plataforma (sin copia de pruebas), con
   un flete de prueba y a una hora tranquila.
8. Los selects y listas **no llevan nada preseleccionado** (regla del usuario).
   Nada de diálogos nativos del navegador: modales propios.

## Fuera de alcance

- Informe, PDF o email desde HODOS.
- Cargas, cierre de carga o escaneo de camión de inversa dentro de HODOS.
- Histórico o rastro de torres cargadas en HODOS.
- Cambios en `SALIDAS_A`, en el PDF o en el correo de Plataforma.
- La Inversa de **tiendas** (recepción) de Plataforma: no se toca.
- Torres con otro destino que no sea Torija.

## Qué verá cada persona

### HODOS — pestaña "Precarga Inversa" (panel de administración)

- **Nueva torre:** una rejilla con los tipos del catálogo, agrupados por tipo de
  soporte (Palet, Jaula completa, Otros...), cada uno con su cantidad (vacía por
  defecto). Botón "Crear e imprimir etiqueta". Sin ninguna cantidad mayor que 0 no
  se puede crear.
- **Torres precargadas:** lista de las torres pendientes (más antigua primero) con
  su desglose y total. Encima, un resumen "Total precargado" por tipo. Acciones por
  torre: reimprimir, editar y borrar.
- **Insignia numérica** en la barra lateral con el número de torres pendientes
  (mismo estilo que las pestañas de Arrastres).
- **Etiqueta Zebra 100×150:** logo Taisa, "INVERSA · TORIJA", código `INV-000123`
  grande, desglose por tipo (nombre × cantidad), total de soportes, fecha de
  creación y código de barras CODE128 del id. Mismo marco de impresión que el resto
  de etiquetas (`envolverEtiquetasHtml_`, `@page` 100×150 rotado).

### Plataforma — dentro del camión de Torija

- **"Bipar torre":** campo de texto (admite pistola, que termina con Intro), botón
  "Añadir" y botón **"Escanear con cámara"**.
- Cada torre bipada suma sus cantidades a las del camión (las mismas casillas que
  hoy se tocan a mano) y se guarda en Firebase como el resto de cambios.
- **"Torres bipadas (n)":** lista con id, desglose y un botón para quitar si hubo un
  error. Quitar resta lo que sumó esa torre y la devuelve a HODOS.
- Lo manual (tocar un tipo, sumar o rectificar) sigue exactamente igual.
- Finalizar, PDF, SALIDAS_A y email: sin cambios.

## Datos (Supabase, proyecto `dbxlrnupiwemnarlxmcv`, esquema `public`)

Las cuatro tablas actuales (`etiquetas`, `cargas`, `contenido`, `palets`) tienen
RLS activado y **ninguna política**: solo se accede con la clave `service_role` de
HODOS. La tabla nueva sigue el mismo criterio. Es una migración **solo aditiva**.

```sql
create sequence if not exists public.seq_torres_inversa_id;

create table public.torres_inversa (
  id_unico       text primary key,                       -- INV-000123
  lineas         jsonb not null,                         -- [{"id":"S01","nombre":"EUROPEO","cantidad":17}, ...]
  total_soportes integer not null,                       -- suma de cantidades, calculada en servidor
  creado_por     text,
  fecha_creacion timestamptz not null default now(),
  constraint torres_inversa_lineas_array check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) > 0),
  constraint torres_inversa_total_positivo check (total_soportes > 0)
);

alter table public.torres_inversa enable row level security;

create or replace function public.siguiente_id_torre_inversa() returns text
language plpgsql as $$
declare n bigint;
begin
  n := nextval('seq_torres_inversa_id');
  return 'INV-' || lpad(n::text, 6, '0');
end $$;

revoke execute on function public.siguiente_id_torre_inversa() from public, anon, authenticated;
grant  execute on function public.siguiente_id_torre_inversa() to service_role;
```

Decisiones de datos:

- **Una fila existe solo mientras la torre está pendiente.** No hay `estado`, ni
  `flete`, ni fecha de carga: cargar una torre es borrarla. La tabla se mantiene
  siempre pequeña y no hace falta índice ni purga.
- **`lineas` como `jsonb` y no tabla de líneas:** una torre se crea, se lee y se
  consume siempre entera. Una sola fila hace atómico el consumo y ahorra consultas
  (importante: el proyecto está en plan Free y vigilado por egress).
- **Prefijo `INV-`:** distinto de `HODOS-` a propósito. En "Cargar camión" de HODOS,
  `escanearSoporte` trata de forma especial lo que empieza por `HODOS-`; una etiqueta
  `INV-` bipada por error allí simplemente no se encuentra, sin efectos.

## HODOS — backend

Archivo nuevo `PrecargaInversa.gs` (lógica pura testeable aparte, servicios de
Google solo en la capa fina), expuesto a `google.script.run`:

| Función | Qué hace |
| --- | --- |
| `obtenerCatalogoInversa()` | Lee `CATALOGO_SOPORTES` del documento `1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY` (el mismo que usa Plataforma), con caché de 6 h en `CacheService`. Excluye las piezas sueltas que Plataforma ya excluye en Torija (`S17_L`, `S17_B`, `S18_L`, `S18_B`, `S19_B`) y los ids basura `S19_L` y `S19_LSVP_LAT_DO`. Devuelve `{id, nombre, tipo}`. |
| `crearTorreInversa(lineas)` | Valida con `normalizarLineasTorre_` (descarta cantidades ≤ 0 o no enteras, ids fuera del catálogo; ids repetidos se suman), pide el id con la RPC, inserta y devuelve la torre. |
| `listarTorresInversa()` | Todas las torres de la tabla (todas son pendientes) + resumen por tipo. |
| `actualizarTorreInversa(id, lineas)` | Reemplaza el contenido de una torre existente. |
| `borrarTorreInversa(id)` | Borra una torre. |
| `htmlEtiquetasTorresInversa(ids)` | HTML de impresión con `envolverEtiquetasHtml_`, ampliada con un parámetro opcional de estilo extra que no cambia la salida de las etiquetas actuales. |
| `contarTorresInversaPendientes()` | Número para la insignia. Función propia, sin tocar `contarEtiquetasPendientesPorPestana`; se llama desde el mismo refresco de insignias que ya existe en `Index.html`. |

### Webhook para Plataforma (acciones nuevas en `doPost`)

Mismo punto de entrada, mismo `INCPC_SHARED_TOKEN` y mismo método de llamada que
usa INCPC (`UrlFetchApp` con `Authorization: Bearer ScriptApp.getOAuthToken()` más
el token en el cuerpo). El enrutado de las acciones nuevas va en una función aparte
(`procesarAccionInversa_`) con una sola línea en `doPost`.

**`consumirTorreInversa { id }`**

`DELETE` con `Prefer: return=representation` (`supaBorrar_` ya devuelve las filas
realmente borradas). Si borró una fila, esa llamada ha ganado y devuelve su
contenido; si no borró ninguna, otra llamada se adelantó o la torre no existe. Es
atómico: dos bips casi simultáneos de la misma torre no pueden sumarla dos veces.

| Resultado | Respuesta |
| --- | --- |
| Torre consumida | `{ok:true, id, lineas:[...], total, creadaEn}` |
| No existe (ya cargada, borrada o código inventado) | `{ok:false, motivo:'NO_EXISTE'}` |

**`devolverTorreInversa { id, lineas, creadaEn }`**

Deshace un consumo (el operario de Plataforma quitó la torre del camión, o borró el
camión entero). Plataforma guarda el contenido de cada torre bipada en su lista
`torres`, así que lo manda de vuelta y HODOS **vuelve a crear la torre con el mismo
id** (la etiqueta física sigue siendo válida). El contenido se vuelve a validar con
`normalizarLineasTorre_` contra el catálogo. Si el id ya existe, responde
`{ok:false, motivo:'YA_EXISTE'}` sin tocar nada.

## Plataforma — cambios

Todos **aditivos**: no se quita ni se cambia nada de lo que hace hoy.

- **Interruptor de seguridad:** el bloque "Bipar torre" solo aparece si en las
  propiedades del script están `HODOS_WEBAPP_URL` y `HODOS_SHARED_TOKEN`
  (`bipadoInversaDisponible()` en el servidor). Se despliega con ambas **sin
  configurar** (la app se ve y se comporta exactamente como hoy) y se activa al
  configurarlas. Quitarlas es la vuelta atrás inmediata, sin redesplegar.
- **Nodo de Firebase:** `carga_torija/<FLETE>/torres/<INV-id>` = `{lineas, creadaEn,
  hora}`, escrito solo por el flujo de bipado. El código actual lo ignora y lo
  conserva (solo sobrescribe `.soportes`).
- **Servidor (`Backend_Inversa.js`):** `consumirTorreEnHodos(id)` y
  `devolverTorreEnHodos(id, lineas, creadaEn)`, que llaman al webhook de HODOS. Si
  HODOS no responde, devuelven un error legible y **no cambia nada**; el operario
  sigue pudiendo añadir a mano.
- **Cliente (`Modulo_Plataforma.html`, `JS_Plataforma.html`):** campo "Bipar torre",
  lista "Torres bipadas" y el escáner.
- **Duplicados:** antes de llamar a HODOS, Plataforma mira en su propio estado
  (`CamionesTorijaAbiertos[*].torres`) si esa torre ya está bipada en este camión o
  en otro camión abierto, y avisa ("ya está en este camión" / "ya está en el flete
  X") sin llamar a HODOS. Para una torre cuyo camión ya se finalizó, HODOS responde
  `NO_EXISTE`.
- **Suma y resta:** al consumir, suma `lineas` a `SoportesSeleccionadosTorija` y
  guarda con `guardarMemoriaTorija()`, igual que el flujo manual. Al quitar, resta
  esas cantidades con mínimo 0 y avisa si la cantidad actual era menor que la que se
  iba a restar (el operario pudo rectificar a mano entre medias).
- **Borrar un camión de Torija con torres bipadas:** antes de borrarlo se devuelven
  a HODOS (con aviso si alguna falla), para que no se pierdan.
- **Finalizar:** sin cambios. Las torres ya no existen en HODOS y su contenido queda
  en el conteo que Plataforma escribe en `SALIDAS_A`.

### Escáner de cámara continuo (modelo de Kairos)

El iframe de Apps Script bloquea la cámara en directo; la solución confirmada en
real (portal de Kairos, v88, Android) es abrir una **pestaña nueva** desde el clic
del botón, escribirle el escáner con `document.write` y comunicarse con
`postMessage` validando `ev.source`. Se copia `abrirEscanerEnPestana_` /
`escanerHtml_` de `Kairos/kairos-portal/Portal.html` (lectura con `BarcodeDetector`
nativo y ZXing de respaldo; `code_128` ya está en la lista de formatos), con otro
nombre de mensaje y título "Inversa · Escanear torres", y se amplía a **modo
continuo**:

- La pestaña **no se cierra al leer**. Envía el código a Plataforma y **espera la
  respuesta** (`ack`) antes de leer el siguiente.
- Plataforma procesa cada código con la misma función que el campo de texto y
  contesta `{ok, texto}`. La pestaña lo muestra al instante (✔ "INV-000123 · 5
  europeo + 5 jaula", o ✖ con el motivo) y suena y vibra distinto en acierto y en
  error.
- Un mismo código leído varias veces seguidas con la cámara parada encima se
  ignora durante unos segundos (no se manda dos veces).
- Contador "N torres añadidas", las últimas 5 lecturas y botón **Terminar**.
- Mantiene la pantalla encendida (`wakeLock`) si el navegador lo permite.
- Si en 10 segundos no llega respuesta de Plataforma, muestra "Plataforma no
  responde: vuelve a ella y reintenta" en vez de seguir leyendo a ciegas.
- Si el navegador bloquea la pestaña nueva, queda el campo de texto / pistola.

**Riesgo conocido, a verificar en la tablet real:** mientras la pestaña del
escáner está delante, el navegador puede ralentizar o congelar la pestaña de
Plataforma. La espera de respuesta hace visible el problema en la propia pantalla
del escáner, y el modo continuo se valida en el primer uso real. Si no funciona en
el dispositivo, se recorta a una lectura por pulsación (el modo de Kairos tal cual).

## Casos límite

- **Dos operarios bipan la misma torre a la vez:** una sola gana (borrado atómico);
  la otra recibe `NO_EXISTE`.
- **Torre bipada en el camión equivocado:** quitarla en ese camión (la devuelve) y
  bipar en el correcto.
- **HODOS caído o sin respuesta:** aviso claro, no se suma nada; lo manual sigue.
- **Etiqueta de una torre ya cargada, borrada o inexistente:** "No existe esa torre
  en HODOS (puede estar ya cargada)". Se añade a mano si hace falta.
- **Fallo entre consumir y guardar:** si HODOS ya borró la torre pero a Plataforma le
  falla guardar en Firebase (cierre de la pestaña, red), la torre no vuelve a
  aparecer y el operario la suma a mano. Es la contrapartida directa de no guardar
  rastro; la ventana es de milisegundos y no se ha considerado motivo para guardar
  nada en HODOS.
- **Etiqueta que no es `INV-`:** se rechaza en el cliente sin llamar a HODOS.
- **Torre editada tras imprimir su etiqueta:** manda lo guardado en HODOS, no lo
  impreso. Al editar se avisa de que hay que reimprimir.

## Pruebas

- **HODOS (`node --test`):** `normalizarLineasTorre_`, formato del id, el HTML de la
  etiqueta (desglose, total, código de barras, escapado de nombres) y el webhook
  con Supabase simulado: consumo único, doble consumo simultáneo (el segundo recibe
  `NO_EXISTE`), `NO_EXISTE`, devolver con contenido válido e inválido, `YA_EXISTE`,
  token inválido. Con mutación sobre el borrado condicional: si el consumo dejara de
  usar las filas realmente borradas como criterio, debe fallar un test.
- **Plataforma:** no tiene tests automáticos. La suma/resta de líneas y la detección
  de duplicados se extraen a funciones puras que se prueban con Node. El resto se
  comprueba a mano en la app real (ver orden de despliegue).
- **Migración:** tras aplicarla, comprobar tabla, secuencia, RLS sin políticas y el
  asesor de seguridad de Supabase.

## Orden de despliegue y vuelta atrás

Nada de producción se toca hasta el paso 2. Cada paso tiene su vuelta atrás.

1. **Construir y probar en local (HODOS).** `node --test` en verde. Sin impacto.
2. **Migración en Supabase (producción).** Aditiva: tabla, secuencia y función
   nuevas. Se pide OK explícito al usuario antes de ejecutarla. Vuelta atrás:
   `drop table`, `drop function` y `drop sequence` (nada existente depende de
   ellas).
3. **Desplegar HODOS.** Base = versión de producción actual + solo los archivos
   propios (el árbol de trabajo puede tener cambios sin commitear de otras sesiones
   que no se deben arrastrar); verificar bajando la versión nueva y comparándola.
   Las acciones nuevas del webhook quedan inertes hasta que Plataforma las llame; la
   pestaña nueva solo la ve quien abra el panel. Vuelta atrás: volver a desplegar la
   versión anterior (`clasp deploy -i <id> -V <anterior>`).
4. **Desplegar Plataforma con el interruptor apagado.** Antes, comprobar que hay
   permiso de edición sobre el proyecto y listar sus versiones y despliegues. Base =
   versión de producción actual + solo los cambios propios; verificar bajando la
   versión nueva. Sin `HODOS_WEBAPP_URL` ni `HODOS_SHARED_TOKEN` configuradas, la
   app es idéntica a la de hoy para los operarios. **Aviso:** al añadir llamadas a
   otra app, Plataforma pedirá volver a autorizar permisos una vez (cuenta que la
   despliega); hacerlo en un momento sin camiones abiertos. Vuelta atrás: volver a
   desplegar la versión anterior.
5. **Prueba real, a una hora tranquila.** Configurar las dos propiedades (se
   enciende el bipado). En Plataforma, abrir un camión con flete `PRUEBA-INV`; en
   HODOS, crear una torre pequeña de prueba. Recorrido: imprimir la etiqueta →
   bipar con pistola → bipar con cámara en modo continuo en la tablet → la torre
   desaparece de HODOS y suma en el camión → quitar la torre (vuelve a HODOS) → bipar
   otra vez → segundo bip "ya está en este camión" → borrar el camión de prueba.
   **Nunca pulsar "Finalizar" en el camión de prueba:** escribiría una fila en
   `SALIDAS_A` y mandaría un correo real. Mientras exista, el flete de prueba se ve
   en la Torre de Control y en las pantallas de Torija, por eso se hace sin camiones
   reales en carga. Si algo falla, quitar las propiedades apaga todo al instante.
6. **Primer camión real** con unas pocas torres y lo manual como respaldo.
7. **Cierre.** Actualizar `CLAUDE.md` de HODOS, la memoria del proyecto y commit.

## Riesgos

1. **Migración en producción** (paso 2): aditiva, sin tocar tablas existentes.
2. **Nueva autorización de permisos en Plataforma** (paso 4): una vez, por la cuenta
   que la despliega.
3. **Prueba en la app real** (paso 5): el camión de prueba es visible un rato para
   cualquiera que mire Torija; el interruptor y la regla de no finalizar la acotan.
4. **Torre perdida entre consumir y guardar** (ver casos límite): aceptado al no
   guardar rastro en HODOS; se corrige sumando a mano.
5. **Firebase sin autenticación:** la configuración de Plataforma solo lleva la URL
   de la base, sin clave, así que las reglas parecen abiertas. No lo cambia este
   trabajo, pero conviene que el equipo lo sepa.
6. **Sobrescritura del nodo completo por Plataforma** (`torijaRef.set(...)` desde la
   copia local): ya existe hoy y puede pisar cambios entre dos dispositivos que
   editen el mismo camión a la vez. El bipado hereda esa característica; no se
   arregla aquí.
7. **Edición concurrente del repo de HODOS:** otras sesiones pueden tener cambios sin
   commitear en `Backend.gs`, `IntegracionIncpc.gs` o `Utilidades.gs`. `doPost` está
   en `IntegracionIncpc.gs`, así que mi línea nueva se commitea solo con `git add -p`
   o cuando esa sesión haya terminado.
8. **Cámara en modo continuo:** puede no funcionar en la tablet por la gestión de
   pestañas en segundo plano; se valida en el paso 5 y, si no, se recorta a una
   lectura por pulsación.

## Decisiones cerradas el 2026-10-06

1. Sin rastro en HODOS: cargar una torre es borrarla.
2. Prueba directamente en la app real de Plataforma.
3. Modo continuo de la cámara desde el principio.

## Torres predeterminadas (añadido el 2026-10-07)

Petición del usuario: botones que creen rápido las torres que se repiten siempre — torre de palets Euro (17), torre de paletinas (17) y torre SVP (5 palets euro, 10 laterales y 35 barras) — y que al cargar en Plataforma las cantidades se sumen.

**Cómo se meten.** Plataforma suma al bipar por el **id del tipo** de la pantalla de Torija, y esa pantalla no tiene las piezas sueltas del SVP (`S18_L`, `S18_B`; HODOS tampoco las ofrece). Por eso la torre SVP **no** se define como «5 palets + 10 laterales + 35 barras», sino como **5 × `S18` «SVP (Completo)»**: al escribir `SALIDAS_A`, Plataforma despieza cada SVP completo en 1 palet europeo + 2 laterales + 7 barras (`Backend_Inversa.js`), que da exactamente 5 + 10 + 35. Las otras dos son `S01` EUROPEO × 17 y `S02` PALETINA × 17. Las torres se suman con cualquier otra cosa cargada a mano o bipada, porque son líneas normales por id.

**Qué hace el botón.** Un bloque «Torres predeterminadas» encima del formulario con un botón por torre (nombre y contenido; la SVP enseña el despiece). Pulsarlo **rellena el formulario** con esa torre (sustituye lo que hubiera), marca el botón como activo mientras las cantidades coincidan, y lleva la vista al botón «Crear e imprimir etiqueta» (en el móvil queda muy abajo). No crea nada por sí solo: se puede ajustar una cantidad antes de crear. Tras crear una torre que venía de un botón, la vista vuelve arriba para hacer la siguiente. Funciona también al editar una torre existente (solo cambia el formulario hasta pulsar «Guardar cambios»).

**Dónde vive.** `TORRES_PREDETERMINADAS_INVERSA_` en `PrecargaInversa.gs` (`torresPredeterminadasInversa_(catalogo)` y `obtenerTorresPredeterminadasInversa()`): una plantilla cuyo tipo no esté en el catálogo no se ofrece, y el nombre sale siempre del catálogo. Para cambiar una cantidad o añadir una torre hay que editar esa constante. Si las plantillas no cargan, el formulario sigue funcionando como siempre.

**Pruebas.** `test/precargaInversaPlantillas.test.js` (8, con las filas reales del catálogo, incluido que ninguna plantilla usa piezas sueltas) y 12 escenarios de la pestaña en Chrome con servidor simulado; 18 mutaciones detectadas.

## Crear torres sin sacar la etiqueta (añadido el 2026-10-07)

Petición del usuario: poder ir añadiendo torres seguidas sin que cada una abra la impresión, y sacar las etiquetas después — todas juntas, las que faltan o una selección.

**Formulario.** Dos botones: «Crear torre» (principal; la añade a la lista sin etiqueta) y «Crear e imprimir etiqueta» (como antes). Bajo ellos queda un mensaje fijo con la última torre creada («✓ INV-000015 creada (5 × SVP (Completo)). Queda pendiente de imprimir.»), sin ventanas que interrumpan. Editando una torre solo hay «Guardar cambios» y «Cancelar edición».

**Lista «Torres precargadas».** Casilla por torre, «Seleccionar todas» (con estado intermedio), y dos botones: «Imprimir seleccionadas (n)» e «Imprimir las sin imprimir (m)». Cada torre muestra la insignia «Sin imprimir» o «Etiqueta impresa <fecha>»; el botón de fila es «Imprimir» si nunca se imprimió y «Reimprimir» si sí. El encabezado cuenta «12 pendientes · 5 sin imprimir». La selección se descarta sola para torres que ya no están (cargadas o borradas) y tras imprimir.

**Dato.** Columna nueva `public.torres_inversa.etiqueta_impresa_en timestamptz` (null = sin imprimir), migración `docs/migraciones/2026-10-07-torres-inversa-etiqueta-impresa.sql` (solo añade la columna; las torres existentes quedan como impresas, porque hasta hoy toda torre se creaba imprimiendo). Reglas: crear no la rellena; imprimir (`marcarTorresInversaImpresas`) la rellena con la hora, también al reimprimir; **editar el contenido la vuelve a null** (la etiqueta vieja ya no coincide); una torre que Plataforma devuelve con «Quitar» (`devolverTorreInversa`) vuelve **como impresa** (su etiqueta física existe). Consumir (bipar) borra la fila como siempre: no queda rastro.

**Servidor.** `htmlEtiquetasTorresInversa` y `marcarTorresInversaImpresas` aceptan hasta 200 torres y trabajan en lotes de 30 (UrlFetchApp no admite URLs de más de ~2 KB); las etiquetas salen ordenadas por id. La impresión sigue abriendo la ventana dentro del clic (para que el navegador no la bloquee) y apunta la fecha después; si apuntarla fallara, la etiqueta ya salió y solo se vería «sin imprimir».

**Orden de despliegue.** Primero la migración (la versión anterior de HODOS sigue funcionando con la columna puesta) y después HODOS. Con HODOS nuevo y sin columna, la lista saldría toda «sin imprimir» y marcar fallaría.

**Pruebas.** `test/precargaInversaImpresion.test.js` (9) y 24 escenarios de la pestaña en Chrome con servidor simulado con estado (crear sin etiqueta, crear e imprimir, varias seguidas + imprimir las pendientes, selección, seleccionar todas, imprimir una, reimprimir, editar una impresa, fallos al marcar/generar/crear, selección que se poda, sin torres); 28 mutaciones detectadas.
