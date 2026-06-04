# Capítulo 7 Seguridad y Cifrado

## 7.1 Modelo de Seguridad

Una implementación de DTP **MUST** proporcionar cifrado de extremo a extremo. El modelo de seguridad **MUST** satisfacer los siguientes invariantes:

1. Únicamente la instancia iFay objetivo **MUST** poder descifrar el Payload recibido.
2. El entorno de ejecución FayGer **MUST NOT** acceder a los datos en texto plano bajo ninguna circunstancia.
3. Los nodos de red intermedios **MUST NOT** leer el texto plano del Payload.
4. La implementación de DTP **MUST NOT** gestionar las claves de cifrado por sí misma.

## 7.2 Alcance del Cifrado

El alcance del cifrado **MUST** estar estrictamente limitado al Payload del LogicalFrame.

### 7.2.1 Contenido Que MUST Estar Cifrado

Los siguientes datos **MUST** estar cifrados:

- El campo `payload` del LogicalFrame (es decir, el campo `data` de un Fragment, y, cuando se transporta como Frame, el contenido de RequestFrame, ResponseFrame y ControlFrame).

### 7.2.2 Contenido Que MUST NOT Estar Cifrado

Los siguientes datos **MUST NOT** estar cifrados, y **MUST** transmitirse en texto plano:

- El `header` del LogicalFrame (incluyendo `protocolVersion`, `frameType`, `fragmentId`, `agreementId`, `originTimestamp`, `dagDependencies`, `encryptionMetadata` y `sequenceNumber`).

Los propios metadatos de cifrado **MUST NOT** estar cifrados, de modo que el receptor pueda determinar los parámetros de descifrado antes del descifrado.

## 7.3 Gestión de Claves

### 7.3.1 Origen de la Clave

Una implementación de DTP **MUST** utilizar la clave pre-negociada por CAP. Específicamente:

1. CAP **MUST** completar la autenticación de identidad y el intercambio de claves durante la fase de establecimiento de la conexión.
2. La implementación de DTP **MUST** utilizar la `sessionKey` proporcionada por CAP para el cifrado/descifrado del Payload.
3. La implementación de DTP **MUST NOT** generar, negociar ni intercambiar claves de cifrado por sí misma.

### 7.3.2 Interfaz CAPContext

Una implementación de DTP **MUST** recibir el contexto proporcionado por CAP a través de la siguiente interfaz:

```typescript
interface CAPContext {
  identity: string;
  sessionKey: Uint8Array;
  verified: boolean;
}
```

| Campo | Requisito Normativo |
|-------|---------------------|
| `identity` | **MUST** ser el identificador de identidad del peer |
| `sessionKey` | **MUST** ser la secuencia de bytes de la clave de sesión negociada por CAP |
| `verified` | **MUST** reflejar el estado de verificación de CAP |

### 7.3.3 Precondiciones de CAP

Una implementación de DTP **MUST** verificar el CAPContext antes de iniciar la transmisión de datos:

1. Si `verified === false`, **MUST** rechazar el envío de cualquier marco de datos y devolver el error `KEY_NOT_READY` (2002).
2. Si `sessionKey` está vacío o tiene una longitud inválida, **MUST** devolver el error `KEY_NOT_READY`.
3. La transmisión de marcos de negociación (Request_Frame, Response_Frame) está **igualmente** sujeta a esta precondición.

## 7.4 Metadatos de Cifrado

El header de cada LogicalFrame **MUST** llevar EncryptionMetadata:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

### 7.4.1 Identificadores de Algoritmo

El campo `algorithm` **MUST** ser la cadena identificadora del algoritmo de cifrado. **SHOULD** utilizar uno de los siguientes nombres estandarizados:

| Identificador | Algoritmo | Estado |
|---------------|-----------|--------|
| `"AES-256-GCM"` | AES-256 en Galois/Counter Mode | **RECOMMENDED** |
| `"ChaCha20-Poly1305"` | ChaCha20 con Poly1305 | **RECOMMENDED** |
| `"AES-128-GCM"` | AES-128 en Galois/Counter Mode | **MAY** ser utilizado |

Una implementación **MUST** soportar al menos uno de `AES-256-GCM` y `ChaCha20-Poly1305`. Es **RECOMMENDED** soportar ambos para una mayor interoperabilidad.

Una implementación **MUST NOT** utilizar:

- Modo ECB (inseguro)
- Modos de cifrado no autenticados (CBC, CTR sin MAC)
- Algoritmos con debilidades conocidas (DES, 3DES, RC4)

