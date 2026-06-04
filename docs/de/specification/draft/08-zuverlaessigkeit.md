# Kapitel 8 Zuverlässigkeit

## 8.1 Zuverlässigkeitsmodell

Eine DTP-Implementierung **MUST** die folgenden Zuverlässigkeitsgarantien bereitstellen:

1. **Wiederaufnahme**: Nachdem die zugrunde liegende Verbindung unterbrochen wurde, wird die Übertragung wiederaufgenommen; bereits erfolgreich empfangene Daten **MUST NOT** erneut übertragen werden.
2. **Bestätigung**: Der Empfänger **MUST** dem Sender erfolgreich empfangene Fragments bestätigen.
3. **Wiederholung**: Der Sender **MUST** unbestätigte Fragments erneut senden, wenn innerhalb des Timeouts keine Bestätigung empfangen wird.
4. **Sitzungspersistierung**: Wenn die zugrunde liegende Verbindung unterbrochen wird, **MUST** der Sitzungszustand persistiert werden.

## 8.2 Wiederaufnahme-Mechanismus

### 8.2.1 Wiederaufnahme-Protokoll

Die Wiederaufnahme **MUST** auf Basis von Sequenznummern implementiert werden, gemäß diesem Workflow:

```
Sender                                Empfänger
   |                                     |
   |-- Fragment (seq=1) ---------------->|  ✓ empfangen
   |-- Fragment (seq=2) ---------------->|  ✓ empfangen
   |-- Fragment (seq=3) ---------------->|  ✓ empfangen
   |-- Fragment (seq=4) -------- ✗ -----|  Verbindung verloren
   |                                     |
   |        [Verbindung wiederhergestellt]|
   |                                     |
   |<-- ResumeReport (highest=3) --------|
   |                                     |
   |-- Fragment (seq=4) ---------------->|  Wiederaufnahme ab Unterbrechungspunkt
   |-- Fragment (seq=5) ---------------->|
```

### 8.2.2 ResumeReport

Nach der Wiederherstellung der Verbindung **MUST** der Empfänger einen ResumeReport senden, der wie folgt definiert ist:

