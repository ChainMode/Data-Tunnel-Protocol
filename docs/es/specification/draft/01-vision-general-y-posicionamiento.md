# Capítulo 1 Visión General y Posicionamiento

Este capítulo define el alcance del protocolo de DTP (§1.1), su posicionamiento (§1.2), su relación con CAP (§1.3), sus objetivos de diseño (§1.4), el modelo maestro-esclavo (§1.5) y los niveles de conformidad (§1.6), y en §1.7 «Gestión de Versiones y Compatibilidad» presenta las reglas de gestión de versiones de DTP en forma **normativa** —de modo que este protocolo **lleva su propia descripción de versión**, permitiendo a los implementadores estándar consultarla directamente sin buscar documentos externos.

## 1.1 Alcance del Protocolo

El Data Tunnel Protocol (DTP) **SHALL** ser el protocolo de capa de aplicación responsable de la transmisión bidireccional de datos entre dispositivos terminales e instancias de Fay dentro del ecosistema iFay.

DTP **MUST** implementar los siguientes dos flujos de datos centrales:

1. **Recolección de Datos**: Desde un terminal (Slave) hacia Fay (Master), utilizado para persistir los datos producidos por el terminal en el Personal Data Heap de iFay.
2. **Inyección de Datos**: Desde Fay (Master) hacia un terminal (Slave), utilizado para proporcionar temporalmente un conjunto de datos minimizado, filtrado por iFay, a las aplicaciones del terminal.

DTP **MUST NOT** utilizarse para otros propósitos.

## 1.2 Posicionamiento del Protocolo

DTP **MUST** operar como un protocolo de capa de aplicación sobre los protocolos de transporte existentes, incluidos, entre otros, BLE, RTSP, WebSocket y TCP.

DTP **MUST** interactuar con los protocolos de transporte concretos a través de la capa de abstracción `Transport_Adapter` (véase la Sección 3.4). El núcleo de DTP **MUST NOT** depender de los detalles de implementación de ningún protocolo de transporte específico.

## 1.3 Relación con CAP

DTP **MUST** trabajar en conjunto con el Control Authorization Protocol (CAP) y seguir esta división de responsabilidades:

- **CAP** es responsable de la autorización de conexión, la autenticación de identidad y el intercambio de claves.
- **DTP** es responsable de la transmisión de flujos de datos basada en negociación.

Una implementación de DTP **MUST** comenzar la transmisión de datos solo después de que CAP haya completado la autenticación de identidad y el intercambio de claves. Si CAP no está listo, la implementación de DTP **MUST** rechazar el envío de datos y devolver el error `KEY_NOT_READY` (código de error 2002, véase el Capítulo 9).

## 1.4 Objetivos de Diseño

Una implementación de DTP **MUST** satisfacer los siguientes objetivos de diseño:

| Objetivo | Requisito Normativo |
|----------|---------------------|
| Independencia del Transporte | La lógica central de DTP **MUST** estar desacoplada de cualquier protocolo de transporte específico |
| Negociación Primero | Toda transmisión de datos **MUST** basarse en un Agreement establecido |
| Soberanía de Datos | El Master **MUST** mantener la autoridad final de decisión sobre los flujos de datos |
| Cifrado de Extremo a Extremo | El Payload **MUST** transmitirse en forma cifrada |
| Preservación del Contexto | Cada Fragment **MUST** llevar metadatos contextuales estructurados |
| Recuperabilidad | La implementación **MUST** soportar la reanudación basada en números de secuencia |

## 1.5 Modelo Maestro-Esclavo

DTP **MUST** distinguir entre los siguientes dos roles:

- **Master**: Un usuario persona natural o Fay (iFay / coFay). **MUST** mantener el derecho a iniciar la recolección de datos y el derecho a decidir sobre la inyección de datos.
- **Slave**: Un terminal de software o hardware. **MAY** únicamente iniciar solicitudes de inyección de datos; **MUST NOT** iniciar solicitudes de recolección de datos.

Una implementación de DTP **MUST** hacer cumplir las siguientes restricciones:

