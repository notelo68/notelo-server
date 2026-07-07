require('dotenv').config();
const express = require('express');
const axios   = require('axios');
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

// ─── ACCÈS TEST GRATUIT (10 SMS ou 14 jours, CB requise) ───
const PRO_TRIAL_PRICE_ID = process.env.PRO_TRIAL_PRICE_ID || 'price_1TqcXMFrLrGfWhNdZlTjSA3D';
const TRIAL_SMS_LIMIT = 10;
const TRIAL_DAYS = 14;

function generateClientCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'NOTELO-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ─── Email de rappel avant bascule automatique de l'accès test ───
async function sendTrialReminderEmail(email, nom, reason) {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender:  { name: 'Notelo', email: 'contact@notelo.eu' },
      to:      [{ email, name: nom || '' }],
      subject: `Votre accès test Notelo se termine bientôt`,
      htmlContent: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
          <div style="text-align:center;margin-bottom:32px"><span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span></div>
          <h2 style="color:#1A1A18;font-size:20px;margin-bottom:8px">Votre accès test se termine ${reason}</h2>
          <p style="color:#6B6B64;margin-bottom:24px">Sauf résiliation de votre part, votre abonnement basculera automatiquement sur le plan <strong>Pro (69€/mois HT)</strong> et votre carte enregistrée sera débitée.</p>
          <a href="https://notelo.eu/dashboard.html" style="display:block;text-align:center;padding:14px 32px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:12px">Gérer mon abonnement →</a>
          <p style="color:#9CA3AF;font-size:12px;text-align:center">Vous pouvez résilier à tout moment depuis votre dashboard, sans frais.</p>
        </div>
      `
    }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });
    console.log(`📧 Email de rappel accès test envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email rappel accès test:', err.response?.data || err.message);
  }
}

