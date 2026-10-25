# Premiers pas

L'objectif est de rendre un créateur découvrable et de vérifier qu'il peut vous aider sans modifier de fichiers. La création d'un Skill viendra ensuite.

## 1. Choisissez votre mode d'installation

Utilisez Goose pour l'intégration consignée comme vérifiée par ce dépôt (**1.47.0**). Les autres hôtes nécessitent leurs propres procédures documentées d'installation et de vérification de compatibilité.

| Mode | Prérequis | Ce qui n'est pas nécessaire |
|---|---|---|
| Installation du plugin depuis Git | Hôte, capacité d'installation Git, Node.js 22+ | Compilation, Bun, installation de dépendances npm |
| Répertoire complet d'un Skill autonome | Hôte découvrant les Skills autonomes ; Node.js 22+ pour la charge Git | Outils à la racine du dépôt |
| Archive native étiquetée | Archive correspondant au système/processeur et somme de contrôle vérifiée | Node.js ou dépendances npm |

N'installez que du code et des instructions de confiance. Les mises à jour automatiques privilégient la commodité au contrôle manuel ; faites ce choix consciemment.

## 2. Installez la distribution Git

Vérifiez Node.js :

```bash
node --version
```

Installez ensuite :

```bash
goose plugin install https://github.com/servierhub/agent-plugins.git
```

Il s'agit de la distribution ServierHub, pas du dépôt personnel de développement en amont. Les plugins installés résident sous `~/.agents/plugins/<name>/` ; les plugins locaux à un projet peuvent résider sous `.agents/plugins/<name>/`.

## 3. Vérifiez la découverte sans écrire de fichiers

Démarrez une nouvelle session Goose et demandez :

> Utilise `agent-plugins:skill-creator` pour expliquer les informations nécessaires à la création d'un Skill. Ne modifie aucun fichier pour le moment.

**Critère de réussite :** le créateur est trouvé et demande l'objectif attendu, les conditions d'activation, le processus, les contraintes et les besoins d'évaluation. La découverte seule ne prouve pas qu'un Skill généré se comportera correctement.

**Suite :** suivez le [tutoriel du premier Skill](tutorials/first-skill.md) dans un projet d'essai.

## 4. Comprenez les mises à jour et les alternatives

Pour activer les mises à jour automatiques, utilisez plutôt cette commande d'installation :

```bash
goose plugin install --auto-update https://github.com/servierhub/agent-plugins.git
```

Pour mettre à jour à la demande un plugin installé depuis Git :

```bash
goose plugin update agent-plugins
```

Pour un Skill autonome sous Linux ou macOS, copiez le **répertoire complet** :

```bash
git clone https://github.com/servierhub/agent-plugins.git
cd agent-plugins
mkdir -p ~/.agents/skills
cp -R skills/skill-creator ~/.agents/skills/skill-creator
```

Utilisez `skill-creator` plutôt que le nom qualifié du plugin pour cette installation autonome. Goose découvre les Skills de projet dans `.agents/skills/` et les Skills globaux dans `~/.agents/skills/` ; vérifiez séparément les autres hôtes. L'[arborescence du Skill installable](https://github.com/servierhub/agent-plugins/blob/main/skills/skill-creator/SKILL.md) comporte des fichiers complémentaires qui doivent rester ensemble.

Les archives natives se choisissent manuellement ; l'installateur Git de Goose ne les sélectionne pas automatiquement. Téléchargez l'archive adaptée et `SHA256SUMS` depuis la même version étiquetée, vérifiez **avant extraction**, et ne mélangez jamais les charges Node et natives. Suivez le [guide d'installation des versions](https://github.com/bioinfornatics/agent-plugins/blob/develop/RELEASES.md) ; vérifiez quel dépôt publie réellement la version souhaitée. Les installations copiées manuellement se mettent à jour séparément.

## Dépannage

| Symptôme | Vérification |
|---|---|
| Créateur introuvable | Nouvelle session ; nom qualifié pour un plugin, nom simple pour un Skill autonome |
| Créateur Git impossible à lancer | Node.js 22+ et répertoire complet, y compris `runtime/` |
| Dépendances d'exécution manquantes | Réinstaller la distribution complète ; ne pas réparer avec `npm install` |
| Échec de validation | Suivre le diagnostic du fichier ou champ indiqué ; ne pas le contourner |
| Évaluation bloquée | Fournir les preuves manquantes d'exécution, de notation, de test ou de relecture |
| Mauvaise version native | Vérifier PATH, système/architecture et anciens lanceurs |

Signalez les défauts reproductibles dans le [suivi des problèmes en amont](https://github.com/bioinfornatics/agent-plugins/issues), et non dans une file ServierHub distincte. Précisez le mode d'installation, les versions, la commande, le diagnostic et une reproduction minimale sans données sensibles.

**Suite :** [Tutoriel du premier Skill](tutorials/first-skill.md) ou [choix du créateur](how-to/creators.md).
