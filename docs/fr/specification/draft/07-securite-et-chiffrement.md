# Chapitre 7 Sécurité et chiffrement

## 7.1 Modèle de sécurité

Une implémentation DTP **MUST** fournir un chiffrement de bout en bout. Le modèle de sécurité **MUST** satisfaire les invariants suivants :

1. Seule l'instance iFay cible **MUST** être en mesure de déchiffrer le Payload reçu.
2. L'environnement d'exécution FayGer **MUST NOT** accéder aux données en clair en aucune circonstance.
3. Les nœuds réseau intermédiaires **MUST NOT** lire le Payload en clair.
4. L'implémentation DTP **MUST NOT** gérer elle-même les clés de chiffrement.

## 7.2 Portée du chiffrement

La portée du chiffrement **MUST** être strictement limitée au Payload du LogicalFrame.

### 7.2.1 Contenu qui MUST être chiffré

Les données suivantes **MUST** être chiffrées :

- Le champ `payload` du LogicalFrame (c.-à-d. le champ `data` d'un Fragment et — lorsqu'ils sont transportés en tant que Frame — le contenu de RequestFrame, ResponseFrame et ControlFrame).

### 7.2.2 Contenu qui MUST NOT être chiffré

Les données suivantes **MUST NOT** être chiffrées et **MUST** être transmises en clair :

- Le `header` du LogicalFrame (incluant `protocolVersion`, `frameType`, `fragmentId`, `agreementId`, `originTimestamp`, `dagDependencies`, `encryptionMetadata` et `sequenceNumber`).

Les métadonnées de chiffrement elles-mêmes **MUST NOT** être chiffrées, afin que le récepteur puisse déterminer les paramètres de déchiffrement avant le déchiffrement.

## 7.3 Gestion des clés

### 7.3.1 Source des clés

Une implémentation DTP **MUST** utiliser la clé pré-négociée par CAP. Concrètement :

1. CAP **MUST** terminer la vérification d'identité et l'échange de clés pendant la phase d'établissement de la connexion.
2. L'implémentation DTP **MUST** utiliser la `sessionKey` fournie par CAP pour le chiffrement/déchiffrement du Payload.
3. L'implémentation DTP **MUST NOT** générer, négocier ou échanger elle-même de clés de chiffrement.

### 7.3.2 Interface CAPContext

Une implémentation DTP **MUST** recevoir le contexte fourni par CAP via l'interface suivante :

