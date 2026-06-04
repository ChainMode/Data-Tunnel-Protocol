# Kapitel 4 Logische Rahmenstruktur

## 4.1 Gesamtstruktur

Ein LogicalFrame **MUST** aus zwei Teilen bestehen:

```
+----------------+
|     Header     |   (Klartext)
+----------------+
|     Payload    |   (verschlüsselt)
+----------------+
```

Formale Definition von LogicalFrame:

```typescript
interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;  // verschlüsselt
}
```

## 4.2 FrameHeader

Der Frame-Header **MUST** die folgenden Felder enthalten. Die Reihenfolge in der Tabelle unten ist die normative Reihenfolge:

| Feld | Typ | Erforderlich | Verschlüsselt | Beschreibung |
|------|-----|--------------|---------------|--------------|
| `protocolVersion` | `ProtocolVersion` | **REQUIRED** | Nein | Protokollversion |
| `frameType` | `FrameType` | **REQUIRED** | Nein | Frame-Typ |
| `fragmentId` | `FragmentID` | **REQUIRED** | Nein | Eindeutiger Fragment-Bezeichner |
| `agreementId` | `AgreementID \| null` | **REQUIRED** | Nein | Agreement-ID (**MAY** null sein) |
| `originTimestamp` | `OriginTimestamp` | **REQUIRED** | Nein | Ursprungszeitstempel (UTC ms) |
| `dagDependencies` | `DAGEdge[]` | **REQUIRED** | Nein | DAG-Abhängigkeitsliste (**MAY** ein leeres Array sein) |
| `encryptionMetadata` | `EncryptionMetadata` | **REQUIRED** | Nein | Verschlüsselungs-Metadaten |
| `sequenceNumber` | `SequenceNumber` | **REQUIRED** | Nein | Übertragungs-Sequenznummer |

Der Frame-Header **MUST NOT** verschlüsselt werden. Alle Felder **MUST** im Klartext übertragen werden.

## 4.3 FrameType

`FrameType` **MUST** einer der folgenden vier Aufzählungswerte sein:

| Wert | Zweck | Payload-Inhalt |
|------|-------|----------------|
| `"data"` | Trägt eigentliche Fragment-Daten | Das `data`-Feld eines Fragments |
| `"request"` | Initiiert eine Datenanfrage oder passt ein Übertragungs-Agreement an | Der serialisierte Inhalt eines RequestFrame |
| `"response"` | Antwortet auf eine Datenanfrage | Der serialisierte Inhalt eines ResponseFrame |
| `"control"` | Übermittelt Steuerinformationen wie Fehlerbenachrichtigungen und Agreement-Beendigung | Der serialisierte Inhalt eines ControlFrame |

Eine Implementierung **MUST NOT** Frame-Typen einführen, die nicht aufgeführt sind.

## 4.4 ProtocolVersion

`ProtocolVersion` **MUST** aus zwei nicht-negativen Ganzzahlen bestehen:

```typescript
interface ProtocolVersion {
  major: number;
  minor: number;
}
```

Die Semantik der Versionsnummer und die Änderungsklassifizierungsregel **MUST** den in Kapitel 1 §1.7.2 definierten Regeln entsprechen (die maßgebliche Quelle).

## 4.5 Agreement_ID-Komprimierung

Das Feld `agreementId` **MAY** zu Komprimierungszwecken `null` sein. Die Komprimierungsregeln **MUST** den folgenden Anforderungen entsprechen:

1. Innerhalb einer Reihe aufeinanderfolgender Fragments, die zum selben Agreement gehören, **MUST** **nur** der Frame-Header des ersten Fragments die vollständige Agreement_ID tragen.
2. Das Feld `agreementId` nachfolgender Fragments **MAY** auf `null` gesetzt werden, was die Wiederverwendung der zuletzt nicht-null gesetzten Agreement_ID anzeigt.
3. Der Empfänger **MUST** eine „aktuelle Kontext-Agreement_ID" pflegen und sie nach folgenden Regeln interpretieren:
   - Wenn ein Fragment mit nicht-null `agreementId` empfangen wird, **MUST** dessen Wert als aktuelle Kontext-Agreement_ID übernommen werden.
   - Wenn ein Fragment mit `agreementId` gleich null empfangen wird, **MUST** es der aktuellen Kontext-Agreement_ID zugeordnet werden.
