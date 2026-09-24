# Migración Google Sheets → Supabase — HODOS

Decisión y diseño de la migración del backend de `hodos` (hoy Google Apps Script + Google
Sheets) a Supabase, siguiendo el mismo patrón ya validado en `lm_producción`
(`docs/superpowers/specs/2026-07-28-migracion-sheets-supabase-design.md`), con una diferencia
clave: **HODOS sigue en modo prueba, sin datos ni usuarios reales** — no hay nada que arriesgar,
así que esta migración es un reemplazo directo, no una migración por fases con dual-write como
la de LM_MALAGA.

---

## Decisiones de alcance (confirmadas por el usuario)

- **Reemplazo directo, sin fases.** Se diseña el esquema, se reescribe el backend, se prueba a
  fondo, y se sustituye Sheets de una vez — sin dual-write, sin ventana de validación en
  producción, sin migración de datos históricos (los datos actuales en Sheets son de prueba,
  no hace falta conservarlos).
- **Proyecto Supabase nuevo y separado** de `lm-malaga` — dominio de datos completamente
  distinto (etiquetas/cargas de camión vs. pedidos/preparación de almacén). Aísla credenciales
  y el radio de impacto de un fallo entre los dos proyectos.
- **Apps Script se mantiene como única capa de aplicación.** `Index.html`, `doGet`,
  `ConfigEntregas.gs` y el modelo de despliegue actual no se tocan — solo cambia el interior de
  la capa de persistencia. Salir de Apps Script por completo se trata como un proyecto aparte,
  fuera de alcance aquí.

---

## 1. Arquitectura — qué cambia y qué no

```
Hoy:       Navegador → Index.html (google.script.run) → Backend.gs
                          → EstructuraSheets/Cargas/Contenido.gs → SpreadsheetApp

Propuesto: Navegador → Index.html (google.script.run) → Backend.gs
                          → EstructuraSheets/Cargas/Contenido.gs → UrlFetchApp → PostgREST (Supabase)
```

`Index.html`, `doGet`, `ConfigEntregas.gs` (emails/horarios) y **toda `Utilidades.gs`** (las
funciones puras: `calcularSoportes`, `seleccionarSoporteAEscanear`, `pedidosPendientesEnCarga`,
`validarCesionEntreTiendas`, `prepararLineasContenido`, `tokensPedido_`, `validarTienda`,
`validarVista`, `fechaComoTexto`, `formatearIdUnico`, `formatearIdCarga`,
`formatearOrigenTexto`, `subtipoEfectivo`) no se tocan — ya operan sobre arrays planos, no
sobre `SpreadsheetApp`, así que el test suite de `node --test` (`barcode.test.js`,
`utilidades.test.js`) sigue pasando sin cambios.

Lo que sí cambia:
- Las tres `EstructuraX.gs` se convierten en helpers genéricos contra PostgREST (leer,
  insertar, actualizar, actualizar-condicional), mismo espíritu que los helpers de
  `lm_producción`.
- Las funciones de `Backend.gs` que hoy hacen `getRange`/`setValues` directamente en vez de
  pasar por un helper (`registrarLote`, `escanearSoporte`, `cerrarCarga`) se reescriben para
  usar los helpers nuevos.
- `Pruebas.gs` se reescribe para apuntar a Supabase en vez de a Sheets, con las mismas
  aserciones.

---

## 2. Esquema de tablas (mapeo 1:1 desde las 3 hojas actuales)

