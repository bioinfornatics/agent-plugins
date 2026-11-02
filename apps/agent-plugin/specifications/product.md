# Spécification produit — CLI d’évaluation comparative de Skills et Plugins

Version : 0.2 — 2026-11-02.
Statut : exigences utilisateur consolidées ; propositions et décisions ouvertes explicitement identifiées. Cette spécification ne prouve ni une implémentation ni la compatibilité réelle des hôtes.
Périmètre : `apps/agent-plugin`. CLI public : `agent-plugin evaluation`.
Source : décisions utilisateur de la conversation de conception du 2026-11-01.

## 1. Produit, utilisateurs et objectifs

Le produit est un CLI Bun/TypeScript basé sur Commander.js, destiné aux auteurs de Skills/Plugins et aux analystes de leurs évaluations. Il lance des agents explicitement sélectionnés, mesure l’effet d’une cible locale par comparaison avec/sans, fait juger les résultats par un LLM et conserve les preuves permettant inspection, regrading et réexécution.

Objectifs confirmés :
- G-1 : mesurer l’effet de la présence d’un Skill/Plugin sur les mêmes scénarios.
- G-2 : comparer les résultats entre les agents sélectionnés, en exposant leurs modèles et configurations.
- G-3 : préserver la configuration fonctionnelle et les builtins sans contamination par d’autres capacités utilisateur.
- G-4 : conserver les résultats, conversations et fichiers pour une exploitation analytique et une rejouabilité qualifiée.
- G-5 : produire un rapport HTML de fin de campagne.

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
répétables et combinables ; au moins une cible est requise. Dédupliquer les racines
par kind et conserver une comparaison séparée pour chaque cible sélectionnée.

Un Skill découvre silencieusement et exclusivement `<skill>/evals/evals.json`.
Pas de recherche alternative. Suite absente ou malformée : erreur.
Un Plugin découvre les enfants immédiats `skills/*/SKILL.md` puis le fichier exact
`evals/evals.json` de chaque enfant. Suite enfant absente : ignorer cet enfant ;
toutes absentes : erreur ; toute suite présente malformée : erreur, sans masquer
le problème avec une autre suite valide. Aucun eval à la racine du Plugin requis.
Chaque scénario enfant compare le **Plugin complet**, avec ses composants non-Skill,
à son absence ; ne pas transformer le traitement en installation du seul enfant.

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

Pour chaque cible t ayant S_t scénarios, A agents et R répétitions, préparer
`2 × S_t × A × R` lignes candidates. Total : `2 × A × R × somme(S_t)` ; pas de
comparaison fusionnant toutes les cibles. Défaut : six lignes par scénario.
Les lignes sont des intentions, non des résultats ou reçus d’exécution.
Chaque paire partage cible, scénario, agent, modèle et limites ; seul le bras
avec/sans diffère. L’identité cible reste distincte de l’ID scénario namespacé.
Le modèle est demandé seulement : aucun modèle effectif ni télémétrie inventé.

## 5. Environnement et contrat des adaptateurs

Exigences confirmées : copier la configuration fonctionnelle de l’outil depuis le HOME original vers un fake HOME ; installer uniquement le Skill/Plugin ciblé ; exclure les autres capacités utilisateur ; conserver les fonctionnalités builtin.

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

Exigences confirmées : résultats finaux dans SQLite ; conversations, traces et fichiers archivés ; possibilité de rejouer. Architecture proposée : SQLite indexe les observations, jugements et références d’archives, sans dupliquer systématiquement de gros blobs.

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
| FR-03 | S scénarios, A hôtes, R répétitions / planification / 2×S×A×R essais avec identités de paires et mêmes entrées par paire. | Expansion pure + fixtures |
| FR-04 | Configuration opérateur contenant capacités tierces / préparation des bras / builtins conservés et cible seule présente dans le bras avec, sans mutation de l’installation réelle. | Filtrage + inventaire hôte autorisé |
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
| D-01 | Raisonnement, configuration détaillée modèles/hôtes et chemins DB/archive | Futur au-delà du contrat de préparation confirmé |
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
