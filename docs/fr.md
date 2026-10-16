# Segway Navimow

**Connecteur non officiel, sans lien avec Segway ni Navimow.** Il amène vos
tondeuses robots Segway Navimow (les modèles sans fil périphérique) dans
Gladys par le cloud Navimow, celui de l'application Navimow, avec la même
connexion que celle que Segway propose à Home Assistant. Navimow et Segway
sont des marques de leurs propriétaires.

> **Version de développement (0.1).** Construite à partir de la documentation
> et des intégrations de Segway, et testée avec des réponses simulées : elle
> n'a pas encore tourné avec une vraie tondeuse. Vos retours sont les
> bienvenus dans les
> [issues GitHub](https://github.com/LM1LC3N7/gladys-navimow/issues).

## Ce que vous obtenez

| Surface                   | Contenu                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un appareil par tondeuse  | état de fonctionnement, batterie, activité, code et texte d'erreur, en ligne, avancement de la tonte (%) et surface tondue dans la session (m²), un choix **tondre / pause** et un bouton de **retour à la station** |
| Mises à jour en direct    | l'état, la batterie et l'avancement arrivent en quelques secondes pendant le travail (MQTT sur WebSocket sécurisé) ; l'état est aussi relu toutes les 5 minutes                                                      |
| Déclencheurs de scène     | **erreur**, **activité changée**, **tonte terminée** (complète, interrompue ou inconnue), **de retour à la station**                                                                                                 |
| Actions de scène          | **démarrer la tonte**, **pause**, **reprendre**, **retour à la station**, pour une tondeuse ou toutes                                                                                                                |
| Widget de tableau de bord | **Tondeuse robot** : batterie, avancement, activité, erreur, en ligne, mises à jour en direct, et boutons Démarrer / Pause / Reprendre / Station                                                                     |
| Écran de configuration    | un bouton **Tester Navimow** qui liste vos tondeuses                                                                                                                                                                 |

## Installation

1. Installez l'intégration depuis le store Gladys, puis ouvrez son écran de
   **Configuration**.
2. À côté de **Compte Navimow**, cliquez sur **Connecter**. La page de
   connexion de Segway s'ouvre : connectez-vous avec l'e-mail et le mot de
   passe de l'application Navimow (elle peut demander un captcha). Le
   navigateur revient ensuite tout seul dans Gladys, et l'état de connexion
   passe au vert.
3. Ouvrez **Découverte** et ajoutez vos tondeuses.
4. Placez le widget **Tondeuse robot** sur un tableau de bord.

Votre mot de passe reste chez Segway : Gladys ne reçoit qu'un jeton de
session, que l'intégration renouvelle toute seule (environ toutes les
heures). Si Segway met fin à la session, l'état de connexion le dit : cliquez
à nouveau sur **Connecter**.

### Si Connecter ne revient pas dans Gladys

Connectez-vous à la main, comme le fait l'adaptateur ioBroker :

1. Ouvrez le lien **Page de connexion Navimow** de l'écran de configuration
   (dans le bloc « Connecter ne revient pas dans Gladys ? ») et connectez-vous.
2. Le navigateur affiche ensuite une page d'erreur dont l'adresse commence
   par `http://localhost:1/callback?code=` : c'est normal.
3. Copiez **toute cette adresse** dans l'action **Se connecter avec l'adresse
   copiée** en bas de l'écran de configuration, et lancez-la dans les minutes
   qui suivent (un code ne sert qu'une fois, peu de temps).

## L'appareil

Gladys n'a pas encore de catégorie tondeuse robot : comme l'intégration
Husqvarna Automower, l'état et les deux commandes utilisent la catégorie
**aspirateur robot**, la seule qui décrit un robot qui travaille, rentre à sa
base et se recharge. La carte de l'appareil affiche donc :

- **État** : En cours (tonte ou cartographie), En pause, Retour à la base,
  En charge, Sur la base, Erreur (soulevée ou une erreur), Arrêté (à l'arrêt,
  mise à jour, autotest, hors ligne) ;
- **Tonte (arrêt : pause)** : un choix dont **Tondre** (« Nettoyer ») démarre
  la tonte (ou reprend une tonte en pause) et **Pause** (« Repos ») met la
  tondeuse en pause ;
- **Retour à la station** : le bouton « Retour à la base ».

Les autres fonctionnalités sont la batterie (%), l'activité (texte dans la
langue choisie dans la configuration), le code d'erreur (0 : aucune, -1 : une
erreur sans code numérique) et son texte, en ligne, l'avancement de la tonte
(%) et la surface tondue dans la session en cours (m²). L'avancement et la
surface arrivent avec les messages de position de la tondeuse : Segway ne les
envoie que quand la tondeuse tond tout le terrain (une tâche par zone n'en
envoie pas).

