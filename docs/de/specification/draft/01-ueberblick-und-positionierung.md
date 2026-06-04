# Kapitel 1 Überblick und Positionierung

Dieses Kapitel definiert den Geltungsbereich des Protokolls (§1.1), die Protokoll-Positionierung (§1.2), die Beziehung zu CAP (§1.3), die Designziele (§1.4), das Master-Slave-Modell (§1.5) und die Konformitätsstufen (§1.6) von DTP und gibt in §1.7 „Versionsverwaltung und Kompatibilität" die Regeln der DTP-Versionsverwaltung in **normativer** Form an — sodass dieses Protokoll **seine eigene Versionsbeschreibung mitführt** und Standard-Implementierende es direkt einsehen können, ohne externe Dokumente durchsuchen zu müssen.

## 1.1 Geltungsbereich des Protokolls

Das Data Tunnel Protocol (DTP) **SHALL** das Anwendungsschicht-Protokoll sein, das innerhalb des iFay-Ökosystems für die bidirektionale Datenübertragung zwischen Endgeräten und Fay-Instanzen zuständig ist.

DTP **MUST** die folgenden zwei zentralen Datenflüsse implementieren:

1. **Datenerfassung**: Vom Endgerät (Slave) zu Fay (Master), eingesetzt, um vom Endgerät erzeugte Daten in iFays Personal Data Heap zu persistieren.
2. **Dateneinspeisung**: Von Fay (Master) zum Endgerät (Slave), eingesetzt, um Endgeräteanwendungen vorübergehend einen durch iFay gefilterten, minimierten Datensatz bereitzustellen.

DTP **MUST NOT** für andere Zwecke verwendet werden.

## 1.2 Protokoll-Positionierung

DTP **MUST** als Anwendungsschicht-Protokoll auf bestehenden Transportprotokollen aufsetzen, einschließlich, aber nicht beschränkt auf BLE, RTSP, WebSocket und TCP.

DTP **MUST** mit konkreten Transportprotokollen über die Abstraktionsschicht `Transport_Adapter` interagieren (siehe Abschnitt 3.4). Der DTP-Kern **MUST NOT** von den Implementierungsdetails eines bestimmten Transportprotokolls abhängen.

## 1.3 Beziehung zu CAP

DTP **MUST** im Zusammenspiel mit dem Control Authorization Protocol (CAP) arbeiten und folgender Aufgabenteilung folgen:

- **CAP** ist zuständig für Verbindungsautorisierung, Identitätsauthentifizierung und Schlüsselaustausch.
- **DTP** ist zuständig für die verhandlungsbasierte Datenstromübertragung.

Eine DTP-Implementierung **MUST** erst dann mit der Datenübertragung beginnen, wenn CAP die Identitätsauthentifizierung und den Schlüsselaustausch abgeschlossen hat. Wenn CAP nicht bereit ist, **MUST** die DTP-Implementierung das Senden von Daten verweigern und den Fehler `KEY_NOT_READY` (Fehlercode 2002, siehe Kapitel 9) zurückgeben.

## 1.4 Designziele

Eine DTP-Implementierung **MUST** die folgenden Designziele erfüllen:

| Ziel | Normative Anforderung |
|------|------------------------|
| Transportunabhängigkeit | Die DTP-Kernlogik **MUST** von jedem konkreten Transportprotokoll entkoppelt sein |
| Verhandlung zuerst | Jede Datenübertragung **MUST** auf einem etablierten Agreement basieren |
| Datensouveränität | Der Master **MUST** die endgültige Entscheidungsgewalt über Datenflüsse besitzen |
| Ende-zu-Ende-Verschlüsselung | Die Payload **MUST** in verschlüsselter Form übertragen werden |
| Kontexterhaltung | Jedes Fragment **MUST** strukturierte Kontext-Metadaten tragen |
| Wiederherstellbarkeit | Die Implementierung **MUST** die sequenznummern-basierte Wiederaufnahme unterstützen |

## 1.5 Master-Slave-Modell

DTP **MUST** zwischen den folgenden zwei Rollen unterscheiden:

