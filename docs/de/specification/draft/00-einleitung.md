# Data Tunnel Protocol (DTP) Spezifikation

**Version**: Entwurf
**Zielversion**: 2025-10-25
**Status**: Entwurf, in Begutachtung
**Protokollschicht**: Anwendungsschicht

## Einleitung

Diese Spezifikation definiert das Drahtformat, die Zustandsmaschine, den Verhandlungsmechanismus, die Verschlüsselungsanforderungen, die Fehlerbehandlung und die Versionsverwaltungsregeln des Data Tunnel Protocol (DTP). DTP ist das im iFay-Ökosystem eingesetzte Anwendungsschicht-Protokoll für die bidirektionale Datenerfassung und -einspeisung zwischen Endgeräten und Fay.

Diese Spezifikation ist das **normative** Dokument von DTP. Jede dieser Spezifikation entsprechende Implementierung sollte mit anderen konformen Implementierungen interoperieren können.

## Konvention für Schlüsselwörter

Die Schlüsselwörter **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY** und **OPTIONAL** in diesem Dokument sind so zu interpretieren, wie in RFC 2119 und RFC 8174 beschrieben, und besitzen nur dann normative Bedeutung, wenn sie in **fetter** Form erscheinen.

## Dokumentstruktur

Diese Spezifikation besteht aus 10 Kapiteln:

| Kapitel | Titel | Geltungsbereich |
|---------|-------|------------------|
| Kapitel 1 | Überblick und Positionierung | Rolle, Designziele und Beziehung zu anderen Protokollen von DTP, Versionsverwaltung und Kompatibilität (§1.7, normativ) |
| Kapitel 2 | Terminologie und Definitionen | Normative Begriffsdefinitionen |
| Kapitel 3 | Protokollarchitektur | Protokollschichtung, Komponenten und Zustandsmaschine |
| Kapitel 4 | Logische Rahmenstruktur | Binärformat von Frame-Header und Payload |
| Kapitel 5 | Verhandlungsmechanismus | Aushandlung, Anpassung und Beendigung von Agreements |
| Kapitel 6 | Datenübertragung | Workflows für Datenerfassung und -einspeisung |
| Kapitel 7 | Sicherheit und Verschlüsselung | Anforderungen an die Ende-zu-Ende-Verschlüsselung |
| Kapitel 8 | Zuverlässigkeit | Wiederaufnahme, Bestätigung und Sitzungsverwaltung |
| Kapitel 9 | Fehlerbehandlung | Fehlercodes und Benachrichtigungsmechanismus |
| Kapitel 10 | Versionsverwaltung | Operative Mechanismen und Governance-Ablauf der Versionsverwaltung (maßgebliche Richtlinie in Kapitel 1 §1.7) |

## Konformität

Jede Entität, die behauptet, DTP zu implementieren (im Folgenden „Implementierung"), **MUST** die folgenden Konformitätsanforderungen erfüllen:

1. Die Implementierung **MUST** alle in dieser Spezifikation definierten **MUST**-Regeln vollständig unterstützen.
2. Die Implementierung **SHOULD** alle in dieser Spezifikation definierten **SHOULD**-Regeln unterstützen. Falls nicht unterstützt, **MUST** die Implementierung die Abweichung in ihrer Dokumentation explizit offenlegen.
3. Die Implementierung **MAY** wählen, ob sie **MAY**-Regeln unterstützt.
4. Die Implementierung **MUST NOT** Erweiterungen einführen, die in Konflikt mit dieser Spezifikation stehen. Jede Erweiterung **MUST** über die in dieser Spezifikation definierten Erweiterungsmechanismen umgesetzt werden (siehe benutzerdefinierte Felder in Kapitel 4, Erweiterungen der Agreement-Parameter in Kapitel 5).

## Normative Referenzen

- **RFC 2119** — Key words for use in RFCs to Indicate Requirement Levels
- **RFC 8174** — Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words
- **RFC 4122** — A Universally Unique IDentifier (UUID) URN Namespace (verwendet für Fragment_ID, Agreement_ID, Session_ID)
- **RFC 3339** — Date and Time on the Internet: Timestamps (UTC-Zeitstempelformat)
- **CAP-Spezifikation** — Control Authorization Protocol; DTP stützt sich auf CAP für Identitätsauthentifizierung und Schlüsselaustausch

## Verwandte Dokumente

- **DTP Blueprint** (`docs/de/blueprint/`): Nicht-normatives Einführungsmaterial zu DTP, das Motivation, Designhintergründe und Beispiele bereitstellt
- **DTP Schema** (`schema/draft/schema.ts`): Referenz-TypeScript-Typdefinitionen für DTP
