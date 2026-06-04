# Chapitre 10 Gestion des versions

> **Déclaration de source unique de vérité (Single Source of Truth).** La **politique** de gestion des versions de DTP est définie par le Chapitre 1 §1.7 « Gestion des versions et compatibilité » en tant que **source unique de vérité**. Ce chapitre **MUST NOT** redéfinir la politique déjà spécifiée en §1.7 ; ce chapitre ne fournit que les **mécanismes opérationnels** des règles de §1.7 (liaison au format filaire, payloads concrets des codes d'erreur, séquence de négociation, modèle de déclaration d'implémentation) et le **flux de gouvernance** (conventions de répertoire et de statut, actions de finalisation). Chaque fois qu'une déclaration de ce chapitre est ambiguë avec §1.7, §1.7 **MUST** prévaloir.

## 10.1 Format du numéro de version (référence opérationnelle)

La sémantique du numéro de version du protocole DTP, la structure à deux niveaux `MAJOR.MINOR` (sans PATCH), la règle de classification des changements et les définitions des axes orthogonaux se trouvent en §1.7.1 et §1.7.2 et ne sont pas répétées ici.

Liaison au format filaire : l'en-tête de trame de chaque LogicalFrame **MUST** transporter le champ `ProtocolVersion` complet (voir Section 4.4) :

```typescript
interface ProtocolVersion {
  major: number;  // entier non négatif
  minor: number;  // entier non négatif
}
```

La version initiale du protocole définie par cette spécification **MUST** être `{ major: 1, minor: 0 }` (c.-à-d. `dtp/1.0`).

## 10.2 Matrice de compatibilité de version (complément opérationnel à §1.7.3)

> Les règles normatives de compatibilité et de négociation se trouvent en §1.7.3. Le tableau ci-dessous en est la réalisation opérationnelle au niveau du traitement de trame et **MUST** être lu selon §1.7.3 ; en cas d'ambiguïté, §1.7.3 prévaut.

