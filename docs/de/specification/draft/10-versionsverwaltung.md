# Kapitel 10 Versionsverwaltung

> **Erklärung zur maßgeblichen Quelle (Single Source of Truth).** Die **Richtlinie** der DTP-Versionsverwaltung wird durch Kapitel 1 §1.7 „Versionsverwaltung und Kompatibilität" als **einzige maßgebliche Quelle** definiert. Dieses Kapitel **MUST NOT** die in §1.7 bereits festgelegte Richtlinie neu definieren; dieses Kapitel stellt nur die **operativen Mechanismen** der §1.7-Regeln bereit (Drahtformat-Bindung, konkrete Fehlercode-Payloads, Aushandlungssequenz, Implementierungsdeklarations-Vorlage) sowie den **Governance-Ablauf** (Verzeichnis- und Statuskonventionen, Finalisierungsaktionen). Wann immer eine Aussage in diesem Kapitel mit §1.7 mehrdeutig ist, **MUST** §1.7 Vorrang haben.

## 10.1 Versionsnummern-Format (operative Referenz)

Die Semantik der DTP-Protokollversionsnummer, die zweistufige `MAJOR.MINOR`-Struktur (kein PATCH), die Änderungsklassifizierungsregel und die Definitionen der orthogonalen Achsen stehen in §1.7.1 und §1.7.2 und werden hier nicht wiederholt.

Drahtformat-Bindung: Der Frame-Header jedes LogicalFrame **MUST** das vollständige Feld `ProtocolVersion` tragen (siehe Abschnitt 4.4):

```typescript
interface ProtocolVersion {
  major: number;  // nicht-negative Ganzzahl
  minor: number;  // nicht-negative Ganzzahl
}
```

Die durch diese Spezifikation definierte anfängliche Protokollversion **MUST** `{ major: 1, minor: 0 }` (d. h. `dtp/1.0`) sein.

## 10.2 Versions-Kompatibilitätsmatrix (operative Ergänzung zu §1.7.3)

> Die normativen Regeln zu Kompatibilität und Aushandlung stehen in §1.7.3. Die folgende Tabelle ist ihre operative Umsetzung auf der Ebene der Frame-Verarbeitung und **MUST** gemäß §1.7.3 gelesen werden; bei Mehrdeutigkeit hat §1.7.3 Vorrang.

| Empfangene Frame-Version | Behandlung |
|--------------------------|------------|
| Gleich der höchsten Version des Empfängers | Normal verarbeiten |
| Gleich der vorherigen Hauptversion der höchsten Version des Empfängers (major - 1) | Kompatibilitätsbehandlung (gemäß älterer Spezifikation verarbeiten) |
| Höher als die höchste Version des Empfängers | **MUST** `VERSION_INCOMPATIBLE` (7001) zurückgeben |
| Hauptversion niedriger als (höchste Version des Empfängers - 1) | **MUST** `VERSION_INCOMPATIBLE` (7001) zurückgeben |
| Gleiche Hauptversion, niedrigere Nebenversion | Normal verarbeiten (rückwärtskompatibel) |
| Gleiche Hauptversion, höhere Nebenversion | **SHOULD** verarbeiten (unbekannte optionale Felder ignorieren) |

### 10.2.1 Toleranz gegenüber Nebenversionen (operative Umsetzung von §1.7.3)

Wenn eine Implementierung einen Frame mit derselben Hauptversion, aber höherer Nebenversion empfängt, **MUST** sie:

1. Bekannte Felder verarbeiten;
2. **SHOULD** unbekannte optionale Felder ignorieren;
3. **MUST NOT** den gesamten Frame aufgrund unbekannter optionaler Felder ablehnen;
4. **MUST NOT** einen Fehler auslösen.

## 10.3 Behandlung von Versions-Inkompatibilität (operativer Mechanismus)

### 10.3.1 Behandlung durch den Empfänger

Wenn der Empfänger einen LogicalFrame empfängt, dessen Protokollversion höher ist als die von ihm unterstützte Version (und den Kompatibilitätsbereich überschreitet), **MUST** er:

