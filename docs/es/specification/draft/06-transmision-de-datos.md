# Capítulo 6 Transmisión de Datos

## 6.1 Flujo de Datos Bidireccional

Una implementación de DTP **MUST** soportar las siguientes dos direcciones de flujo de datos independientes:

| Dirección | Nombre | Emisor | Receptor |
|-----------|--------|--------|----------|
| Terminal → Fay | Recolección de Datos | Slave | Master |
| Fay → Terminal | Inyección de Datos | Master | Slave |

Ambas direcciones **MUST** satisfacer:

1. Utilizar el mismo formato y flujo de procesamiento de LogicalFrame.
2. Mantener espacios de números de secuencia independientes.
3. Mantener estado de reanudación independiente (caché de Fragments no acusados, número de secuencia más alto acusado, etc.).
4. Ser mutuamente no interferentes: los cambios de estado en una dirección **MUST NOT** afectar a la otra dirección.

## 6.2 Flujo de Recolección de Datos (Terminal → Fay)

La recolección de datos **MUST** seguir este flujo:

### 6.2.1 Flujo del Emisor (DTP_Slave)

1. Recibir los datos enviados por la aplicación del terminal.
2. Construir el Fragment:
   a. Generar un nuevo Fragment_ID (UUID v4).
   b. Establecer `agreementId` al Agreement_ID del Agreement activo actual.
   c. Establecer `originTimestamp` a la marca de tiempo UTC en milisegundos en la que los datos fueron **realmente producidos**. **MUST NOT** utilizar el instante actual.
   d. Adjuntar ContextMetadata estructurados (véase la Sección 4.11).
   e. Adjuntar `dagDependencies` (**MAY** ser un array vacío).
3. Validar las dependencias DAG:
   a. Invocar al DAG Manager para verificar que no se formaría ningún ciclo (véase la Sección 6.7).
   b. Si se detecta un ciclo, **MUST** rechazar el Fragment y devolver el error `DAG_CYCLE_DETECTED` (4001).
4. Construir el LogicalFrame:
   a. Establecer `frameType = "data"`.
   b. Aplicar las reglas de compresión del Agreement_ID (véase la Sección 4.5).
   c. Asignar un `sequenceNumber` monótonamente creciente (dirección de recolección de datos).
   d. Establecer los metadatos de cifrado.
5. Cifrar el Payload: cifrar el campo `data` del Fragment utilizando la clave pre-negociada por CAP.
6. Serializar el LogicalFrame.
7. Invocar al Transport_Adapter para enviar los datos binarios.
8. Añadir el Fragment a la caché de no acuse de recibo (véase la Sección 8.2).

### 6.2.2 Flujo del Receptor (DTP_Master)

1. Recibir los datos binarios entregados por el Transport_Adapter.
2. Deserializar a un LogicalFrame. Si falla, el marco **MUST** ser descartado y **MUST** devolverse el error `FRAME_DESERIALIZATION_FAILED` (1001).
3. Validar la versión del protocolo (véase el Capítulo 10).
4. Parsear el Agreement_ID (aplicar las reglas de compresión de la Sección 4.5). Si está asociado con un Agreement desconocido, el marco **MUST** ser descartado y **MUST** devolverse el error `AGREEMENT_NOT_FOUND` (3001).
5. Descifrar el Payload. Si falla, el marco **MUST** ser descartado y **MUST** devolverse el error `DECRYPTION_FAILED` (2001).
6. Deserializar a un Fragment.
7. Validar las dependencias DAG:
   a. Si todas las dependencias objetivo ya existen, **MUST** aceptar y marcar como `accepted`.
   b. Si algunas dependencias objetivo aún no han llegado, **MUST** marcar como `pending` y almacenar en caché (véase la Sección 6.7).
   c. Si se detecta un ciclo, **MUST** rechazar y devolver el error `DAG_CYCLE_DETECTED` (4001).
8. Actualizar el estado de recepción: establecer el sequenceNumber del Fragment como el número de secuencia más alto recibido para esa dirección (si avanza).
9. Enviar un acuse de recibo (véase el Capítulo 8).
10. Persistir el Fragment en el Personal Data Heap.

## 6.3 Flujo de Inyección de Datos (Fay → Terminal)

La inyección de datos **MUST** seguir este flujo:

### 6.3.1 Flujo del Emisor (DTP_Master)

1. Consultar el Personal Data Heap y filtrar los datos según el `dataRange` del Agreement para producir un conjunto de datos minimizado.
2. Construir el Fragment (igual que los pasos 2-3 de la Sección 6.2.1).
3. Construir el LogicalFrame, cifrar el Payload, serializar y enviar (igual que los pasos 4-8 de la Sección 6.2.1), pero utilizar el espacio de números de secuencia de la dirección de inyección de datos.

### 6.3.2 Flujo del Receptor (DTP_Slave)

1. Deserializar, validar versión, parsear Agreement_ID, descifrar, deserializar Fragment, validar DAG (igual que los pasos 1-7 de la Sección 6.2.2).
2. Actualizar el estado de recepción y enviar un acuse de recibo (igual que los pasos 8-9 de la Sección 6.2.2).
3. Entregar el Fragment a la aplicación del terminal.

## 6.4 Compresión del Agreement_ID en la Transmisión

Una implementación **MUST** seguir estrictamente las reglas de compresión del Agreement_ID definidas en la Sección 4.5.

### 6.4.1 Ejemplo de Compresión

La siguiente es una secuencia de transmisión que cumple con la especificación:

```
Fragment 1: agreementId = "abc-123"   (new Agreement, full ID)
Fragment 2: agreementId = null        (reuse "abc-123")
Fragment 3: agreementId = null        (reuse "abc-123")
Fragment 4: agreementId = "def-456"   (switch to a new Agreement, full ID)
Fragment 5: agreementId = null        (reuse "def-456")
```

### 6.4.2 Restricciones de Compresión

Una implementación **MUST** satisfacer:

1. **MAY** elegir no comprimir (es decir, todos los Fragments llevan el Agreement_ID completo).
2. Si se elige la compresión, **MUST** seguir estrictamente la Sección 4.5.
3. El receptor **MUST** soportar tanto el modo comprimido como el no comprimido.
4. El Agreement_ID del contexto **MUST** restablecerse a null después de que una Session sea suspendida y reanudada (es decir, el primer Fragment después de la reanudación **MUST** llevar el ID completo).

## 6.5 Gestión del Número de Secuencia

### 6.5.1 Crecimiento Monótono

El `sequenceNumber` de cada Fragment **MUST** satisfacer:

1. Ser monótonamente creciente dentro de una única Session.
2. **SHOULD** ser estrictamente contiguo (es decir, incrementarse en 1 cada vez).
3. **MUST NOT** repetirse ni retroceder.

### 6.5.2 Independencia por Dirección

La dirección de recolección de datos y la dirección de inyección de datos **MUST** mantener espacios de números de secuencia independientes:

```
Data collection direction (collection):  seq 1, 2, 3, 4, 5, ...
Data injection direction (injection):    seq 1, 2, 3, 4, 5, ...
```

Una implementación **MUST NOT** compartir el espacio de números de secuencia entre las dos direcciones.

### 6.5.3 Reinicio y Sessions

Los números de secuencia **MUST** satisfacer:

1. El número de secuencia **MUST** restablecerse cuando comienza una nueva Session (**SHOULD** comenzar desde 0 o 1).
2. Cuando una Session se restaura desde `Suspended`, el número de secuencia **MUST** retener su valor anterior a la suspensión y **MUST NOT** restablecerse.
3. Si el número de secuencia se acerca al máximo definido por la implementación, el emisor **MUST** establecer proactivamente una nueva Session para evitar el desbordamiento.

## 6.6 Preservación de la Marca de Tiempo de Origen

Una implementación **MUST** asegurar que el Origin_Timestamp permanezca sin cambios durante la transmisión:

1. El emisor **MUST** registrar el instante en que los datos fueron **realmente producidos** como Origin_Timestamp.
2. La serialización, el cifrado, la transmisión, el descifrado y la deserialización **MUST NOT** modificar el Origin_Timestamp.
3. El receptor **MUST NOT** modificar el Origin_Timestamp recibido.
4. Al persistir, el receptor **MUST** retener el Origin_Timestamp.

Una implementación **SHOULD** mantener un campo independiente de "marca de tiempo de transmisión" fuera del header del marco (definido por la implementación), pero **MUST NOT** confundirlo con Origin_Timestamp.

## 6.7 Manejo de Dependencias DAG

### 6.7.1 Añadir Fragments al DAG

Cuando el receptor recibe un Fragment, **MUST** procesar las dependencias a través del DAG Manager:

1. Extraer las `dagDependencies` del Fragment.
2. Para cada dependencia:
   a. Verificar si el Fragment_ID objetivo ya está en el DAG.
   b. Verificar si añadir esta arista formaría un ciclo.
3. Devolver uno de los siguientes tres resultados según el resultado de la verificación:

| Resultado | Significado | Acción Subsiguiente |
|-----------|-------------|---------------------|
| `accepted` | Todas las dependencias están resueltas; sin ciclos | **MUST** añadir el Fragment al DAG |
| `pending` | Algunas dependencias no están resueltas (los Fragments objetivo no han llegado); sin ciclos | **MUST** almacenar el Fragment en caché y esperar la resolución de dependencias |
| `rejected` | Se detecta un ciclo | **MUST** rechazar el Fragment y devolver el error `DAG_CYCLE_DETECTED` (4001) |

### 6.7.2 Resolución Diferida

Cuando un Fragment está en el estado `pending`:

1. La implementación **MUST** continuar esperando dependencias en la caché para ese Fragment.
2. Cuando lleguen los Fragments objetivo de las dependencias, **MUST** re-evaluar todos los Fragments `pending` relacionados en la caché.
3. **MAY** establecer un tiempo máximo de caché (definido por la implementación). Tras el timeout, **SHOULD** devolver el error `DAG_DEPENDENCY_UNRESOLVED` (4002) y descartar.

### 6.7.3 Algoritmo de Detección de Ciclos

Una implementación **MUST** detectar ciclos antes de añadir un nuevo Fragment. El algoritmo de detección **SHOULD** utilizar DFS (búsqueda en profundidad) o el algoritmo de Tarjan.

Concretamente: desde cada destino de dependencia del nuevo Fragment, realizar DFS. Si el propio nuevo Fragment es alcanzable desde un destino de dependencia, se forma un ciclo.

## 6.8 Transmisión Intercalada Multi-Agreement

Cuando coexisten múltiples Agreements activos, el emisor **MUST**:

1. Asociar cada Fragment con el Agreement correcto a través del Agreement_ID en el header del marco.
2. Al cambiar de Agreement (es decir, cuando el siguiente Fragment pertenece a un Agreement diferente), **MUST** llevar el Agreement_ID completo en ese Fragment (es decir, no se puede usar la compresión a null).
3. **SHOULD** programar el orden de envío según la `priority` de cada Agreement.
