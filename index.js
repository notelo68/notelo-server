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

const CLICKSEND_USERNAME = process.env.CLICKSEND_USERNAME;
const CLICKSEND_API_KEY = process.env.CLICKSEND_API_KEY;

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
    const response = await axios.post(
      'https://rest.clicksend.com/v3/sms/send',
      {
        messages: [
          {
            to: telephone,
            body: message,
            source: 'nodejs'
          }
        ]
      },
      {
        auth: {
          username: CLICKSEND_USERNAME,
          password: CLICKSEND_API_KEY
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const messageData = response.data?.data?.messages?.[0];
    const status = messageData?.status;

    if (status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'SMS envoyé avec succès.',
        details: messageData
      });
    } else {
      return res.status(502).json({
        success: false,
        error: 'ClickSend a retourné un statut inattendu.',
        details: messageData
      });
    }
  } catch (err) {
    const clicksendError = err.response?.data;
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'envoi du SMS.',
      details: clicksendError || err.message
    });
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
