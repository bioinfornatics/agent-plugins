# Frontières de l’architecture hexagonale

```text
index.ts                         # Démarrage Node.js >=22.22.2 et code de sortie
main.ts                          # Entrée testable, argv utilisateur + sorties injectées
composition-root.ts              # Assemblage des dépendances concrètes
domain/                          # Scénarios, plans, paires, preuves et jugements purs
application/
  ports/evaluation-source.ts     # Lecture des cibles locales
  use-cases/prepare-evaluation.ts # Validation, déduplication et matrice
adapters/
  inbound/cli/                   # Factory Commander et parsing
  outbound/
    filesystem/                 # FilesystemEvaluationSource : suites exactes
    hosts/{goose,codex,claude}/   # Protocoles et isolation propres aux hôtes
    judge/                       # Transport du juge LLM
    storage/                     # SQLite et archives
    reporting/                   # Rapport HTML
```

Les dépendances pointent vers le cœur. `domain/` ne connaît ni Commander, ni I/O Node,
ni SQLite. `application/` connaît le domaine et ses ports, pas les adaptateurs.
Les adaptateurs implémentent les ports ; le composition root les assemble.

## État courant des responsabilités — 2026-11-03

Application : `apps/agent-plugin`; CLI : `agent-plugin evaluation`, `history`, `inspect`.
`prepare-evaluation.ts` compose un profil unique à partir des sélecteurs répétables
et combinables, déduplique les racines/Skills inclus et les suites par provenance.
Chaque scénario conserve le profil entier comme traitement. Dry-run rend le plan
JSON sans construire de ressources hôte/stockage; défauts 0/50/3/3, Goose seul.

`execute-evaluation.ts` orchestre les workers bornés, le plan figé de reprise et la
persistance sérialisée via les ports. GooseHost possède les contextes privés et la
collecte; SqliteEvaluationStore possède registre schema-v2, tentatives et preuves.
Les handlers CLI présentent préparation/exécution et lecture history/inspect;
SqliteEvaluationHistory ouvre la base readonly/query_only sans migration/création.
Voir [architecture](../specifications/architecture.md) et [produit §§17–20](../specifications/product.md).

Les suites Skill utilisent exactement `evals/evals.json`; les Plugins leurs enfants
immédiats `skills/*/SKILL.md` : absentes ignorées, toutes absentes ou présente
malformée rejetées. Aucun eval racine requis. Seul Goose est câblé pour exécution;
les dossiers codex/claude, judge et reporting sont des emplacements réservés,
pas des adaptateurs livrés. `--budget` est différé, sans plafond monétaire.

Ce socle est vérifié localement avec faux hôte/SQLite réelle. Activation native,
compatibilité modèle/export, import historique, grading/regrading et rapport HTML
restent non qualifiés ou non livrés. HOME privé n’est pas sandbox OS; reprise de
campagne n’est ni continuation native ni garantie de durabilité power-loss.
La préparation seule initiale est historique, conservée dans la spécification.

Node exécute `src/index.ts` par suppression native des types TypeScript, sans build.
Installation des dépendances : `npm ci`, avec `package-lock.json` comme seul lockfile.
Typecheck source : `npm run typecheck:source` ; tests actifs : `npm test`
(`node:test` et `node:assert`). Les résultats Bun datés sont historiques, pas une
validation npm/Node. Voir [development](../specifications/development.md).
SQLite reste dans le stockage : son wrapper local charge `node:sqlite` à la demande,
sans ouverture de base ni chargement SQLite à l’import du CLI.
Le launcher installé `skills/skill-creator` et le mapping runtime ne sont pas migrés.

## Sorties du CLI

`adapters/inbound/cli/cli-output.ts` définit le contrat `CliOutput`.
`stream-cli-output.ts` fournit `StreamCliOutput implements CliOutput`, recevant
deux destinations ouvertes. `index.ts` la construit avec stdout/stderr.
Les callbacks sont liés à leur instance ; cet adaptateur ne ferme pas les flux.