4. Wenn der Empfänger ein Fragment mit `agreementId` gleich null empfängt, während die aktuelle Kontext-Agreement_ID ebenfalls null ist, **MUST** er das Fragment verwerfen und den Fehler `AGREEMENT_NOT_FOUND` (3001) zurückgeben.
5. Wenn der Empfänger ein Fragment empfängt, das auf eine unbekannte Agreement_ID verweist, **MUST** er das Fragment verwerfen und den Fehler `AGREEMENT_NOT_FOUND` (3001) zurückgeben.

Die aktuelle Kontext-Agreement_ID des Empfängers **MUST** für jede Übertragungsrichtung unabhängig gepflegt werden.

## 4.6 Origin_Timestamp

`originTimestamp` **MUST** Folgendes erfüllen:

1. **MUST** die UTC-Zeitzone verwenden.
2. **MUST** Millisekunden-Präzision tragen.
3. **MUST** eine nicht-negative Ganzzahl sein (Unix-Zeitstempel in Millisekunden).
4. **MUST** den Zeitpunkt erfassen, an dem die Daten tatsächlich an der Quelle erzeugt wurden, und **MUST NOT** den Übertragungszeitpunkt erfassen.
5. Nach Durchlaufen der vollständigen Übertragungskette (Serialisierung → Verschlüsselung → Übertragung → Entschlüsselung → Deserialisierung) **MUST** er exakt mit dem vor dem Senden übereinstimmen.
6. Der Empfänger **MUST NOT** den empfangenen Origin_Timestamp verändern.

## 4.7 DAG-Abhängigkeiten (DAGEdge)

`DAGEdge` **MUST** die folgenden Felder enthalten:

```typescript
interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
```

`DAGRelationType` **MUST** einer der folgenden drei Aufzählungswerte sein:

| Wert | Semantik |
|------|----------|
| `"derived_from"` | Dieses Fragment ist vom Ziel-Fragment abgeleitet |
| `"annotates"` | Dieses Fragment annotiert/erläutert das Ziel-Fragment |
| `"supersedes"` | Dieses Fragment ersetzt das Ziel-Fragment |

Das Array `dagDependencies` **MAY** leer sein (d.h. das Fragment hat keine Abhängigkeiten).

## 4.8 EncryptionMetadata

`EncryptionMetadata` **MUST** die folgenden Felder enthalten:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `algorithm` | **MUST** der Bezeichner-String des Verschlüsselungsalgorithmus sein (z.B. `"AES-256-GCM"`). **SHOULD** IANA-registrierte Algorithmusnamen verwenden |
| `keyVersion` | **MUST** eine nicht-negative Ganzzahl sein. Wird zur Unterstützung der Schlüsselrotation verwendet |

Die Verschlüsselungs-Metadaten selbst **MUST NOT** verschlüsselt werden und **MUST** in Klartextform im Frame-Header enthalten sein.

## 4.9 Sequence_Number

`sequenceNumber` **MUST** Folgendes erfüllen:

1. **MUST** eine nicht-negative Ganzzahl sein.
2. **MUST** innerhalb einer einzelnen Session monoton steigend sein.
3. **MUST** für jede Übertragungsrichtung (Datenerfassung, Dateneinspeisung) unabhängig gepflegt werden.
4. Der Sequenznummernraum **MUST NOT** zwischen den beiden Richtungen geteilt werden.
5. **SHOULD** bei 0 oder 1 beginnen.
6. Wenn die Sequenznummer überläuft (ein implementierungsdefinierter Maximalwert), **MUST** die Implementierung dies durch Aufbau einer neuen Session handhaben und **MUST NOT** umlaufen.

## 4.10 Fragment-Struktur

Ein Fragment **MUST** die folgenden Felder enthalten:

```typescript
interface Fragment {
  fragmentId: FragmentID;
  agreementId: AgreementID;
  originTimestamp: OriginTimestamp;
  contextMetadata: ContextMetadata;
  dagDependencies: DAGEdge[];
  data: Uint8Array;
}
```

