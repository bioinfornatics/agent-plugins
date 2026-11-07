# Spécification produit — CLI d’évaluation comparative de Skills et Plugins

Version : 0.3 — 2026-11-03.
Statut : exigences utilisateur consolidées ; propositions et décisions ouvertes explicitement identifiées. Cette spécification ne prouve ni une implémentation ni la compatibilité réelle des hôtes.
Périmètre : `apps/agent-plugin`. CLI public : `agent-plugin evaluation`.
Source : décisions utilisateur des conversations de conception du 2026-11-01 au 2026-11-03.

## Index de l’état courant — 2026-11-06

Les §§23–28 décrivent les tranches source récentes. Les tableaux datés 2026-11-03
restent des reçus historiques, pas un résumé de livraison actuel. CLI source :
evaluation/history/inspect/grading/regrading/judgments/export, Goose seul implémenté.
Import standard/enrichi diagnostiqué, preuves vérifiées et jugement append-only
sont câblés localement. Export grading.json/workspace et benchmark qualité sont
intégrés au runtime et vérifiés localement ; qualification globale en revue. Import
historique, calibration et fidélité native restent ouverts ; aucun état de ticket
parent ni publication ne découle de cet index.

## Autorité des exigences et état livré

Snapshot historique des sources au 2026-11-03, baseline `67028c0` :

| Capacité | Livraison et limite de preuve |
|---|---|
| Profil composé, snapshots, dry-run | Implémentés; PRF/REG §17, qualification locale §19 |
| Exécution Goose, parallélisme borné | Implémentés avec traitement complet; faux hôte/SQLite réelle |
| Registre utilisateur, reprise après arrêt processus | Schema-v2, plan figé et tentatives conservées; §18 |
| `history` / `inspect` | Lecture seule implémentée et qualifiée localement; §20 |
| Développement npm/Node/TypeScript | Node >=22.22.2; 92 tests, types et lint passent; development.md |
| Import, grading/regrading, HTML, modification explicite des membres d’un profil existant | Non livrés |
| Activation native, modèle/export réels | Non qualifiés; ap-kxi.4 |
| Runtime Node contenu | Migration locale en cours ap-fdz0; publication non réalisée |

La décision de profil composé et les règles PRF/REG §17 remplacent les anciennes
comparaisons par cible des sections 3–5, FR-03/FR-04 et du gate section 16.
Les §§2–4, 16, 17.4–17.7 et les reçus Bun des §§18–20 conservent les tranches
historiques; leur chronologie ne doit pas être lue comme l’état courant.
Les snapshots schema-v1/reprise absente sont remplacés par §18; l’historique absent
par §20. Les décisions validées §17.6/17.7 remplacent les questions initiales §17.4.
La rédaction d’une exigence n’est jamais sa preuve d’acceptation.

Les paramètres 0/50/3/3, Goose par défaut, suites exactes, séparation tâches/critères
et interdiction de fallback partiel restent applicables. Les tests injectés et
SQLite réelle ne prouvent ni activation native ni qualité métier. La reprise de
campagne ne garantit ni continuation native, ni durabilité face à une coupure électrique.
Source npm/Node et runtime installé sont distincts; aucun appel modèle ou publication
n’est autorisé par ce document.

## 1. Produit, utilisateurs et objectifs

Le produit est un CLI TypeScript/Commander.js développé avec npm et Node.js >=22.22.2, destiné aux auteurs de Skills/Plugins et aux analystes. Sa cible est de mesurer l’effet global d’un profil composé par comparaison avec/sans, conserver les preuves et faire juger les résultats. Préparation, exécution Goose, reprise et inspection sont livrées localement; jugement, regrading et rapport HTML restent à livrer.

Objectifs confirmés :
- G-1 : mesurer l’effet global d’un profil composé de Skills/Plugins sur les mêmes scénarios (profil/comparaison implémentés localement; effet natif et jugement non qualifiés).
- G-2 : comparer les résultats entre les agents sélectionnés, en exposant leurs modèles et configurations.
- G-3 : préserver la configuration fonctionnelle et les builtins sans contamination par d’autres capacités utilisateur.
- G-4 : conserver les résultats, conversations et fichiers pour une exploitation analytique et une rejouabilité qualifiée.
- G-5 : produire un rapport HTML de fin de campagne.
- G-6 : retrouver les campagnes et leurs preuves dans un registre utilisateur indépendant du projet, en distinguant les révisions du profil et le contexte expérimental.

Non-objectifs : création/optimisation automatique de Skills ; lancement automatique de tous les outils détectés ; garantie de sandbox OS ; résultats LLM déterministes ; compatibilité universelle de Plugins ; interface HTML déjà approuvée. Aucun appel payant, installation réelle, commit ou publication n’est autorisé par cette spécification seule.

## 2. Historique — tranche de préparation seule du 2026-11-02

Décision utilisateur du 2026-11-02 : renommer l’application en `apps/agent-plugin`
et exposer `agent-plugin evaluation`. Le contrat de cette tranche valide les entrées locales et
prépare la matrice ; elle ne lance aucun hôte, juge, installation ou appel modèle.
`evaluation --dry-run` produit du JSON représentant le plan préparé.
`evaluation` sans `--dry-run` effectue la même validation puis échoue explicitement
avec exécution indisponible. Une erreur d’entrée est prioritaire sur cette erreur.
La préparation est implémentée et couverte par les tests locaux de CLI et de
lecture de suites. Cela ne prouve pas une exécution réelle ni la compatibilité hôte.
SQLite, archives, isolation réelle, scoring, replay et HTML sont des exigences
futures, pas des fonctionnalités livrées. Les sections 5–12 décrivent ce futur.

## 3. Entrées et scénarios — comparaison par cible historique

`--skills <paths...>` et `--plugin <paths...>` acceptent plusieurs chemins, sont
répétables et combinables ; au moins une cible est requise. État initial historique : dédupliquer les racines
par kind et conserver une comparaison séparée pour chaque cible sélectionnée.
État courant : sélection agrégée en un seul profil selon les décisions §17.6/17.7;
les règles de chevauchement et d’union sont implémentées et testées localement.

Un Skill découvre silencieusement et exclusivement `<skill>/evals/evals.json`.
Pas de recherche alternative. Suite absente ou malformée : erreur.
Un Plugin découvre les enfants immédiats `skills/*/SKILL.md` puis le fichier exact
`evals/evals.json` de chaque enfant. Suite enfant absente : ignorer cet enfant ;
toutes absentes : erreur ; toute suite présente malformée : erreur, sans masquer
le problème avec une autre suite valide. Aucun eval à la racine du Plugin requis.
Dans le comportement initial historique, chaque scénario enfant compare le **Plugin complet**,
avec ses composants non-Skill, à son absence. Dans la cible profil, il compare le
**profil complet** comprenant ce Plugin et les autres composants; jamais le seul enfant.

Convention minimale de suite :

```json
{
  "evals": [
    {
      "id": 1,
      "prompt": "Normaliser la facture fournie dans output.json.",
      "expectations": ["Le résultat conserve la devise."]
    }
  ]
}
```

`prompt` est la tâche du candidat ; les attentes sont les critères futurs du juge,
jamais le prompt complet du juge ni des instructions transmises au candidat.
Les identifiants de scénarios sont namespacés par répertoire de Skill : des enfants
peuvent réutiliser le même ID local sans collision. Les exigences fines de conversion
du format enrichi et de résolution des fixtures restent à décider explicitement ;
ne pas prétendre leur prise en charge ou inventer des critères manquants.

## 4. CLI et plan expérimental — matrice historique

Contrat confirmé : `agent-plugin evaluation`.

| Option | Défaut | Sémantique |
|---|---:|---|
| `--skills <paths...>` répétable | aucun | Cibles Skill locales |
| `--plugin <paths...>` répétable | aucun | Cibles Plugin locales, combinables avec Skills |
| `--agent` répétable | `goose` | Hôtes explicitement sélectionnés, sans fallback |
| `--model` | non imposé ici | Chaîne libre, pas enum ni disponibilité attestée |
| `--timeout` | `0` | Secondes ; zéro désactive le timer futur |
| `--max-turns` | `50` | Tours demandés |
| `--repetitions` | `3` | Paires avec/sans par scénario et agent |
| `--parallelism` | `3` | Parallélisme demandé, non exécuté par la préparation |
| `--dry-run` | faux | Validation puis matrice JSON, sans appels hôtes |

`--budget` est différé : aucun plafond monétaire n’est disponible. Timeout zéro
et ces compteurs ne garantissent pas une limite de coût. Compteurs non entiers,
non finis ou négatifs rejetés ; répétitions, tours et parallélisme positifs.

Matrice initiale historique : pour chaque cible t ayant S_t scénarios, A agents et R répétitions, préparer
`2 × S_t × A × R` lignes candidates. Total : `2 × A × R × somme(S_t)` ; pas de
comparaison fusionnant toutes les cibles. Défaut : six lignes par scénario.
Les lignes sont des intentions, non des résultats ou reçus d’exécution.
Dans cette matrice historique, chaque paire partage cible, scénario, agent, modèle et limites ; seul le bras
avec/sans diffère. L’identité cible reste distincte de l’ID scénario namespacé.
Le modèle est demandé seulement : aucun modèle effectif ni télémétrie inventé.

## 5. Environnement et contrat des adaptateurs

Exigences confirmées : copier la configuration fonctionnelle de l’outil depuis le HOME original vers un fake HOME; exclure les capacités utilisateur ambiantes; conserver les builtins. La cible 2026-11-03 installe tout le profil dans le bras avec, aucun de ses composants dans le bras sans (PRF-04), plutôt qu’un seul Skill/Plugin.

