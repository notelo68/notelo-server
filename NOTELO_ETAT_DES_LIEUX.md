# Notelo — État des lieux complet
*Document de contexte pour session Claude — Avril 2026*

---

## 1. C'est quoi Notelo ?

**Notelo** est un SaaS B2B qui aide les commerces locaux (garages, restaurants, coiffeurs, etc.) à collecter automatiquement des avis Google.

**Fonctionnement :**
1. Le professionnel entre le prénom + téléphone de son client dans le dashboard Notelo
2. Notelo envoie automatiquement un SMS personnalisé avec un lien direct vers la fiche Google
3. Le client laisse un avis en 30 secondes
4. La note Google du professionnel monte

**Domaine :** notelo.eu  
**Phase actuelle :** Bêta — 20 premiers clients à -30% à vie  

---

## 2. Stack technique

| Composant | Technologie | URL / Info |
|---|---|---|
| Landing page | HTML/CSS statique | notelo.eu (repo `notelo68/notelo`) |
| App / Dashboard | HTML/CSS (frontend) | notelo.eu/login.html |
| Backend serveur | Node.js + Express | notelo-server.onrender.com |
| Base de données | Supabase (PostgreSQL) | yynlliuikeagpvvxdyif.supabase.co |
| Paiements | Stripe (live) | Abonnements récurrents |
| Email | Resend API | depuis onboarding@resend.dev (temporaire) |
| SMS | OVH SMS API | Pour l'envoi des SMS aux clients |
| Hébergement backend | Render (free plan) | Auto-sleep après inactivité |
| Hébergement frontend | Netlify | Connecté au repo `notelo68/notelo` |
| DNS / Domaine | OVH | notelo.eu |

---

## 3. Repos GitHub

| Repo | Contenu | Branche de travail |
|---|---|---|
| `notelo68/notelo-server` | Backend Node.js | `claude/stripe-subscription-access-Aamo1` |
| `notelo68/notelo` | Landing page + App frontend | `main` (accès non configuré pour Claude Code) |

> ⚠️ Claude Code n'a accès qu'au repo `notelo68/notelo-server`. Pour modifier la landing page ou le dashboard, il faut passer par GitHub directement ou configurer l'accès.

---

## 4. Ce qui a été fait (session actuelle)

### ✅ Système d'abonnement complet
- Webhook Stripe → `POST /webhook/stripe`
- À chaque paiement (`checkout.session.completed`) : création automatique du compte utilisateur + envoi email avec code d'accès
- Format du code d'accès : `NOTELO-XXXX` (compatible avec la page login)
- Gestion des annulations (`customer.subscription.deleted`)
- Gestion des renouvellements (`invoice.payment_succeeded`)

