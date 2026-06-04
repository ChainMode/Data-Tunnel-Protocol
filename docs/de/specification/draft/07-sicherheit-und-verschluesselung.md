# Kapitel 7 Sicherheit und Verschlüsselung

## 7.1 Sicherheitsmodell

Eine DTP-Implementierung **MUST** Ende-zu-Ende-Verschlüsselung bereitstellen. Das Sicherheitsmodell **MUST** die folgenden Invarianten erfüllen:

1. Nur die Ziel-iFay-Instanz **MUST** die empfangene Payload entschlüsseln können.
2. Die FayGer-Laufzeitumgebung **MUST NOT** unter keinen Umständen auf Klartextdaten zugreifen.
3. Zwischennetzwerk-Knoten **MUST NOT** den Klartext der Payload lesen.
4. Die DTP-Implementierung **MUST NOT** Verschlüsselungsschlüssel selbst verwalten.

## 7.2 Verschlüsselungsumfang

Der Verschlüsselungsumfang **MUST** strikt auf die Payload des LogicalFrame beschränkt sein.

### 7.2.1 Inhalte, die verschlüsselt werden MUST

Die folgenden Daten **MUST** verschlüsselt werden:

- Das Feld `payload` des LogicalFrame (d.h. das Feld `data` eines Fragments und—wenn als Frame transportiert—die Inhalte von RequestFrame, ResponseFrame und ControlFrame).

### 7.2.2 Inhalte, die NICHT verschlüsselt werden DÜRFEN

Die folgenden Daten **MUST NOT** verschlüsselt werden und **MUST** im Klartext übertragen werden:

- Der `header` des LogicalFrame (einschließlich `protocolVersion`, `frameType`, `fragmentId`, `agreementId`, `originTimestamp`, `dagDependencies`, `encryptionMetadata` und `sequenceNumber`).

Die Verschlüsselungs-Metadaten selbst **MUST NOT** verschlüsselt werden, damit der Empfänger die Entschlüsselungsparameter vor der Entschlüsselung bestimmen kann.

## 7.3 Schlüsselverwaltung

### 7.3.1 Schlüsselquelle

Eine DTP-Implementierung **MUST** den von CAP vorab ausgehandelten Schlüssel verwenden. Konkret:

1. CAP **MUST** während der Verbindungsaufbauphase die Identitätsauthentifizierung und den Schlüsselaustausch abschließen.
2. Die DTP-Implementierung **MUST** den von CAP bereitgestellten `sessionKey` für die Payload-Verschlüsselung/-Entschlüsselung verwenden.
3. Die DTP-Implementierung **MUST NOT** Verschlüsselungsschlüssel selbst generieren, aushandeln oder austauschen.

### 7.3.2 CAPContext-Schnittstelle

Eine DTP-Implementierung **MUST** den von CAP bereitgestellten Kontext über die folgende Schnittstelle empfangen:

```typescript
interface CAPContext {
  identity: string;
  sessionKey: Uint8Array;
  verified: boolean;
}
```

| Feld | Normative Anforderung |
|------|------------------------|
| `identity` | **MUST** der Identitätsbezeichner des Gegenübers sein |
| `sessionKey` | **MUST** die Bytefolge des durch CAP ausgehandelten Sitzungsschlüssels sein |
| `verified` | **MUST** den CAP-Verifizierungsstatus widerspiegeln |

### 7.3.3 CAP-Vorbedingungen

Eine DTP-Implementierung **MUST** den CAPContext vor Beginn der Datenübertragung verifizieren:

1. Wenn `verified === false`, **MUST** das Senden jeglicher Daten-Frames verweigert werden und der Fehler `KEY_NOT_READY` (2002) zurückgegeben werden.
2. Wenn `sessionKey` leer ist oder eine ungültige Länge hat, **MUST** der Fehler `KEY_NOT_READY` zurückgegeben werden.
3. Die Übertragung von Verhandlungs-Frames (Request_Frame, Response_Frame) unterliegt **gleichermaßen** dieser Vorbedingung.

## 7.4 Verschlüsselungs-Metadaten

Der Frame-Header jedes LogicalFrame **MUST** EncryptionMetadata tragen:

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

### 7.4.1 Algorithmusbezeichner

Das Feld `algorithm` **MUST** der Bezeichner-String des Verschlüsselungsalgorithmus sein. **SHOULD** einen der folgenden standardisierten Namen verwenden:

| Bezeichner | Algorithmus | Status |
|------------|-------------|--------|
| `"AES-256-GCM"` | AES-256 im Galois/Counter Mode | **RECOMMENDED** |
| `"ChaCha20-Poly1305"` | ChaCha20 mit Poly1305 | **RECOMMENDED** |
| `"AES-128-GCM"` | AES-128 im Galois/Counter Mode | **MAY** verwendet werden |

Eine Implementierung **MUST** mindestens einen von `AES-256-GCM` und `ChaCha20-Poly1305` unterstützen. Es ist **RECOMMENDED**, beide für verbesserte Interoperabilität zu unterstützen.

Eine Implementierung **MUST NOT** Folgendes verwenden:

- ECB-Modus (unsicher)
- Nicht-authentifizierte Verschlüsselungsmodi (CBC, CTR ohne MAC)
- Algorithmen mit bekannten Schwachstellen (DES, 3DES, RC4)

### 7.4.2 Schlüsselversionsnummer