Proposition de sécurité et fidélité :
1. Préflight de la cible, du fichier evals, de l’hôte/version, des capacités et de l’authentification nécessaire.
2. HOME/workspace/session neufs par exécution, hors des ancêtres du dépôt opérateur.
3. Copie filtrée de configuration, sans copie globale du HOME ou keyring. Relocalisation HOME/XDG et overrides spécifiques attestés ; environnement enfant explicite, sans modifier celui du CLI parent.
4. Retrait des capacités tierces et instructions ambiantes ; mêmes builtins dans les deux bras d’un hôte.
5. Installation native complète de la cible dans le bras avec ; aucune copie accessible de la cible ou des critères dans le bras sans. Les données nécessaires aux deux bras sont des fixtures indépendantes de la cible.
6. Inventaire effectif des capacités lorsque vérifiable ; sinon preuve d’isolation marquée indisponible, pas affirmée.
7. Exécution par argv, collecte, archivage puis cleanup. Annulation et terminaison des descendants à tester selon OS ; aucun retry payant implicite.

Fake HOME n’est pas un sandbox OS : réseau, sockets, keyring, chemins absolus et extensions peuvent maintenir des accès à l’hôte. Les exceptions sont déclarées. La configuration ne doit pas être archivée avec ses secrets.

Chaque adaptateur Goose/Codex/Claude possède son mapping configuration/installation, protocole non interactif, session, final, export et limites. Plugin non supporté, transport MCP ou hook non mappable : préflight unsupported explicite, jamais conversion silencieuse en un sous-ensemble de Skills.

Enregistrer tours demandés/effectifs/observés et raisons d’arrêt. Aucun équivalent universel de « tour » n’est supposé. Timeout zéro ne borne pas un outil bloqué ou le coût. Délais de préflight/export, grace de terminaison et limites de collecte sont à décider séparément.

## 6. Juge LLM et comparaison

Notation par juge LLM confirmée. Les validations structurelles et d’intégrité restent déterministes ; elles ne remplacent pas le jugement sémantique.

Proposition : juge dans une session indépendante par sortie, paquet aveuglé sans identité de l’hôte/bras ni notes précédentes, critères figés, preuves pertinentes fournies comme données non fiables. Pas d’auto-évaluation implicite du candidat. Toute inspection de fichier non textuel nécessite un moyen d’observation explicite ; absence de preuve = indécidable, pas preuve inventée.

Résultat proposé par critère : `pass | fail | inconclusive`, citation exacte liée à une source de preuve et justification. Vérifier les citations ne prouve pas la justesse du raisonnement. Conserver séparément les erreurs du juge et les verdicts métier. Les critères manquants, sorties manquantes et échecs de collecte sont visibles.

Agrégation proposée, à valider : taux de réussite parmi verdicts décisifs accompagné de la couverture décisive ; poids égaux par scénario ; gains/régressions et résultats partagés calculés par paire. Politique exacte des indécidables et échecs techniques à définir avant calcul de la note. Versionner la méthode et ne pas présenter une note comme probabilité de correction.

Le modèle/hôte/raisonnement du juge, instructions complètes, paramètres et versions sont enregistrés indépendamment des candidats. Choix du juge et calibration sur exemples adjudicés restent ouverts.

## 7. Stockage, preuves et rejouabilité

Exigences confirmées : résultats finaux dans SQLite ; conversations, traces et fichiers archivés ; possibilité de rejouer. Topologie utilisateur approuvée le 2026-11-03 (REG-01..07): une SQLite partagée indexe les profils/révisions/campagnes, observations, jugements disponibles et références d’archives isolées par campagne, sans duplication systématique de gros blobs. La DB par campagne appartient uniquement au comportement historique; les sources actuelles utilisent le registre utilisateur partagé schema-v2.

Opérations distinctes :
- Inspection : lecture sans appel LLM.
- Regrading : nouveau jugement des mêmes preuves hashées, sans relancer les candidats ; historique append-only.
- Réexécution : nouveaux essais depuis les entrées figées, nouvelles identités et liens parents ; environnement neuf et credentials re-résolus. Une nouvelle comparaison nécessite des paires complètes ; un bras seul est diagnostique.

La conservation d’une conversation ne garantit ni reprise native ni reproduction déterministe. Dépendances externes, disponibilité des modèles, authentification et état réseau ne sont pas intégralement capturés.

Proposition de cohérence : enregistrer le démarrage, collecter dans une archive temporaire privée, fermer les writers, finaliser le manifeste puis renommer sur le même filesystem ; transaction SQLite indexe ensuite l’archive finalisée. Pas d’atomicité fictive SQLite+filesystem. Une interruption laisse un état explicite ou une archive orpheline réindexable, jamais un résultat faussement complet. Échec global de stockage arrête l’admission de nouveaux essais.

Archives : plan figé, sources cible/fixtures/évals, demandes, instructions du juge, reçus d’exécution, réponses, conversations disponibles, fichiers et manifestes chemins/tailles/hashes. Archives natives et projections consultables sont distinctes. Ne pas conserver automatiquement tout HOME, keyrings, credentials ou bases natives secrètes. Éviter liens sortants/fichiers spéciaux et exécution de contenus archivés. Décider rétention, chiffrement, tailles et fidélité d’export par hôte.

États distincts proposés : exécution (`completed`, `nonzero`, `timeout`, `cancelled`, `interrupted`, `unavailable`), collecte (`complete`, `partial`, `unavailable`), grading (`completed`, `failed`, `not_run`), verdict par critère. Exit zéro n’implique pas réussite métier.

## 8. Modèle de données analytique proposé

Modèle logique, non migration SQL approuvée : `experiments`, `scenarios`, `trials`, `grading_runs`, `judgments`, `artifacts`. Clés d’appariement et contraintes d’unicité par campagne/scénario/hôte/répétition/bras/essai ; les retries et replays ont une nouvelle identité et un lien parent.

| Groupe | Données à conserver |
|---|---|
| Identités | campagne, scénario, essai, paire, répétition, bras, parent, ordre d’exécution |
| Entrées | kind/name/hash cible, evals/fixtures/demande/critères hashés, versions de schéma |
| Hôte | identifiant CLI, version, binaire/hash disponible, version adaptateur |
| Modèle | fournisseur, modèle demandé et effectif, raisonnement demandé et effectif, valeurs natives et disponibilité de l’observation |
| Paramètres | temperature/top_p/seed/max_output_tokens lorsque exposés, options hôte JSON versionnées |
| Limites non monétaires | délai, tours demandés/effectifs/observés, répétitions/parallélisme résolus ; aucun plafond de coût |
| Temps et états | timestamps UTC, durée, statut, exit code/signal, raison d’arrêt, catégorie d’erreur |
| Usage | tokens entrée/sortie/cache/raisonnement, source et disponibilité de télémétrie |
| Coût | montant/devise, mesuré ou estimé, source et version des tarifs |
| Environnement | OS/architecture/runtime, empreinte de configuration non secrète, inventaire des capacités |
| Provenance | invocation, capture, archive/manifestes, hashes, politique d’isolation, exemptions |
| Juge | grading_run, modèle/hôte/raisonnement/paramètres du juge, instructions/hash/version, date, critères/verdicts/citations/justifications |

Identifiant modèle libre (les exemples utilisateur ne prouvent pas sa disponibilité). Les niveaux de raisonnement sont propres aux hôtes : conserver la valeur native et un mapping normalisé seulement s’il est documenté. Demandé ≠ effectif. Télémétrie absente = NULL avec raison, jamais zéro ni valeur demandée recopiée comme observation. Fingerprints excluent les valeurs secrètes.

Les agrégats sont recalculables, liés à un grading_run et une version de méthode ; ne pas confondre nouvelle note et nouveau résultat candidat. Prévoir une restitution tabulaire analytique comme proposition, sans ajouter un dashboard/entrepôt distant au périmètre.

## 9. Rapport HTML

Exigence confirmée : rapport HTML généré en fin de campagne. Proposition : le générer/régénérer à partir de SQLite et des archives vérifiées, sans appel LLM et sans logique de scoring divergente. Campagne partielle doit rester représentable.

Données à exposer :
- résumé cible, agents effectivement sélectionnés, modèles/raisonnement, budgets et provenance ;
- dénominateurs prévus/exécutés/collectés/évaluables et erreurs techniques ;
- comparaisons avec/sans et entre configurations, gains/régressions/indécidables ;
- critères, répétitions, dispersion descriptive, coût/durée avec disponibilité ;
- détail demande/réponse, jugement/citations, conversations et fichiers archivés ;
- limites de fidélité, configuration demandée/effective et versions.

UI à concevoir et approuver séparément : résumé → comparaison → scénario → essai/preuves. Pas de classement assuré ni de note isolée masquant couverture/erreurs. Lectures de données uniquement ; CRUD N/A pour un rapport statique. Afficher les données non fiables échappées, sans HTML/scripts de candidats exécutables. Portabilité, taille, accessibilité et règles de liens aux archives restent à décider puis vérifier en navigateur.

## 10. Architecture hexagonale minimale proposée

Domaine : scénario, plan expérimental, condition, paire/essai, preuve, jugement ; règles pures d’expansion et comparaison.
Application : préparation du plan, orchestration de campagne, inspection/regrading/réexécution et restitution.
Entrée : Commander.js ; composition root séparée du cœur.
Ports minimaux :
- `CandidateHost` : préflight, préparation, installation, lancement, collecte et cleanup propres à l’hôte.
- `Judge` : critères et preuves → jugements structurés.
- `EvaluationStore` : plan, observations, archives et jugements relisibles.