- **Master**: Eine natürliche Person als Nutzer oder Fay (iFay / coFay). **MUST** das Recht zum Initiieren der Datenerfassung sowie das Entscheidungsrecht bei der Dateneinspeisung besitzen.
- **Slave**: Ein Software- oder Hardware-Endgerät. **MAY** ausschließlich Anfragen zur Dateneinspeisung initiieren; **MUST NOT** Anfragen zur Datenerfassung initiieren.

Eine DTP-Implementierung **MUST** die folgenden Einschränkungen durchsetzen:

1. Zu jedem Zeitpunkt **MUST NOT** ein einzelner Slave von mehr als einem Fay (Controller) gesteuert werden.
2. Ein Controller **MAY** andere Fays als Observer einladen.
3. Observer **MUST NOT** Anfragen initiieren oder Agreements ändern; sie **MUST** ausschließlich schreibgeschützte Kopien von Datenströmen empfangen.
4. Wenn der Master eine Datenerfassungsanfrage initiiert, **SHOULD** der Slave diese annehmen. Der Slave **MAY** ablehnen, aber die Ablehnung **MUST** mit einem Compliance-bezogenen Grund einhergehen (siehe Abschnitt 5.3.1).
5. Wenn der Slave eine Dateneinspeisungsanfrage initiiert, **MUST** der Master die volle Entscheidungsgewalt besitzen und **MAY** annehmen, ablehnen oder eine Alternative vorschlagen.

## 1.6 Konformitätsstufen

Eine Implementierung **MUST** ihre Konformitätsstufe deklarieren:

- **Volle Konformität**: Die Implementierung erfüllt alle **MUST**- und **SHOULD**-Regeln.
- **Kernkonformität**: Die Implementierung erfüllt alle **MUST**-Regeln, **MAY** jedoch einige **SHOULD**-Regeln nicht erfüllen.
- **Nicht-Konformität**: Die Implementierung erfüllt eine **MUST**-Regel nicht. Eine Implementierung, die behauptet, DTP zu sein, **MUST NOT** sich in diesem Zustand befinden.

## 1.7 Versionsverwaltung und Kompatibilität

