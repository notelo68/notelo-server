require('dotenv').config();
const express    = require('express');
const axios      = require('axios');
const crypto     = require('crypto');
const fs         = require('fs');
const path       = require('path');
const Stripe     = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── STRIPE (lazy init) ───────────────────────────────────────────────────────
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_REMPLACER') return null;
  return Stripe(process.env.STRIPE_SECRET_KEY);
}

// ─── EMAIL VIA RESEND ─────────────────────────────────────────────────────────
async function sendEmailViaResend({ to, subject, html }) {
  const apiKey    = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
  if (!apiKey || apiKey === 'REMPLACER') throw new Error('RESEND_API_KEY non configuré');
  const response = await axios.post(
    'https://api.resend.com/emails',
    { from: `Notelo <${fromEmail}>`, to: [to], subject, html },
    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  );
  return response.data;
}

// ─── PERSISTANCE UTILISATEURS (Supabase) ──────────────────────────────────────
async function getUserByEmail(email) {
  const { data } = await supabase.from('users').select('*').eq('email', email).single();
  return data;
}

async function createUser({ email, passwordHash, stripeCustomerId, stripeSubId }) {
  const { data, error } = await supabase.from('users').insert([{
    email,
    password_hash:          passwordHash,
    stripe_customer_id:     stripeCustomerId || null,
    stripe_subscription_id: stripeSubId      || null,
    subscription_status:    'active'
  }]).select().single();
  if (error) throw error;
  return data;
}

async function updateUserStatus(field, value, status) {
  const { error } = await supabase.from('users')
    .update({ subscription_status: status })
    .eq(field, value);
  if (error) console.error('Erreur update user:', error.message);
}

async function savePendingEmail({ email, password, portalUrl, reason }) {
  await supabase.from('pending_emails').insert([{ email, password, portal_url: portalUrl, reason }]);
  console.log(`💾 Email en attente sauvegardé pour ${email}`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  const bytes = crypto.randomBytes(4);
  for (let i = 0; i < 4; i++) suffix += chars[bytes[i] % chars.length];
  return `NOTELO-${suffix}`;
}

// ─── ENVOI D'EMAIL ────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ email, password, portalUrl }) {
  const dashboardUrl = process.env.DASHBOARD_URL || 'https://notelo.eu/dashboard';
  const loginUrl     = process.env.LOGIN_URL     || 'https://notelo.eu/login';

  const supportEmail = process.env.EMAIL_USER || 'contact@notelo.eu';

  const cancelSection = portalUrl
    ? `<p style="margin:0;font-size:14px;color:#a0aec0;">Pour gérer ou annuler votre abonnement : <a href="${portalUrl}" style="color:#4fd1c5;text-decoration:none;font-weight:600;">Gérer mon abonnement</a></p>`
    : `<p style="margin:0;font-size:14px;color:#a0aec0;">Pour annuler votre abonnement, contactez-nous : <a href="mailto:${supportEmail}" style="color:#4fd1c5;text-decoration:none;">${supportEmail}</a></p>`;

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- HEADER -->
        <tr><td style="padding-bottom:32px;text-align:center;">
          <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-1px;">note<span style="color:#4fd1c5;">l</span>o</span>
        </td></tr>

        <!-- CARD -->
        <tr><td style="background:#1a1a1a;border-radius:16px;padding:40px 36px;">

          <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#ffffff;">Bienvenue sur Notelo !</h1>
          <p style="margin:0 0 32px;font-size:15px;color:#a0aec0;line-height:1.6;">Votre abonnement est actif. Voici vos identifiants pour accéder à votre dashboard.</p>

          <!-- IDENTIFIANTS -->
          <div style="background:#111111;border:1px solid #2d2d2d;border-radius:12px;padding:24px;margin-bottom:32px;">
            <p style="margin:0 0 12px;font-size:13px;font-weight:600;color:#4fd1c5;text-transform:uppercase;letter-spacing:1px;">Vos identifiants</p>
            <p style="margin:0 0 8px;font-size:14px;color:#a0aec0;">Email : <span style="color:#ffffff;font-weight:500;">${email}</span></p>
            <p style="margin:0;font-size:14px;color:#a0aec0;">Code d'accès : <span style="color:#ffffff;font-weight:700;font-size:18px;letter-spacing:2px;font-family:monospace;">${password}</span></p>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin-bottom:32px;">
            <a href="${loginUrl}" style="display:inline-block;background:#4fd1c5;color:#0f0f0f;font-weight:700;font-size:15px;padding:14px 36px;border-radius:8px;text-decoration:none;">
              Accéder à mon Dashboard →
            </a>
          </div>

          <!-- ANNULATION -->
          <div style="border-top:1px solid #2d2d2d;padding-top:24px;">
            ${cancelSection}
          </div>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding-top:24px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#4a4a4a;">
            © 2025 Notelo — <a href="https://notelo.eu" style="color:#4a4a4a;text-decoration:none;">notelo.eu</a>
            &nbsp;·&nbsp;
            <a href="mailto:${supportEmail}" style="color:#4a4a4a;text-decoration:none;">Support</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // 1. Resend (HTTP API — pas bloqué par les hébergeurs)
  try {
    await sendEmailViaResend({ to: email, subject: 'Vos identifiants Notelo', html });
    console.log(`📧 Email envoyé via Resend à ${email}`);
    return { sent: true, provider: 'resend' };
  } catch (resendErr) {
    const errMsg = resendErr.response?.data?.message || resendErr.message;
    console.warn(`⚠️  Resend échoué : ${errMsg}`);
    const reason = `Resend: ${errMsg}`;
    savePendingEmail({ email, password, portalUrl, reason });
    return { sent: false, reason };
  }
}

