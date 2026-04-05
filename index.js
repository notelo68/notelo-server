require('dotenv').config();
const express    = require('express');
const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const Stripe     = require('stripe');
const nodemailer = require('nodemailer');

const app = express();

// ─── STRIPE (lazy init — ne crashe pas si la clé manque) ─────────────────────
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_REMPLACER') {
    return null;
  }
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

// ─── EMAIL VIA CLICKSEND (credentials déjà configurés) ───────────────────────
async function sendEmailViaClickSend({ to, subject, html }) {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey   = process.env.CLICKSEND_API_KEY;
  const fromEmail = process.env.EMAIL_USER || username;

  const response = await axios.post(
    'https://rest.clicksend.com/v3/email/send',
    {
      to:      [{ email: to, name: to }],
      from:    { email: fromEmail, name: 'Notelo' },
      subject,
      body:    html
    },
    {
      auth:    { username, password: apiKey },
      headers: { 'Content-Type': 'application/json' }
    }
  );
  return response.data;
}

// ─── EMAIL TRANSPORTER (Gmail — optionnel, fallback) ─────────────────────────
function getGmailTransporter() {
  if (!process.env.EMAIL_PASS || process.env.EMAIL_PASS === 'REMPLACER') return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
}

// ─── PERSISTANCE UTILISATEURS ────────────────────────────────────────────────
const USERS_FILE         = path.join(__dirname, 'users.json');
const PENDING_EMAILS_FILE = path.join(__dirname, 'pending-emails.json');

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Sauvegarde les identifiants en local si l'email ne part pas (rien n'est perdu)
function savePendingEmail({ email, password, portalUrl, reason }) {
  let pending = [];
  try {
    if (fs.existsSync(PENDING_EMAILS_FILE)) {
      pending = JSON.parse(fs.readFileSync(PENDING_EMAILS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  pending.push({ email, password, portalUrl, reason, savedAt: new Date().toISOString() });
  fs.writeFileSync(PENDING_EMAILS_FILE, JSON.stringify(pending, null, 2), 'utf8');
  console.log(`💾 Identifiants sauvegardés localement pour ${email} (email non envoyé : ${reason})`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let pwd = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
}

// ─── ENVOI D'EMAIL ────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ email, password, portalUrl }) {
  const transporter  = getGmailTransporter();
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://notelo.fr/dashboard';
  const loginUrl     = process.env.LOGIN_URL     || 'https://notelo.fr/login';

  const cancelSection = portalUrl
    ? `<p>Pour gérer ou <strong>annuler votre abonnement</strong>, cliquez ici :<br>
       <a href="${portalUrl}" style="color:#ef4444;">Gérer mon abonnement</a></p>`
    : `<p>Pour annuler votre abonnement, contactez-nous à <a href="mailto:${process.env.EMAIL_USER || 'contact@notelo.fr'}">${process.env.EMAIL_USER || 'contact@notelo.fr'}</a>.</p>`;

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
    <h1 style="color:#7c3aed;">Bienvenue sur Notelo !</h1>
    <p>Votre abonnement est actif. Voici vos identifiants de connexion :</p>

    <div style="background:#f5f3ff;border-left:4px solid #7c3aed;padding:16px;border-radius:8px;margin:24px 0;">
      <p style="margin:4px 0;"><strong>Email :</strong> ${email}</p>
      <p style="margin:4px 0;"><strong>Mot de passe :</strong>
        <code style="background:#e5e7eb;padding:2px 6px;border-radius:4px;">${password}</code>
      </p>
    </div>

    <p>
      <a href="${loginUrl}"
         style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">
        Accéder à mon Dashboard
      </a>
    </p>

    <p style="margin-top:32px;font-size:13px;color:#6b7280;">
      Pour des raisons de sécurité, changez votre mot de passe dès votre première connexion.
    </p>

    ${cancelSection}

    <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;">Équipe Notelo — <a href="https://notelo.fr">notelo.fr</a></p>
  </div>`;

  // 1. Essai via ClickSend (credentials déjà en place)
  try {
    await sendEmailViaClickSend({ to: email, subject: 'Vos identifiants Notelo', html });
    console.log(`📧 Email envoyé via ClickSend à ${email}`);
    return { sent: true, provider: 'clicksend' };
  } catch (clickErr) {
    console.warn(`⚠️  ClickSend email échoué : ${clickErr.response?.data?.response_msg || clickErr.message}`);
  }

  // 2. Fallback Gmail si configuré
  const gmailTransporter = getGmailTransporter();
  if (gmailTransporter) {
    try {
      await gmailTransporter.sendMail({
        from:    `"Notelo" <${process.env.EMAIL_USER}>`,
        to:      email,
        subject: 'Vos identifiants Notelo',
        html
      });
      console.log(`📧 Email envoyé via Gmail à ${email}`);
      return { sent: true, provider: 'gmail' };
    } catch (gmailErr) {
      console.error(`❌ Gmail aussi échoué : ${gmailErr.message}`);
      const reason = `Gmail: ${gmailErr.message}`;
      savePendingEmail({ email, password, portalUrl, reason });
      return { sent: false, reason };
    }
  }

  // 3. Sauvegarde locale — rien n'est perdu
  const reason = 'ClickSend et Gmail indisponibles';
  savePendingEmail({ email, password, portalUrl, reason });
  return { sent: false, reason };
}

// ─── LOGIQUE WEBHOOK ─────────────────────────────────────────────────────────
async function createUserAndSendEmail({ email, stripeCustomerId, stripeSubId }) {
  const users    = readUsers();
  const password = generatePassword();

  users[email] = {
    email,
    passwordHash:         hashPassword(password),
    stripeCustomerId:     stripeCustomerId || null,
    stripeSubscriptionId: stripeSubId      || null,
    subscriptionStatus:   'active',
    createdAt:            new Date().toISOString()
  };
  writeUsers(users);
  console.log(`✅ Utilisateur créé : ${email}`);

  // Lien portail Stripe pour gérer/annuler
  let portalUrl = null;
  const stripe = getStripe();
  if (stripe && stripeCustomerId) {
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer:   stripeCustomerId,
        return_url: process.env.DASHBOARD_URL || 'https://notelo.fr/dashboard'
      });
      portalUrl = portalSession.url;
    } catch (err) {
      console.warn('⚠️  Portail Stripe indisponible :', err.message);
    }
  }

  return sendWelcomeEmail({ email, password, portalUrl });
}

async function handleCheckoutCompleted(session) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) {
    console.error('❌ checkout.session.completed : aucun email trouvé.');
    return;
  }

  const users = readUsers();
  if (users[email]?.subscriptionStatus === 'active') {
    console.log(`ℹ️  ${email} est déjà actif.`);
    return;
  }

  await createUserAndSendEmail({
    email,
    stripeCustomerId: session.customer,
    stripeSubId:      session.subscription
  });
}

function handleSubscriptionDeleted(subscription) {
  const users = readUsers();
  const user  = Object.values(users).find(u => u.stripeSubscriptionId === subscription.id);
  if (user) {
    user.subscriptionStatus = 'cancelled';
    writeUsers(users);
    console.log(`🚫 Abonnement annulé pour ${user.email}`);
  }
}

function handleInvoicePaymentSucceeded(invoice) {
  if (invoice.billing_reason === 'subscription_create') return;
  const users = readUsers();
  const user  = Object.values(users).find(u => u.stripeCustomerId === invoice.customer);
  if (user && user.subscriptionStatus !== 'active') {
    user.subscriptionStatus = 'active';
    writeUsers(users);
    console.log(`🔄 Abonnement réactivé pour ${user.email}`);
  }
}

// ─── STRIPE WEBHOOK — AVANT express.json() ───────────────────────────────────
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig    = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret || secret === 'whsec_REMPLACER') {
      console.error('❌ STRIPE_WEBHOOK_SECRET non configuré.');
      return res.status(500).send('Webhook secret manquant.');
    }

    let event;
    try {
      event = Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error(`⚠️  Webhook signature invalide : ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed')    await handleCheckoutCompleted(event.data.object);
    if (event.type === 'customer.subscription.deleted')       handleSubscriptionDeleted(event.data.object);
    if (event.type === 'invoice.payment_succeeded')           handleInvoicePaymentSucceeded(event.data.object);

    return res.json({ received: true });
  }
);

// ─── MIDDLEWARES GLOBAUX ──────────────────────────────────────────────────────
app.use(express.json());

// ─── MIDDLEWARE AUTH ADMIN ────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  const token  = req.headers['x-admin-secret'] || req.query.secret;
  if (!secret || token !== secret) {
    return res.status(401).json({ success: false, error: 'Non autorisé.' });
  }
  next();
}

// ─── ROUTES ADMIN (exclues de la maintenance) ─────────────────────────────────

// GET /admin/health — vérifie la config
app.get('/admin/health', requireAdmin, (req, res) => {
  const stripe      = getStripe();
  const transporter = getGmailTransporter();
  const users       = readUsers();

  res.json({
    status:      'ok',
    maintenance: process.env.MAINTENANCE_MODE === 'true',
    stripe: {
      configured: !!stripe,
      keyPrefix:  process.env.STRIPE_SECRET_KEY?.slice(0, 8) || 'manquant',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET !== 'whsec_REMPLACER' && !!process.env.STRIPE_WEBHOOK_SECRET
    },
    email: {
      configured: !!transporter,
      user:       process.env.EMAIL_USER || 'manquant'
    },
    users: {
      total:  Object.keys(users).length,
      active: Object.values(users).filter(u => u.subscriptionStatus === 'active').length
    }
  });
});

// GET /admin/users — liste des utilisateurs
app.get('/admin/users', requireAdmin, (req, res) => {
  const users = readUsers();
  // Ne renvoie pas les hash de mots de passe
  const safe = Object.values(users).map(({ passwordHash, ...rest }) => rest);
  res.json({ success: true, count: safe.length, users: safe });
});

// POST /admin/send-welcome-email — envoie manuellement les identifiants
// Usage : { "email": "client@example.com", "stripeCustomerId": "cus_xxx" (optionnel) }
app.post('/admin/send-welcome-email', requireAdmin, async (req, res) => {
  const { email, stripeCustomerId } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'email requis.' });

  const result = await createUserAndSendEmail({
    email:            email.toLowerCase().trim(),
    stripeCustomerId: stripeCustomerId || null,
    stripeSubId:      null
  });

  res.json({ success: true, email, emailResult: result });
});

