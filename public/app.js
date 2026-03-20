// Core State management
async function checkBotStatus() {
    const res = await fetch('/api/bot-status');
    const status = await res.json();
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const panel = document.getElementById('bot-panel');
    const codeResult = document.getElementById('code-result');
    const qrContainer = document.getElementById('qr-container');

    if (status.ready) {
        dot.className = 'status-dot connected';
        text.innerText = '● Connected';
        panel.style.display = 'none';
    } else {
        dot.className = 'status-dot disconnected';
        text.innerText = '○ Bot Offline';
        panel.style.display = 'block';
        
        if (status.qr) {
            qrContainer.innerHTML = `
                <div class="p-img-container">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(status.qr)}" />
                </div>
                <p style="font-size:0.8rem; opacity:0.6;">Scan QR or use phone linking below</p>
            `;
        }

        if (status.pairingCode) {
            codeResult.innerHTML = `
                <div class="p-img-container">
                    <img src="${status.pairingCode}" style="max-width:100%;" />
                </div>
                <p style="font-size:0.8rem; color:var(--primary);">Read the 8-digit code from this screenshot</p>
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
    document.getElementById('code-result').innerHTML = '<p style="margin-top:1rem; opacity:0.5;">Activating Remote Eye... please wait</p>';
    await fetch('/api/bot-pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
    });
});

document.getElementById('restart-bot').addEventListener('click', async () => {
    await fetch('/api/bot-restart', { method: 'POST' });
    alert('System rebooting. Please wait.');
});

// Initialization
setInterval(checkBotStatus, 4000);
checkBotStatus();
loadData();
