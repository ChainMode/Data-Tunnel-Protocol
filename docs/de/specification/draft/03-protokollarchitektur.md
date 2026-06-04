# Kapitel 3 Protokollarchitektur

## 3.1 Protokollschichtung

Eine DTP-Implementierung **MUST** entsprechend der folgenden Schichtung organisiert sein:

```
+-----------------------------------------------+
|             Anwendungsschicht                  |
|   iFay / coFay / Personal Data Heap            |
|   Endgeräteanwendungen                         |
+-----------------------------------------------+
|             DTP-Protokollschicht               |
|   DTP_Engine (DTP_Master / DTP_Slave)          |
|   - Agreement Manager                          |
|   - Frame Codec                                |
|   - DAG Manager                                |
|   - Encryption Module                          |
|   - Session Manager                            |
|   - Resume Manager                             |
+-----------------------------------------------+
|             Adapterschicht                     |
|   Transport_Adapter                            |
+-----------------------------------------------+
|             Transportschicht                   |
|   BLE / WebSocket / TCP / RTSP / ...           |
+-----------------------------------------------+
```

Eine Implementierung **MUST NOT** schichtübergreifend aufrufen (zum Beispiel **MUST NOT** die Anwendungsschicht direkt auf die Schnittstelle der Adapterschicht zugreifen).

## 3.2 Kernkomponenten

Die DTP_Engine **MUST** die folgenden sechs Kernkomponenten umfassen:

### 3.2.1 Agreement Manager

Der Agreement Manager **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Verhandlungsablaufverwaltung**: Verarbeitet das Senden und Empfangen von Request_Frame und Response_Frame.
2. **Lebenszyklusverwaltung von Agreements**: Pflegt Zustandsübergänge eines Agreements von `negotiating` bis `terminated`.
3. **Generierung eindeutiger Bezeichner**: Generiert eine RFC 4122 entsprechende UUID v4 als Agreement_ID für jedes etablierte Agreement.
4. **Unterstützung mehrerer paralleler Agreements**: **MUST** unterstützen, dass mehrere aktive Agreements gleichzeitig innerhalb einer einzelnen Session gepflegt werden.

### 3.2.2 Frame Codec

Der Frame Codec **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Serialisierung**: Kodiert ein LogicalFrame-Objekt in eine binäre Bytefolge.
2. **Deserialisierung**: Dekodiert eine binäre Bytefolge in ein LogicalFrame-Objekt.
3. **Roundtrip-Konsistenz**: Für jedes gültige LogicalFrame-Objekt **MUST** das Serialisieren und anschließende Deserialisieren ein zum ursprünglichen Objekt äquivalentes LogicalFrame ergeben.
4. **Pretty Printer**: **SHOULD** die Fähigkeit bereitstellen, ein LogicalFrame in menschenlesbaren Text umzuwandeln, und **SHOULD** alle wesentlichen Felder des Frame-Headers einschließen.

### 3.2.3 DAG Manager

Der DAG Manager **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Zykluserkennung**: Vor dem Hinzufügen eines Fragments zum DAG **MUST** verifiziert werden, dass kein Zyklus entsteht. Wird ein Zyklus erkannt, **MUST** das Fragment abgelehnt werden und der Fehler `DAG_CYCLE_DETECTED` (4001) **MUST** zurückgegeben werden.
2. **Abhängigkeitsauflösung**: Wenn eine von einem Fragment deklarierte Zielabhängigkeit noch nicht eingetroffen ist, **MUST** das Fragment als „auf Abhängigkeitsauflösung wartend" markiert und gecacht werden.
3. **Verzögerte Auflösung**: Wenn das abhängige Fragment eintrifft, **MUST** zuvor gecachte Fragments automatisch aufgelöst werden.
4. **Unterstützung von Beziehungstypen**: **MUST** die drei Beziehungstypen `derived_from`, `annotates` und `supersedes` unterstützen.

### 3.2.4 Encryption Module