// GET /admin/pending-emails — identifiants en attente (email non envoyé)
app.get('/admin/pending-emails', requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(PENDING_EMAILS_FILE)) return res.json({ success: true, count: 0, pending: [] });
    const pending = JSON.parse(fs.readFileSync(PENDING_EMAILS_FILE, 'utf8'));
    res.json({ success: true, count: pending.length, pending });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /admin/retry-pending-emails — renvoie tous les emails en attente
app.post('/admin/retry-pending-emails', requireAdmin, async (req, res) => {
  try {
    if (!fs.existsSync(PENDING_EMAILS_FILE)) return res.json({ success: true, message: 'Aucun email en attente.' });
    const pending = JSON.parse(fs.readFileSync(PENDING_EMAILS_FILE, 'utf8'));
    if (pending.length === 0) return res.json({ success: true, message: 'Aucun email en attente.' });

    const results = [];
    const remaining = [];

    for (const entry of pending) {
      const result = await sendWelcomeEmail({
        email:     entry.email,
        password:  entry.password,
        portalUrl: entry.portalUrl
      });
      results.push({ email: entry.email, ...result });
      if (!result.sent) remaining.push(entry); // garde ceux qui ont encore échoué
    }

    fs.writeFileSync(PENDING_EMAILS_FILE, JSON.stringify(remaining, null, 2), 'utf8');
    res.json({ success: true, results, stillPending: remaining.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /admin/maintenance — active/désactive la maintenance à chaud
app.post('/admin/maintenance', requireAdmin, (req, res) => {
  const { enabled } = req.body;
  process.env.MAINTENANCE_MODE = enabled ? 'true' : 'false';
  console.log(`🔧 Maintenance : ${enabled ? 'activée' : 'désactivée'}`);
  res.json({ success: true, maintenance: enabled });
});

// ─── MODE MAINTENANCE (après les routes admin) ────────────────────────────────
app.use((req, res, next) => {
  if (process.env.MAINTENANCE_MODE !== 'true') return next();

  res.status(503).set('Retry-After', '3600').send(`
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Maintenance — Notelo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f3ff;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 48px 40px;
      max-width: 480px; width: 100%; text-align: center;
      box-shadow: 0 4px 24px rgba(124,58,237,.12);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #7c3aed; font-size: 24px; margin-bottom: 12px; }
    p  { color: #6b7280; line-height: 1.6; margin-bottom: 8px; }
    a  { color: #7c3aed; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔧</div>
    <h1>Maintenance en cours</h1>
    <p>Notelo est temporairement indisponible pour des opérations de maintenance.</p>
    <p>Nous serons de retour très bientôt. Merci pour votre patience !</p>
    <p style="margin-top:24px;font-size:13px;">
      Besoin d'aide ? <a href="mailto:${process.env.EMAIL_USER || 'contact@notelo.fr'}">${process.env.EMAIL_USER || 'contact@notelo.fr'}</a>
    </p>
  </div>
</body>
</html>`);
});

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── CANCEL SUBSCRIPTION ─────────────────────────────────────────────────────
app.post('/cancel-subscription', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email requis.' });

  const users = readUsers();
  const user  = users[email?.toLowerCase().trim()];

  if (!user) return res.status(404).json({ success: false, error: 'Aucun abonnement trouvé pour cet email.' });
  if (!user.stripeCustomerId) return res.status(400).json({ success: false, error: 'Aucun client Stripe associé.' });

  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe non configuré.' });

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   user.stripeCustomerId,
      return_url: process.env.DASHBOARD_URL || 'https://notelo.fr/dashboard'
    });
    return res.json({ success: true, url: portalSession.url });
  } catch (err) {
    console.error('Erreur portail Stripe :', err.message);
    return res.status(500).json({ success: false, error: 'Impossible de générer le lien de gestion.' });
  }
});

// ─── REDIRECT APRÈS PAIEMENT ──────────────────────────────────────────────────
app.get('/payment-success', (req, res) => {
  const loginUrl = process.env.LOGIN_URL || 'https://notelo.fr/login';
  res.redirect(302, loginUrl);
});

// ─── LIENS RACCOURCIS ─────────────────────────────────────────────────────────
const LINKS_FILE = path.join(__dirname, 'links.json');

function readLinks() {
  try {
    if (!fs.existsSync(LINKS_FILE)) return {};
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function writeLinks(links) {
  fs.writeFileSync(LINKS_FILE, JSON.stringify(links, null, 2), 'utf8');
}

function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'URL invalide' });
  }

  const links    = readLinks();
  const BASE_URL = process.env.BASE_URL || 'https://notelo-server.onrender.com';
  const existing = Object.entries(links).find(([, data]) => data.url === url);
  if (existing) return res.json({ success: true, short: `${BASE_URL}/r/${existing[0]}` });

  let code;
  do { code = generateCode(); } while (links[code]);

  links[code] = { url, createdAt: new Date().toISOString() };
  writeLinks(links);

  console.log(`🔗 Raccourci : ${BASE_URL}/r/${code} → ${url}`);
  return res.status(201).json({ success: true, short: `${BASE_URL}/r/${code}` });
});

