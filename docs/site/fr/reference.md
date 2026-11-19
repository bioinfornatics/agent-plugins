# Référence

Consultez cette page pour retrouver les versions consignées, les chemins, les limites des commandes et les documents sources. Pour une introduction guidée, commencez par les [Concepts](concepts.md) et les [Premiers pas](getting-started.md).

## Cibles et prérequis consignés

| Élément | Valeur ou règle consignée |
|---|---|
| Distribution | 0.8.4 |
| Cible portable des plugins | Agent Plugins 1.0.0 |
| Instantané 1.1.0 | Brouillon de travail inactif ; cible non prise en charge |
| Intégration observée avec l'hôte | Goose 1.57.0 (voir la matrice de compatibilité), sans affirmation sur d'autres versions |
| Exécution de skill-creator installé depuis Git | Node.js >=22.22.2 ; code compilé et dépendances de production inclus |
| Outils de contribution | Node.js >=22.22.2 et npm ; la CI courante épingle Node.js 26.13.0 LTS |
| Licence | [CeCILL-C](https://github.com/bioinfornatics/agent-plugins/blob/develop/LICENSE) |

La vérification de Goose ne démontre pas la compatibilité avec un autre hôte. Consultez la [référence Goose consignée pour les plugins](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md) pour les détails liés à la révision.

## Noms et emplacements d'installation

| Élément | Projet | Utilisateur | Remarques |
|---|---|---|---|
| Skills autonomes | `.agents/skills/` | `~/.agents/skills/` | Nom simple du créateur |
| Agents personnalisés Goose | `.agents/agents/` | `~/.agents/agents/` | Distincts des Skills inclus dans un plugin |
| Plugins | `.agents/plugins/<name>/` | `~/.agents/plugins/<name>/` | Noms qualifiés pour les Skills du plugin |
| Instructions du dépôt | `AGENTS.md` | Selon l'hôte | Consignes, pas composant de plugin installé |

Les noms qualifiés sont `agent-plugins:skill-creator`, `agent-plugins:agent-creator`, `agent-plugins:hook-creator`, `agent-plugins:plugin-creator` et `agent-plugins:plugin-script-packaging`. Le [choix du créateur](how-to/creators.md) explique leurs périmètres.

Le contrat de fichiers portable d'un Skill concerne son répertoire et `SKILL.md` ; les chemins `.agents/skills` sont une convention de découverte. Ne supposez pas que tous les hôtes les utilisent.

## Fichiers portables d'un plugin et limite de l'hôte

| Fichier ou répertoire | Signification |
|---|---|
| `plugin.json` à la racine | Manifeste portable obligatoire |
| `skills/<name>/SKILL.md` | Skill inclus immédiat facultatif ; ses ressources restent dans son répertoire |
| `mcp.json` à la racine | Déclaration MCP portable facultative avec transport explicite |
| Extension Goose avec espace de noms | Adaptateur d'hôte défini par le dépôt, pas sémantique d'exécution portable |
| `hooks/hooks.json` à la racine | Chemin natif des hooks Goose pour les cibles vérifiées ; hors noyau portable |
| `agents/` inclus | Pas une installation portable d'agents personnalisés en 1.0.0 ; non découvert automatiquement par Goose audité |

Le MCP portable prend en charge les variantes consignées `stdio`, `streamable-http` et `sse`. Le chargeur de plugins Goose audité cherche par défaut `.mcp.json` et convertit les déclarations stdio. La sélection explicite d'un fichier portable `./mcp.json` limité à stdio peut fonctionner selon le contrat consigné ; n'en déduisez pas une prise en charge des transports distants et n'autorisez pas d'activations en double. Consultez la [conformité portable](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/portable-conformance.md) avant une migration.

## Points d'entrée stables des commandes

La distribution Git fournit un seul lanceur Node.js autonome, `skills/skill-creator/scripts/skill-creator.mjs`, qui exécute la CLI `agent-plugin` actuelle. L'installation n'ajoute pas d'entrée au PATH ; préfixez les commandes par `node <skill-root>/scripts/skill-creator.mjs`. Les anciens exécutables des créateurs d'agents, de hooks et de plugins, les archives natives et leurs validateurs sont retirés ; ces Skills ne contiennent que des instructions.

| Opération | Exemple documenté |
|---|---|
| Validation du format d'un Skill | `validate /path/to/skill` |
| Aperçu de l'évaluation | `evaluation --skills /path/to/skill --dry-run` |
| Exécution de l'évaluation | `evaluation --skills /path/to/skill` (ou `--plugin /path/to/plugin`) |
| Historique et détail des campagnes | `history --json` ; `inspect <campaign-id> --json` |
| Notation et export | `grading <campaign-id> --attempt <attempt-id>` ; `export <campaign-id> --grading <grade-id>` |
| Rapport HTML | `node <skill-root>/scripts/generate-report.mjs --workspace <campaign>/report/export` |

L'option `--help` de chaque commande est le point d'entrée de consultation ; la [référence des commandes](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/references/command-contract.md) consigne options et valeurs par défaut. La CLI ne remplace ni un moteur, modèle ou évaluateur configuré, ni une véritable relecture humaine. Les manifestes de plugin, agents et hooks sont relus manuellement d'après leurs sources de format consignées.

## Documents sources et ressources installables

Ces références sont consignées dans le dépôt ; la documentation actuelle de l'hôte en amont n'a pas été revérifiée :

- [README utilisateur](https://github.com/bioinfornatics/agent-plugins/blob/develop/README.md), [CONTRIBUTING.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/CONTRIBUTING.md) et [politique de migration des branches](https://github.com/bioinfornatics/agent-plugins/blob/develop/docs/branch-migration.md).
- Guides des créateurs : [Skill](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/README.md), [Agent](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/README.md), [Hook](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/hook-creator/README.md), [Plugin](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/README.md), [Script Packaging](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-script-packaging/README.md).
- Instantanés de l'hôte intégrés au dépôt : [format des plugins Goose](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md), [agents personnalisés](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/references/custom-agents.md), [hooks](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/hook-creator/references/hooks.md).
- Distribution installable : [manifeste sur main](https://github.com/servierhub/agent-plugins/blob/main/plugin.json) et [Skills sur main](https://github.com/servierhub/agent-plugins/tree/main/skills).
- Spécifications publiques : [Agent Skills](https://agentskills.io/specification) et [Agent Plugins](https://agent-plugins.org/).
- Défauts et échanges de développement : [problèmes du dépôt personnel en amont](https://github.com/bioinfornatics/agent-plugins/issues).

## Vocabulaire des preuves et de la sécurité

**Validé** signifie que les contrôles structurels applicables ont réussi. **Évalué** exige des preuves comportementales. **Bloqué** désigne un prérequis non satisfait. **Non concluant** signifie que les preuves disponibles ne permettent pas de trancher. **Approuvé** exige l'autorisation applicable ; des tests réussis n'autorisent pas à eux seuls la production.

Aucun manifeste n'isole du code exécutable dans un bac à sable. Gardez les ressources autonomes, documentez les dépendances externes et ne distribuez jamais de secrets. Pour prendre une décision, suivez [Évaluer et améliorer](how-to/evaluate.md).