// ─── Email de confirmation d'annulation d'abonnement ───
async function sendCancellationEmail(email, nom) {
  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender:  { name: 'Notelo', email: 'contact@notelo.eu' },
      to:      [{ email, name: nom || '' }],
      subject: `Votre abonnement Notelo a bien été annulé`,
      htmlContent: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
          <div style="text-align:center;margin-bottom:32px"><span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span></div>
          <h2 style="color:#1A1A18;font-size:20px;margin-bottom:8px">Votre abonnement a bien été annulé</h2>
          <p style="color:#6B6B64;margin-bottom:24px">Aucun prélèvement ne sera effectué. Vous pouvez réactiver votre compte à tout moment en souscrivant à nouveau depuis notelo.eu.</p>
          <a href="https://notelo.eu" style="display:block;text-align:center;padding:14px 32px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px">Revenir sur notelo.eu →</a>
        </div>
      `
    }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } });
    console.log(`📧 Email confirmation annulation envoyé à ${email}`);
  } catch (err) {
    console.error('❌ Erreur email confirmation annulation:', err.response?.data || err.message);
  }
}

// ─── Suivi des SMS envoyés pendant l'accès test — bascule anticipée à 10 SMS ───
async function trackTrialSmsUsage(email) {
  const { data: client } = await supabase
    .from('clients')
    .select('role, trial_sms_count, stripe_subscription_id, nom, trial_reminder_sent')
    .eq('email', email)
    .maybeSingle();

  if (!client || client.role !== 'trial_cb') return;

  const nextCount = (client.trial_sms_count || 0) + 1;
  await supabase.from('clients').update({ trial_sms_count: nextCount }).eq('email', email);

  if (nextCount === TRIAL_SMS_LIMIT - 2 && !client.trial_reminder_sent) {
    await supabase.from('clients').update({ trial_reminder_sent: true }).eq('email', email);
    sendTrialReminderEmail(email, client.nom, `dans ${TRIAL_SMS_LIMIT - nextCount} SMS`);
  }

  if (nextCount >= TRIAL_SMS_LIMIT && client.stripe_subscription_id) {
    try {
      await stripe.subscriptions.update(client.stripe_subscription_id, { trial_end: 'now' });
      console.log(`💳 Bascule anticipée (10 SMS atteints) : ${email}`);
    } catch (err) {
      console.error('❌ Erreur bascule anticipée Stripe:', err.message);
    }
  }
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

    // ─ Accès test gratuit (10 SMS / 14 jours, CB enregistrée, bascule auto vers Pro) ─
    if (session.metadata?.type === 'trial_cb') {
      const { prenom, entreprise } = session.metadata;
      const subscription = await stripe.subscriptions.retrieve(session.subscription);

      const { data: existing } = await supabase.from('clients').select('code').eq('email', email).maybeSingle();
      let code = existing?.code;
      if (!code) {
        code = generateClientCode();
        await supabase.from('clients').insert({
          email,
          code,
          plan:                    'pro',
          role:                    'trial_cb',
          nom:                     prenom || '',
          nom_pro:                 entreprise || '',
          lien_google:             '',
          join_date:               new Date().toISOString(),
          stripe_customer_id:      session.customer,
          stripe_subscription_id:  session.subscription,
          trial_sms_count:         0,
          trial_ends_at:           new Date(subscription.trial_end * 1000).toISOString(),
        });
        console.log(`✅ Accès test créé : ${email} — code ${code}`);
      }

      try {
        await axios.post('https://api.brevo.com/v3/smtp/email', {
          sender:      { name: 'Notelo', email: 'contact@notelo.eu' },
          to:          [{ email, name: prenom || '' }],
          subject:     `Bienvenue sur Notelo — votre accès test est actif`,
          htmlContent: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
              <div style="text-align:center;margin-bottom:32px">
                <span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span>
              </div>
              <h2 style="color:#1A1A18;font-size:22px;margin-bottom:8px">Bienvenue sur Notelo, ${escapeHtml(prenom || '')} !</h2>
              <p style="color:#6B6B64;margin-bottom:24px">Votre accès test est actif — <strong>10 SMS gratuits</strong>, dans la limite de <strong>14 jours</strong>.</p>
              <p style="color:#6B6B64;margin-bottom:24px">Sauf résiliation de votre part, votre abonnement basculera automatiquement sur le plan <strong>Pro (69€/mois HT)</strong> à la fin de l'accès test — votre carte enregistrée sera alors débitée. Vous pouvez résilier à tout moment depuis votre dashboard.</p>

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
        console.log(`📧 Email accès test envoyé à ${email}`);
      } catch (err) {
        console.error('❌ Erreur email Brevo (accès test):', err.response?.data || err.message);
      }

      return res.json({ received: true });
    }

    const nom     = session.customer_details?.name || '';
    const amount  = session.amount_total;

    const planKey = amount <= 3900 ? 'starter' : amount <= 6900 ? 'pro' : 'business';
    const planLabels = {
      starter:  { name: 'Starter',  limit: '50 SMS/mois',   price: '39€/mois' },
      pro:      { name: 'Pro',      limit: '200 SMS/mois',  price: '69€/mois' },
      business: { name: 'Business', limit: 'SMS illimités', price: '139€/mois' }
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

  // ─ Bascule accès test → Pro payant (essai terminé, 1er prélèvement réussi) ─
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object;
    const previousStatus = event.data.previous_attributes?.status;

    if (previousStatus === 'trialing' && sub.status === 'active') {
      const { data: client } = await supabase.from('clients').select('email').eq('stripe_subscription_id', sub.id).maybeSingle();
      if (client) {
        await supabase.from('clients').update({ role: 'client' }).eq('email', client.email);
        console.log(`💳 Bascule accès test → Pro payant : ${client.email}`);
      }
    }

    if (sub.status === 'canceled') {
      const { data: client } = await supabase.from('clients').select('email, nom').eq('stripe_subscription_id', sub.id).maybeSingle();
      if (client) {
        await supabase.from('clients').update({ role: 'canceled' }).eq('email', client.email);
        console.log(`🚫 Abonnement annulé : ${client.email}`);
        sendCancellationEmail(client.email, client.nom);
      }
    }
  }

  // ─ Confirmation d'annulation définitive (période de facturation arrivée à son terme) ─
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const { data: client } = await supabase.from('clients').select('email, nom, role').eq('stripe_subscription_id', sub.id).maybeSingle();
    if (client && client.role !== 'canceled') {
      await supabase.from('clients').update({ role: 'canceled' }).eq('email', client.email);
      console.log(`🚫 Abonnement supprimé : ${client.email}`);
      sendCancellationEmail(client.email, client.nom);
    }
  }

  // ─ Rappel avant bascule automatique (J-3, déclencheur "durée") ─
  if (event.type === 'customer.subscription.trial_will_end') {
    const sub = event.data.object;
    const { data: client } = await supabase.from('clients').select('email, nom, trial_reminder_sent').eq('stripe_subscription_id', sub.id).maybeSingle();
    if (client && !client.trial_reminder_sent) {
      await supabase.from('clients').update({ trial_reminder_sent: true }).eq('email', client.email);
      await sendTrialReminderEmail(client.email, client.nom, 'jours');
    }
  }

  // ─ Échec de paiement à la bascule (carte refusée, etc.) ─
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    if (invoice.subscription) {
      const { data: client } = await supabase.from('clients').select('email, nom').eq('stripe_subscription_id', invoice.subscription).maybeSingle();
      if (client) {
        console.warn(`⚠️  Échec de paiement à la bascule : ${client.email}`);
        axios.post('https://api.brevo.com/v3/smtp/email', {
          sender:  { name: 'Notelo', email: 'contact@notelo.eu' },
          to:      [{ email: client.email, name: client.nom || '' }],
          subject: `Action requise — le paiement de votre abonnement Notelo a échoué`,
          htmlContent: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:auto;padding:32px;background:#fff">
              <div style="text-align:center;margin-bottom:32px"><span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span></div>
              <h2 style="color:#1A1A18;font-size:20px;margin-bottom:8px">Le paiement de votre abonnement a échoué</h2>
              <p style="color:#6B6B64;margin-bottom:24px">Votre accès test Notelo est terminé et le passage au plan Pro (69€/mois HT) n'a pas pu être débité sur votre carte. Merci de mettre à jour votre moyen de paiement pour conserver l'accès à votre compte.</p>
              <a href="https://notelo.eu/dashboard.html" style="display:block;text-align:center;padding:14px 32px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px">Mettre à jour ma carte →</a>
            </div>
          `
        }, { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } })
        .catch(err => console.error('❌ Erreur email échec paiement:', err.response?.data || err.message));
      }
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
      code:          client.code,
      plan:          client.plan,
      role:          client.role,
      nom:           client.nom,
      nomPro:        client.nom_pro,
      lienGoogle:    client.lien_google,
      joinDate:      client.join_date,
      trialSmsCount: client.trial_sms_count,
      trialEndsAt:   client.trial_ends_at
    }});
  }

  return res.status(401).json({ success: false, error: 'Email ou code incorrect.' });
});


