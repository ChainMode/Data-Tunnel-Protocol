# Chapter 2 Terminology and Definitions

This chapter defines all normative terms used in this specification. Each term carrying normative meaning is shown in bold at its first occurrence.

## 2.1 Role Terms

**Fay**
: A general term for an anthropomorphized AI agent, including iFay and coFay.

**iFay** (Individual Fay)
: A personal AI avatar bound to a specific natural person (the Human Prime). **MUST** be in one-to-one correspondence with the Human Prime.

**coFay** (Common Fay)
: A common-role AI, similar to an Agent, that **MAY** serve multiple users.

**Human Prime**
: The natural person to whom an iFay is bound. The ultimate owner of data sovereignty.

**FayGer**
: The container/runtime environment of a Fay (analogous to Docker/JRE). **MUST** be treated as an untrusted "public space" and **MUST NOT** access plaintext data under any circumstances.

## 2.2 Protocol Role Terms

**Master**
: The controlling party in the DTP protocol. **MUST** be a Fay (iFay or coFay). The receiver in the data collection scenario, and the sender in the data injection scenario.

**Slave**
: The controlled party in the DTP protocol. **MUST** be a software or hardware terminal. The sender in the data collection scenario, and the receiver in the data injection scenario.

**Controller**
: The Fay currently "embodying" a terminal. **MUST** hold full read/write permissions. At any given moment, a Slave **MUST NOT** have more than one Controller.

**Observer**
: A Fay invited or authorized by the Controller. **MAY** only hold read-only permissions. **MUST NOT** initiate requests or modify Agreements.

## 2.3 Data Transmission Terms

**Data Collection**
: The data flow direction from a terminal (Slave) to Fay (Master). **MUST** be used to persist data produced by the terminal into the Personal Data Heap.

**Data Injection**
: The data flow direction from Fay (Master) to a terminal (Slave). **MUST** be used to provide filtered, minimized data sets to terminal applications.

**Personal Data Heap**
: The private data management module of an iFay. **MUST** be accessible only inside the iFay.

## 2.4 Protocol Structure Terms

**Logical_Frame**
: The application-layer frame structure of DTP. **MUST** consist of two parts: Header and Payload (see Chapter 4).

**Fragment**
: The data unit in DTP. **MUST** carry a globally unique identifier and an origin timestamp, and **MUST** be associated with an Agreement.

**Agreement**
: The data transmission contract negotiated and reached between the Master and Slave. **MUST** be established before any data transmission. Data transmission without an Agreement **MUST NOT** exist.

**Session**
: A complete DTP communication cycle. **MUST** be established after CAP authentication completes, and **MUST** carry a unique Session_ID.

## 2.5 Identifier Terms

**Fragment_ID**
: The globally unique identifier of a Fragment. **MUST** be a UUID v4 as defined by RFC 4122.

**Agreement_ID**
: The globally unique identifier of an Agreement. **MUST** be a UUID v4 as defined by RFC 4122.

**Session_ID**
: The globally unique identifier of a Session. **MUST** be a UUID v4 as defined by RFC 4122.

**Sequence_Number**
: The transmission sequence number. **MUST** be a monotonically increasing non-negative integer. **MUST** be maintained independently for each transmission direction within a single Session.

**Origin_Timestamp**
: The instant at which the data was actually produced at the source. **MUST** use the UTC time zone. **MUST** carry millisecond precision.

## 2.6 Protocol Mechanism Terms

**Negotiation**
: The process by which the Master and Slave reach consensus on data transmission parameters. **MUST** be carried out via Request_Frame and Response_Frame.

**Agreement Lifecycle**
: The full state sequence of an Agreement from negotiation creation to termination. **MUST** comprise the four states `negotiating`, `active`, `suspended`, and `terminated`.

**Resume**
: The mechanism for continuing transmission from the breakpoint after a connection interruption. **MUST** be implemented based on sequence numbers.

**DAG Dependency**
: The directed acyclic graph dependency relationship between Fragments. **MUST** be declared explicitly through DAG edges (DAGEdge).

## 2.7 Software Component Terms

**DTP_Engine**
: The core processing engine of the DTP protocol. **MUST** implement the core functions of frame codec, encryption, negotiation, and session management.

**DTP_Master**
: The DTP_Engine variant running on the Fay side. **MUST** hold Master role permissions.

**DTP_Slave**
: The DTP_Engine variant running on the terminal side. **MUST** hold only Slave role permissions.

**Transport_Adapter**
: The abstract interface for the underlying transport protocol. **MUST** provide a unified send/receive interface for each supported transport protocol.

## 2.8 State Terms

**SessionState**
: The current state of a Session. **MUST** be one of `idle`, `waiting_for_cap`, `established`, `negotiating`, `transmitting`, `suspended`, or `resuming`.

**AgreementStatus**
: The current state of an Agreement. **MUST** be one of `negotiating`, `active`, `suspended`, or `terminated`.

**ConnectionState**
: The underlying connection state reported by the Transport_Adapter. **MUST** be one of `connected`, `disconnected`, or `error`.