Das Encryption Module **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Payload-Verschlüsselung**: Verschlüsselt die Payload mit dem von CAP vorab ausgehandelten Schlüssel.
2. **Payload-Entschlüsselung**: Entschlüsselt die empfangene Payload mit dem von CAP vorab ausgehandelten Schlüssel.
3. **Schlüsselbereitschaftsprüfung**: Vor jeder Verschlüsselungsoperation **MUST** verifiziert werden, dass CAP den Schlüsselaustausch abgeschlossen hat.
4. **Generierung der Verschlüsselungs-Metadaten**: **MUST** Verschlüsselungs-Metadaten (Algorithmusbezeichner und Schlüsselversion) im Klartext im Frame-Header einschließen.

### 3.2.5 Session Manager

Der Session Manager **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Lebenszyklusverwaltung von Sessions**: Aufbauen, Pflegen und Schließen von Sessions.
2. **Zustandspersistierung**: Wenn die zugrunde liegende Verbindung unterbrochen wird, **MUST** der Sitzungszustand persistiert werden.
3. **Zustandswiederherstellung**: Nachdem die Verbindung wiederhergestellt ist und die CAP-Reverifikation bestanden wurde, **MUST** der vorherige Sitzungszustand wiederherstellbar sein.
4. **Timeout-Erkennung**: **MUST** eine Erkennung des Sitzungs-Leerlauf-Timeouts implementieren.

### 3.2.6 Resume Manager

Der Resume Manager **MUST** die folgenden Fähigkeiten bereitstellen:

1. **Sequenznummern-Vergabe**: Vergibt eine monoton steigende Sequenznummer an jedes gesendete Fragment.
2. **Cache für unbestätigte Fragments**: Cacht Fragments lokal, bis sie vom Empfänger bestätigt sind.
3. **Unterbrechungspunkt-Meldung**: Meldet bei wiederhergestellter Verbindung dem Gegenüber die höchste erfolgreich empfangene Sequenznummer.
4. **Cache-Verwaltung**: **MUST** eine Obergrenzenprüfung der Cache-Kapazität implementieren. Wenn der Cache seine Grenze erreicht, **MUST** das Senden pausiert werden und der Fehler `BUFFER_FULL` (6001) **MUST** zurückgegeben werden.

## 3.3 Zustandsmaschine

Die DTP_Engine **MUST** die folgende Zustandsmaschine implementieren:

```
                 [Idle]
                    |
                    | Verbindungsanfrage empfangen
                    v
             [WaitingForCAP]
                    |
                    | CAP-Authentifizierung + Schlüsselaustausch abgeschlossen
                    v
             [SessionEstablished]
                    |
                    | Request_Frame senden oder empfangen
                    v
              [Negotiating]
                    |
                    | Agreement erreicht
                    v
              [Transmitting]
                    |
                    | Verbindung unterbrochen
                    v
                [Suspended]
                    |
                    | Verbindung wiederhergestellt + CAP reverifiziert
                    v
                [Resuming]
                    |
                    | Wiederaufnahme-Handshake abgeschlossen
                    v
              [Transmitting]
```

Die vollständigen Zustandsübergangsregeln **MUST** der folgenden Tabelle entsprechen:

| Aktueller Zustand | Auslösendes Ereignis | Zielzustand | Hinweise |
|-------------------|---------------------|-------------|----------|
| `Idle` | Verbindungsanfrage empfangen | `WaitingForCAP` | |
| `WaitingForCAP` | CAP-Authentifizierung + Schlüsselaustausch abgeschlossen | `SessionEstablished` | |
| `WaitingForCAP` | CAP-Fehler oder Timeout | `Idle` | **MUST** zugehörige Ressourcen freigeben |
| `SessionEstablished` | Request_Frame senden oder empfangen | `Negotiating` | |
| `SessionEstablished` | Sitzungs-Timeout | `Idle` | **MUST** die Session schließen |
| `Negotiating` | Agreement erreicht | `Transmitting` | |
| `Negotiating` | Verhandlung fehlgeschlagen oder abgelehnt | `SessionEstablished` | |
| `Transmitting` | Fortgesetzte Fragment-Übertragung | `Transmitting` | Selbstschleife |
| `Transmitting` | Anpassungs-Request_Frame empfangen | `Negotiating` | |
| `Transmitting` | Zugrunde liegende Verbindung getrennt | `Suspended` | **MUST** den Sitzungszustand persistieren |
| `Transmitting` | Agreement beendet und keine weiteren aktiven Agreements | `SessionEstablished` | |
| `Suspended` | Verbindung wiederhergestellt und CAP-Reverifikation bestanden | `Resuming` | |
| `Suspended` | Sitzungs-Timeout | `Idle` | **MUST** Ressourcen freigeben |
| `Resuming` | Wiederaufnahme-Handshake abgeschlossen | `Transmitting` | |
| `Resuming` | Wiederherstellung fehlgeschlagen | `Idle` | **MUST** die Session schließen |

Eine Implementierung **MUST NOT** Zustandsübergänge einführen, die nicht in der obigen Tabelle aufgeführt sind.

## 3.4 Transport_Adapter-Schnittstelle

Der Transport_Adapter **MUST** die folgende Schnittstelle bereitstellen:

```typescript
interface Transport_Adapter {
  // Verbindungsverwaltung
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;

  // Datenübertragung
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;

  // Zustandsereignisse
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}
```

Eine konkrete Transport_Adapter-Implementierung **MUST** die folgenden normativen Anforderungen erfüllen:

1. Die Operation `send()` **MUST** nicht-blockierend sein.
2. Wenn sich der Zustand der zugrunde liegenden Verbindung ändert, **MUST** die DTP_Engine über den Callback `onConnectionStateChange` benachrichtigt werden.
3. **MUST** für jedes unterstützte Transportprotokoll (BLE, WebSocket, TCP, RTSP) eine einheitliche Schnittstellen-Implementierung bereitstellen.
4. **MUST NOT** die von der DTP_Engine übergebenen Binärdaten verändern.

## 3.5 Master-Slave-Interaktionssequenz

Eine vollständige DTP-Interaktion **MUST** den folgenden fünf Phasen entsprechen:

### Phase 1: CAP-Vorverarbeitung

Die DTP_Engine **MUST** abwarten, bis CAP die Identitätsauthentifizierung und den Schlüsselaustausch abgeschlossen hat. Während dieser Phase **MUST NOT** DTP irgendeinen Daten-Frame senden.

### Phase 2: DTP-Sitzungsaufbau

Nachdem CAP abgeschlossen ist, **MUST** die DTP_Engine eine eindeutige Session_ID (UUID v4) generieren und in den Zustand `SessionEstablished` übergehen.

### Phase 3: Verhandlung

Phase 3a (Datenerfassungs-Verhandlung): Der Master **MAY** einen Request_Frame mit `requestType = collection` senden, und der Slave **MUST** mit einem Response_Frame antworten, der `accepted`, `rejected` oder `counter_proposal` angibt.

Phase 3b (Dateneinspeisungs-Verhandlung): Der Slave **MAY** einen Request_Frame mit `requestType = injection` senden, und der Master **MUST** mit einem Response_Frame antworten.

### Phase 4: Datenübertragung

Nachdem ein Agreement erreicht wurde, **MUST** der Sender Fragments über Daten-Frames übertragen, und jedes Fragment **MUST** die Agreement_ID tragen, zu der es gehört (oder sie weglassen, um den Kontext zu erben, siehe Abschnitt 4.5).

### Phase 5: Verbindungsunterbrechung und Wiederherstellung

Wenn die zugrunde liegende Verbindung unterbrochen wird, **MUST** die DTP_Engine in den Zustand `Suspended` übergehen und die Session persistieren. Nachdem die Verbindung wiederhergestellt ist, **MUST** eine CAP-Reverifikation durchgeführt werden, und anschließend **MUST** die Engine in den Zustand `Resuming` übergehen, um den Wiederaufnahme-Handshake abzuschließen.