> **Dieser Abschnitt ist normativ.** Dieser Abschnitt ist die **einzige maßgebliche Quelle (Single Source of Truth)** für die Regeln der DTP-Versionsverwaltung. Wo immer an anderer Stelle im Textkörper (einschließlich Kapitel 10 „Versionsverwaltung" und dem Änderungsprotokoll, falls vorhanden) auf Versionsregeln Bezug genommen wird, **MUST** sich diese Bezugnahme nach diesem Abschnitt richten und **MUST NOT** die hier festgelegten Regeln neu definieren.

Dieser Abschnitt ist in der folgenden festen Reihenfolge gegliedert: drei orthogonale Versionsachsen (§1.7.1) → `MAJOR.MINOR`-Semantik und Änderungsklassifizierung (§1.7.2) → Versionsaushandlung und Kompatibilitätsregeln (§1.7.3) → redaktionelle Ausgabe und Errata (§1.7.4) → Platzierungstabelle der Versionsnummer und Checkliste für Implementierende (§1.7.5).

### 1.7.1 Drei orthogonale Versionsachsen

DTP-Versionsinformationen **MUST** entlang dreier **zueinander orthogonaler** Achsen unabhängig verwaltet werden. Diese drei Achsen **MUST NOT** zu einer einzigen Versionsnummer zusammengeführt werden; jede Achse besitzt einen eigenen Wertebereich, einen eigenen Aufzeichnungsort und eine eigene Fortschreibungsregel, und eine Änderung auf einer Achse **MUST NOT** eine Änderung der anderen beiden erzwingen (die beobachtbare Definition von Orthogonalität).

| Achse | Bedeutung | Wertebereich | Aufzeichnungsort | Geht ins Drahtformat? |
|-------|-----------|--------------|------------------|------------------------|
| Protokollversion | Interoperabilitätsvertrag | `dtp/MAJOR.MINOR` (zwei Ebenen, **kein PATCH**; sowohl `MAJOR` als auch `MINOR` sind nicht-negative Ganzzahlen) | Frame-Header-Feld `protocolVersion`, Schema-Dateiname | **Ja** |
| Dokumentstatus | Dokument-Lebenszyklus | Enum `Draft / Final / Deprecated / Obsolete` (zu jedem Zeitpunkt genau ein Wert) | Front-Matter-Feld `status` | **Nein** |
| Redaktionelle Ausgabe | Errata und Klarstellungen | am Veröffentlichungsdatum verankertes `YYYY-MM-DD` (z. B. `2025-10-25`) | Front-Matter-Feld `date` und Veröffentlichungsverzeichnisname | **Nein** |

Zentrale Einschränkungen zu Dokumentstatus und Verzeichnissen (die vollständigen Verzeichniskonventionen und der Governance-Ablauf zur Finalisierung stehen in Kapitel 10, verankert an den Regeln dieses Abschnitts):

- Der Dokumentstatus **MUST** ein Front-Matter-Marker sein und **MUST NOT** in einen Dateipfad oder Verzeichnisnamen kodiert werden.
- Ob eine veröffentlichte Ausgabe aktuell `Final`, `Deprecated` oder `Obsolete` ist, wird **ausschließlich** durch das `status`-Feld ihrer Dateien bestimmt und **MUST NOT** aus dem Verzeichnisnamen abgeleitet werden.

### 1.7.2 `MAJOR.MINOR`-Semantik und Änderungsklassifizierung

#### MAJOR (Hauptversion)

`MAJOR` wird für **interoperabilitätsbrechende** Änderungen verwendet. Entscheidungsgrundlage: Wenn ein Gegenüber, das die alte Version `MAJOR.0` strikt implementiert, eine neue Nachricht **ablehnen oder fehlinterpretieren** würde, bricht die Änderung die Interoperabilität. Solche Änderungen umfassen, sind aber nicht beschränkt auf:

- Änderung der Semantik eines maßgeblichen Schema-Feldes;
- Entfernen einer Nachricht oder eines Fehlercodes;
- Neudefinition eines Fehlercodes;
- Änderung eines absorbierenden Zustands (absorbing state) der Zustandsmaschine.

WENN eine interoperabilitätsbrechende Änderung auftritt, **MUST** `MAJOR` um 1 erhöht werden und `MINOR` **MUST** auf 0 zurückgesetzt werden.

Interoperabilität ist über verschiedene `MAJOR`-Versionen hinweg **NICHT** garantiert.

#### MINOR (Nebenversion)

`MINOR` wird für **rückwärtskompatible** Ergänzungen verwendet, einschließlich, aber nicht beschränkt auf: Hinzufügen optionaler Felder, Hinzufügen von Nachrichten, Hinzufügen von Fehlercodes, Hinzufügen von Parametern, Hinzufügen von Attributen. Entscheidungsgrundlage: Ein Gegenüber, das die alte Version `MAJOR.0` strikt implementiert, würde die neue Nachricht weder ablehnen noch fehlinterpretieren.

WENN eine rückwärtskompatible Ergänzung auftritt, **MUST** `MINOR` um 1 erhöht werden und `MAJOR` **MUST** unverändert bleiben. Innerhalb desselben `MAJOR` **MUST** ein höheres `MINOR` rückwärtskompatibel bis `MAJOR.0` sein.

#### Änderungsklassifizierungsregel (geordnet, entscheidbar)

Für jede Änderung **MUST** ihre Platzierung in der folgenden Reihenfolge klassifiziert werden, was eine eindeutige Stufe ergibt:

1. Wenn ein Gegenüber, das die alte Version `MAJOR.0` strikt implementiert, die neue Nachricht **ablehnen oder fehlinterpretieren** würde → als **MAJOR** klassifizieren;
2. Andernfalls, wenn die Änderung **im Drahtformat sichtbare Inhalte** hinzufügt (Header/Nachricht/Fehlercode/Parameter oder eine andere auf der Leitung sichtbare Struktur) → als **MINOR** klassifizieren;
3. Andernfalls (reine Textänderung, keine Drahtformatänderung) → die Protokollversion **NICHT** ändern; stattdessen eine redaktionelle Ausgabe verwenden (siehe §1.7.4).
4. Wenn eine Änderung mehrere Stufen gleichzeitig erfüllt, **MUST** die **höhere Stufe** genommen werden.

### 1.7.3 Versionsaushandlung und Kompatibilitätsregeln

Dieser Unterabschnitt ist **normativ**.

#### Drahtformat-Einschränkungen

- **Nur** das `MAJOR.MINOR` der Protokollversion geht ins Drahtformat (d. h. das Frame-Header-Feld `protocolVersion` und der Schema-Dateiname).
- Die Protokollversion **MUST** immer ins Drahtformat gehen; eine Implementierung **MUST NOT** eine Konfiguration bereitstellen, die die Protokollversion aus dem Drahtformat ausschließt.
- Dokumentstatus und redaktionelle Ausgabe **MUST NOT** ins Drahtformat gehen. Eine Implementierung **MUST NOT** das Nachrichtenverarbeitungsverhalten auf Basis von Dokumentstatus oder redaktioneller Ausgabe ändern — das heißt, zwei im Drahtformat identische Nachrichten **MUST NOT** aufgrund unterschiedlicher Werte auf diesen beiden Achsen unterschiedliche Verarbeitungsergebnisse erzeugen.
- WENN einer empfangenen Nachricht die Protokollversionsinformation im Drahtformat fehlt (dem Header fehlt `protocolVersion`, oder es fehlt das Teilfeld `major` / `minor`, oder dessen Wert ist keine nicht-negative Ganzzahl), DANN **MUST** die Implementierung die Nachricht mit einem Protokollfehler ablehnen und **MUST NOT** sie unter einer Standard- oder abgeleiteten Version verarbeiten.

#### Aushandlungsregeln

- WENN ein Handshake oder Bootstrap durchgeführt wird, **MUST** beide Parteien jeweils ihre unterstützte Protokollversionsmenge deklarieren, die **MUST NOT** leer sein.
- Die Versionsauswahl **MUST** Folgendem folgen: zuerst das höchste von beiden gemeinsam unterstützte `MAJOR` nehmen, dann das höchste unter diesem `MAJOR` gemeinsam unterstützte `MINOR`.
- Die Partei mit dem höheren `MINOR` **MUST** in der Lage sein, das Gegenüber mit niedrigerem `MINOR` zu bedienen: Sie **MUST** die Nachrichten des Gegenübers gemäß der vom Gegenüber deklarierten niedrigeren Versionssemantik verarbeiten und **MUST NOT** allein deshalb ablehnen, weil das `MINOR` des Gegenübers niedriger ist.
- WENN die beiden Parteien kein gemeinsames `MAJOR` teilen, DANN **MUST** die Implementierung direkt mit einem Protokollfehler ablehnen und **MUST NOT** ein Best-Effort-Downgrade durchführen. (Die konkrete Bindung dieses Fehlers ist `VERSION_INCOMPATIBLE` / 7001 in Kapitel 10.)
- WENN eine Nachricht mit demselben `MAJOR`, aber höherem `MINOR` empfangen wird, **MUST** die Implementierung bekannte Felder mit der Semantik ihres eigenen höchsten `MINOR` interpretieren und nicht erkannte optionale Felder **ignorieren**; sie **MUST NOT** ablehnen, verwerfen oder einen Fehler auslösen.

#### Anmeldedaten und Cipher-Suites

- WENN ein rollierendes Versions-Upgrade durchgeführt wird, **MUST** die Implementierung bestehende, nicht abgelaufene Anmeldedaten oder Token gültig halten und **MUST NOT** sie allein wegen der Versionsänderung ungültig machen.
- WO das Protokoll bereits einen Cipher-Suite-Aushandlungsmechanismus besitzt, **MUST** die Versionsaushandlung denselben Ansatz wiederverwenden (jede deklariert, das gemeinsame Höchste nehmen).

> Die Aushandlungssequenz (Hello / Hello_Ack) und der Mechanismus „eine einzige Version innerhalb einer Sitzung, kein Wechsel mitten in der Sitzung" stehen in Kapitel 10.

### 1.7.4 Redaktionelle Ausgabe und Errata

Die Einschränkungen in diesem Unterabschnitt sind **nicht-normative** Governance-Einschränkungen; die Regel „MUST NOT als Upgrade tarnen" ist jedoch für die Korrektheit der Protokollversionsnummer bindend.

- WENN nach der Finalisierung reine Textkorrekturen durchgeführt werden (Behebung von Tippfehlern, Hinzufügen von Beispielen, Klärung der Formulierung, Reparatur von Links), **MUST** die Protokollversionsnummer (`MAJOR.MINOR`) unverändert bleiben; die Errata **MUST** durch ein **neues Veröffentlichungsdatum-Verzeichnis** getragen werden, und bestehende veröffentlichte Verzeichnisse **MUST** eingefroren bleiben, sodass alte Verweise und Links **MUST NOT** zerstört werden.
- Eine redaktionelle Ausgabe **SHOULD** im Änderungsprotokoll (falls vorhanden) unter einer `Editorial`-Kategorie registriert werden; das Front Matter **MUST** ihre Ausgabe mit den Feldern `edition` / `date` kennzeichnen.
- Eine redaktionelle Ausgabe erlaubt **nur** nicht-normative Änderungen und **MUST NOT** die Drahtformat-Semantik, normative Aussagen, Fehlercodes, die Zustandsmaschine oder das Interoperabilitätsverhalten berühren.
- **Harte Einschränkung**: WENN eine Änderung die Drahtformat-Semantik berührt, DANN **MUST** sie gemäß §1.7.2 `MINOR` oder `MAJOR` erhöhen und **MUST NOT** als Errata-(redaktionelle Ausgabe-)Veröffentlichung getarnt werden.

### 1.7.5 Platzierungstabelle der Versionsnummer und Checkliste für Implementierende

#### Platzierungstabelle

| Platzierungspunkt | Was dort steht | Normative Einschränkung |
|-------------------|----------------|--------------------------|
| Drahtumschlag-Feld `protocolVersion` | `MAJOR.MINOR` | Trägt **nur** `MAJOR.MINOR`, keine andere Ebene |
| Schema-Dateiname | folgt `MAJOR.MINOR` | **MUST NOT** mit der redaktionellen Ausgabe umbenannt werden (hält Verweise stabil) |
| content-type | `application/dtp` | Identifiziert die Protokollfamilie; sein `version=`-Parameter ist **nur** eine Gateway-Routing-Erleichterung und **NICHT** Drahtformat-Semantik |
| Front Matter `status` / `date` | Dokument-Governance-Marker | **NICHT** im Drahtformat |
| git tag | `dtp-v<MAJOR.MINOR>-<status>` | Das Tag **MUST** Textkörper + Testvektoren + Schema gemeinsam abdecken |

#### Checkliste für Implementierende (Pflichtlektüre)

- Interoperabilität **nur** anhand der Protokollversion (`MAJOR.MINOR`) beurteilen; **MUST NOT** sich auf Dokumentstatus oder redaktionelle Ausgabe verlassen.
- Dasselbe `MAJOR` **MUST** rückwärtskompatibel bis `MAJOR.0` sein.
- **MUST NOT** Errata (redaktionelle Ausgaben) als Protokoll-Upgrades behandeln.
- **MUST NOT** sich auf den Schema-Dateinamen verlassen, um die redaktionelle Ausgabe zu kodieren.
- Während `Draft` gibt es **KEINE** Kompatibilitätszusage.

> Die vollständigen Verzeichnis- und Statuskonventionen sowie die Standardaktionen zur Finalisierung (Draft → Final) stehen in Kapitel 10 „Protokollentwicklung und Governance"; das dort referenzierte git-Tag-Format, die Statusaufzählung und die Definition der redaktionellen Ausgabe **MUST** an diesem Abschnitt (§1.7) verankert sein.