Hinweis: Wenn das `agreementId`-Feld eines Fragments in einen LogicalFrame serialisiert wird, kann es aufgrund der Komprimierungsregeln im LogicalFrame-Header als null erscheinen (siehe Abschnitt 4.5), aber die logische `agreementId` des Fragments selbst **MUST** stets nicht-null sein.

## 4.11 ContextMetadata

`ContextMetadata` **MUST** die folgenden Felder enthalten:

```typescript
interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
```

`DataSource` **MUST** eine der folgenden zwei Strukturen sein (eine durch das Feld `kind` unterschiedene diskriminierte Vereinigung):

### 4.11.1 HardwareSource

Wenn die Daten von einem Hardware-Sensor stammen, **MUST** `source` sein:

```typescript
interface HardwareSource {
  kind: "hardware";
  sensorType: string;
  precision: string;
  samplingRate: number;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `kind` | **MUST** der literale String `"hardware"` sein |
| `sensorType` | **MUST** ein nicht-leerer String sein. **SHOULD** standardisierte Benennungen verwenden (z.B. `"accelerometer"`, `"heart_rate_monitor"`) |
| `precision` | **MUST** ein nicht-leerer String sein, der die Sensorpräzision beschreibt (z.B. `"±0.1°C"`) |
| `samplingRate` | **MUST** eine positive Zahl sein, in Hz |

### 4.11.2 SoftwareSource

Wenn die Daten aus Software-Sharing stammen, **MUST** `source` sein:

```typescript
interface SoftwareSource {
  kind: "software";
  appIdentifier: string;
  sharingMethod: string;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `kind` | **MUST** der literale String `"software"` sein |
| `appIdentifier` | **MUST** ein nicht-leerer String sein. **SHOULD** umgekehrte Domainnamen-Notation verwenden (z.B. `"com.example.app"`) |
| `sharingMethod` | **MUST** ein nicht-leerer String sein, der die Sharing-Methode beschreibt (z.B. `"api_push"`, `"clipboard_capture"`) |

### 4.11.3 Benutzerdefinierte Felder

`customFields` **MUST** eine Abbildung von String auf beliebigen Wert sein und **MAY** das leere Objekt `{}` sein. Eine Implementierung **MUST NOT** Informationen, die bereits in `dataType` oder `source` enthalten sind, in `customFields` wiederholen.

## 4.12 Serialisierungs-Anforderungen

Die Serialisierung eines LogicalFrame **MUST** die folgenden normativen Anforderungen erfüllen:

1. **Determinismus**: Dasselbe LogicalFrame-Objekt **MUST** dieselbe binäre Ausgabe erzeugen.
2. **Roundtrip-Konsistenz**: Für jedes gültige LogicalFrame **MUST** das Serialisieren und anschließende Deserialisieren ein zum ursprünglichen Objekt äquivalentes LogicalFrame ergeben.
3. **Vollständigkeit**: Die serialisierte Ausgabe **MUST** alle Felder des Frame-Headers enthalten.
4. **Payload-Verschlüsselung**: Vor der Serialisierung **MUST** die Payload bereits mit dem in EncryptionMetadata angegebenen Algorithmus verschlüsselt sein.

Das konkrete binäre Layout der Serialisierung (Bytereihenfolge, Feldkodierung) wird in nachfolgenden Entwürfen festgelegt; ausgereifte Binärformate wie CBOR (RFC 8949) oder Protocol Buffers **SHOULD** bevorzugt werden.

## 4.13 Physische Fragmentierung

Wenn der zugrunde liegende Transport eine Fragmentierung erfordert (z.B. aufgrund von BLE-MTU-Beschränkungen):

1. **MUST** die Fragmentierungsoperation vom Transport_Adapter durchgeführt werden.
2. Der LogicalFrame **MUST** auf der DTP_Engine-Schicht ganz bleiben.
3. Der Transport_Adapter des Empfängers **MUST** den vollständigen LogicalFrame wieder zusammensetzen, bevor er ihn an die DTP_Engine weitergibt.