```sql
create table cargas (
  id_carga       text primary key,               -- 'CARGA-000042'
  destino        text not null,
  fecha_entrega  text not null,                   -- texto tal cual (mismo motivo que hoy: obtenerOCrearCarga
                                                   -- compara por igualdad exacta del string del <select>, no por
                                                   -- valor temporal parseado)
  horario        text not null,
  estado         text not null default 'ABIERTA', -- ABIERTA | CERRADA
  creada_por     text,
  fecha_creacion timestamptz not null default now(),
  cerrada_por    text,
  fecha_cierre   timestamptz,
  pdf_url        text,
  email_enviado  text
);
create index idx_cargas_estado on cargas (estado);                                         -- listarCargasAbiertas
create index idx_cargas_destino_fecha_horario on cargas (destino, fecha_entrega, horario);  -- obtenerOCrearCarga

create table etiquetas (
  id_unico       text primary key,                -- 'HODOS-000076'
  numero_pedido  text not null,                    -- puede llevar "+" (agrupación); siempre texto (ceros a la
                                                    -- izquierda), sin UNIQUE (repetir en el mismo lote = varios
                                                    -- soportes, no reenvío)
  soporte_num    integer not null,
  soporte_total  integer not null,
  origen         text not null,                    -- 'Taisa' | 'Cesión' | otros
  subtipo        text,
  origen_texto   text not null,
  destino        text not null,
  fecha_creacion timestamptz not null default now(),
  lote_id        text not null,                     -- Utilities.getUuid(), igual que hoy
  creado_por     text,
  estado         text not null default 'REGISTRADO', -- REGISTRADO | EN_RUTA
  batea_id       text references cargas (id_carga),
  fecha_envio    timestamptz,
  origen_tienda  text                                 -- solo relevante si origen = 'Cesión'
);
create index idx_etiquetas_lote on etiquetas (lote_id);
create index idx_etiquetas_pedido on etiquetas (numero_pedido);   -- buscarEtiquetas + FIFO + pedidosPendientesEnCarga
create index idx_etiquetas_batea on etiquetas (batea_id);          -- obtenerCarga + pedidosPendientesEnCarga

create table contenido (
  id_unico       text not null references etiquetas (id_unico) on delete cascade,
  descripcion    text not null,
  cantidad       numeric not null,
  creado_por     text,
  fecha_creacion timestamptz not null default now()
);
create index idx_contenido_id_unico on contenido (id_unico);
```

Con `on delete cascade` en `contenido`, `guardarContenidoSoporte` sigue con el mismo patrón
(borra el contenido previo de ese `id_unico` e inserta el nuevo — reemplaza, no acumula), solo
que el borrado pasa a ser un `DELETE` explícito por `id_unico=eq.X` en vez de recorrer filas a
mano en Sheets.

---

## 3. Generación de IDs — sustituir `LockService` por secuencias nativas

Hoy `reservarBloqueIds_` (bloque de N `HODOS-000076`) y el contador de `crearCarga`
(`CARGA-000042`) usan `LockService` + un contador en `PropertiesService`. Postgres tiene una
primitiva nativa para esto — las secuencias son atómicas por diseño, sin necesitar ningún lock
de aplicación:

```sql
create sequence seq_etiquetas_id start 1;
create sequence seq_cargas_id start 1;

create or replace function siguiente_bloque_ids_etiquetas(p_cantidad integer)
returns text[] language plpgsql as $$
declare resultado text[] := '{}'; i integer; n bigint;
begin
  for i in 1..p_cantidad loop
    n := nextval('seq_etiquetas_id');
    resultado := array_append(resultado, 'HODOS-' || lpad(n::text, 6, '0'));
  end loop;
  return resultado;
end $$;

create or replace function siguiente_id_carga()
returns text language plpgsql as $$
declare n bigint;
begin
  n := nextval('seq_cargas_id');
  return 'CARGA-' || lpad(n::text, 6, '0');
end $$;
```

Se llaman vía `POST /rest/v1/rpc/siguiente_bloque_ids_etiquetas` (body `{p_cantidad: 3}`) y
`POST /rest/v1/rpc/siguiente_id_carga`. `reservarBloqueIds_` y el `LockService` del contador de
`crearCarga` desaparecen sin más — no hace falta ningún reemplazo equivalente, la secuencia ya
es segura bajo concurrencia.

Como es reemplazo directo (sin migrar histórico), las secuencias arrancan en 1; los
`HODOS-`/`CARGA-` que haya hoy en el Sheet de pruebas quedan atrás sin más — no hay
solapamiento posible porque las tablas nuevas empiezan vacías.

