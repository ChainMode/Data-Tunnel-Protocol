# Chapitre 3 Architecture du protocole

## 3.1 Découpage en couches du protocole

Une implémentation DTP **MUST** être organisée selon le découpage en couches suivant :

```
+-----------------------------------------------+
|             Application Layer                  |
|   iFay / coFay / Personal Data Heap            |
|   Terminal Applications                        |
+-----------------------------------------------+
|             DTP Protocol Layer                 |
|   DTP_Engine (DTP_Master / DTP_Slave)          |
|   - Agreement Manager                          |
|   - Frame Codec                                |
|   - DAG Manager                                |
|   - Encryption Module                          |
|   - Session Manager                            |
|   - Resume Manager                             |
+-----------------------------------------------+
|             Adapter Layer                      |
|   Transport_Adapter                            |
+-----------------------------------------------+
|             Transport Layer                    |
|   BLE / WebSocket / TCP / RTSP / ...           |
+-----------------------------------------------+
```

Une implémentation **MUST NOT** invoquer à travers les couches (par exemple, la couche applicative **MUST NOT** accéder directement à l'interface de la couche d'adaptation).

## 3.2 Composants cœur

Le DTP_Engine **MUST** comprendre les six composants cœur suivants :

### 3.2.1 Agreement Manager

L'Agreement Manager **MUST** fournir les capacités suivantes :

1. **Gestion du flux de négociation** : prise en charge de l'envoi et de la réception des Request_Frame et Response_Frame.
2. **Gestion du cycle de vie de l'Agreement** : maintien des transitions d'état de l'Agreement de `negotiating` à `terminated`.
3. **Génération d'identifiant unique** : génération d'un UUID v4 conforme à la RFC 4122 comme Agreement_ID pour chaque Agreement établi.
4. **Prise en charge de la concurrence multi-Agreement** : **MUST** prendre en charge le maintien simultané de plusieurs Agreements actifs au sein d'une même Session.

### 3.2.2 Frame Codec

Le Frame Codec **MUST** fournir les capacités suivantes :

1. **Sérialisation** : encodage d'un objet LogicalFrame en une séquence binaire d'octets.
2. **Désérialisation** : décodage d'une séquence binaire d'octets en un objet LogicalFrame.
3. **Cohérence aller-retour** : pour tout objet LogicalFrame valide, sérialiser puis désérialiser **MUST** produire un LogicalFrame équivalent à l'objet original.
4. **Pretty Printer** : **SHOULD** fournir la capacité de convertir un LogicalFrame en texte lisible par un humain et **SHOULD** inclure tous les champs clés de l'en-tête de trame.

### 3.2.3 DAG Manager

Le DAG Manager **MUST** fournir les capacités suivantes :

1. **Détection de cycle** : avant l'ajout d'un Fragment au DAG, **MUST** vérifier qu'aucun cycle ne serait formé. Lorsqu'un cycle est détecté, le Fragment **MUST** être rejeté et l'erreur `DAG_CYCLE_DETECTED` (4001) **MUST** être retournée.
2. **Résolution de dépendance** : lorsqu'une cible de dépendance déclarée par un Fragment n'est pas encore arrivée, le Fragment **MUST** être marqué comme « en attente de résolution de dépendance » et mis en cache.
3. **Résolution différée** : lorsqu'un Fragment dépendu arrive, les Fragments précédemment mis en cache **MUST** être résolus automatiquement.
4. **Prise en charge des types de relation** : **MUST** prendre en charge les trois types de relation `derived_from`, `annotates` et `supersedes`.

### 3.2.4 Encryption Module

Le Encryption Module **MUST** fournir les capacités suivantes :

