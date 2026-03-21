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
let pairingCodePhone = null;

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
    console.log('[BOT] New QR Generated');
});

client.on('ready', () => {
    botStatus.ready = true;
    botStatus.qr = null;
    lastQR = null;
    pairingCode = null;
    console.log('✅ Bot is ready.');
});

client.on('auth_failure', (msg) => {
    botStatus.ready = false;
    console.error('Auth failure:', msg);
});

// --- API ENDPOINTS ---
app.get('/api/bot-status', (req, res) => {
    res.json({ ...botStatus, qr: botStatus.qr || lastQR, pairingCode, pairingCodePhone });
});

// Dual Support for Cached/New Browsers
async function handlePairingRequest(req, res) {
    let { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });
    
    phone = phone.replace(/\D/g, ''); 
    
    try {
        console.log(`[PAIRING] Requesting official code for ${phone}...`);
        
        if (botStatus.ready) {
            return res.status(400).json({ error: 'Bot is already connected.', alreadyConnected: true });
        }
        
        if (!lastQR && !botStatus.qr) {
            return res.status(503).json({ error: 'Bot is still initializing. Wait 15s and try again.' });
        }

        // THE MANUAL BULLETPROOF WAY (Bypasses library bugs)
        const page = client.pupPage;
        if (!page) throw new Error('Browser page not available.');

        // 0. X-RAY VISION FIX: Reload QR Code if it timed out!
        await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, div, button, a'));
            const reloadBtn = elements.find(e => e.innerText && e.innerText.toLowerCase().includes('click to reload'));
            if (reloadBtn) reloadBtn.click();
        });
        
        // Give it a quick 2s to refresh the session
        await new Promise(r => setTimeout(r, 2000));

        // 1. Click Link with Phone Number
        let clicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('span, div, button, a'));
            const el = elements.find(e => e.innerText && e.innerText.toLowerCase().includes('link with phone number'));
            if (el) { el.click(); return true; }
            return false;
        });

        if (!clicked) {
            throw new Error('WhatsApp has blocked the "Phone Number" feature for this cloud server. See Alternative Solution below.');
        }

        
        await new Promise(r => setTimeout(r, 3000));

        // 2. Type Phone Number and Enter
        await page.evaluate((ph) => {
            const input = document.querySelector('input');
            if (input) {
                input.value = '';
                input.focus();
                input.value = ph;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, phone);

        await new Promise(r => setTimeout(r, 1000));
        await page.keyboard.press('Enter');

        // 3. Search for the Code
        let codeFound = null;
        for (let i = 0; i < 20; i++) {
            const text = await page.evaluate(() => {
                // Try to find exact code grid (divs with data-ref)
                const digits = Array.from(document.querySelectorAll('div[data-ref]')).map(d => d.innerText).join('');
                if (digits && digits.length >= 8) return digits.substring(0, 8);
                
                // Fallback: look for exactly 8 letter/number code matching the format
                const anyCode = Array.from(document.querySelectorAll('span, div'))
                                    .map(e => e.innerText)
                                    .find(t => t && /^[A-Z0-9]{4}[ -]?[A-Z0-9]{4}$/.test(t));
                return anyCode ? anyCode.replace(/[^A-Z0-9]/g, '').substring(0, 8) : null;
            });

            if (text) {
                codeFound = text;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!codeFound) throw new Error('Code did not appear on screen within 20s.');

        // Format as XXXX-XXXX
        pairingCode = `${codeFound.substring(0, 4)}-${codeFound.substring(4, 8)}`;
        pairingCodePhone = phone;

        console.log(`[PAIRING] SUCCESS! Code: ${pairingCode}`);
        res.json({ success: true, message: 'Success', code: pairingCode });
    } catch (err) {
        console.error('[PAIRING] ERROR:', err.message);
        res.status(500).json({ error: `WhatsApp API Error: ${err.message}` });
    }
}

// Support both endpoint names to completely bypass browser caching issues!
app.post('/api/bot-pairing-code', handlePairingRequest);
app.post('/api/request-pairing-code', handlePairingRequest);

// DEBUG VISION: Let's see what the cloud browser is actually stuck on!
app.get('/api/debug-screenshot', async (req, res) => {
    try {
        if (!client.pupPage) return res.status(503).send('Browser not ready yet');
        const buffer = await client.pupPage.screenshot({ fullPage: true });
        res.set('Content-Type', 'image/png');
        res.send(buffer);
    } catch (e) {
        res.status(500).send(`Screenshot failed: ${e.message}`);
    }
});

app.get('/api/expenses', (req, res) => {
    const rows = db.prepare('SELECT * FROM expenses ORDER BY date DESC').all();
    res.json(rows);
});

app.post('/api/expenses', (req, res) => {
    const { description, amount, paid_by, date } = req.body;
    const stmt = db.prepare('INSERT INTO expenses (description, amount, paid_by, date) VALUES (?, ?, ?, ?)');
    const result = stmt.run(description, amount, paid_by, date);
    notifyAll(description, amount, paid_by, date);
    res.json({ id: result.lastInsertRowid });
});

app.delete('/api/expenses/:id', (req, res) => {
    const { id } = req.params;
    db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    res.json({ success: true });
});

app.get('/api/summaries', (req, res) => {
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
});

app.post('/api/bot-restart', (req, res) => {
    res.json({ message: 'Restarting...' });
    setTimeout(() => process.exit(1), 500);
});

function notifyAll(desc, amount, payer, date) {
    if (!botStatus.ready) return;
    const users = db.prepare('SELECT * FROM users').all();
    const msg = `💰 *New Expense*\n\n🏡 *Item:* ${desc}\n💵 *Amt:* ₹${amount}\n👤 *By:* ${payer}\n📅 *Date:* ${date}`;
    users.forEach(u => {
        if (u.phone) client.sendMessage(`${u.phone}@c.us`, msg).catch(e => console.error(e));
    });
}

app.listen(PORT, () => {
    console.log(`Server at http://localhost:${PORT}`);
    client.initialize().catch(e => console.error('Bot init error:', e));
});