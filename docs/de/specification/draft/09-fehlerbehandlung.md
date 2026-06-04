# Kapitel 9 Fehlerbehandlung

## 9.1 Fehlerbehandlungsmodell

Eine DTP-Implementierung **MUST** einem dreistufigen „Erkennen-Benachrichtigen-Wiederherstellen"-Fehlerbehandlungsmodell folgen:

1. **Erkennen**: Anomale Zustände identifizieren.
2. **Benachrichtigen**: Fehlerinformationen an das Gegenüber oder die obere Schicht senden.
3. **Wiederherstellen**: Wiederherstellungsmaßnahmen je nach Fehlertyp ergreifen.

Eine Implementierung **MUST NOT** Frames bei Erkennung eines Fehlers stillschweigend ohne Benachrichtigung verwerfen.

## 9.2 Fehlercode-System

DTP **MUST** das folgende Fehlercode-System verwenden. Fehlercodes **MUST** nicht-negative Ganzzahlen sein, unterteilt in acht Bereiche nach Funktionsmodul:

| Bereich | Kategorie | Behandlungsstrategie |
|---------|-----------|----------------------|
| 1xxx | Frame-Verarbeitungsfehler | Frame verwerfen + Sender benachrichtigen |
| 2xxx | Verschlüsselungsfehler | Frame verwerfen + Sender benachrichtigen + ggf. Schlüsselneuverhandlung auslösen |
| 3xxx | Agreement-Fehler | Fragment verwerfen + Sender benachrichtigen + ggf. Neuverhandlung auslösen |
| 4xxx | DAG-Fehler | Fragment ablehnen + Sender benachrichtigen oder cachen und warten |
| 5xxx | Sitzungsfehler | Sitzungswiederherstellung versuchen + bei Fehlschlag schließen und obere Schicht benachrichtigen |
| 6xxx | Wiederaufnahme-Fehler | Senden pausieren + Anwendung der oberen Schicht benachrichtigen |
| 7xxx | Versionsfehler | Versions-Inkompatibilitätsbenachrichtigung senden + Downgrade versuchen |
| 8xxx | Berechtigungsfehler | Operation ablehnen + Anfragenden benachrichtigen |

## 9.3 Fehlercode-Definitionen

Eine Implementierung **MUST** die folgenden normativen Fehlercode-Definitionen verwenden. **MUST NOT** nicht aufgeführte Fehlercodes verwenden. Jede Erweiterung **MUST** in einer nachfolgenden Version dieser Spezifikation definiert werden.

### 9.3.1 Frame-Verarbeitungsfehler (1xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 1001 | `FRAME_DESERIALIZATION_FAILED` | Die empfangenen Binärdaten können nicht in einen LogicalFrame deserialisiert werden |
| 1002 | `FRAME_INVALID_FORMAT` | Die LogicalFrame-Struktur ist ungültig oder erforderliche Felder fehlen |

### 9.3.2 Verschlüsselungsfehler (2xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 2001 | `DECRYPTION_FAILED` | Payload-Entschlüsselung fehlgeschlagen (falscher Schlüssel oder beschädigte Daten) |
| 2002 | `KEY_NOT_READY` | CAP-Schlüsselaustausch ist noch nicht abgeschlossen; Datenübertragung wird verweigert |

### 9.3.3 Agreement-Fehler (3xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 3001 | `AGREEMENT_NOT_FOUND` | Das Fragment verweist auf eine unbekannte Agreement_ID |
| 3002 | `AGREEMENT_EXPIRED` | Das referenzierte Agreement ist abgelaufen (`validityPeriod` überschritten) |
| 3003 | `AGREEMENT_NEGOTIATION_FAILED` | Die Verhandlung kann nicht abgeschlossen werden (Timeout, Verweigerung der Neuverhandlung durch Gegenüber usw.) |

### 9.3.4 DAG-Fehler (4xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 4001 | `DAG_CYCLE_DETECTED` | Das Hinzufügen des Fragments würde einen DAG-Zyklus bilden |
| 4002 | `DAG_DEPENDENCY_UNRESOLVED` | Die Abhängigkeiten des Fragments werden nicht innerhalb des Cache-Timeouts aufgelöst |

### 9.3.5 Sitzungsfehler (5xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 5001 | `SESSION_NOT_FOUND` | Die referenzierte Session_ID existiert nicht |
| 5002 | `SESSION_TIMEOUT` | Die Session ist aufgrund von Inaktivität zeitüberschritten |
| 5003 | `SESSION_RESTORE_FAILED` | Die Sitzungswiederherstellung nach Wiederverbindung ist fehlgeschlagen |

