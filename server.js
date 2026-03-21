const express = require('express');
const cors = require('cors');
const db = require('./database');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// RENDER USES DYNAMIC PORTS
const PORT = process.env.PORT || 3000;

let botStatus = {
    ready: false,
    qr: null,
    lastUpdated: new Date()
};

const isCloud = process.env.RENDER === 'true';

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ],
        // Specify path only for local Windows, let cloud find its own
        ...(isCloud ? { executablePath: '/usr/bin/google-chrome-stable' } : { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' })
    }
});

client.on('qr', (qr) => {
    botStatus.qr = qr;
    botStatus.ready = false;
    botStatus.lastUpdated = new Date();
    console.log('New QR code generated for website.');
});

client.on('ready', () => {
    botStatus.ready = true;
    botStatus.qr = null;
    botStatus.lastUpdated = new Date();
    console.log('✅ Bot is ready.');
});

client.on('disconnected', () => {
    botStatus.ready = false;
    botStatus.lastUpdated = new Date();
    client.initialize();
});

client.initialize().catch(err => console.error('Init error:', err));

let pairingCode = null;

// Bot status API
app.get('/api/bot-status', (req, res) => {
    res.json({ ...botStatus, pairingCode });
});

// Request pairing code via API (Remote Eye Strategy - Screenshot)
app.post('/api/bot-pairing-code', async (req, res) => {
    const { phone } = req.body;
    try {
        console.log(`[PAIRING] Activating Remote Eye for ${phone}...`);
        
        const page = client.pupPage;
        if (!page) throw new Error('WhatsApp page not available. Please click "Restart Bot".');

        // 1. Restart page for clean state
        await page.reload({ waitUntil: 'networkidle0' });

        // 2. Click "Link with phone number"
        await page.evaluate(async () => {
            const el = Array.from(document.querySelectorAll('span, div, button, a'))
                        .find(e => e.innerText && e.innerText.toLowerCase().includes('link with phone number'));
            if (el) el.click();
        });
        
        await new Promise(r => setTimeout(r, 2000));

        // 3. Type number and ENTER
        await page.evaluate((ph) => {
            const input = document.querySelector('input');
            if (input) {
                input.focus();
                input.value = ph;
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, phone);
        await page.keyboard.press('Enter');

        // 4. Wait 3s and take a high-res screenshot
        console.log('[PAIRING] Capturing code image...');
        await new Promise(r => setTimeout(r, 5000));
        const screenshot = await page.screenshot({ encoding: 'base64' });

        pairingCode = `data:image/png;base64,${screenshot}`;
        res.json({ message: 'Success', codeImg: pairingCode });
    } catch (err) {
        console.error('[PAIRING] FAILED:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Restart bot trigger
app.post('/api/bot-restart', (req, res) => {
    botStatus.qr = null;
    pairingCode = null;
    client.initialize();
    res.json({ message: 'Bot restart initiated' });
});

app.post('/api/expenses', (req, res) => {
    const { description, amount, paid_by, date } = req.body;
    try {
        const stmt = db.prepare('INSERT INTO expenses (description, amount, paid_by, date) VALUES (?, ?, ?, ?)');
        const result = stmt.run(description, amount, paid_by, date);
        calculateAndNotify(description, amount, paid_by, date);
        res.json({ id: result.lastInsertRowid, message: 'Expense added successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/summaries', (req, res) => {
    try {
        const totalAmountRow = db.prepare(`SELECT SUM(amount) as total FROM expenses`).get();
        const totalAmount = totalAmountRow.total || 0;
        const userCountRow = db.prepare(`SELECT COUNT(*) as count FROM users`).get();
        const userCount = userCountRow.count || 3;
        const sharePerPerson = totalAmount / userCount;
        const rows = db.prepare(`SELECT u.name as paid_by, IFNULL(SUM(e.amount), 0) as total_spent FROM users u LEFT JOIN expenses e ON u.name = e.paid_by GROUP BY u.name`).all();
        const summaries = rows.map(row => ({
            paid_by: row.paid_by,
            total_spent: row.total_spent,
            balance: (row.total_spent - sharePerPerson).toFixed(2)
        }));
        res.json({ summaries, total_house_spent: totalAmount, share_per_person: sharePerPerson.toFixed(2) });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

app.delete('/api/expenses/:id', (req, res) => {
    const { id } = req.params;
    console.log(`[DELETE] Received rollback request for ID: ${id}`);
    try {
        const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(id);
        if (expense) {
            console.log(`[DELETE] Found expense: ${expense.description}. Deleting...`);
            const stmt = db.prepare('DELETE FROM expenses WHERE id = ?');
            stmt.run(id);
            notifyRollback(expense);
            res.json({ message: 'Expense deleted successfully' });
        } else {
            console.warn(`[DELETE] No expense found with ID: ${id}`);
            res.status(404).json({ error: 'Expense not found' });
        }
    } catch (err) {
        console.error('[DELETE] Failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

function notifyRollback(expense) {
    if (!botStatus.ready) return;
    try {
        const users = db.prepare('SELECT * FROM users').all();
        const message = `⚠️ *Expense Rolled Back* ⚠️\n\n🏡 *Item:* ${expense.description}\n💰 *Amount:* ₹${parseFloat(expense.amount).toFixed(2)}\n👤 *Originally Paid By:* ${expense.paid_by}\n📅 *Date:* ${expense.date}\n\nThis entry has been *REMOVED* from the house records. Balances have been updated.`;
        
        users.forEach(user => {
            if (user.phone) {
                client.sendMessage(`${user.phone}@c.us`, message).catch(e => console.error(e.message));
            }
        });
    } catch (err) {
        console.error('Rollback notify error:', err);
    }
}

function calculateAndNotify(desc, amount, payer, date) {
    if (!botStatus.ready) return;
    try {
        const users = db.prepare('SELECT * FROM users').all();
        const share = (amount / users.length).toFixed(2);
        const message = `💸 *New House Expense* 💸\n\n🏡 *Item:* ${desc}\n💰 *Amount:* ₹${parseFloat(amount).toFixed(2)}\n👤 *Paid By:* ${payer}\n📅 *Date:* ${date}\n\nEach share: *₹${share}*\nCheck summary at http://localhost:3000`;
        users.forEach(user => {
            if (user.phone) {
                client.sendMessage(`${user.phone}@c.us`, message).catch(e => console.error(e.message));
            }
        });
    } catch (err) {
        console.error('Notify error:', err);
    }
}

app.listen(PORT, () => console.log(`Server at http://localhost:${PORT}`));
