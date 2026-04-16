require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── BREVO ───
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER  = process.env.BREVO_SENDER || 'Notelo';

// ─── STRIPE WEBHOOK (raw body — doit être AVANT express.json) ───
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Signature webhook invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email   = session.customer_email || session.customer_details?.email;
    const amount  = session.amount_total; // centimes

    const planKey = amount <= 2900 ? 'starter' : amount <= 4900 ? 'pro' : 'business';
    const plans = {
      starter:  { name: 'Starter',  limit: '50 SMS/mois',   price: '29€' },
      pro:      { name: 'Pro',      limit: '200 SMS/mois',  price: '49€' },
      business: { name: 'Business', limit: 'SMS illimités', price: '89€' }
    };
    const plan = plans[planKey];

    console.log(`💳 Paiement confirmé pour ${email} — plan ${planKey} (${amount / 100}€)`);

    // Email de bienvenue via Brevo
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender:      { name: 'Notelo', email: 'contact@notelo.eu' },
        to:          [{ email }],
        subject:     `Bienvenue sur Notelo ${plan.name} !`,
        htmlContent: `
          <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px">
            <h2 style="color:#7c3aed">Bienvenue sur Notelo ${plan.name} !</h2>
            <p>Votre abonnement est actif. Vous bénéficiez de <strong>${plan.limit}</strong> pour <strong>${plan.price}/mois</strong>.</p>
            <a href="https://notelo.eu/dashboard.html"
               style="display:inline-block;margin-top:16px;padding:12px 24px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none">
              Accéder au tableau de bord →
            </a>
            <p style="margin-top:32px;color:#888;font-size:13px">
              Des questions ? <a href="mailto:contact@notelo.eu">contact@notelo.eu</a>
            </p>
          </div>
        `
      }, {
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
      });
      console.log(`📧 Email de bienvenue envoyé à ${email}`);
    } catch (err) {
      console.error('❌ Erreur email Brevo:', err.response?.data || err.message);
    }
  }

  res.json({ received: true });
});

