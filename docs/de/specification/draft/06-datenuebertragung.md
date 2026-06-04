# Kapitel 6 Datenübertragung

## 6.1 Bidirektionaler Datenfluss

Eine DTP-Implementierung **MUST** die folgenden zwei unabhängigen Datenflussrichtungen unterstützen:

| Richtung | Bezeichnung | Sender | Empfänger |
|----------|-------------|--------|-----------|
| Endgerät → Fay | Datenerfassung | Slave | Master |
| Fay → Endgerät | Dateneinspeisung | Master | Slave |

Beide Richtungen **MUST** Folgendes erfüllen:

1. Verwenden dasselbe LogicalFrame-Format und denselben Verarbeitungsablauf.
2. Pflegen unabhängige Sequenznummernräume.
3. Pflegen unabhängige Wiederaufnahme-Zustände (Cache unbestätigter Fragments, höchste bestätigte Sequenznummer usw.).
4. Sind sich gegenseitig nicht beeinflussend: Zustandsänderungen in einer Richtung **MUST NOT** die andere Richtung beeinflussen.

## 6.2 Datenerfassungs-Workflow (Endgerät → Fay)

Die Datenerfassung **MUST** diesem Workflow folgen:

### 6.2.1 Sender-Workflow (DTP_Slave)

1. Empfange die von der Endgeräteanwendung übermittelten Daten.
2. Baue das Fragment auf:
   a. Generiere eine neue Fragment_ID (UUID v4).
   b. Setze `agreementId` auf die Agreement_ID des aktuell aktiven Agreements.
   c. Setze `originTimestamp` auf den UTC-Millisekunden-Zeitstempel, zu dem die Daten **tatsächlich erzeugt** wurden. **MUST NOT** den aktuellen Zeitpunkt verwenden.
   d. Hänge strukturierte ContextMetadata an (siehe Abschnitt 4.11).
   e. Hänge `dagDependencies` an (**MAY** ein leeres Array sein).
3. Validiere DAG-Abhängigkeiten:
   a. Rufe den DAG Manager auf, um zu verifizieren, dass kein Zyklus entsteht (siehe Abschnitt 6.7).
   b. Wenn ein Zyklus erkannt wird, **MUST** das Fragment abgelehnt werden und der Fehler `DAG_CYCLE_DETECTED` (4001) zurückgegeben werden.
4. Baue den LogicalFrame auf:
   a. Setze `frameType = "data"`.
   b. Wende die Komprimierungsregeln für Agreement_ID an (siehe Abschnitt 4.5).
   c. Vergib eine monoton steigende `sequenceNumber` (Datenerfassungsrichtung).
   d. Setze die Verschlüsselungs-Metadaten.
5. Verschlüssele die Payload: Verschlüssele das `data`-Feld des Fragments mit dem von CAP vorab ausgehandelten Schlüssel.
6. Serialisiere den LogicalFrame.
7. Rufe den Transport_Adapter auf, um die Binärdaten zu senden.
8. Füge das Fragment dem Cache der unbestätigten Fragments hinzu (siehe Abschnitt 8.2).

### 6.2.2 Empfänger-Workflow (DTP_Master)

1. Empfange die vom Transport_Adapter zugestellten Binärdaten.
2. Deserialisiere in einen LogicalFrame. Schlägt dies fehl, **MUST** der Frame verworfen werden und der Fehler `FRAME_DESERIALIZATION_FAILED` (1001) **MUST** zurückgegeben werden.
3. Validiere die Protokollversion (siehe Kapitel 10).
4. Parse die Agreement_ID (wende die Komprimierungsregeln aus Abschnitt 4.5 an). Wenn sie mit einem unbekannten Agreement assoziiert ist, **MUST** der Frame verworfen werden und der Fehler `AGREEMENT_NOT_FOUND` (3001) **MUST** zurückgegeben werden.
5. Entschlüssele die Payload. Schlägt dies fehl, **MUST** der Frame verworfen werden und der Fehler `DECRYPTION_FAILED` (2001) **MUST** zurückgegeben werden.
6. Deserialisiere in ein Fragment.
7. Validiere DAG-Abhängigkeiten:
   a. Wenn alle Zielabhängigkeiten bereits existieren, **MUST** akzeptieren und als `accepted` markieren.
   b. Wenn einige Zielabhängigkeiten noch nicht eingetroffen sind, **MUST** als `pending` markieren und cachen (siehe Abschnitt 6.7).
   c. Wenn ein Zyklus erkannt wird, **MUST** ablehnen und den Fehler `DAG_CYCLE_DETECTED` (4001) zurückgeben.