// ─── POST /resend-code — renvoi du code d'accès par email ───
app.post('/resend-code', async (req, res) => {
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ success: false, message: 'Email manquant.' });

  if (FIXED_ACCOUNTS[email]) {
    return res.json({ success: false, message: 'Aucun compte trouvé avec cet email.' });
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('nom, code')
    .eq('email', email)
    .maybeSingle();

  if (error || !client) {
    return res.json({ success: false, message: 'Aucun compte trouvé avec cet email.' });
  }

  try {
    await axios.post('https://api.brevo.com/v3/smtp/email', {
      sender:      { name: 'Notelo', email: 'contact@notelo.eu' },
      to:          [{ email, name: client.nom }],
      subject:     "Votre code d'acces Notelo",
      htmlContent: '<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px">'
        + '<div style="text-align:center;margin-bottom:28px"><span style="font-size:1.5rem;font-weight:700;color:#1A1A18">note<span style="color:#1D9E75">lo</span></span></div>'
        + '<h2 style="color:#1A1A18;font-size:20px;margin-bottom:8px">Votre code d\'acces</h2>'
        + '<p style="color:#6B6B64;font-size:14px;margin-bottom:24px">Bonjour ' + client.nom + ', voici votre code de connexion Notelo :</p>'
        + '<div style="background:#F9F7F3;border-radius:12px;padding:20px 32px;text-align:center;margin-bottom:24px">'
        + '<p style="font-size:13px;color:#6B6B64;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;font-weight:600">Code d\'acces</p>'
        + '<p style="font-size:2rem;font-weight:700;color:#1D9E75;letter-spacing:0.08em;margin:0">' + client.code + '</p>'
        + '</div>'
        + '<a href="https://notelo.eu/login.html" style="display:block;text-align:center;padding:14px 32px;background:#1D9E75;color:#fff;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-bottom:24px">Acceder au dashboard →</a>'
        + '<p style="color:#9CA3AF;font-size:12px;text-align:center">Si vous n\'avez pas demande ce renvoi, ignorez cet email.</p>'
        + '</div>'
    }, {
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' }
    });

    console.log(`Email code renvoye a ${email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('Erreur renvoi code:', err.response?.data || err.message);
    return res.status(500).json({ success: false, message: "Erreur lors de l'envoi de l'email." });
  }
});
// ─── GET /bienvenue ───
app.get('/bienvenue', (req, res) => {
  return res.redirect(`https://notelo.eu/bienvenue.html?plan=${req.query.plan || 'pro'}`);
});

// ─── POST /create-trial-checkout — accès test gratuit (10 SMS ou 14 jours, CB requise) ───
app.post('/create-trial-checkout', async (req, res) => {
  const { prenom, nom, entreprise, email: rawEmail, tel } = req.body;

  if (!prenom || !rawEmail || !entreprise || !tel) {
    return res.status(400).json({ success: false, error: 'Champs manquants.' });
  }

  const email = rawEmail.toLowerCase().trim();

  const { data: existing } = await supabase
    .from('clients')
    .select('code')
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ success: false, error: 'Un compte existe déjà avec cet email.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                     'subscription',
      customer_email:          email,
      line_items:               [{ price: PRO_TRIAL_PRICE_ID, quantity: 1 }],
      payment_method_collection: 'always',
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        trial_settings:    { end_behavior: { missing_payment_method: 'cancel' } },
      },
      metadata:    { type: 'trial_cb', prenom, nom: nom || '', entreprise, tel },
      success_url: 'https://notelo.eu/bienvenue.html?plan=pro&trial=1',
      cancel_url:  'https://notelo.eu/signup.html',
    });

    console.log(`🔗 Session accès test créée pour ${email}`);
    return res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('❌ Erreur création session accès test:', err.message);
    return res.status(500).json({ success: false, error: 'Erreur lors de la création de la session de paiement.' });
  }
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

