# Chapitre 4 Structure de trame logique

## 4.1 Structure d'ensemble

Un LogicalFrame **MUST** être composé de deux parties :

```
+----------------+
|     Header     |   (plaintext)
+----------------+
|     Payload    |   (encrypted)
+----------------+
```

Définition formelle de LogicalFrame :

```typescript
interface LogicalFrame {
  header: FrameHeader;
  payload: Uint8Array;  // encrypted
}
```

## 4.2 FrameHeader

L'en-tête de trame **MUST** contenir les champs suivants. L'ordre du tableau ci-dessous est l'ordre normatif :

| Champ | Type | Requis | Chiffré | Description |
|-------|------|--------|---------|-------------|
| `protocolVersion` | `ProtocolVersion` | **REQUIRED** | Non | Version du protocole |
| `frameType` | `FrameType` | **REQUIRED** | Non | Type de trame |
| `fragmentId` | `FragmentID` | **REQUIRED** | Non | Identifiant unique du Fragment |
| `agreementId` | `AgreementID \| null` | **REQUIRED** | Non | Identifiant d'Agreement (**MAY** être null) |
| `originTimestamp` | `OriginTimestamp` | **REQUIRED** | Non | Horodatage d'origine (UTC ms) |
| `dagDependencies` | `DAGEdge[]` | **REQUIRED** | Non | Liste de dépendances DAG (**MAY** être un tableau vide) |
| `encryptionMetadata` | `EncryptionMetadata` | **REQUIRED** | Non | Métadonnées de chiffrement |
| `sequenceNumber` | `SequenceNumber` | **REQUIRED** | Non | Numéro de séquence de transmission |

L'en-tête de trame **MUST NOT** être chiffré. Tous les champs **MUST** être transmis en clair.

## 4.3 FrameType

`FrameType` **MUST** être l'une des quatre valeurs énumérées suivantes :

| Valeur | Usage | Contenu du Payload |
|--------|-------|--------------------|
| `"data"` | Transporte les données réelles d'un Fragment | Le champ `data` d'un Fragment |
| `"request"` | Initie une requête de données ou ajuste un Agreement de transmission | Le contenu sérialisé d'un RequestFrame |
| `"response"` | Répond à une requête de données | Le contenu sérialisé d'un ResponseFrame |
| `"control"` | Transmet des informations de contrôle telles que des notifications d'erreur ou la terminaison d'Agreement | Le contenu sérialisé d'un ControlFrame |

Une implémentation **MUST NOT** introduire de types de trame non listés.

## 4.4 ProtocolVersion

`ProtocolVersion` **MUST** être composé de deux entiers non négatifs :

```typescript
interface ProtocolVersion {
  major: number;
  minor: number;
}
```

La sémantique du numéro de version et la règle de classification des changements **MUST** être conformes aux règles définies au Chapitre 1 §1.7.2 (la source faisant autorité).

## 4.5 Compression d'Agreement_ID

Le champ `agreementId` **MAY** valoir `null` à des fins de compression. Les règles de compression **MUST** être conformes aux exigences suivantes :

1. Au sein d'un lot de Fragments consécutifs appartenant au même Agreement, **seul** le premier Fragment de l'en-tête de trame **MUST** transporter l'Agreement_ID complet.
2. Le champ `agreementId` des Fragments suivants **MAY** être positionné à `null`, indiquant la réutilisation du dernier Agreement_ID non null.
3. Le récepteur **MUST** maintenir un « Agreement_ID de contexte courant » et l'interpréter selon les règles suivantes :
   - Lorsqu'un Fragment dont `agreementId` est non null est reçu, sa valeur **MUST** être enregistrée comme Agreement_ID de contexte courant.
   - Lorsqu'un Fragment dont `agreementId` vaut null est reçu, il **MUST** être associé à l'Agreement_ID de contexte courant.
4. Si le récepteur reçoit un Fragment dont `agreementId` vaut null alors que l'Agreement_ID de contexte courant est également null, il **MUST** rejeter le Fragment et retourner l'erreur `AGREEMENT_NOT_FOUND` (3001).
5. Si le récepteur reçoit un Fragment référençant un Agreement_ID inconnu, il **MUST** rejeter le Fragment et retourner l'erreur `AGREEMENT_NOT_FOUND` (3001).

L'Agreement_ID de contexte courant du récepteur **MUST** être maintenu indépendamment pour chaque direction de transmission.

## 4.6 Origin_Timestamp

`originTimestamp` **MUST** satisfaire :

1. **MUST** utiliser le fuseau horaire UTC.
2. **MUST** comporter une précision à la milliseconde.
3. **MUST** être un entier non négatif (horodatage Unix en millisecondes).
4. **MUST** consigner l'instant auquel les données ont été réellement produites à la source, et **MUST NOT** consigner l'instant de transmission.
5. Après avoir traversé l'intégralité de la chaîne de transmission (sérialisation → chiffrement → transmission → déchiffrement → désérialisation), il **MUST** être strictement identique à sa valeur avant l'envoi.
6. Le récepteur **MUST NOT** modifier l'Origin_Timestamp reçu.

## 4.7 Dépendances DAG (DAGEdge)

`DAGEdge` **MUST** contenir les champs suivants :

```typescript
interface DAGEdge {
  targetFragmentId: FragmentID;
  relationType: DAGRelationType;
}
```

`DAGRelationType` **MUST** être l'une des trois valeurs énumérées suivantes :