### 7.4.2 Número de Versión de la Clave

`keyVersion` **MUST** ser un entero no negativo utilizado para soportar la rotación de claves:

1. Cuando CAP dispara una rotación de claves, el `keyVersion` de la nueva clave **MUST** ser estrictamente mayor que la versión anterior.
2. El receptor **MUST** seleccionar la clave de descifrado correspondiente basándose en `keyVersion`.
3. Una implementación **SHOULD** retener al menos una versión de clave anterior para soportar Fragments en tránsito.

## 7.5 Consistencia de Ida y Vuelta del Cifrado

Una implementación **MUST** satisfacer las siguientes propiedades de consistencia de ida y vuelta del cifrado:

1. Cifrar y luego descifrar utilizando la **clave correcta** (que coincida con la clave utilizada por el emisor) **MUST** producir una salida idéntica byte a byte al Payload original.
2. Descifrar utilizando una **clave incorrecta** **MUST** fallar y **MUST** devolver el error `DECRYPTION_FAILED` (2001).
3. En caso de fallo de descifrado, la implementación **MUST NOT** devolver resultados de descifrado parcial ni datos corruptos.

## 7.6 Descifrado en el Lado del Terminal

Cuando el terminal actúa como receptor (escenario de inyección de datos):

1. El DTP_Slave **MUST** utilizar la clave enviada por el terminal durante la fase de establecimiento de la conexión CAP para el descifrado.
2. Esa clave **MUST** corresponder a la clave privada / clave de sesión que el terminal envió en CAP.
3. El terminal **MUST NOT** aceptar el resultado del descifrado de ninguna otra clave.

## 7.7 Manejo de Fallo de Descifrado

Una implementación **MUST** manejar los fallos de descifrado de acuerdo con las siguientes reglas:

1. Fallo de descifrado único: descartar el marco y enviar la notificación de error `DECRYPTION_FAILED` (2001).
2. Fallos consecutivos de descifrado que excedan un umbral (definido por la implementación, **RECOMMENDED** como 3):
   a. **SHOULD** disparar a CAP para re-negociar las claves.
   b. **SHOULD** notificar a la aplicación de capa superior una anomalía de seguridad.
3. La implementación **MUST NOT** reintentar el mismo marco indefinidamente tras múltiples fallos de descifrado.

## 7.8 Mitigación de Amenazas de Seguridad

Una implementación **MUST** mitigar las siguientes amenazas a través del diseño del protocolo:

| Amenaza | Mecanismo de Mitigación |
|---------|-------------------------|
| Espionaje de hombre en el medio | Cifrado de Payload de extremo a extremo |
| Espionaje de FayGer | Cifrado del Payload; FayGer solo puede ver el texto cifrado |
| Filtración de claves | El mecanismo de versión de clave soporta la rotación de claves |
| Suplantación de identidad | Delegado a CAP para la verificación |
| Ataques de repetición | Números de secuencia monótonamente crecientes + vinculación a Session |
| Manipulación de marcos | Algoritmos de cifrado autenticado (AEAD) |

## 7.9 Protección contra Ataques de Repetición

Una implementación **MUST** mitigar los ataques de repetición a través de los siguientes mecanismos:

1. **Números de secuencia monótonamente crecientes**: El receptor **MUST** rechazar marcos cuyo número de secuencia sea menor o igual al número de secuencia más alto acusado (excepto en escenarios de reanudación).
2. **Vinculación a Session**: El espacio de números de secuencia **MUST** estar vinculado a una Session específica. Una nueva Session **MUST** restablecer el número de secuencia.
3. **Autenticación AEAD**: El algoritmo de cifrado **MUST** proporcionar autenticación de mensajes (GCM, Poly1305, etc.).

## 7.10 Privacidad de los Metadatos

Una implementación **SHOULD** ser consciente de que los metadatos en texto plano del header del marco **MAY** filtrar la siguiente información:

- Identidades de pares de comunicación (correlacionadas mediante `agreementId`)
- Patrones de tiempo de comunicación (mediante `originTimestamp` y `sequenceNumber`)
- Frecuencia de transmisión de datos (mediante el tiempo entre marcos)

Una implementación **MAY** mejorar la privacidad de los metadatos a través de:

1. Habilitar el padding de tráfico (definido por la implementación).
2. Utilizar una capa de transporte de ofuscación (por ejemplo, ECH basado en TLS 1.3).

Sin embargo, esta especificación **NOT REQUIRE** que una implementación proporcione protección de privacidad de metadatos.