app.get('/r/:code', (req, res) => {
  const links = readLinks();
  const data  = links[req.params.code];
  if (!data) return res.status(404).send('Lien introuvable ou expiré.');
  return res.redirect(301, data.url);
});

// ─── MESSAGES ─────────────────────────────────────────────────────────────────
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

function readMessages() {
  try {
    if (!fs.existsSync(MESSAGES_FILE)) return [];
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  } catch (e) { return []; }
}

function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

app.post('/send-sms', async (req, res) => {
  const { prenom, telephone, nomPro, lienGoogle } = req.body;
  if (!prenom || !telephone || !nomPro || !lienGoogle) {
    return res.status(400).json({ success: false, error: 'Champs manquants : prenom, telephone, nomPro, lienGoogle requis.' });
  }

  const message = `Bonjour ${prenom}, merci pour votre visite chez ${nomPro} ! Pouvez-vous nous laisser un avis Google ? ${lienGoogle} - STOP SMS`;
  try {
    const response = await axios.post(
      'https://rest.clicksend.com/v3/sms/send',
      { messages: [{ to: telephone, body: message, source: 'nodejs' }] },
      {
        auth:    { username: process.env.CLICKSEND_USERNAME, password: process.env.CLICKSEND_API_KEY },
        headers: { 'Content-Type': 'application/json' }
      }
    );
    const messageData = response.data?.data?.messages?.[0];
    if (messageData?.status === 'SUCCESS') {
      return res.status(200).json({ success: true, message: 'SMS envoyé avec succès.', details: messageData });
    }
    return res.status(502).json({ success: false, error: 'ClickSend a retourné un statut inattendu.', details: messageData });
  } catch (err) {
    return res.status(500).json({ success: false, error: "Erreur lors de l'envoi du SMS.", details: err.response?.data || err.message });
  }
});

app.post('/messages', (req, res) => {
  const { from, fromName, fromBusiness, subject, content, timestamp } = req.body;
  if (!from || !subject || !content) {
    return res.status(400).json({ success: false, error: 'Champs manquants : from, subject, content requis.' });
  }
  const message = {
    id: Date.now().toString(), from: from.toLowerCase().trim(),
    fromName: fromName || from, fromBusiness: fromBusiness || '',
    subject: subject.trim(), content: content.trim(),
    timestamp: timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString()
  };
  const messages = readMessages();
  messages.unshift(message);
  writeMessages(messages);
  console.log(`📩 Nouveau message de ${message.fromName} (${message.from}) — "${message.subject}"`);
  return res.status(201).json({ success: true, id: message.id });
});

app.get('/messages', (req, res) => {
  if (req.query.admin !== '1') return res.status(403).json({ success: false, error: 'Accès refusé.' });
  return res.status(200).json(readMessages());
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  const maintenance = process.env.MAINTENANCE_MODE === 'true' ? ' [MAINTENANCE]' : '';
  console.log(`🚀 Serveur démarré sur le port 3000${maintenance}`);
});