### ✅ Email de bienvenue
- Envoi via **Resend API** (HTTP, non bloqué par Render)
- Design aux couleurs Notelo : fond sombre, accent teal (#4fd1c5)
- Contient : email + code d'accès `NOTELO-XXXX` + bouton "Accéder au Dashboard"
- Lien "Gérer mon abonnement" via Stripe Customer Portal (annulation en self-service)
- Fallback : si email échoue → sauvegarde dans table `pending_emails` (Supabase)

### ✅ Base de données Supabase
- Remplacement du fichier `users.json` (perdu à chaque redéploiement) par Supabase PostgreSQL
- **Table `users`** : id, email, password_hash, stripe_customer_id, stripe_subscription_id, subscription_status, created_at
- **Table `pending_emails`** : id, email, password, portal_url, reason, saved_at
- Données persistantes même après redéploiement Render

### ✅ Routes admin (protégées par `x-admin-secret: notelo-admin-2025`)
| Route | Usage |
|---|---|
| `GET /admin/health` | Vérifier l'état du serveur (Stripe, email, BDD) |
| `GET /admin/users` | Lister tous les abonnés |
| `POST /admin/send-welcome-email` | Envoyer manuellement les identifiants à un email |
| `GET /admin/pending-emails` | Voir les emails non envoyés (avec mots de passe) |
| `POST /admin/retry-pending-emails` | Renvoyer tous les emails en attente |
| `POST /admin/maintenance` | Activer/désactiver la maintenance sans redéployer |

### ✅ Redirect après paiement
- `GET /payment-success` → redirige vers `notelo.eu/login.html`
- À configurer comme `success_url` dans Stripe Checkout

### ✅ Annulation d'abonnement
- `POST /cancel-subscription` avec `{ email }` → renvoie lien Stripe Customer Portal
- Le client peut annuler en self-service

---

## 5. Variables d'environnement (Render)

| Variable | Valeur | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_...` | ✅ Configuré |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | ✅ Configuré |
| `RESEND_API_KEY` | `re_axu3mV8y_...` | ✅ Configuré |
| `RESEND_FROM` | `onboarding@resend.dev` | ⚠️ Temporaire |
| `SUPABASE_URL` | `https://yynlliuikeagpvvxdyif.supabase.co` | ✅ Configuré |
| `SUPABASE_ANON_KEY` | `eyJhbGci...` | ✅ Configuré |
| `ADMIN_SECRET` | `notelo-admin-2025` | ✅ Configuré |
| `LOGIN_URL` | `https://notelo.eu/login.html` | ✅ Configuré |
| `DASHBOARD_URL` | `https://notelo.eu/login.html` | ✅ Configuré |
| `MAINTENANCE_MODE` | `false` | ✅ Configuré |
| `OVH_APP_KEY` | `7fb88ee9...` | ✅ Configuré |
| `OVH_APP_SECRET` | `c692012d...` | ✅ Configuré |
| `OVH_CONSUMER_KEY` | `5e375b3d...` | ⚠️ À vérifier (403 en cours) |

---

## 6. Webhook Stripe configuré

- **URL** : `https://notelo-server.onrender.com/webhook/stripe`
- **Événements** : `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_succeeded`
- **Signing secret** : configuré dans `STRIPE_WEBHOOK_SECRET`

---

## 7. Ce qui reste à faire

### 🔴 Important
1. **Fixer OVH SMS 403** : L'API OVH retourne une erreur 403. Cause probable = Consumer Key pas validée (OVH envoie un lien de validation après création du token). Solution : aller sur https://eu.api.ovh.com/createToken et créer un nouveau token avec ces droits :
   - `GET /sms` 
   - `GET /sms/*`
   - `POST /sms/*/jobs`
   Puis mettre à jour `OVH_CONSUMER_KEY` sur Render. Route de diagnostic disponible : `GET /admin/test-ovh`

2. **Email pro** : configurer `contact@notelo.eu` sur OVH → vérifier le domaine `notelo.eu` sur Resend → changer `RESEND_FROM` à `contact@notelo.eu` sur Render. Actuellement les emails partent depuis `onboarding@resend.dev`.

3. **Tester un vrai paiement** de bout en bout : payer → recevoir l'email → se connecter au dashboard avec le code `NOTELO-XXXX`.

4. **Configurer `success_url` dans Stripe** : dans le Stripe Dashboard, le lien de paiement doit rediriger vers `https://notelo-server.onrender.com/payment-success` après paiement.

### 🟡 Moyen terme
5. **Section contact** sur la landing page `notelo.eu` : formulaire qui envoie les messages à `appdcontactpro@gmail.com` (temporaire) puis `contact@notelo.eu`.

6. **Upgrade Render** : le plan gratuit met le serveur en veille après 15 min d'inactivité → délai de 50-60 sec au réveil. Pour la prod, passer au plan payant ($7/mois).

7. **Dashboard client** : ce que les utilisateurs voient après connexion (envoyer des SMS, voir les stats, historique).

### 🟢 Plus tard
8. **Vrai système d'authentification** : actuellement le code `NOTELO-XXXX` est stocké hashé en BDD mais la vérification côté login n'est pas encore connectée au backend.

9. **Historique SMS** : table Supabase pour tracker les SMS envoyés par chaque client.

---

## 8. Parcours client actuel

```
Client voit notelo.eu
        ↓
Clique "Commencer" → Page Stripe (paiement)
        ↓
Paiement validé → Stripe envoie webhook au serveur
        ↓
Serveur crée compte dans Supabase + génère NOTELO-XXXX
        ↓
Email envoyé via Resend avec les identifiants
        ↓
Client redirigé vers notelo.eu/login.html
        ↓
Client entre email + NOTELO-XXXX → accès dashboard
        ↓
Client peut envoyer des SMS depuis le dashboard
```

---

## 9. Commandes utiles (admin)

```bash
# Vérifier l'état du serveur
curl https://notelo-server.onrender.com/admin/health \
  -H "x-admin-secret: notelo-admin-2025"

# Envoyer manuellement les identifiants à un client
curl -X POST https://notelo-server.onrender.com/admin/send-welcome-email \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: notelo-admin-2025" \
  -d '{"email": "client@example.com"}'

# Voir les emails non envoyés
curl https://notelo-server.onrender.com/admin/pending-emails \
  -H "x-admin-secret: notelo-admin-2025"

# Lister tous les abonnés
curl https://notelo-server.onrender.com/admin/users \
  -H "x-admin-secret: notelo-admin-2025"

# Activer la maintenance
curl -X POST https://notelo-server.onrender.com/admin/maintenance \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: notelo-admin-2025" \
  -d '{"enabled": true}'
```

---

---

## 10. Historique des sessions

### Session 06/04/2026
- Mise en place complète du système d'abonnement Stripe + webhook
- Email de bienvenue avec code `NOTELO-XXXX` via Resend
- Migration `users.json` → Supabase PostgreSQL
- Routes admin (health, users, send-welcome-email, pending-emails, maintenance)
- Redirect après paiement vers `notelo.eu/login.html`
- Annulation abonnement via Stripe Customer Portal
- Création `CLAUDE.md` pour mise à jour automatique du doc

### Session 10/04/2026
- Remplacement ClickSend par OVH SMS API (`POST /send-sms`)
- Amélioration capture d'erreur OVH : affiche maintenant `HTTP 403 — <corps>` au lieu de juste `403`
- Ajout route `GET /admin/test-ovh` pour diagnostiquer la connexion OVH pas à pas
- Refactoring : helpers `getOvhClient()` et `ovhRequest()` pour réutilisation
- Mise à jour de la documentation (ClickSend → OVH, variables d'env)
- **Bug en cours** : OVH retourne 403 — Consumer Key probablement pas validée

*Dernière mise à jour : 10/04/2026*
