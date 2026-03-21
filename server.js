const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const db = require('./database');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const isCloud = process.env.RENDER === 'true';

let botStatus = { ready: false, qr: null };
let lastQR = null;
let pairingCode = null;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--disable-gpu',
            '--no-zygote', '--single-process'
        ],
        ...(isCloud ? { executablePath: '/usr/bin/google-chrome-stable' } : { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
    }
});

// --- CORE BOT EVENTS ---
client.on('qr', (qr) => {
    lastQR = qr;
    botStatus.qr = qr;
    botStatus.ready = false;
});

client.on('ready', () => {
    botStatus.ready = true;
    botStatus.qr = null;
    lastQR = null;
    console.log('✅ Bot is ready.');
});

client.on('auth_failure', () => {
    botStatus.ready = false;
    console.error('Auth failure!');
});

// --- API ENDPOINTS ---
app.get('/api/bot-status', (req, res) => {
    try {
        res.json({ ...botStatus, qr: botStatus.qr || lastQR, pairingCode });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Request pairing code via API (The Ironclad Final Fix)
app.post('/api/bot-pairing-code', async (req, res) => {
    let { phone } = req.body;
    phone = phone.replace(/\D/g, ''); 
    
    try {
        console.log(`[PAIRING] Ironclad Protocol starting for ${phone}...`);
        const page = client.pupPage;
        if (!page) {
            console.log('[PAIRING] ERROR: Page not found, attempting recovery...');
            return res.status(503).json({ error: 'Bot is still waking up. Please wait 15s and try again.' });
        }

        // 1. Force Click "Link with phone number"
        await page.evaluate(() => {
            const findAndClick = (txt) => {
                const elements = Array.from(document.querySelectorAll('span, div, button, a'));
                const el = elements.find(e => e.innerText && e.innerText.toLowerCase().includes(txt.toLowerCase()));
                if (el) { el.click(); return true; }
                return false;
            };
            findAndClick('link with phone number');
        });
        
        await new Promise(r => setTimeout(r, 4000));

        // 2. Clear and Type Phone Number
        await page.evaluate((ph) => {
            const input = document.querySelector('input');
            if (input) {
                input.value = ''; // CLEAR
                input.focus();
                input.value = ph;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, phone);

        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.press('Enter');

        // 3. WAIT AND EXTRACT THE CODE (The Intelligent Way)
        console.log('[PAIRING] Searching for code in DOM...');
        let codeFound = null;
        
        // Check for 15 seconds continuously
        for (let i = 0; i < 15; i++) {
            const text = await page.evaluate(() => {
                // Look for the specific grid of 8 characters
                const digits = Array.from(document.querySelectorAll('div[data-ref]'))
                                    .map(d => d.innerText).join('');
                if (digits && digits.length >= 8) return digits.substring(0, 8);
                
                // Fallback: Look for any 8-char code pattern
                const anyCode = Array.from(document.querySelectorAll('span, div'))
                                    .map(e => e.innerText)
                                    .find(t => t && /^[A-Z0-9]{4}[ -]?[A-Z0-9]{4}$/.test(t));
                return anyCode || null;
            });

            if (text) {
                codeFound = text;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!codeFound) throw new Error('Code did not appear. Please refresh and try once more.');
        
        pairingCode = codeFound;
        console.log(`[PAIRING] SUCCESS! Text Code: ${codeFound}`);
        res.json({ message: 'Success', code: codeFound });

    } catch (err) {
        console.error('[PAIRING] ERROR:', err.message);
        res.status(500).json({ error: 'WhatsApp is slow. Refresh and try one last time in 10s.' });
    }
});

app.get('/api/expenses', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/expenses', (req, res) => {
    const { description, amount, paid_by, date } = req.body;
    try {
        const stmt = db.prepare('INSERT INTO expenses (description, amount, paid_by, date) VALUES (?, ?, ?, ?)');
        const result = stmt.run(description, amount, paid_by, date);
        notifyAll(description, amount, paid_by, date);
        res.json({ id: result.lastInsertRowid });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/expenses/:id', (req, res) => {
    const { id } = req.params;
    try {
        const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
        if (expense) {
            db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
            // Notify rollback...
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/summaries', (req, res) => {
    try {
        const expenses = db.prepare('SELECT * FROM expenses').all();
        const users = db.prepare('SELECT * FROM users').all();
        
        const totalHouse = expenses.reduce((sum, e) => sum + e.amount, 0);
        const share = totalHouse / 3;

        const summaries = users.map(u => {
            const userSpent = expenses.filter(e => e.paid_by === u.name).reduce((sum, e) => sum + e.amount, 0);
            return {
                paid_by: u.name,
                total_spent: userSpent,
                balance: userSpent - share
            };
        });

        res.json({ total_house_spent: totalHouse, share_per_person: share.toFixed(2), summaries });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/bot-restart', async (req, res) => {
    process.exit(1); // Force Render to reboot the process
});

// Notifications
function notifyAll(desc, amount, payer, date) {
    if (!botStatus.ready) return;
    const users = db.prepare('SELECT * FROM users').all();
    const msg = `💰 *New Expense*\n\n🏡 *Item:* ${desc}\n💵 *Amt:* ₹${amount}\n👤 *By:* ${payer}\n📅 *Date:* ${date}`;
    users.forEach(u => {
        if (u.phone) client.sendMessage(`${u.phone}@c.us`, msg).catch(e => console.error(e));
    });
}

// Start
app.listen(PORT, () => {
    console.log(`Server at http://localhost:${PORT}`);
    client.initialize().catch(e => console.error('Bot init error:', e));
});
