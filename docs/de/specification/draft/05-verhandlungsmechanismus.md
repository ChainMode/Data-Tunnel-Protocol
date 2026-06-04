# Kapitel 5 Verhandlungsmechanismus

## 5.1 Verhandlungsprinzipien

Eine DTP-Implementierung **MUST** die folgenden Verhandlungsprinzipien durchsetzen:

1. **Verhandlung zuerst**: Vor jeglicher Fragment-Datenübertragung **MUST** bereits ein Agreement im Zustand `active` existieren.
2. **Keine rohe Übertragung**: Eine Implementierung **MUST NOT** Datenübertragung erlauben, die nicht auf einem Agreement beruht.
3. **Bidirektionale Verhandlung**: Der Master **MAY** eine Datenerfassungs-Verhandlung initiieren; der Slave **MAY** eine Dateneinspeisungs-Verhandlung initiieren.
4. **Dynamische Anpassung**: Beide Seiten **MAY** die Parameter eines Agreements anpassen, während es sich im Zustand `active` befindet.
5. **Explizite Beendigung**: Beide Seiten **MAY** ein Agreement explizit beenden. Nach der Beendigung **MUST** die Datenübertragung unter diesem Agreement sofort gestoppt werden.

## 5.2 Verhandlungs-Frame-Typen

Die Verhandlung **MUST** über zwei Frame-Typen durchgeführt werden: Request_Frame und Response_Frame.

### 5.2.1 Request_Frame

Ein Request_Frame **MUST** die folgenden Felder enthalten:

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

| Feld | Normative Anforderung |
|------|------------------------|
| `frameType` | **MUST** das Literal `"request"` sein |
| `requestId` | **MUST** ein eindeutiger Bezeichner der Anfrage sein. **SHOULD** UUID v4 verwenden |
| `requestorRole` | **MUST** `"master"` oder `"slave"` sein und den Initiator der Anfrage angeben |
| `requestType` | **MUST** einer der vier Typen in der untenstehenden Tabelle sein |
| `targetAgreementId` | **MUST** angegeben werden, wenn `requestType` gleich `"adjustment"` oder `"termination"` ist |
| `proposedParams` | **MUST** vollständige AgreementParams bereitstellen (siehe Abschnitt 5.4) |

### 5.2.2 RequestType

| Wert | Semantik | Einschränkung |
|------|----------|---------------|
| `"collection"` | Datenerfassungsanfrage | **MUST** durch `requestorRole = "master"` initiiert werden |
| `"injection"` | Dateneinspeisungsanfrage | **MUST** durch `requestorRole = "slave"` initiiert werden |
| `"adjustment"` | Bestehendes Agreement anpassen | **MUST** `targetAgreementId` angeben; das Ziel-Agreement **MUST** im Zustand `active` sein |
| `"termination"` | Bestehendes Agreement beenden | **MUST** `targetAgreementId` angeben |

Eine Implementierung **MUST** jede Anfrage ablehnen, die die obigen Einschränkungen nicht erfüllt, und den entsprechenden Fehler zurückgeben (siehe Kapitel 9).

### 5.2.3 Response_Frame

Ein Response_Frame **MUST** die folgenden Felder enthalten:

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

| Feld | Normative Anforderung |
|------|------------------------|
| `frameType` | **MUST** das Literal `"response"` sein |
| `requestId` | **MUST** die `requestId` des entsprechenden Request_Frame sein |
| `result` | **MUST** einer der Werte von `NegotiationResult` sein |
| `agreedParams` | **MUST** angegeben werden, wenn `result` gleich `accepted` oder `counter_proposal` ist |
| `agreementId` | **MUST** angegeben werden, wenn `result` gleich `accepted` ist; **MUST** eine neu generierte UUID v4 sein |
| `rejectionReason` | **MUST** angegeben werden, wenn `result` gleich `rejected` ist |

### 5.2.4 NegotiationResult

`NegotiationResult` **MUST** einer der folgenden drei Werte sein:

| Wert | Semantik |
|------|----------|
| `"accepted"` | Anfrage akzeptieren |
| `"rejected"` | Anfrage ablehnen |
| `"counter_proposal"` | Eine Alternative vorschlagen |