// ─── MIDDLEWARES ───
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── PAGE BIENVENUE (après paiement Stripe) ───
app.get('/bienvenue', (req, res) => {
  const planKey = req.query.plan || 'pro';
  const plans = {
    starter:  { name: 'Starter',  limit: '50 SMS/mois',   emoji: '🚀', color: '#6366f1' },
    pro:      { name: 'Pro',      limit: '200 SMS/mois',  emoji: '⚡', color: '#7c3aed' },
    business: { name: 'Business', limit: 'SMS illimités', emoji: '🏢', color: '#0ea5e9' }
  };
  const p = plans[planKey] || plans.pro;

  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bienvenue sur Notelo ${p.name} !</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      background:linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%);
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:24px;
    }
    .card {
      background:#fff;
      border-radius:20px;
      padding:48px 40px;
      max-width:520px;
      width:100%;
      text-align:center;
      box-shadow:0 20px 60px rgba(124,58,237,0.12);
    }
    .emoji { font-size:64px; margin-bottom:16px; }
    .badge {
      display:inline-block;
      background:${p.color}18;
      color:${p.color};
      border:1px solid ${p.color}40;
      border-radius:999px;
      padding:6px 18px;
      font-size:14px;
      font-weight:600;
      margin-bottom:24px;
    }
    h1 { font-size:28px; color:#1e1b4b; margin-bottom:12px; }
    .desc { color:#6b7280; line-height:1.6; margin-bottom:8px; }
    .highlight { color:${p.color}; font-weight:700; font-size:18px; margin:8px 0; }
    .cta {
      display:inline-block;
      margin-top:32px;
      padding:14px 32px;
      background:${p.color};
      color:#fff;
      border-radius:12px;
      text-decoration:none;
      font-weight:600;
      font-size:16px;
    }
    .footer { margin-top:28px; font-size:13px; color:#9ca3af; }
    .footer a { color:${p.color}; text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="emoji">${p.emoji}</div>
    <div class="badge">Plan ${p.name} activé</div>
    <h1>Bienvenue sur Notelo !</h1>
    <p class="desc">Votre abonnement est actif. Vous disposez de</p>
    <p class="highlight">${p.limit}</p>
    <p class="desc">Un email de confirmation vous a été envoyé.</p>
    <a href="https://notelo.eu/dashboard.html" class="cta">Accéder au tableau de bord →</a>
    <div class="footer">
      Une question ? <a href="mailto:contact@notelo.eu">contact@notelo.eu</a>
    </div>
  </div>
</body>
</html>`);
});

// ─── PERSISTANCE LIENS RACCOURCIS ───
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

// POST /shorten — raccourcit une URL
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'URL invalide' });
  }

  const links = readLinks();
  const BASE_URL = process.env.BASE_URL || 'https://notelo-server.onrender.com';

  const existing = Object.entries(links).find(([, data]) => data.url === url);
  if (existing) {
    return res.json({ success: true, short: `${BASE_URL}/r/${existing[0]}` });
  }

  let code;
  do { code = generateCode(); } while (links[code]);

  links[code] = { url, createdAt: new Date().toISOString() };
  writeLinks(links);

  console.log(`🔗 Raccourci : ${BASE_URL}/r/${code} → ${url}`);
  return res.status(201).json({ success: true, short: `${BASE_URL}/r/${code}` });
});

// GET /r/:code — redirection vers l'URL originale
app.get('/r/:code', (req, res) => {
  const links = readLinks();
  const data = links[req.params.code];
  if (!data) return res.status(404).send('Lien introuvable ou expiré.');
  return res.redirect(301, data.url);
});

// ─── PERSISTANCE MESSAGES (fichier JSON local) ───
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

// ─── POST /send-sms ───
app.post('/send-sms', async (req, res) => {
  const { prenom, telephone, nomPro, lienGoogle } = req.body;

  if (!prenom || !telephone || !nomPro || !lienGoogle) {
    return res.status(400).json({
      success: false,
      error: 'Champs manquants : prenom, telephone, nomPro, lienGoogle sont requis.'
    });
  }

  const message = `Bonjour ${prenom}, merci pour votre visite chez ${nomPro} ! Pouvez-vous nous laisser un avis Google ? ${lienGoogle} - STOP SMS`;

  try {
    const result = await axios.post(
      'https://api.brevo.com/v3/transactionalSMS/sms',
      {
        sender:    BREVO_SENDER,
        recipient: telephone,
        content:   message,
        type:      'transactional'
      },
      {
        headers: {
          'api-key':      BREVO_API_KEY,
          'Content-Type': 'application/json',
          'Accept':       'application/json'
        }
      }
    );

    console.log(`✅ SMS envoyé à ${telephone} — messageId: ${result.data.messageId}`);
    return res.status(200).json({ success: true, message: 'SMS envoyé avec succès.', messageId: result.data.messageId });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error(`❌ Erreur Brevo :`, errData);
    return res.status(500).json({ success: false, error: 'Erreur Brevo', details: errData });
  }
});

// ─── POST /messages — client envoie un message ───
app.post('/messages', (req, res) => {
  const { from, fromName, fromBusiness, subject, content, timestamp } = req.body;

  if (!from || !subject || !content) {
    return res.status(400).json({ success: false, error: 'Champs manquants : from, subject, content requis.' });
  }

  const message = {
    id:           Date.now().toString(),
    from:         from.toLowerCase().trim(),
    fromName:     fromName     || from,
    fromBusiness: fromBusiness || '',
    subject:      subject.trim(),
    content:      content.trim(),
    timestamp:    timestamp || new Date().toISOString(),
    receivedAt:   new Date().toISOString()
  };

  const messages = readMessages();
  messages.unshift(message);
  writeMessages(messages);

  console.log(`📩 Nouveau message de ${message.fromName} (${message.from}) — "${message.subject}"`);
  return res.status(201).json({ success: true, id: message.id });
});

// ─── GET /messages?admin=1 — admin récupère tous les messages ───
app.get('/messages', (req, res) => {
  if (req.query.admin !== '1') {
    return res.status(403).json({ success: false, error: 'Accès refusé.' });
  }
  const messages = readMessages();
  return res.status(200).json(messages);
});

app.listen(3000, () => {
  console.log('🚀 Serveur Notelo démarré sur le port 3000');
});