1. En cualquier momento, un único Slave **MUST NOT** estar controlado por más de un Fay (Controller).
2. Un Controller **MAY** invitar a otros Fays a actuar como Observers.
3. Los Observers **MUST NOT** iniciar solicitudes ni modificar Agreements; **MUST** únicamente recibir copias de solo lectura de los flujos de datos.
4. Cuando el Master inicia una solicitud de recolección de datos, el Slave **SHOULD** aceptarla. El Slave **MAY** rechazar, pero el rechazo **MUST** ir acompañado de una razón relacionada con cumplimiento (véase la Sección 5.3.1).
5. Cuando el Slave inicia una solicitud de inyección de datos, el Master **MUST** mantener plena autoridad de decisión y **MAY** aceptar, rechazar o proponer una alternativa.

## 1.6 Niveles de Conformidad

Una implementación **MUST** declarar su nivel de conformidad:

- **Conformidad Plena**: La implementación satisface todas las reglas **MUST** y **SHOULD**.
- **Conformidad Central**: La implementación satisface todas las reglas **MUST** pero **MAY** no satisfacer algunas reglas **SHOULD**.
- **No Conformidad**: La implementación no satisface alguna regla **MUST**. Una implementación que afirme ser DTP **MUST NOT** estar en este estado.

## 1.7 Gestión de Versiones y Compatibilidad (Version Management & Compatibility)

> **Esta sección es Normativa.** Esta sección es la **Única Fuente de Verdad (Single Source of Truth)** para las reglas de gestión de versiones de DTP. Dondequiera que se haga referencia a reglas de versión en otras partes del cuerpo (incluidos el Capítulo 10 «Gestión de Versiones» y el registro de cambios, si lo hubiera), dichas referencias **MUST** remitirse a esta sección y **MUST NOT** redefinir las reglas establecidas aquí.

Esta sección se organiza en el siguiente orden fijo: tres ejes de versión ortogonales (§1.7.1) → semántica de `MAJOR.MINOR` y clasificación de cambios (§1.7.2) → reglas de negociación de versiones y compatibilidad (§1.7.3) → edición editorial y erratas (§1.7.4) → tabla de ubicación del número de versión y lista de verificación para implementadores (§1.7.5).

### 1.7.1 Tres ejes de versión ortogonales

La información de versión de DTP **MUST** gestionarse a lo largo de tres ejes **mutuamente ortogonales**. Estos tres ejes **MUST NOT** fusionarse en un único número de versión; cada eje tiene su propio espacio de valores, ubicación de registro y regla de progresión, y un cambio en un eje **MUST NOT** forzar un cambio en los otros dos (la definición observable de ortogonalidad).

| Eje | Significado | Espacio de valores | Ubicación de registro | ¿Entra en el formato de cable? |
|-----|-------------|---------------------|------------------------|--------------------------------|
| Versión del protocolo (Protocol Version) | Contrato de interoperabilidad | `dtp/MAJOR.MINOR` (dos niveles, **sin PATCH**; tanto `MAJOR` como `MINOR` son enteros no negativos) | Campo `protocolVersion` del header del marco, nombre del archivo schema | **Sí** |
| Estado del documento (Document Status) | Ciclo de vida del documento | Enumeración `Draft / Final / Deprecated / Obsolete` (exactamente un valor en cualquier momento) | Campo `status` del front matter | **No** |
| Edición editorial (Editorial Edition) | Erratas y aclaraciones | `YYYY-MM-DD` anclado a la fecha de publicación (p. ej. `2025-10-25`) | Campo `date` del front matter y nombre del directorio de publicación | **No** |

Restricciones clave sobre el estado del documento y los directorios (las convenciones completas de directorios y el flujo de gobernanza de finalización están en el Capítulo 10, anclados a las reglas de esta sección):

- El estado del documento **MUST** ser un marcador del front matter y **MUST NOT** codificarse en una ruta de archivo o nombre de directorio.
- Que una edición publicada sea actualmente `Final`, `Deprecated` u `Obsolete` se determina **únicamente** por el campo `status` de sus archivos y **MUST NOT** inferirse del nombre del directorio.

### 1.7.2 Semántica de `MAJOR.MINOR` y clasificación de cambios

#### MAJOR (versión mayor)

`MAJOR` se utiliza para cambios que **rompen la interoperabilidad**. Criterio de decisión: si un peer que implementa estrictamente la versión antigua `MAJOR.0` **rechazaría o malinterpretaría** un mensaje nuevo, el cambio rompe la interoperabilidad. Tales cambios incluyen, entre otros:

- Cambiar la semántica de un campo schema autorizado;
- Eliminar un mensaje o un código de error;
- Redefinir un código de error;
- Cambiar un estado absorbente (absorbing state) de la máquina de estados.

WHEN ocurre un cambio que rompe la interoperabilidad, `MAJOR` **MUST** incrementarse en 1 y `MINOR` **MUST** reiniciarse a 0.

La interoperabilidad **NO** está garantizada entre distintas versiones `MAJOR`.

#### MINOR (versión menor)

`MINOR` se utiliza para adiciones **compatibles hacia atrás**, incluyendo, entre otros: añadir campos opcionales, añadir mensajes, añadir códigos de error, añadir parámetros, añadir atributos. Criterio de decisión: un peer que implementa estrictamente la versión antigua `MAJOR.0` no rechazaría ni malinterpretaría el mensaje nuevo.

WHEN ocurre una adición compatible hacia atrás, `MINOR` **MUST** incrementarse en 1 y `MAJOR` **MUST** permanecer sin cambios. Dentro del mismo `MAJOR`, un `MINOR` superior **MUST** ser compatible hacia atrás hasta `MAJOR.0`.

#### Regla de clasificación de cambios (ordenada, decidible)

Para cualquier cambio, su ubicación **MUST** clasificarse en el siguiente orden, produciendo un nivel único:

1. Si un peer que implementa estrictamente la versión antigua `MAJOR.0` **rechazaría o malinterpretaría** el mensaje nuevo → clasificar como **MAJOR**;
2. De lo contrario, si el cambio añade **contenido visible en el formato de cable** (header/mensaje/código de error/parámetro u otra estructura visible en el cable) → clasificar como **MINOR**;
3. De lo contrario (cambio solo de texto, sin cambio en el formato de cable) → **NO** cambiar la versión del protocolo; usar una edición editorial en su lugar (véase §1.7.4).
4. Si un cambio coincide con varios niveles simultáneamente, **MUST** tomarse el nivel superior.

### 1.7.3 Reglas de negociación de versiones y compatibilidad

Esta subsección es **Normativa**.

#### Restricciones del formato de cable

- **Únicamente** el `MAJOR.MINOR` de la versión del protocolo entra en el formato de cable (es decir, el campo `protocolVersion` del header del marco y el nombre del archivo schema).
- La versión del protocolo **MUST** entrar siempre en el formato de cable; una implementación **MUST NOT** proporcionar ninguna configuración que excluya la versión del protocolo del formato de cable.
- El estado del documento y la edición editorial **MUST NOT** entrar en el formato de cable. Una implementación **MUST NOT** cambiar el comportamiento de procesamiento de mensajes en función del estado del documento o de la edición editorial —es decir, dos mensajes idénticos en el formato de cable **MUST NOT** producir resultados de procesamiento distintos debido a valores distintos en estos dos ejes.
- IF un mensaje recibido carece de información de versión del protocolo en el formato de cable (el header carece de `protocolVersion`, o carece del subcampo `major` / `minor`, o su valor no es un entero no negativo), THEN la implementación **MUST** rechazar el mensaje con un error de protocolo y **MUST NOT** procesarlo bajo una versión por defecto o inferida.

#### Reglas de negociación

- WHEN se realiza un handshake o bootstrap, ambas partes **MUST** declarar cada una su conjunto de versiones de protocolo soportadas, que **MUST NOT** estar vacío.
- La selección de versión **MUST** seguir: primero tomar el `MAJOR` más alto soportado en común por ambas, luego tomar el `MINOR` más alto soportado en común bajo ese `MAJOR`.
- La parte con el `MINOR` superior **MUST** poder servir al peer de `MINOR` inferior: **MUST** procesar los mensajes del peer con la semántica de la versión inferior declarada por el peer y **MUST NOT** rechazar meramente porque el `MINOR` del peer sea inferior.
- IF ambas partes no comparten ningún `MAJOR` común, THEN la implementación **MUST** rechazar directamente con un error de protocolo y **MUST NOT** realizar una degradación de mejor esfuerzo (best-effort). (La vinculación concreta de este error es `VERSION_INCOMPATIBLE` / 7001 en el Capítulo 10.)
- WHEN se recibe un mensaje con el mismo `MAJOR` pero un `MINOR` superior, la implementación **MUST** interpretar los campos conocidos con la semántica de su propio `MINOR` más alto e **ignorar** los campos opcionales no reconocidos; **MUST NOT** rechazar, descartar ni generar un error.

