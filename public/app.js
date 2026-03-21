// Core State management
async function checkBotStatus() {
    const res = await fetch('/api/bot-status');
    const status = await res.json();
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const panel = document.getElementById('bot-panel');
    const entryForm = document.getElementById('entry-form');
    const codeResult = document.getElementById('code-result');
    const qrContainer = document.getElementById('qr-container');

    if (status.ready) {
        dot.className = 'status-dot connected';
        text.innerText = '● Connected';
        panel.style.display = 'none';
        entryForm.style.display = 'block';
    } else {
        dot.className = 'status-dot disconnected';
        text.innerText = '○ Bot Offline';
        panel.style.display = 'block';
        entryForm.style.display = 'none';
        
        if (status.qr && !status.pairingCode) {
            qrContainer.innerHTML = `
                <div class="p-img-container" style="background:white; padding:10px; border-radius:10px; display:inline-block;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(status.qr)}" />
                </div>
                <p style="font-size:0.8rem; margin-top:5px; opacity:0.6;">Scan QR or use phone linking below</p>
            `;
        } else if (status.pairingCode) {
            qrContainer.innerHTML = ''; // Hide QR when code is active
            codeResult.innerHTML = `
                <div class="code-box" style="background:var(--card-bg); border:2px solid var(--primary); padding:2rem; border-radius:1rem; margin:1rem 0;">
                    <div style="font-size:0.8rem; opacity:0.6; margin-bottom:0.5rem;">Linking to: ${status.pairingCodePhone || 'Your Phone'}</div>
                    <div style="font-size:2.5rem; font-weight:900; color:var(--primary); letter-spacing:6px; font-family:monospace;">${status.pairingCode}</div>
                    <p style="font-size:0.9rem; margin-top:1rem; color:var(--text-secondary);">Type this code into your WhatsApp app now!</p>
                </div>
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

document.getElementById('get-pairing-code').addEventListener('click', async () => {
    const phone = document.getElementById('partner-phone').value;
    if (!phone) return alert('Enter phone with country code');
    document.getElementById('code-result').innerHTML = '<p style="margin-top:1rem; color:var(--primary); font-weight:bold;">⚡ Bot is generating your code... (15s)</p>';
    const res = await fetch('/api/bot-pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'Unknown Error');
        document.getElementById('code-result').innerHTML = '';
        return;
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
