# Capítulo 4 Estructura del Marco Lógico

## 4.1 Estructura General

Un LogicalFrame **MUST** consistir en dos partes:

```
+----------------+
|     Header     |   (plaintext)
+----------------+
|     Payload    |   (encrypted)
+----------------+
```

Definición formal de LogicalFrame:

```typescript
interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;  // encrypted
}
```

## 4.2 FrameHeader

El header del marco **MUST** contener los siguientes campos. El orden en la tabla siguiente es el orden normativo:

| Campo | Tipo | Requerido | Cifrado | Descripción |
|-------|------|-----------|---------|-------------|
| `protocolVersion` | `ProtocolVersion` | **REQUIRED** | No | Versión del protocolo |
| `frameType` | `FrameType` | **REQUIRED** | No | Tipo de marco |
| `fragmentId` | `FragmentID` | **REQUIRED** | No | Identificador único del Fragment |
| `agreementId` | `AgreementID \| null` | **REQUIRED** | No | ID del Agreement (**MAY** ser null) |
| `originTimestamp` | `OriginTimestamp` | **REQUIRED** | No | Marca de tiempo de origen (UTC ms) |
| `dagDependencies` | `DAGEdge[]` | **REQUIRED** | No | Lista de dependencias DAG (**MAY** ser un array vacío) |
| `encryptionMetadata` | `EncryptionMetadata` | **REQUIRED** | No | Metadatos de cifrado |
| `sequenceNumber` | `SequenceNumber` | **REQUIRED** | No | Número de secuencia de transmisión |

El header del marco **MUST NOT** estar cifrado. Todos los campos **MUST** transmitirse en texto plano.

## 4.3 FrameType

`FrameType` **MUST** ser uno de los siguientes cuatro valores enumerados:

| Valor | Propósito | Contenido del Payload |
|-------|-----------|------------------------|
| `"data"` | Lleva los datos reales del Fragment | El campo `data` de un Fragment |
| `"request"` | Inicia una solicitud de datos o ajusta un Agreement de transmisión | El contenido serializado de un RequestFrame |
| `"response"` | Responde a una solicitud de datos | El contenido serializado de un ResponseFrame |
| `"control"` | Transmite información de control como notificaciones de error y terminación de Agreement | El contenido serializado de un ControlFrame |

Una implementación **MUST NOT** introducir tipos de marco no listados.

## 4.4 ProtocolVersion

`ProtocolVersion` **MUST** consistir en dos enteros no negativos:

```typescript
interface ProtocolVersion {
  major: number;
  minor: number;
}
```

La semántica del número de versión y la regla de clasificación de cambios **MUST** cumplir con las reglas definidas en el Capítulo 1 §1.7.2 (la fuente autorizada).

## 4.5 Compresión del Agreement_ID

El campo `agreementId` **MAY** ser `null` con fines de compresión. Las reglas de compresión **MUST** cumplir con los siguientes requisitos:

1. Dentro de un lote de Fragments consecutivos pertenecientes al mismo Agreement, **únicamente** el header del primer Fragment **MUST** llevar el Agreement_ID completo.
2. El campo `agreementId` de los Fragments subsiguientes **MAY** establecerse en `null`, lo que indica la reutilización del Agreement_ID no nulo más reciente.
3. El receptor **MUST** mantener un "Agreement_ID del contexto actual" e interpretarlo según las siguientes reglas:
   - Cuando se recibe un Fragment con `agreementId` no nulo, su valor **MUST** actualizarse como el Agreement_ID del contexto actual.
   - Cuando se recibe un Fragment con `agreementId` establecido en null, **MUST** asociarse con el Agreement_ID del contexto actual.
4. Si el receptor recibe un Fragment con `agreementId` establecido en null mientras el Agreement_ID del contexto actual también es null, **MUST** descartar el Fragment y devolver el error `AGREEMENT_NOT_FOUND` (3001).
5. Si el receptor recibe un Fragment que referencia un Agreement_ID desconocido, **MUST** descartar el Fragment y devolver el error `AGREEMENT_NOT_FOUND` (3001).

El Agreement_ID del contexto actual del receptor **MUST** mantenerse de forma independiente para cada dirección de transmisión.

## 4.6 Origin_Timestamp

`originTimestamp` **MUST** satisfacer:

1. **MUST** utilizar la zona horaria UTC.
2. **MUST** llevar precisión de milisegundos.
3. **MUST** ser un entero no negativo (Unix timestamp en milisegundos).
4. **MUST** registrar el instante en que los datos fueron realmente producidos en el origen, y **MUST NOT** registrar el tiempo de transmisión.
5. Después de atravesar la cadena completa de transmisión (serialización → cifrado → transmisión → descifrado → deserialización), **MUST** ser exactamente el mismo que antes del envío.
6. El receptor **MUST NOT** modificar el Origin_Timestamp recibido.

## 4.7 Dependencias DAG (DAGEdge)

`DAGEdge` **MUST** contener los siguientes campos:

```typescript
interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
```

`DAGRelationType` **MUST** ser uno de los siguientes tres valores enumerados:

| Valor | Semántica |
|-------|-----------|
| `"derived_from"` | Este Fragment se deriva del Fragment objetivo |
| `"annotates"` | Este Fragment anota/explica el Fragment objetivo |
| `"supersedes"` | Este Fragment reemplaza al Fragment objetivo |

