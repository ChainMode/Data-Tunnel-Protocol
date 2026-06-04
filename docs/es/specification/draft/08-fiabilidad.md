# Capítulo 8 Fiabilidad

## 8.1 Modelo de Fiabilidad

Una implementación de DTP **MUST** proporcionar las siguientes garantías de fiabilidad:

1. **Reanudación**: Después de que la conexión subyacente se interrumpa, la transmisión se reanuda; los datos ya recibidos con éxito **MUST NOT** retransmitirse.
2. **Acuse de recibo**: El receptor **MUST** acusar al emisor los Fragments que han sido recibidos con éxito.
3. **Retransmisión**: El emisor **MUST** retransmitir los Fragments no acusados cuando un acuse de recibo no se recibe dentro del timeout.
4. **Persistencia de Session**: Cuando la conexión subyacente se interrumpe, el estado de la Session **MUST** persistirse.

## 8.2 Mecanismo de Reanudación

### 8.2.1 Protocolo de Reanudación

La reanudación **MUST** implementarse basada en números de secuencia, siguiendo este flujo:

```
Sender                                Receiver
   |                                     |
   |-- Fragment (seq=1) ---------------->|  ✓ received
   |-- Fragment (seq=2) ---------------->|  ✓ received
   |-- Fragment (seq=3) ---------------->|  ✓ received
   |-- Fragment (seq=4) -------- ✗ -----|  connection lost
   |                                     |
   |        [connection restored]        |
   |                                     |
   |<-- ResumeReport (highest=3) --------|
   |                                     |
   |-- Fragment (seq=4) ---------------->|  resume from breakpoint
   |-- Fragment (seq=5) ---------------->|
```

### 8.2.2 ResumeReport

Tras la restauración de la conexión, el receptor **MUST** enviar un ResumeReport definido como sigue:

```typescript
interface ResumeReport {
  collectionHighest: SequenceNumber;
  injectionHighest: SequenceNumber;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `collectionHighest` | **MUST** ser el número de secuencia más alto recibido con éxito por el receptor en la dirección de recolección de datos |
| `injectionHighest` | **MUST** ser el número de secuencia más alto recibido con éxito por el receptor en la dirección de inyección de datos |

Si una dirección aún no ha recibido ningún Fragment, el campo correspondiente **MUST** ser -1 o un valor centinela "no recibido" definido por la implementación.

### 8.2.3 Consistencia de la Reanudación

Tras recibir un ResumeReport, el emisor **MUST** seguir estrictamente:

1. **Continuar desde el siguiente número de secuencia**: reanudar el envío comenzando en `highest + 1`.
2. **Sin envío duplicado**: **MUST NOT** reenviar ningún Fragment con número de secuencia `<= highest`.
3. **Sin omisión**: **MUST NOT** omitir Fragments no acusados (es decir, aquellos no confirmados en caché).

## 8.3 Mecanismo de Acuse de Recibo

### 8.3.1 Métodos de Acuse de Recibo

Una implementación **MUST** proporcionar acuse de recibo de Fragment. El acuse de recibo **MAY** implementarse a través de uno de los siguientes métodos:

1. **Marco de control ACK explícito**: El receptor envía un ControlFrame con `controlType = "ack"`, donde `details` contiene el número de secuencia más alto acusado.
2. **ACK acumulativo**: Llevar el número de secuencia más alto recibido de la dirección inversa en un campo de extensión de cada marco de datos (**RECOMMENDED**).
3. **ACK por lotes**: Enviar un ACK cada N Fragments recibidos (N es definido por la implementación; **RECOMMENDED** como 16).

El método específico de acuse de recibo **MAY** ser elegido por la implementación, pero el receptor y el emisor **MUST** acordar el método elegido.

### 8.3.2 Tiempo del Acuse de Recibo

El receptor **MUST** satisfacer:

1. Solo acusar después de que el Fragment haya pasado el descifrado, la validación del Agreement y la validación del DAG.
2. **MUST NOT** acusar mientras el estado del DAG sea `pending` (el acuse de recibo debe diferirse hasta que se resuelvan las dependencias).
3. El número de secuencia más alto en el ACK **MUST** ser el máximo del prefijo contiguo del conjunto de números de secuencia acusados.

## 8.4 Mecanismo de Retransmisión

### 8.4.1 Estrategia de Retransmisión

El emisor **MUST** retransmitir bajo las siguientes condiciones:

1. El ACK para un determinado número de secuencia no se recibe dentro del timeout de retransmisión configurado por el protocolo.
2. Tras recibir un ResumeReport, retransmitir los Fragments no acusados.

### 8.4.2 Configuración de Retransmisión

Una implementación **SHOULD** proporcionar los siguientes parámetros configurables:

| Parámetro | Por Defecto (**RECOMMENDED**) | Descripción |
|-----------|-------------------------------|-------------|
| Timeout inicial de retransmisión | 5 segundos | Tiempo de espera para la primera retransmisión |
| Factor de backoff de retransmisión | 2 | El timeout se duplica tras cada retransmisión (backoff exponencial) |
| Contador máximo de retransmisión | 5 | Notificar a la capa superior de fallo más allá de este contador |
| Timeout máximo de retransmisión | 60 segundos | Límite superior del timeout de retransmisión |

Una implementación **MUST** implementar un algoritmo de backoff exponencial.

### 8.4.3 Manejo de Fallo de Retransmisión

Cuando el contador de retransmisión excede el límite superior:

1. El emisor **MUST** notificar a la aplicación de capa superior el error `RETRANSMISSION_TIMEOUT` (6002).
2. El emisor **SHOULD** disparar la suspensión o terminación de la Session (definido por la implementación).
3. La implementación **MUST NOT** retransmitir indefinidamente.

## 8.5 Gestión de Caché

### 8.5.1 Caché de Fragments No Acusados

El emisor **MUST** mantener una caché de Fragments no acusados que satisfaga:

1. Cada Fragment que ha sido enviado pero aún no acusado **MUST** ser retenido en la caché.
2. Tras recibir un acuse de recibo, el Fragment acusado **MUST** ser eliminado de la caché.
3. La caché **MUST** tener un límite superior de capacidad (definido por la implementación; **RECOMMENDED** como no menos de 1024 Fragments o 16 MB).

### 8.5.2 Manejo de Caché Llena

Cuando la caché alcanza su límite superior de capacidad, el emisor **MUST**:

1. Pausar el envío de nuevos Fragments.
2. Notificar a la aplicación de capa superior mediante el error `BUFFER_FULL` (6001).
3. Reanudar el envío después de que se libere espacio de caché mediante acuses de recibo.
4. **MUST NOT** descartar silenciosamente Fragments.

## 8.6 Gestión de Sesiones

### 8.6.1 Establecimiento de Session

Tras la finalización de la autenticación de identidad y el intercambio de claves de CAP, el DTP_Engine **MUST** establecer una Session DTP:

1. **MUST** generar un Session_ID único (UUID v4) conforme a RFC 4122.
2. **MUST** inicializar la estructura de datos de la Session (véase la Sección 8.6.3).
3. **MUST** transicionar el estado de `WaitingForCAP` a `SessionEstablished`.

### 8.6.2 Mantenimiento del Estado de la Session

Durante una Session, el DTP_Engine **MUST** mantener el estado de transmisión bidireccional:

```typescript
interface DirectionalTransferState {
  currentSequenceNumber: SequenceNumber;
  highestAcknowledgedSequenceNumber: SequenceNumber;
  unacknowledgedFragmentCache: Map<SequenceNumber, Fragment>;
}
```

La implementación **MUST** mantener un DirectionalTransferState independiente para cada dirección de transmisión:

| Dirección | Nombre del Campo |
|-----------|------------------|
| Recolección de datos (Terminal → Fay) | `collectionState` |
| Inyección de datos (Fay → Terminal) | `injectionState` |

### 8.6.3 Estructura de Datos de la Session

La estructura completa de Session **MUST** contener:

```typescript
interface Session {
  sessionId: SessionID;
  masterIdentity: string;
  slaveIdentity: string;
  state: SessionState;
  activeAgreements: Map<AgreementID, Agreement>;
  collectionState: DirectionalTransferState;
  injectionState: DirectionalTransferState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}