```typescript
interface ResumeReport {
  collectionHighest: SequenceNumber;
  injectionHighest: SequenceNumber;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `collectionHighest` | **MUST** die höchste vom Empfänger in der Datenerfassungsrichtung erfolgreich empfangene Sequenznummer sein |
| `injectionHighest` | **MUST** die höchste vom Empfänger in der Dateneinspeisungsrichtung erfolgreich empfangene Sequenznummer sein |

Wenn eine Richtung noch kein Fragment empfangen hat, **MUST** das entsprechende Feld -1 oder ein implementierungsdefinierter „nicht empfangen"-Sentinel-Wert sein.

### 8.2.3 Wiederaufnahme-Konsistenz

Nach Empfang eines ResumeReport **MUST** der Sender strikt Folgendes befolgen:

1. **Mit der nächsten Sequenznummer fortfahren**: Übertragung ab `highest + 1` wiederaufnehmen.
2. **Kein doppeltes Senden**: **MUST NOT** ein Fragment mit Sequenznummer `<= highest` erneut senden.
3. **Kein Überspringen**: **MUST NOT** unbestätigte Fragments überspringen (d.h. solche, die nicht im Cache bestätigt sind).

## 8.3 Bestätigungsmechanismus

### 8.3.1 Bestätigungsmethoden

Eine Implementierung **MUST** die Empfangsbestätigung von Fragments bereitstellen. Die Bestätigung **MAY** durch eine der folgenden Methoden implementiert werden:

1. **Expliziter ACK-Steuer-Frame**: Der Empfänger sendet einen ControlFrame mit `controlType = "ack"`, wobei `details` die höchste bestätigte Sequenznummer enthält.
2. **Kumulativer ACK**: In einem Erweiterungsfeld jedes Daten-Frames wird die höchste empfangene Sequenznummer der umgekehrten Richtung mitgeführt (**RECOMMENDED**).
3. **Batch-ACK**: Sende einen ACK alle N empfangenen Fragments (N ist implementierungsdefiniert; **RECOMMENDED** 16).

Die konkrete Bestätigungsmethode **MAY** von der Implementierung gewählt werden, aber Empfänger und Sender **MUST** sich auf die gewählte Methode einigen.

### 8.3.2 Bestätigungs-Timing

Der Empfänger **MUST** Folgendes erfüllen:

1. Erst bestätigen, nachdem das Fragment Entschlüsselung, Agreement-Validierung und DAG-Validierung bestanden hat.
2. **MUST NOT** bestätigen, während der DAG-Zustand `pending` ist (die Bestätigung sollte verzögert werden, bis Abhängigkeiten aufgelöst sind).
3. Die höchste Sequenznummer im ACK **MUST** das Maximum des zusammenhängenden Präfixes der bestätigten Sequenznummermenge sein.

## 8.4 Wiederholungsmechanismus

### 8.4.1 Wiederholungsstrategie

Der Sender **MUST** unter den folgenden Bedingungen erneut senden:

1. Der ACK für eine bestimmte Sequenznummer wird nicht innerhalb des protokollkonfigurierten Wiederholungs-Timeouts empfangen.
2. Beim Empfang eines ResumeReport unbestätigte Fragments erneut senden.

### 8.4.2 Wiederholungskonfiguration

Eine Implementierung **SHOULD** die folgenden konfigurierbaren Parameter bereitstellen:

| Parameter | Standard (**RECOMMENDED**) | Beschreibung |
|-----------|---------------------------|--------------|
| Initiales Wiederholungs-Timeout | 5 Sekunden | Wartezeit für die erste Wiederholung |
| Wiederholungs-Backoff-Faktor | 2 | Timeout verdoppelt sich nach jeder Wiederholung (exponentielles Backoff) |
| Maximale Wiederholungsanzahl | 5 | Bei Überschreitung wird die obere Schicht über den Fehlschlag informiert |
| Maximales Wiederholungs-Timeout | 60 Sekunden | Obergrenze des Wiederholungs-Timeouts |

Eine Implementierung **MUST** einen exponentiellen Backoff-Algorithmus implementieren.

### 8.4.3 Behandlung von Wiederholungsfehlschlägen

Wenn die Wiederholungsanzahl die Obergrenze überschreitet:

1. Der Sender **MUST** die Anwendung der oberen Schicht über den Fehler `RETRANSMISSION_TIMEOUT` (6002) benachrichtigen.
2. Der Sender **SHOULD** eine Sitzungssuspendierung oder -beendigung auslösen (implementierungsdefiniert).
3. Die Implementierung **MUST NOT** unbegrenzt wiederholen.

## 8.5 Cache-Verwaltung

### 8.5.1 Cache für unbestätigte Fragments

Der Sender **MUST** einen Cache für unbestätigte Fragments pflegen, der Folgendes erfüllt:

1. Jedes gesendete, aber noch nicht bestätigte Fragment **MUST** im Cache erhalten bleiben.
2. Nach Empfang einer Bestätigung **MUST** das bestätigte Fragment aus dem Cache entfernt werden.
3. Der Cache **MUST** eine Kapazitätsobergrenze haben (implementierungsdefiniert; **RECOMMENDED** nicht weniger als 1024 Fragments oder 16 MB).

### 8.5.2 Behandlung bei vollem Cache

Wenn der Cache seine Kapazitätsobergrenze erreicht, **MUST** der Sender:

1. Das Senden neuer Fragments pausieren.
2. Die Anwendung der oberen Schicht über den Fehler `BUFFER_FULL` (6001) benachrichtigen.
3. Das Senden wieder aufnehmen, nachdem Cache-Speicher durch Bestätigungen freigegeben wurde.
4. **MUST NOT** Fragments stillschweigend verwerfen.

## 8.6 Sitzungsverwaltung

### 8.6.1 Sitzungsaufbau

Nachdem CAP die Identitätsauthentifizierung und den Schlüsselaustausch abgeschlossen hat, **MUST** die DTP_Engine eine DTP-Session aufbauen:

1. **MUST** eine eindeutige Session_ID (UUID v4) gemäß RFC 4122 generieren.
2. **MUST** die Sitzungs-Datenstruktur initialisieren (siehe Abschnitt 8.6.3).
3. **MUST** den Zustand von `WaitingForCAP` zu `SessionEstablished` übergehen.

### 8.6.2 Pflege des Sitzungszustands

Während einer Session **MUST** die DTP_Engine den bidirektionalen Übertragungszustand pflegen:

```typescript
interface DirectionalTransferState {
  currentSequenceNumber: SequenceNumber;
  highestAcknowledgedSequenceNumber: SequenceNumber;
  unacknowledgedFragmentCache: Map<SequenceNumber, Fragment>;
}
```

Die Implementierung **MUST** für jede Übertragungsrichtung einen unabhängigen DirectionalTransferState pflegen:

| Richtung | Feldname |
|----------|----------|
| Datenerfassung (Endgerät → Fay) | `collectionState` |
| Dateneinspeisung (Fay → Endgerät) | `injectionState` |

### 8.6.3 Sitzungs-Datenstruktur

Die vollständige Sitzungsstruktur **MUST** Folgendes enthalten:

```typescript
interface Session {
  sessionId: SessionID;
  masterIdentity: string;
  slaveIdentity: string;
  state: SessionState;
  activeAgreements: Map<AgreementID, Agreement>;
  collectionState: DirectionalTransferState;
  injectionState: DirectionalTransferState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}