#### Credenciales y suites de cifrado

- WHEN se realiza una actualización de versión continua (rolling), la implementación **MUST** mantener válidas las credenciales o tokens existentes y no caducados (credentials / tokens) y **MUST NOT** invalidarlos meramente por el cambio de versión.
- WHERE el protocolo ya dispone de un mecanismo de negociación de suite de cifrado (cipher-suite), la negociación de versión **MUST** reutilizar el mismo enfoque (cada una declara, se toma el más alto común).

> La secuencia de negociación (Hello / Hello_Ack) y el mecanismo «una sola versión dentro de una sesión, sin cambio a mitad de sesión» están en el Capítulo 10.

### 1.7.4 Edición editorial y erratas

Las restricciones de esta subsección son restricciones de gobernanza **No normativas**; sin embargo, la regla «MUST NOT disfrazar como una actualización» es vinculante para la corrección del número de versión del protocolo.

- WHEN se realizan erratas de texto puro tras la finalización (corregir erratas, añadir ejemplos, aclarar redacción, arreglar enlaces), el número de versión del protocolo (`MAJOR.MINOR`) **MUST** permanecer sin cambios; las erratas **MUST** ser portadas por un **nuevo directorio de fecha de publicación**, y los directorios publicados existentes **MUST** permanecer congelados de modo que las referencias y enlaces antiguos **MUST NOT** romperse.
- Una edición editorial **SHOULD** registrarse bajo una categoría `Editorial` en el registro de cambios (si lo hay); el front matter **MUST** marcar su edición con los campos `edition` / `date`.
- Una edición editorial **únicamente** permite cambios no normativos y **MUST NOT** tocar la semántica del formato de cable, las declaraciones normativas, los códigos de error, la máquina de estados ni el comportamiento de interoperabilidad.
- **Restricción dura**: IF una modificación toca la semántica del formato de cable, THEN **MUST** incrementar `MINOR` o `MAJOR` según §1.7.2 y **MUST NOT** disfrazarse como una publicación de erratas (edición editorial).

### 1.7.5 Tabla de ubicación del número de versión y lista de verificación para implementadores

#### Tabla de ubicación

| Punto de ubicación | Qué se coloca | Restricción normativa |
|--------------------|---------------|------------------------|
| Campo `protocolVersion` del sobre de cable | `MAJOR.MINOR` | Lleva **únicamente** `MAJOR.MINOR`, ningún otro nivel |
| Nombre del archivo schema | Sigue a `MAJOR.MINOR` | **MUST NOT** renombrarse con la edición editorial (mantiene estables las referencias) |
| content-type | `application/dtp` | Identifica la familia del protocolo; su parámetro `version=` es **únicamente** una conveniencia de enrutamiento de gateway y **NO** es semántica del formato de cable |
| `status` / `date` del front matter | Marcadores de gobernanza del documento | **NO** entran en el formato de cable |
| git tag | `dtp-v<MAJOR.MINOR>-<estado>` | El tag **MUST** cubrir cuerpo + vectores de prueba + schema juntos |

#### Lista de verificación para implementadores (lectura obligatoria)

- Juzgar la interoperabilidad **únicamente** por la versión del protocolo (`MAJOR.MINOR`); **MUST NOT** depender del estado del documento ni de la edición editorial.
- El mismo `MAJOR` **MUST** ser compatible hacia atrás hasta `MAJOR.0`.
- **MUST NOT** tratar las erratas (ediciones editoriales) como actualizaciones del protocolo.
- **MUST NOT** depender del nombre del archivo schema para codificar la edición editorial.
- Durante `Draft` **NO** hay promesa de compatibilidad.

> Las convenciones completas de directorio y estado, y las acciones estándar de finalización (Draft → Final), están en el Capítulo 10 «Evolución del Protocolo y Gobernanza»; el formato del git tag, la enumeración de estados y la definición de edición editorial referidos allí **MUST** anclarse a esta sección (§1.7).