Rapport HTML : adaptateur de restitution consommant un modèle de lecture. Scheduler/lecture evals peuvent rester des modules simples. Ne pas créer un port par appel filesystem, ORM, bus ou infrastructure distribuée. Séparer port d’exécution candidat et grading même si un transport bas niveau est partagé.

## 11. Critères fonctionnels et vérification prévue

Toutes les vérifications ci-dessous sont À EXÉCUTER ; elles ne sont pas des résultats acquis.

| ID | Given / When / Then | Vérification |
|---|---|---|
| FR-01 | Évals locaux valides / préparation / scénarios et critères sont figés séparément des prompts candidats. Évals absents ou invalides / préparation / aucun appel candidat n’est lancé. | Tables de validation et plan figé |
| FR-02 | Aucune sélection / campagne / seul Goose est choisi. Sélection explicite / campagne / seuls ces hôtes sont lancés. Hôte indisponible / préflight / aucun fallback silencieux. | CLI + runner observable |
| FR-03 | S scénarios retenus du profil, A hôtes, R répétitions / planification / 2×S×A×R essais avec identités de paires et mêmes entrées; profil complet comme traitement (PRF-03). | Expansion pure + fixtures |
| FR-04 | Configuration opérateur contenant capacités tierces / préparation des bras / builtins conservés et profil complet seul présent dans avec, aucun membre dans sans; installation réelle inchangée (PRF-04). | Filtrage + inventaire hôte autorisé |
| FR-05 | Plugin exigeant capacité non supportée / préflight / unsupported explicite avant exécution, pas évaluation partielle silencieuse. | Contrats versionnés des hôtes |
| FR-06 | Limites résolues / exécution / défauts 0/50/3/3 respectés ou capacité non applicable signalée ; timeout zéro n’expire pas immédiatement. | Scheduler/processus + contrats hôtes |
| FR-07 | Annulation ou timeout / exécution / arrêt des processus détenus, preuves partielles et états distincts conservés. | Tests lifecycle par OS supporté |
| FR-08 | Preuves et critères figés / grading / verdicts traçables sans révélation des critères au candidat ; données indisponibles ne deviennent pas réussite. | Paquet juge + validation + campagne autorisée |
| FR-09 | Essai finalisé / stockage / identité, paramètres demandés/effectifs disponibles, preuves et jugements restent liés. | SQLite contraintes + manifestes |
| FR-10 | Crash entre archive et transaction / redémarrage / état interrompu ou archive récupérable, pas résultat complet sans preuve. | Injection de panne |
| FR-11 | Preuves conservées / regrading / nouveaux jugements sans appel candidat ni remplacement de l’historique. | Intégration store/judge |
| FR-12 | Entrées figées / réexécution explicitement demandée / nouveaux essais liés aux parents sans promesse de déterminisme. | Reconstruction et reçus |
| FR-13 | Résultats complets ou partiels / génération HTML / rapport relisible sans LLM montrant dénominateurs, comparaisons et preuves disponibles. | Données de référence + navigateur |
| FR-14 | Contenu candidat avec HTML/script / affichage / contenu traité comme donnée, aucun script candidat exécuté. | Tests d’injection du rapport |

## 12. Contraintes non fonctionnelles et gates

| ID | Mesure / cible | Environnement et méthode | Statut |
|---|---|---|---|
| NFR-01 | Défaults confirmés : délai 0 s désactivé, 50 tours demandés, 3 répétitions, parallélisme 3. Plafond proposé : appels actifs ≤ valeur configurée. | CLI + compteur lifecycle instrumenté, cas concurrents candidat/juge | Contrat de portée à valider, tests non exécutés |
| NFR-02 | Mutations de l’installation réelle et secrets configurés présents dans archives/DB : zéro dans les fixtures de vérification. | HOME opérateur fixture avant/après, secrets sentinelles et archives | Contrainte de sécurité proposée ; ne prouve pas absence de tous secrets inconnus |
| NFR-03 | Tous les fichiers de preuve admis vérifiés contre manifeste ; corruption détectée avant regrading. | Altération contrôlée, lecture store | À vérifier |
| NFR-04 | Aucun code candidat exécuté par le rapport HTML. | Fixture d’injection, navigateur | À vérifier |

Limites numériques de stockage, collecte, rétention, préflight/export, performances et accessibilité du rapport : non définies, à décider ; ne pas inventer de SLA. Modèles indisponibles et état externe limitent la réexécution.

Acceptation de chaque epic : critères mappés aux preuves exactes ; revue indépendante pour acceptation US/produit. Tests injectés ≠ compatibilité hôte ; prévoir des gates réels explicitement autorisés. Rubrique de revue projet `slice-acceptance v1.1.0` pour futures fonctionnalités, distincte de la note LLM des Skills. La présente rédaction relève du mode petite tâche auteur, pas de l’acceptation produit. Maximum proposé de trois corrections par slice avant escalade.

## 13. Décisions ouvertes et prochain frontier

| ID | Décision | Impact |
|---|---|---|
| D-01 | Raisonnement/configuration modèles-hôtes; détails de chemins DB/archive | Topologie registre utilisateur + preuves par campagne approuvée; résolution précise REG-D1 ouverte |
| D-02 | Format simple vs conversion enrichie, critères manquants, fixtures et priorités CLI/scénario/défaut | Bloque ingestion finale |
| D-03 | Hôte/modèle/raisonnement du juge, instructions, calibration et gestion fichiers non textuels | Bloque grading réel |
| D-04 | OS/versions d’hôtes supportés, limites effectives, mapping Skills/Plugins et exceptions auth | Bloque acceptance réelle par adaptateur |
| D-05 | Note/poids/indécidables, politiques essais techniques, comparaison inter-modèles | Bloque score final |
| D-06 | Format/rétention/confidentialité/fidélité des archives et limites de taille | Bloque archive de production |
| D-07 | UI HTML, accessibilité, portabilité et données initialement visibles | Bloque UI finale, pas modèle de lecture |

Le découpage futur ne change pas le périmètre de préparation confirmé. Beads reste la source de vérité des tâches/status/dépendances ; cette spécification ne constitue pas un tracker parallèle. Aucun epic d’implémentation n’est créé sans validation de leur découpage.

## 14. Références inspectées

- `skills/skill-creator/references/schemas.md`, sections Mandatory isolated evaluation contracts et evals.json : séparation tâche/critères et formats coexistants.
- `skills/skill-creator/agents/grader.md`, Inputs et Step 3 : juge aveuglé, données non fiables, verdicts et preuves.
- Conversation utilisateur du 2026-11-01 : exigences du nouveau produit ; les anciens défauts et commandes des runtimes ne deviennent pas les contrats de ce CLI.

Ces références locales ont été inspectées ; leur contenu n’atteste pas une exécution des trois hôtes ni l’application de leurs derniers protocoles publics.

## 15. Décision de distribution — 2026-11-02

Choix utilisateur confirmé : conserver le canal Git depuis `main`, le launcher
`scripts/skill-creator.mjs` et un runtime JavaScript contenu nécessitant Node.js 22+.
Les archives natives par plateforme ne remplacent pas ce canal. Aucun wrapper
Python/Bun/Bash/PowerShell ni téléchargement de binaire au lancement n’est ajouté.
Voir [deployment.md](deployment.md) pour le pipeline, ses garanties et la migration
runtime non réalisée depuis `apps/agent-plugin` ; le renommage source ne change
pas le launcher installé ni son mapping. Le développement npm/Node ne prouve pas
la compatibilité du runtime contenu installé.

Les epics E1–E6 sont désormais validés et enregistrés dans Beads. Les défauts
Goose et 0/50/3/3 ne sont pas des décisions bloquantes à rediscuter. Les anciennes
mentions « proposés » décrivent la rédaction initiale; les détails non tranchés
restent distingués des exigences utilisateur. Une évolution du produit doit mettre
à jour le document et les tickets concernés sans modifier silencieusement les critères.

## 16. Gate de préparation — 2026-11-02

À vérifier par l’implémentation, non exécuté par cette mise à jour documentaire :
options combinées/répétées ; déduplication par kind ; suites exactes et silencieuses ;
Plugin sans eval racine ; enfants absents ignorés mais suite présente malformée
rejetée ; namespaces distincts ; matrice séparée par cible et Plugin complet ;
défauts 0/50/3/3 et modèle libre ; JSON dry-run sans appel hôte ; validation puis
erreur explicite sans dry-run. Les critères de campagne FR-04 et suivants restent
futurs et ne doivent pas servir à déclarer cette tranche exécutable.


## Execution slice — 2026-11-02 (supersedes preparation-only behavior above)

Non-dry-run now executes Goose trials sequentially; `--output <directory>` defaults
to `.artifacts/evaluations`. Each campaign creates a private UUID directory with
`evaluation.sqlite` and hash-manifested artifacts. Only Goose execution is supported;
other hosts still support preparation only. A failed/incomplete trial produces nonzero CLI status.
Goose uses a private HOME/XDG/path root per trial, filtered builtin/platform config,
explicit credential/permission files, a fresh workspace and named session export.
Plugins with MCP declarations (`mcp.json`, `.mcp.json`, `mcpServers`) are unsupported.
Only the with condition installs the target. Eval files are excluded from installation.
Known credential values are redacted in collected artifacts; the private database retains
operator-supplied prompts/criteria as inputs, which must not contain secrets. Unknown keyring
or network credentials are not guaranteed redacted. HOME isolation is not an OS sandbox.
Current tests use a fake executable and real SQLite, not paid/native model responses.
Native Plugin activation and native conversation-export fidelity remain unverified.
No judge, regrading, parallel pool, cancellation API or crash recovery is delivered.
Timeout uses process-group termination on POSIX. Pending/orphan artifact directories
and running rows may remain on storage failure; they are not represented as completed.