Eine Implementierung **MUST NOT** nicht aufgeführte Ergebniswerte zurückgeben.

## 5.3 Verhandlungs-Workflow

### 5.3.1 Datenerfassungs-Verhandlung (Master-initiiert)

Die Datenerfassungs-Verhandlung **MUST** diesem Workflow folgen:

1. Der Master sendet einen Request_Frame mit `requestType = "collection"` und `requestorRole = "master"`.
2. Der Slave **MUST** mit einem Response_Frame antworten, der eines der folgenden drei Ergebnisse enthält:
   - `"accepted"`: Stimmt der Übertragung gemäß `proposedParams` zu. **MUST** die neu generierte `agreementId` im Response_Frame enthalten.
   - `"rejected"`: Verweigert die Übertragung. **MUST** in `rejectionReason` einen Compliance-bezogenen Grund (z.B. DLP-Richtlinie) angeben. **MUST NOT** aus nicht-Compliance-bezogenen Gründen verweigern.
   - `"counter_proposal"`: Schlägt alternative Parameter vor. **MUST** die geänderten Parameter in `agreedParams` bereitstellen.
3. Wenn der Slave mit `counter_proposal` antwortet, **MAY** der Master einen neuen Request_Frame senden, um anzunehmen, abzulehnen oder weiter zu verhandeln.
4. Der Master **MUST** das Antwortergebnis des Slaves für jede Datenerfassungsanfrage dauerhaft aufzeichnen.

### 5.3.2 Dateneinspeisungs-Verhandlung (Slave-initiiert)

Die Dateneinspeisungs-Verhandlung **MUST** diesem Workflow folgen:

1. Der Slave sendet einen Request_Frame mit `requestType = "injection"` und `requestorRole = "slave"`.
2. Der Master **MUST** mit einem Response_Frame antworten, der eines der folgenden drei Ergebnisse enthält:
   - `"accepted"`: Stimmt der Datenbereitstellung zu. **MUST** den gefilterten Datenumfang (minimierter Datensatz) in `agreedParams` beschreiben. **MUST** die neu generierte `agreementId` im Response_Frame enthalten.
   - `"rejected"`: Verweigert die Datenbereitstellung. **SHOULD** den Grund in `rejectionReason` angeben.
   - `"counter_proposal"`: Stellt Daten in einem anderen Umfang oder Format bereit. **MUST** die Alternative in `agreedParams` beschreiben.
3. Der Master **MUST** in Entscheidungen zur Dateneinspeisung die volle Entscheidungsgewalt besitzen und **MUST NOT** zur Annahme der Anfrage gezwungen werden.

### 5.3.3 Verhandlungs-Timeout

Eine Implementierung **MUST** einen Timeout-Schwellenwert für Request_Frame setzen. Wenn der Response_Frame des Gegenübers nicht innerhalb des Schwellenwerts empfangen wird:

1. Der Anfragende **SHOULD** den Request_Frame erneut senden; die Anzahl der Wiederholungen **MUST NOT** die implementierungskonfigurierte Obergrenze überschreiten.
2. Nach Erreichen der Wiederholungs-Obergrenze **MUST** der Anfragende die Verhandlung beenden und die Anwendung der oberen Schicht über den Fehler `AGREEMENT_NEGOTIATION_FAILED` (3003) benachrichtigen.

## 5.4 AgreementParams

AgreementParams **MUST** die folgenden Felder enthalten:

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

| Feld | Typ | Normative Anforderung |
|------|-----|------------------------|
| `dataType` | `string` | **MUST** nicht-leer sein. Identifiziert den Datentyp |
| `dataRange` | `string` | **MUST** nicht-leer sein. Beschreibt den Datenumfang |
| `transferMode` | `TransferMode` | **MUST** einer der drei Werte in der untenstehenden Tabelle sein |
| `frequency` | `number \| null` | In Hz. **MUST** null sein, wenn `transferMode = "one_time"`; **MUST** für andere Modi eine positive Zahl sein |
| `validityPeriod` | `number` | In Millisekunden. **MUST** eine positive Ganzzahl sein |
| `priority` | `Priority` | **MUST** einer der vier Werte in der untenstehenden Tabelle sein |

