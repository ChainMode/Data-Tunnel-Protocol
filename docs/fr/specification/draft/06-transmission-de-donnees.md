# Chapitre 6 Transmission de données

## 6.1 Flux de données bidirectionnel

Une implémentation DTP **MUST** prendre en charge les deux directions indépendantes de flux de données suivantes :

| Direction | Nom | Émetteur | Récepteur |
|-----------|-----|----------|-----------|
| Terminal → Fay | Collecte de données | Slave | Master |
| Fay → Terminal | Injection de données | Master | Slave |

Les deux directions **MUST** satisfaire :

1. Utiliser le même format de LogicalFrame et le même flux de traitement.
2. Maintenir des espaces de numéros de séquence indépendants.
3. Maintenir des états de reprise indépendants (cache de Fragments non acquittés, numéro de séquence le plus élevé acquitté, etc.).
4. Être mutuellement non interférents : les changements d'état dans une direction **MUST NOT** affecter l'autre direction.

## 6.2 Flux de collecte de données (Terminal → Fay)

La collecte de données **MUST** suivre ce flux :

### 6.2.1 Flux côté émetteur (DTP_Slave)

1. Réceptionner les données soumises par l'application terminale.
2. Construire le Fragment :
   a. Générer un nouveau Fragment_ID (UUID v4).
   b. Positionner `agreementId` à l'Agreement_ID de l'Agreement actif courant.
   c. Positionner `originTimestamp` à l'horodatage UTC en millisecondes auquel les données ont été **réellement produites**. **MUST NOT** utiliser l'instant courant.
   d. Joindre les ContextMetadata structurées (voir Section 4.11).
   e. Joindre `dagDependencies` (**MAY** être un tableau vide).
3. Valider les dépendances DAG :
   a. Invoquer le DAG Manager pour vérifier qu'aucun cycle ne serait formé (voir Section 6.7).
   b. Si un cycle est détecté, **MUST** rejeter le Fragment et retourner l'erreur `DAG_CYCLE_DETECTED` (4001).
4. Construire le LogicalFrame :
   a. Positionner `frameType = "data"`.
   b. Appliquer les règles de compression d'Agreement_ID (voir Section 4.5).
   c. Affecter un `sequenceNumber` strictement croissant (direction de collecte de données).
   d. Renseigner les métadonnées de chiffrement.
5. Chiffrer le Payload : chiffrer le champ `data` du Fragment à l'aide de la clé pré-négociée par CAP.
6. Sérialiser le LogicalFrame.
7. Invoquer le Transport_Adapter pour envoyer les données binaires.
8. Ajouter le Fragment au cache des non-acquittés (voir Section 8.2).

### 6.2.2 Flux côté récepteur (DTP_Master)

1. Réceptionner les données binaires délivrées par le Transport_Adapter.
2. Désérialiser en un LogicalFrame. En cas d'échec, la trame **MUST** être abandonnée et l'erreur `FRAME_DESERIALIZATION_FAILED` (1001) **MUST** être retournée.
3. Valider la version du protocole (voir Chapitre 10).
4. Analyser l'Agreement_ID (appliquer les règles de compression de la Section 4.5). Si l'association est faite à un Agreement inconnu, la trame **MUST** être abandonnée et l'erreur `AGREEMENT_NOT_FOUND` (3001) **MUST** être retournée.
5. Déchiffrer le Payload. En cas d'échec, la trame **MUST** être abandonnée et l'erreur `DECRYPTION_FAILED` (2001) **MUST** être retournée.
6. Désérialiser en un Fragment.
7. Valider les dépendances DAG :
   a. Si toutes les dépendances cibles existent déjà, **MUST** accepter et marquer comme `accepted`.
   b. Si certaines dépendances cibles ne sont pas encore arrivées, **MUST** marquer comme `pending` et mettre en cache (voir Section 6.7).
   c. Si un cycle est détecté, **MUST** rejeter et retourner l'erreur `DAG_CYCLE_DETECTED` (4001).
8. Mettre à jour l'état de réception : positionner le sequenceNumber du Fragment comme le plus haut numéro de séquence reçu pour cette direction (s'il progresse).
9. Envoyer un acquittement (voir Chapitre 8).
10. Persister le Fragment dans le Personal Data Heap.

## 6.3 Flux d'injection de données (Fay → Terminal)

L'injection de données **MUST** suivre ce flux :

### 6.3.1 Flux côté émetteur (DTP_Master)

1. Interroger le Personal Data Heap et filtrer les données selon le `dataRange` de l'Agreement afin de produire un jeu de données minimisé.
2. Construire le Fragment (identique aux étapes 2-3 de la Section 6.2.1).
3. Construire le LogicalFrame, chiffrer le Payload, sérialiser et envoyer (identique aux étapes 4-8 de la Section 6.2.1), mais en utilisant l'espace de numéros de séquence de la direction d'injection de données.

### 6.3.2 Flux côté récepteur (DTP_Slave)

1. Désérialiser, valider la version, analyser l'Agreement_ID, déchiffrer, désérialiser le Fragment, valider le DAG (identique aux étapes 1-7 de la Section 6.2.2).
2. Mettre à jour l'état de réception et envoyer un acquittement (identique aux étapes 8-9 de la Section 6.2.2).
3. Délivrer le Fragment à l'application terminale.

## 6.4 Compression d'Agreement_ID en transmission

Une implémentation **MUST** suivre strictement les règles de compression d'Agreement_ID définies en Section 4.5.

### 6.4.1 Exemple de compression

Voici une séquence de transmission conforme à la spécification :

```
Fragment 1: agreementId = "abc-123"   (new Agreement, full ID)
Fragment 2: agreementId = null        (reuse "abc-123")
Fragment 3: agreementId = null        (reuse "abc-123")
Fragment 4: agreementId = "def-456"   (switch to a new Agreement, full ID)
Fragment 5: agreementId = null        (reuse "def-456")
```