---

## 4. Concurrencia real: `escanearSoporte`

Único punto de la migración con una decisión de diseño genuina — a diferencia de LM_MALAGA
(donde casi todas las carreras desaparecían al normalizar JSON-blobs a tablas), aquí la carrera
es real y sigue siéndolo en Postgres: **dos operarios en el suelo de almacén pueden escanear
casi a la vez** el mismo pedido+destino, y `seleccionarSoporteAEscanear` (FIFO) podría elegir la
misma fila "más antigua pendiente" para ambos si no se serializa la escritura.

**Decisión: concurrencia optimista con reintento.** Se mantiene `seleccionarSoporteAEscanear`
tal cual en `Utilidades.gs` (sin tocar, mismos tests). El flujo pasa a ser:

1. `GET` de las filas candidatas (mismo filtro que hoy: por `numero_pedido` o `id_unico`,
   `destino`).
2. La función pura decide el ganador (igual que hoy, sin cambios).
3. `PATCH` **condicionado**: `?id_unico=eq.<ganador>&estado=eq.REGISTRADO`, con
   `Prefer: return=representation`.
4. Si la respuesta viene vacía (0 filas actualizadas), alguien más ganó esa fila entre la
   lectura y la escritura → se reintenta el ciclo completo desde el paso 1 (bucle simple, 3-5
   intentos de margen — de sobra para escaneos a velocidad humana con pistola de código de
   barras).

Se descartó mover la decisión a una función RPC en PL/pgSQL (`SELECT ... FOR UPDATE` atómico en
una sola llamada) porque duplicaría en SQL las mismas reglas de negocio que hoy viven en
`seleccionarSoporteAEscanear` (detección de prefijo `HODOS-`, FIFO, `YA_ESCANEADO`,
`DESTINO_INCORRECTO`) — reglas que ya han cambiado varias veces en la vida de este proyecto
(cambio de barcode a `idUnico`, luego agrupación con "+"...). Mantener `Utilidades.gs` como
única fuente de verdad, cubierta por el test suite existente, pesa más que ahorrarse un bucle de
reintento de ~15 líneas.

`pedidosPendientesEnCarga` (usada en `cerrarCarga`) no necesita ninguna decisión nueva: sigue
siendo la misma agregación pura en JS, solo que ahora se alimenta de un `GET` filtrado (por
`batea_id`/`estado`) en vez de leer la hoja entera.

---

## 5. Estrategia de pruebas

- **`Utilidades.gs` no cambia** → el test suite de `node --test` sigue pasando tal cual, cero
  trabajo nuevo.
- **Funciones dependientes de Supabase** (no se puede correr GAS en local): mismo patrón que ya
  usa el proyecto — `Pruebas.gs` (`verificarSistema()`) se ejecuta desde el editor de Apps
  Script contra el proyecto Supabase real, con la misma disciplina de autolimpieza
  (identificadores únicos por ejecución) que ya se aplicó tras el bug de v24. Se añade un
  `testConexionSupabase()` de solo lectura (calco del que ya existe en `lm_producción`) para
  verificar conectividad en cualquier momento.
- **No hace falta un proyecto de staging separado** (a diferencia de LM_MALAGA): como no hay
  datos ni usuarios reales que proteger, el propio proyecto Supabase de HODOS sirve para probar
  y para el uso real después.

---

## 6. Plan de corte (reemplazo directo)

1. Crear el proyecto Supabase nuevo (`hodos`), aplicar el DDL de tablas + funciones RPC de
   secuencias (§2-3).
2. Guardar `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` en `PropertiesService` — clave `service_role`
   **legacy** (pestaña "Legacy anon, service_role API keys"), **no** la nueva `sb_secret_...`
   (lección ya aprendida en LM_MALAGA: esa se bloquea con HTTP 401 desde `UrlFetchApp` por una
   heurística anti-fuga de Supabase).
3. Reescribir `EstructuraSheets.gs`/`EstructuraCargas.gs`/`EstructuraContenido.gs` como helpers
   genéricos contra PostgREST.
