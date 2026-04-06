# Instructions pour Claude Code — Projet Notelo

## Règle obligatoire
À la fin de chaque session, **mettre à jour `NOTELO_ETAT_DES_LIEUX.md`** avec :
- Les nouvelles fonctionnalités ajoutées
- Les bugs corrigés
- L'état actuel des variables d'environnement
- La liste "Ce qui reste à faire" mise à jour
- La date de mise à jour

Puis **commit et push** le fichier mis à jour sur la branche de travail.

## Contexte projet
- **Produit** : Notelo — SaaS d'envoi de SMS automatiques pour collecter des avis Google
- **Domaine** : notelo.eu (PAS notelo.fr)
- **Backend** : Node.js/Express sur Render → repo `notelo68/notelo-server`
- **Frontend** : HTML/CSS sur Netlify → repo `notelo68/notelo` (accès restreint)
- **BDD** : Supabase PostgreSQL
- **Email** : Resend API
- **Paiements** : Stripe (live)
- **Branche de travail** : `claude/stripe-subscription-access-Aamo1`

## Admin secret
`notelo-admin-2025`

## Règles importantes
- Toujours utiliser **notelo.eu** (jamais notelo.fr)
- Ne jamais casser les routes existantes sans vérifier
- Tester le serveur avec `/admin/health` après chaque déploiement
- Le repo `notelo68/notelo` (frontend) n'est pas accessible via Claude Code MCP