### 6.4.2 Contraintes de compression

Une implémentation **MUST** satisfaire :

1. **MAY** choisir de ne pas compresser (c.-à-d. que tous les Fragments transportent l'Agreement_ID complet).
2. Si la compression est choisie, **MUST** suivre strictement la Section 4.5.
3. Le récepteur **MUST** prendre en charge à la fois les modes compressés et non compressés.
4. L'Agreement_ID de contexte **MUST** être réinitialisé à null après qu'une Session a été suspendue puis reprise (c.-à-d. que le premier Fragment après reprise **MUST** transporter l'ID complet).

## 6.5 Gestion des numéros de séquence

### 6.5.1 Croissance monotone

Le `sequenceNumber` de chaque Fragment **MUST** satisfaire :

1. Être strictement croissant au sein d'une même Session.
2. **SHOULD** être strictement contigu (c.-à-d. incrémenté de 1 à chaque fois).
3. **MUST NOT** se répéter ni régresser.

### 6.5.2 Indépendance par direction

La direction de collecte de données et la direction d'injection de données **MUST** maintenir des espaces de numéros de séquence indépendants :

```
Data collection direction (collection):  seq 1, 2, 3, 4, 5, ...
Data injection direction (injection):    seq 1, 2, 3, 4, 5, ...
```

Une implémentation **MUST NOT** partager l'espace de numéros de séquence entre les deux directions.

### 6.5.3 Redémarrage et Sessions

Les numéros de séquence **MUST** satisfaire :

1. Le numéro de séquence **MUST** être réinitialisé au début d'une nouvelle Session (**SHOULD** débuter à 0 ou 1).
2. Lorsqu'une Session est restaurée depuis l'état `Suspended`, le numéro de séquence **MUST** conserver sa valeur d'avant la suspension et **MUST NOT** être réinitialisé.
3. Si le numéro de séquence approche de la valeur maximale définie par l'implémentation, l'émetteur **MUST** établir proactivement une nouvelle Session afin d'éviter le débordement.

## 6.6 Préservation de l'horodatage d'origine

Une implémentation **MUST** garantir que l'Origin_Timestamp reste inchangé pendant la transmission :

1. L'émetteur **MUST** consigner l'instant auquel les données ont été **réellement produites** comme Origin_Timestamp.
2. La sérialisation, le chiffrement, la transmission, le déchiffrement et la désérialisation **MUST NOT** modifier l'Origin_Timestamp.
3. Le récepteur **MUST NOT** modifier l'Origin_Timestamp reçu.
4. Lors de la persistance, le récepteur **MUST** conserver l'Origin_Timestamp.

Une implémentation **SHOULD** maintenir un champ « horodatage de transmission » indépendant en dehors de l'en-tête de trame (défini par l'implémentation), mais **MUST NOT** le confondre avec l'Origin_Timestamp.

## 6.7 Gestion des dépendances DAG

### 6.7.1 Ajout de Fragments au DAG

Lorsque le récepteur reçoit un Fragment, il **MUST** traiter les dépendances via le DAG Manager :

1. Extraire les `dagDependencies` du Fragment.
2. Pour chaque dépendance :
   a. Vérifier si le Fragment_ID cible est déjà dans le DAG.
   b. Vérifier si l'ajout de cette arête formerait un cycle.
3. Retourner l'un des trois résultats suivants en fonction de l'issue de la vérification :

| Résultat | Signification | Action subséquente |
|----------|---------------|--------------------|
| `accepted` | Toutes les dépendances sont résolues ; pas de cycle | **MUST** ajouter le Fragment au DAG |
| `pending` | Certaines dépendances ne sont pas résolues (les Fragments cibles ne sont pas encore arrivés) ; pas de cycle | **MUST** mettre le Fragment en cache et attendre la résolution des dépendances |
| `rejected` | Un cycle est détecté | **MUST** rejeter le Fragment et retourner l'erreur `DAG_CYCLE_DETECTED` (4001) |

### 6.7.2 Résolution différée

Lorsqu'un Fragment est à l'état `pending` :

1. L'implémentation **MUST** continuer d'attendre les dépendances dans le cache pour ce Fragment.
2. Lorsque les Fragments cibles des dépendances arrivent, **MUST** réévaluer tous les Fragments `pending` associés dans le cache.
3. **MAY** définir une durée maximale de mise en cache (définie par l'implémentation). Après timeout, **SHOULD** retourner l'erreur `DAG_DEPENDENCY_UNRESOLVED` (4002) et abandonner.

### 6.7.3 Algorithme de détection de cycle

Une implémentation **MUST** détecter les cycles avant l'ajout d'un nouveau Fragment. L'algorithme de détection **SHOULD** utiliser une DFS (recherche en profondeur d'abord) ou l'algorithme de Tarjan.

Concrètement : depuis chaque cible de dépendance du nouveau Fragment, effectuer une DFS. Si le nouveau Fragment lui-même est atteignable depuis une cible de dépendance, un cycle est formé.

## 6.8 Transmission entrelacée multi-Agreement

Lorsque plusieurs Agreements actifs coexistent, l'émetteur **MUST** :

1. Associer chaque Fragment au bon Agreement via l'Agreement_ID dans l'en-tête de trame.
2. Lors du basculement d'Agreement (c.-à-d. que le Fragment suivant appartient à un Agreement différent), **MUST** transporter l'Agreement_ID complet dans ce Fragment (c.-à-d. que la compression null ne peut pas être utilisée).
3. **SHOULD** ordonnancer l'ordre d'envoi en fonction de la `priority` de chaque Agreement.
