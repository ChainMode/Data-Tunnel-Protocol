# Chapitre 9 Gestion des erreurs

## 9.1 Modèle de gestion des erreurs

Une implémentation DTP **MUST** suivre un modèle de gestion des erreurs en trois étapes « détecter-notifier-récupérer » :

1. **Détecter** : identifier les conditions anormales.
2. **Notifier** : envoyer les informations d'erreur au pair ou à la couche supérieure.
3. **Récupérer** : entreprendre des actions de récupération en fonction du type d'erreur.

Une implémentation **MUST NOT** abandonner silencieusement des trames lors de la détection d'une erreur sans notification.

## 9.2 Système de codes d'erreur

DTP **MUST** utiliser le système de codes d'erreur suivant. Les codes d'erreur **MUST** être des entiers non négatifs, répartis en huit plages selon le module fonctionnel :

| Plage | Catégorie | Stratégie de gestion |
|-------|-----------|----------------------|
| 1xxx | Erreurs de traitement de trame | Abandonner la trame + notifier l'émetteur |
| 2xxx | Erreurs de chiffrement | Abandonner la trame + notifier l'émetteur + peut déclencher une re-négociation des clés |
| 3xxx | Erreurs d'Agreement | Abandonner le Fragment + notifier l'émetteur + peut déclencher une re-négociation |
| 4xxx | Erreurs DAG | Rejeter le Fragment + notifier l'émetteur, ou mettre en cache et attendre |
| 5xxx | Erreurs de Session | Tenter la récupération de Session + clore et notifier la couche supérieure en cas d'échec |
| 6xxx | Erreurs de reprise | Suspendre l'envoi + notifier l'application de couche supérieure |
| 7xxx | Erreurs de version | Envoyer une notification d'incompatibilité de version + tenter une rétrogradation |
| 8xxx | Erreurs de permission | Rejeter l'opération + notifier le requérant |

## 9.3 Définitions des codes d'erreur

Une implémentation **MUST** utiliser les définitions normatives de codes d'erreur suivantes. **MUST NOT** utiliser de codes d'erreur non listés. Toute extension **MUST** être définie dans une version ultérieure de cette spécification.

### 9.3.1 Erreurs de traitement de trame (1xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 1001 | `FRAME_DESERIALIZATION_FAILED` | Les données binaires reçues ne peuvent pas être désérialisées en LogicalFrame |
| 1002 | `FRAME_INVALID_FORMAT` | La structure du LogicalFrame est invalide ou des champs requis manquent |

### 9.3.2 Erreurs de chiffrement (2xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 2001 | `DECRYPTION_FAILED` | Le déchiffrement du Payload a échoué (clé incorrecte ou données corrompues) |
| 2002 | `KEY_NOT_READY` | L'échange de clés CAP n'est pas encore terminé ; la transmission de données est refusée |

### 9.3.3 Erreurs d'Agreement (3xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 3001 | `AGREEMENT_NOT_FOUND` | Le Fragment référence un Agreement_ID inconnu |
| 3002 | `AGREEMENT_EXPIRED` | L'Agreement référencé a expiré (a dépassé `validityPeriod`) |
| 3003 | `AGREEMENT_NEGOTIATION_FAILED` | La négociation ne peut pas aboutir (timeout, refus du pair de re-négocier, etc.) |

### 9.3.4 Erreurs DAG (4xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 4001 | `DAG_CYCLE_DETECTED` | Ajouter le Fragment formerait un cycle DAG |
| 4002 | `DAG_DEPENDENCY_UNRESOLVED` | Les dépendances du Fragment ne sont pas résolues dans le délai de mise en cache |

### 9.3.5 Erreurs de Session (5xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 5001 | `SESSION_NOT_FOUND` | Le Session_ID référencé n'existe pas |
| 5002 | `SESSION_TIMEOUT` | La Session est arrivée à expiration pour cause d'inactivité |
| 5003 | `SESSION_RESTORE_FAILED` | La restauration de la Session après reconnexion a échoué |