`keyVersion` **MUST** eine nicht-negative Ganzzahl sein, die zur Unterstützung der Schlüsselrotation verwendet wird:

1. Wenn CAP eine Schlüsselrotation auslöst, **MUST** die `keyVersion` des neuen Schlüssels strikt größer als die vorherige Version sein.
2. Der Empfänger **MUST** den entsprechenden Entschlüsselungsschlüssel basierend auf `keyVersion` auswählen.
3. Eine Implementierung **SHOULD** mindestens eine vorherige Schlüsselversion vorhalten, um in-flight-Fragments zu unterstützen.

## 7.5 Roundtrip-Konsistenz der Verschlüsselung

Eine Implementierung **MUST** die folgenden Eigenschaften der Verschlüsselungs-Roundtrip-Konsistenz erfüllen:

1. Verschlüsseln und anschließendes Entschlüsseln mit dem **korrekten Schlüssel** (passend zum vom Sender verwendeten Schlüssel) **MUST** eine Ausgabe ergeben, die byteweise identisch zur ursprünglichen Payload ist.
2. Entschlüsseln mit einem **falschen Schlüssel** **MUST** fehlschlagen und **MUST** den Fehler `DECRYPTION_FAILED` (2001) zurückgeben.
3. Bei Entschlüsselungsfehler **MUST NOT** die Implementierung partielle Entschlüsselungsergebnisse oder beschädigte Daten zurückgeben.

## 7.6 Entschlüsselung auf der Endgeräteseite

Wenn das Endgerät als Empfänger fungiert (Dateneinspeisungs-Szenario):

1. Der DTP_Slave **MUST** den vom Endgerät während der CAP-Verbindungsaufbauphase übermittelten Schlüssel zur Entschlüsselung verwenden.
2. Dieser Schlüssel **MUST** dem privaten Schlüssel/Sitzungsschlüssel entsprechen, den das Endgerät in CAP übermittelt hat.
3. Das Endgerät **MUST NOT** das Entschlüsselungsergebnis irgendeines anderen Schlüssels akzeptieren.

## 7.7 Behandlung von Entschlüsselungsfehlern

Eine Implementierung **MUST** Entschlüsselungsfehler nach den folgenden Regeln behandeln:

1. Einzelner Entschlüsselungsfehler: Frame verwerfen und die Fehlerbenachrichtigung `DECRYPTION_FAILED` (2001) senden.
2. Aufeinanderfolgende Entschlüsselungsfehler, die einen Schwellenwert überschreiten (implementierungsdefiniert, **RECOMMENDED** 3):
   a. **SHOULD** CAP zur Neuverhandlung der Schlüssel auslösen.
   b. **SHOULD** die Anwendung der oberen Schicht über eine Sicherheitsanomalie benachrichtigen.
3. Die Implementierung **MUST NOT** denselben Frame nach mehreren Entschlüsselungsfehlern unbegrenzt wiederholen.

## 7.8 Minderung von Sicherheitsbedrohungen

Eine Implementierung **MUST** die folgenden Bedrohungen durch Protokolldesign mindern:

| Bedrohung | Minderungsmechanismus |
|-----------|------------------------|
| Man-in-the-Middle-Abhören | Ende-zu-Ende-Verschlüsselung der Payload |
| FayGer-Schnüffeln | Payload-Verschlüsselung; FayGer kann nur Geheimtext sehen |
| Schlüsselleck | Schlüsselversionsmechanismus unterstützt Schlüsselrotation |
| Identitätsfälschung | Delegiert an CAP zur Verifizierung |
| Replay-Angriffe | Monoton steigende Sequenznummern + Session-Bindung |
| Frame-Manipulation | Authentifizierte Verschlüsselungs-(AEAD-)Algorithmen |

## 7.9 Replay-Schutz

Eine Implementierung **MUST** Replay-Angriffe durch die folgenden Mechanismen mindern:

1. **Monoton steigende Sequenznummern**: Der Empfänger **MUST** Frames ablehnen, deren Sequenznummer kleiner oder gleich der höchsten bestätigten Sequenznummer ist (außer in Wiederaufnahme-Szenarien).
2. **Session-Bindung**: Der Sequenznummernraum **MUST** an eine bestimmte Session gebunden sein. Eine neue Session **MUST** die Sequenznummer zurücksetzen.
3. **AEAD-Authentifizierung**: Der Verschlüsselungsalgorithmus **MUST** Nachrichtenauthentifizierung bereitstellen (GCM, Poly1305 usw.).

## 7.10 Metadaten-Privatsphäre

Eine Implementierung **SHOULD** sich bewusst sein, dass die Klartext-Metadaten im Frame-Header die folgenden Informationen offenlegen **MAY**:

- Identitäten der Kommunikationspartner (über `agreementId` korreliert)
- Kommunikationszeitmuster (über `originTimestamp` und `sequenceNumber`)
- Datenübertragungsfrequenz (über Inter-Frame-Timing)

Eine Implementierung **MAY** die Metadaten-Privatsphäre verbessern durch:

1. Aktivieren von Verkehrs-Padding (implementierungsdefiniert).
2. Verwendung einer Verschleierungs-Transportschicht (z.B. ECH basierend auf TLS 1.3).

Diese Spezifikation **REQUIRES** jedoch **NOT**, dass eine Implementierung Metadaten-Privatsphärenschutz bereitstellt.
