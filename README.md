# Inazuma Music Desktop

Application Windows avec historique local persistant, playlists intégrées et mises à jour automatiques via les versions GitHub publiques.

## Choix automatique du salon Discord

Dans **Paramètres > Bot Discord**, renseignez votre identifiant utilisateur Discord,
le serveur préféré et éventuellement un salon textuel. À chaque lecture, le bot
cherche cet utilisateur sur le serveur et rejoint son salon vocal actuel. S'il
n'est dans aucun vocal, la lecture est refusée avec un message clair.

Pour copier l'identifiant : Discord > Paramètres avancés > Mode développeur, puis
clic droit sur votre profil > **Copier l'identifiant utilisateur**. Cet identifiant
est public ; l'application ne demande et ne conserve jamais de token utilisateur.

Application Windows noir/violet pour contrôler Inazuma Music. Elle utilise une passerelle Cloudflare permanente préconfigurée : les amis installent l’application une seule fois et n’ont aucune clé YouTube à créer.

## Lancer l'application

Prérequis : Node.js 20 ou plus récent.

```powershell
npm install
npm run dev
```

Dans **Paramètres**, aucune adresse, clé YouTube ou code de connexion n’est demandé. La recherche YouTube passe par la passerelle sécurisée du propriétaire du bot.

La clé YouTube et le secret du bot sont chiffrés via le coffre du système (`safeStorage`). Le token Discord reste uniquement dans le bot.

## Créer le .exe Windows

```powershell
npm run build
```

Les versions installable et portable apparaissent dans `release/`. Pour un contrôle plus rapide sans installateur : `npm run build:dir`.

## Relier le bot Discord

Le bot doit exposer un serveur WebSocket local suivant [docs/BOT-PROTOCOL.md](docs/BOT-PROTOCOL.md). Dans **Paramètres > Démarrage du bot**, on peut aussi indiquer le dossier du bot et sa commande (par exemple `npm start`).

## Architecture

- `electron/main.ts` : fenêtre native, coffre sécurisé, YouTube et processus bot.
- `electron/preload.ts` : passerelle IPC limitée et typée.
- `src/App.tsx` : interface et logique temps réel.
- `src/styles.css` : design noir/violet.
- `docs/BOT-PROTOCOL.md` : contrat du bot existant.
