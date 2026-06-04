# Chapitre 5 Mécanisme de négociation

## 5.1 Principes de négociation

Une implémentation DTP **MUST** appliquer les principes de négociation suivants :

1. **Négociation préalable** : avant toute transmission de données par Fragment, un Agreement à l'état `active` **MUST** déjà exister.
2. **Pas de transmission brute** : une implémentation **MUST NOT** autoriser une transmission de données qui ne s'appuie pas sur un Agreement.
3. **Négociation bidirectionnelle** : le Master **MAY** initier une négociation de collecte de données ; le Slave **MAY** initier une négociation d'injection de données.
4. **Ajustement dynamique** : les deux parties **MAY** ajuster les paramètres d'un Agreement tant qu'il est à l'état `active`.
5. **Terminaison explicite** : les deux parties **MAY** terminer explicitement un Agreement. Après terminaison, la transmission de données sous cet Agreement **MUST** s'arrêter immédiatement.

## 5.2 Types de trames de négociation

La négociation **MUST** être menée à travers deux types de trames : Request_Frame et Response_Frame.

### 5.2.1 Request_Frame

Un Request_Frame **MUST** contenir les champs suivants :

```typescript
interface RequestFrame {
  frameType: "request";
  requestId: string;
  requestorRole: "master" | "slave";
  requestType: "collection" | "injection" | "adjustment" | "termination";
  targetAgreementId?: AgreementID;
  proposedParams: AgreementParams;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `frameType` | **MUST** être le littéral `"request"` |
| `requestId` | **MUST** être un identifiant unique de la requête. **SHOULD** utiliser un UUID v4 |
| `requestorRole` | **MUST** être `"master"` ou `"slave"`, identifiant l'émetteur de la requête |
| `requestType` | **MUST** être l'un des quatre types du tableau ci-dessous |
| `targetAgreementId` | **MUST** être fourni lorsque `requestType` vaut `"adjustment"` ou `"termination"` |
| `proposedParams` | **MUST** fournir des AgreementParams complets (voir Section 5.4) |

### 5.2.2 RequestType

| Valeur | Sémantique | Contrainte |
|--------|------------|------------|
| `"collection"` | Requête de collecte de données | **MUST** être initiée par `requestorRole = "master"` |
| `"injection"` | Requête d'injection de données | **MUST** être initiée par `requestorRole = "slave"` |
| `"adjustment"` | Ajuster un Agreement existant | **MUST** fournir `targetAgreementId` ; l'Agreement cible **MUST** être à l'état `active` |
| `"termination"` | Terminer un Agreement existant | **MUST** fournir `targetAgreementId` |

Une implémentation **MUST** rejeter toute requête qui ne satisfait pas les contraintes ci-dessus et retourner l'erreur correspondante (voir Chapitre 9).

### 5.2.3 Response_Frame

Un Response_Frame **MUST** contenir les champs suivants :

```typescript
interface ResponseFrame {
  frameType: "response";
  requestId: string;
  result: NegotiationResult;
  agreedParams?: AgreementParams;
  agreementId?: AgreementID;
  rejectionReason?: string;
}
```

| Champ | Exigence normative |
|-------|--------------------|
| `frameType` | **MUST** être le littéral `"response"` |
| `requestId` | **MUST** être le `requestId` du Request_Frame correspondant |
| `result` | **MUST** être l'une des valeurs de `NegotiationResult` |
| `agreedParams` | **MUST** être fourni lorsque `result` vaut `accepted` ou `counter_proposal` |
| `agreementId` | **MUST** être fourni lorsque `result` vaut `accepted` ; **MUST** être un UUID v4 nouvellement généré |
| `rejectionReason` | **MUST** être fourni lorsque `result` vaut `rejected` |

### 5.2.4 NegotiationResult

`NegotiationResult` **MUST** être l'une des trois valeurs suivantes :

| Valeur | Sémantique |
|--------|------------|
| `"accepted"` | Accepter la requête |
| `"rejected"` | Rejeter la requête |
| `"counter_proposal"` | Proposer une alternative |

Une implémentation **MUST NOT** retourner de valeurs de résultat non listées.

## 5.3 Flux de négociation

### 5.3.1 Négociation de collecte de données (initiée par le Master)

La négociation de collecte de données **MUST** suivre ce flux :

1. Le Master envoie un Request_Frame avec `requestType = "collection"` et `requestorRole = "master"`.
2. Le Slave **MUST** répondre par un Response_Frame contenant l'un des trois résultats suivants :
   - `"accepted"` : accepter la transmission selon `proposedParams`. **MUST** inclure dans le Response_Frame l'`agreementId` nouvellement généré.
   - `"rejected"` : refuser la transmission. **MUST** indiquer dans `rejectionReason` une contrainte liée à la conformité (par ex. politique DLP). **MUST NOT** refuser pour des raisons étrangères à la conformité.
   - `"counter_proposal"` : proposer des paramètres alternatifs. **MUST** fournir les paramètres modifiés dans `agreedParams`.
3. Si le Slave répond par `counter_proposal`, le Master **MAY** envoyer un nouveau Request_Frame pour accepter, refuser ou poursuivre la négociation.
4. Le Master **MUST** consigner de manière persistante le résultat de la réponse du Slave pour chaque requête de collecte de données.

### 5.3.2 Négociation d'injection de données (initiée par le Slave)

La négociation d'injection de données **MUST** suivre ce flux :

1. Le Slave envoie un Request_Frame avec `requestType = "injection"` et `requestorRole = "slave"`.
2. Le Master **MUST** répondre par un Response_Frame contenant l'un des trois résultats suivants :
   - `"accepted"` : accepter de fournir les données. **MUST** décrire dans `agreedParams` le périmètre des données filtrées (jeu de données minimisé). **MUST** inclure dans le Response_Frame l'`agreementId` nouvellement généré.
   - `"rejected"` : refuser de fournir les données. **SHOULD** indiquer la raison dans `rejectionReason`.
   - `"counter_proposal"` : fournir des données d'un périmètre ou d'un format différent. **MUST** décrire l'alternative dans `agreedParams`.
3. Le Master **MUST** détenir l'autorité décisionnelle complète sur les décisions d'injection de données et **MUST NOT** être contraint d'accepter la requête.

### 5.3.3 Timeout de négociation

Une implémentation **MUST** définir un seuil de timeout pour Request_Frame. Si le Response_Frame du pair n'est pas reçu dans le seuil :

1. L'émetteur de la requête **SHOULD** retransmettre le Request_Frame ; le nombre de tentatives **MUST NOT** dépasser la borne supérieure configurée par l'implémentation.
2. Une fois la borne supérieure de tentatives atteinte, l'émetteur **MUST** mettre fin à la négociation et notifier l'application de couche supérieure de l'erreur `AGREEMENT_NEGOTIATION_FAILED` (3003).

## 5.4 AgreementParams

AgreementParams **MUST** contenir les champs suivants :

```typescript
interface AgreementParams {
  dataType: string;
  dataRange: string;
  transferMode: TransferMode;
  frequency: number | null;
  validityPeriod: number;
  priority: Priority;
}
```

| Champ | Type | Exigence normative |
|-------|------|--------------------|
| `dataType` | `string` | **MUST** être non vide. Identifie le type de données |
| `dataRange` | `string` | **MUST** être non vide. Décrit le périmètre des données |
| `transferMode` | `TransferMode` | **MUST** être l'une des trois valeurs du tableau ci-dessous |
| `frequency` | `number \| null` | En Hz. **MUST** être null lorsque `transferMode = "one_time"` ; **MUST** être un nombre positif pour les autres modes |
| `validityPeriod` | `number` | En millisecondes. **MUST** être un entier positif |
| `priority` | `Priority` | **MUST** être l'une des quatre valeurs du tableau ci-dessous |

### 5.4.1 TransferMode

| Valeur | Sémantique |
|--------|------------|
| `"one_time"` | Transmission ponctuelle. L'Agreement **SHOULD** se terminer automatiquement après l'achèvement de la transmission |
| `"periodic"` | Transmission périodique. **MUST** définir `frequency` |
| `"streaming"` | Transmission en flux continu. **MUST** définir `frequency` |

### 5.4.2 Priority

| Valeur | Sémantique |
|--------|------------|
| `"low"` | Priorité basse |
| `"normal"` | Priorité normale (par défaut) |
| `"high"` | Priorité haute |
| `"critical"` | Priorité critique |

Une implémentation **SHOULD** ordonnancer la contention de ressources entre plusieurs Agreements en fonction de `priority`.

## 5.5 Cycle de vie de l'Agreement

### 5.5.1 Définitions des états

`AgreementStatus` **MUST** être l'une des quatre valeurs suivantes :

| État | Sémantique |
|------|------------|
| `"negotiating"` | Négociation en cours |
| `"active"` | Agreement en vigueur ; données en cours de transmission |
| `"suspended"` | Connexion interrompue ; Agreement suspendu |
| `"terminated"` | Agreement terminé |

### 5.5.2 Transitions d'état

L'état de l'Agreement **MUST** se conformer aux règles de transition suivantes :

| État courant | Événement déclencheur | État cible |
|--------------|-----------------------|------------|
| (aucun) | Request_Frame émis | `negotiating` |
| `negotiating` | Response_Frame retourne `accepted` | `active` |
| `negotiating` | Response_Frame retourne `rejected` | (terminé) |
| `active` | Connexion sous-jacente déconnectée | `suspended` |
| `active` | Request_Frame de type `termination` reçu | `terminated` |
| `active` | `validityPeriod` expiré | `terminated` |
| `suspended` | Connexion restaurée et re-vérification CAP réussie | `active` |
| `suspended` | Timeout de persistance | `terminated` |
| `terminated` | (état terminal) | (aucun) |

### 5.5.3 Auto-terminaison des Agreements ponctuels

Lorsque `transferMode = "one_time"` et que la transmission de données est achevée :

1. L'émetteur **MUST** terminer l'Agreement après le dernier Fragment en envoyant un Request_Frame avec `requestType = "termination"`.
2. Le récepteur **MUST** positionner l'état de l'Agreement à `terminated` après avoir reçu et acquitté tous les Fragments.

## 5.6 Concurrence multi-Agreement

Une implémentation DTP **MUST** prendre en charge le maintien simultané de plusieurs Agreements à l'état `active` au sein d'une même Session.

L'implémentation **MUST** satisfaire :

1. Chaque Fragment est associé à un Agreement spécifique via son Agreement_ID.
2. Les Fragments appartenant à différents Agreements **MAY** être entrelacés dans le flux de transmission.
3. La méthode de transmission effective pour plusieurs Agreements (en série ou en parallèle) **DEPENDS** des capacités du Transport_Adapter sous-jacent.
4. L'implémentation **MUST NOT** limiter le nombre maximum d'Agreements actifs dans une seule Session en dessous de 16. **SHOULD** prendre en charge un nombre arbitraire.

## 5.7 Restrictions de négociation pour Observer

Le rôle Observer **MUST** satisfaire :

1. **MUST NOT** envoyer de Request_Frame. Si un Observer tente d'en envoyer un, le DTP_Engine **MUST** rejeter l'opération et retourner l'erreur `OBSERVER_WRITE_DENIED` (8002).
2. **MUST NOT** recevoir d'autorité décisionnelle sur les Response_Frame.
3. **MAY** recevoir des copies en lecture seule des trames de données.
4. **MUST** être explicitement autorisé par le Controller au moment de rejoindre en tant qu'Observer.