```

### 8.6.4 Sitzungspersistierung

Wenn die zugrunde liegende Transportverbindung getrennt wird, **MUST** die DTP_Engine:

1. Den SessionState sofort von `Transmitting` zu `Suspended` übergehen.
2. Folgendes in nicht-flüchtigen Speicher persistieren:
   - Das vollständige Session-Objekt (einschließlich aller aktiven Agreements)
   - Der bidirektionale DirectionalTransferState
   - Der Cache für unbestätigte Fragments
3. Die Persistierung **MUST** atomar sein (entweder alles erfolgreich oder alles fehlschlagen).

### 8.6.5 Sitzungswiederherstellung

Nachdem die zugrunde liegende Verbindung wiederhergestellt ist, **MUST** die DTP_Engine dem folgenden Wiederherstellungs-Workflow folgen:

1. Auf CAP-Reverifikation warten.
2. Nach erfolgreicher CAP-Verifizierung in den Zustand `Resuming` übergehen.
3. Den Sitzungszustand aus dem persistenten Speicher wiederherstellen.
4. Der Empfänger sendet einen ResumeReport (siehe Abschnitt 8.2.2).
5. Basierend auf dem ResumeReport setzt der Sender die Übertragung ab dem Unterbrechungspunkt fort.
6. Nach Abschluss des Wiederaufnahme-Handshakes zu `Transmitting` übergehen.

Wenn die Wiederherstellung fehlschlägt, **MUST** die DTP_Engine:

1. In den Zustand `Idle` übergehen.
2. Alle zugehörigen Ressourcen freigeben.
3. Die obere Schicht über den Fehler `SESSION_RESTORE_FAILED` (5003) benachrichtigen.

### 8.6.6 Sitzungs-Timeout

Eine Implementierung **MUST** einen Sitzungs-Timeout-Mechanismus implementieren:

1. **MUST** ein Feld `lastActivityAt` pflegen, das die Zeit der letzten Aktivität aufzeichnet.
2. Wenn `now - lastActivityAt > timeoutThreshold`, **MUST** die Session als zeitüberschritten markiert werden.
3. Eine zeitüberschrittene Session **MUST** geschlossen werden und zugehörige Ressourcen **MUST** freigegeben werden.
4. Der Standard `timeoutThreshold` ist **RECOMMENDED** 30 Minuten (1.800.000 ms).

## 8.7 Bidirektionale Unabhängigkeit

Eine Implementierung **MUST** die Unabhängigkeit der beiden Übertragungsrichtungen strikt garantieren:

1. Zustandsänderungen in der Datenerfassungsrichtung **MUST NOT** die Dateneinspeisungsrichtung beeinflussen.
2. Eine Verbindungsanomalie in einer Richtung **MUST NOT** automatisch eine Zustandsänderung in der anderen Richtung auslösen (es sei denn, die zugrunde liegende Verbindung ist vollständig getrennt).
3. Die Sequenznummern einer Richtung **MUST NOT** in den Sequenznummernraum der anderen Richtung eintreten.
4. Der Cache einer Richtung **MUST NOT** das Cache-Kontingent der anderen Richtung verbrauchen.
