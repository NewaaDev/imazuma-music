# Protocole WebSocket Inazuma Music

Valeur par défaut : `ws://127.0.0.1:8765`.

## Authentification

Le client envoie `{ "type": "auth", "token": "secret-partage" }`. Le serveur ferme avec le code `4001` si le secret est invalide. Hors de `127.0.0.1`, utiliser `wss://` et un secret long.

## Commandes

Format : `{ "type":"command", "action":"enqueue", "payload":{}, "requestId":"id", "context":{} }`.

`context` transporte uniquement les identifiants Discord publics `discordUserId`,
`preferredGuildId` et `preferredTextChannelId`. Il ne doit jamais contenir un token
utilisateur Discord. Le bot rejoint uniquement le salon vocal actuel de l'utilisateur
identifié et refuse la lecture si cet utilisateur n'est dans aucun vocal.

| Action | Payload |
|---|---|
| `get_state`, `toggle_pause`, `skip`, `stop`, `clear_queue` | aucun |
| `volume` | nombre 0–100 |
| `play_now`, `play_next`, `enqueue` | objet `Track` |
| `remove_queue` | index numérique |
| `reorder_queue` | tableau de `Track` |

Un `Track` contient `id`, `title`, `channel`, `thumbnail`, `duration` et éventuellement `requestedBy`. `id` est l'identifiant YouTube.

## État diffusé par le bot

```json
{
  "type": "state",
  "payload": {
    "botOnline": true, "guildName": "Communauté Inazuma", "voiceChannel": "Musique",
    "playing": true, "volume": 64, "position": 28,
    "current": { "id":"...", "title":"...", "channel":"...", "thumbnail":"...", "duration":"3:42" },
    "queue": [], "history": []
  }
}
```

`position` est un pourcentage. Diffuser l'état au moins toutes les cinq secondes pendant la lecture et après chaque changement. Réponse conseillée : `{ "type":"event", "event":"command_result", "payload": { "requestId":"...", "ok":true } }`.