// ─── PERSISTANCE ÉTAT UTILISATEURS (Supabase) ───
const HISTORY_CAP = 1000;
const PIN_REGEX = /^\d{4}$/;

app.get('/load-state', async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ success: false, error: 'email requis' });

  const { data, error } = await supabase
    .from('user_states')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('❌ load-state:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
  if (!data) return res.json({ success: true, state: null });

  return res.json({ success: true, state: {
    sentThisMonth:     data.sent_this_month || 0,
    sentMonth:         data.sent_month || '',
    smsTemplate:       data.sms_template || '',
    useCustomTemplate: !!data.use_custom_template,
    nomPro:            data.nom_pro || '',
    lienGoogle:        data.lien_google || '',
    history:           Array.isArray(data.history) ? data.history : [],
    lockEnabled:       !!data.lock_enabled,
    hasPin:            !!data.lock_pin,
  }});
});

app.post('/save-state', async (req, res) => {
  const {
    email,
    sentThisMonth, sentMonth, smsTemplate, useCustomTemplate, nomPro, lienGoogle,
    history,
    lockEnabled, newPin, currentPin,
  } = req.body;

  if (!email) return res.status(400).json({ success: false, error: 'email requis' });
  const e = email.toLowerCase().trim();

  const { data: current } = await supabase
    .from('user_states')
    .select('*')
    .eq('email', e)
    .maybeSingle();

  const wasLocked = !!current?.lock_enabled;
  const existingPin = current?.lock_pin || null;
  const lienAttemptChange = lienGoogle !== undefined && (current?.lien_google || '') !== lienGoogle;
  const lockToggleAttempt = lockEnabled !== undefined && lockEnabled !== wasLocked;
  const pinChangeAttempt = newPin !== undefined;

  // Si currentPin est fourni explicitement, le valider (utilisé pour vérifier le PIN sans modification réelle)
  if (existingPin && currentPin !== undefined && currentPin !== existingPin) {
    return res.status(403).json({ success: false, error: 'PIN incorrect' });
  }

  // Vérifications du PIN actuel pour les actions sensibles
  const requiresCurrentPin = (
    (wasLocked && lienAttemptChange) ||
    (existingPin && lockToggleAttempt) ||
    (existingPin && pinChangeAttempt)
  );

  if (requiresCurrentPin && currentPin !== existingPin) {
    return res.status(403).json({ success: false, error: 'PIN incorrect' });
  }

  // Calcul des nouvelles valeurs lock
  let nextPin = existingPin;
  if (pinChangeAttempt) {
    if (newPin && !PIN_REGEX.test(String(newPin))) {
      return res.status(400).json({ success: false, error: 'PIN doit contenir 4 chiffres' });
    }
    nextPin = newPin || null;
  }
  let nextLockEnabled = wasLocked;
  if (lockEnabled !== undefined) nextLockEnabled = !!lockEnabled;
  if (nextLockEnabled && !nextPin) nextLockEnabled = false; // pas de verrou sans PIN

  // Lien : refus silencieux si verrou actif et pas de PIN valide
  let nextLien = current?.lien_google ?? null;
  if (lienGoogle !== undefined) {
    if (wasLocked && lienAttemptChange && currentPin !== existingPin) {
      // ignore (déjà bloqué par le check requiresCurrentPin sauf si pas demandé — sécurité)
    } else {
      nextLien = lienGoogle;
    }
  }

  // History server-authoritative — cap à HISTORY_CAP
  let nextHistory = Array.isArray(current?.history) ? current.history : [];
  if (Array.isArray(history)) {
    nextHistory = history.slice(0, HISTORY_CAP);
  }

  const payload = {
    email:               e,
    sent_this_month:     sentThisMonth ?? current?.sent_this_month ?? 0,
    sent_month:          sentMonth ?? current?.sent_month ?? null,
    sms_template:        smsTemplate ?? current?.sms_template ?? null,
    use_custom_template: useCustomTemplate ?? current?.use_custom_template ?? false,
    nom_pro:             nomPro ?? current?.nom_pro ?? null,
    lien_google:         nextLien,
    history:             nextHistory,
    lock_pin:            nextPin,
    lock_enabled:        nextLockEnabled,
    updated_at:          new Date().toISOString(),
  };

  const { error } = await supabase
    .from('user_states')
    .upsert(payload, { onConflict: 'email' });

  if (error) {
    console.error('❌ save-state:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }

  return res.json({
    success:     true,
    lockEnabled: nextLockEnabled,
    hasPin:      !!nextPin,
  });
});

// ─── LIENS RACCOURCIS (maison — Supabase avec fallback mémoire) ───
// Fallback en mémoire si la table Supabase n'existe pas encore
const linksMemory = new Map();

function generateCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

app.post('/shorten', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'URL invalide' });
  }
  const BASE_URL = process.env.BASE_URL || 'https://notelo-server.onrender.com';

  // ── Essayer Supabase (persistant) ──
  try {
    const { data: existing, error: findErr } = await supabase
      .from('links').select('code').eq('url', url).maybeSingle();

    if (!findErr) {
      if (existing) {
        return res.json({ success: true, short: `${BASE_URL}/r/${existing.code}` });
      }
      // Table OK, générer un code unique
      let code;
      for (let i = 0; i < 10; i++) {
        const c = generateCode();
        const { data: col } = await supabase.from('links').select('code').eq('code', c).maybeSingle();
        if (!col) { code = c; break; }
      }
      if (!code) code = generateCode();

      const { error: insertErr } = await supabase.from('links').insert({ code, url });
      if (!insertErr) {
        linksMemory.set(code, url); // sync mémoire aussi
        console.log(`🔗 Supabase : ${BASE_URL}/r/${code} → ${url}`);
        return res.status(201).json({ success: true, short: `${BASE_URL}/r/${code}` });
      }
    }
    // Si erreur Supabase → fallback mémoire ci-dessous
    console.warn('⚠️  Table links absente de Supabase — fallback mémoire actif');
  } catch(e) {
    console.warn('⚠️  Supabase links indisponible — fallback mémoire actif');
  }

  // ── Fallback mémoire (fonctionne jusqu'au prochain redémarrage) ──
  const existingMem = [...linksMemory.entries()].find(([, v]) => v === url);
  if (existingMem) {
    return res.json({ success: true, short: `${BASE_URL}/r/${existingMem[0]}` });
  }
  let code = generateCode();
  while (linksMemory.has(code)) code = generateCode();
  linksMemory.set(code, url);
  console.log(`🔗 Mémoire : ${BASE_URL}/r/${code} → ${url}`);
  return res.status(201).json({ success: true, short: `${BASE_URL}/r/${code}` });
});

