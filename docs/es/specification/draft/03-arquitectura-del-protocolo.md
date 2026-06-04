# Capítulo 3 Arquitectura del Protocolo

## 3.1 Estratificación del Protocolo

Una implementación de DTP **MUST** organizarse según la siguiente estratificación:

```
+-----------------------------------------------+
|             Application Layer                  |
|   iFay / coFay / Personal Data Heap            |
|   Terminal Applications                        |
+-----------------------------------------------+
|             DTP Protocol Layer                 |
|   DTP_Engine (DTP_Master / DTP_Slave)          |
|   - Agreement Manager                          |
|   - Frame Codec                                |
|   - DAG Manager                                |
|   - Encryption Module                          |
|   - Session Manager                            |
|   - Resume Manager                             |
+-----------------------------------------------+
|             Adapter Layer                      |
|   Transport_Adapter                            |
+-----------------------------------------------+
|             Transport Layer                    |
|   BLE / WebSocket / TCP / RTSP / ...           |
+-----------------------------------------------+
```

Una implementación **MUST NOT** invocar a través de capas (por ejemplo, la capa de aplicación **MUST NOT** acceder directamente a la interfaz de la capa de adaptador).

## 3.2 Componentes Centrales

El DTP_Engine **MUST** comprender los siguientes seis componentes centrales:

### 3.2.1 Agreement Manager

El Agreement Manager **MUST** proporcionar las siguientes capacidades:

1. **Gestión del flujo de negociación**: Manejar el envío y recepción de Request_Frame y Response_Frame.
2. **Gestión del ciclo de vida del Agreement**: Mantener las transiciones de estado del Agreement desde `negotiating` hasta `terminated`.
3. **Generación de identificador único**: Generar un UUID v4 conforme a RFC 4122 como Agreement_ID para cada Agreement establecido.
4. **Soporte de concurrencia multi-Agreement**: **MUST** soportar el mantenimiento de múltiples Agreements activos simultáneamente dentro de una única Session.

### 3.2.2 Frame Codec

El Frame Codec **MUST** proporcionar las siguientes capacidades:

1. **Serialización**: Codificar un objeto LogicalFrame en una secuencia binaria de bytes.
2. **Deserialización**: Decodificar una secuencia binaria de bytes en un objeto LogicalFrame.
3. **Consistencia de ida y vuelta**: Para cualquier objeto LogicalFrame válido, serializar y luego deserializar **MUST** producir un LogicalFrame equivalente al objeto original.
4. **Pretty Printer**: **SHOULD** proporcionar la capacidad de convertir un LogicalFrame en texto legible por humanos, y **SHOULD** incluir todos los campos clave del header del marco.

### 3.2.3 DAG Manager

El DAG Manager **MUST** proporcionar las siguientes capacidades:

1. **Detección de ciclos**: Antes de añadir un Fragment al DAG, **MUST** verificar que no se formaría un ciclo. Cuando se detecta un ciclo, el Fragment **MUST** ser rechazado y **MUST** devolverse el error `DAG_CYCLE_DETECTED` (4001).
2. **Resolución de dependencias**: Cuando una dependencia objetivo declarada por un Fragment aún no ha llegado, el Fragment **MUST** marcarse como "pendiente de resolución de dependencias" y almacenarse en caché.
3. **Resolución diferida**: Cuando llega el Fragment del que se depende, los Fragments previamente almacenados en caché **MUST** resolverse automáticamente.
4. **Soporte de tipos de relación**: **MUST** soportar los tres tipos de relación `derived_from`, `annotates` y `supersedes`.

### 3.2.4 Encryption Module

El Encryption Module **MUST** proporcionar las siguientes capacidades:

1. **Cifrado del Payload**: Cifrar el Payload utilizando la clave pre-negociada por CAP.
2. **Descifrado del Payload**: Descifrar el Payload recibido utilizando la clave pre-negociada por CAP.
3. **Verificación de disponibilidad de clave**: Antes de cualquier operación de cifrado, **MUST** verificar que CAP haya completado el intercambio de claves.
4. **Generación de metadatos de cifrado**: **MUST** incluir los metadatos de cifrado (identificador del algoritmo y versión de la clave) en forma de texto plano dentro del header del marco.

### 3.2.5 Session Manager

El Session Manager **MUST** proporcionar las siguientes capacidades:

1. **Gestión del ciclo de vida de la Session**: Establecer, mantener y cerrar Sessions.
2. **Persistencia de estado**: Cuando la conexión subyacente se interrumpe, **MUST** persistir el estado de la Session.
3. **Restauración de estado**: Después de que la conexión se restaure y la re-verificación de CAP pase, **MUST** poder restaurar el estado anterior de la Session.
4. **Detección de timeout**: **MUST** implementar la detección de timeout por inactividad de la Session.

### 3.2.6 Resume Manager

El Resume Manager **MUST** proporcionar las siguientes capacidades:

1. **Asignación de número de secuencia**: Asignar un número de secuencia monótonamente creciente a cada Fragment enviado.
2. **Caché de no acuse de recibo**: Almacenar Fragments localmente hasta que el receptor los acuse.
3. **Reporte de punto de interrupción**: Cuando se restaure la conexión, reportar al peer el número de secuencia más alto recibido con éxito.
4. **Gestión de caché**: **MUST** implementar una verificación del límite superior de capacidad de la caché. Cuando la caché alcance su límite, el envío **MUST** pausarse y **MUST** devolverse el error `BUFFER_FULL` (6001).

## 3.3 Máquina de Estados

El DTP_Engine **MUST** implementar la siguiente máquina de estados:

```
                 [Idle]
                    |
                    | Connection request received
                    v
             [WaitingForCAP]
                    |
                    | CAP authentication + key exchange complete
                    v
             [SessionEstablished]
                    |
                    | Send or receive Request_Frame
                    v
              [Negotiating]
                    |
                    | Agreement reached
                    v
              [Transmitting]
                    |
                    | Connection interrupted
                    v
                [Suspended]
                    |
                    | Connection restored + CAP re-verified
                    v
                [Resuming]
                    |
                    | Resume handshake complete
                    v
              [Transmitting]
```

Las reglas completas de transición de estado **MUST** cumplir con la siguiente tabla:

| Estado Actual | Evento Disparador | Estado Objetivo | Notas |
|---------------|-------------------|-----------------|-------|
| `Idle` | Solicitud de conexión recibida | `WaitingForCAP` | |
| `WaitingForCAP` | Autenticación CAP + intercambio de claves completo | `SessionEstablished` | |
| `WaitingForCAP` | Fallo o timeout de CAP | `Idle` | **MUST** liberar los recursos relacionados |
| `SessionEstablished` | Envío o recepción de Request_Frame | `Negotiating` | |
| `SessionEstablished` | Timeout de Session | `Idle` | **MUST** cerrar la Session |
| `Negotiating` | Agreement alcanzado | `Transmitting` | |
| `Negotiating` | Negociación fallida o rechazada | `SessionEstablished` | |
| `Transmitting` | Transmisión continua de Fragments | `Transmitting` | Auto-bucle |
| `Transmitting` | Request_Frame de tipo ajuste recibido | `Negotiating` | |
| `Transmitting` | Conexión subyacente desconectada | `Suspended` | **MUST** persistir el estado de la Session |
| `Transmitting` | Agreement terminado y sin otros Agreements activos | `SessionEstablished` | |
| `Suspended` | Conexión restaurada y re-verificación CAP pasada | `Resuming` | |
| `Suspended` | Timeout de Session | `Idle` | **MUST** liberar los recursos |
| `Resuming` | Handshake de reanudación completo | `Transmitting` | |
| `Resuming` | Restauración fallida | `Idle` | **MUST** cerrar la Session |

Una implementación **MUST NOT** introducir transiciones de estado no listadas en la tabla anterior.

## 3.4 Interfaz Transport_Adapter

El Transport_Adapter **MUST** proporcionar la siguiente interfaz:

```typescript
interface Transport_Adapter {
  // Connection management
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;

  // Data transmission
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;

  // State events
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}
```

Una implementación concreta de Transport_Adapter **MUST** satisfacer los siguientes requisitos normativos:

1. La operación `send()` **MUST** ser no bloqueante.
2. Cuando el estado de la conexión subyacente cambia, el DTP_Engine **MUST** ser notificado a través del callback `onConnectionStateChange`.
3. **MUST** proporcionar una implementación de interfaz unificada para cada protocolo de transporte soportado (BLE, WebSocket, TCP, RTSP).
4. **MUST NOT** modificar los datos binarios pasados por el DTP_Engine.

## 3.5 Secuencia de Interacción Maestro-Esclavo

Una interacción DTP completa **MUST** cumplir con las siguientes cinco fases:

### Fase 1: Pre-procesamiento de CAP

El DTP_Engine **MUST** esperar a que CAP complete la autenticación de identidad y el intercambio de claves. Durante esta fase, DTP **MUST NOT** enviar ningún marco de datos.

### Fase 2: Establecimiento de la Session DTP

Tras la finalización de CAP, el DTP_Engine **MUST** generar un Session_ID único (UUID v4) y entrar en el estado `SessionEstablished`.

### Fase 3: Negociación

Fase 3a (Negociación de Recolección de Datos): El Master **MAY** enviar un Request_Frame con `requestType = collection`, y el Slave **MUST** responder con un Response_Frame indicando `accepted`, `rejected` o `counter_proposal`.

Fase 3b (Negociación de Inyección de Datos): El Slave **MAY** enviar un Request_Frame con `requestType = injection`, y el Master **MUST** responder con un Response_Frame.

### Fase 4: Transmisión de Datos

Tras alcanzar un Agreement, el emisor **MUST** transmitir Fragments a través de marcos de datos, y cada Fragment **MUST** llevar el Agreement_ID al que pertenece (u omitirlo para heredar el contexto, véase la Sección 4.5).

### Fase 5: Interrupción y Recuperación de la Conexión

Cuando la conexión subyacente se interrumpe, el DTP_Engine **MUST** entrar en el estado `Suspended` y persistir la Session. Tras la restauración de la conexión, **MUST** realizarse la re-verificación de CAP, y luego el Engine **MUST** entrar en el estado `Resuming` para completar el handshake de reanudación.
