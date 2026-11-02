# Frontières de l’architecture hexagonale

```text
index.ts                         # Démarrage Bun et code de sortie
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

Les dépendances pointent vers le cœur. `domain/` ne connaît ni Commander, ni Bun,
ni SQLite. `application/` connaît le domaine et ses ports, pas les adaptateurs.
Les adaptateurs implémentent les ports ; le composition root les assemble.

## Tranche de préparation

Application : `apps/agent-plugin` ; commande : `agent-plugin evaluation`.
Commander traduit `--skills <paths...>` et `--plugin <paths...>` répétables et
combinables, `--agent` répétable (Goose par défaut), `--model` chaîne libre,
les limites 0/50/3/3 et `--dry-run`. Le domaine développe une comparaison séparée
par cible, déduplique par kind et namespace les scénarios par répertoire de Skill.
La lecture des suites locales appartient à la frontière I/O, pas au domaine pur.

Les Skills utilisent exactement `evals/evals.json`, sans bruit de découverte.
Les Plugins lisent les enfants immédiats `skills/*/SKILL.md` et leurs suites :
absence enfant ignorée, toutes absentes ou présente malformée en erreur ; aucun
suite racine requis. Chaque scénario enfant garde le Plugin complet comme traitement.
Dry-run valide et rend le plan JSON ; sans dry-run, validation puis erreur explicite
exécution indisponible. Aucun appel hôte, juge, stockage ou rapport dans cette tranche.
Les dossiers hôtes/juge/stockage/rapport représentent des responsabilités futures ;
ne pas figer des ports spéculatifs. `--budget` est différé, sans plafond monétaire.

Typecheck source : `./node_modules/.bin/tsc --noEmit --project tsconfig.json`.
Les tests historiques référencent l’ancien socle supprimé ; ils ne constituent
pas des preuves valides du nouveau CLI. Voir [development](../specifications/development.md).
Le launcher installé `skills/skill-creator` et le mapping runtime ne sont pas migrés.

## Sorties du CLI

`adapters/inbound/cli/cli-output.ts` définit le contrat `CliOutput`.
`stream-cli-output.ts` fournit `StreamCliOutput implements CliOutput`, recevant
deux destinations ouvertes. `index.ts` la construit avec stdout/stderr.
Les callbacks sont liés à leur instance ; cet adaptateur ne ferme pas les flux.
