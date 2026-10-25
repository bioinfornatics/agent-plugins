# Choisir et utiliser les créateurs

Identifiez le responsable du résultat demandé avant de solliciter une implémentation. Une demande claire précise **l'objectif, la destination, les contraintes et les critères de réussite**.

## Choisissez la portée minimale appropriée

| Vous voulez… | Créateur | Responsabilité |
|---|---|---|
| Créer, auditer, améliorer ou évaluer un Skill | `agent-plugins:skill-creator` | Instructions, ressources et évaluation du Skill |
| Créer ou améliorer un rôle délégué | `agent-plugins:agent-creator` | Définitions d'agents personnalisés Goose |
| Ajouter ou tester un hook de cycle de vie | `agent-plugins:hook-creator` | Comportement du hook, scripts et contrôles spécialisés |
| Assembler, migrer, valider ou empaqueter un plugin | `agent-plugins:plugin-creator` | Manifeste, MCP, coordination des composants, intégration, empaquetage |
| Concevoir l'empaquetage d'exécutables | `agent-plugins:plugin-script-packaging` | Conseils sur les environnements et lanceurs selon le langage |

Utilisez les noms non qualifiés, comme `skill-creator`, pour les installations autonomes. Plugin Creator coordonne les spécialistes ; il ne remplace pas leur logique de création. Script Packaging conseille sur la conception des exécutables ; Plugin Creator reste responsable de la validation finale du plugin complet et de l'approbation de publication.

## Créez ou améliorez un Skill

> Utilise `agent-plugins:skill-creator` pour créer `.agents/skills/api-review`. Il doit examiner un diff OpenAPI pour détecter les changements incompatibles et produire un rapport Markdown concis. Garde le Skill portable, ajoute des cas d'évaluation réalistes, valide le résultat et présente les fichiers ainsi que les preuves manquantes.

**Vérification :** le résultat est un répertoire de Skill ciblé, pas une définition d'agent ni un plugin complet. Confirmez ses conditions d'activation, ses limites et les chemins de ses ressources. Pour un Skill existant, conservez la référence avant de demander des modifications. Consultez le [tutoriel du premier Skill](../tutorials/first-skill.md) et le [guide d'évaluation](evaluate.md).

## Créez un agent personnalisé

> Utilise `agent-plugins:agent-creator` pour créer un agent code-reviewer local au projet, centré sur la correction, la sécurité et les tests de régression. Explique les limites de sa délégation, valide sa définition et présente-la avant installation. Ne modifie pas les extensions activées et ne crée pas de plugin.

**Vérification :** la définition d'agent appartient à l'emplacement documenté `.agents/agents/`, pas à un répertoire de Skill. L'évaluation doit comparer des tâches déléguées isolées à une délégation neutre ou à une version antérieure de l'agent, sans convertir l'agent en Skill.

Un agent personnalisé peut utiliser les extensions MCP déjà activées dans sa session Goose. Il ne peut pas déclarer un transport MCP, une commande, un environnement ou des identifiants dans sa propre définition. Confiez cette configuration à Plugin Creator. Un répertoire `agents/` inclus dans un plugin n'est pas automatiquement installé ou découvert comme agents personnalisés dans la révision Goose auditée. Consultez le [guide Agent Creator](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/agent-creator/README.md) pour le contrat consigné, plutôt que recopier ici un modèle de frontmatter.

## Ajoutez un hook de cycle de vie en sécurité

> Utilise `agent-plugins:hook-creator` pour ajouter à `./my-plugin` un hook qui consigne certaines activités de l'outil shell. Utilise un script relatif au plugin, explique les effets de bord et le comportement en cas d'échec, valide le filtre et les fichiers référencés, puis présente le résultat avant activation.

**Vérification :** partez d'un manifeste de plugin valide ; examinez les données enregistrées et leur destination. Les tests du gestionnaire et les preuves d'intégration avec l'hôte sont distincts. Un comportement bloquant, comme une politique PreToolUse, exige une analyse explicite des modes de défaillance.

Le README de Hook Creator contient un ancien agencement racine `hooks/hooks.json`. La [référence de l'adaptateur Goose](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/references/goose-plugin-format.md) actuelle prévoit une extension avec espace de noms pour les nouveaux hooks. Ne recopiez pas l'ancien agencement et ne combinez pas les deux formes ; faites valider explicitement la migration par les créateurs. Les hooks ne font pas partie du noyau portable Agent Plugins 1.0.0.

## Assemblez un plugin complet

> Utilise `agent-plugins:plugin-creator` pour créer `./release-assistant` avec un Skill portable de rédaction de notes de version. Valide-le en modes portable-load et strict-authoring, sépare les comportements propres à l'hôte et présente le paquet avant de créer une archive.

**Vérification :** `plugin.json` est valide, les Skills inclus sont autonomes, les déclarations MCP sont validées selon le format et l'hôte, et les preuves d'intégration couvrent les comportements modifiés. L'empaquetage ne remplace ni l'évaluation ni l'approbation.

Le fichier portable racine `mcp.json` et le chargement MCP de Goose diffèrent. Ne devinez ni les règles de priorité ni la prise en charge des transports distants ; utilisez le [guide Plugin Creator](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-creator/README.md) et les contrôles de l'adaptateur consigné.

## Empaquetez les ressources exécutables

> Utilise `agent-plugins:plugin-script-packaging` pour planifier une CLI TypeScript autonome pour ce Skill, avec son environnement d'installation Git et la séparation avec les versions natives. Explique les dépendances et les vérifications avant de modifier les lanceurs. Laisse à Plugin Creator la validation finale du plugin et l'approbation de publication.

TypeScript est la branche de conseil par défaut ; Rust et Python disposent de branches conditionnelles. Cela ne promet pas des environnements intégrés pour tous les langages ou hôtes. Lisez le [guide Script Packaging](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/plugin-script-packaging/README.md).

## Avant d'accepter le résultat

Demandez les fichiers modifiés, les résultats exacts de validation, les preuves d'exécution, les risques non résolus et l'action suivante. N'incluez jamais de secrets et n'activez pas silencieusement de comportement exécutable. Si une capacité ou une relecture est indisponible, conservez le statut bloqué au lieu d'assimiler les contrôles statiques à une réussite comportementale.

**Suite :** [Évaluer et améliorer](evaluate.md) ou [Référence](../reference.md).
