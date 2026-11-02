# Spécification produit — CLI d’évaluation comparative de Skills et Plugins

Version : 0.3 — 2026-11-03.
Statut : exigences utilisateur consolidées ; propositions et décisions ouvertes explicitement identifiées. Cette spécification ne prouve ni une implémentation ni la compatibilité réelle des hôtes.
Périmètre : `apps/agent-plugin`. CLI public : `agent-plugin evaluation`.
Source : décisions utilisateur des conversations de conception du 2026-11-01 au 2026-11-03.

## Autorité des exigences et état livré

La décision du 2026-11-03 ci-dessous définit la **cible produit**, pas une livraison.
Les règles de composition PRF/REG de la section 17 remplacent les anciennes
comparaisons par cible des sections 3–5, FR-03/FR-04 et du gate section 16.
Les sections de préparation seule et l’addendum d’exécution sont conservés comme
historique des tranches; leur état actuel est résumé ici pour éviter toute ambiguïté.

- Candidate source 2026-11-03 : profil composé, nom/révision, snapshots des composants
  et fixtures, exécution Goose séquentielle avec traitement complet et registre
  utilisateur SQLite partagé; preuves privées par campagne. Vérification local/mock.
- Non livré : consultation CLI transversale, import historique, juge/scoring,
  regrading et reprise après crash. Activation native profil non vérifiée.
- Tests injectés et SQLite réelle ne prouvent pas compatibilité native des modèles
  ou activation de profils. Le runtime installé reste distinct des sources Bun.
- Les paramètres 0/50/3/3, Goose par défaut, suites exactes, séparation tâches/critères
  et interdiction de fallback partiel restent applicables.

## 1. Produit, utilisateurs et objectifs

Le produit est un CLI Bun/TypeScript basé sur Commander.js, destiné aux auteurs de Skills/Plugins et aux analystes de leurs évaluations. Il lance des agents explicitement sélectionnés, mesure l’effet d’une cible locale par comparaison avec/sans, fait juger les résultats par un LLM et conserve les preuves permettant inspection, regrading et réexécution.

Objectifs confirmés :
- G-1 : mesurer l’effet global d’un profil composé de Skills/Plugins sur les mêmes scénarios (évolution approuvée le 2026-11-03; non livrée).
- G-2 : comparer les résultats entre les agents sélectionnés, en exposant leurs modèles et configurations.
- G-3 : préserver la configuration fonctionnelle et les builtins sans contamination par d’autres capacités utilisateur.
- G-4 : conserver les résultats, conversations et fichiers pour une exploitation analytique et une rejouabilité qualifiée.
- G-5 : produire un rapport HTML de fin de campagne.
- G-6 : retrouver les campagnes et leurs preuves dans un registre utilisateur indépendant du projet, en distinguant les révisions du profil et le contexte expérimental.

Non-objectifs : création/optimisation automatique de Skills ; lancement automatique de tous les outils détectés ; garantie de sandbox OS ; résultats LLM déterministes ; compatibilité universelle de Plugins ; interface HTML déjà approuvée. Aucun appel payant, installation réelle, commit ou publication n’est autorisé par cette spécification seule.

## 2. Périmètre autorisé : préparation uniquement

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

## 3. Entrées et scénarios

`--skills <paths...>` et `--plugin <paths...>` acceptent plusieurs chemins, sont
répétables et combinables ; au moins une cible est requise. État livré : dédupliquer les racines
par kind et conserver une comparaison séparée pour chaque cible sélectionnée.
Cible approuvée : agréger la sélection en un seul profil (section 17); les règles
de chevauchement et de scénarios sont des décisions ouvertes, pas des comportements livrés.

Un Skill découvre silencieusement et exclusivement `<skill>/evals/evals.json`.
Pas de recherche alternative. Suite absente ou malformée : erreur.
Un Plugin découvre les enfants immédiats `skills/*/SKILL.md` puis le fichier exact
`evals/evals.json` de chaque enfant. Suite enfant absente : ignorer cet enfant ;
toutes absentes : erreur ; toute suite présente malformée : erreur, sans masquer
le problème avec une autre suite valide. Aucun eval à la racine du Plugin requis.
Dans le comportement livré, chaque scénario enfant compare le **Plugin complet**,
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

## 4. CLI et plan expérimental

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

Matrice livrée/historique : pour chaque cible t ayant S_t scénarios, A agents et R répétitions, préparer
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

Exigences confirmées : résultats finaux dans SQLite ; conversations, traces et fichiers archivés ; possibilité de rejouer. Topologie utilisateur approuvée le 2026-11-03 (REG-01..07): une SQLite partagée indexe les profils/révisions/campagnes, observations, jugements disponibles et références d’archives isolées par campagne, sans duplication systématique de gros blobs. La DB par campagne reste uniquement le comportement livré/historique.

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
pas le launcher installé ni son mapping. Le développement sous Bun ne prouve pas
la compatibilité Node du runtime livré.

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
Les détails de résolution XDG doivent être vérifiés contre la spécification officielle
avant implémentation; aucun chemin final ni fallback inter-OS n’est encore approuvé.

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
**retenus selon la politique encore à décider**, A agents et R répétitions :
`2 × S × A × R` essais, `S × A × R` paires; le bras avec installe tous les membres,
le bras sans aucun membre. Ce n’est pas une mesure individuelle par composant.

Le score, lorsqu’il sera disponible, est lié à campagne/révision/scénarios et méthode
ou grading_run. Pas de note universelle attachée au seul nom du profil; statut
`completed` et collecte `complete` ne constituent pas un jugement de qualité.
La politique de reconnaissance/réutilisation d’un profil et de ses révisions reste
ouverte; aucun UUID/hash spécifique n’est imposé comme algorithme d’identité.

### 17.3 Exigences et vérification à exécuter

Source commune : approbations utilisateur 2026-11-03. Toutes les preuves ci-dessous
sont futures; la rédaction n’en vaut pas acceptation.

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

PRF-03 précise/remplace FR-03 pour la cible future; PRF-04 remplace l’installation
unitaire de FR-04. FR-01/02/05–14 restent applicables dans leur périmètre avec le
profil comme traitement et les liens REG; aucun critère de sécurité n’est supprimé.

Contraintes qualité : NFR-02/03/04 conservées. Pour les fixtures de migration,
zéro modification des originaux; pour les fixtures d’isolation, zéro écriture dans
les installations/registre réels. REG-05 nécessite un délai/politique de verrouillage
approuvés avant vérification; rétention, tailles et SLA restent non définis.
Permissions DB et fichiers auxiliaires SQLite ainsi que répertoires de preuves
privés doivent être vérifiées pour l’OS ciblé; pas de garantie inter-OS implicite.

### 17.4 Décisions ouvertes, distinctes de la direction approuvée

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

### 17.5 Plan de livraison et gates

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


### 17.7 Candidate local/mock — 2026-11-03

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