## 17. Profils composés et registre utilisateur — décision du 2026-11-03

### 17.1 Besoin et décisions approuvées

L’auteur veut évaluer la configuration de capacités utilisée conjointement, observer
ses interactions et retrouver ses évaluations dans le temps. La sélection agrégée
`--skills` et `--plugin` constitue **un seul profil de contexte**; elle ne demande
plus plusieurs campagnes indépendantes par composant. Le nom est optionnel; en son
absence le produit fournit une désignation et une identité automatiques. Le nom
lisible ne constitue pas la preuve d’identité du contenu évalué.

Un registre SQLite utilisateur centralise les références et résultats disponibles;
les preuves sont conservées dans des répertoires privés distincts par campagne.
Ce n’est ni une DB par projet ni un catalogue autoritaire synchronisé avec une DB
par campagne. L’emplacement est configurable pour CI/tests et séparation des contextes
personnels/professionnels. Les données persistantes ne sont pas un cache jetable.
La résolution XDG et les overrides de la première tranche sont décrits en §17.7,
après consultation de la spécification officielle; aucune qualification inter-OS n’est promise.

Non-objectifs de cette évolution : attribution du gain à chaque composant, campagnes
factorielle/ablation automatiques, scoring déjà livré, registre distant/multi-utilisateur,
UI de gestion de profils, suppression d’archives historiques, changement du launcher
ou publication. Un gain global ne prouve pas l’utilité de chaque membre.

### 17.2 Modèle conceptuel et provenance

| Concept | Définition |
|---|---|
| Composant | Skill ou Plugin sélectionné, avec provenance et contenu évalué identifiables |
| Profil | Ensemble de capacités; nom optionnel et identité distincte de la campagne |
| Révision | Composition/contenus figés évalués; le nom et les chemins seuls ne suffisent pas |
| Campagne | Évaluation d’une révision avec scénarios, hôtes/modèles et paramètres identifiés |
| Essai/paire | Exécution/contraste avec profil complet versus sans profil |
| Jugement | Appréciation versionnée des preuves, distincte de l’état d’exécution |

La provenance du scénario est distincte du traitement installé. Pour S scénarios
**retenus selon l’union dédupliquée approuvée en §17.6**, A agents et R répétitions :
`2 × S × A × R` essais, `S × A × R` paires; le bras avec installe tous les membres,
le bras sans aucun membre. Ce n’est pas une mesure individuelle par composant.

Le score, lorsqu’il sera disponible, est lié à campagne/révision/scénarios et méthode
ou grading_run. Pas de note universelle attachée au seul nom du profil; statut
`completed` et collecte `complete` ne constituent pas un jugement de qualité.
La première politique d’identité/révision est implémentée selon §17.7. Modifier
explicitement les membres d’une identité existante reste un workflow non livré.

### 17.3 Exigences et vérification à exécuter

Source commune : approbations utilisateur 2026-11-03. Les mentions « bloqué/à définir »
dans la colonne seam sont celles du plan initial, remplacées par §17.6–20. Ce tableau définit les
critères, pas leurs résultats. Les preuves locales sont consignées aux §§19/20 et
dans development.md; import et qualification native restent ouverts.

| ID | Given / When / Then | Vérification / seam |
|---|---|---|
| PRF-01 | Skills et Plugins valides sélectionnés conjointement / préparation / un profil complet est présenté, pas des traitements indépendants par cible. | CLI dry-run + préparation/domaine, fixture mixte |
| PRF-02 | Nom fourni / préparation / ce nom est présenté; nom absent / préparation / désignation et identité automatiques présentes, distinctes de l’identité de campagne. | CLI/domaine; politique précise bloquée par PRF-D2 |
| PRF-03 | S scénarios retenus, A agents, R répétitions / expansion / exactement 2SAR essais et SAR paires portant le même profil et la provenance de chaque scénario. | Domaine, 2 scénarios × 2 agents × 3 répétitions = 24 essais/12 paires; unicité globale sans basename seul |
| PRF-04 | Profil compatible / exécution des bras / tous les membres présents dans avec, aucun dans sans; mêmes builtins, prompts/fixtures et paramètres par paire, critères exclus des prompts. | Faux hôte puis inventaire natif autorisé pour hôte/version |
| PRF-05 | Composition ambiguë ou membre non supporté / validation pré-exécution / diagnostic explicite avant tout essai candidat; aucun sous-ensemble installé silencieusement. | Collisions/chevauchements selon PRF-D3; sentinelles zéro lancement |
| PRF-06 | Révision figée puis sources modifiées / exécution/relecture / campagne liée au contenu réellement figé, pas aux nouvelles sources au même chemin. | Snapshot/hash et modification fixture, reconstruction du plan |
| REG-01 | Deux campagnes depuis des projets différents sous un registre configuré identique / persistance / deux campagnes relisibles dans le même registre et preuves dans deux répertoires distincts. | SQLite réelle en racine temporaire; aucune ressource utilisateur réelle |
| REG-02 | Registre alternatif explicitement configuré / lancement / aucune écriture dans le registre par défaut; candidats sans accès implicite au registre et à l’historique. | Résolution emplacement/environnement privé, sentinelles |
| REG-03 | Campagne/essai/artefact finalisé / relecture / profil-révision-campagne-essai-preuves liés, hashes vérifiables; identités des paires non confondues entre campagnes. | Contraintes/FK SQLite et manifests; corruption fixture |
| REG-04 | Échec d’écriture ou interruption entre archive et DB / reprise / aucun faux résultat complet, admission arrêtée sur erreur et état/orphelin traitable selon politique décidée. | Injection de panne; pas d’atomicité SQLite+filesystem prétendue |
| REG-05 | Deux processus CLI visant le même registre / écriture / aucune corruption ni confusion de campagnes; attente bornée ou rejet explicite selon REG-D2. | Sous-processus, SQLite réelle, migration concurrente/lock; aucune limite numérique inventée |
| REG-06 | Campagnes historiques par cible / import explicitement demandé / originaux préservés et provenance/sémantique historique distinguées; rien requalifié en profil composé sans preuve. | Fixture DB historique et comparaison avant/après, règles REG-D3 |
| REG-07 | Historique conservé / consultation / campagnes, révisions, états et chemins de preuves consultables sans appel candidat/juge; scores absents signalés absents. | Modèle de lecture et CLI à définir en E5, sentinelles zéro LLM |

PRF-03 précise/remplace FR-03 pour le profil composé; PRF-04 remplace l’installation
unitaire de FR-04. FR-01/02/05–14 restent applicables dans leur périmètre avec le
profil comme traitement et les liens REG; aucun critère de sécurité n’est supprimé.

Contraintes qualité : NFR-02/03/04 conservées. Pour les fixtures de migration,
zéro modification des originaux; pour les fixtures d’isolation, zéro écriture dans
les installations/registre réels. REG-05 suit désormais la borne locale de 5000 ms par opération SQLite et la
politique d’ownership §18; rétention et SLA restent non définis.
Permissions DB et fichiers auxiliaires SQLite ainsi que répertoires de preuves
privés doivent être vérifiées pour l’OS ciblé; pas de garantie inter-OS implicite.

### 17.4 Historique — questions initiales, remplacées par les décisions §17.6/17.7

| ID | Question et proposition (non approuvée) | Gate / décideur |
|---|---|---|
| PRF-D1 | Union des suites des membres comme point de départ? Déduplication par provenance? Suite indépendante du profil maintenant ou plus tard? Garder erreur des suites présentes malformées. | Bloque sélection des scénarios; utilisateur après analyse E1 |
| PRF-D2 | Profil réutilisable vs définition immuable; reconnaissance automatique, changement de contenu/déplacement/ordre, noms identiques, révision et nom par défaut; option CLI de nom et alias `--plugins`? | Bloque identité/CLI; utilisateur après propositions E1 |
| PRF-D3 | Ensemble non ordonné ou composition ordonnée? Skill déjà inclus dans Plugin, noms d’installation en collision: rejet ou résolution explicite? | Bloque plan/installations; utilisateur, étude E1 avec contraintes E2 |
| REG-D1 | Racine XDG persistante, override et compatibilité de `--output`; comportement dry-run sans écriture proposé; fallback par OS. | Bloque résolution emplacement; utilisateur après référence XDG officielle |
| REG-D2 | Politique multi-processus, migrations/locks, attente bornée, permissions WAL/SHM, états de campagne et réconciliation archive/DB. | Bloque registre fiable; proposition technique E3, approbation des comportements/limites utilisateur |
| REG-D3 | Import des anciennes bases, schémas acceptés, collisions/idempotence, liens vers preuves conservées ou copies; export portable futur. | Bloque migration; utilisateur après inventaire historique, aucune suppression implicite |

Ces décisions ne rouvrent pas profil agrégé/nom optionnel/registre utilisateur/
preuves par campagne. Elles bloquent uniquement les comportements qui en dépendent.

### 17.5 Plan initial et gates — historique, avancement courant en introduction

Beads reste le tracker; cette section décrit les capacités, pas un second suivi.
Réutiliser E1 (préparation), E2 (hôtes), E3 (stockage), E5 (consultation) et les
stories existantes, sans clôturer leur acceptation historique.

1. E1 : résoudre PRF-D1/2/3, puis profil/révisions et dry-run/matrice; adapter US1,
   US3 et US4 sans perdre les validations d’entrée et défauts existants.
2. E2 : traiter le profil complet, préflight de tous les membres et installation
   multi-Plugins sans écraser la configuration; garder preuve native séparée du mock.
