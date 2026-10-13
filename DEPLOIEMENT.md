# Mise en ligne de Flo & Pouille

Compte environ 15 minutes. Tout tient dans l'offre gratuite de Cloudflare.

Les intitulés des menus Cloudflare peuvent varier légèrement selon les mises à jour de leur interface.

## 1. Mettre le code sur GitHub (dépôt `didiervarin/Bring2Do`)

Choisis l'une des deux options :

- **Option A : Claude pousse le code.** Relie ton compte GitHub dans claude.ai → Réglages → Connecteurs → GitHub, puis demande-le-moi.
- **Option B : tu l'envoies toi-même.**
  1. Décompresse le zip.
  2. Sur github.com/didiervarin/Bring2Do, clique **Add file → Upload files**.
  3. Glisse **le contenu** du dossier `flo-pouille` (les dossiers `src`, `public`, `test` et les fichiers), et non le dossier lui-même.
  4. Clique **Commit changes**.

## 2. Créer la base de données D1

1. Ouvre dash.cloudflare.com → **Storage & Databases → D1** → **Create database**.
2. Nomme-la `flo-pouille`, puis clique **Create**.
3. Copie le **Database ID** affiché (une longue suite de chiffres et de lettres).
4. Sur GitHub, ouvre `wrangler.toml` et clique le crayon ✏️ pour le modifier :
   - remplace `REMPLACER_PAR_L_ID_DE_TA_BASE_D1` par l'ID copié ;
   - remplace `REMPLACER_PAR_TON_EMAIL` par ton adresse e-mail. Apple et Google l'exigent comme contact pour les notifications ; elle n'est jamais affichée.
5. Clique **Commit changes**.

Les tables se créent automatiquement au premier lancement : il n'y a pas de SQL à exécuter.

## 3. Relier GitHub à Cloudflare

1. Dans Cloudflare, ouvre **Workers & Pages → Create → Import a repository** (onglet Workers).
2. Connecte GitHub si on te le demande, puis choisis **Bring2Do**.
3. Nom du projet : **`flo-pouille`**. Il doit être identique au `name` de `wrangler.toml`.
4. Commande de déploiement : `npx wrangler deploy` (valeur par défaut).
5. Clique **Deploy**.

Ensuite, chaque modification poussée sur GitHub redéploie le site automatiquement.

## 4. Définir les deux mots de passe

1. Ouvre le Worker `flo-pouille`, puis **Settings → Variables and Secrets → Add**.
2. Ajoute deux variables de **type Secret** :
   - `FLO_PASSWORD` : le mot de passe de Flo ;
   - `POUILLE_PASSWORD` : le mot de passe de Pouille.
3. Enregistre.

Pour changer un mot de passe plus tard, modifie simplement le secret.

L'adresse du site est indiquée sur la page du Worker. Elle ressemble à `https://flo-pouille.<ton-sous-domaine>.workers.dev`.

## 5. Installer l'app sur chaque iPhone

1. Ouvre l'adresse dans **Safari**.
2. Touche **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Ouvre l'app **depuis l'icône**, choisis ton prénom et connecte-toi. L'app installée a sa propre session, distincte de Safari.
4. Touche ⚙︎ → **Activer les notifications** → **Autoriser**, puis **Envoyer un test**.

## Fonctionnement

### Courses
- Ajoute un article avec `nom, précision`, par exemple `lait, 2 L`. Le rayon et l'emoji sont devinés automatiquement.
- Touche une tuile pour retirer l'article de la liste. Il passe dans « Récemment utilisés » ; touche-le de nouveau pour le remettre.
- Un appui long sur une tuile permet de modifier le nom, la précision ou le rayon, ou de supprimer l'article.

### Tâches
- Chaque tâche a une échéance (date et heure) et est attribuée à Flo, à Pouille ou aux deux.
- La touche Entrée ajoute une tâche sans échéance pour les deux. Le bouton ＋ ouvre le formulaire complet.

### Notifications
- Le serveur vérifie les échéances chaque minute.
- À l'échéance, seule la personne concernée reçoit une notification ; ce sont les deux si la tâche est attribuée aux deux.

### Badge sur l'icône
- Le chiffre indique le nombre de tâches échues et non faites qui te concernent.
- Il est mis à jour à chaque notification et à chaque ouverture de l'app.
- **Limite iOS** : si l'autre coche une de tes tâches pendant que ton app est fermée, ton badge ne se corrige qu'à la prochaine ouverture. Apple interdit de modifier le badge sans afficher de notification.

### Synchronisation
- Quand l'app est ouverte, les données se rafraîchissent toutes les 5 secondes et à chaque retour dans l'app.

## Développement local (facultatif)

```bash
npm install
printf 'FLO_PASSWORD=test\nPOUILLE_PASSWORD=test\n' > .dev.vars
npm run dev      # http://localhost:8787
npm test         # vérifie le chiffrement des notifications
```
