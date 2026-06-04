# Chapitre 1 Aperçu et positionnement

Ce chapitre définit la portée du protocole DTP (§1.1), son positionnement (§1.2), sa relation avec CAP (§1.3), ses objectifs de conception (§1.4), le modèle Master-Slave (§1.5) et les niveaux de conformité (§1.6), et présente en §1.7 « Gestion des versions et compatibilité » les règles de gestion des versions de DTP sous forme **normative** —de sorte que ce protocole **porte sa propre description de version**, permettant aux implémenteurs standard de la consulter directement sans rechercher de documents externes.

## 1.1 Portée du protocole

Le Data Tunnel Protocol (DTP) **SHALL** être le protocole de couche applicative chargé de la transmission bidirectionnelle de données entre les terminaux et les instances Fay au sein de l'écosystème iFay.

DTP **MUST** implémenter les deux flux de données fondamentaux suivants :

1. **Collecte de données** : depuis un terminal (Slave) vers Fay (Master), utilisé pour persister dans le Personal Data Heap d'iFay les données produites par le terminal.
2. **Injection de données** : depuis Fay (Master) vers un terminal (Slave), utilisé pour fournir temporairement un jeu de données minimisé, filtré par iFay, aux applications terminales.

DTP **MUST NOT** être utilisé à d'autres fins.

## 1.2 Positionnement du protocole

DTP **MUST** fonctionner comme un protocole de couche applicative au-dessus des protocoles de transport existants, y compris mais sans s'y limiter BLE, RTSP, WebSocket et TCP.

DTP **MUST** interagir avec les protocoles de transport concrets via la couche d'abstraction `Transport_Adapter` (voir Section 3.4). Le cœur de DTP **MUST NOT** dépendre des détails d'implémentation d'un protocole de transport spécifique.

## 1.3 Relation avec CAP

DTP **MUST** fonctionner de concert avec le Control Authorization Protocol (CAP) et suivre cette répartition des responsabilités :

- **CAP** est responsable de l'autorisation de connexion, de la vérification d'identité et de l'échange de clés.
- **DTP** est responsable de la transmission de flux de données fondée sur la négociation.

Une implémentation DTP **MUST** ne commencer la transmission de données qu'une fois que CAP a terminé la vérification d'identité et l'échange de clés. Si CAP n'est pas prêt, l'implémentation DTP **MUST** refuser d'envoyer des données et retourner l'erreur `KEY_NOT_READY` (code d'erreur 2002, voir Chapitre 9).

## 1.4 Objectifs de conception

Une implémentation DTP **MUST** satisfaire les objectifs de conception suivants :

| Objectif | Exigence normative |
|----------|--------------------|
| Indépendance du transport | La logique cœur de DTP **MUST** être découplée de tout protocole de transport spécifique |
| Négociation préalable | Toute transmission de données **MUST** s'appuyer sur un Agreement établi |
| Souveraineté des données | Le Master **MUST** détenir l'autorité décisionnelle finale sur les flux de données |
| Chiffrement de bout en bout | Le Payload **MUST** être transmis sous forme chiffrée |
| Préservation du contexte | Chaque Fragment **MUST** transporter des métadonnées contextuelles structurées |
| Récupérabilité | L'implémentation **MUST** prendre en charge la reprise basée sur le numéro de séquence |

## 1.5 Modèle Master-Slave

DTP **MUST** distinguer les deux rôles suivants :

- **Master** : un utilisateur personne physique ou Fay (iFay / coFay). **MUST** détenir le droit d'initier la collecte de données et le droit de décider de l'injection de données.
- **Slave** : un terminal logiciel ou matériel. **MAY** initier uniquement des requêtes d'injection de données ; **MUST NOT** initier de requête de collecte de données.

Une implémentation DTP **MUST** appliquer les contraintes suivantes :

1. À tout instant, un seul Slave **MUST NOT** être contrôlé par plus d'un Fay (Controller).
2. Un Controller **MAY** inviter d'autres Fays à agir en tant qu'Observers.
3. Les Observers **MUST NOT** initier de requêtes ni modifier d'Agreements ; ils **MUST** uniquement recevoir des copies en lecture seule des flux de données.
4. Lorsque le Master initie une requête de collecte de données, le Slave **SHOULD** l'accepter. Le Slave **MAY** refuser, mais le refus **MUST** être accompagné d'une raison liée à la conformité (voir Section 5.3.1).
5. Lorsque le Slave initie une requête d'injection de données, le Master **MUST** détenir l'autorité décisionnelle complète et **MAY** accepter, refuser ou proposer une alternative.

