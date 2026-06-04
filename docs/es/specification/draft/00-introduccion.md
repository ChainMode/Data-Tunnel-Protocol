# Especificación del Data Tunnel Protocol (DTP)

**Versión**: Borrador
**Versión Objetivo**: 2025-10-25
**Estado**: Borrador, en espera de revisión
**Capa del Protocolo**: Capa de Aplicación

## Introducción

Esta especificación define el formato de cable, la máquina de estados, el mecanismo de negociación, los requisitos de cifrado, el manejo de errores y las reglas de gestión de versiones del Data Tunnel Protocol (DTP). DTP es el protocolo de capa de aplicación utilizado en el ecosistema iFay para la recolección e inyección bidireccional de datos entre dispositivos terminales y Fay.

Esta especificación es el documento **normativo** de DTP. Cualquier implementación que se ajuste a esta especificación debería ser capaz de interoperar con otras implementaciones conformes.

## Convención de Palabras Clave

Las palabras clave **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY** y **OPTIONAL** en este documento deben interpretarse como se describe en RFC 2119 y RFC 8174, y solo tienen significado normativo cuando aparecen en forma **negrita**.

## Estructura del Documento

Esta especificación consta de 10 capítulos:

| Capítulo | Título | Alcance |
|----------|--------|---------|
| Capítulo 1 | Visión General y Posicionamiento | Rol de DTP, objetivos de diseño, relación con otros protocolos, y gestión de versiones y compatibilidad (§1.7, normativa) |
| Capítulo 2 | Terminología y Definiciones | Definiciones normativas de terminología |
| Capítulo 3 | Arquitectura del Protocolo | Estratificación, componentes y máquina de estados del protocolo |
| Capítulo 4 | Estructura del Marco Lógico | Formato binario del header y del payload |
| Capítulo 5 | Mecanismo de Negociación | Negociación, ajuste y terminación de Agreement |
| Capítulo 6 | Transmisión de Datos | Flujos de recolección e inyección de datos |
| Capítulo 7 | Seguridad y Cifrado | Requisitos de cifrado de extremo a extremo |
| Capítulo 8 | Fiabilidad | Reanudación, acuse de recibo y gestión de sesiones |
| Capítulo 9 | Manejo de Errores | Códigos de error y mecanismo de notificación |
| Capítulo 10 | Gestión de Versiones | Mecanismos operativos y flujo de gobernanza de la gestión de versiones (política autorizada en el Capítulo 1 §1.7) |

## Conformidad

Cualquier entidad que afirme implementar DTP (en adelante, "implementación") **MUST** satisfacer los siguientes requisitos de conformidad:

1. La implementación **MUST** soportar plenamente todas las reglas **MUST** definidas en esta especificación.
2. La implementación **SHOULD** soportar todas las reglas **SHOULD** definidas en esta especificación. Si no las soporta, la implementación **MUST** declarar explícitamente la desviación en su documentación.
3. La implementación **MAY** elegir si soporta las reglas **MAY**.
4. La implementación **MUST NOT** introducir extensiones que entren en conflicto con esta especificación. Cualquier extensión **MUST** implementarse a través de los mecanismos de extensión definidos en esta especificación (véanse los campos personalizados del Capítulo 4 y las extensiones de parámetros de Agreement del Capítulo 5).

## Referencias Normativas

- **RFC 2119** — Key words for use in RFCs to Indicate Requirement Levels
- **RFC 8174** — Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words
- **RFC 4122** — A Universally Unique IDentifier (UUID) URN Namespace (utilizado para Fragment_ID, Agreement_ID, Session_ID)
- **RFC 3339** — Date and Time on the Internet: Timestamps (formato de marca de tiempo UTC)
- **Especificación CAP** — Control Authorization Protocol; DTP depende de CAP para la autenticación de identidad y el intercambio de claves

## Documentos Relacionados

- **DTP Blueprint** (`docs/es/blueprint/`): Material introductorio no normativo de DTP, que proporciona la motivación, la justificación de diseño y ejemplos
- **DTP Schema** (`schema/draft/schema.ts`): Definiciones de tipos TypeScript de referencia para DTP