// ─── LOGIQUE WEBHOOK ─────────────────────────────────────────────────────────
async function createUserAndSendEmail({ email, stripeCustomerId, stripeSubId }) {
  const password = generatePassword();

  await createUser({ email, passwordHash: hashPassword(password), stripeCustomerId, stripeSubId });
  console.log(`✅ Utilisateur créé : ${email}`);

  let portalUrl = null;
  const stripe = getStripe();
  if (stripe && stripeCustomerId) {
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer:   stripeCustomerId,
        return_url: process.env.DASHBOARD_URL || 'https://notelo.eu/login.html'
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
  if (!email) { console.error('❌ Aucun email dans la session.'); return; }

  const existing = await getUserByEmail(email);
  if (existing?.subscription_status === 'active') {
    console.log(`ℹ️  ${email} déjà actif.`); return;
  }

  await createUserAndSendEmail({ email, stripeCustomerId: session.customer, stripeSubId: session.subscription });
}

async function handleSubscriptionDeleted(subscription) {
  await updateUserStatus('stripe_subscription_id', subscription.id, 'cancelled');
  console.log(`🚫 Abonnement annulé : ${subscription.id}`);
}

async function handleInvoicePaymentSucceeded(invoice) {
  if (invoice.billing_reason === 'subscription_create') return;
  await updateUserStatus('stripe_customer_id', invoice.customer, 'active');
  console.log(`🔄 Abonnement réactivé : ${invoice.customer}`);
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
app.get('/admin/health', requireAdmin, async (req, res) => {
  const stripe = getStripe();
  const users  = readUsers();

  res.json({
    status:      'ok',
    maintenance: process.env.MAINTENANCE_MODE === 'true',
    stripe: {
      configured: !!stripe,
      keyPrefix:  process.env.STRIPE_SECRET_KEY?.slice(0, 8) || 'manquant',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET !== 'whsec_REMPLACER' && !!process.env.STRIPE_WEBHOOK_SECRET
    },
    email: {
      configured: !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'REMPLACER'),
      provider:   'resend',
      from:       process.env.RESEND_FROM || 'onboarding@resend.dev'
    },
    users: await supabase.from('users').select('id', { count: 'exact', head: true })
      .then(({ count }) => ({ total: count || 0 }))
  });
});

// GET /admin/users — liste des utilisateurs
app.get('/admin/users', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('users')
    .select('id, email, stripe_customer_id, stripe_subscription_id, subscription_status, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, count: data.length, users: data });
});

// POST /admin/send-welcome-email
app.post('/admin/send-welcome-email', requireAdmin, async (req, res) => {
  const { email, stripeCustomerId } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'email requis.' });

  const result = await createUserAndSendEmail({
    email: email.toLowerCase().trim(),
    stripeCustomerId: stripeCustomerId || null,
    stripeSubId: null
  });

  res.json({ success: true, email, emailResult: result });
});

// GET /admin/pending-emails
app.get('/admin/pending-emails', requireAdmin, async (req, res) => {
  const { data, error } = await supabase.from('pending_emails').select('*').order('saved_at', { ascending: false });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, count: data.length, pending: data });
});

// POST /admin/retry-pending-emails
app.post('/admin/retry-pending-emails', requireAdmin, async (req, res) => {
  const { data: pending, error } = await supabase.from('pending_emails').select('*');
  if (error) return res.status(500).json({ success: false, error: error.message });
  if (!pending?.length) return res.json({ success: true, message: 'Aucun email en attente.' });

  const results = [];
  for (const entry of pending) {
    const result = await sendWelcomeEmail({ email: entry.email, password: entry.password, portalUrl: entry.portal_url });
    results.push({ email: entry.email, ...result });
    if (result.sent) await supabase.from('pending_emails').delete().eq('id', entry.id);
  }

  res.json({ success: true, results });
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
      Besoin d'aide ? <a href="mailto:${process.env.EMAIL_USER || 'contact@notelo.eu'}">${process.env.EMAIL_USER || 'contact@notelo.eu'}</a>
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

  const user = await getUserByEmail(email.toLowerCase().trim());

  if (!user) return res.status(404).json({ success: false, error: 'Aucun abonnement trouvé pour cet email.' });
  if (!user.stripe_customer_id) return res.status(400).json({ success: false, error: 'Aucun client Stripe associé.' });

  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ success: false, error: 'Stripe non configuré.' });

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   user.stripe_customer_id,
      return_url: process.env.DASHBOARD_URL || 'https://notelo.eu/login.html'
    });
    return res.json({ success: true, url: portalSession.url });
  } catch (err) {
    console.error('Erreur portail Stripe :', err.message);
    return res.status(500).json({ success: false, error: 'Impossible de générer le lien de gestion.' });
  }
});

// ─── REDIRECT APRÈS PAIEMENT ──────────────────────────────────────────────────
app.get('/payment-success', (req, res) => {
  const loginUrl = process.env.LOGIN_URL || 'https://notelo.eu/login';
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
