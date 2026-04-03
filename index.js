require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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

app.listen(3000, () => {
  console.log('Serveur démarré sur le port 3000');
});