```

### 8.6.4 Persistencia de la Session

Cuando la conexión de transporte subyacente se desconecta, el DTP_Engine **MUST**:

1. Transicionar inmediatamente el SessionState de `Transmitting` a `Suspended`.
2. Persistir lo siguiente en almacenamiento no volátil:
   - El objeto Session completo (incluyendo todos los Agreements activos)
   - El DirectionalTransferState bidireccional
   - La caché de Fragments no acusados
3. La persistencia **MUST** ser atómica (todo tiene éxito o todo falla).

### 8.6.5 Restauración de la Session

Tras el restablecimiento de la conexión subyacente, el DTP_Engine **MUST** seguir el siguiente flujo de recuperación:

1. Esperar la re-verificación de CAP.
2. Tras el éxito de la verificación de CAP, entrar en el estado `Resuming`.
3. Restaurar el estado de la Session desde el almacenamiento persistente.
4. El receptor envía un ResumeReport (véase la Sección 8.2.2).
5. Basándose en el ResumeReport, el emisor reanuda la transmisión desde el punto de interrupción.
6. Tras la finalización del handshake de reanudación, transicionar a `Transmitting`.

Si la restauración falla, el DTP_Engine **MUST**:

1. Transicionar al estado `Idle`.
2. Liberar todos los recursos relacionados.
3. Notificar a la capa superior mediante el error `SESSION_RESTORE_FAILED` (5003).

### 8.6.6 Timeout de Session

Una implementación **MUST** implementar un mecanismo de timeout de Session:

1. **MUST** mantener un campo `lastActivityAt` que registre el último tiempo de actividad.
2. Cuando `now - lastActivityAt > timeoutThreshold`, la Session **MUST** marcarse como expirada.
3. Una Session expirada **MUST** ser cerrada y los recursos relacionados **MUST** ser liberados.
4. El `timeoutThreshold` por defecto es **RECOMMENDED** como 30 minutos (1.800.000 ms).

## 8.7 Independencia Bidireccional

Una implementación **MUST** garantizar estrictamente la independencia de las dos direcciones de transmisión:

1. Los cambios de estado en la dirección de recolección de datos **MUST NOT** afectar a la dirección de inyección de datos.
2. Una anomalía de conexión en una dirección **MUST NOT** disparar automáticamente un cambio de estado en la otra dirección (a menos que la conexión subyacente esté completamente desconectada).
3. Los números de secuencia de una dirección **MUST NOT** entrar en el espacio de números de secuencia de la otra dirección.
4. La caché de una dirección **MUST NOT** consumir la cuota de caché de la otra dirección.