app.get('/r/:code', async (req, res) => {
  // Essayer Supabase
  try {
    const { data, error } = await supabase
      .from('links').select('url').eq('code', req.params.code).maybeSingle();
    if (!error && data) return res.redirect(301, data.url);
  } catch(e) {}

  // Fallback mémoire
  const memUrl = linksMemory.get(req.params.code);
  if (memUrl) return res.redirect(301, memUrl);

  return res.status(404).send('Lien introuvable.');
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
  const { prenom, telephone, nomPro, lienGoogle, message: messageOverride, email: accountEmail } = req.body;

  if (!prenom || !telephone || !nomPro || !lienGoogle) {
    return res.status(400).json({
      success: false,
      error: 'Champs manquants : prenom, telephone, nomPro, lienGoogle sont requis.'
    });
  }

  const message = messageOverride || `Bonjour ${prenom}, merci pour votre visite chez ${nomPro} ! Votre avis en 30 secondes nous ferait plaisir : ${lienGoogle} STOP SMS`;

  if (accountEmail) {
    const { data: client } = await supabase
      .from('clients')
      .select('role, trial_sms_count')
      .eq('email', accountEmail.toLowerCase().trim())
      .maybeSingle();

    if (client && client.role === 'trial_cb' && (client.trial_sms_count || 0) >= TRIAL_SMS_LIMIT) {
      return res.status(403).json({
        success: false,
        error: "Accès test terminé (10 SMS atteints) — votre abonnement Pro est en cours d'activation."
      });
    }
  }

  try {
    const result = await axios.post(
      'https://api.brevo.com/v3/transactionalSMS/sms',
      { sender: BREVO_SENDER, recipient: telephone, content: message, type: 'transactional' },
      { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' } }
    );

    console.log(`✅ SMS envoyé à ${telephone}`);

    if (accountEmail) {
      trackTrialSmsUsage(accountEmail.toLowerCase().trim()).catch(err => console.error('❌ Erreur suivi accès test:', err.message));
    }

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