### 9.3.6 Erreurs de reprise (6xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 6001 | `BUFFER_FULL` | Le cache de Fragments non acquittés de l'émetteur a atteint sa capacité |
| 6002 | `RETRANSMISSION_TIMEOUT` | Timeout de retransmission de Fragment sans acquittement (nombre de tentatives épuisé) |

### 9.3.7 Erreurs de version (7xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 7001 | `VERSION_INCOMPATIBLE` | La version de protocole de la trame reçue est supérieure à la version prise en charge par cette implémentation |

### 9.3.8 Erreurs de permission (8xxx)

| Code | Nom | Condition de déclenchement |
|------|-----|----------------------------|
| 8001 | `PERMISSION_DENIED` | Le rôle courant n'est pas autorisé à effectuer cette opération |
| 8002 | `OBSERVER_WRITE_DENIED` | Un Observer a tenté une opération d'écriture (les Observers sont en lecture seule) |

## 9.4 Unicité des codes d'erreur

Une implémentation **MUST** garantir l'unicité des codes d'erreur :

1. Chaque code d'erreur **MUST** correspondre à un type d'erreur unique.
2. Différents types d'erreur **MUST NOT** partager le même code d'erreur.
3. L'implémentation **MUST NOT** redéfinir des codes d'erreur déjà attribués par cette spécification.

## 9.5 Mécanisme de notification d'erreur

### 9.5.1 ErrorNotificationFrame

Les notifications d'erreur **MUST** être véhiculées via une ControlFrame, définie ainsi :

