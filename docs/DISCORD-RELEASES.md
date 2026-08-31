# Annonces Discord des versions officielles

Le workflow GitHub **Announce release on Discord** publie dans le salon du webhook
`DISCORD_RELEASE_WEBHOOK`, même si Inazuma Music et le PC sont fermés. Ce secret
appartient au dépôt : il n’est pas livré dans l’EXE et ne remplace pas les webhooks
personnels que d’autres utilisateurs configurent localement dans l’application.

## Configuration et déclenchement

Dans les paramètres GitHub du dépôt, ajouter l’URL complète du webhook comme
secret Actions nommé `DISCORD_RELEASE_WEBHOOK`. Ne jamais l’ajouter au code, à un
ticket, aux notes de version ou à une commande affichée publiquement.

Les scripts et le workflow doivent être présents sur la branche par défaut
(`main`). Le workflow lit les scripts de cette branche de confiance, pas ceux du
tag à annoncer. Il ne nécessite ni installation npm ni jeton Discord de bot.

- Une publication officielle déclenche l’annonce (`release: published`).
- Le workflow de build appelle aussi l’annonce après publication réussie, car les
  événements produits par `GITHUB_TOKEN` ne lancent pas un autre workflow.
- Pour une version déjà publiée, Actions → **Announce release on Discord** →
  **Run workflow**, saisir le tag exact, par exemple `v2.2.8`.

Les brouillons et préversions sont refusés. Le script attend au plus environ cinq
minutes que l’installateur Windows de la version et `latest.yml` soient
entièrement téléversés. Il ne construit, n’installe et ne remplace aucun EXE.
La présence des fichiers est un prérequis d’annonce, pas une preuve que leur
contenu fonctionne : les vérifications du paquet restent nécessaires au build.

## Vérification obligatoire des installateurs

Le workflow **Build Windows release** compile désormais l’interface avec Vite
avant de construire les deux EXE. Il n’envoie aucun fichier tant que le contrôle
des archives embarquées n’a pas confirmé `dist/index.html`, chaque JavaScript et
CSS référencé, `main.js`, `preload.js`, la version et l’identité des archives entre
les paquets. Le nom, la taille et les empreintes SHA512 de `latest.yml` doivent
aussi correspondre à l’installateur vérifié. Les EXE ne sont jamais exécutés par
ce contrôle : seules leurs archives sont extraites dans un dossier temporaire.

Pour réparer un paquet déjà publié sans déplacer son tag, lancer manuellement
**Build Windows release** sur `main` avec le tag existant. Seuls les fichiers
reconstruits et vérifiés sont ensuite remplacés ; les notes de version restent
intactes. L’annonce est appelée après la réussite de la publication. Un échec
du contrôle interrompt la publication et l’annonce.

```powershell
node --test scripts/verify-packaged-ui.test.mjs
node scripts/verify-packaged-ui.mjs
```

Le workflow **Check release safeguards** exécute les tests d’annonce et de
validation des paquets lors des changements de ces scripts, sans aucun secret.

## Message et protection contre les doublons

L’annonce utilise le jaune Inazuma, le petit logo en haut à droite, la version,
les changements et des liens vers l’installateur exact et la publication. Les
notes longues sont aussi jointes en texte intégral. Aucune mention Discord ne
déclenche de notification globale. Les liens sont du Markdown (pas de faux
boutons ignorés par les webhooks ordinaires).

Une concurrence commune par tag sérialise les déclenchements automatiques et
manuels. Deux petits fichiers publics, sans secret, sont ajoutés à la release :

- `discord-announcement.pending.json` réserve l’envoi avant tout POST Discord ;
  il contient seulement le tag et l’heure.
- `discord-announcement.json` confirme le message après réponse Discord ; il
  contient seulement le tag, l’identifiant du message, celui du salon et l’heure.

Le marqueur final empêche les envois répétés. Un timeout, une interruption ou une
réponse ambiguë conserve la réservation et bloque un nouvel envoi, même si le
workflow est relancé. Il n’y a pas de boucle de renvoi aveugle. Un refus explicite
Discord (par exemple 400, 401, 403, 404 ou 429) libère la réservation : corriger la
cause ou attendre la fin du rate limit, puis relancer manuellement.

Si seule la réservation existe, **vérifier d’abord le salon Discord** :

- si le message existe, créer le marqueur final avec son véritable identifiant,
  celui du salon, le tag et l’heure ; ne pas relancer l’envoi ;
- s’il est certain qu’aucun message n’a été créé, retirer seulement la réservation
  de cette release puis relancer le workflow ;
- si le résultat reste incertain, conserver la réservation et ne pas renvoyer.

Ne pas supprimer ces marqueurs pour forcer une deuxième annonce. Le webhook
personnel de l’application reste un chemin séparé : ne pas configurer deux
mécanismes pour annoncer la même version dans le même salon.

## Tests locaux sans publication

```powershell
node --test scripts/announce-discord-release.test.mjs
```

Ces tests utilisent des réponses réseau simulées et aucun secret ni salon réel.
Le succès du test ne prouve pas qu’un message a été envoyé : la preuve en
production est le message visible dans Discord et son marqueur final GitHub.

Références : [GitHub Releases API](https://docs.github.com/en/rest/releases/assets),
[événements avec GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow),
[webhooks Discord](https://docs.discord.com/developers/resources/webhook).
