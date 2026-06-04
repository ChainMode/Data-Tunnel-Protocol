# Capítulo 10 Gestión de Versiones

> **Declaración de Única Fuente de Verdad (Single Source of Truth).** La **política** de gestión de versiones de DTP está definida por el Capítulo 1 §1.7 «Gestión de Versiones y Compatibilidad» como la **Única Fuente de Verdad**. Este capítulo **MUST NOT** redefinir la política ya especificada en §1.7; este capítulo solo proporciona los **mecanismos operativos** de las reglas de §1.7 (vinculación con el formato de cable, payloads concretos de códigos de error, secuencia de negociación, plantilla de declaración de implementación) y el **flujo de gobernanza** (convenciones de directorio y estado, acciones de finalización). Siempre que cualquier declaración de este capítulo sea ambigua con §1.7, §1.7 **MUST** prevalecer.

## 10.1 Formato del Número de Versión (referencia operativa)

La semántica del número de versión del protocolo DTP, la estructura de dos niveles `MAJOR.MINOR` (sin PATCH), la regla de clasificación de cambios y las definiciones de ejes ortogonales están en §1.7.1 y §1.7.2 y no se repiten aquí.

Vinculación con el formato de cable: el header de cada LogicalFrame **MUST** llevar el campo `ProtocolVersion` completo (véase la Sección 4.4):

```typescript
interface ProtocolVersion {
  major: number;  // entero no negativo
  minor: number;  // entero no negativo
}
```

La versión inicial del protocolo definida por esta especificación **MUST** ser `{ major: 1, minor: 0 }` (es decir, `dtp/1.0`).

## 10.2 Matriz de Compatibilidad de Versiones (suplemento operativo a §1.7.3)

> Las reglas normativas de compatibilidad y negociación están en §1.7.3. La siguiente tabla es su realización operativa a nivel de procesamiento de marcos y **MUST** leerse según §1.7.3; si es ambigua, prevalece §1.7.3.

| Versión del Marco Recibido | Manejo |
|----------------------------|--------|
| Igual a la versión más alta del receptor | Procesar normalmente |
| Igual a la versión mayor anterior de la versión más alta del receptor (major - 1) | Manejo de compatibilidad (procesar según la especificación más antigua) |
| Mayor que la versión más alta del receptor | **MUST** devolver `VERSION_INCOMPATIBLE` (7001) |
| Versión mayor inferior a (versión más alta del receptor - 1) | **MUST** devolver `VERSION_INCOMPATIBLE` (7001) |
| Misma versión mayor, versión menor inferior | Procesar normalmente (compatible hacia atrás) |
| Misma versión mayor, versión menor superior | **SHOULD** procesar (ignorar campos opcionales no reconocidos) |

### 10.2.1 Tolerancia de Versión Menor (realización operativa de §1.7.3)

Cuando una implementación recibe un marco con la misma versión mayor pero una versión menor superior, **MUST**:

1. Procesar los campos conocidos;
2. **SHOULD** ignorar los campos opcionales desconocidos;
3. **MUST NOT** rechazar el marco completo debido a campos opcionales desconocidos;
4. **MUST NOT** lanzar un error.

## 10.3 Manejo de Incompatibilidad de Versiones (mecanismo operativo)

### 10.3.1 Manejo del Receptor

Cuando el receptor recibe un LogicalFrame cuya versión de protocolo es superior a la versión que soporta (y excede el rango de compatibilidad), **MUST**:

1. **No procesar** el marco;
2. Enviar el error `VERSION_INCOMPATIBLE` (7001) al emisor;
3. Incluir su versión más alta soportada en el campo `details` de la notificación de error:

```typescript
{
  errorCode: 7001,
  errorMessage: "Protocol version higher than supported",
  details: {
    supportedMaxVersion: { major: 1, minor: 0 }
  }
}
```

> La semántica del código de error `7001` se rige por la tabla de códigos de error del Capítulo 9 y por el schema; este capítulo no la redefine.

### 10.3.2 Manejo del Emisor

Tras recibir el error `VERSION_INCOMPATIBLE`, el emisor **MAY** elegir:

1. **Degradar a la versión soportada por el peer** y reenviar el marco (**SHOULD** ser preferido, siempre que exista un `MAJOR` común; sin degradación a través de `MAJOR`, véase §1.7.3);
2. **Notificar a la aplicación de capa superior** la incompatibilidad de versiones, y **MUST NOT** reintentar automáticamente de forma indefinida.

Una implementación **MUST NOT** cerrar inmediatamente la Session tras recibir un error de incompatibilidad de versión, y **SHOULD** permitir la oportunidad de degradación.

### 10.3.3 Consistencia de versión dentro de la sesión y secuencia de negociación

Cuando se establece una Session DTP, ambas partes **MUST** negociar una versión de protocolo consistente (reglas de negociación en §1.7.3). Durante la sesión:

1. La versión unificada **MUST** utilizarse durante toda la sesión;
2. **MUST NOT** cambiar las versiones del protocolo a mitad de la sesión.

La negociación de versiones **SHOULD** seguir esta secuencia; el portador concreto (extensiones de CAP, el primer Request_Frame/Response_Frame, etc.) **MAY** ser elegido por la implementación, pero la negociación **MUST** completarse antes de que se envíe el primer marco de datos:

```
DTP_A                              DTP_B
  |                                   |
  |-- Hello (supported_versions) --->|
  |                                   |
  |<-- Hello_Ack (chosen_version) ---|
  |                                   |
  |    [both sides use chosen_version]|
```

## 10.4 Evolución del Protocolo y Gobernanza

Esta sección proporciona el flujo operativo de las reglas de gobernanza de §1.7. El formato del git tag, la enumeración de estados del documento y la definición de edición editorial referidos aquí **MUST** anclarse a §1.7; esta sección no los redefine.

### 10.4.1 Convenciones de directorio y estado (consistentes con Faying Protocol)

- El estado del documento es un marcador del front matter y **MUST NOT** codificarse en la ruta (véase §1.7.1).
- Bajo `specification/`, **MUST** mantenerse exactamente un área de trabajo mutable `draft/` (actualizada de forma continua).
- Todos los directorios distintos de `draft/` **MUST** nombrarse por fecha de publicación (p. ej. `2025-10-25/`), representando una edición publicada **congelada**; «no draft significa publicado».
- Que una edición publicada sea actualmente `Final`, `Deprecated` u `Obsolete` se determina **únicamente** por el campo `status` de sus archivos y **MUST NOT** inferirse del nombre del directorio.
- Crear directorios nombrados por estado (p. ej. `final/`) está **PROHIBIDO** —de lo contrario, deprecar una edición requeriría mover directorios y romper enlaces.
- WHEN ocurre una transición de estado, **únicamente** el `status` del front matter **MUST** modificarse, y los directorios **MUST NOT** moverse.

### 10.4.2 Versiones Borrador y Oficiales

- Borrador: los documentos residen en `docs/{lang}/specification/draft/`, el schema en `schema/draft/`; los números de versión borrador **MAY** usar `{ major: 0, minor: N }`. Durante `Draft` **NO** hay promesa de compatibilidad (véase §1.7.5), y los borradores **MUST NOT** utilizarse en producción.
- Versión oficial: **MUST** haber pasado por una revisión completa y discusión pública y tener una instantánea de versión inmutable; los documentos residen en `docs/{lang}/specification/{YYYY-MM-DD}/`, el schema en `schema/{YYYY-MM-DD}/`. La primera versión oficial es `2025-10-25`, correspondiente a la versión del protocolo `dtp/1.0`.
- Inmutabilidad de la instantánea de versión: una vez publicada una versión oficial **MUST** permanecer inmutable; las erratas de texto puro se portan mediante un **nuevo directorio de fecha de publicación** según §1.7.4 con los directorios existentes congelados, y el contenido de la especificación o el schema de una instantánea publicada **MUST NOT** reescribirse en el lugar.

### 10.4.3 Acciones Estándar de Finalización (Draft → Final)

WHEN se realiza la finalización, el Doc Governance Process **MUST** completar las siguientes acciones en orden:

1. Usar `git mv` para migrar todos los archivos bajo `draft/` al directorio de fecha de publicación (nombres de archivo sin cambios) y vaciar `draft/`;
2. Por archivo, cambiar `status` de `Draft` a `Final`;
3. Congelar `date` a la fecha de publicación oficial, bloquear `editors` a la lista de firmantes de finalización y mantener `version` sin cambios;
4. Escribir la cadena de historial `replaces` (apuntando al directorio borrador y a su hash corto de commit de finalización) en el front matter del README;
5. Etiquetar `dtp-v<MAJOR.MINOR>-final`, que **MUST** cubrir cuerpo + vectores de prueba + schema juntos;
6. Cuando estén implicados varios idiomas / archivos, **MUST** migrarse juntos en el mismo commit; la publicación unilateral está **prohibida**.

### 10.4.4 Obsolescencia y Eliminación

Una implementación **SHOULD** declarar obsoleta la funcionalidad a través del siguiente proceso:

1. **Marcar como obsoleta**: marcar la funcionalidad como obsoleta en una versión `MINOR`, pero **MUST** continuar soportándola;
2. **Período de transición**: al menos un ciclo completo de versión `MAJOR`;
3. **Eliminación**: eliminar en la siguiente versión `MAJOR`.

Una implementación **MUST NOT** eliminar funcionalidad obsoleta en una versión `MINOR`.

## 10.5 Declaración de Implementación

Una implementación de DTP **MUST** declarar en su documentación:

1. La versión más alta del protocolo soportada;
2. Todas las versiones mayores anteriores soportadas;
3. Si se soporta la compatibilidad hacia adelante (manejo de marcos con versiones menores superiores);
4. Las extensiones definidas por la implementación, si las hay.

Por ejemplo:

> **Declaración de Versión de la Implementación X de DTP:**
>
> - Versión más alta del protocolo soportada: 1.0
> - Versiones anteriores compatibles: ninguna (primera versión oficial)
> - Compatibilidad hacia adelante: soportada; ignora campos opcionales desconocidos
> - Algoritmos de cifrado: AES-256-GCM, ChaCha20-Poly1305
> - Adaptadores de transporte: BLE, WebSocket, TCP
