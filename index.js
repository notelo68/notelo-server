require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── SUPABASE ───
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Comptes fixes (admin + démo) — ne passent pas par Stripe
const FIXED_ACCOUNTS = {
  'vincent@notelo.eu': {
    code:       'NOTELO-VT01',
    plan:       'pro',
    role:       'admin',
    nom:        'Vincent',
    nomPro:     'Notelo',
    lienGoogle: 'https://g.page/r/CBQhypqAGtHbEBE',
    joinDate:   '2026-03-29T00:00:00Z'
  },
  'demo@notelo.eu': {
    code:       'NOTELO-DEMO',
    plan:       'pro',
    role:       'client',
    nom:        'Démo',
    nomPro:     'Garage Démo',
    lienGoogle: 'https://g.page/r/demo',
    joinDate:   new Date().toISOString()
  }
};

// ─── BREVO ───
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER  = process.env.BREVO_SENDER || 'Notelo';

function generateClientCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'NOTELO-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

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
    const email   = (session.customer_email || session.customer_details?.email || '').toLowerCase();
    const nom     = session.customer_details?.name || '';
    const amount  = session.amount_total;

    const planKey = amount <= 2900 ? 'starter' : amount <= 4900 ? 'pro' : 'business';
    const planLabels = {
      starter:  { name: 'Starter',  limit: '50 SMS/mois',   price: '29€/mois' },
      pro:      { name: 'Pro',      limit: '200 SMS/mois',  price: '49€/mois' },
      business: { name: 'Business', limit: 'SMS illimités', price: '89€/mois' }
    };
    const plan = planLabels[planKey];

    // Vérifier si le client existe déjà
    const { data: existing } = await supabase
      .from('clients')
      .select('code')
      .eq('email', email)
      .maybeSingle();

    let code = existing?.code;
    if (!code) {
      code = generateClientCode();
      await supabase.from('clients').insert({
        email,
        code,
        plan:        planKey,
        role:        'client',
        nom:         nom.split(' ')[0] || '',
        nom_pro:     '',
        lien_google: '',
        join_date:   new Date().toISOString()
      });
      console.log(`✅ Nouveau client créé : ${email} — code ${code} — plan ${planKey}`);
    }

    // Email de bienvenue avec identifiants
    try {
      await axios.post('https://api.brevo.com/v3/smtp/email', {
        sender:      { name: 'Notelo', email: 'contact@notelo.eu' },
        to:          [{ email, name: nom }],
        subject:     `Bienvenue sur Notelo ${plan.name} — vos identifiants`,
        htmlContent: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
            <div style="text-align:center;margin-bottom:32px">
              <span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span>
            </div>
            <h2 style="color:#1A1A18;font-size:22px;margin-bottom:8px">Bienvenue sur Notelo ${plan.name} !</h2>
            <p style="color:#6B6B64;margin-bottom:24px">Votre abonnement est actif — <strong>${plan.limit}</strong> pour <strong>${plan.price}</strong>.</p>

            <div style="background:#F9F7F3;border-radius:12px;padding:24px;margin-bottom:24px">
              <p style="font-size:13px;color:#6B6B64;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Vos identifiants de connexion</p>
              <table style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="padding:8px 0;color:#6B6B64;font-size:14px">Email</td>
                  <td style="padding:8px 0;font-weight:600;color:#1A1A18;font-size:14px">${email}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#6B6B64;font-size:14px">Code d'accès</td>
                  <td style="padding:8px 0;font-weight:700;color:#1D9E75;font-size:18px;letter-spacing:0.05em">${code}</td>
                </tr>
              </table>
            </div>

            <a href="https://notelo.eu/login.html"
               style="display:block;text-align:center;padding:14px 32px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px">
              Accéder à mon espace →
            </a>

            <p style="color:#6B6B64;font-size:13px;line-height:1.6">
              Conservez ce code précieusement, il vous servira à chaque connexion.<br>
              Des questions ? <a href="mailto:contact@notelo.eu" style="color:#1D9E75">contact@notelo.eu</a>
            </p>
          </div>
        `
      }, {
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
      });
      console.log(`📧 Email identifiants envoyé à ${email}`);
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── POST /auth — vérification email + code ───
app.post('/auth', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  const code  = (req.body.code  || '').toUpperCase().trim();

  if (!email || !code) {
    return res.status(400).json({ success: false, error: 'Email et code requis.' });
  }

  // Comptes fixes en priorité
  const fixed = FIXED_ACCOUNTS[email];
  if (fixed && fixed.code === code) {
    return res.json({ success: true, client: { email, ...fixed } });
  }

  // Supabase
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('email', email)
    .eq('code', code)
    .maybeSingle();

  if (client) {
    return res.json({ success: true, client: {
      email,
      code:       client.code,
      plan:       client.plan,
      role:       client.role,
      nom:        client.nom,
      nomPro:     client.nom_pro,
      lienGoogle: client.lien_google,
      joinDate:   client.join_date
    }});
  }

  return res.status(401).json({ success: false, error: 'Email ou code incorrect.' });
});

// ─── GET /bienvenue ───
app.get('/bienvenue', (req, res) => {
  return res.redirect(`https://notelo.eu/bienvenue.html?plan=${req.query.plan || 'pro'}`);
});

// ─── POST /create-portal-session ───
app.post('/create-portal-session', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ success: false, error: 'Email requis.' });

  try {
    const customers = await stripe.customers.list({ email, limit: 1 });
    if (!customers.data.length) {
      return res.status(404).json({ success: false, error: 'Aucun abonnement Stripe trouvé pour cet email.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   customers.data[0].id,
      return_url: 'https://notelo.eu/dashboard.html',
    });

    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('❌ Erreur portail Stripe:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PERSISTANCE ÉTAT UTILISATEURS ───
const STATES_FILE = path.join(__dirname, 'user_states.json');

function readStates() {
  try {
    if (!fs.existsSync(STATES_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATES_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function writeStates(states) {
  fs.writeFileSync(STATES_FILE, JSON.stringify(states, null, 2), 'utf8');
}

app.get('/load-state', (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ success: false, error: 'email requis' });
  const states = readStates();
  return res.json({ success: true, state: states[email] || null });
});

app.post('/save-state', (req, res) => {
  const { email, sentThisMonth, sentMonth, smsTemplate, useCustomTemplate, nomPro, lienGoogle } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'email requis' });
  const states = readStates();
  states[email.toLowerCase().trim()] = { sentThisMonth, sentMonth, smsTemplate, useCustomTemplate, nomPro, lienGoogle, updatedAt: new Date().toISOString() };
  writeStates(states);
  return res.json({ success: true });
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

app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'URL invalide' });
  }

  const links    = readLinks();
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

app.get('/r/:code', (req, res) => {
  const links = readLinks();
  const data  = links[req.params.code];
  if (!data) return res.status(404).send('Lien introuvable ou expiré.');
  return res.redirect(301, data.url);
});

// ─── MESSAGES CONTACT ───
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL || 'contact@notelo.eu';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.post('/messages', async (req, res) => {
  const { from, fromName, fromBusiness, subject, content, timestamp } = req.body;

  if (!from || !subject || !content) {
    return res.status(400).json({ success: false, error: 'Champs manquants : from, subject, content requis.' });
  }

  const message = {
    id:            Date.now().toString(),
    from:          from.toLowerCase().trim(),
    from_name:     fromName     || from,
    from_business: fromBusiness || '',
    subject:       subject.trim(),
    content:       content.trim(),
    timestamp:     timestamp || new Date().toISOString(),
    received_at:   new Date().toISOString()
  };

  const { error } = await supabase.from('messages').insert(message);
  if (error) {
    console.error('❌ Erreur Supabase messages:', error.message);
    return res.status(500).json({ success: false, error: 'Erreur base de données.' });
  }

  console.log(`📩 Message de ${message.from_name} (${message.from}) — "${message.subject}"`);

  // Notification email à l'admin (non bloquante)
  axios.post('https://api.brevo.com/v3/smtp/email', {
    sender:  { name: 'Notelo Contact', email: 'contact@notelo.eu' },
    to:      [{ email: ADMIN_NOTIFICATION_EMAIL }],
    replyTo: { email: message.from, name: message.from_name },
    subject: `📩 Notelo — Nouveau message : ${message.subject}`,
    htmlContent: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
        <div style="text-align:center;margin-bottom:24px">
          <span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span>
        </div>
        <h2 style="color:#1A1A18;font-size:20px;margin-bottom:8px">📩 Nouveau message reçu</h2>
        <p style="color:#6B6B64;margin-bottom:20px;font-size:14px">Via le formulaire de contact de notelo.eu</p>

        <div style="background:#F9F7F3;border-radius:12px;padding:20px;margin-bottom:20px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr>
              <td style="padding:6px 0;color:#6B6B64;width:110px">De</td>
              <td style="padding:6px 0;font-weight:600;color:#1A1A18">${escapeHtml(message.from_name)}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;color:#6B6B64">Email</td>
              <td style="padding:6px 0;font-weight:600;color:#1D9E75">
                <a href="mailto:${escapeHtml(message.from)}" style="color:#1D9E75;text-decoration:none">${escapeHtml(message.from)}</a>
              </td>
            </tr>
            ${message.from_business ? `
            <tr>
              <td style="padding:6px 0;color:#6B6B64">Entreprise</td>
              <td style="padding:6px 0;color:#1A1A18">${escapeHtml(message.from_business)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:6px 0;color:#6B6B64">Sujet</td>
              <td style="padding:6px 0;font-weight:600;color:#1A1A18">${escapeHtml(message.subject)}</td>
            </tr>
          </table>
        </div>

        <div style="background:#fff;border:1.5px solid #EBEBEA;border-radius:12px;padding:20px;margin-bottom:24px">
          <p style="font-size:12px;color:#6B6B64;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">Message</p>
          <p style="color:#1A1A18;font-size:14px;line-height:1.7;white-space:pre-wrap;margin:0">${escapeHtml(message.content)}</p>
        </div>

        <a href="mailto:${escapeHtml(message.from)}?subject=Re: ${encodeURIComponent(message.subject)}"
           style="display:inline-block;padding:12px 28px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;margin-right:8px">
          Répondre →
        </a>
        <a href="https://notelo.eu/admin-messages.html"
           style="display:inline-block;padding:12px 28px;background:#fff;color:#1A1A18;border:1.5px solid #EBEBEA;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px">
          Voir tous les messages
        </a>
      </div>
    `
  }, {
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
  })
  .then(() => console.log(`📧 Notification admin envoyée à ${ADMIN_NOTIFICATION_EMAIL}`))
  .catch(err => console.error('⚠️  Notification admin échouée:', err.response?.data || err.message));

  return res.status(201).json({ success: true, id: message.id });
});

app.get('/messages', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (!process.env.ADMIN_PASSWORD || adminKey !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Accès refusé.' });
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('received_at', { ascending: false });

  if (error) return res.status(500).json({ success: false, error: error.message });
  return res.status(200).json(data);
});

// ─── POST /send-sms ───
app.post('/send-sms', async (req, res) => {
  const { prenom, telephone, nomPro, lienGoogle, message: messageOverride } = req.body;

  if (!prenom || !telephone || !nomPro || !lienGoogle) {
    return res.status(400).json({
      success: false,
      error: 'Champs manquants : prenom, telephone, nomPro, lienGoogle sont requis.'
    });
  }

  const message = messageOverride || `Bonjour ${prenom}, merci pour votre visite chez ${nomPro} ! Votre avis en 30 secondes nous ferait plaisir : ${lienGoogle} STOP SMS`;

  try {
    const result = await axios.post(
      'https://api.brevo.com/v3/transactionalSMS/sms',
      { sender: BREVO_SENDER, recipient: telephone, content: message, type: 'transactional' },
      { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );

    console.log(`✅ SMS envoyé à ${telephone}`);
    return res.status(200).json({ success: true, message: 'SMS envoyé avec succès.', messageId: result.data.messageId });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('❌ Erreur Brevo SMS:', errData);
    return res.status(500).json({ success: false, error: 'Erreur Brevo', details: errData });
  }
});

app.listen(3000, () => {
  console.log('🚀 Serveur Notelo démarré sur le port 3000');
});
