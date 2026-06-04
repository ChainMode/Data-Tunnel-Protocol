# Chapitre 8 Fiabilité

## 8.1 Modèle de fiabilité

Une implémentation DTP **MUST** fournir les garanties de fiabilité suivantes :

1. **Reprise** : après que la connexion sous-jacente est interrompue, la transmission est reprise ; les données déjà reçues avec succès **MUST NOT** être retransmises.
2. **Acquittement** : le récepteur **MUST** acquitter à l'émetteur les Fragments qui ont été reçus avec succès.
3. **Retransmission** : l'émetteur **MUST** retransmettre les Fragments non acquittés lorsqu'aucun acquittement n'est reçu dans le délai imparti.
4. **Persistance de Session** : lorsque la connexion sous-jacente est interrompue, l'état de la Session **MUST** être persisté.

## 8.2 Mécanisme de reprise

### 8.2.1 Protocole de reprise

La reprise **MUST** être implémentée à partir des numéros de séquence, en suivant ce flux :

```
Sender                                Receiver
   |                                     |
   |-- Fragment (seq=1) ---------------->|  ✓ received
   |-- Fragment (seq=2) ---------------->|  ✓ received
   |-- Fragment (seq=3) ---------------->|  ✓ received
   |-- Fragment (seq=4) -------- ✗ -----|  connection lost
   |                                     |
   |        [connection restored]        |
   |                                     |
   |<-- ResumeReport (highest=3) --------|
   |                                     |
   |-- Fragment (seq=4) ---------------->|  resume from breakpoint
   |-- Fragment (seq=5) ---------------->|
```

### 8.2.2 ResumeReport

Une fois la connexion restaurée, le récepteur **MUST** envoyer un ResumeReport défini ainsi :