### 5.4.1 TransferMode

| Wert | Semantik |
|------|----------|
| `"one_time"` | Einmalige Übertragung. Das Agreement **SHOULD** sich nach Abschluss der Übertragung automatisch beenden |
| `"periodic"` | Periodische Übertragung. **MUST** `frequency` setzen |
| `"streaming"` | Streaming-Übertragung. **MUST** `frequency` setzen |

### 5.4.2 Priority

| Wert | Semantik |
|------|----------|
| `"low"` | Niedrige Priorität |
| `"normal"` | Normale Priorität (Standard) |
| `"high"` | Hohe Priorität |
| `"critical"` | Kritische Priorität |

Eine Implementierung **SHOULD** Ressourcenkonflikte zwischen mehreren Agreements gemäß `priority` einplanen.

## 5.5 Agreement-Lebenszyklus

### 5.5.1 Zustandsdefinitionen

`AgreementStatus` **MUST** einer der folgenden vier Werte sein:

| Zustand | Semantik |
|---------|----------|
| `"negotiating"` | Verhandlung läuft |
| `"active"` | Agreement in Kraft; Daten werden übertragen |
| `"suspended"` | Verbindung unterbrochen; Agreement suspendiert |
| `"terminated"` | Agreement beendet |

### 5.5.2 Zustandsübergänge

Der Agreement-Zustand **MUST** den folgenden Übergangsregeln entsprechen:

| Aktueller Zustand | Auslösendes Ereignis | Zielzustand |
|-------------------|---------------------|-------------|
| (keiner) | Request_Frame ausgegeben | `negotiating` |
| `negotiating` | Response_Frame liefert `accepted` | `active` |
| `negotiating` | Response_Frame liefert `rejected` | (beendet) |
| `active` | Zugrunde liegende Verbindung getrennt | `suspended` |
| `active` | `termination`-Request_Frame empfangen | `terminated` |
| `active` | `validityPeriod` abgelaufen | `terminated` |
| `suspended` | Verbindung wiederhergestellt und CAP-Reverifikation bestanden | `active` |
| `suspended` | Persistierungs-Timeout | `terminated` |
| `terminated` | (Endzustand) | (keiner) |

### 5.5.3 Auto-Beendigung von Einmal-Agreements

Wenn `transferMode = "one_time"` ist und die Datenübertragung abgeschlossen ist:

1. Der Sender **MUST** das Agreement nach dem letzten Fragment beenden, indem er einen Request_Frame mit `requestType = "termination"` sendet.
2. Der Empfänger **MUST** den Agreement-Zustand auf `terminated` setzen, nachdem er alle Fragments empfangen und bestätigt hat.

## 5.6 Mehrfache parallele Agreements

Eine DTP-Implementierung **MUST** unterstützen, dass innerhalb einer einzelnen Session mehrere Agreements gleichzeitig im Zustand `active` gehalten werden.

Die Implementierung **MUST** Folgendes erfüllen:

1. Jedes Fragment ist über seine Agreement_ID mit einem bestimmten Agreement verknüpft.
2. Fragments, die zu verschiedenen Agreements gehören, **MAY** im Übertragungsstrom verschachtelt werden.
3. Die tatsächliche Übertragungsmethode für mehrere Agreements (seriell oder parallel) **DEPENDS** von den Fähigkeiten des zugrunde liegenden Transport_Adapters.
4. Die Implementierung **MUST NOT** die maximale Anzahl aktiver Agreements in einer einzelnen Session unter 16 begrenzen. **SHOULD** eine beliebige Anzahl unterstützen.

## 5.7 Verhandlungseinschränkungen für Observer

Die Observer-Rolle **MUST** Folgendes erfüllen:

1. **MUST NOT** einen Request_Frame senden. Wenn ein Observer versucht, einen zu senden, **MUST** die DTP_Engine die Operation ablehnen und den Fehler `OBSERVER_WRITE_DENIED` (8002) zurückgeben.
2. **MUST NOT** irgendeine Entscheidungsgewalt über Response_Frame erhalten.
3. **MAY** schreibgeschützte Kopien von Daten-Frames empfangen.
4. **MUST** beim Beitritt als Observer explizit vom Controller autorisiert werden.