3. E3 : résoudre REG-D1/2, implémenter registre partagé avec liens/cycle de vie et
   preuves par campagne; migrations sous contrôle, isolation utilisateur/candidat.
4. E3 : résoudre REG-D3 puis import non destructif des campagnes historiques.
5. E5 : consultation transversale sans LLM; scores seulement quand E4 fournit des
   jugements. Rapport HTML E6 consomme les mêmes identités et preuves.

E1 et la conception de résolution E3 peuvent progresser séparément; le registre
final dépend des identités du profil, la consultation dépend de sa persistance.
Avant chaque implémentation : autorisation explicite de la tranche, claim Beads,
critères/checks et candidate figé; revue indépendante pour acceptance US/produit,
`slice-acceptance v1.1.0`. Tests de CLI/domaine, SQLite réelle et hôte factice puis
preuves natives explicitement autorisées. Aucun modèle payant implicitement lancé.
Maximum trois corrections par tranche puis escalade; pas d’affaiblissement des gates.
Le rollback de migration préserve les originaux et respecte versions de schéma;
aucun retour automatique destructif ni publication autorisés par ce plan.

### 17.6 Décisions validées — 2026-11-03, première tranche

- PRF-D1 : union des suites des composants, déduplication par provenance de suite
  canonique et identifiant source. Chaque scénario évalue le profil entier;
  suites indépendantes du profil différées.
- PRF-D2 : profil réutilisable d’identité stable, nom optionnel via `--profile-name`,
  désignation automatique sinon. Le nom n’est pas une clé unique. Révision par
  contenu figé; changement de contenu => nouvelle révision. Seul `--plugin`
  existe, **aucun alias `--plugins`** (amendement utilisateur explicite).
- PRF-D3 : ensemble non ordonné, racines identiques dédupliquées; Skill déjà inclus
  dans un Plugin retiré de l’installation autonome et sa suite non répétée.
  Collisions ambiguës entre capacités/installations rejetées avant lancement.
- REG-D1 : racine utilisateur persistante suivant XDG, override explicite du
  registre; `--output` concerne les preuves. Dry-run sans écriture de registre.
- REG-D2 : SQLite partagé avec attente de verrouillage bornée puis erreur explicite;
  la valeur et les détails migrations/recovery restent à spécifier avec preuves.
- REG-D3 : aucune migration automatique; import explicite non destructif séparé.

Ces décisions autorisent l’implémentation locale demandée, pas les appels payants,
les mutations de l’installation réelle ou la publication. Le registre/host complet
restent des incréments distincts du premier incrément profil/préparation/snapshot.


### 17.7 Snapshot historique local/mock — 2026-11-03, avant reprise/historique/npm

Implémentation source, pas publication ni compatibilité native attestée :

- `--profile-name` étiquette optionnelle, `--plugin` seul; profil stable par SHA-256
  de la sélection effective `(kind, racine canonique)` triée. Un déplacement crée
  une nouvelle identité locale; le nom n’influence pas l’identité/révision.
- Révision SHA-256 du contenu capturé, prompts/critères et fixtures. Snapshot
  installation sans `.git`/`evals`, fichiers base64 et intention exécutable;
  exécution ne relit pas les sources mutables. Fixtures externes relocalisées à
  contenu identique conservent la révision; leur chemin reste provenance de campagne.
- Profils non ordonnés; Skill inclus dans Plugin retiré de l’installation autonome;
  noms de capacités/installations ambigus rejetés. Scénarios identifiés globalement
  par provenance canonique de suite et ID source, union dédupliquée.
- Registre par défaut `$XDG_DATA_HOME/agent-plugin/evaluations.sqlite`, ou
  `$HOME/.local/share/agent-plugin/evaluations.sqlite` si XDG absent/vide/relatif.
  `--registry <file>` override; preuves par défaut `campaigns` à côté du registre,
  `--output <directory>` override des preuves seulement. Dry-run aucune écriture.
- XDG Base Directory Specification 0.8, consultée le 2026-11-03 :
  <https://specifications.freedesktop.org/basedir-spec/latest/>. Données persistantes
  considérées portables donc DATA_HOME, pas cache; chemins XDG relatifs ignorés.
  Validation fichiers/modes actuellement POSIX; aucune qualification Windows promise.
- Registre schema v1, liens profil/révision/campagne/essai/artefact, transactions
  immédiates et rollback journal DELETE. Timeout lock **5000 ms par opération
  SQLite**, borne technique de cette candidate, pas SLA ni délai global de commande.
  Version incompatible ou DB historique non versionnée refusée sans conversion.
- Registre mode 600, répertoire privé mode 700, pas chmod des ancêtres partagés;
  liens/fichiers non privés refusés. `complete()` explicite après tous essais,
  `close()` marque campagne non terminée interrompue lors du cleanup ordonné.
  Crash brutal peut laisser running/orphelins; recovery non livré.
- Suites absentes/malformées gardent leurs règles; Plugin MCP unsupported rejeté
  avant premier essai pour tout le profil. Faux hôte et SQLite réelle vérifiés;
  aucune activation native ni score métier attestés.

Tests ciblés : 52 pass, 0 fail (Bun 1.3.12), source tsc et lint passent. Revue
indépendante initiale a identifié un conflit chemin fixtures/révision; correction
et régression relocalisation revues, 11 tests profil/registre rejoués indépendamment.
Suite complète : 56 pass, 8 fail, 3 erreurs historiques (anciens imports/commandes).
Typecheck complet échoue sur ces sources de tests historiques, non supprimées.
Import non destructif et consultation restent ap-a6e.3/ap-gwz.1; pas commandes
supplémentaires ni jugement universel déduits du simple état completed.


## 18. Reprise durable et parallélisme — tranche source du 2026-11-03

Décision utilisateur: reprise conservatrice de campagne puis scheduler borné.
Cette section remplace les mentions séquentielles/recovery absent pour cette
candidate locale; elle ne promet pas reprise native de conversation ni durabilité
face à une coupure électrique. Pas d’atomicité commune filesystem/SQLite.

- Plans schemaVersion 3: identités logiques `trial-1`, etc. stables dans une campagne,
  distinctes des UUID de tentatives. Nouvelle tentative conserve les anciennes.
- Registre schema v2: migrations transactionnelles du registre v1, plans et mappings
  conservés; erreurs de migration rollback. Ceci n’importe pas les anciennes DB
  par campagne non versionnées (import explicite toujours différé).
- Chaque tentative est enregistrée avant l’agent. Preuves privées, manifeste et
  checkpoint avec reçu/identités publiés avant indexation. Reprise vérifie hashes,
  chemins/identités et réindexe idempotemment les publications valides sans agent.
  Publication existante corrompue: refus même avec consentement de relance.
- `evaluation --resume <campaign-id> [--registry <file>]` relit le plan stocké,
  jamais les sources courantes. Aucun sélecteur, nom, output, dry-run ou surcharge
  des paramètres d’exécution. Les essais finalisés ne sont pas rejoués.
- Tentative sans preuve publiée: incertaine. `--retry-uncertain` autorise explicitement
  une nouvelle tentative; aucune promesse exactly-once pour actions externes.
  Rejet hôte sans résultat durable reste incertain plutôt que faux échec définitif.
- Ownership DB par PID/hostname/token: propriétaire local vivant, PID invalide,
  EPERM ou host étranger refusés; takeover uniquement ESRCH local confirmé.
  Token revérifié aux writes/publication/close. PID réutilisé refuse conservativement.
- Scheduler: au plus `--parallelism` workers candidats, snapshots/collecte propres.
  Writer interne sérialise démarrage/finalisation, transactions courtes sans agent
  dans une transaction. Erreur persistence arrête admission et draine actifs avant
  fermeture; leur issue non persistée reste incertaine à la reprise.
- Bornes lecture checkpoint: métadonnées 8 MiB, artefact 64 MiB, agrégat 256 MiB,
  10 000 entrées manifeste. Bornes défensives de candidate, pas SLA; candidat Goose
  conserve ses limites de collecte plus faibles. Publication validée avec le même
  verifier que reprise. Pas de fsync/power-loss/reprise native des enfants promises.

| ID | Critère observable approuvé | Preuve locale |
|---|---|---|
| RES-1 | Plan avec IDs logiques stables, tentatives fraîches et historique conservé | resume.test: relance incertaine conserve 3 tentatives pour 2 essais |
| RES-2 | Publication valide réindexée sans agent; corruption finalisée/non indexée refusée | resume.test: réparation index et corruption avec retry; migration legacy preuve hashée |
| RES-3 | Pending seuls exécutés; retry incertain explicite; owners exclusifs | resume.test: sources supprimées, skip finalized, SIGKILL, live owner; recovery-boundaries: PID/host/EPERM/token |
| RES-4 | Workers bornés, writes sérialisés, erreur arrête admission et draine avant close | resume.test: chevauchement deux workers et writer unique, barrières drain/close |
| RES-5 | Gates ciblés et review indépendant local/mock, limites natives explicites | 70 tests ciblés pass; review 20261103_3 rejoue 18 tests/94 assertions pass |

Reçu historique avant qualification §19 et migration npm/Node (development.md):
Bun1.3.12 ciblés70pass0fail, source tsc/lint/diff pass. Suite complète
74pass8fail3errors historiques; typecheck complet imports historiques en erreur.
Pas de suppression/exclusion; normal commit reste bloqué sans autorisation de
checkpoint limitée actuelle. À ce snapshot, import/histoire CLI/grading/requalification native ouverts;
history/inspect sont ensuite livrés en §20.
La mise à jour explicite d’un même profil en ajoutant/remplaçant ses composants
nécessite encore une sélection par identité stable: ce workflow n’est pas livré
par la reprise de campagne; contenu modifié même sélection crée déjà une révision.


