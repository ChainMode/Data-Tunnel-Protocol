# Kapitel 2 Terminologie und Definitionen

Dieses Kapitel definiert alle in dieser Spezifikation verwendeten normativen Begriffe. Jeder Begriff mit normativer Bedeutung wird bei seinem ersten Auftreten fett dargestellt.

## 2.1 Rollenbezeichnungen

**Fay**
: Sammelbegriff für einen anthropomorphisierten KI-Agenten, einschließlich iFay und coFay.

**iFay** (Individual Fay)
: Ein persönlicher KI-Avatar, der an eine bestimmte natürliche Person (das Human Prime) gebunden ist. **MUST** in Eins-zu-eins-Entsprechung mit dem Human Prime stehen.

**coFay** (Common Fay)
: Eine KI mit gemeinsamer Rolle, ähnlich einem Agent, die **MAY** mehreren Nutzern dienen.

**Human Prime**
: Die natürliche Person, an die ein iFay gebunden ist. Der letztendliche Eigentümer der Datensouveränität.

**FayGer**
: Die Container-/Laufzeitumgebung eines Fay (analog zu Docker/JRE). **MUST** als nicht vertrauenswürdiger „öffentlicher Raum" behandelt werden und **MUST NOT** unter keinen Umständen auf Klartextdaten zugreifen.

## 2.2 Protokollrollen-Bezeichnungen

**Master**
: Die steuernde Partei im DTP-Protokoll. **MUST** ein Fay (iFay oder coFay) sein. Der Empfänger im Datenerfassungs-Szenario und der Sender im Dateneinspeisungs-Szenario.

**Slave**
: Die gesteuerte Partei im DTP-Protokoll. **MUST** ein Software- oder Hardware-Endgerät sein. Der Sender im Datenerfassungs-Szenario und der Empfänger im Dateneinspeisungs-Szenario.

**Controller**
: Der Fay, der gerade ein Endgerät „verkörpert". **MUST** vollständige Lese-/Schreibberechtigungen besitzen. Zu jedem gegebenen Zeitpunkt **MUST NOT** ein Slave mehr als einen Controller haben.

**Observer**
: Ein vom Controller eingeladener oder autorisierter Fay. **MAY** nur Leseberechtigungen besitzen. **MUST NOT** Anfragen initiieren oder Agreements ändern.

## 2.3 Datenübertragungs-Bezeichnungen

**Datenerfassung**
: Die Datenflussrichtung vom Endgerät (Slave) zu Fay (Master). **MUST** verwendet werden, um vom Endgerät erzeugte Daten in den Personal Data Heap zu persistieren.

**Dateneinspeisung**
: Die Datenflussrichtung von Fay (Master) zum Endgerät (Slave). **MUST** verwendet werden, um Endgeräteanwendungen gefilterte, minimierte Datensätze bereitzustellen.

**Personal Data Heap**
: Das private Datenverwaltungsmodul eines iFay. **MUST** ausschließlich innerhalb des iFay zugänglich sein.

## 2.4 Protokollstruktur-Bezeichnungen

**Logical_Frame**
: Die Anwendungsschicht-Rahmenstruktur von DTP. **MUST** aus zwei Teilen bestehen: Header und Payload (siehe Kapitel 4).

**Fragment**
: Die Dateneinheit in DTP. **MUST** einen global eindeutigen Bezeichner und einen Ursprungszeitstempel tragen und **MUST** mit einem Agreement verknüpft sein.

**Agreement**
: Der zwischen Master und Slave ausgehandelte und vereinbarte Datenübertragungsvertrag. **MUST** vor jeglicher Datenübertragung etabliert sein. Eine Datenübertragung ohne Agreement **MUST NOT** existieren.

**Session**
: Ein vollständiger DTP-Kommunikationszyklus. **MUST** nach Abschluss der CAP-Authentifizierung etabliert werden und **MUST** eine eindeutige Session_ID tragen.

## 2.5 Bezeichnerbegriffe

**Fragment_ID**
: Der global eindeutige Bezeichner eines Fragments. **MUST** eine UUID v4 gemäß RFC 4122 sein.

**Agreement_ID**
: Der global eindeutige Bezeichner eines Agreements. **MUST** eine UUID v4 gemäß RFC 4122 sein.

**Session_ID**
: Der global eindeutige Bezeichner einer Session. **MUST** eine UUID v4 gemäß RFC 4122 sein.

**Sequence_Number**
: Die Übertragungs-Sequenznummer. **MUST** eine monoton steigende, nicht-negative Ganzzahl sein. **MUST** für jede Übertragungsrichtung innerhalb einer einzelnen Session unabhängig verwaltet werden.

**Origin_Timestamp**
: Der Zeitpunkt, an dem die Daten tatsächlich an der Quelle erzeugt wurden. **MUST** die UTC-Zeitzone verwenden. **MUST** Millisekunden-Präzision tragen.

## 2.6 Protokollmechanismus-Bezeichnungen

**Negotiation**
: Der Prozess, durch den Master und Slave einen Konsens über Datenübertragungsparameter erzielen. **MUST** über Request_Frame und Response_Frame durchgeführt werden.

**Agreement Lifecycle**
: Die vollständige Zustandsfolge eines Agreements von der Verhandlungserstellung bis zur Beendigung. **MUST** die vier Zustände `negotiating`, `active`, `suspended` und `terminated` umfassen.

**Resume**
: Der Mechanismus zur Fortsetzung der Übertragung ab dem Unterbrechungspunkt nach einer Verbindungsunterbrechung. **MUST** auf Basis von Sequenznummern implementiert sein.

**DAG Dependency**
: Die gerichtete azyklische Graph-Abhängigkeitsbeziehung zwischen Fragments. **MUST** explizit über DAG-Kanten (DAGEdge) deklariert werden.

## 2.7 Software-Komponentenbezeichnungen

**DTP_Engine**
: Die zentrale Verarbeitungsengine des DTP-Protokolls. **MUST** die Kernfunktionen Frame-Codec, Verschlüsselung, Verhandlung und Sitzungsverwaltung implementieren.

**DTP_Master**
: Die DTP_Engine-Variante, die auf der Fay-Seite läuft. **MUST** Master-Rollenberechtigungen besitzen.

**DTP_Slave**
: Die DTP_Engine-Variante, die auf der Endgeräteseite läuft. **MUST** ausschließlich Slave-Rollenberechtigungen besitzen.

**Transport_Adapter**
: Die abstrakte Schnittstelle für das zugrunde liegende Transportprotokoll. **MUST** für jedes unterstützte Transportprotokoll eine einheitliche Sende-/Empfangsschnittstelle bereitstellen.

## 2.8 Zustandsbegriffe

**SessionState**
: Der aktuelle Zustand einer Session. **MUST** einer der Werte `idle`, `waiting_for_cap`, `established`, `negotiating`, `transmitting`, `suspended` oder `resuming` sein.

**AgreementStatus**
: Der aktuelle Zustand eines Agreements. **MUST** einer der Werte `negotiating`, `active`, `suspended` oder `terminated` sein.

**ConnectionState**
: Der vom Transport_Adapter gemeldete Zustand der zugrunde liegenden Verbindung. **MUST** einer der Werte `connected`, `disconnected` oder `error` sein.