| Version de la trame reçue | Traitement |
|---------------------------|------------|
| Égale à la version la plus haute du récepteur | Traiter normalement |
| Égale à la version majeure précédente de la version la plus haute du récepteur (major - 1) | Traitement de compatibilité (traiter selon l'ancienne spécification) |
| Supérieure à la version la plus haute du récepteur | **MUST** retourner `VERSION_INCOMPATIBLE` (7001) |
| Version majeure inférieure à (version la plus haute du récepteur - 1) | **MUST** retourner `VERSION_INCOMPATIBLE` (7001) |
| Même version majeure, version mineure inférieure | Traiter normalement (rétro-compatible) |
| Même version majeure, version mineure supérieure | **SHOULD** traiter (ignorer les champs optionnels non reconnus) |

### 10.2.1 Tolérance de version mineure (réalisation opérationnelle de §1.7.3)

Lorsqu'une implémentation reçoit une trame avec la même version majeure mais une version mineure supérieure, elle **MUST** :

1. Traiter les champs connus ;
2. **SHOULD** ignorer les champs optionnels inconnus ;
3. **MUST NOT** rejeter la trame entière à cause de champs optionnels inconnus ;
4. **MUST NOT** lever d'erreur.

## 10.3 Gestion de l'incompatibilité de version (mécanisme opérationnel)

### 10.3.1 Gestion côté récepteur

Lorsque le récepteur reçoit un LogicalFrame dont la version de protocole est supérieure à la version qu'il prend en charge (et dépasse la plage de compatibilité), il **MUST** :

1. **Ne pas traiter** la trame ;
2. Envoyer l'erreur `VERSION_INCOMPATIBLE` (7001) à l'émetteur ;
3. Inclure sa version la plus haute prise en charge dans le champ `details` de la notification d'erreur :

```typescript
{
  errorCode: 7001,
  errorMessage: "Protocol version higher than supported",
  details: {
    supportedMaxVersion: { major: 1, minor: 0 }
  }
}
```

> La sémantique du code d'erreur `7001` est régie par le tableau des codes d'erreur du Chapitre 9 et par le schema ; ce chapitre ne la redéfinit pas.

### 10.3.2 Gestion côté émetteur

Après réception de l'erreur `VERSION_INCOMPATIBLE`, l'émetteur **MAY** choisir :

1. **Rétrograder vers la version prise en charge par le pair** et renvoyer la trame (**SHOULD** être privilégié, à condition qu'un `MAJOR` commun existe ; pas de rétrogradation à travers `MAJOR`, voir §1.7.3) ;
2. **Notifier l'application de couche supérieure** de l'incompatibilité de version, et **MUST NOT** retenter automatiquement de manière indéfinie.

Une implémentation **MUST NOT** clore immédiatement la Session après réception d'une erreur d'incompatibilité de version, et **SHOULD** laisser l'occasion à une rétrogradation.

### 10.3.3 Cohérence de version au sein de la session et séquence de négociation

Lorsqu'une Session DTP est établie, les deux parties **MUST** négocier une version de protocole cohérente (règles de négociation en §1.7.3). Pendant la session :

1. La version unifiée **MUST** être utilisée pendant toute la session ;
2. **MUST NOT** changer de version de protocole en cours de session.

La négociation de version **SHOULD** suivre cette séquence ; le porteur concret (extensions CAP, le premier Request_Frame/Response_Frame, etc.) **MAY** être choisi par l'implémentation, mais la négociation **MUST** être terminée avant l'envoi de la première trame de données :

```
DTP_A                              DTP_B
  |                                   |
  |-- Hello (supported_versions) --->|
  |                                   |
  |<-- Hello_Ack (chosen_version) ---|
  |                                   |
  |    [both sides use chosen_version]|
```

## 10.4 Évolution du protocole et gouvernance

Cette section fournit le flux opérationnel des règles de gouvernance de §1.7. Le format du git tag, l'énumération des statuts de document et la définition de l'édition éditoriale qui y sont référencés **MUST** être ancrés à §1.7 ; cette section ne les redéfinit pas.

### 10.4.1 Conventions de répertoire et de statut (cohérentes avec Faying Protocol)

- Le statut du document est un marqueur du front matter et **MUST NOT** être encodé dans le chemin (voir §1.7.1).
- Sous `specification/`, exactement une zone de travail mutable `draft/` **MUST** être conservée (mise à jour en continu).
- Tous les répertoires autres que `draft/` **MUST** être nommés par date de publication (p. ex. `2025-10-25/`), représentant une édition publiée **gelée** ; « pas draft signifie publié ».
- Qu'une édition publiée soit actuellement `Final`, `Deprecated` ou `Obsolete` est déterminé **uniquement** par le champ `status` de ses fichiers et **MUST NOT** être déduit du nom du répertoire.
- Créer des répertoires nommés par statut (p. ex. `final/`) est **INTERDIT** —sinon, déprécier une édition nécessiterait de déplacer des répertoires et de rompre des liens.
- WHEN une transition de statut survient, **seul** le `status` du front matter **MUST** être modifié, et les répertoires **MUST NOT** être déplacés.

### 10.4.2 Versions Draft et officielles

- Draft : les documents résident dans `docs/{lang}/specification/draft/`, le schema dans `schema/draft/` ; les numéros de version draft **MAY** utiliser `{ major: 0, minor: N }`. Pendant `Draft`, il n'y a **AUCUNE** promesse de compatibilité (voir §1.7.5), et les drafts **MUST NOT** être utilisés en production.
- Version officielle : **MUST** avoir fait l'objet d'une revue complète et d'une discussion publique et posséder une capture de version immuable ; les documents résident dans `docs/{lang}/specification/{YYYY-MM-DD}/`, le schema dans `schema/{YYYY-MM-DD}/`. La première version officielle est `2025-10-25`, correspondant à la version de protocole `dtp/1.0`.
- Immuabilité de la capture de version : une fois une version officielle publiée, elle **MUST** rester immuable ; les errata de texte pur sont portés par un **nouveau répertoire de date de publication** selon §1.7.4 avec les répertoires existants gelés, et le contenu de spécification ou le schema d'une capture publiée **MUST NOT** être réécrit sur place.

### 10.4.3 Actions standard de finalisation (Draft → Final)

WHEN la finalisation est effectuée, le Doc Governance Process **MUST** accomplir les actions suivantes dans l'ordre :

1. Utiliser `git mv` pour migrer tous les fichiers sous `draft/` vers le répertoire de date de publication (noms de fichiers inchangés) et vider `draft/` ;
2. Par fichier, changer `status` de `Draft` à `Final` ;
3. Geler `date` à la date de publication officielle, verrouiller `editors` sur la liste des signataires de finalisation et garder `version` inchangé ;
4. Écrire la chaîne d'historique `replaces` (pointant vers le répertoire draft et son hash court de commit de finalisation) dans le front matter du README ;
5. Étiqueter `dtp-v<MAJOR.MINOR>-final`, qui **MUST** couvrir corps + vecteurs de test + schema ensemble ;
6. Lorsque plusieurs langues / fichiers sont impliqués, ils **MUST** être migrés ensemble dans le même commit ; la publication unilatérale est **interdite**.

### 10.4.4 Dépréciation et suppression

Une implémentation **SHOULD** déprécier des fonctionnalités via le processus suivant :

1. **Marquer comme déprécié** : marquer la fonctionnalité comme dépréciée dans une version `MINOR`, mais **MUST** continuer à la prendre en charge ;
2. **Période de transition** : au moins un cycle complet de version `MAJOR` ;
3. **Suppression** : supprimer dans la prochaine version `MAJOR`.

Une implémentation **MUST NOT** supprimer de fonctionnalité dépréciée dans une version `MINOR`.

## 10.5 Déclaration d'implémentation

Une implémentation DTP **MUST** déclarer dans sa documentation :

1. La version de protocole la plus haute prise en charge ;
2. Toutes les versions majeures précédentes prises en charge ;
3. Si la compatibilité ascendante est prise en charge (traitement des trames avec une version mineure supérieure) ;
4. Les extensions définies par l'implémentation, le cas échéant.

Par exemple :

> **Déclaration de version de l'implémentation DTP X :**
>
> - Version de protocole la plus haute prise en charge : 1.0
> - Versions précédentes compatibles : aucune (première version officielle)
> - Compatibilité ascendante : prise en charge ; ignore les champs optionnels inconnus
> - Algorithmes de chiffrement : AES-256-GCM, ChaCha20-Poly1305
> - Adaptateurs de transport : BLE, WebSocket, TCP
