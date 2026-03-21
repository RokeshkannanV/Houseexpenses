// Core State management
let lastState = '';

async function checkBotStatus() {
    const res = await fetch('/api/bot-status');
    const status = await res.json();
    
    // ONLY UPDATE IF THE STATE CHANGED (Prevents flickering/refreshing feel)
    const currentState = JSON.stringify(status);
    if (currentState === lastState) return;
    lastState = currentState;

    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const panel = document.getElementById('bot-panel');
    const qrContainer = document.getElementById('qr-container');

    if (status.ready) {
        dot.className = 'status-dot connected';
        text.innerText = '● Connected';
        panel.style.display = 'none';
        document.getElementById('entry-form').style.display = 'block';
    } else {
        dot.className = 'status-dot disconnected';
        text.innerText = '○ Bot Offline';
        panel.style.display = 'block';
        document.getElementById('entry-form').style.display = 'none';
        
        if (status.qr && !status.pairingCode) {
            qrContainer.innerHTML = `
                <div class="qr-box" style="background:white; padding:1rem; border-radius:1rem; display:inline-block;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(status.qr)}" />
                </div>
                <p style="font-size:0.8rem; margin-top:0.5rem; opacity:0.6;">Scan QR or use phone link below</p>
            `;
        }
    }
}

// Data Loading
async function loadData() {
    try {
        const summaryRes = await fetch('/api/summaries');
        const data = await summaryRes.json();
        const summaryGrid = document.getElementById('summary-data');
        const totalBanner = document.getElementById('total-house-banner');
        
        summaryGrid.innerHTML = data.summaries.map(u => {
            const isOwed = parseFloat(u.balance) >= 0;
            return `
                <div class="summary-small-card">
                    <span class="summary-label">${u.paid_by}</span>
                    <span class="summary-value">${parseFloat(u.total_spent).toFixed(2)}</span>
                    <span class="summary-label">${isOwed ? 'Gets Back' : 'Owes'}</span>
                    <span class="summary-value ${isOwed ? 'pos' : 'neg'}">₹${Math.abs(u.balance).toFixed(2)}</span>
                </div>
            `;
        }).join('');
        
        totalBanner.innerHTML = `
            <span class="summary-label">Total House Spend</span>
            <span class="summary-value">₹${parseFloat(data.total_house_spent).toFixed(2)}</span>
            <span class="summary-label">Everyone's Share: ₹${data.share_per_person}</span>
        `;

        const historyRes = await fetch('/api/expenses');
        const historyData = await historyRes.json();
        const historyList = document.getElementById('history-list');
        
        historyList.innerHTML = historyData.length ? historyData.map(e => `
            <div class="history-item">
                <div class="history-info">
                    <div class="desc">${e.description}</div>
                    <div class="meta">${e.paid_by} • ${e.date}</div>
                </div>
                <div style="display:flex; align-items:center; gap:1rem;">
                    <div class="history-amt">₹${parseFloat(e.amount).toFixed(2)}</div>
                    <button class="btn-delete" onclick="deleteExpense(${e.id})">🗑️</button>
                </div>
            </div>
        `).join('') : '<p style="text-align:center; opacity:0.3; padding:2rem;">No entries yet</p>';
    } catch (error) {
        console.error('Core loading failed:', error);
    }
}

async function deleteExpense(id) {
    if (!confirm('Are you sure you want to rollback this expense?')) return;
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    loadData();
}

// Handlers
document.getElementById('save-btn').addEventListener('click', async () => {
    const input = document.getElementById('speech-input').value;
    if (!input) return;

    // Simple NLP
    const parts = input.split(' ');
    const amountStr = parts.find(p => !isNaN(p));
    const amount = amountStr ? parseFloat(amountStr) : 0;
    const payer = input.toLowerCase().includes('rokesh') ? 'Rokesh' : 
                  input.toLowerCase().includes('devibalan') ? 'Devibalan' : 
                  input.toLowerCase().includes('santhosh') ? 'Santhosh' : 'Unknown';
    
    // Description is everything except amount, "spent", "by", and date words
    const description = parts.filter(p => isNaN(p) && !['spent', 'by', 'today', 'rokesh', 'devibalan', 'santhosh'].includes(p.toLowerCase())).join(' ');

    const date = new Date();
    const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            description: description || 'Miscellaneous',
            amount: amount,
            paid_by: payer,
            date: localDate
        })
    });

    document.getElementById('speech-input').value = '';
    loadData();
});

document.getElementById('get-pairing-code').addEventListener('click', async (e) => {
    e.preventDefault(); // Stop any tricky browser reloads
    const phoneInput = document.getElementById('partner-phone');
    const codeDisplay = document.getElementById('code-result');
    let phone = phoneInput.value;
    
    // Strip everything except digits in frontend too, just in case
    phone = phone.replace(/\D/g, ''); 
    
    if (!phone || phone.length < 10) {
        return alert('Please enter a valid phone number with country code (e.g. 919876543210)');
    }
    
    codeDisplay.innerHTML = '<p style="margin-top:1rem; color:var(--primary); font-weight:bold; animation:pulse 1s infinite;">⚡ Communicating with WhatsApp... this takes a few seconds.</p>';
    
    try {
        // NOTE: The endpoint was renamed to /api/request-pairing-code in the backend!
        const res = await fetch('/api/request-pairing-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        
        let data;
        try {
            data = await res.json();
        } catch (jsonErr) {
            throw new Error('Server returned an invalid response. The bot might be restarting.');
        }

        if (res.ok && data.success && data.code) {
            codeDisplay.innerHTML = `
                <div style="background:var(--card-bg); border:2px solid var(--primary); padding:1.5rem; border-radius:1rem; margin-top:1rem; animation: slideIn 0.3s ease-out;">
                    <div style="font-size:2.5rem; font-weight:900; color:var(--primary); letter-spacing:8px; text-shadow: 0 0 10px rgba(99, 102, 241, 0.3);">${data.code}</div>
                    <p style="font-size:0.8rem; margin-top:0.5rem; opacity:0.8;">Type this code on your phone now!</p>
                </div>
            `;
        } else {
            alert(data.error || 'Connection busy or invalid number. Please try again.');
            codeDisplay.innerHTML = '';
        }
    } catch (err) {
        console.error(err);
        alert(err.message || 'Network error.');
        codeDisplay.innerHTML = '';
    }
});

document.getElementById('restart-bot').addEventListener('click', async () => {
    await fetch('/api/bot-restart', { method: 'POST' });
    alert('System rebooting. Please wait.');
});

// Initialization
setInterval(checkBotStatus, 1500); // Check every 1.5 seconds for instant updates
checkBotStatus();
loadData();