## 1.6 Niveaux de conformité

Une implémentation **MUST** déclarer son niveau de conformité :

- **Conformité totale** : l'implémentation satisfait toutes les règles **MUST** et **SHOULD**.
- **Conformité au cœur** : l'implémentation satisfait toutes les règles **MUST** mais **MAY** ne pas satisfaire certaines règles **SHOULD**.
- **Non-conformité** : l'implémentation ne satisfait pas une règle **MUST**. Une implémentation se réclamant de DTP **MUST NOT** se trouver dans cet état.

## 1.7 Gestion des versions et compatibilité (Version Management & Compatibility)

> **Cette section est normative.** Cette section est la **source unique de vérité (Single Source of Truth)** pour les règles de gestion des versions de DTP. Partout où des règles de version sont référencées ailleurs dans le corps (y compris le Chapitre 10 « Gestion des versions » et le journal des modifications, le cas échéant), ces références **MUST** se conformer à cette section et **MUST NOT** redéfinir les règles établies ici.

Cette section est organisée dans l'ordre fixe suivant : trois axes de version orthogonaux (§1.7.1) → sémantique de `MAJOR.MINOR` et classification des changements (§1.7.2) → règles de négociation de version et de compatibilité (§1.7.3) → édition éditoriale et errata (§1.7.4) → tableau de placement du numéro de version et liste de contrôle pour les implémenteurs (§1.7.5).

### 1.7.1 Trois axes de version orthogonaux

Les informations de version de DTP **MUST** être gérées le long de trois axes **mutuellement orthogonaux**. Ces trois axes **MUST NOT** être fusionnés en un seul numéro de version ; chaque axe possède son propre espace de valeurs, son emplacement d'enregistrement et sa règle de progression, et un changement sur un axe **MUST NOT** forcer un changement sur les deux autres (la définition observable de l'orthogonalité).

| Axe | Signification | Espace de valeurs | Emplacement d'enregistrement | Entre dans le format filaire ? |
|-----|---------------|-------------------|------------------------------|--------------------------------|
| Version du protocole (Protocol Version) | Contrat d'interopérabilité | `dtp/MAJOR.MINOR` (deux niveaux, **sans PATCH** ; `MAJOR` et `MINOR` sont tous deux des entiers non négatifs) | Champ `protocolVersion` de l'en-tête de trame, nom du fichier schema | **Oui** |
| Statut du document (Document Status) | Cycle de vie du document | Énumération `Draft / Final / Deprecated / Obsolete` (exactement une valeur à tout instant) | Champ `status` du front matter | **Non** |
| Édition éditoriale (Editorial Edition) | Errata et clarifications | `YYYY-MM-DD` ancré à la date de publication (p. ex. `2025-10-25`) | Champ `date` du front matter et nom du répertoire de publication | **Non** |

Contraintes clés sur le statut du document et les répertoires (les conventions complètes de répertoires et le flux de gouvernance de finalisation se trouvent au Chapitre 10, ancrés aux règles de cette section) :

- Le statut du document **MUST** être un marqueur du front matter et **MUST NOT** être encodé dans un chemin de fichier ou un nom de répertoire.
- Qu'une édition publiée soit actuellement `Final`, `Deprecated` ou `Obsolete` est déterminé **uniquement** par le champ `status` de ses fichiers et **MUST NOT** être déduit du nom du répertoire.

### 1.7.2 Sémantique de `MAJOR.MINOR` et classification des changements

#### MAJOR (version majeure)

`MAJOR` est utilisé pour les changements qui **rompent l'interopérabilité**. Critère de décision : si un pair qui implémente strictement l'ancienne version `MAJOR.0` **rejetterait ou mésinterpréterait** un nouveau message, le changement rompt l'interopérabilité. De tels changements incluent, sans s'y limiter :

- changer la sémantique d'un champ schema faisant autorité ;
- supprimer un message ou un code d'erreur ;
- redéfinir un code d'erreur ;
- changer un état absorbant (absorbing state) de la machine à états.