4. Reescribir en `Backend.gs` las funciones que hoy hacen `getRange`/`setValues` a mano
   (`registrarLote`, `escanearSoporte` con su bucle de reintento, `cerrarCarga`) para usar los
   helpers nuevos.
5. Reescribir `Pruebas.gs` para correr contra Supabase; iterar hasta que `verificarSistema()`
   esté en verde igual que hoy (v24).
6. `clasp push` + nueva versión desplegada.
7. Verificación manual end-to-end en navegador real (imprimir etiqueta, escanear, cesión,
   contenido) — el checklist que ya estaba pendiente (Task 9), ahora contra Supabase.
8. Las pestañas de Sheets (`ETIQUETAS`/`CARGAS`/`CONTENIDO`) se dejan tal cual, sin borrar ni
   migrar — son datos de prueba. El proyecto puede seguir siendo tipo `sheets` vinculado (no
   hace falta convertirlo a standalone); es un detalle operativo sin riesgo, no parte necesaria
   de esta migración.

---

## 7. Lo que se necesita del usuario para arrancar

- **Pendiente — crear el proyecto Supabase.** No se puede crear la cuenta/proyecto desde aquí
  (requiere alta en el dashboard de Supabase). Nombre sugerido: `hodos`.
- **Pendiente — credenciales.** Copiar la clave **legacy `service_role`** (no la
  `sb_secret_...`) y la URL del proyecto, y guardarlas directamente en Propiedades del script
  del proyecto HODOS (`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`) desde el editor de Apps Script —
  igual que en LM_MALAGA. La clave no debe pasar por el chat.
- Confirmar cuando esté hecho para seguir con el DDL y el código.

---

## Riesgos que no desaparecen con esta migración

- **La `service_role key` concentra el riesgo** (igual que en LM_MALAGA): quien tenga acceso de
  Editor al proyecto Apps Script puede leer `PropertiesService.getScriptProperties()` y obtener
  una clave con acceso de superusuario a toda la base de datos. Mismo cuidado que ya se aplica
  hoy al acceso de Editor del proyecto.
- **Se pierde el "deshacer" informal de Sheets** (Ctrl+Z, historial de versiones) — irrelevante
  hoy porque no hay datos reales, pero relevante en cuanto HODOS entre en producción real.
- **El bucle de reintento de `escanearSoporte` es código nuevo**, sin precedente exacto en este
  proyecto ni en LM_MALAGA — hay que probarlo explícitamente bajo escaneo casi-simultáneo antes
  de dar por bueno el corte (dos llamadas a `escanearSoporte` con el mismo pedido/destino en
  rápida sucesión, verificando que cada una se lleva un soporte distinto).
- **Lecturas sin límite (`leerEtiquetas_(null)` en `buscarEtiquetas`/`obtenerHistorialLotes`/
  `cerrarCarga`) dependen de que Supabase no trunque la respuesta.** PostgREST/Supabase aplica por
  defecto un límite de filas ("Max Rows", habitualmente 1000) por proyecto. Mientras el volumen de
  HODOS sea bajo (modo prueba) esto no afecta a nada, pero si se supera ese límite en producción
  real, las tres fallarían en silencio (sin lanzar error) devolviendo solo un subconjunto de filas.
  El caso de `cerrarCarga` es el más delicado: si `pedidosPendientesEnCarga` no ve una fila
  truncada, podría cerrar (y enviar el email de manifiesto) una carga en realidad incompleta, sin
  ningún error visible. Antes de producción real, confirmar/subir el límite en Database → API, o
  añadir `limit=`/paginación real.
