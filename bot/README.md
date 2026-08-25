# Bot musique Discord + YouTube

Bot Node.js prêt à lancer avec `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/loop` et `/volume`. Il accepte un titre ou une URL YouTube, maintient une file indépendante par serveur, affiche les titres et miniatures, puis quitte automatiquement le vocal quand la file est vide.

## Prérequis

- **Node.js 20 ou plus récent** ;
- **yt-dlp** récent et disponible dans le `PATH` (ou son chemin dans `YTDLP_PATH`) ;
- une application Discord avec un bot.

FFmpeg est fourni par `ffmpeg-static`. L’adaptateur `yt-dlp` reste isolé afin de pouvoir remplacer ou mettre à jour son exécutable sans modifier le reste du bot.

### Installer yt-dlp

Choisissez une méthode officielle adaptée à votre système :

```bash
# Windows avec winget
winget install yt-dlp.yt-dlp

# Python / tous systèmes (pipx conseillé)
pipx install yt-dlp

# Mise à jour ultérieure
yt-dlp -U
```

Vérifiez ensuite :

```bash
node --version
yt-dlp --version
```

## Créer et inviter le bot Discord

1. Dans le [Discord Developer Portal](https://discord.com/developers/applications), créez une application et un bot.
2. Copiez le **token** du bot et l’**Application ID**.
3. Dans **Installation**, invitez le bot avec les scopes `bot` et `applications.commands`.
4. Accordez-lui au minimum : voir les salons, envoyer des messages, intégrer des liens, se connecter et parler.

Aucun intent privilégié n’est requis. Le bot utilise seulement les intents `Guilds` et `GuildVoiceStates`.

## Installation

```bash
npm install
```

Copiez `.env.example` vers `.env`, puis remplissez :

```dotenv
DISCORD_TOKEN=votre_token
DISCORD_CLIENT_ID=id_application
DISCORD_GUILD_ID=id_serveur_de_test
YTDLP_PATH=yt-dlp
IDLE_DISCONNECT_MS=30000
DEFAULT_VOLUME=50
```

Ne publiez jamais `.env`. `DISCORD_GUILD_ID` est recommandé en développement : les commandes de serveur sont disponibles presque immédiatement. En production, supprimez cette valeur pour publier les commandes globalement (leur propagation peut prendre du temps).

## Déployer les commandes et lancer

```bash
npm run deploy-commands
npm start
```

Pour vérifier le code et les tests :

```bash
npm run check
```

## Commandes

| Commande | Effet |
|---|---|
| `/play recherche:<titre ou URL>` | Cherche le premier résultat ou lit l’URL, puis l’ajoute |
| `/pause` / `/resume` | Met en pause / reprend |
| `/skip` | Passe au titre suivant |
| `/stop` | Vide la file et quitte le vocal |
| `/queue` | Affiche le titre actuel et les 10 suivants |
| `/loop off\|track\|queue` | Désactive ou active la boucle |
| `/volume niveau:0-100` | Change le volume du serveur |

Les commandes de contrôle doivent être lancées depuis le même salon vocal que le bot.

## Pourquoi cette architecture ?

- `src/services/youtube.js` est l’unique adaptateur YouTube. Le reste du bot ne dépend pas des détails d’extraction.
- `yt-dlp` réalise à la fois `ytsearch1:` et la lecture. C’est un projet activement maintenu qui réagit généralement plus vite aux changements YouTube que les petits extracteurs JavaScript.
- Chaque serveur possède son lecteur, sa file, son volume et son mode de boucle.
- Le flux est transcodé en PCM 48 kHz stéréo avant d’être envoyé à Discord, ce qui rend les formats sources interchangeables.

## Limites YouTube importantes (2026)

Ce projet n’utilise aucune API de lecture YouTube officielle : **le fonctionnement n’est donc jamais garanti**. YouTube modifie régulièrement ses protections, impose progressivement des jetons PO à certains clients et peut appliquer des limites ou des blocages d’IP. Certaines vidéos (âge, membres, privées, DRM, géorestrictions) ne fonctionneront pas. Un hébergeur de datacenter est plus susceptible d’être limité.

En cas d’erreur, commencez par mettre `yt-dlp` à jour. Les configurations avec cookies ou fournisseurs de jetons PO sont volontairement absentes du projet de base : elles ajoutent des secrets, des risques de bannissement de compte et de la maintenance. Si YouTube finit par les exiger dans votre environnement, suivez uniquement la documentation officielle de `yt-dlp` et ne commitez jamais cookies ou jetons.

Vous devez respecter les [Conditions d’utilisation de YouTube](https://www.youtube.com/static?template=terms), les droits d’auteur et les règles Discord. Ce bot est préférable pour un usage privé et raisonnable ; un bot public à grande échelle demandera davantage d’exploitation, de conformité et de surveillance.

Ressources : [documentation `@discordjs/voice`](https://discord.js.org/docs/packages/voice/stable), [dépôt officiel yt-dlp](https://github.com/yt-dlp/yt-dlp), [guide PO Token yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## Dépannage rapide

- **`yt-dlp est introuvable`** : installez-le ou mettez son chemin absolu dans `YTDLP_PATH`.
- **`Sign in to confirm you're not a bot` / HTTP 403** : mettez `yt-dlp` à jour ; l’IP peut être limitée ou un jeton PO peut être requis.
- **Le bot rejoint mais aucun son** : vérifiez les permissions *Se connecter* et *Parler*, et que le bot n’est pas rendu muet côté serveur.
- **Commandes absentes** : relancez `npm run deploy-commands` avec les bons `DISCORD_CLIENT_ID` et `DISCORD_GUILD_ID`.
- **Performances audio limitées sur un très gros bot** : le projet utilise `opusscript`, portable et sans compilation native. Pour une forte charge, remplacez-le par `@discordjs/opus` sur une version de Node.js disposant d’un binaire compatible (ou avec les outils de compilation installés).