1. **Chiffrement du Payload** : chiffrement du Payload à l'aide de la clé pré-négociée par CAP.
2. **Déchiffrement du Payload** : déchiffrement du Payload reçu à l'aide de la clé pré-négociée par CAP.
3. **Vérification de la disponibilité de la clé** : avant toute opération de chiffrement, **MUST** vérifier que CAP a terminé l'échange de clés.
4. **Génération des métadonnées de chiffrement** : **MUST** inclure les métadonnées de chiffrement (identifiant de l'algorithme et version de la clé) en clair dans l'en-tête de trame.

### 3.2.5 Session Manager

Le Session Manager **MUST** fournir les capacités suivantes :

1. **Gestion du cycle de vie de la Session** : établir, maintenir et clôturer les Sessions.
2. **Persistance d'état** : lorsque la connexion sous-jacente est interrompue, **MUST** persister l'état de la Session.
3. **Restauration d'état** : après que la connexion est restaurée et que la re-vérification CAP est passée, **MUST** être capable de restaurer l'état précédent de la Session.
4. **Détection de timeout** : **MUST** implémenter la détection de timeout d'inactivité de Session.

### 3.2.6 Resume Manager

Le Resume Manager **MUST** fournir les capacités suivantes :

1. **Attribution de numéro de séquence** : attribuer un numéro de séquence strictement croissant à chaque Fragment envoyé.
2. **Cache des non-acquittés** : mettre en cache les Fragments localement jusqu'à ce qu'ils soient acquittés par le récepteur.
3. **Rapport de point de rupture** : lorsque la connexion est restaurée, rapporter au pair le numéro de séquence le plus élevé reçu avec succès.
4. **Gestion du cache** : **MUST** implémenter une vérification de la limite supérieure de capacité du cache. Lorsque le cache atteint sa limite, l'envoi **MUST** être suspendu et l'erreur `BUFFER_FULL` (6001) **MUST** être retournée.

## 3.3 Machine à états

Le DTP_Engine **MUST** implémenter la machine à états suivante :

```
                 [Idle]
                    |
                    | Connection request received
                    v
             [WaitingForCAP]
                    |
                    | CAP authentication + key exchange complete
                    v
             [SessionEstablished]
                    |
                    | Send or receive Request_Frame
                    v
              [Negotiating]
                    |
                    | Agreement reached
                    v
              [Transmitting]
                    |
                    | Connection interrupted
                    v
                [Suspended]
                    |
                    | Connection restored + CAP re-verified
                    v
                [Resuming]
                    |
                    | Resume handshake complete
                    v
              [Transmitting]
```

Les règles complètes de transition d'état **MUST** être conformes au tableau suivant :

| État courant | Événement déclencheur | État cible | Notes |
|--------------|-----------------------|------------|-------|
| `Idle` | Requête de connexion reçue | `WaitingForCAP` | |
| `WaitingForCAP` | Authentification CAP + échange de clés terminés | `SessionEstablished` | |
| `WaitingForCAP` | Échec ou timeout CAP | `Idle` | **MUST** libérer les ressources associées |
| `SessionEstablished` | Envoi ou réception d'un Request_Frame | `Negotiating` | |
| `SessionEstablished` | Timeout de Session | `Idle` | **MUST** clôturer la Session |
| `Negotiating` | Agreement conclu | `Transmitting` | |
| `Negotiating` | Négociation échouée ou refusée | `SessionEstablished` | |
| `Transmitting` | Transmission continue de Fragment | `Transmitting` | Auto-boucle |
| `Transmitting` | Request_Frame de type ajustement reçu | `Negotiating` | |
| `Transmitting` | Connexion sous-jacente déconnectée | `Suspended` | **MUST** persister l'état de la Session |
| `Transmitting` | Agreement terminé et aucun autre Agreement actif | `SessionEstablished` | |
| `Suspended` | Connexion restaurée et re-vérification CAP réussie | `Resuming` | |
| `Suspended` | Timeout de Session | `Idle` | **MUST** libérer les ressources |
| `Resuming` | Poignée de main de reprise terminée | `Transmitting` | |
| `Resuming` | Échec de la restauration | `Idle` | **MUST** clôturer la Session |

Une implémentation **MUST NOT** introduire de transitions d'état non listées dans le tableau ci-dessus.

## 3.4 Interface Transport_Adapter

Le Transport_Adapter **MUST** fournir l'interface suivante :

```typescript
interface Transport_Adapter {
  // Connection management
  connect(endpoint: TransportEndpoint): Connection;
  disconnect(connectionId: ConnectionID): void;

  // Data transmission
  send(connectionId: ConnectionID, data: Uint8Array): void;
  onReceive(handler: (connectionId: ConnectionID, data: Uint8Array) => void): void;

  // State events
  onConnectionStateChange(handler: (connectionId: ConnectionID, state: ConnectionState) => void): void;
}
```

Une implémentation concrète de Transport_Adapter **MUST** satisfaire les exigences normatives suivantes :

1. L'opération `send()` **MUST** être non bloquante.
2. Lorsque l'état de la connexion sous-jacente change, le DTP_Engine **MUST** être notifié via le callback `onConnectionStateChange`.
3. **MUST** fournir une implémentation d'interface unifiée pour chaque protocole de transport pris en charge (BLE, WebSocket, TCP, RTSP).
4. **MUST NOT** modifier les données binaires transmises par le DTP_Engine.

## 3.5 Séquence d'interaction Master-Slave

Une interaction DTP complète **MUST** se conformer aux cinq phases suivantes :

### Phase 1 : Pré-traitement CAP

Le DTP_Engine **MUST** attendre que CAP termine la vérification d'identité et l'échange de clés. Pendant cette phase, DTP **MUST NOT** envoyer de trame de données.

### Phase 2 : Établissement de la Session DTP

Après que CAP a terminé, le DTP_Engine **MUST** générer un Session_ID unique (UUID v4) et entrer dans l'état `SessionEstablished`.

### Phase 3 : Négociation

Phase 3a (négociation de collecte de données) : le Master **MAY** envoyer un Request_Frame avec `requestType = collection`, et le Slave **MUST** répondre par un Response_Frame indiquant `accepted`, `rejected` ou `counter_proposal`.

Phase 3b (négociation d'injection de données) : le Slave **MAY** envoyer un Request_Frame avec `requestType = injection`, et le Master **MUST** répondre par un Response_Frame.

### Phase 4 : Transmission de données

Une fois un Agreement conclu, l'émetteur **MUST** transmettre les Fragments via des trames de données, et chaque Fragment **MUST** porter l'Agreement_ID auquel il appartient (ou l'omettre pour hériter du contexte, voir Section 4.5).

### Phase 5 : Interruption de connexion et récupération

Lorsque la connexion sous-jacente est interrompue, le DTP_Engine **MUST** entrer dans l'état `Suspended` et persister la Session. Une fois la connexion restaurée, une re-vérification CAP **MUST** être effectuée, puis le moteur **MUST** entrer dans l'état `Resuming` afin de finaliser la poignée de main de reprise.