## 19. Acceptance locale du socle — 2026-11-03

Périmètre: profil/préparation, snapshots, traitement complet via faux hôte, registre
SQLite réel, reprise/checkpoints et scheduler. Les gates historiques en échec des
snapshots §17/18 sont désormais historiques: quatre tests du relais supprimé
retirés après mapping explicite et indépendant de leurs garanties; aucune exclusion.

- Résultat candidat final: suite complète79pass0fail399assertions; typecheck complet,
  lint et diff passent. Garantie négative supplémentaire: receipt d’un mauvais hôte
  ou session vide => tentative incertaine, jamais succès attribué au bon candidat.
- Export testé avec nom de session identique run/export; whitespace assistant ou
  user prompt différent ne fournissent pas une collecte complète.
- US3: cas24essais/12paires, identités logiques uniques, bras exacts et répétabilité.
- US4: échec snapshot/output propagé avant construction hôtes/store; main nonzero
  sur output défaillant. Aucun rollback de bytes déjà écrits à un stream externe
  n’est promis. ID profil stable, nouvelle révision contenu, IDs logiques planifiés;
  ID campagne lors exécution conformément clarification utilisateur.
- Revue indépendante composée: BASE1 mapping accepté (20261103_6), US3/US4 revue
  puis complément AC4 accepté (20261103_7/9); HOST/STORE/RES local accepté
  (20261103_8). Review globale20261103_5 initialement indéterminée par lecture
  incomplète, non présentée comme acceptation; ses gaps traités en revues bornées.

Cela n’accepte pas parents/produit natif. Aucune preuve modèle réel, reprise native,
installation Node livrée ou power-loss, pas de score. La consultation est ensuite
livrée en §20; import et mise à jour explicite des membres restent séparés.
Voir [development.md](development.md) pour mapping retrait tests et receipts.


## 20. Consultation de l’historique — 2026-11-03

Interface approuvée et implémentée dans les sources :
- `agent-plugin history [--profile <id>] [--registry <file>] [--json]`
- `agent-plugin inspect <campaign-id> [--registry <file>] [--json]`

Sortie lisible par défaut; JSON avec `--json`. Filtrage par identité exacte de profil,
pas par nom ambigu. Liste: ID campagne/profil, nom figé dans la campagne, révision,
date, état et avancement. Détail: paramètres, essais logiques, toutes les tentatives,
reçus et emplacements des preuves avec présence/absence. `available` indique la
présence d’un fichier, pas sa vérification SHA-256. Score absent = null/indisponible.

Ouverture SQLite readonly/query_only, schema v2 requis. Aucun agent, aucune création
ou migration de registre. Registre absent/vide => liste vide explicite; campagne
inconnue => erreur. Schéma non supporté refusé, diagnostics inattendus masqués.
Tests couvrent homonymes/révisions, reprise conservant anciennes tentatives, preuves
absentes et bytes DB inchangés. 83 tests complets pass, typecheck source+tests et
lint pass. Review indépendant20261103_11: 4 tests28assertions rejoués, tranche locale
acceptée. Aucun import, scoring, native runtime ou publication ajouté.


## 21. Namespace des Skills de Plugins — 2026-11-03

Demande utilisateur après comparaison native ap-kxi.4: la copie privée Goose des
Skills immédiats `skills/*/SKILL.md` reçoit `name: plugin:skill`, même sans suite
evals enfant. Le nom déclaré dans le frontmatter prime; absent/vide ou sans
frontmatter, fallback au nom du répertoire. Corps et autres métadonnées conservés.
YAML malformé/non mapping, nom non textuel et UTF-8 invalide refusés explicitement
avant lancement du candidat concerné; pas de réparation silencieuse des métadonnées.

Seule la copie privée est réécrite: sources, snapshots et révision ne changent pas,
Skills autonomes inchangés. Un préfixe déjà égal au Plugin n’est pas doublé, pour
accepter les sources issues d’une installation antérieure (différence volontaire
avec réimport natif qui concatène). Pas de création de métadonnées Git, suppression
des protections MCP, modification du plan ou revendication d’équivalence complète
avec installation native. Références: ap-kxi.5; namespace-plugin-skills.ts; source
locale officielle bdb3e648 plugins/formats/open_plugins.rs, non attestée comme
source exacte du binaire. Qualification de découverte distincte d’utilisation.


## 22. Migration brusque du runtime — 2026-11-03

L’utilisateur autorise la rupture des anciens CLI, produit non utilisé. Une seule
app source agent-plugin et un seul runtime généré dans skills/skill-creator;
launcher historique conservé comme chemin, CLI public evaluation/history/inspect.
Les quatre anciens exécutables creators et leurs workflows ne constituent plus
une promesse de compatibilité. Les autres Skills peuvent rester instructions,
mais leurs références historiques ne prouvent pas des commandes disponibles.
Node minimum22.22.2, build JavaScript et clôture npm production uniquement.
Publication, mise à jour live et modèles demeurent soumis à autorisation séparée.

## 23. AgentSkills suite ingestion — 2026-11-04 source slice

User authorized implementation after the three-increment plan and allows
additional subcommands when needed. D-02 proposals are retained for ap-aff.10;
D-03/D-05 remain unresolved and do not authorize a judge/model campaign.

- Standard expected_output and Skill-root-relative files are preserved; candidate
  prompts remain exact and criteria/expected output are not execution instructions.
- Missing/empty expectations are executable but explicitly not notable; no score.
- Declared inputs are captured and restored at their same relative paths in both
  arms. files/fixtures coexistence is rejected; legacy fixtures semantics unchanged.
- Recognized enriched metadata and coverage_dimensions are preserved. Presence of
  preconditions/budget/capabilities/navigation_expectations/execution_assertions,
  including empty values, declares unsupported constraints. Dry-run diagnoses;
  execution refuses, rather than silently weakening the experimental contract.
- Metadata/expected output/input changes participate in canonical revision identity.
  Additive schema3 import fields are validated on recovery; historical plans remain
  readable without source rediscovery. Diagnostics are derived, not enforcement proof.
- Input paths reject observed symlinks, special files, traversal and reserved
  live config/secret/instruction names under bounded capture. No race-free openat,
  full secret detection, network enforcement or OS sandbox is claimed.

These source semantics do not establish runtime publication, actual enriched
execution, grading, old_skill comparison or benchmark export. IMP-1..6 live in
Beads ap-aff.10; local tests and independent scope judgment are separate gates.

Correction J-IMP6-01: recovery checks aggregate/component payload consistency and
compares canonical frozen profile content with the retained profile revision,
including completed resumes. Valid-shaped changes under unchanged identity labels
are rejected before host calls. This is an internal consistency reference, not a
cryptographic guarantee against an actor rewriting both database payloads. Profile
labels and external legacy fixture locations are not content revision inputs.

## 24. Judge configuration defaults — confirmed 2026-11-05

The user confirmed the D-03/D-05 direction: Goose judges in a distinct private
session; model override is optional, not required. Without an override, preserve
functional native host configuration (Goose imported config.yaml and native
provider/model environment precedence). Future Claude/Codex implementations must
use their own native configuration; they are not Goose aliases. No model is
hard-coded and a requested/default configuration never proves the effective model.

Judge results retain requested override or configuration-default source outside
the blinded packet; effective identity remains unknown unless actually observed.
Canonical pass/fail/inconclusive and technical errors remain distinct. Planned
analysis reports pass/(pass+fail) plus decisive coverage, keeps errors separate,
and never silently mixes models. Strict export refuses misleading missing values.
Calibration/examples and actual model compatibility remain explicit pending gates,
not consequences of this confirmation or synthetic tests.

The local GooseJudge adapter uses fresh private HOME/XDG/workspace, neutral
criterion/artifact aliases and only named-export terminal assistant text. Imported
functional credentials/configuration are private, known secrets rejected in input
or redacted in output; unknown keyring/network access remains outside isolation.
No treatment is installed for judging. Defaults are 50 requested turns, disabled
run timeout (0); preflight/export deadlines 10 seconds and process capture 16 MiB.
Historical boundary at this slice: the adapter was not yet wired. Section 26
supersedes this wiring status; current grading CLI and append-only storage exist.

## 25. Verified evidence and append-only grading — 2026-11-05 local slice

The user authorized continuation of ap-ck5.1. Read-only explicit-attempt evidence
verification captures coherent schema2 registry metadata, frozen profile content,
checkpoint/receipt and exact indexed manifest. Bytes retained by checkpoint
verification are the bytes supplied to the Judge; no verify-then-reopen evidence
substitution is used. UTF-8 text versus nontext is explicit. Metadata-only recovery
consumers do not retain the full evidence buffers.

Each gradeAttempt invocation creates a new grading identity over one finalized
explicit candidate attempt without candidate execution or source discovery. The
shared user registry receives an additive independently versioned grading extension
(version1), preserving principal schema2 for existing history/inspect. Exact schema
and trigger checks reject missing/partial/altered extensions rather than repair
silently. A finalized grading run and its judgments insert atomically; UPDATE and
DELETE are forbidden by extension triggers. Regrades retain previous outcomes.

The SQLite reader authenticates issued snapshots in-process and append rechecks
frozen DB metadata after the Judge await. This is consistency protection, not a
cryptographic boundary against the operator replacing the database or malicious
concurrent ancestor replacement. Grading cannot create a missing candidate registry.
Technical outcomes, inconclusive judgments and missing transport provenance stay
explicit. History remains readonly and score:null; no analytic aggregate is inferred.
Historical boundary at this slice: CLI wiring was pending; section 26 now wires
the CLI. Grading.json file projection and benchmark are still pending;
real-model calibration remains outside local/mock acceptance.