```typescript
interface ResumeReport {
  collectionHighest: SequenceNumber;
  injectionHighest: SequenceNumber;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `collectionHighest` | **MUST** être le plus haut numéro de séquence reçu avec succès par le récepteur dans la direction de collecte de données |
| `injectionHighest` | **MUST** être le plus haut numéro de séquence reçu avec succès par le récepteur dans la direction d'injection de données |

Si une direction n'a pas encore reçu de Fragment, le champ correspondant **MUST** valoir -1 ou une valeur sentinelle « non reçu » définie par l'implémentation.

### 8.2.3 Cohérence de la reprise

Après réception d'un ResumeReport, l'émetteur **MUST** suivre strictement :

1. **Reprendre au numéro de séquence suivant** : reprendre l'envoi à partir de `highest + 1`.
2. **Pas d'envoi en double** : **MUST NOT** renvoyer de Fragment dont le numéro de séquence est `<= highest`.
3. **Pas de saut** : **MUST NOT** sauter de Fragment non acquitté (c.-à-d. ceux non confirmés en cache).

## 8.3 Mécanisme d'acquittement

### 8.3.1 Méthodes d'acquittement

Une implémentation **MUST** fournir l'acquittement de réception de Fragment. L'acquittement **MAY** être implémenté via l'une des méthodes suivantes :

1. **Trame de contrôle ACK explicite** : le récepteur envoie une ControlFrame avec `controlType = "ack"`, où `details` contient le plus haut numéro de séquence acquitté.
2. **ACK cumulatif** : transporter le plus haut numéro de séquence reçu de la direction inverse dans un champ d'extension de chaque trame de données (**RECOMMENDED**).
3. **ACK groupé** : envoyer un ACK toutes les N réceptions de Fragment (N est défini par l'implémentation ; **RECOMMENDED** à 16).

La méthode d'acquittement spécifique **MAY** être choisie par l'implémentation, mais le récepteur et l'émetteur **MUST** s'accorder sur la méthode choisie.

### 8.3.2 Synchronisation de l'acquittement

Le récepteur **MUST** satisfaire :

1. N'acquitter que lorsque le Fragment a passé le déchiffrement, la validation de l'Agreement et la validation DAG.
2. **MUST NOT** acquitter tant que l'état DAG est `pending` (l'acquittement devrait être différé jusqu'à la résolution des dépendances).
3. Le plus haut numéro de séquence dans l'ACK **MUST** être le maximum du préfixe contigu de l'ensemble des numéros de séquence acquittés.

## 8.4 Mécanisme de retransmission

### 8.4.1 Stratégie de retransmission

L'émetteur **MUST** retransmettre dans les conditions suivantes :

1. L'ACK pour un numéro de séquence donné n'est pas reçu dans le délai de retransmission configuré par le protocole.
2. Sur réception d'un ResumeReport, retransmettre les Fragments non acquittés.

### 8.4.2 Configuration de la retransmission

Une implémentation **SHOULD** fournir les paramètres configurables suivants :

| Paramètre | Valeur par défaut (**RECOMMENDED**) | Description |
|-----------|--------------------------------------|-------------|
| Délai de retransmission initial | 5 secondes | Temps d'attente pour la première retransmission |
| Facteur de back-off de retransmission | 2 | Le délai double après chaque retransmission (back-off exponentiel) |
| Nombre maximum de retransmissions | 5 | Notifier la couche supérieure de l'échec au-delà de ce nombre |
| Délai de retransmission maximum | 60 secondes | Limite supérieure du délai de retransmission |

Une implémentation **MUST** implémenter un algorithme de back-off exponentiel.

### 8.4.3 Gestion de l'échec de retransmission

Lorsque le nombre de retransmissions dépasse la borne supérieure :

1. L'émetteur **MUST** notifier l'application de couche supérieure de l'erreur `RETRANSMISSION_TIMEOUT` (6002).
2. L'émetteur **SHOULD** déclencher la suspension ou la terminaison de la Session (défini par l'implémentation).
3. L'implémentation **MUST NOT** retransmettre indéfiniment.

## 8.5 Gestion du cache

### 8.5.1 Cache des Fragments non acquittés

L'émetteur **MUST** maintenir un cache de Fragments non acquittés satisfaisant :

1. Tout Fragment qui a été envoyé mais pas encore acquitté **MUST** être conservé dans le cache.
2. Après réception d'un acquittement, le Fragment acquitté **MUST** être retiré du cache.
3. Le cache **MUST** avoir une borne supérieure de capacité (définie par l'implémentation ; **RECOMMENDED** à pas moins de 1024 Fragments ou 16 Mo).

### 8.5.2 Gestion du cache plein

Lorsque le cache atteint sa borne supérieure de capacité, l'émetteur **MUST** :

1. Suspendre l'envoi de nouveaux Fragments.
2. Notifier l'application de couche supérieure via l'erreur `BUFFER_FULL` (6001).
3. Reprendre l'envoi une fois que de l'espace de cache a été libéré par les acquittements.
4. **MUST NOT** abandonner silencieusement de Fragment.

## 8.6 Gestion de Session

### 8.6.1 Établissement de Session

Après que CAP a terminé la vérification d'identité et l'échange de clés, le DTP_Engine **MUST** établir une Session DTP :

1. **MUST** générer un Session_ID unique (UUID v4) conforme à la RFC 4122.
2. **MUST** initialiser la structure de données de la Session (voir Section 8.6.3).
3. **MUST** faire transiter l'état de `WaitingForCAP` à `SessionEstablished`.

### 8.6.2 Maintien de l'état de Session

Pendant une Session, le DTP_Engine **MUST** maintenir l'état de transmission bidirectionnel :

```typescript
interface DirectionalTransferState {
  currentSequenceNumber: SequenceNumber;
  highestAcknowledgedSequenceNumber: SequenceNumber;
  unacknowledgedFragmentCache: Map<SequenceNumber, Fragment>;
}
```

L'implémentation **MUST** maintenir un DirectionalTransferState indépendant pour chaque direction de transmission :

| Direction | Nom du champ |
|-----------|--------------|
| Collecte de données (Terminal → Fay) | `collectionState` |
| Injection de données (Fay → Terminal) | `injectionState` |

### 8.6.3 Structure de données de la Session

La structure complète de la Session **MUST** contenir :

```typescript
interface Session {
  sessionId: SessionID;
  masterIdentity: string;
  slaveIdentity: string;
  state: SessionState;
  activeAgreements: Map<AgreementID, Agreement>;
  collectionState: DirectionalTransferState;
  injectionState: DirectionalTransferState;
  createdAt: number;
  lastActivityAt: number;
  timeoutThreshold: number;
}
```

### 8.6.4 Persistance de Session

Lorsque la connexion de transport sous-jacente est déconnectée, le DTP_Engine **MUST** :

1. Faire transiter immédiatement le SessionState de `Transmitting` à `Suspended`.
2. Persister sur stockage non volatil :
   - L'objet Session complet (incluant tous les Agreements actifs)
   - Les DirectionalTransferState bidirectionnels
   - Le cache des Fragments non acquittés
3. La persistance **MUST** être atomique (soit toutes les opérations réussissent, soit toutes échouent).

### 8.6.5 Restauration de Session

Une fois la connexion sous-jacente rétablie, le DTP_Engine **MUST** suivre le flux de récupération suivant :

1. Attendre la re-vérification CAP.
2. Après que la vérification CAP a réussi, entrer dans l'état `Resuming`.
3. Restaurer l'état de la Session depuis le stockage persistant.
4. Le récepteur envoie un ResumeReport (voir Section 8.2.2).
5. Sur la base du ResumeReport, l'émetteur reprend la transmission depuis le point de rupture.
6. Une fois la poignée de main de reprise terminée, faire transiter à `Transmitting`.

Si la restauration échoue, le DTP_Engine **MUST** :

1. Faire transiter à l'état `Idle`.
2. Libérer toutes les ressources associées.
3. Notifier la couche supérieure via l'erreur `SESSION_RESTORE_FAILED` (5003).

### 8.6.6 Timeout de Session

Une implémentation **MUST** implémenter un mécanisme de timeout de Session :

1. **MUST** maintenir un champ `lastActivityAt` consignant l'instant de la dernière activité.
2. Lorsque `now - lastActivityAt > timeoutThreshold`, la Session **MUST** être marquée comme arrivée à expiration.
3. Une Session arrivée à expiration **MUST** être close et les ressources associées **MUST** être libérées.
4. Le `timeoutThreshold` par défaut est **RECOMMENDED** à 30 minutes (1 800 000 ms).

## 8.7 Indépendance bidirectionnelle

Une implémentation **MUST** garantir strictement l'indépendance des deux directions de transmission :

1. Les changements d'état dans la direction de collecte de données **MUST NOT** affecter la direction d'injection de données.
2. Une anomalie de connexion dans une direction **MUST NOT** déclencher automatiquement un changement d'état dans l'autre direction (sauf si la connexion sous-jacente est totalement déconnectée).
3. Les numéros de séquence d'une direction **MUST NOT** entrer dans l'espace de numéros de séquence de l'autre direction.
4. Le cache d'une direction **MUST NOT** consommer le quota de cache de l'autre direction.
