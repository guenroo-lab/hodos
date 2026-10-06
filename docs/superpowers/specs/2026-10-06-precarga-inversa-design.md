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
  `SALIDAS_A` del documento externo, genera la carta de porte en PDF, la envía por
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
4. **Al cargarse, la torre desaparece de HODOS** sin más gestión (sin cargas, sin
   cierre). Se **oculta guardando rastro** (flete, quién y cuándo) en vez de
   borrarse: así un segundo bip avisa "ya cargada" y no se suma dos veces.
5. **Se modifica la app de Plataforma** (el usuario confirmó que es suya o de su
   equipo) para añadir el bipado en el camión de Torija.
6. **El escáner de cámara replica el modelo de Kairos** (cámara en directo en
   pestaña nueva), no el de foto de SIE.
7. Los selects y listas **no llevan nada preseleccionado** (regla del usuario).
   Nada de diálogos nativos del navegador: modales propios.

## Fuera de alcance

- Informe, PDF o email desde HODOS.
- Cargas, cierre de carga o escaneo de camión de inversa dentro de HODOS.
- Cambios en `SALIDAS_A`, en el PDF o en el correo de Plataforma.
- La Inversa de **tiendas** (recepción) de Plataforma: no se toca.
- Torres que mezclen destinos: el destino es siempre Torija.

## Qué verá cada persona

### HODOS — pestaña "Precarga Inversa" (panel de administración)

- **Nueva torre:** una rejilla con los tipos del catálogo, agrupados por tipo de
  soporte (Palet, Jaula completa, Otros...), cada uno con su cantidad (vacía por
  defecto). Botón "Crear e imprimir etiqueta". Sin tipos o sin ninguna cantidad
  mayor que 0 no se puede crear.
- **Torres precargadas:** lista de las torres pendientes (más antigua primero) con
  su desglose y total. Encima, un resumen "Total precargado" por tipo. Acciones por
  torre: reimprimir, editar y borrar (solo mientras esté pendiente).
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
  estado         text not null default 'PRECARGADA',     -- PRECARGADA | CARGADA
  creado_por     text,
  fecha_creacion timestamptz not null default now(),
  flete          text,                                   -- solo si CARGADA
  cargado_por    text,
  fecha_carga    timestamptz,
  constraint torres_inversa_lineas_array check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) > 0),
  constraint torres_inversa_total_positivo check (total_soportes > 0)
);

alter table public.torres_inversa enable row level security;

create index torres_inversa_pendientes_idx
  on public.torres_inversa (fecha_creacion) where estado = 'PRECARGADA';

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

- **`lineas` como `jsonb` y no tabla de líneas:** una torre se crea, se lee y se
  consume siempre entera. Una sola fila hace atómico el consumo y ahorra consultas
  (importante: el proyecto está en plan Free y vigilado por egress).
- **Sin `check` sobre `estado`:** en Kairos un valor de estado nuevo obligó dos veces
  a migrar el `check`. El estado se valida en código y en el filtro condicional del
  consumo.
- **Prefijo `INV-`:** distinto de `HODOS-` a propósito. En "Cargar camión" de HODOS,
  `escanearSoporte` trata de forma especial lo que empieza por `HODOS-`; una etiqueta
  `INV-` bipada por error allí simplemente no se encuentra, sin efectos.
- **Lectura de la lista:** solo `estado=eq.PRECARGADA`, con el índice parcial.
  Las torres `CARGADA` quedan como rastro y no se vuelven a leer en las pantallas.
- **Retención:** las torres cargadas se conservan (son pocas y diminutas). Se
  revisará una purga si algún día hiciera falta.

## HODOS — backend

Archivo nuevo `PrecargaInversa.gs` (lógica pura testeable aparte, servicios de
Google solo en la capa fina), expuesto a `google.script.run`:

| Función | Qué hace |
| --- | --- |
| `obtenerCatalogoInversa()` | Lee `CATALOGO_SOPORTES` del documento `1alOYhM53CHfu8elir0zttHwYFY8o5CLeRHDqaYwjRQY` (el mismo que usa Plataforma), con caché de 6 h en `CacheService`. Excluye las piezas sueltas que Plataforma ya excluye en Torija (`S17_L`, `S17_B`, `S18_L`, `S18_B`, `S19_B`) y los ids basura `S19_L` y `S19_LSVP_LAT_DO`. Devuelve `{id, nombre, tipo}`. |
| `crearTorreInversa(lineas)` | Valida con `normalizarLineasTorre_` (descarta cantidades ≤ 0 o no enteras, ids fuera del catálogo, duplicados se suman), pide el id con la RPC, inserta y devuelve la torre. |
| `listarTorresInversa()` | Torres `PRECARGADA` + resumen por tipo. |
| `actualizarTorreInversa(id, lineas)` | Solo si sigue `PRECARGADA` (PATCH condicionado). |
| `borrarTorreInversa(id)` | Solo si sigue `PRECARGADA` (DELETE condicionado). |
| `htmlEtiquetasTorresInversa(ids)` | HTML de impresión con `envolverEtiquetasHtml_`, ampliada con un parámetro opcional de estilo extra que no cambia la salida de las etiquetas actuales. |
| `contarTorresInversaPendientes()` | Número para la insignia. Función propia, sin tocar `contarEtiquetasPendientesPorPestana`; se llama desde el mismo refresco de insignias que ya existe en `Index.html`. |

