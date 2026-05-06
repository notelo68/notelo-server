# Notelo — Instructions Claude

## Commande STARTNOTELO

Quand l'utilisateur tape **`STARTNOTELO`** (seul ou en début de message), tu DOIS :

1. **Récap de la précédente session**
   - **Lire en priorité** le dernier fichier `sessions/YYYY-MM-DD-*.md` (le plus récent) — c'est la mémoire de session écrite par SESSION END
   - Lire les derniers commits GitHub via `mcp__github__list_commits` (repo `notelo68/notelo-server`, branche `main` ET branche de dev)
   - Résumer ce sur quoi on a travaillé récemment (5–10 derniers commits)
   - Mentionner les changements structurants (migrations, refactos, nouveaux endpoints)

2. **Analyse complète du bon fonctionnement**
   - Vérifier la cohérence du code `index.js` (routes, sécurité, gestion d'erreurs)
   - Vérifier les migrations Supabase (`supabase-migrations/`)
   - Identifier les risques : données sensibles, secrets, race conditions, fuites mémoire, dépendances obsolètes
   - Vérifier l'alignement entre webhook Stripe / Supabase / Brevo

3. **Points d'amélioration & TODO**
   - Lister les améliorations techniques (refacto, perf, sécu, tests)
   - Lister les améliorations produit (UX, fonctionnalités manquantes)
   - Prioriser : 🔴 critique / 🟠 important / 🟢 nice-to-have

**Format de sortie** : structuré en 3 sections claires avec puces. Concis mais complet. En français.

## Commande SESSION END

Quand l'utilisateur tape **`SESSION END`** (seul ou en début de message), tu DOIS :

1. **Créer un fichier `sessions/YYYY-MM-DD-HHmm-<slug>.md`** (date du jour, heure UTC, slug court résumant la session)
2. **Y consigner l'intégralité de la session** dans ce format :

   ```markdown
   # Session YYYY-MM-DD — <titre court>

   ## Contexte
   <1–3 phrases : sur quoi on est parti, état initial du projet>

   ## Travail réalisé
   - **Commits** : liste des SHA + messages courts (récupérer via `git log` sur la branche de dev)
   - **Fichiers modifiés** : liste avec une ligne d'explication par fichier
   - **Migrations DB** : si une migration SQL a été créée, la mentionner explicitement

   ## Décisions importantes
   <choix d'archi, trade-offs, raisons d'écarter une alternative>

   ## Actions manuelles requises de l'utilisateur
   <ex. exécuter une migration Supabase, ajouter une env var Render, configurer un webhook Stripe>

   ## En suspens / à reprendre la prochaine fois
   <todo non terminés, idées à explorer, blocages>

   ## Questions ouvertes
   <ce qui n'a pas été tranché>
   ```

3. **Commit + push** ce fichier sur la branche de dev (sans demander confirmation, c'est attendu pour SESSION END)
4. **Confirmer à l'utilisateur** : afficher le chemin du fichier créé et un résumé en 3 bullets

**Important** : le fichier de session est la SEULE mémoire durable inter-session. À chaque STARTNOTELO, tu dois le lire en premier.

## Contexte projet

- **Stack** : Node.js / Express, Supabase (Postgres), Stripe, Brevo (SMS + email)
- **Hébergement** : Render (donc système de fichiers volatil — pas de stockage local persistant)
- **Repo GitHub** : `notelo68/notelo-server`
- **But métier** : envoi de SMS de demande d'avis Google Business pour des pros (garages, etc.)
- **Plans** : Starter 29€ (50 SMS), Pro 49€ (200 SMS), Business 89€ (illimité)
- **Comptes fixes** : `vincent@notelo.eu` (admin), `demo@notelo.eu` (démo)

## Règles de travail

- Branche de dev par défaut : `claude/start-note-lo-Hb8rR` (sauf indication contraire)
- Ne jamais commit/push sans confirmation explicite
- Toujours utiliser les MCP GitHub pour lire l'état distant à jour, pas juste le repo local
- Réponses en français
