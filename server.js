
// server.js для API-сервера
const express = require('express');
const cors = require('cors');
const axios = require('axios'); // Убедитесь, что axios установлен
const { Pool } = require('pg');

const app = express();
const port = 3001; // Внутренний порт, который использует Render

// --- Настройка ---
app.use(cors());
app.use(express.json());

// --- Переменные окружения ---
const WEB_API_KEY = process.env.WEB_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_CHAT_ID = parseInt(process.env.CHANNEL_CHAT_ID, 10);
const DATABASE_URL = process.env.DATABASE_URL;

// --- Подключение к PostgreSQL ---
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
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

// POST: Принимаем новую заявку от бота
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

// GET: Отдаем все заявки для сайта
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

// POST: Одобряем заявку
app.post('/api/submissions/:id/approve', async (req, res) => {
    const submissionId = req.params.id;
    try {
        const findResult = await pool.query("SELECT * FROM submissions WHERE id = $1", [submissionId]);
        if (findResult.rows.length === 0) {
            return res.status(404).json({ error: 'Заявка не найдена' });
        }
        const submission = findResult.rows[0];

        const caption = `🌐 Сервер: ${submission.server}\n🚗 Автомобиль: ${submission.car}\n💰 Цена: ${submission.price}\n👤 Покупатель: ${submission.user_name}`;
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
            chat_id: CHANNEL_CHAT_ID,
            photo: submission.photo_file_id,
            caption: caption
        });
        console.log(`Заявка ${submissionId} отправлена в канал.`);

        await pool.query("DELETE FROM submissions WHERE id = $1", [submissionId]);
        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Ошибка при одобрении:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// POST: Отклоняем заявку
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

// GET: Прокси для картинок
app.get('/api/photo/:file_path', async (req, res) => {
    const { file_path } = req.params;
    const telegramUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file_path}`;

    try {
        const response = await axios({
            method: 'get',
            url: telegramUrl,
            responseType: 'stream'
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        console.error('Ошибка при получении фото из Telegram:', error.message);
        res.status(404).send('Фото не найдено');
    }
});


// --- Запуск сервера ---
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});