| Valeur | Sémantique |
|--------|------------|
| `"derived_from"` | Ce Fragment est dérivé du Fragment cible |
| `"annotates"` | Ce Fragment annote/explique le Fragment cible |
| `"supersedes"` | Ce Fragment remplace le Fragment cible |

Le tableau `dagDependencies` **MAY** être vide (c.-à-d. que le Fragment n'a pas de dépendances).

## 4.8 EncryptionMetadata

`EncryptionMetadata` **MUST** contenir les champs suivants :

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `algorithm` | **MUST** être la chaîne identifiant l'algorithme de chiffrement (par ex. `"AES-256-GCM"`). **SHOULD** utiliser des noms d'algorithme enregistrés à l'IANA |
| `keyVersion` | **MUST** être un entier non négatif. Utilisé pour prendre en charge la rotation des clés |

Les métadonnées de chiffrement elles-mêmes **MUST NOT** être chiffrées et **MUST** être incluses en clair dans l'en-tête de trame.

## 4.9 Sequence_Number

`sequenceNumber` **MUST** satisfaire :

1. **MUST** être un entier non négatif.
2. **MUST** être strictement croissant au sein d'une même Session.
3. **MUST** être maintenu indépendamment pour chaque direction de transmission (collecte de données, injection de données).
4. L'espace de numéros de séquence **MUST NOT** être partagé entre les deux directions.
5. **SHOULD** débuter à 0 ou 1.
6. Si le numéro de séquence dépasse la capacité (une valeur maximale définie par l'implémentation), l'implémentation **MUST** y remédier en établissant une nouvelle Session et **MUST NOT** revenir à zéro par enroulement.

## 4.10 Structure du Fragment

Un Fragment **MUST** contenir les champs suivants :

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

Note : lorsque le champ `agreementId` d'un Fragment est sérialisé dans un LogicalFrame, il peut apparaître comme null dans l'en-tête du LogicalFrame en raison des règles de compression (voir Section 4.5), mais l'`agreementId` logique du Fragment lui-même **MUST** toujours être non null.

## 4.11 ContextMetadata

`ContextMetadata` **MUST** contenir les champs suivants :

```typescript
interface ContextMetadata {
  dataType: string;
  source: DataSource;
  customFields: Record<string, unknown>;
}
```

`DataSource` **MUST** être l'une des deux structures suivantes (une union discriminée distinguée par le champ `kind`) :

### 4.11.1 HardwareSource

Lorsque les données proviennent d'un capteur matériel, `source` **MUST** être :

```typescript
interface HardwareSource {
  kind: "hardware";
  sensorType: string;
  precision: string;
  samplingRate: number;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `kind` | **MUST** être la chaîne littérale `"hardware"` |
| `sensorType` | **MUST** être une chaîne non vide. **SHOULD** utiliser une nomenclature normalisée (par ex. `"accelerometer"`, `"heart_rate_monitor"`) |
| `precision` | **MUST** être une chaîne non vide décrivant la précision du capteur (par ex. `"±0.1°C"`) |
| `samplingRate` | **MUST** être un nombre positif, en Hz |

### 4.11.2 SoftwareSource

Lorsque les données proviennent d'un partage logiciel, `source` **MUST** être :

```typescript
interface SoftwareSource {
  kind: "software";
  appIdentifier: string;
  sharingMethod: string;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `kind` | **MUST** être la chaîne littérale `"software"` |
| `appIdentifier` | **MUST** être une chaîne non vide. **SHOULD** utiliser une notation en nom de domaine inversé (par ex. `"com.example.app"`) |
| `sharingMethod` | **MUST** être une chaîne non vide décrivant la méthode de partage (par ex. `"api_push"`, `"clipboard_capture"`) |

### 4.11.3 Champs personnalisés

`customFields` **MUST** être une map de chaîne vers une valeur arbitraire, et **MAY** être l'objet vide `{}`. Une implémentation **MUST NOT** dupliquer dans `customFields` des informations déjà présentes dans `dataType` ou `source`.

## 4.12 Exigences de sérialisation

La sérialisation d'un LogicalFrame **MUST** satisfaire les exigences normatives suivantes :

1. **Déterminisme** : un même objet LogicalFrame **MUST** produire la même sortie binaire.
2. **Cohérence aller-retour** : pour tout LogicalFrame valide, sérialiser puis désérialiser **MUST** produire un LogicalFrame équivalent à l'objet original.
3. **Complétude** : la sortie sérialisée **MUST** contenir tous les champs de l'en-tête de trame.
4. **Chiffrement du Payload** : avant la sérialisation, le Payload **MUST** déjà être chiffré à l'aide de l'algorithme spécifié dans EncryptionMetadata.

L'agencement binaire concret de la sérialisation (ordre des octets, encodage des champs) sera spécifié dans des drafts ultérieurs ; des formats binaires éprouvés tels que CBOR (RFC 8949) ou Protocol Buffers **SHOULD** être privilégiés.

## 4.13 Fragmentation physique

Lorsque le transport sous-jacent requiert une fragmentation (par ex. en raison des limites de MTU BLE) :

1. L'opération de fragmentation **MUST** être effectuée par le Transport_Adapter.
2. Le LogicalFrame **MUST** rester d'un seul tenant à la couche DTP_Engine.
3. Le Transport_Adapter du récepteur **MUST** réassembler le LogicalFrame complet avant de le passer au DTP_Engine.