1. Den Frame **nicht verarbeiten**;
2. Den Fehler `VERSION_INCOMPATIBLE` (7001) an den Sender senden;
3. Seine höchste unterstützte Version im Feld `details` der Fehlerbenachrichtigung einschließen:

```typescript
{
  errorCode: 7001,
  errorMessage: "Protocol version higher than supported",
  details: {
    supportedMaxVersion: { major: 1, minor: 0 }
  }
}
```

> Die Semantik des Fehlercodes `7001` richtet sich nach der Fehlercodetabelle in Kapitel 9 und dem Schema; dieses Kapitel definiert sie nicht neu.

### 10.3.2 Behandlung durch den Sender

Nach Empfang des Fehlers `VERSION_INCOMPATIBLE` **MAY** der Sender wählen:

1. **Auf die vom Gegenüber unterstützte Version downgraden** und den Frame erneut senden (**SHOULD** bevorzugt werden, sofern ein gemeinsames `MAJOR` existiert; kein Downgrade über `MAJOR` hinweg, siehe §1.7.3);
2. **Die Anwendung der oberen Schicht** über die Versions-Inkompatibilität benachrichtigen, und **MUST NOT** unbegrenzt automatisch wiederholen.

Eine Implementierung **MUST NOT** die Session sofort schließen, nachdem ein Versions-Inkompatibilitätsfehler empfangen wurde, und **SHOULD** die Möglichkeit zum Downgrade lassen.

### 10.3.3 Versionskonsistenz innerhalb der Sitzung und Aushandlungssequenz

Wenn eine DTP-Session aufgebaut wird, **MUST** beide Parteien eine konsistente Protokollversion aushandeln (Aushandlungsregeln in §1.7.3). Während der Sitzung:

1. **MUST** während der gesamten Sitzung die einheitliche Version verwendet werden;
2. **MUST NOT** Protokollversionen mitten in einer Sitzung gewechselt werden.

Die Versionsaushandlung **SHOULD** der folgenden Sequenz folgen; der konkrete Träger (CAP-Erweiterungen, der erste Request_Frame/Response_Frame usw.) **MAY** von der Implementierung gewählt werden, aber die Aushandlung **MUST** abgeschlossen sein, bevor der erste Daten-Frame gesendet wird:

```
DTP_A                              DTP_B
  |                                   |
  |-- Hello (supported_versions) --->|
  |                                   |
  |<-- Hello_Ack (chosen_version) ---|
  |                                   |
  |    [beide Seiten verwenden chosen_version]|
```

## 10.4 Protokollentwicklung und Governance

Dieser Abschnitt stellt den operativen Ablauf der §1.7-Governance-Regeln bereit. Das hierin referenzierte git-Tag-Format, die Dokumentstatus-Aufzählung und die Definition der redaktionellen Ausgabe **MUST** an §1.7 verankert sein; dieser Abschnitt definiert sie nicht neu.

### 10.4.1 Verzeichnis- und Statuskonventionen (konsistent mit Faying Protocol)

- Der Dokumentstatus ist ein Front-Matter-Marker und **MUST NOT** in den Pfad kodiert werden (siehe §1.7.1).
- Unter `specification/` **MUST** genau ein veränderbarer Arbeitsbereich `draft/` beibehalten werden (rollierend aktualisiert).
- Alle Verzeichnisse außer `draft/` **MUST** nach Veröffentlichungsdatum benannt werden (z. B. `2025-10-25/`) und repräsentieren eine **eingefrorene** veröffentlichte Ausgabe; „nicht Entwurf bedeutet veröffentlicht".
- Ob eine veröffentlichte Ausgabe aktuell `Final`, `Deprecated` oder `Obsolete` ist, wird **ausschließlich** durch das `status`-Feld ihrer Dateien bestimmt und **MUST NOT** aus dem Verzeichnisnamen abgeleitet werden.
- Das Anlegen statusbenannter Verzeichnisse (z. B. `final/`) ist **VERBOTEN** — andernfalls würde das Verwerfen einer Ausgabe das Verschieben von Verzeichnissen und das Brechen von Links erfordern.
- WENN ein Statusübergang erfolgt, **MUST** **nur** das Front-Matter-Feld `status` geändert werden, und Verzeichnisse **MUST NOT** verschoben werden.

