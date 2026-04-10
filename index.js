require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
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

  // Réutiliser un code existant si l'URL est déjà connue
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
  } catch (e) {
    return [];
  }
}

function writeMessages(messages) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2), 'utf8');
}

const crypto = require('crypto');

const OVH_BASE    = 'https://eu.api.ovh.com/1.0';
const OVH_SMS_SERVICE = process.env.OVH_SMS_SERVICE;

async function ovhRequest(method, path, body = null) {
  const APP_KEY      = process.env.OVH_APP_KEY;
  const APP_SECRET   = process.env.OVH_APP_SECRET;
  const CONSUMER_KEY = process.env.OVH_CONSUMER_KEY;

  // Timestamp OVH (synchronisé)
  const tsRes   = await axios.get(`${OVH_BASE}/auth/time`);
  const timestamp = tsRes.data;

  const fullUrl  = `${OVH_BASE}${path}`;
  const bodyStr  = body ? JSON.stringify(body) : '';

  const sigData  = `${APP_SECRET}+${CONSUMER_KEY}+${method}+${fullUrl}+${bodyStr}+${timestamp}`;
  const signature = '$1$' + crypto.createHash('sha1').update(sigData).digest('hex');

  const headers = {
    'Content-Type':    'application/json',
    'X-Ovh-Application': APP_KEY,
    'X-Ovh-Consumer':    CONSUMER_KEY,
    'X-Ovh-Signature':   signature,
    'X-Ovh-Timestamp':   String(timestamp)
  };

  const response = await axios({ method, url: fullUrl, headers, data: body || undefined });
  return response.data;
}

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
    const result = await ovhRequest('POST', `/sms/${OVH_SMS_SERVICE}/jobs`, {
      message,
      receivers:    [telephone],
      noStopClause: false,
      priority:     'high',
      charset:      'UTF-8'
    });

    console.log('✅ SMS envoyé :', result);
    return res.status(200).json({ success: true, message: 'SMS envoyé avec succès.', details: result });

  } catch (err) {
    const status  = err.response?.status;
    const detail  = err.response?.data || err.message;
    console.error(`❌ Erreur OVH SMS [${status}] :`, JSON.stringify(detail));
    return res.status(500).json({ success: false, error: `Erreur OVH [${status}]`, details: detail });
  }
});

// Endpoint de diagnostic OVH
app.get('/test-ovh', async (req, res) => {
  try {
    const services = await ovhRequest('GET', '/sms');
    return res.json({ success: true, services });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data || err.message;
    return res.status(500).json({ success: false, error: `OVH [${status}]`, details: detail });
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
  messages.unshift(message);           // plus récent en premier
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
  console.log('Serveur démarré sur le port 3000');
});