```typescript
interface CAPContext {
  identity: string;
  sessionKey: Uint8Array;
  verified: boolean;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `identity` | **MUST** être l'identifiant d'identité du pair |
| `sessionKey` | **MUST** être la séquence d'octets de la clé de session négociée par CAP |
| `verified` | **MUST** refléter le statut de vérification CAP |

### 7.3.3 Préconditions CAP

Une implémentation DTP **MUST** vérifier le CAPContext avant de démarrer la transmission de données :

1. Si `verified === false`, **MUST** refuser d'envoyer toute trame de données et retourner l'erreur `KEY_NOT_READY` (2002).
2. Si `sessionKey` est vide ou de longueur invalide, **MUST** retourner l'erreur `KEY_NOT_READY`.
3. La transmission de trames de négociation (Request_Frame, Response_Frame) est **également** soumise à cette précondition.

## 7.4 Métadonnées de chiffrement

L'en-tête de trame de chaque LogicalFrame **MUST** transporter les EncryptionMetadata :

```typescript
interface EncryptionMetadata {
  algorithm: string;
  keyVersion: number;
}
```

### 7.4.1 Identifiants d'algorithme

Le champ `algorithm` **MUST** être la chaîne identifiant l'algorithme de chiffrement. **SHOULD** utiliser l'un des noms standardisés suivants :

| Identifiant | Algorithme | Statut |
|-------------|------------|--------|
| `"AES-256-GCM"` | AES-256 en mode Galois/Counter | **RECOMMENDED** |
| `"ChaCha20-Poly1305"` | ChaCha20 avec Poly1305 | **RECOMMENDED** |
| `"AES-128-GCM"` | AES-128 en mode Galois/Counter | **MAY** être utilisé |

Une implémentation **MUST** prendre en charge au moins l'un des algorithmes `AES-256-GCM` et `ChaCha20-Poly1305`. Il est **RECOMMENDED** de prendre en charge les deux pour une interopérabilité accrue.

Une implémentation **MUST NOT** utiliser :

- Le mode ECB (non sûr)
- Les modes de chiffrement non authentifiés (CBC, CTR sans MAC)
- Les algorithmes présentant des faiblesses connues (DES, 3DES, RC4)

### 7.4.2 Numéro de version de la clé

`keyVersion` **MUST** être un entier non négatif utilisé pour prendre en charge la rotation des clés :

1. Lorsque CAP déclenche une rotation de clé, le `keyVersion` de la nouvelle clé **MUST** être strictement supérieur à la version précédente.
2. Le récepteur **MUST** sélectionner la clé de déchiffrement correspondante en fonction de `keyVersion`.
3. Une implémentation **SHOULD** conserver au moins une version de clé précédente pour prendre en charge les Fragments en cours de transit.

## 7.5 Cohérence aller-retour du chiffrement

Une implémentation **MUST** satisfaire les propriétés suivantes de cohérence aller-retour du chiffrement :

1. Chiffrer puis déchiffrer en utilisant la **bonne clé** (correspondant à la clé utilisée par l'émetteur) **MUST** produire une sortie identique octet par octet au Payload original.
2. Déchiffrer en utilisant une **clé incorrecte** **MUST** échouer et **MUST** retourner l'erreur `DECRYPTION_FAILED` (2001).
3. En cas d'échec de déchiffrement, l'implémentation **MUST NOT** retourner de résultats de déchiffrement partiels ni de données corrompues.

## 7.6 Déchiffrement côté terminal

Lorsque le terminal agit en tant que récepteur (scénario d'injection de données) :

1. Le DTP_Slave **MUST** utiliser pour le déchiffrement la clé soumise par le terminal lors de la phase d'établissement de connexion CAP.
2. Cette clé **MUST** correspondre à la clé privée/de session que le terminal a soumise dans CAP.
3. Le terminal **MUST NOT** accepter le résultat de déchiffrement provenant d'une autre clé.

## 7.7 Gestion des échecs de déchiffrement

Une implémentation **MUST** gérer les échecs de déchiffrement selon les règles suivantes :

1. Échec de déchiffrement isolé : abandonner la trame et envoyer la notification d'erreur `DECRYPTION_FAILED` (2001).
2. Échecs de déchiffrement consécutifs dépassant un seuil (défini par l'implémentation, **RECOMMENDED** à 3) :
   a. **SHOULD** déclencher une re-négociation des clés par CAP.
   b. **SHOULD** notifier l'application de couche supérieure d'une anomalie de sécurité.
3. L'implémentation **MUST NOT** retenter indéfiniment la même trame après plusieurs échecs de déchiffrement.

## 7.8 Mitigation des menaces de sécurité

Une implémentation **MUST** mitiger les menaces suivantes par la conception du protocole :

| Menace | Mécanisme de mitigation |
|--------|-------------------------|
| Écoute par homme du milieu | Chiffrement de bout en bout du Payload |
| Espionnage par FayGer | Chiffrement du Payload ; FayGer ne peut voir que le chiffré |
| Fuite de clé | Le mécanisme de version de clé prend en charge la rotation des clés |
| Usurpation d'identité | Délégué à CAP pour vérification |
| Attaques par rejeu | Numéros de séquence strictement croissants + liaison de Session |
| Falsification de trame | Algorithmes de chiffrement authentifié (AEAD) |

## 7.9 Protection contre le rejeu

Une implémentation **MUST** mitiger les attaques par rejeu via les mécanismes suivants :

1. **Numéros de séquence strictement croissants** : le récepteur **MUST** rejeter les trames dont le numéro de séquence est inférieur ou égal au plus haut numéro de séquence acquitté (sauf en scénario de reprise).
2. **Liaison de Session** : l'espace de numéros de séquence **MUST** être lié à une Session spécifique. Une nouvelle Session **MUST** réinitialiser le numéro de séquence.
3. **Authentification AEAD** : l'algorithme de chiffrement **MUST** fournir une authentification de message (GCM, Poly1305, etc.).

## 7.10 Confidentialité des métadonnées

Une implémentation **SHOULD** être consciente que les métadonnées en clair de l'en-tête de trame **MAY** divulguer les informations suivantes :

- Identités des pairs en communication (corrélées via `agreementId`)
- Schémas temporels de communication (via `originTimestamp` et `sequenceNumber`)
- Fréquence de transmission des données (via les délais inter-trames)

Une implémentation **MAY** renforcer la confidentialité des métadonnées via :

1. L'activation du remplissage de trafic (défini par l'implémentation).
2. L'utilisation d'une couche de transport avec obfuscation (par ex. ECH basé sur TLS 1.3).

Cependant, cette spécification **NE REQUIERT PAS** qu'une implémentation fournisse une protection de la confidentialité des métadonnées.