8. Aktualisiere den Empfangszustand: Setze die sequenceNumber des Fragments als die höchste empfangene Sequenznummer für diese Richtung (falls sie sich erhöht).
9. Sende eine Bestätigung (siehe Kapitel 8).
10. Persistiere das Fragment in den Personal Data Heap.

## 6.3 Dateneinspeisungs-Workflow (Fay → Endgerät)

Die Dateneinspeisung **MUST** diesem Workflow folgen:

### 6.3.1 Sender-Workflow (DTP_Master)

1. Frage den Personal Data Heap ab und filtere die Daten gemäß `dataRange` des Agreements, um einen minimierten Datensatz zu erzeugen.
2. Baue das Fragment auf (gleich den Schritten 2-3 von Abschnitt 6.2.1).
3. Baue den LogicalFrame auf, verschlüssele die Payload, serialisiere und sende (gleich den Schritten 4-8 von Abschnitt 6.2.1), aber verwende den Sequenznummernraum der Dateneinspeisungsrichtung.

### 6.3.2 Empfänger-Workflow (DTP_Slave)

1. Deserialisiere, validiere die Version, parse die Agreement_ID, entschlüssele, deserialisiere das Fragment, validiere den DAG (gleich den Schritten 1-7 von Abschnitt 6.2.2).
2. Aktualisiere den Empfangszustand und sende eine Bestätigung (gleich den Schritten 8-9 von Abschnitt 6.2.2).
3. Stelle das Fragment der Endgeräteanwendung zu.

## 6.4 Agreement_ID-Komprimierung in der Übertragung

Eine Implementierung **MUST** den in Abschnitt 4.5 definierten Komprimierungsregeln für die Agreement_ID strikt folgen.

### 6.4.1 Komprimierungsbeispiel

Im Folgenden ist eine spezifikationskonforme Übertragungssequenz:

```
Fragment 1: agreementId = "abc-123"   (neues Agreement, vollständige ID)
Fragment 2: agreementId = null        (Wiederverwendung "abc-123")
Fragment 3: agreementId = null        (Wiederverwendung "abc-123")
Fragment 4: agreementId = "def-456"   (Wechsel zu neuem Agreement, vollständige ID)
Fragment 5: agreementId = null        (Wiederverwendung "def-456")
```

### 6.4.2 Komprimierungsbeschränkungen

Eine Implementierung **MUST** Folgendes erfüllen:

1. **MAY** sich entscheiden, nicht zu komprimieren (d.h. alle Fragments tragen die vollständige Agreement_ID).
2. Falls die Komprimierung gewählt wird, **MUST** Abschnitt 4.5 strikt gefolgt werden.
3. Der Empfänger **MUST** sowohl komprimierte als auch unkomprimierte Modi unterstützen.
4. Die Kontext-Agreement_ID **MUST** auf null zurückgesetzt werden, nachdem eine Session suspendiert und wiederaufgenommen wurde (d.h. das erste Fragment nach der Wiederaufnahme **MUST** die vollständige ID tragen).

## 6.5 Sequenznummern-Verwaltung

### 6.5.1 Monotones Steigen

Die `sequenceNumber` jedes Fragments **MUST** Folgendes erfüllen:

1. Innerhalb einer einzelnen Session monoton steigend sein.
2. **SHOULD** strikt zusammenhängend sein (d.h. jeweils um 1 erhöhen).
3. **MUST NOT** sich wiederholen oder zurückgehen.

### 6.5.2 Pro-Richtung-Unabhängigkeit

Die Datenerfassungsrichtung und die Dateneinspeisungsrichtung **MUST** unabhängige Sequenznummernräume pflegen:

```
Datenerfassungsrichtung (collection):  seq 1, 2, 3, 4, 5, ...
Dateneinspeisungsrichtung (injection): seq 1, 2, 3, 4, 5, ...
```

Eine Implementierung **MUST NOT** den Sequenznummernraum zwischen den beiden Richtungen teilen.

### 6.5.3 Neustart und Sessions

Sequenznummern **MUST** Folgendes erfüllen:

1. Die Sequenznummer **MUST** zurückgesetzt werden, wenn eine neue Session beginnt (**SHOULD** bei 0 oder 1 starten).
2. Wenn eine Session aus `Suspended` wiederhergestellt wird, **MUST** die Sequenznummer ihren Wert vor der Suspendierung beibehalten und **MUST NOT** zurückgesetzt werden.
3. Falls die Sequenznummer sich dem implementierungsdefinierten Maximalwert nähert, **MUST** der Sender proaktiv eine neue Session aufbauen, um Überlauf zu vermeiden.

## 6.6 Erhaltung des Ursprungszeitstempels

Eine Implementierung **MUST** sicherstellen, dass der Origin_Timestamp während der Übertragung unverändert bleibt:

1. Der Sender **MUST** den Zeitpunkt aufzeichnen, zu dem die Daten **tatsächlich erzeugt** wurden, als Origin_Timestamp.
2. Serialisierung, Verschlüsselung, Übertragung, Entschlüsselung und Deserialisierung **MUST NOT** den Origin_Timestamp verändern.
3. Der Empfänger **MUST NOT** den empfangenen Origin_Timestamp verändern.
4. Bei der Persistierung **MUST** der Empfänger den Origin_Timestamp beibehalten.

Eine Implementierung **SHOULD** ein unabhängiges Feld „Übertragungszeitstempel" außerhalb des Frame-Headers pflegen (implementierungsdefiniert), **MUST** es aber nicht mit Origin_Timestamp verwechseln.

## 6.7 Behandlung von DAG-Abhängigkeiten

### 6.7.1 Hinzufügen von Fragments zum DAG

Wenn der Empfänger ein Fragment empfängt, **MUST** er die Abhängigkeiten über den DAG Manager verarbeiten:

1. Extrahiere die `dagDependencies` des Fragments.
2. Für jede Abhängigkeit:
   a. Prüfe, ob die Ziel-Fragment_ID bereits im DAG ist.
   b. Prüfe, ob das Hinzufügen dieser Kante einen Zyklus bilden würde.
3. Gib eines der folgenden drei Ergebnisse basierend auf dem Prüfergebnis zurück:

| Ergebnis | Bedeutung | Folgeaktion |
|----------|-----------|-------------|
| `accepted` | Alle Abhängigkeiten sind aufgelöst; kein Zyklus | **MUST** das Fragment dem DAG hinzufügen |
| `pending` | Einige Abhängigkeiten sind nicht aufgelöst (Ziel-Fragments sind nicht eingetroffen); kein Zyklus | **MUST** das Fragment cachen und auf Abhängigkeitsauflösung warten |
| `rejected` | Ein Zyklus wird erkannt | **MUST** das Fragment ablehnen und den Fehler `DAG_CYCLE_DETECTED` (4001) zurückgeben |

### 6.7.2 Verzögerte Auflösung

Wenn ein Fragment im Zustand `pending` ist:

1. Die Implementierung **MUST** weiterhin auf Abhängigkeiten im Cache für dieses Fragment warten.
2. Wenn die Ziel-Fragments der Abhängigkeiten eintreffen, **MUST** alle zugehörigen `pending`-Fragments im Cache erneut bewertet werden.
3. **MAY** eine maximale Cache-Zeit setzen (implementierungsdefiniert). Nach Timeout **SHOULD** der Fehler `DAG_DEPENDENCY_UNRESOLVED` (4002) zurückgegeben werden und verworfen werden.

### 6.7.3 Zykluserkennungsalgorithmus

Eine Implementierung **MUST** Zyklen erkennen, bevor ein neues Fragment hinzugefügt wird. Der Erkennungsalgorithmus **SHOULD** DFS (Tiefensuche) oder den Tarjan-Algorithmus verwenden.

Konkret: Führe von jedem Abhängigkeitsziel des neuen Fragments aus eine DFS durch. Wenn das neue Fragment selbst von einem Abhängigkeitsziel aus erreichbar ist, ist ein Zyklus gebildet.

## 6.8 Verschachtelte Übertragung mehrerer Agreements

Wenn mehrere aktive Agreements koexistieren, **MUST** der Sender:

1. Jedes Fragment über die Agreement_ID im Frame-Header mit dem korrekten Agreement assoziieren.
2. Beim Wechsel von Agreements (d.h. das nächste Fragment gehört zu einem anderen Agreement) **MUST** in diesem Fragment die vollständige Agreement_ID tragen (d.h. die null-Komprimierung kann nicht verwendet werden).
3. **SHOULD** die Sendereihenfolge gemäß der `priority` jedes Agreements einplanen.