```typescript
interface ErrorNotificationFrame {
  frameType: "control";
  controlType: "error_notification";
  errorCode: DTPErrorCode;
  errorMessage: string;
  relatedFrameId?: FragmentID;
  relatedAgreementId?: AgreementID;
  details?: Record<string, unknown>;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `frameType` | **MUST** être `"control"` |
| `controlType` | **MUST** être `"error_notification"` |
| `errorCode` | **MUST** être l'un des codes d'erreur définis en Section 9.3 |
| `errorMessage` | **MUST** être une description d'erreur lisible par un humain. **SHOULD** utiliser une langue compréhensible par le pair |
| `relatedFrameId` | **OPTIONAL**. Lorsque l'erreur est déclenchée par une trame spécifique, **MUST** inclure le fragmentId de cette trame |
| `relatedAgreementId` | **OPTIONAL**. Lorsque l'erreur est liée à un Agreement spécifique, **MUST** inclure l'Agreement_ID |
| `details` | **OPTIONAL**. **MAY** inclure des informations supplémentaires à des fins de débogage |

### 9.5.2 Transport des notifications d'erreur

Une ErrorNotificationFrame **MUST** être transmise sur le canal LogicalFrame habituel et **MUST** avoir son Payload chiffré.

Si l'erreur elle-même empêche le chiffrement (par ex. l'erreur `KEY_NOT_READY`), l'implémentation **MAY** retourner l'erreur via un canal hors-bande défini par l'implémentation, mais **MUST NOT** envoyer l'erreur en clair sur le canal chiffré.

## 9.6 Flux de gestion des erreurs clés

### 9.6.1 Échec de désérialisation (1001)

Lorsqu'un LogicalFrame reçu ne peut pas être désérialisé, le récepteur **MUST** :

1. Abandonner la trame.
2. Envoyer la notification d'erreur `FRAME_DESERIALIZATION_FAILED`.
3. **MUST NOT** clore la Session pour cause d'échec de désérialisation.

### 9.6.2 Échec de déchiffrement (2001)

Lorsqu'un Payload reçu ne peut pas être déchiffré, le récepteur **MUST** :

1. Abandonner la trame.
2. Envoyer la notification d'erreur `DECRYPTION_FAILED`.
3. Compter le nombre d'échecs de déchiffrement consécutifs.
4. Si les échecs consécutifs dépassent un seuil (**RECOMMENDED** à 3), **SHOULD** déclencher une re-négociation des clés par CAP.

### 9.6.3 Détection de cycle DAG (4001)

Lorsqu'un cycle DAG est détecté :

1. Le récepteur **MUST** rejeter le Fragment.
2. **MUST** retourner l'erreur `DAG_CYCLE_DETECTED`.
3. **MUST NOT** ajouter le Fragment au DAG.
4. **MUST NOT** affecter l'état des Fragments existants.

### 9.6.4 Agreement inconnu (3001)

Lorsqu'un Fragment référence un Agreement_ID inconnu :

1. Le récepteur **MUST** abandonner le Fragment.
2. Retourner l'erreur `AGREEMENT_NOT_FOUND`.
3. **MAY** déclencher une re-négociation (défini par l'implémentation).

### 9.6.5 Clé non prête (2002)

Lorsqu'une transmission de données est tentée avant que l'échange de clés CAP ne soit terminé :

1. Le DTP_Engine **MUST** refuser d'envoyer.
2. **MUST** retourner l'erreur `KEY_NOT_READY` à l'appelant de couche supérieure.
3. **MUST NOT** répondre en clair sur le canal de communication.

### 9.6.6 Cache plein (6001)

Lorsque le cache de Fragments non acquittés atteint sa borne supérieure :

1. L'émetteur **MUST** suspendre l'envoi de nouveaux Fragments.
2. Envoyer une notification `BUFFER_FULL` à l'application de couche supérieure.
3. Reprendre l'envoi une fois que de l'espace de cache a été libéré par les acquittements.
4. **MUST NOT** abandonner les Fragments déjà mis en cache.

### 9.6.7 Timeout de retransmission (6002)

Lorsque le nombre de retransmissions de Fragment est épuisé :

1. L'émetteur **MUST** notifier l'application de couche supérieure de l'erreur `RETRANSMISSION_TIMEOUT`.
2. **SHOULD** déclencher la suspension ou la terminaison de la Session.
3. **MUST NOT** retransmettre indéfiniment.

### 9.6.8 Incompatibilité de version (7001)

Lorsqu'une trame avec une version de protocole incompatible est reçue (voir Chapitre 10 pour les détails) :

1. Le récepteur **MUST** ne pas traiter la trame.
2. **MUST** retourner l'erreur `VERSION_INCOMPATIBLE`.
3. **MUST** inclure la version la plus haute qu'il prend en charge dans le champ `details` de l'erreur.

### 9.6.9 Permission refusée (8001, 8002)

Pour les opérations de rôle illégales :

1. Le DTP_Engine **MUST** rejeter l'opération.
2. Les opérations d'écriture par un Observer **MUST** retourner `OBSERVER_WRITE_DENIED` (8002).
3. Les autres refus de permission **MUST** retourner `PERMISSION_DENIED` (8001).

## 9.7 Stratégie de récupération d'erreur

Une implémentation **MUST** adopter la stratégie de récupération correspondante par type d'erreur :

| Catégorie d'erreur | Stratégie de récupération |
|--------------------|---------------------------|
| 1xxx Traitement de trame | Abandonner la trame, la consigner, continuer à recevoir les trames suivantes |
| 2xxx Chiffrement | Échec isolé : abandonner la trame ; échecs consécutifs : déclencher une re-négociation des clés |
| 3xxx Agreement | Abandonner le Fragment ; peut déclencher une re-négociation |
| 4xxx DAG | Cycle : rejeter ; non résolu : mettre en cache et attendre |
| 5xxx Session | Tenter la récupération de Session ; clore en cas d'échec |
| 6xxx Reprise | Suspendre l'envoi, attendre la réponse du pair ou l'intervention de la couche supérieure |
| 7xxx Version | Envoyer la notification de version ; tenter une rétrogradation |
| 8xxx Permission | Rejeter l'opération ; **MUST NOT** retenter automatiquement |

Une implémentation **MUST NOT** retenter automatiquement la même opération lorsqu'une erreur de permission (8xxx) survient.