### 10.4.2 Entwurfs- und offizielle Versionen

- Entwurf: Dokumente liegen in `docs/{lang}/specification/draft/`, Schema in `schema/draft/`; Entwurfsversionsnummern **MAY** `{ major: 0, minor: N }` verwenden. Während `Draft` gibt es **KEINE** Kompatibilitätszusage (siehe §1.7.5), und Entwürfe **MUST NOT** in Produktion eingesetzt werden.
- Offizielle Version: **MUST** eine vollständige Begutachtung und öffentliche Diskussion durchlaufen haben und einen unveränderlichen Versions-Snapshot besitzen; Dokumente liegen in `docs/{lang}/specification/{YYYY-MM-DD}/`, Schema in `schema/{YYYY-MM-DD}/`. Die erste offizielle Version ist `2025-10-25`, entsprechend der Protokollversion `dtp/1.0`.
- Unveränderlichkeit von Versions-Snapshots: Sobald eine offizielle Version veröffentlicht ist, **MUST** sie unverändert bleiben; reine Textkorrekturen werden gemäß §1.7.4 durch ein **neues Veröffentlichungsdatum-Verzeichnis** getragen, wobei bestehende Verzeichnisse eingefroren bleiben, und der Spezifikationsinhalt oder das Schema eines veröffentlichten Snapshots **MUST NOT** an Ort und Stelle überschrieben werden.

### 10.4.3 Standardaktionen zur Finalisierung (Draft → Final)

WENN eine Finalisierung durchgeführt wird, **MUST** der Doc Governance Process die folgenden Aktionen der Reihe nach abschließen:

1. Mittels `git mv` alle Dateien unter `draft/` in das Veröffentlichungsdatum-Verzeichnis migrieren (Dateinamen unverändert) und `draft/` leeren;
2. Pro Datei `status` von `Draft` auf `Final` ändern;
3. `date` auf das offizielle Veröffentlichungsdatum festschreiben, `editors` auf die Finalisierungs-Signaturliste sperren und `version` unverändert lassen;
4. Die `replaces`-Historienkette (verweisend auf das Entwurfsverzeichnis und seinen Finalisierungs-Commit-Kurzhash) im README-Front-Matter eintragen;
5. Das Tag `dtp-v<MAJOR.MINOR>-final` setzen, das **MUST** Textkörper + Testvektoren + Schema gemeinsam abdecken;
6. Wenn mehrere Sprachen / Dateien beteiligt sind, **MUST** sie gemeinsam im selben Commit migriert werden; einseitige Veröffentlichung ist **verboten**.

### 10.4.4 Veraltung und Entfernung

Eine Implementierung **SHOULD** Funktionalität durch den folgenden Prozess als veraltet markieren:

1. **Als veraltet markieren**: Funktionalität in einer `MINOR`-Version als veraltet markieren, **MUST** sie aber weiterhin unterstützen;
2. **Übergangszeitraum**: mindestens ein vollständiger `MAJOR`-Versionszyklus;
3. **Entfernung**: in der nächsten `MAJOR`-Version entfernen.

Eine Implementierung **MUST NOT** veraltete Funktionalität in einer `MINOR`-Version entfernen.

## 10.5 Implementierungsdeklaration

Eine DTP-Implementierung **MUST** in ihrer Dokumentation deklarieren:

1. Die höchste unterstützte Protokollversion;
2. Alle unterstützten vorherigen Hauptversionen;
3. Ob Vorwärtskompatibilität unterstützt wird (Verarbeitung von Frames mit höheren Nebenversionen);
4. Implementierungsdefinierte Erweiterungen, falls vorhanden.

Zum Beispiel:

> **Versionsdeklaration der DTP-Implementierung X:**
>
> - Höchste unterstützte Protokollversion: 1.0
> - Kompatible vorherige Versionen: keine (erste offizielle Version)
> - Vorwärtskompatibilität: unterstützt; ignoriert unbekannte optionale Felder
> - Verschlüsselungsalgorithmen: AES-256-GCM, ChaCha20-Poly1305
> - Transportadapter: BLE, WebSocket, TCP
