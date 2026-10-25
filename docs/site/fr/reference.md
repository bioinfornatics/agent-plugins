# Référence

Consultez cette page pour retrouver les versions consignées, les chemins, les limites des commandes et les documents sources. Pour une introduction guidée, commencez par les [Concepts](concepts.md) et les [Premiers pas](getting-started.md).

## Cibles et prérequis consignés

| Élément | Valeur ou règle consignée |
|---|---|
| Distribution | 0.5.0 |
| Cible portable des plugins | Agent Plugins 1.0.0 |
| Instantané 1.1.0 | Brouillon de travail inactif ; cible non prise en charge |
| Intégration vérifiée avec l'hôte | Goose 1.47.0, sans affirmation sur la dernière version |
| Exécution des créateurs installés depuis Git | Node.js 22+ ; code compilé et dépendances de production inclus |
| Exécution des versions natives | Exécutable Bun propre à la plateforme ; Node.js non requis |
| Outils de contribution | Node.js 22+ et Bun 1.3.12 épinglé ; la CI courante utilise Node.js 22.22.2 |
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
| `hooks/hooks.json` à la racine | Ancienne entrée Goose, pas l'agencement des nouveaux hooks |
| `agents/` inclus | Pas une installation portable d'agents personnalisés en 1.0.0 ; non découvert automatiquement par Goose audité |

Le MCP portable prend en charge les variantes consignées `stdio`, `streamable-http` et `sse`. Le chargeur de plugins Goose audité cherche par défaut `.mcp.json` et convertit les déclarations stdio. La sélection explicite d'un fichier portable `./mcp.json` limité à stdio peut fonctionner selon le contrat consigné ; n'en déduisez pas une prise en charge des transports distants et n'autorisez pas d'activations en double. Consultez la [conformité portable](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/portable-conformance.md) avant une migration.

## Points d'entrée stables des commandes

Les créateurs exécutables exposent `skill-creator`, `agent-creator`, `hook-creator` et `plugin-creator`. Les archives natives les placent dans le répertoire `scripts/` de chaque Skill, avec `.exe` sous Windows. La distribution Git utilise des lanceurs Node autonomes ; l'installation n'implique pas une entrée dans le PATH du shell. Utilisez le lanceur installé ou l'exécutable natif approprié, pas les chemins internes des sources.

| Opération | Exemple documenté |
|---|---|
| Validation du format d'un Skill | `skill-creator validate /path/to/skill` |
| Audit de rédaction d'un Skill | `skill-creator audit /path/to/skill --format json` |
| Aperçu de l'évaluation | `skill-creator full-eval /path/to/skill --workspace /path/to/workspace --dry-run` |
| Rapport statique d'évaluation | `skill-creator review /path/to/iteration-workspace --static review.html` |
| Contrôles de chargement portable | `plugin-creator validate /path/to/plugin --mode portable-load --format json` |
| Contrôles stricts de rédaction du plugin | `plugin-creator validate /path/to/plugin --mode strict-authoring --format json` |
| Contrôles de définition d'agent | `agent-creator validate /path/to/agent.md --require-filename-match` |
| Contrôles de hook | `hook-creator validate /path/to/plugin` |

Pour Skill Creator, Agent Creator et Plugin Creator, les codes de sortie consignés sont **0** réussite, **1** échec, **2** usage incorrect, **3** blocage. Le README de Hook Creator documente **0**, **1** et **2** ; ne supposez pas des contrats de commandes ou de codes de sortie identiques pour tous les créateurs. L'option `--help` de chaque commande est le point d'entrée de consultation. La CLI ne remplace ni un moteur, modèle ou évaluateur configuré, ni une véritable relecture humaine.

## Archives natives

| Plateforme | Archive |
|---|---|
| Linux x86-64 | `agent-plugins-creators-linux-x64.tar.gz` |
| Linux ARM64 | `agent-plugins-creators-linux-arm64.tar.gz` |
| macOS Intel | `agent-plugins-creators-darwin-x64.tar.gz` |
| macOS Apple silicon | `agent-plugins-creators-darwin-arm64.tar.gz` |
| Windows x86-64 | `agent-plugins-creators-win32-x64.tar.gz` |

Vérifiez l'archive avec le fichier `SHA256SUMS` de la même version **avant extraction**. Une archive native contient quatre arborescences complètes de Skills créateurs ; cela ne signifie pas qu'elle inclut tous les Skills du dépôt. Ne combinez jamais les archives et n'ajoutez pas d'anciennes charges d'exécution Node. Consultez [RELEASES.md](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md) pour les commandes de contrôle et les vérifications de PATH. La disponibilité des archives et leur publication dépendent du dépôt ; confirmez la version téléchargée.

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