### 9.3.6 Wiederaufnahme-Fehler (6xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 6001 | `BUFFER_FULL` | Der Cache für unbestätigte Fragments des Senders hat seine Kapazität erreicht |
| 6002 | `RETRANSMISSION_TIMEOUT` | Fragment-Wiederholungs-Timeout ohne Bestätigung (Wiederholungsanzahl ausgeschöpft) |

### 9.3.7 Versionsfehler (7xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 7001 | `VERSION_INCOMPATIBLE` | Die Protokollversion des empfangenen Frames ist höher als die von dieser Implementierung unterstützte Version |

### 9.3.8 Berechtigungsfehler (8xxx)

| Code | Name | Auslösebedingung |
|------|------|------------------|
| 8001 | `PERMISSION_DENIED` | Die aktuelle Rolle darf diese Operation nicht ausführen |
| 8002 | `OBSERVER_WRITE_DENIED` | Ein Observer hat eine Schreiboperation versucht (Observer sind schreibgeschützt) |

## 9.4 Eindeutigkeit der Fehlercodes

Eine Implementierung **MUST** die Eindeutigkeit der Fehlercodes garantieren:

1. Jeder Fehlercode **MUST** einem eindeutigen Fehlertyp entsprechen.
2. Verschiedene Fehlertypen **MUST NOT** denselben Fehlercode teilen.
3. Die Implementierung **MUST NOT** bereits durch diese Spezifikation zugewiesene Fehlercodes neu definieren.

## 9.5 Fehlerbenachrichtigungs-Mechanismus

### 9.5.1 ErrorNotificationFrame

Fehlerbenachrichtigungen **MUST** über einen ControlFrame übermittelt werden, der wie folgt definiert ist:

```typescript
interface ErrorNotificationFrame {
  frameType: "control";
  controlType: "error_notification";
  errorCode: DTPErrorCode;
  errorMessage: string;
  relatedFrameId?: FragmentID;
  relatedAgreementId?: AgreementID;
  details?: Record<string, unknown>;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `frameType` | **MUST** `"control"` sein |
| `controlType` | **MUST** `"error_notification"` sein |
| `errorCode` | **MUST** einer der in Abschnitt 9.3 definierten Fehlercodes sein |
| `errorMessage` | **MUST** eine menschenlesbare Fehlerbeschreibung sein. **SHOULD** eine vom Gegenüber verständliche Sprache verwenden |
| `relatedFrameId` | **OPTIONAL**. Wenn der Fehler durch einen bestimmten Frame ausgelöst wird, **MUST** die fragmentId dieses Frames enthalten |
| `relatedAgreementId` | **OPTIONAL**. Wenn der Fehler mit einem bestimmten Agreement zusammenhängt, **MUST** die Agreement_ID enthalten |
| `details` | **OPTIONAL**. **MAY** zusätzliche Informationen für das Debugging enthalten |

### 9.5.2 Transport von Fehlerbenachrichtigungen

Ein ErrorNotificationFrame **MUST** über den regulären LogicalFrame-Kanal übertragen werden und **MUST** seine Payload verschlüsselt haben.

Wenn der Fehler selbst die Verschlüsselung verhindert (z.B. der Fehler `KEY_NOT_READY`), **MAY** die Implementierung den Fehler über einen implementierungsdefinierten Out-of-Band-Kanal zurückgeben, **MUST NOT** aber den Fehler im Klartext auf dem verschlüsselten Kanal senden.

## 9.6 Wichtige Workflows zur Fehlerbehandlung

### 9.6.1 Deserialisierungsfehler (1001)

Wenn ein empfangener LogicalFrame nicht deserialisiert werden kann, **MUST** der Empfänger:

1. Den Frame verwerfen.
2. Die Fehlerbenachrichtigung `FRAME_DESERIALIZATION_FAILED` senden.
3. **MUST NOT** die Session aufgrund eines Deserialisierungsfehlers schließen.

### 9.6.2 Entschlüsselungsfehler (2001)

Wenn eine empfangene Payload nicht entschlüsselt werden kann, **MUST** der Empfänger:

1. Den Frame verwerfen.
2. Die Fehlerbenachrichtigung `DECRYPTION_FAILED` senden.
3. Die Anzahl aufeinanderfolgender Entschlüsselungsfehler zählen.
4. Wenn aufeinanderfolgende Fehlschläge einen Schwellenwert überschreiten (**RECOMMENDED** 3), **SHOULD** CAP zur Neuverhandlung der Schlüssel ausgelöst werden.

### 9.6.3 DAG-Zykluserkennung (4001)

Wenn ein DAG-Zyklus erkannt wird:

1. Der Empfänger **MUST** das Fragment ablehnen.
2. **MUST** den Fehler `DAG_CYCLE_DETECTED` zurückgeben.
3. **MUST NOT** das Fragment dem DAG hinzufügen.
4. **MUST NOT** den Zustand bestehender Fragments beeinflussen.

### 9.6.4 Unbekanntes Agreement (3001)

Wenn ein Fragment auf eine unbekannte Agreement_ID verweist:

1. Der Empfänger **MUST** das Fragment verwerfen.
2. Den Fehler `AGREEMENT_NOT_FOUND` zurückgeben.
3. **MAY** Neuverhandlung auslösen (implementierungsdefiniert).

### 9.6.5 Schlüssel nicht bereit (2002)

Wenn die Datenübertragung versucht wird, bevor der CAP-Schlüsselaustausch abgeschlossen ist:

1. Die DTP_Engine **MUST** das Senden verweigern.
2. **MUST** den Fehler `KEY_NOT_READY` an den Aufrufer der oberen Schicht zurückgeben.
3. **MUST NOT** im Klartext über den Kommunikationskanal antworten.

### 9.6.6 Cache voll (6001)

Wenn der Cache für unbestätigte Fragments seine Obergrenze erreicht:

1. Der Sender **MUST** das Senden neuer Fragments pausieren.
2. Eine `BUFFER_FULL`-Benachrichtigung an die Anwendung der oberen Schicht senden.
3. Das Senden wieder aufnehmen, nachdem Cache-Speicher durch Bestätigungen freigegeben wurde.
4. **MUST NOT** bereits gecachte Fragments verwerfen.

### 9.6.7 Wiederholungs-Timeout (6002)

Wenn die Fragment-Wiederholungsanzahl ausgeschöpft ist:

1. Der Sender **MUST** die Anwendung der oberen Schicht über den Fehler `RETRANSMISSION_TIMEOUT` benachrichtigen.
2. **SHOULD** Sitzungssuspendierung oder -beendigung auslösen.
3. **MUST NOT** unbegrenzt erneut senden.

### 9.6.8 Versions-Inkompatibilität (7001)

Wenn ein Frame mit einer inkompatiblen Protokollversion empfangen wird (siehe Kapitel 10 für Details):

1. Der Empfänger **MUST** den Frame nicht verarbeiten.
2. **MUST** den Fehler `VERSION_INCOMPATIBLE` zurückgeben.
3. **MUST** die höchste von ihm unterstützte Version im Feld `details` des Fehlers einschließen.

### 9.6.9 Berechtigung verweigert (8001, 8002)

Bei unzulässigen Rollenoperationen:

1. Die DTP_Engine **MUST** die Operation ablehnen.
2. Schreiboperationen von Observern **MUST** `OBSERVER_WRITE_DENIED` (8002) zurückgeben.
3. Andere Berechtigungsverweigerungen **MUST** `PERMISSION_DENIED` (8001) zurückgeben.

## 9.7 Fehlerwiederherstellungsstrategie

Eine Implementierung **MUST** die entsprechende Wiederherstellungsstrategie nach Fehlertyp anwenden:

| Fehlerkategorie | Wiederherstellungsstrategie |
|-----------------|------------------------------|
| 1xxx Frame-Verarbeitung | Frame verwerfen, protokollieren, weitere Frames empfangen |
| 2xxx Verschlüsselung | Einzelner Fehlschlag: Frame verwerfen; aufeinanderfolgende Fehlschläge: Schlüsselneuverhandlung auslösen |
| 3xxx Agreement | Fragment verwerfen; ggf. Neuverhandlung auslösen |
| 4xxx DAG | Zyklus: ablehnen; nicht aufgelöst: cachen und warten |
| 5xxx Sitzung | Sitzungswiederherstellung versuchen; bei Fehlschlag schließen |
| 6xxx Wiederaufnahme | Senden pausieren, auf Antwort des Gegenübers oder Eingriff der oberen Schicht warten |
| 7xxx Version | Versionsbenachrichtigung senden; Downgrade versuchen |
| 8xxx Berechtigung | Operation ablehnen; **MUST NOT** automatisch wiederholen |

Eine Implementierung **MUST NOT** dieselbe Operation automatisch wiederholen, wenn ein Berechtigungsfehler (8xxx) auftritt.