El array `dagDependencies` **MAY** estar vacío (es decir, el Fragment no tiene dependencias).

## 4.8 EncryptionMetadata

`EncryptionMetadata` **MUST** contener los siguientes campos:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `algorithm` | **MUST** ser la cadena identificadora del algoritmo de cifrado (por ejemplo, `"AES-256-GCM"`). **SHOULD** utilizar nombres de algoritmo registrados por IANA |
| `keyVersion` | **MUST** ser un entero no negativo. Utilizado para soportar la rotación de claves |

Los metadatos de cifrado en sí **MUST NOT** estar cifrados, y **MUST** incluirse en forma de texto plano dentro del header del marco.

## 4.9 Sequence_Number

`sequenceNumber` **MUST** satisfacer:

1. **MUST** ser un entero no negativo.
2. **MUST** ser monótonamente creciente dentro de una única Session.
3. **MUST** mantenerse de forma independiente para cada dirección de transmisión (recolección de datos, inyección de datos).
4. El espacio de números de secuencia **MUST NOT** compartirse entre las dos direcciones.
5. **SHOULD** comenzar desde 0 o 1.
6. Si el número de secuencia se desborda (un valor máximo definido por la implementación), la implementación **MUST** manejarlo estableciendo una nueva Session, y **MUST NOT** dar la vuelta.

## 4.10 Estructura del Fragment

Un Fragment **MUST** contener los siguientes campos:

```typescript
interface Fragment {
  fragmentId: FragmentID;
  agreementId: AgreementID;
  originTimestamp: OriginTimestamp;
  contextMetadata: ContextMetadata;
  dagDependencies: DAGEdge[];
  data: Uint8Array;
}
```

Nota: Cuando el campo `agreementId` de un Fragment se serializa en un LogicalFrame, puede aparecer como null en el header del LogicalFrame debido a las reglas de compresión (véase la Sección 4.5), pero el `agreementId` lógico del propio Fragment **MUST** ser siempre no nulo.

## 4.11 ContextMetadata

`ContextMetadata` **MUST** contener los siguientes campos:

```typescript
interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
```

`DataSource` **MUST** ser una de las siguientes dos estructuras (una unión discriminada distinguida por el campo `kind`):

### 4.11.1 HardwareSource

Cuando los datos provienen de un sensor de hardware, `source` **MUST** ser:

```typescript
interface HardwareSource {
  kind: "hardware";
  sensorType: string;
  precision: string;
  samplingRate: number;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `kind` | **MUST** ser la cadena literal `"hardware"` |
| `sensorType` | **MUST** ser una cadena no vacía. **SHOULD** utilizar nomenclatura estandarizada (por ejemplo, `"accelerometer"`, `"heart_rate_monitor"`) |
| `precision` | **MUST** ser una cadena no vacía que describa la precisión del sensor (por ejemplo, `"±0.1°C"`) |
| `samplingRate` | **MUST** ser un número positivo, en Hz |

### 4.11.2 SoftwareSource

Cuando los datos provienen de compartición de software, `source` **MUST** ser:

```typescript
interface SoftwareSource {
  kind: "software";
  appIdentifier: string;
  sharingMethod: string;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `kind` | **MUST** ser la cadena literal `"software"` |
| `appIdentifier` | **MUST** ser una cadena no vacía. **SHOULD** utilizar notación de nombre de dominio inverso (por ejemplo, `"com.example.app"`) |
| `sharingMethod` | **MUST** ser una cadena no vacía que describa el método de compartición (por ejemplo, `"api_push"`, `"clipboard_capture"`) |

### 4.11.3 Campos Personalizados

`customFields` **MUST** ser un mapa de cadena a valor arbitrario, y **MAY** ser el objeto vacío `{}`. Una implementación **MUST NOT** repetir información ya presente en `dataType` o `source` dentro de `customFields`.

## 4.12 Requisitos de Serialización

La serialización de un LogicalFrame **MUST** satisfacer los siguientes requisitos normativos:

1. **Determinismo**: El mismo objeto LogicalFrame **MUST** producir la misma salida binaria.
2. **Consistencia de ida y vuelta**: Para cualquier LogicalFrame válido, serializar y luego deserializar **MUST** producir un LogicalFrame equivalente al objeto original.
3. **Completitud**: La salida serializada **MUST** contener todos los campos del header del marco.
4. **Cifrado del Payload**: Antes de la serialización, el Payload **MUST** estar ya cifrado utilizando el algoritmo especificado en EncryptionMetadata.

El diseño binario concreto de la serialización (orden de bytes, codificación de campos) se especificará en borradores posteriores; los formatos binarios maduros como CBOR (RFC 8949) o Protocol Buffers **SHOULD** preferirse.

## 4.13 Fragmentación Física

Cuando el transporte subyacente requiera fragmentación (por ejemplo, debido a límites de MTU de BLE):

1. La operación de fragmentación **MUST** ser realizada por el Transport_Adapter.
2. El LogicalFrame **MUST** permanecer entero en la capa del DTP_Engine.
3. El Transport_Adapter del receptor **MUST** reensamblar el LogicalFrame completo antes de pasarlo al DTP_Engine.