WHEN un changement rompant l'interopérabilité survient, `MAJOR` **MUST** être incrémenté de 1 et `MINOR` **MUST** être réinitialisé à 0.

L'interopérabilité n'est **PAS** garantie entre différentes versions `MAJOR`.

#### MINOR (version mineure)

`MINOR` est utilisé pour les ajouts **rétro-compatibles**, incluant sans s'y limiter : ajouter des champs optionnels, ajouter des messages, ajouter des codes d'erreur, ajouter des paramètres, ajouter des attributs. Critère de décision : un pair qui implémente strictement l'ancienne version `MAJOR.0` ne rejetterait ni ne mésinterpréterait le nouveau message.

WHEN un ajout rétro-compatible survient, `MINOR` **MUST** être incrémenté de 1 et `MAJOR` **MUST** rester inchangé. Au sein d'un même `MAJOR`, un `MINOR` supérieur **MUST** être rétro-compatible jusqu'à `MAJOR.0`.

#### Règle de classification des changements (ordonnée, décidable)

Pour tout changement, son placement **MUST** être classé dans l'ordre suivant, produisant un palier unique :

1. Si un pair qui implémente strictement l'ancienne version `MAJOR.0` **rejetterait ou mésinterpréterait** le nouveau message → classer comme **MAJOR** ;
2. Sinon, si le changement ajoute du **contenu visible dans le format filaire** (en-tête/message/code d'erreur/paramètre ou autre structure visible sur le fil) → classer comme **MINOR** ;
3. Sinon (changement de texte uniquement, sans changement de format filaire) → **NE PAS** changer la version du protocole ; utiliser une édition éditoriale à la place (voir §1.7.4).
4. Si un changement correspond à plusieurs paliers simultanément, le **palier supérieur MUST** être retenu.

### 1.7.3 Règles de négociation de version et de compatibilité

Cette sous-section est **normative**.

#### Contraintes du format filaire

- **Seul** le `MAJOR.MINOR` de la version du protocole entre dans le format filaire (c.-à-d. le champ `protocolVersion` de l'en-tête de trame et le nom du fichier schema).
- La version du protocole **MUST** toujours entrer dans le format filaire ; une implémentation **MUST NOT** fournir de configuration excluant la version du protocole du format filaire.
- Le statut du document et l'édition éditoriale **MUST NOT** entrer dans le format filaire. Une implémentation **MUST NOT** changer le comportement de traitement des messages en fonction du statut du document ou de l'édition éditoriale —c.-à-d. que deux messages identiques dans le format filaire **MUST NOT** produire des résultats de traitement différents en raison de valeurs différentes sur ces deux axes.
- IF un message reçu manque d'information de version de protocole dans le format filaire (l'en-tête manque de `protocolVersion`, ou manque du sous-champ `major` / `minor`, ou sa valeur n'est pas un entier non négatif), THEN l'implémentation **MUST** rejeter le message avec une erreur de protocole et **MUST NOT** le traiter sous une version par défaut ou déduite.

#### Règles de négociation

- WHEN un handshake ou un bootstrap est effectué, les deux parties **MUST** déclarer chacune leur ensemble de versions de protocole prises en charge, qui **MUST NOT** être vide.
- La sélection de version **MUST** suivre : prendre d'abord le `MAJOR` le plus élevé pris en charge en commun par les deux, puis prendre le `MINOR` le plus élevé pris en charge en commun sous ce `MAJOR`.
- La partie ayant le `MINOR` supérieur **MUST** pouvoir servir le pair de `MINOR` inférieur : elle **MUST** traiter les messages du pair selon la sémantique de la version inférieure déclarée par le pair et **MUST NOT** rejeter au seul motif que le `MINOR` du pair est inférieur.
- IF les deux parties ne partagent aucun `MAJOR` commun, THEN l'implémentation **MUST** rejeter directement avec une erreur de protocole et **MUST NOT** effectuer de rétrogradation au mieux (best-effort). (La liaison concrète de cette erreur est `VERSION_INCOMPATIBLE` / 7001 au Chapitre 10.)
- WHEN un message avec le même `MAJOR` mais un `MINOR` supérieur est reçu, l'implémentation **MUST** interpréter les champs connus selon la sémantique de son propre `MINOR` le plus élevé et **ignorer** les champs optionnels non reconnus ; elle **MUST NOT** rejeter, écarter ni lever d'erreur.

#### Identifiants et suites cryptographiques

- WHEN une mise à niveau de version progressive (rolling) est effectuée, l'implémentation **MUST** maintenir valides les identifiants ou jetons existants et non expirés (credentials / tokens) et **MUST NOT** les invalider au seul motif du changement de version.
- WHERE le protocole dispose déjà d'un mécanisme de négociation de suite cryptographique (cipher-suite), la négociation de version **MUST** réutiliser la même approche (chacune déclare, on prend le plus élevé commun).

> La séquence de négociation (Hello / Hello_Ack) et le mécanisme « une seule version au sein d'une session, pas de changement en cours de session » se trouvent au Chapitre 10.

### 1.7.4 Édition éditoriale et errata

Les contraintes de cette sous-section sont des contraintes de gouvernance **non normatives** ; toutefois, la règle « MUST NOT déguiser en mise à niveau » est contraignante pour l'exactitude du numéro de version du protocole.

- WHEN des errata de texte pur sont effectués après finalisation (corriger des coquilles, ajouter des exemples, clarifier la formulation, réparer des liens), le numéro de version du protocole (`MAJOR.MINOR`) **MUST** rester inchangé ; les errata **MUST** être portés par un **nouveau répertoire de date de publication**, et les répertoires publiés existants **MUST** rester gelés de sorte que les références et liens anciens **MUST NOT** être rompus.
- Une édition éditoriale **SHOULD** être enregistrée sous une catégorie `Editorial` dans le journal des modifications (le cas échéant) ; le front matter **MUST** marquer son édition avec les champs `edition` / `date`.
- Une édition éditoriale **n'autorise que** des changements non normatifs et **MUST NOT** toucher à la sémantique du format filaire, aux déclarations normatives, aux codes d'erreur, à la machine à états ou au comportement d'interopérabilité.
- **Contrainte stricte** : IF une modification touche à la sémantique du format filaire, THEN elle **MUST** incrémenter `MINOR` ou `MAJOR` selon §1.7.2 et **MUST NOT** être déguisée en publication d'errata (édition éditoriale).

### 1.7.5 Tableau de placement du numéro de version et liste de contrôle pour les implémenteurs

#### Tableau de placement

| Point de placement | Ce qui y figure | Contrainte normative |
|--------------------|-----------------|----------------------|
| Champ `protocolVersion` de l'enveloppe filaire | `MAJOR.MINOR` | Ne porte **que** `MAJOR.MINOR`, aucun autre niveau |
| Nom du fichier schema | Suit `MAJOR.MINOR` | **MUST NOT** être renommé avec l'édition éditoriale (maintient des références stables) |
| content-type | `application/dtp` | Identifie la famille de protocole ; son paramètre `version=` n'est **qu'une** commodité de routage de passerelle et n'est **PAS** de la sémantique de format filaire |
| `status` / `date` du front matter | Marqueurs de gouvernance du document | **PAS** dans le format filaire |
| git tag | `dtp-v<MAJOR.MINOR>-<statut>` | Le tag **MUST** couvrir corps + vecteurs de test + schema ensemble |

#### Liste de contrôle pour les implémenteurs (lecture obligatoire)

- Juger l'interopérabilité **uniquement** par la version du protocole (`MAJOR.MINOR`) ; **MUST NOT** s'appuyer sur le statut du document ou l'édition éditoriale.
- Le même `MAJOR` **MUST** être rétro-compatible jusqu'à `MAJOR.0`.
- **MUST NOT** traiter les errata (éditions éditoriales) comme des mises à niveau de protocole.
- **MUST NOT** s'appuyer sur le nom du fichier schema pour encoder l'édition éditoriale.
- Pendant `Draft`, il n'y a **AUCUNE** promesse de compatibilité.

> Les conventions complètes de répertoire et de statut, ainsi que les actions standard de finalisation (Draft → Final), se trouvent au Chapitre 10 « Évolution du protocole et gouvernance » ; le format du git tag, l'énumération des statuts et la définition de l'édition éditoriale qui y sont référencés **MUST** être ancrés à cette section (§1.7).
