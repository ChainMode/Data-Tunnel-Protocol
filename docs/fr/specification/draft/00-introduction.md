# Spécification du Data Tunnel Protocol (DTP)

**Version** : Draft
**Version cible** : 2025-10-25
**Statut** : Draft, en attente de revue
**Couche du protocole** : Couche applicative

## Introduction

Cette spécification définit le format binaire (wire format), la machine à états, le mécanisme de négociation, les exigences de chiffrement, la gestion des erreurs et les règles de gestion des versions du Data Tunnel Protocol (DTP). DTP est le protocole de couche applicative utilisé dans l'écosystème iFay pour la collecte et l'injection bidirectionnelles de données entre les terminaux et Fay.

Cette spécification est le document **normatif** du DTP. Toute implémentation conforme à cette spécification devrait pouvoir interopérer avec d'autres implémentations conformes.

## Convention sur les mots-clés

Les mots-clés **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY** et **OPTIONAL** dans ce document doivent être interprétés comme décrits dans la RFC 2119 et la RFC 8174, et n'ont une signification normative que lorsqu'ils apparaissent en **gras**.

## Structure du document

Cette spécification est composée de 10 chapitres :

| Chapitre | Titre | Portée |
|----------|-------|--------|
| Chapitre 1 | Aperçu et positionnement | Le rôle de DTP, ses objectifs de conception, sa relation avec d'autres protocoles, et la gestion des versions et compatibilité (§1.7, normative) |
| Chapitre 2 | Terminologie et définitions | Définitions normatives de la terminologie |
| Chapitre 3 | Architecture du protocole | Découpage en couches, composants et machine à états du protocole |
| Chapitre 4 | Structure de trame logique | Format binaire de l'en-tête et du payload |
| Chapitre 5 | Mécanisme de négociation | Négociation, ajustement et terminaison d'Agreement |
| Chapitre 6 | Transmission de données | Flux de collecte et d'injection de données |
| Chapitre 7 | Sécurité et chiffrement | Exigences de chiffrement de bout en bout |
| Chapitre 8 | Fiabilité | Reprise, accusé de réception et gestion de session |
| Chapitre 9 | Gestion des erreurs | Codes d'erreur et mécanisme de notification |
| Chapitre 10 | Gestion des versions | Mécanismes opérationnels et flux de gouvernance de la gestion des versions (politique faisant autorité au Chapitre 1 §1.7) |

## Conformité

Toute entité qui prétend implémenter DTP (ci-après désignée comme « implémentation ») **MUST** satisfaire aux exigences de conformité suivantes :

1. L'implémentation **MUST** prendre intégralement en charge toutes les règles **MUST** définies dans cette spécification.
2. L'implémentation **SHOULD** prendre en charge toutes les règles **SHOULD** définies dans cette spécification. En cas de non-prise en charge, l'implémentation **MUST** divulguer explicitement la déviation dans sa documentation.
3. L'implémentation **MAY** choisir si elle prend en charge ou non les règles **MAY**.
4. L'implémentation **MUST NOT** introduire d'extensions qui entrent en conflit avec cette spécification. Toute extension **MUST** être implémentée via les mécanismes d'extension définis dans cette spécification (voir les champs personnalisés du chapitre 4, les extensions de paramètres d'agreement du chapitre 5).

## Références normatives

- **RFC 2119** — Key words for use in RFCs to Indicate Requirement Levels
- **RFC 8174** — Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words
- **RFC 4122** — A Universally Unique IDentifier (UUID) URN Namespace (utilisé pour Fragment_ID, Agreement_ID, Session_ID)
- **RFC 3339** — Date and Time on the Internet: Timestamps (format d'horodatage UTC)
- **CAP Specification** — Control Authorization Protocol ; DTP s'appuie sur CAP pour la vérification d'identité et l'échange de clés

## Documents associés

- **DTP Blueprint** (`docs/fr/blueprint/`) : matériel d'introduction non normatif pour DTP, fournissant la motivation, la justification de la conception et des exemples
- **DTP Schema** (`schema/draft/schema.ts`) : définitions de types TypeScript de référence pour DTP
