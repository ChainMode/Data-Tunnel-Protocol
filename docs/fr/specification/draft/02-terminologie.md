# Chapitre 2 Terminologie et définitions

Ce chapitre définit tous les termes normatifs utilisés dans cette spécification. Chaque terme portant une signification normative est mis en gras lors de sa première occurrence.

## 2.1 Termes de rôle

**Fay**
: Terme générique désignant un agent IA anthropomorphisé, incluant iFay et coFay.

**iFay** (Individual Fay)
: Un avatar IA personnel lié à une personne physique spécifique (le Human Prime). **MUST** être en correspondance biunivoque avec le Human Prime.

**coFay** (Common Fay)
: Une IA à rôle public, semblable à un Agent, qui **MAY** servir plusieurs utilisateurs.

**Human Prime**
: La personne physique à laquelle un iFay est lié. Le propriétaire ultime de la souveraineté des données.

**FayGer**
: Le conteneur/environnement d'exécution d'un Fay (analogue à Docker/JRE). **MUST** être traité comme un « espace public » non fiable et **MUST NOT** accéder aux données en clair en aucune circonstance.

## 2.2 Termes de rôle dans le protocole

**Master**
: La partie qui contrôle dans le protocole DTP. **MUST** être un Fay (iFay ou coFay). Le récepteur dans le scénario de collecte de données et l'émetteur dans le scénario d'injection de données.

**Slave**
: La partie contrôlée dans le protocole DTP. **MUST** être un terminal logiciel ou matériel. L'émetteur dans le scénario de collecte de données et le récepteur dans le scénario d'injection de données.

**Controller**
: Le Fay qui « habite » actuellement un terminal. **MUST** détenir des permissions complètes en lecture/écriture. À un instant donné, un Slave **MUST NOT** avoir plus d'un Controller.

**Observer**
: Un Fay invité ou autorisé par le Controller. **MAY** détenir uniquement des permissions en lecture seule. **MUST NOT** initier de requêtes ni modifier d'Agreements.

## 2.3 Termes de transmission de données

**Data Collection**
: La direction du flux de données depuis un terminal (Slave) vers Fay (Master). **MUST** être utilisée pour persister dans le Personal Data Heap les données produites par le terminal.

**Data Injection**
: La direction du flux de données depuis Fay (Master) vers un terminal (Slave). **MUST** être utilisée pour fournir aux applications terminales des jeux de données filtrés et minimisés.

**Personal Data Heap**
: Le module de gestion des données privées d'un iFay. **MUST** être accessible uniquement à l'intérieur de l'iFay.

## 2.4 Termes de structure du protocole

**Logical_Frame**
: La structure de trame de la couche applicative de DTP. **MUST** être composée de deux parties : Header et Payload (voir Chapitre 4).

**Fragment**
: L'unité de données de DTP. **MUST** transporter un identifiant globalement unique et un horodatage d'origine, et **MUST** être associée à un Agreement.

**Agreement**
: Le contrat de transmission de données négocié et conclu entre le Master et le Slave. **MUST** être établi avant toute transmission de données. Il **MUST NOT** exister de transmission de données sans Agreement.

**Session**
: Un cycle complet de communication DTP. **MUST** être établie après que CAP a terminé son authentification, et **MUST** porter un Session_ID unique.

## 2.5 Termes d'identifiants

**Fragment_ID**
: L'identifiant globalement unique d'un Fragment. **MUST** être un UUID v4 tel que défini par la RFC 4122.

**Agreement_ID**
: L'identifiant globalement unique d'un Agreement. **MUST** être un UUID v4 tel que défini par la RFC 4122.

**Session_ID**
: L'identifiant globalement unique d'une Session. **MUST** être un UUID v4 tel que défini par la RFC 4122.

**Sequence_Number**
: Le numéro de séquence de transmission. **MUST** être un entier non négatif strictement croissant. **MUST** être maintenu indépendamment pour chaque direction de transmission au sein d'une même Session.

**Origin_Timestamp**
: L'instant auquel les données ont été réellement produites à la source. **MUST** utiliser le fuseau horaire UTC. **MUST** comporter une précision à la milliseconde.

## 2.6 Termes de mécanisme de protocole

**Negotiation**
: Le processus par lequel le Master et le Slave parviennent à un consensus sur les paramètres de transmission de données. **MUST** être réalisée via Request_Frame et Response_Frame.

**Agreement Lifecycle**
: La séquence complète d'états d'un Agreement, depuis sa création par négociation jusqu'à sa terminaison. **MUST** comprendre les quatre états `negotiating`, `active`, `suspended` et `terminated`.

**Resume**
: Le mécanisme permettant de poursuivre la transmission depuis le point de rupture après une interruption de connexion. **MUST** être implémenté à partir des numéros de séquence.

**DAG Dependency**
: La relation de dépendance sous forme de graphe orienté acyclique entre Fragments. **MUST** être déclarée explicitement via les arêtes DAG (DAGEdge).

## 2.7 Termes de composants logiciels

**DTP_Engine**
: Le moteur de traitement central du protocole DTP. **MUST** implémenter les fonctions cœur de codec de trame, de chiffrement, de négociation et de gestion de session.

**DTP_Master**
: La variante du DTP_Engine s'exécutant côté Fay. **MUST** détenir les permissions du rôle Master.

**DTP_Slave**
: La variante du DTP_Engine s'exécutant côté terminal. **MUST** détenir uniquement les permissions du rôle Slave.

**Transport_Adapter**
: L'interface abstraite du protocole de transport sous-jacent. **MUST** fournir une interface unifiée d'envoi/réception pour chaque protocole de transport pris en charge.

## 2.8 Termes d'état

**SessionState**
: L'état courant d'une Session. **MUST** être l'un de `idle`, `waiting_for_cap`, `established`, `negotiating`, `transmitting`, `suspended` ou `resuming`.

**AgreementStatus**
: L'état courant d'un Agreement. **MUST** être l'un de `negotiating`, `active`, `suspended` ou `terminated`.

**ConnectionState**
: L'état de connexion sous-jacente rapporté par le Transport_Adapter. **MUST** être l'un de `connected`, `disconnected` ou `error`.
