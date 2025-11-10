
// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg'); // <-- Импортируем Pool для PostgreSQL

const app = express();
const port = 3001; // Этот порт используется внутри Render

// --- Настройка ---
app.use(cors());
app.use(express.json());

// --- Переменные окружения ---
// Render автоматически подставит их
const WEB_API_KEY = process.env.WEB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_CHAT_ID = parseInt(process.env.CHANNEL_CHAT_ID, 10); // ID канала должен быть числом
const DATABASE_URL = process.env.DATABASE_URL; // <-- URL для подключения к БД

// --- Подключение к PostgreSQL ---
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Требуется для подключения к Render's PostgreSQL
  }
});

// --- Создание таблицы ---
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_name TEXT,
    server TEXT NOT NULL,
    car TEXT NOT NULL,
    price INTEGER NOT NULL,
    photo_file_id TEXT NOT NULL,
    file_path TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

pool.query(createTableQuery, (err, res) => {
  if (err) {
    console.error("Ошибка создания таблицы:", err);
  } else {
    console.log("Таблица 'submissions' готова к работе.");
  }
});

// --- API Эндпоинты ---

// ЭНДПОИНТ ДЛЯ ПРИЕМА ДАННЫХ ОТ БОТА
app.post('/api/submissions', async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token !== WEB_API_KEY) {
        return res.status(403).json({ message: 'Forbidden: Invalid API Key' });
    }

    const { user_id, user_name, server, car, price, photo_file_id, file_path } = req.body;

    if (!server || !car || !price || !photo_file_id) {
        return res.status(400).json({ message: 'Bad Request: Missing fields' });
    }

    const sql = `INSERT INTO submissions (user_id, user_name, server, car, price, photo_file_id, file_path) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`;
    const values = [user_id, user_name, server, car, price, photo_file_id, file_path];

    try {
        const result = await pool.query(sql, values);
        console.log(`Новая заявка добавлена с ID: ${result.rows[0].id}`);
        res.status(201).json({ message: 'Заявка успешно получена!', id: result.rows[0].id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ЭНДПОИНТ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ
app.get('/api/submissions', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM submissions WHERE status = 'pending' ORDER BY created_at DESC");
        res.json({
            message: "success",
            data: result.rows
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- ЭНДПОИНТ ДЛЯ ОДОБРЕНИЯ ---
app.post('/api/submissions/:id/approve', async (req, res) => {
    const submissionId = req.params.id;
    try {
        // 1. Находим заявку
        const findResult = await pool.query("SELECT * FROM submissions WHERE id = $1", [submissionId]);
        if (findResult.rows.length === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        const submission = findResult.rows[0];

        // 2. Отправляем в Telegram
        const caption = `🌐 Сервер: ${submission.server}\n🚗 Автомобиль: ${submission.car}\n💰 Цена: ${submission.price}\n👤 Покупатель: ${submission.user_name}`;
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            chat_id: CHANNEL_CHAT_ID,
            photo: submission.photo_file_id,
            caption: caption
        });
        console.log(`Заявка ${submissionId} отправлена в канал.`);

        // 3. Удаляем из БД
        await pool.query("DELETE FROM submissions WHERE id = $1", [submissionId]);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Ошибка при одобрении:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// --- ЭНДПОИНТ ДЛЯ ОТКЛОНЕНИЯ ---
app.post('/api/submissions/:id/reject', async (req, res) => {
    const submissionId = req.params.id;
    try {
        await pool.query("DELETE FROM submissions WHERE id = $1", [submissionId]);
        console.log(`Заявка ${submissionId} отклонена.`);
        res.status(200).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- Запуск сервера ---
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});