- **`escanearSoporte` no vuelve a comprobar el estado de la carga en el momento del PATCH** — solo
  lo valida una vez, antes del bucle de reintento. `cerrarCarga` genera el PDF y envía el email
  ANTES de marcar la carga como `CERRADA` (única forma de que el informe salga con contenido), así
  que hay una ventana real (aunque estrecha, acotada a una única llamada HTTP) en la que un
  `escanearSoporte` en curso podría añadir un soporte nuevo a una carga que se está cerrando en ese
  mismo instante. **Esto no es una regresión de esta migración**: la versión Sheets tampoco
  protegía contra esta ventana. Nota: aunque el enlace cruzado de Carta de Portes SIE permite que
  dos sesiones distintas "sigan" la misma carga (`obtenerOCrearCarga`, comentario en `Backend.gs`),
  la ventana de esta carrera concreta sigue acotada a una sola llamada HTTP de `cerrarCarga`, no a
  todo el TTL del caché descrito abajo — ver por qué en la nota siguiente.
- **Optimización de rendimiento (2026-07-30, corregida el mismo día tras revisión adversarial):
  `escanearSoporte` cachea `{destino, estado}` de la carga en `CacheService` en vez de leerlo de
  Supabase en cada escaneo** — motivo: cada escaneo hacía 3 llamadas HTTP secuenciales (comprobar
  carga abierta + leer candidatas + escritura condicionada), y la primera de las tres casi nunca
  cambia entre un escaneo y el siguiente — el usuario reportó la carga de soportes como el punto
  más lento de la migración, precisamente por este camino.
  **Diseño (tras corregir un fallo real encontrado en revisión):** la primera versión dejaba que
  `escanearSoporte` repoblara el caché en cada cache-miss, lo que abría una condición de carrera de
  "resurrección": una lectura en vuelo (`leerCargas_`) podía escribir `ABIERTA` en el caché justo
  *después* de que `cerrarCarga` borrara esa misma entrada, dejando el caché con un valor `ABIERTA`
  y un TTL nuevo aunque la carga ya estuviera `CERRADA` en Supabase — permitiendo escanear soportes
  que quedarían fuera del PDF/email ya enviado, sin autocorregirse hasta que expirara ese nuevo TTL.
  **Corregido con un único escritor:** `cachearCargaAbierta_` (en `Backend.gs`) solo se llama desde
  `crearCarga`, una vez, al crear la carga — nunca desde `escanearSoporte`, que ahora es de solo
  lectura (`obtenerCargaCacheada_`) y en un cache-miss simplemente relee Supabase sin volver a
  escribir. Al no haber un segundo escritor, no hay nada que pueda competir con el borrado de
  `cerrarCarga` ni "resucitar" una entrada tras el cierre — la garantía de frescura es el borrado
  explícito de `cerrarCarga` (envuelto en `try/catch` para no romper el cierre si el borrado
  fallara), no un TTL corto. El TTL se puso al máximo de `CacheService` (6h) precisamente porque ya
  no es la barrera de seguridad principal, solo una red por si ese borrado nunca llegara a
  ejecutarse — degradación aceptable (vuelve al rendimiento previo a esta optimización), nunca una
  escritura incorrecta.
- **El motivo `REINTENTOS_AGOTADOS` (nuevo en esta migración) no tiene mensaje propio en
  `Index.html`** — cae en el mismo `else` genérico que `NO_ENCONTRADO` ("Pedido no encontrado").
  Con `ESCANEO_MAX_REINTENTOS=5` debería ser rarísimo en la práctica, y la acción correctora es la
  misma (volver a escanear), pero el mensaje es técnicamente engañoso. No se corrige aquí porque
  `Index.html` está fuera del alcance de esta migración (ver decisión de alcance al inicio del
  documento) — pendiente como mejora de UI aparte.
- **La clave `service_role` de HODOS quedó pegada en el chat durante la configuración inicial**
  (2026-07-29). Decisión explícita del usuario: no rotarla ahora (proyecto vacío, sin datos,
  chat privado — riesgo bajo en la práctica), tratarlo como riesgo aceptado y **rotarla antes de
  pasar a producción real** (`Settings → JWT Keys → Legacy JWT Secret`: crear clave standby,
  esperar propagación, revocar la actual — invalida `anon` y `service_role` legacy a la vez, hay
  que regenerar ambas claves después).
