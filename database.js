const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'expenses.db');
const db = new Database(dbPath);

// Initialize tables
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        phone TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT,
        amount REAL,
        paid_by TEXT,
        date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

// 🗑️ CLEAR DATA FOR FRESH START
db.prepare("DELETE FROM expenses").run();
db.prepare("DELETE FROM users").run();

// CLEAR OLD USERS AND ADD ONLY THE 3 PARTICIPANTS
db.prepare("DELETE FROM users").run();

const users = [
    { name: 'Rokesh', phone: '919043832032' },
    { name: 'Devibalan', phone: '916379288326' },
    { name: 'Santhosh', phone: '919344464561' }
];

const insertUser = db.prepare("INSERT INTO users (name, phone) VALUES (?, ?)");
users.forEach(user => insertUser.run(user.name, user.phone));

module.exports = db;
