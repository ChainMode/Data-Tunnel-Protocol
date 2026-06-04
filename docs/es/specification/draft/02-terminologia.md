# Capítulo 2 Terminología y Definiciones

Este capítulo define todos los términos normativos utilizados en esta especificación. Cada término que tiene significado normativo se muestra en negrita en su primera aparición.

## 2.1 Términos de Roles

**Fay**
: Término general para un agente de IA antropomorfizado, que incluye iFay y coFay.

**iFay** (Individual Fay)
: Un avatar personal de IA vinculado a una persona natural específica (el Human Prime). **MUST** estar en correspondencia uno a uno con el Human Prime.

**coFay** (Common Fay)
: Una IA de rol común, similar a un Agent, que **MAY** servir a múltiples usuarios.

**Human Prime**
: La persona natural a la que está vinculada un iFay. El propietario último de la soberanía de los datos.

**FayGer**
: El contenedor / entorno de ejecución de un Fay (análogo a Docker / JRE). **MUST** tratarse como un "espacio público" no confiable y **MUST NOT** acceder a datos en texto plano bajo ninguna circunstancia.

## 2.2 Términos de Roles del Protocolo

**Master**
: La parte controladora en el protocolo DTP. **MUST** ser un Fay (iFay o coFay). El receptor en el escenario de recolección de datos y el emisor en el escenario de inyección de datos.

**Slave**
: La parte controlada en el protocolo DTP. **MUST** ser un terminal de software o hardware. El emisor en el escenario de recolección de datos y el receptor en el escenario de inyección de datos.

**Controller**
: El Fay que actualmente "habita" un terminal. **MUST** mantener permisos completos de lectura/escritura. En cualquier momento dado, un Slave **MUST NOT** tener más de un Controller.

**Observer**
: Un Fay invitado o autorizado por el Controller. **MAY** mantener únicamente permisos de solo lectura. **MUST NOT** iniciar solicitudes ni modificar Agreements.

## 2.3 Términos de Transmisión de Datos

**Data Collection** (Recolección de Datos)
: La dirección del flujo de datos desde un terminal (Slave) hacia Fay (Master). **MUST** utilizarse para persistir los datos producidos por el terminal en el Personal Data Heap.

**Data Injection** (Inyección de Datos)
: La dirección del flujo de datos desde Fay (Master) hacia un terminal (Slave). **MUST** utilizarse para proporcionar conjuntos de datos filtrados y minimizados a las aplicaciones del terminal.

**Personal Data Heap**
: El módulo privado de gestión de datos de un iFay. **MUST** ser accesible únicamente desde el interior del iFay.

## 2.4 Términos de Estructura del Protocolo

**Logical_Frame**
: La estructura de marco de capa de aplicación de DTP. **MUST** consistir en dos partes: Header y Payload (véase el Capítulo 4).

**Fragment**
: La unidad de datos en DTP. **MUST** llevar un identificador globalmente único y una marca de tiempo de origen, y **MUST** estar asociado con un Agreement.

**Agreement**
: El contrato de transmisión de datos negociado y alcanzado entre el Master y el Slave. **MUST** establecerse antes de cualquier transmisión de datos. La transmisión de datos sin un Agreement **MUST NOT** existir.

**Session**
: Un ciclo de comunicación DTP completo. **MUST** establecerse después de que la autenticación de CAP se haya completado, y **MUST** llevar un Session_ID único.

## 2.5 Términos de Identificadores

**Fragment_ID**
: El identificador globalmente único de un Fragment. **MUST** ser un UUID v4 según lo definido por RFC 4122.

**Agreement_ID**
: El identificador globalmente único de un Agreement. **MUST** ser un UUID v4 según lo definido por RFC 4122.

**Session_ID**
: El identificador globalmente único de una Session. **MUST** ser un UUID v4 según lo definido por RFC 4122.

**Sequence_Number**
: El número de secuencia de transmisión. **MUST** ser un entero no negativo monótonamente creciente. **MUST** mantenerse de forma independiente para cada dirección de transmisión dentro de una única Session.

**Origin_Timestamp**
: El instante en que los datos fueron realmente producidos en el origen. **MUST** utilizar la zona horaria UTC. **MUST** llevar precisión de milisegundos.

## 2.6 Términos de Mecanismos del Protocolo

**Negotiation** (Negociación)
: El proceso por el cual el Master y el Slave alcanzan consenso sobre los parámetros de transmisión de datos. **MUST** llevarse a cabo a través de Request_Frame y Response_Frame.

**Agreement Lifecycle** (Ciclo de Vida del Agreement)
: La secuencia completa de estados de un Agreement desde su creación por negociación hasta su terminación. **MUST** comprender los cuatro estados `negotiating`, `active`, `suspended` y `terminated`.

**Resume** (Reanudación)
: El mecanismo para continuar la transmisión desde el punto de interrupción tras una interrupción de la conexión. **MUST** implementarse basado en números de secuencia.

**DAG Dependency** (Dependencia DAG)
: La relación de dependencia de grafo acíclico dirigido entre Fragments. **MUST** declararse explícitamente a través de aristas DAG (DAGEdge).

## 2.7 Términos de Componentes de Software

**DTP_Engine**
: El motor central de procesamiento del protocolo DTP. **MUST** implementar las funciones centrales de codificación/decodificación de marcos, cifrado, negociación y gestión de sesiones.

**DTP_Master**
: La variante de DTP_Engine que se ejecuta en el lado de Fay. **MUST** mantener los permisos del rol Master.

**DTP_Slave**
: La variante de DTP_Engine que se ejecuta en el lado del terminal. **MUST** mantener únicamente los permisos del rol Slave.

**Transport_Adapter**
: La interfaz abstracta para el protocolo de transporte subyacente. **MUST** proporcionar una interfaz unificada de envío/recepción para cada protocolo de transporte soportado.

## 2.8 Términos de Estado

**SessionState**
: El estado actual de una Session. **MUST** ser uno de `idle`, `waiting_for_cap`, `established`, `negotiating`, `transmitting`, `suspended` o `resuming`.

**AgreementStatus**
: El estado actual de un Agreement. **MUST** ser uno de `negotiating`, `active`, `suspended` o `terminated`.

**ConnectionState**
: El estado de la conexión subyacente reportado por el Transport_Adapter. **MUST** ser uno de `connected`, `disconnected` o `error`.