### Webhook para Plataforma (acciones nuevas en `doPost`)

Mismo punto de entrada, mismo `INCPC_SHARED_TOKEN` y mismo método de llamada que
usa INCPC (`UrlFetchApp` con `Authorization: Bearer ScriptApp.getOAuthToken()` más
el token en el cuerpo). El enrutado de las acciones nuevas va en una función aparte
(`procesarAccionInversa_`) con una sola línea en `doPost`.

**`consumirTorreInversa { id, flete, operario }`**

PATCH condicionado a `estado=eq.PRECARGADA` que fija `estado=CARGADA`, `flete`
(en mayúsculas, sin espacios, como lo guarda Plataforma), `cargado_por` y
`fecha_carga`. Mismo patrón optimista que `actualizarEtiquetaCondicional_`: si dos
bips casi simultáneos llegan a la vez, solo uno gana.

| Resultado | Respuesta |
| --- | --- |
| Torre consumida | `{ok:true, id, lineas:[...], total}` |
| Ya estaba cargada **en este mismo flete** | `{ok:true, repetida:true, id, lineas, total}` |
| Ya cargada en **otro** flete | `{ok:false, motivo:'YA_CARGADA', flete, fecha}` |
| No existe | `{ok:false, motivo:'NO_EXISTE'}` |

El caso `repetida` es la red de seguridad: si HODOS marcó la torre pero a
Plataforma le falló guardar en Firebase, volver a bipar la recupera sin duplicarla
(Plataforma solo suma si esa torre no está ya en su lista `torres` del camión).

**`devolverTorreInversa { id, flete }`**

PATCH condicionado a `estado=eq.CARGADA&flete=eq.<flete>` que la vuelve a
`PRECARGADA` y limpia `flete`, `cargado_por`, `fecha_carga`.
`{ok:true}` o `{ok:false, motivo:'NO_CARGADA_EN_ESTE_FLETE' | 'NO_EXISTE'}`.

## Plataforma — cambios

Todos **aditivos**: no se quita ni se cambia nada de lo que hace hoy.

- **Nodo de Firebase:** `carga_torija/<FLETE>/torres/<INV-id>` = `{lineas, hora}`,
  escrito solo por el flujo de bipado. El código actual lo ignora y lo conserva (solo
  sobrescribe `.soportes`).
- **Servidor (`Backend_Inversa.js`):** `consumirTorreEnHodos(id, flete, operario)` y
  `devolverTorreEnHodos(id, flete)`, que llaman al webhook de HODOS. URL y token en
  las propiedades del script (`HODOS_WEBAPP_URL`, `HODOS_SHARED_TOKEN`), igual que
  INCPC. Si HODOS no responde, devuelven un error legible y **no cambia nada**; el
  operario sigue pudiendo añadir a mano.
- **Cliente (`Modulo_Plataforma.html`, `JS_Plataforma.html`):** campo "Bipar torre",
  lista "Torres bipadas" y el escáner.
- **Suma y resta:** al consumir, suma `lineas` a `SoportesSeleccionadosTorija` y
  guarda con `guardarMemoriaTorija()`, igual que el flujo manual. Al quitar, resta
  esas cantidades con mínimo 0 y avisa si la cantidad actual era menor que la que se
  iba a restar (el operario pudo rectificar a mano entre medias).
- **Borrar un camión de Torija con torres bipadas:** antes de borrarlo se devuelven
  a HODOS (con aviso si alguna falla), para que no se pierdan.
- **Finalizar:** sin cambios. Las torres quedan `CARGADA` en HODOS.

### Escáner de cámara (modelo de Kairos)

El iframe de Apps Script bloquea la cámara en directo; la solución confirmada en
real (portal de Kairos, v88, Android) es abrir una **pestaña nueva** desde el clic
del botón, escribirle el escáner con `document.write` y comunicarse con
`postMessage` validando `ev.source`. Se copia `abrirEscanerEnPestana_` /
`escanerHtml_` de `Kairos/kairos-portal/Portal.html`, con otro nombre de mensaje y
título "Inversa · Escanear torre". Lee con `BarcodeDetector` nativo y ZXing como
respaldo; `code_128` ya está en la lista de formatos, que es el que lleva la
etiqueta.

- **Versión 1:** igual que Kairos: la pestaña lee un código y se cierra; el
  resultado se aplica en el camión; para la siguiente torre se vuelve a pulsar el
  botón. Probado en real.
- **Modo continuo (a probar en la tablet real, no se promete):** la pestaña se
  quedaría abierta leyendo torre tras torre y avisando de cada una. Riesgo
  conocido: mientras la pestaña del escáner está delante, el navegador puede
  ralentizar la pestaña de Plataforma. Solo se activaría si funciona en el
  dispositivo real.
