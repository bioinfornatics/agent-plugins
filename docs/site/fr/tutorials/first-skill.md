# Tutoriel : créez votre premier Skill

Vous allez transformer une tâche simple et observable en Skill portable : lire un fichier Markdown et restituer ses décisions et questions ouvertes. L'objectif est d'apprendre le cycle de création et de relecture, pas de démontrer une capacité de production à partir d'un seul exemple.

## Avant de commencer

Terminez les [Premiers pas](../getting-started.md). Travaillez dans un projet d'essai où vous autorisez la création de fichiers. Utilisez le nom qualifié du créateur après installation du plugin, ou le nom simple `skill-creator` après installation autonome. Cet exercice ne nécessite ni API externe ni exécutable personnalisé.

## 1. Définissez un bon résultat

Utilisez ce petit jeu de données dans `meeting.md`, dans votre projet d'essai :

```markdown
# Préparation de la version
- Décision : publier le guide de migration avant la version.
- Décision : conserver les clés de configuration existantes pour cette version.
- Question ouverte : qui relira les exemples ?
- Discussion : un nouveau tableau de bord pourrait être utile plus tard.
```

Comportement attendu : deux décisions, une question ouverte et aucun relecteur inventé. La discussion sur le tableau de bord n'est pas une décision. Cette distinction rend la tâche vérifiable.

## 2. Demandez un Skill ciblé

> Utilise `agent-plugins:skill-creator` pour créer `.agents/skills/markdown-summary`. Il doit résumer un fichier Markdown en décisions clés et questions ouvertes, sans inventer de faits ni transformer une discussion en décision. Rédige les métadonnées et les instructions du Skill en anglais. Garde-le simple et portable, valide-le et présente les fichiers créés ainsi que ce qui reste à évaluer. N'ajoute ni agent personnalisé, ni hook, ni API externe, ni script inutile.

Répondez aux questions de clarification du créateur. Précisez le comportement attendu lorsqu'un fichier ne comporte aucune décision ou question : indiquer qu'aucune n'est consignée, plutôt que combler le vide.

## 3. Relisez les fichiers générés

Vérifiez que `.agents/skills/markdown-summary/SKILL.md` existe. Lisez-le avant de l'utiliser. Son objectif et ses conditions d'activation doivent correspondre à la demande ; son processus doit expliquer comment distinguer les décisions explicites, les questions ouvertes et les autres discussions.

Les fichiers complémentaires sont facultatifs, pas un objectif en soi. Si le créateur en génère, vérifiez qu'ils restent dans le répertoire du Skill et sont directement référencés quand c'est nécessaire. Un processus court et autonome peut ne nécessiter que `SKILL.md`.

Demandez au créateur d'expliquer le résultat de validation. La conformité du format et la politique de rédaction sont deux contrôles distincts ; aucun ne prouve une amélioration des synthèses. N'ajoutez pas de complexité pour satisfaire des exigences imaginaires.

## 4. Essayez le jeu de données

Dans une session où le nouveau Skill de projet est découvrable, demandez explicitement à l'hôte d'utiliser `markdown-summary` sur `meeting.md` et de restituer les décisions et questions ouvertes.

**Critère de réussite :** la réponse conserve les deux décisions, laisse la question du relecteur sans réponse et ne transforme pas l'idée de tableau de bord en décision. L'agent ne doit pas modifier le fichier d'entrée.

Il s'agit d'un contrôle rapide de fonctionnement, pas d'une évaluation comportementale appariée ni d'une étude de précision du déclenchement. Charger explicitement un Skill ne montre pas que l'hôte l'aurait choisi seul.

## 5. Ajoutez un cas limite

Essayez un second fichier contenant uniquement une discussion :

```markdown
# Idées
Un tableau de bord pourrait faciliter le suivi de la version.
Nous pourrions discuter des responsabilités la semaine prochaine.
```

**Critère de réussite :** la synthèse indique qu'aucune décision ou question ouverte n'est explicitement consignée. Elle ne doit pas transformer une discussion future possible en attribution actuelle.

Si le comportement est incorrect, conservez la réponse et décrivez précisément l'échec avant de modifier le Skill. Ajoutez un cas d'évaluation réaliste au lieu de simplement allonger les instructions.

## 6. Sachez quand vous arrêter

Le tutoriel est terminé lorsque les fichiers peuvent être examinés, que la validation est rapportée et que les deux contrôles rapides ont des résultats consignés. Signalez honnêtement les comportements non résolus.

Pour affirmer que le Skill est utile, comparez-le à `without_skill` ou à une version antérieure `old_skill` sur les mêmes scénarios, avec des preuves de notation et de relecture. Suivez [Évaluer et améliorer](../how-to/evaluate.md). Ne l'empaquetez pas et ne l'activez pas plus largement simplement parce qu'une réponse semblait bonne.

**Poursuivre :** [Choix du créateur](../how-to/creators.md) pour les autres types de capacités, ou [guide Skill Creator](https://github.com/bioinfornatics/agent-plugins/blob/develop/skills/skill-creator/README.md) pour les processus avancés.
