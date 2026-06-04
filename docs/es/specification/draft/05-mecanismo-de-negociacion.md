# Capítulo 5 Mecanismo de Negociación

## 5.1 Principios de Negociación

Una implementación de DTP **MUST** hacer cumplir los siguientes principios de negociación:

1. **Negociación primero**: Antes de cualquier transmisión de datos de Fragment, **MUST** existir ya un Agreement en el estado `active`.
2. **Sin transmisión cruda**: Una implementación **MUST NOT** permitir transmisión de datos que no se base en un Agreement.
3. **Negociación bidireccional**: El Master **MAY** iniciar la negociación de recolección de datos; el Slave **MAY** iniciar la negociación de inyección de datos.
4. **Ajuste dinámico**: Ambas partes **MAY** ajustar los parámetros de un Agreement mientras está en el estado `active`.
5. **Terminación explícita**: Ambas partes **MAY** terminar explícitamente un Agreement. Tras la terminación, la transmisión de datos bajo ese Agreement **MUST** detenerse inmediatamente.

## 5.2 Tipos de Marco de Negociación

La negociación **MUST** llevarse a cabo a través de dos tipos de marco: Request_Frame y Response_Frame.

### 5.2.1 Request_Frame

Un Request_Frame **MUST** contener los siguientes campos:

```typescript
interface RequestFrame {
  frameType: "request";
  requestId: string;
  requestorRole: "master" | "slave";
  requestType: "collection" | "injection" | "adjustment" | "termination";
  targetAgreementId?: AgreementID;
  proposedParams: AgreementParams;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `frameType` | **MUST** ser el literal `"request"` |
| `requestId` | **MUST** ser un identificador único de la solicitud. **SHOULD** utilizar UUID v4 |
| `requestorRole` | **MUST** ser `"master"` o `"slave"`, identificando al originador de la solicitud |
| `requestType` | **MUST** ser uno de los cuatro tipos en la tabla siguiente |
| `targetAgreementId` | **MUST** proporcionarse cuando `requestType` sea `"adjustment"` o `"termination"` |
| `proposedParams` | **MUST** proporcionar AgreementParams completos (véase la Sección 5.4) |

### 5.2.2 RequestType

| Valor | Semántica | Restricción |
|-------|-----------|-------------|
| `"collection"` | Solicitud de recolección de datos | **MUST** ser iniciada por `requestorRole = "master"` |
| `"injection"` | Solicitud de inyección de datos | **MUST** ser iniciada por `requestorRole = "slave"` |
| `"adjustment"` | Ajustar un Agreement existente | **MUST** proporcionar `targetAgreementId`; el Agreement objetivo **MUST** estar en el estado `active` |
| `"termination"` | Terminar un Agreement existente | **MUST** proporcionar `targetAgreementId` |

Una implementación **MUST** rechazar cualquier solicitud que no satisfaga las restricciones anteriores y devolver el error correspondiente (véase el Capítulo 9).

### 5.2.3 Response_Frame

Un Response_Frame **MUST** contener los siguientes campos:

```typescript
interface ResponseFrame {
  frameType: "response";
  requestId: string;
  result: NegotiationResult;
  agreedParams?: AgreementParams;
  agreementId?: AgreementID;
  rejectionReason?: string;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `frameType` | **MUST** ser el literal `"response"` |
| `requestId` | **MUST** ser el `requestId` del Request_Frame correspondiente |
| `result` | **MUST** ser uno de `NegotiationResult` |
| `agreedParams` | **MUST** proporcionarse cuando `result` sea `accepted` o `counter_proposal` |
| `agreementId` | **MUST** proporcionarse cuando `result` sea `accepted`; **MUST** ser un UUID v4 recién generado |
| `rejectionReason` | **MUST** proporcionarse cuando `result` sea `rejected` |

### 5.2.4 NegotiationResult

`NegotiationResult` **MUST** ser uno de los siguientes tres valores:

| Valor | Semántica |
|-------|-----------|
| `"accepted"` | Aceptar la solicitud |
| `"rejected"` | Rechazar la solicitud |
| `"counter_proposal"` | Proponer una alternativa |

Una implementación **MUST NOT** devolver valores de resultado no listados.

## 5.3 Flujo de Negociación

### 5.3.1 Negociación de Recolección de Datos (Iniciada por el Master)

La negociación de recolección de datos **MUST** seguir este flujo:

1. El Master envía un Request_Frame con `requestType = "collection"` y `requestorRole = "master"`.
2. El Slave **MUST** responder con un Response_Frame que contenga uno de los siguientes tres resultados:
   - `"accepted"`: De acuerdo en transmitir según `proposedParams`. **MUST** incluir el `agreementId` recién generado en el Response_Frame.
   - `"rejected"`: Rechaza la transmisión. **MUST** declarar una restricción relacionada con cumplimiento (por ejemplo, política DLP) en `rejectionReason`. **MUST NOT** rechazar por razones no relacionadas con cumplimiento.
   - `"counter_proposal"`: Propone parámetros alternativos. **MUST** proporcionar los parámetros modificados en `agreedParams`.
3. Si el Slave responde con `counter_proposal`, el Master **MAY** enviar un nuevo Request_Frame para aceptar, rechazar o continuar negociando.
4. El Master **MUST** registrar de forma persistente el resultado de la respuesta del Slave para cada solicitud de recolección de datos.

### 5.3.2 Negociación de Inyección de Datos (Iniciada por el Slave)

La negociación de inyección de datos **MUST** seguir este flujo:

1. El Slave envía un Request_Frame con `requestType = "injection"` y `requestorRole = "slave"`.
2. El Master **MUST** responder con un Response_Frame que contenga uno de los siguientes tres resultados:
   - `"accepted"`: De acuerdo en proporcionar datos. **MUST** describir el alcance de los datos filtrados (conjunto de datos minimizado) en `agreedParams`. **MUST** incluir el `agreementId` recién generado en el Response_Frame.
   - `"rejected"`: Rechaza proporcionar datos. **SHOULD** declarar la razón en `rejectionReason`.
   - `"counter_proposal"`: Proporciona datos de un alcance o formato diferente. **MUST** describir la alternativa en `agreedParams`.
3. El Master **MUST** mantener plena autoridad de decisión en las decisiones de inyección de datos, y **MUST NOT** ser forzado a aceptar la solicitud.

### 5.3.3 Timeout de Negociación

Una implementación **MUST** establecer un umbral de timeout para Request_Frame. Si el Response_Frame del peer no se recibe dentro del umbral:

1. El solicitante **SHOULD** retransmitir el Request_Frame; el contador de reintentos **MUST NOT** exceder el límite superior configurado por la implementación.
2. Después de alcanzar el límite superior de reintentos, el solicitante **MUST** terminar la negociación y notificar a la aplicación de capa superior el error `AGREEMENT_NEGOTIATION_FAILED` (3003).

## 5.4 AgreementParams

AgreementParams **MUST** contener los siguientes campos:

```typescript
interface AgreementParams {
  dataType: string;
  dataRange: string;
  transferMode: TransferMode;
  frequency: number | null;
  validityPeriod: number;
  priority: Priority;
}
```

| Campo | Tipo | Requisito Normativo |
|-------|------|---------------------|
| `dataType` | `string` | **MUST** ser no vacío. Identifica el tipo de datos |
| `dataRange` | `string` | **MUST** ser no vacío. Describe el alcance de los datos |
| `transferMode` | `TransferMode` | **MUST** ser uno de los tres valores de la tabla siguiente |
| `frequency` | `number \| null` | En Hz. **MUST** ser null cuando `transferMode = "one_time"`; **MUST** ser un número positivo para otros modos |
| `validityPeriod` | `number` | En milisegundos. **MUST** ser un entero positivo |
| `priority` | `Priority` | **MUST** ser uno de los cuatro valores de la tabla siguiente |

### 5.4.1 TransferMode

| Valor | Semántica |
|-------|-----------|
| `"one_time"` | Transmisión única. El Agreement **SHOULD** terminar automáticamente tras la finalización de la transmisión |
| `"periodic"` | Transmisión periódica. **MUST** establecer `frequency` |
| `"streaming"` | Transmisión en streaming. **MUST** establecer `frequency` |

### 5.4.2 Priority

| Valor | Semántica |
|-------|-----------|
| `"low"` | Prioridad baja |
| `"normal"` | Prioridad normal (por defecto) |
| `"high"` | Prioridad alta |
| `"critical"` | Prioridad crítica |

Una implementación **SHOULD** programar la contención de recursos entre múltiples Agreements de acuerdo con `priority`.

## 5.5 Ciclo de Vida del Agreement

### 5.5.1 Definiciones de Estado

`AgreementStatus` **MUST** ser uno de los siguientes cuatro valores:

| Estado | Semántica |
|--------|-----------|
| `"negotiating"` | Negociación en curso |
| `"active"` | Agreement en vigor; datos en transmisión |
| `"suspended"` | Conexión interrumpida; Agreement suspendido |
| `"terminated"` | Agreement terminado |

### 5.5.2 Transiciones de Estado

El estado del Agreement **MUST** cumplir con las siguientes reglas de transición:

| Estado Actual | Evento Disparador | Estado Objetivo |
|---------------|-------------------|-----------------|
| (ninguno) | Request_Frame emitido | `negotiating` |
| `negotiating` | Response_Frame devuelve `accepted` | `active` |
| `negotiating` | Response_Frame devuelve `rejected` | (terminado) |
| `active` | Conexión subyacente desconectada | `suspended` |
| `active` | Request_Frame de tipo `termination` recibido | `terminated` |
| `active` | `validityPeriod` expirado | `terminated` |
| `suspended` | Conexión restaurada y re-verificación CAP pasada | `active` |
| `suspended` | Timeout de persistencia | `terminated` |
| `terminated` | (estado terminal) | (ninguno) |

### 5.5.3 Auto-Terminación de Agreements de Una Sola Vez

Cuando `transferMode = "one_time"` y la transmisión de datos se completa:

1. El emisor **MUST** terminar el Agreement después del último Fragment enviando un Request_Frame con `requestType = "termination"`.
2. El receptor **MUST** establecer el estado del Agreement en `terminated` después de recibir y acusar todos los Fragments.

## 5.6 Concurrencia Multi-Agreement

Una implementación de DTP **MUST** soportar el mantenimiento de múltiples Agreements en el estado `active` simultáneamente dentro de una única Session.

La implementación **MUST** satisfacer:

1. Cada Fragment está asociado con un Agreement específico a través de su Agreement_ID.
2. Los Fragments pertenecientes a diferentes Agreements **MAY** intercalarse en el flujo de transmisión.
3. El método real de transmisión para múltiples Agreements (serie o paralelo) **DEPENDS** de las capacidades del Transport_Adapter subyacente.
4. La implementación **MUST NOT** limitar el número máximo de Agreements activos en una única Session por debajo de 16. **SHOULD** soportar un número arbitrario.

## 5.7 Restricciones de Negociación del Observer

El rol Observer **MUST** satisfacer:

1. **MUST NOT** enviar Request_Frame. Si un Observer intenta enviar uno, el DTP_Engine **MUST** rechazar la operación y devolver el error `OBSERVER_WRITE_DENIED` (8002).
2. **MUST NOT** recibir ninguna autoridad de decisión sobre Response_Frame.
3. **MAY** recibir copias de solo lectura de los marcos de datos.
4. **MUST** estar autorizado explícitamente por el Controller al unirse como Observer.