## 26. Grading CLI and readback — 2026-11-06 local slice

The user authorized continuing pending tasks. grading/regrading select campaign
and candidate attempt UUIDs explicitly; each creates a new judgment ID without
candidate execution. Model override optional/native config default, Goose only
until other Judge adapters are implemented; unsupported agents/selectors/limits
refuse before Judge effects. Verified evidence reading precedes Judge construction.
A technical-error is persisted then reported with nonzero CLI status; inconclusive
remains a completed judgment with distinct counts, not false failed criteria.

judgments reads an ordered history from existing schema2/extension1, with no
initialization/migration/Judge/archives. Stored canonical outcomes, criterion rows,
request/manifest bindings, retained UTF-8 hashes and provenance are checked; JSON
DTO excludes request blobs. Full evidence metadata digest/current archives are not
reverified by this readback and availability is explicitly not claimed. Missing
registry/extension gives no judgments. No implicit latest selection or score0.
CLI mechanics are qualified locally with injected/fake execution, not real model
calibration. Semantic/technical native acceptance and benchmark export remain open.

## 27. Adversarial corrections — 2026-11-06, ap-jzew

AP5-01: candidate collection now requires the latest user turn to exactly match
the requested prompt and meaningful assistant text after that turn. Earlier
assistant output or another later user task cannot establish complete collection.
Judge shares this attribution rule and keeps stricter terminal-only JSON parsing.
This is transport evidence, not a semantic-success or terminal-quality judgment.

AP5-02: writer and readback share UTF-8 encoded JSON column bounds. Outcome,
provenance and evidence JSON allow up to 16 MiB inclusive; previously accepted
9 MiB outcomes remain readable without rewriting/deleting append-only records.
Oversized new serialized columns reject before any grading insertion/schema change.
Other bounds: plan/snapshot128MiB, receipt/criteria/manifest8MiB, request384MiB.
These are per-column bounds, not global quota/privacy certification.

AP5-03: current summaries/root commands reflect the wired grading CLI and current
Node app; dated histories remain distinguishable. Changes do not implement deferred
upstream exports or prove native provider efficacy.

AP7-01 follow-up: append/readback now share the same strict provenance validator,
including bounded session names and canonical instructions digests before writes.
AP7-02: superseded wiring/count receipts are explicitly marked historical.

## 28. Export success and out-of-bounds — 2026-11-06

User requests grading.json/workspace/benchmark continuation with simple stop
criteria. One export command takes campaign, repeatable explicit grading IDs and a
new destination. Export is integrated into the contained runtime and locally
verified; final independent qualification remains pending. Workspace success exports every
selected decisive nonempty grade,
metadata and exact verified bytes; sources/registry unchanged, complete manifest
and absent pending marker. Numeric eval IDs are export-local; manifest retains
canonical profile/scenario/suite/source and trial/pair/attempt/grade provenance.
Unknown/duplicate/multiple grades for one trial, corrupt or changed archive bindings,
inconclusive/technical outcomes, empty criteria, unsafe/existing/overlapping output
and export bounds refuse, never silently drop selected runs. Defensive export bounds
are 1000 selected grades,512MiB total bytes,16MiB JSON/final manifest. No overwrite,
model call or crash-atomic multi-file guarantee; pending signals interruption.
Dedicated temporary staging is disposable and removed recursively; user files must
not be placed there. Destination cleanup preserves concurrent user files; persistent
evidence archives remain retained. Manifest/hash readiness checks describe delivery,
not permanent authenticity of subsequently mutable output.

Optional benchmark is QUALITY-ONLY, directly generated, not the upstream aggregator
with missing telemetry zero fallbacks. Complete selected paired outcomes, identical
selected repetitions across scenarios and homogeneous requested configurations are
required. Packet hashes differ per task/evidence and are per-run provenance, NOT a
configuration homogeneity key. Effective candidate/judge identities remain unknown.
Pass-rate n-1 statistics/delta are descriptive, not calibrated efficacy evidence.
Unknown time/tokens/cost/tool/errors omitted. Full telemetry benchmark compatibility
is still unavailable. Tests against pinned actual viewer consumers qualify this
reduced contract only; no generated custom UI or browser acceptance is implied.

Successful task stop requires exact schema/layout/value regressions, safe failure
and preservation tests, pinned synthetic consumer evidence, current static/full app
gates, runtime/companions and independent scoped review. Maximum3 correction rounds
before escalation; missing model metrics must not trigger paid calls or assumptions.

## 29. Standalone Skill format validation — 2026-11-06 source candidate

`agent-plugin validate <skill-path> [--json]` reads an existing standalone Skill
**directory** and its exact `SKILL.md`; no eval suite is required. It reports format
only, never behavior, packaging closure, activation, host support or model quality.
Source implementation is locally testable; installed-runtime integration remains
pending until the coordinator regenerates and verifies the contained runtime.

