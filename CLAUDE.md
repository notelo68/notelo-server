# Notelo — Instructions Claude

## Commande STARTNOTELO

Quand l'utilisateur tape **`STARTNOTELO`** (seul ou en début de message), tu DOIS :

1. **Récap de la précédente session**
   - Lire les derniers commits GitHub via `mcp__github__list_commits` (repo `notelo68/notelo-server`, branche `main`)
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