- **Siempre disponible:** escribir el código o pistola, y si el navegador bloquea la
  pestaña, el campo de texto sigue funcionando.

## Casos límite

- **Dos operarios bipan la misma torre a la vez:** una sola gana (PATCH
  condicionado); la otra ve "ya cargada".
- **Torre bipada en el camión equivocado:** quitarla en ese camión (la devuelve) y
  bipar en el correcto.
- **HODOS caído o sin respuesta:** aviso claro, no se suma nada; lo manual sigue.
- **Etiqueta de una torre borrada o inexistente:** "No existe esa torre".
- **Etiqueta que no es `INV-`:** se rechaza en el cliente sin llamar a HODOS.
- **Torre editada tras imprimir su etiqueta:** el contenido manda lo guardado en
  HODOS, no lo impreso. Al editar se avisa de que hay que reimprimir.
- **Camión finalizado y vuelto a abrir con el mismo flete:** las torres anteriores
  siguen `CARGADA` en su flete; no se vuelven a ofrecer.

## Pruebas

- **HODOS (`node --test`):** `normalizarLineasTorre_`, formato del id, el HTML de la
  etiqueta (desglose, total, código de barras, escapado de nombres) y el webhook
  con Supabase simulado: consumo único, doble consumo simultáneo, repetida en el
  mismo flete, YA_CARGADA, NO_EXISTE, devolver, token inválido. Con mutación sobre
  el condicional del consumo (si se quita `estado=eq.PRECARGADA`, debe fallar un
  test).
- **Plataforma:** no tiene tests automáticos. Se extrae la suma/resta de líneas a
  una función pura que se prueba con Node, y el resto se comprueba a mano en una
  **copia de pruebas** (ver orden de despliegue).
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
   propios (el árbol de trabajo tiene cambios sin commitear de otras sesiones que no
   se deben arrastrar); verificar bajando la versión nueva y comparándola. Las
   acciones nuevas del webhook quedan inertes hasta que Plataforma las llame; la
   pestaña nueva solo la ve quien abra el panel. Vuelta atrás: volver a desplegar
   la versión anterior (`clasp deploy -i <id> -V <anterior>`).
4. **Copia de pruebas de Plataforma.** Proyecto Apps Script nuevo con el mismo
   código, que usa **otra ruta de Firebase (`carga_torija_test`)** y **no escribe en
   `SALIDAS_A` ni envía el email**, para no ensuciar la Torre de Control ni mandar
   correos reales. Prueba extremo a extremo: crear torre → imprimir → bipar con
   pistola y con cámara → desaparece de HODOS → quitar → vuelve → borrar → segundo
   bip "ya cargada". Se prueba también el modo continuo de la cámara en la tablet.
5. **Plataforma real.** Antes, comprobar que hay permiso de edición sobre el
   proyecto y listar sus versiones y despliegues. Base = versión de producción
   actual + solo los cambios propios. **Aviso:** al añadir llamadas a otra app,
   Plataforma pedirá volver a autorizar permisos una vez (cuenta que la
   despliega). Hacerlo en un momento sin camiones abiertos. Vuelta atrás: volver
   a desplegar la versión anterior.
6. **Primer uso real.** Un camión real con una o dos torres de prueba, con el
   operario sabiendo que lo manual sigue disponible. Después se documenta.
7. **Cierre.** Actualizar `CLAUDE.md` de HODOS, la memoria del proyecto y commit.

## Riesgos

1. **Migración en producción** (paso 2): aditiva, sin tocar tablas existentes.
2. **Nueva autorización de permisos en Plataforma** (paso 5): una vez, por la cuenta
   que la despliega.
3. **Firebase sin autenticación:** la configuración de Plataforma solo lleva la URL
   de la base, sin clave, así que las reglas parecen abiertas. No lo cambia este
   trabajo, pero conviene que el equipo lo sepa.
4. **Sobrescritura del nodo completo por Plataforma** (`torijaRef.set(...)` desde la
   copia local): ya existe hoy y puede pisar cambios entre dos dispositivos que
   editen el mismo camión a la vez. El bipado hereda esa característica; no se
   arregla aquí.
5. **Edición concurrente del repo de HODOS:** otra sesión tiene cambios sin commitear
   en `Backend.gs`, `IntegracionIncpc.gs` y `Utilidades.gs`. `doPost` está en
   `IntegracionIncpc.gs`, así que mi línea nueva se commitea solo con
   `git add -p` o cuando esa sesión haya terminado.

## Decisiones que quedan al revisar este documento

1. ¿Conservar siempre las torres cargadas como rastro (propuesto) o purgar pasado un
   tiempo?
2. ¿Copia de pruebas de Plataforma (propuesto) o prueba directa en la real a una hora
   tranquila con un flete "PRUEBA"?
3. ¿Modo continuo de cámara solo si funciona en la tablet real (propuesto) o
   empezamos directamente con uno a uno?