Normative source: [Agent Skills specification](https://agentskills.io/specification),
refreshed read-only on **2026-11-06**, compared with
[pinned specification](https://github.com/agentskills/agentskills/blob/83021e2be457a9b6679148719c1f6074f0ad975e/docs/specification.mdx)
at commit `83021e2be457a9b6679148719c1f6074f0ad975e` (no numbered format
version is declared there). The field constraints agree. This subsection records
the refreshed contract; historical creator snapshots are not modified.

| Input / field | Enforced rule and diagnostic boundary |
|---|---|
| Directory / `SKILL.md` | Existing readable directory and file; missing/unreadable/nonfile fails. Leading and closing `---` lines delimit YAML; malformed YAML (including duplicate keys), nonmapping frontmatter or nonstring frontmatter keys fails. CRLF is accepted. |
| `name` (required string) | 1–64 characters inclusive; ASCII `a-z`, `0-9`, single internal `-`; no leading/trailing/consecutive hyphens or whitespace. Must exactly match the supplied source directory basename; no trimming or Plugin host prefix. |
| `description` (required string) | 1–1024 Unicode code points inclusive; whitespace-only rejected. `<` and `>` permitted. Keywords, third-person style and prose quality are editorial guidance, not format errors. |
| `compatibility` (optional string) | If present, 1–500 Unicode code points inclusive; empty/whitespace-only, null, false and other nonstrings fail. |
| `metadata` (optional mapping) | String keys and string values; numeric keys/values, null, sequences or nested maps fail. Empty mapping and empty string values permitted; no normative nonempty constraint. |
| `allowed-tools` (optional string) | String, not array or null. Tool names, permission validity, execution and experimental host support are not checked. No normative length/nonempty limit added. |
| `license` (optional string) | String, not null/number/map. No license-name, file-existence or nonempty constraint added. |
| Unknown additive fields | Accepted, with sorted names in `unvalidatedExtensions`; their contracts are **not validated**. The normative text supplies no unknown-field rejection rule. |
| Markdown body / other files | Unrestricted, including empty body as in the normative minimal example. No line-count, linked-file, dependency, packaging or eval-suite checks. |

The pinned/live text says “unicode lowercase alphanumeric” while explicitly listing
`a-z` and `0-9`. The documented conservative implementation choice is the ASCII subset in
this table, not a separately user-approved policy or a claim that every Unicode lowercase name is prohibited by an
unambiguous upstream rule. Lengths count Unicode code points, without normalization
or trimming. Required text and compatibility reject whitespace-only content.

Compared with Anthropic `quick_validate.py` at
`dbd4588f9e1033efb41dad4bef2f7947c8993d44` (inspected 2026-11-06): this validator
rejects empty required strings and falsy/nonstring compatibility, checks exact
folder agreement and optional field types, does not reject chevrons or additive
unknown keys, and measures untrimmed source strings. Legacy tolerances are not
compatibility promises. Native private-copy Plugin namespaces remain separate.

Success is exit 0; invalid input is exit 1 with field-specific diagnostics. JSON
output is `{valid, scope: "skill-format", diagnostics: [{field, message}],
unvalidatedExtensions}` for both outcomes; invalid JSON mode additionally emits a
concise failure on stderr. Text mode emits a success line or field diagnostics on
stderr, never raw filesystem/YAML exceptions. Validation neither constructs host,
Judge or storage adapters nor creates/migrates a registry, writes input, or installs
anything. Ordinary filesystem access is not a sandbox or hostile-inode defense.
No new file-size/input quota is introduced; existing evaluation snapshot bounds
are not inherited by this standalone reader. YAML conversion retains the installed
parser's default alias limit; it is a parser constraint, not an Agent Skills rule.

## 30. Automatic retained fixture preparation — ap-wljl source slice

Only scenarios explicitly declaring `preparation` receive automatic setup:

```json
{"kind":"retained-evaluation","version":1,"campaign":"completed"}
```

`campaign` is exactly `completed` or `interrupted`. Unknown keys/kinds/versions,
null declarations and unsupported tokens are rejected at discovery and when reading
frozen plans. There are no suite-supplied scripts, environment variables or paths.
Dry-run validates/freezes the declaration but performs no preparation writes.
The declaration participates in content revision identity; historical absence is valid.

Prompts bind only `{{fixture.registry_path}}`, `{{fixture.campaign_id}}`,
`{{fixture.with_attempt_id}}`, `{{fixture.without_attempt_id}}`, and
`{{fixture.new_export_path}}`. Ordinary JSON braces are literal. Interrupted
fixtures have one finalized with attempt and a pending without partner, so the
without-attempt token is unavailable. Bound prompts are runtime context, never a
mutation of the frozen scenario. Bindings and output/registry destinations reject
control characters (C0/C1, including newline/tab/NUL) and `{{`/`}}` template
delimiters before campaign/host admission. Simple paths/UUIDs are literal;
paths containing spaces or shell metacharacters are rendered as POSIX single-quoted
arguments, escaping an embedded apostrophe as `'\''`. Authors place path tokens
in an unquoted argument position; do not wrap a token in another shell quote.
Substitution is single-pass, never recursive. Spaces remain valid filesystem paths.
Goose named-export validation and verified
attempt/judge task reading use the actual bound prompt.

Each durable attempt start precedes allocation/setup. Persistent private data lives
at `<campaign-output>/trial-data/<attempt-uuid>/candidate` and its sibling
`evaluator`. Candidate workspace contains its own synthetic registry/campaign
archives; evaluator holds neutral authoring source, immutable seed byte copies and
preparation provenance. Host HOME/XDG remains disposable and separate. Cleanup of
host temporary roots never removes trial-data. Fake HOME is not an OS sandbox:
this separation avoids accidental oracle exposure, not malicious filesystem access.
Setup/storage failures stop admission before a host run and preserve partial data;
already-active preparations drain before storage closes. A started attempt without
authenticated preparation proof fails closed on resume even with retry consent.
That unproven preparation requires a new campaign; retry cannot repair or downgrade it.

The trusted recipe uses public preparation/execution/storage seams, deterministic
answers and no model override or provider call. Completed seeds have a full pair;
interrupted seeds have one finalized attempt. These synthetic observations are not
native-host or effectiveness evidence. The global XDG registry remains schema 2;
seed registries are private per attempt and never pollute operator history.

Paired dynamic binding is a narrow exception to byte-identical pair prompts/inputs:
with/without receive logically equivalent seed state but fresh paths, campaign IDs
and attempt UUIDs. Normalize identities/absolute locations when comparing seed
state, never when authenticating stored evidence. Repetitions expand logical pairs
within one outer campaign; retry creates append-only attempt UUIDs for those logical
trials. An improvement iteration creates another campaign/revision as appropriate,
not another global database. Every attempt has distinct trial-data and seed DB.

Prepared attempts use checkpoint version 2 with declaration, bindings, actual task,
locations and seed manifest. A storage-owned receipt digest authenticates the
pre-host evaluator proof; reader/recovery verify retained seed bytes and checkpoint
binding. Published receipt preparationDigest must match the authenticated stored
pre-host proof before repairing a published-before-index checkpoint. Missing or
changed published digests cannot overwrite indexed preparation provenance; prepared
version-2 checkpoints never use the historical version-1 fallback.
Missing/corrupt/downgraded prepared proof is rejected, including with retry
consent. Existing unprepared version-1 checkpoints retain their prior behavior.
Candidate modifications to its seeded files are allowed and do not change the
immutable evaluator seed evidence. Process-crash/power-loss atomicity, native model
compatibility, Windows qualification and nested model resume/grading remain unproved.

## 30. Persistent judge instructions — 2026-11-07, ap-njl1

Each explicit grading/regrading allocates its new grade UUID before Judge invocation.
The authenticated store resolves the campaign-owned execution destination
`<campaign-output>/judging/<grade-id>/instructions.txt`; this location is not
part of the blinded evidence JSON or the retained canonical request. The composition
root supplies the persistent storage writer. A standalone GooseJudge requires an
explicit destination and writer; it never falls back to an orphan global/temp file.
Optional store preparation preserves injected/mock and historical store seams.

After environment **and configuration** credential discovery/checks, the Judge
writes the exact UTF-8 blinded instruction packet exclusively, bounded to 16 MiB.
Known credentials in packet, override or destination prevent any instruction-file
write. Observed symlinks/special files and existing destinations are refused;
owned directories are 700 and the owned regular single-link file is 600. Existing
shared ancestors are not chmodded. These checks are not an OS sandbox against
concurrent filesystem replacement, nor a guarantee about unknown keyring secrets.

Goose receives `run --instructions <absolute-file>` with empty stdin. Named session
export still must attribute the **original exact packet**, not rewritten file bytes,
a compacted summary or an earlier response. File/write/protocol failures are
technical errors, not business verdicts; a successfully written packet remains
available after temporary HOME cleanup, including subsequent execution/export failures.
A partially written file from an I/O failure is not qualified as a complete artifact
and is never silently overwritten/retried.

Provenance binds path, SHA-256, grade UUID, campaign UUID and candidate attempt ID.
Append verifies attribution, exact packet hash and private bounded file integrity
before any grading-extension write. Readonly judgments verifies stored attribution
and packet hash without opening an arbitrary provenance path or requiring archives.
Historical grades without file provenance remain readable and are not retrofitted.

Operators may inspect the retained text and compare its SHA-256 for an audit.
Possession of a file does **not** authorize launching Goose, regrading, replaying,
changing models or rerunning candidates. Replay/model calls require explicit current
authority and produce a new grade identity; no replay command is delivered here.
Changing stdin transport to FILE does **not** fix or disable context compaction.
Real Goose/model execution and compaction behavior remain unverified by local tests.

Protocol sources inspected 2026-11-07: [CLI Commands](https://goose-docs.ai/docs/guides/goose-cli-commands)
(`-i, --instructions <FILE>`, `-` for stdin; named JSON session export),
[Running Tasks](https://goose-docs.ai/docs/guides/running-tasks) (instruction files),
and [Smart Context Management](https://goose-docs.ai/docs/guides/sessions/smart-context-management)
(compaction is a separate context-management behavior). These documented capabilities
are not a passed native-host integration test.

### Persistent instruction corrections — ap-njl1 M1/M2

Prepared grading requests retain the exact authenticated preparation proof alongside
expanded task text; blinded Judge packets exclude this provenance. Readonly history
validates proof digest against the durable candidate receipt, frozen declaration,
bound locations/UUIDs and exact prompt expansion. The receipt remains bound to the
append-time verified metadata digest. No candidate, seed, checkpoint or instruction
archive is reopened by history; a self-consistent edited request digest is insufficient.

Store preparation authenticates its reader-issued snapshot and preflights immutable
criteria, request (including detached grading options) and manifest serialization
before destination allocation, instruction writes or Judge construction/preflight.
Append repeats these checks and bounds the then-known result columns before SQLite
writes. Existing byte ceilings are unchanged; unpersistable immutable input is rejected
without creating a grading extension or instruction file. Transport/export failures
on valid input retain technical outcomes and qualified file provenance as before.

### Bounded file-backed judging (ap-ul8h, local/mock candidate)

New Goose grades use packet version 2: exact task, neutral assertions, optional
expected output only when nonempty, relative `evidence/manifest.json`, primary
conversation alias, and JSON outcome schema. Evidence text is never embedded in
initial instructions. UTF-8 instructions (including assertions/task) are capped at
64 KiB; the neutral manifest is capped at 128 KiB. Conversation and workspace files
are primary; native logs and other artifacts are secondary, retained rather than
discarded. Nontext artifacts retain digest/identity in the manifest but are not
available as text citations (their text-byte length is unknown, not zero); they need an explicit observation capability before
being used as decisive evidence.

Judge defaults are 20 turns and 600 seconds (candidate evaluation defaults are
unchanged). Explicit positive turn/timeout overrides are respected; explicit
`timeout: 0` disables only the execution timeout, not the turn/read/context bounds.
The fixed reader permits 64 tool calls, at most 8192 requested bytes per slice,
and at most 262144 cumulative delivered tool-result JSON bytes, including manifest
responses and repeated reads. Exhaustion/refusal never triggers an automatic retry
or unrestricted fallback. Evidence insufficiency is inconclusive; transport,
invalid JSON, timeout and invalid citations remain technical failures.

`judging/<grade>/instructions.txt`, evidence manifest/copies, private host stdout,
stderr and named export remain after temporary HOME cleanup, including failed
outputs. `reader-trace.jsonl` records requested tools and successful slice offsets,
lengths, call counts and cumulative delivered bytes, without embedding evidence.
Known credentials are rejected in packets/copies and redacted in host diagnostics;
unknown provider/keyring secrets remain outside that guarantee. Original source
archives are never modified. Historical no-file grades and prior embedded packet
hashes/defaults remain readable via their prior version, without archive reopening.
No calibration, native Goose model-reader integration, or installed projection
acceptance is inferred from local/mock protocol checks.

## CLI heartbeat — ap-a00a

`evaluation` (including `--resume`), `grading` and `regrading` emit a plain
stderr heartbeat every 10 seconds while command work is pending, including
preparation/verification. The first tick occurs after 10 seconds. Example:
`[agent-plugin] evaluation: active; elapsed 10s`. Duration is monotonic elapsed
command time, not model execution telemetry. Active means the command has not
settled; it does not prove host progress or quality. No counters, scores, ETA,
selectors or private inputs are inferred or displayed. Event-loop blocking can
delay ticks; this is not a hard real-time liveness guarantee.

`-q` and `--quiet` disable only heartbeat presentation, not results, errors or
exit status. Quiet is not a stored campaign execution parameter and is allowed
on resume. Plain newline output is identical for TTY and redirected stderr;
stdout JSON remains unchanged. Help, parse failures, dry-run and read/validation/
export commands allocate no heartbeat timer. Observation never polls a model,
retries work or reads additional evidence.

The CLI owns and clears its interval on settlement, including rejection. Its
unreferenced timer cannot keep the process alive; ordinary process signals are
not intercepted. Caller-owned streams remain open. A heartbeat write failure
stops only diagnostic ticks, without replacing execution outcome; final output
and error writes preserve their existing semantics.