**Démarrer** lance la tâche réglée dans l'application Navimow ; l'API
publique n'offre pas de « terminer la tâche » : **pause** arrête la tondeuse
là où elle est, **retour à la station** la renvoie chez elle.

## Scènes

- **Erreur Navimow** : une fois par erreur (soulevée, coincée, erreur de
  moteur ou de capteur...). Variables : le code, le texte en anglais et en
  français, l'activité, la batterie.
- **Activité Navimow changée** : éventuellement pour une activité (tonte,
  cartographie, en pause, retour à la station, à la station, en charge, à
  l'arrêt, soulevée, erreur, mise à jour logicielle, autotest, hors ligne).
  Variables : la nouvelle et l'ancienne activité, la batterie.
- **Tonte Navimow terminée** : une session (elle commence quand la tondeuse
  tond) s'est terminée à la station ou à l'arrêt. Son **issue** peut filtrer
  le déclencheur : **complète** (l'avancement a atteint 100 %),
  **interrompue** (moins de 100 % : un arrêt, ou une pause de recharge avant
  de repartir) ou **inconnue** (aucun avancement reçu, par exemple une tâche
  par zone). Variables : l'issue, où elle s'est arrêtée, la durée de la
  session en minutes (vide si la session a commencé avant que Gladys la
  voie), l'avancement, la surface, la batterie, l'heure de fin.
- **Navimow de retour à la station** : la tondeuse est arrivée à sa station,
  quelle qu'en soit la raison (fin de tonte, pause de recharge, renvoi). Une
  tondeuse que le cloud revoit (hors ligne avant) ne compte pas.

Les actions **démarrer la tonte**, **pause**, **reprendre** et **retour à la
station** agissent sur la tondeuse choisie, ou sur toutes quand le champ est
vide. Elles donnent `mower_name` et `count` aux actions suivantes de la
scène, qui les trouvent dans leur liste de variables (écrites
`{{<étape>.<action>.<clé>}}`, par exemple `{{0.0.count}}` quand cette action
est la première de la scène).

## À quelle fréquence Navimow est appelé

Au démarrage : la liste des tondeuses et leur état (un seul appel pour
toutes). Pendant le travail, les mises à jour en direct apportent les
changements. L'état est relu toutes les 5 minutes (option **Intervalle de
relecture de l'état**, 1 à 60), toutes les 2 minutes quand les mises à jour
en direct sont coupées, et 10 secondes après une commande ; la liste des
tondeuses toutes les 12 heures et à chaque recherche dans Découverte. Une
tondeuse à la station n'envoie rien en direct : sa batterie suit la lecture
des 5 minutes.

## Dépannage

- **« Non connecté »** : cliquez sur **Connecter** (installation, étape 2).
- **« La session Navimow a expiré ou a été refusée »** : Segway a mis fin à
  la session (mot de passe changé, compte déconnecté) : cliquez à nouveau sur
  **Connecter**.
- **La page de connexion ne revient pas dans Gladys** : utilisez la connexion
  à la main ci-dessus.
- **« Mises à jour en direct coupées »** : l'intégration continue de relire
  l'état toutes les 2 minutes et se reconnecte toute seule ; les logs disent
  pourquoi.
- **L'état a une minute de retard sur l'application** : l'état du cloud que
  lit l'intégration est un cache ; les mises à jour en direct, quand elles
  sont actives, sont immédiates.
- Logs : le niveau de log de l'intégration se règle avec la variable
  `LOG_LEVEL` (`debug` journalise aussi les messages d'événements et
  d'attributs des tondeuses).

## Confidentialité

L'intégration n'utilise que l'état de vos tondeuses : les positions que
Segway envoie avec l'avancement sont jetées aussitôt, jamais stockées ni
affichées. Le jeton de session ne va que chez Segway et n'apparaît jamais
dans un log, un état ou une scène.
