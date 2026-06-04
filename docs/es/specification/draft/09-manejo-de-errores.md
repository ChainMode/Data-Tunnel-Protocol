# Capítulo 9 Manejo de Errores

## 9.1 Modelo de Manejo de Errores

Una implementación de DTP **MUST** seguir un modelo de manejo de errores de tres etapas "detectar-notificar-recuperar":

1. **Detectar**: identificar condiciones anómalas.
2. **Notificar**: enviar información de error al peer o a la capa superior.
3. **Recuperar**: tomar acciones de recuperación según el tipo de error.

Una implementación **MUST NOT** descartar silenciosamente marcos al detectar un error sin notificación.

## 9.2 Sistema de Códigos de Error

DTP **MUST** utilizar el siguiente sistema de códigos de error. Los códigos de error **MUST** ser enteros no negativos, divididos en ocho rangos por módulo funcional:

| Rango | Categoría | Estrategia de Manejo |
|-------|-----------|----------------------|
| 1xxx | Errores de procesamiento de marcos | Descartar marco + notificar al emisor |
| 2xxx | Errores de cifrado | Descartar marco + notificar al emisor + puede disparar re-negociación de claves |
| 3xxx | Errores de Agreement | Descartar Fragment + notificar al emisor + puede disparar re-negociación |
| 4xxx | Errores de DAG | Rechazar Fragment + notificar al emisor, o almacenar en caché y esperar |
| 5xxx | Errores de Session | Intentar la recuperación de la Session + cerrar y notificar a la capa superior en caso de fallo |
| 6xxx | Errores de reanudación | Pausar el envío + notificar a la aplicación de capa superior |
| 7xxx | Errores de versión | Enviar notificación de versión incompatible + intentar la degradación |
| 8xxx | Errores de permiso | Rechazar la operación + notificar al solicitante |

## 9.3 Definiciones de Códigos de Error

Una implementación **MUST** utilizar las siguientes definiciones normativas de códigos de error. **MUST NOT** utilizar códigos de error no listados. Cualquier extensión **MUST** definirse en una versión posterior de esta especificación.

### 9.3.1 Errores de Procesamiento de Marcos (1xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 1001 | `FRAME_DESERIALIZATION_FAILED` | Los datos binarios recibidos no pueden deserializarse en un LogicalFrame |
| 1002 | `FRAME_INVALID_FORMAT` | La estructura del LogicalFrame es inválida o faltan campos requeridos |

### 9.3.2 Errores de Cifrado (2xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 2001 | `DECRYPTION_FAILED` | Falló el descifrado del Payload (clave incorrecta o datos corruptos) |
| 2002 | `KEY_NOT_READY` | El intercambio de claves de CAP aún no se ha completado; se rechaza la transmisión de datos |

### 9.3.3 Errores de Agreement (3xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 3001 | `AGREEMENT_NOT_FOUND` | El Fragment referencia un Agreement_ID desconocido |
| 3002 | `AGREEMENT_EXPIRED` | El Agreement referenciado ha expirado (excedido `validityPeriod`) |
| 3003 | `AGREEMENT_NEGOTIATION_FAILED` | La negociación no puede completarse (timeout, rechazo del peer a re-negociar, etc.) |

### 9.3.4 Errores de DAG (4xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 4001 | `DAG_CYCLE_DETECTED` | Añadir el Fragment formaría un ciclo en el DAG |
| 4002 | `DAG_DEPENDENCY_UNRESOLVED` | Las dependencias del Fragment no se resuelven dentro del timeout de caché |

### 9.3.5 Errores de Session (5xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 5001 | `SESSION_NOT_FOUND` | El Session_ID referenciado no existe |
| 5002 | `SESSION_TIMEOUT` | La Session ha expirado debido a inactividad |
| 5003 | `SESSION_RESTORE_FAILED` | Falló la restauración de la Session tras la reconexión |

### 9.3.6 Errores de Reanudación (6xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 6001 | `BUFFER_FULL` | La caché de Fragments no acusados del emisor ha alcanzado su capacidad |
| 6002 | `RETRANSMISSION_TIMEOUT` | Timeout de retransmisión de Fragment sin acuse de recibo (contador de reintentos agotado) |

### 9.3.7 Errores de Versión (7xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 7001 | `VERSION_INCOMPATIBLE` | La versión del protocolo del marco recibido es superior a la versión soportada por esta implementación |

### 9.3.8 Errores de Permiso (8xxx)

| Código | Nombre | Condición de Disparo |
|--------|--------|----------------------|
| 8001 | `PERMISSION_DENIED` | El rol actual no tiene permitido realizar esta operación |
| 8002 | `OBSERVER_WRITE_DENIED` | Un Observer intentó una operación de escritura (los Observers son de solo lectura) |

## 9.4 Unicidad del Código de Error

Una implementación **MUST** garantizar la unicidad del código de error:

1. Cada código de error **MUST** corresponder a un único tipo de error.
2. Diferentes tipos de error **MUST NOT** compartir el mismo código de error.
3. La implementación **MUST NOT** redefinir códigos de error ya asignados por esta especificación.

## 9.5 Mecanismo de Notificación de Errores

### 9.5.1 ErrorNotificationFrame

Las notificaciones de error **MUST** transmitirse mediante un ControlFrame, definido como sigue:

```typescript
interface ErrorNotificationFrame {
  frameType: "control";
  controlType: "error_notification";
  errorCode: DTPErrorCode;
  errorMessage: string;
  relatedFrameId?: FragmentID;
  relatedAgreementId?: AgreementID;
  details?: Record<string, unknown>;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `frameType` | **MUST** ser `"control"` |
| `controlType` | **MUST** ser `"error_notification"` |
| `errorCode` | **MUST** ser uno de los códigos de error definidos en la Sección 9.3 |
| `errorMessage` | **MUST** ser una descripción de error legible por humanos. **SHOULD** utilizar un idioma comprensible para el peer |
| `relatedFrameId` | **OPTIONAL**. Cuando el error es disparado por un marco específico, **MUST** incluir el fragmentId de ese marco |
| `relatedAgreementId` | **OPTIONAL**. Cuando el error está relacionado con un Agreement específico, **MUST** incluir el Agreement_ID |
| `details` | **OPTIONAL**. **MAY** incluir información adicional para depuración |

### 9.5.2 Transporte de la Notificación de Error

Un ErrorNotificationFrame **MUST** transmitirse sobre el canal regular de LogicalFrame y **MUST** tener su Payload cifrado.

Si el propio error impide el cifrado (por ejemplo, el error `KEY_NOT_READY`), la implementación **MAY** devolver el error a través de un canal fuera de banda definido por la implementación, pero **MUST NOT** enviar el error en texto plano por el canal cifrado.

## 9.6 Flujos Clave de Manejo de Errores

### 9.6.1 Fallo de Deserialización (1001)

Cuando un LogicalFrame recibido no puede deserializarse, el receptor **MUST**:

1. Descartar el marco.
2. Enviar la notificación de error `FRAME_DESERIALIZATION_FAILED`.
3. **MUST NOT** cerrar la Session debido a un fallo de deserialización.

### 9.6.2 Fallo de Descifrado (2001)

Cuando un Payload recibido no puede descifrarse, el receptor **MUST**:

1. Descartar el marco.
2. Enviar la notificación de error `DECRYPTION_FAILED`.
3. Contar el número de fallos consecutivos de descifrado.
4. Si los fallos consecutivos exceden un umbral (**RECOMMENDED** como 3), **SHOULD** disparar a CAP para re-negociar las claves.

### 9.6.3 Detección de Ciclo en DAG (4001)

Cuando se detecta un ciclo en el DAG:

1. El receptor **MUST** rechazar el Fragment.
2. **MUST** devolver el error `DAG_CYCLE_DETECTED`.
3. **MUST NOT** añadir el Fragment al DAG.
4. **MUST NOT** afectar al estado de los Fragments existentes.

### 9.6.4 Agreement Desconocido (3001)

Cuando un Fragment referencia un Agreement_ID desconocido:

1. El receptor **MUST** descartar el Fragment.
2. Devolver el error `AGREEMENT_NOT_FOUND`.
3. **MAY** disparar la re-negociación (definido por la implementación).

### 9.6.5 Clave No Lista (2002)

Cuando se intenta la transmisión de datos antes de que se complete el intercambio de claves de CAP:

1. El DTP_Engine **MUST** rechazar el envío.
2. **MUST** devolver el error `KEY_NOT_READY` al llamador de capa superior.
3. **MUST NOT** responder en texto plano sobre el canal de comunicación.

### 9.6.6 Caché Llena (6001)

Cuando la caché de Fragments no acusados alcanza su límite superior:

1. El emisor **MUST** pausar el envío de nuevos Fragments.
2. Enviar una notificación `BUFFER_FULL` a la aplicación de capa superior.
3. Reanudar el envío después de que el espacio de caché se libere mediante acuses de recibo.
4. **MUST NOT** descartar Fragments ya en caché.

### 9.6.7 Timeout de Retransmisión (6002)

Cuando el contador de retransmisión del Fragment se agota:

1. El emisor **MUST** notificar a la aplicación de capa superior el error `RETRANSMISSION_TIMEOUT`.
2. **SHOULD** disparar la suspensión o terminación de la Session.
3. **MUST NOT** retransmitir indefinidamente.

### 9.6.8 Incompatibilidad de Versión (7001)

Cuando se recibe un marco con una versión de protocolo incompatible (véase el Capítulo 10 para más detalles):

1. El receptor **MUST** no procesar el marco.
2. **MUST** devolver el error `VERSION_INCOMPATIBLE`.
3. **MUST** incluir la versión más alta que soporta en el campo `details` del error.

### 9.6.9 Permiso Denegado (8001, 8002)

Para operaciones de rol ilegales:

1. El DTP_Engine **MUST** rechazar la operación.
2. Las operaciones de escritura del Observer **MUST** devolver `OBSERVER_WRITE_DENIED` (8002).
3. Otros rechazos de permiso **MUST** devolver `PERMISSION_DENIED` (8001).

## 9.7 Estrategia de Recuperación de Errores

Una implementación **MUST** adoptar la estrategia de recuperación correspondiente por tipo de error:

| Categoría de Error | Estrategia de Recuperación |
|--------------------|----------------------------|
| 1xxx Procesamiento de marcos | Descartar marco, registrarlo, continuar recibiendo marcos subsiguientes |
| 2xxx Cifrado | Fallo único: descartar marco; fallos consecutivos: disparar re-negociación de claves |
| 3xxx Agreement | Descartar Fragment; puede disparar re-negociación |
| 4xxx DAG | Ciclo: rechazar; no resuelto: almacenar en caché y esperar |
| 5xxx Session | Intentar la recuperación de la Session; cerrar en caso de fallo |
| 6xxx Reanudación | Pausar el envío, esperar la respuesta del peer o la intervención de la capa superior |
| 7xxx Versión | Enviar notificación de versión; intentar la degradación |
| 8xxx Permiso | Rechazar la operación; **MUST NOT** reintentar automáticamente |

Una implementación **MUST NOT** reintentar automáticamente la misma operación cuando ocurre un error de permiso (8xxx).
