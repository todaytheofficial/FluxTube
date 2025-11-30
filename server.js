// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs'); // Для работы с файловой системой

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- НАСТРОЙКА ---
const PORT = 3000;
const DB_PATH = './database/video_hosting.db';
const UPLOADS_PATH = path.join(__dirname, 'uploads');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// --- НАСТРОЙКА СТАТИЧЕСКИХ ФАЙЛОВ И АВТОСОЗДАНИЕ ПАПОК --

// Проверяем и создаем папку database
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)){
    fs.mkdirSync(dbDir);
    console.log('Папка database создана.');
}

// Проверяем и создаем папку uploads
if (!fs.existsSync(UPLOADS_PATH)){
    fs.mkdirSync(UPLOADS_PATH);
    console.log('Папка uploads создана.');
}

// 1. Обслуживание статических файлов из public (HTML, CSS, Frontend JS)
app.use(express.static('public'));

// 2. Обслуживание загруженных файлов по URL /uploads (Видео, Обложки, Аватары)
app.use('/uploads', express.static(UPLOADS_PATH)); 


// --- БАЗА ДАННЫХ (SQLite) ---
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // Пользователи
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT DEFAULT '/img/default_avatar.svg',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Видео
    db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id INTEGER,
        title TEXT,
        description TEXT,
        filename TEXT,
        thumbnail TEXT,
        views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(author_id) REFERENCES users(id)
    )`);

    // Лайки/Дизлайки (Уникальный ключ по user_id + video_id предотвращает дюпы)
    db.run(`CREATE TABLE IF NOT EXISTS votes (
        user_id INTEGER,
        video_id INTEGER,
        type TEXT, -- 'like' или 'dislike'
        PRIMARY KEY (user_id, video_id)
    )`);

    // Комментарии
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        video_id INTEGER,
        text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// --- НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// --- MIDDLEWARE АВТОРИЗАЦИИ ---
const checkAuth = (req, res, next) => {
    const userId = req.cookies.user_id;
    if (!userId) return res.status(401).json({ error: 'Не авторизован' });
    req.userId = userId;
    next();
};

// --- API РОУТЫ ---

// Регистрация
app.post('/api/register', upload.single('avatar'), async (req, res) => {
    const { username, password } = req.body;
    const avatar = req.file ? `/uploads/${req.file.filename}` : '/img/default_avatar.svg';
    
    if(!username || !password) return res.json({success: false, message: "Заполните поля"});

    const hash = await bcrypt.hash(password, 10);
    
    db.run(`INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)`, 
        [username, hash, avatar], 
        function(err) {
            if (err) return res.json({ success: false, message: "Пользователь с таким именем уже существует" });
            res.cookie('user_id', this.lastID, { httpOnly: true });
            res.json({ success: true, user_id: this.lastID });
        }
    );
});

// Вход
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false, message: "Неверный логин или пароль" });
        }
        res.cookie('user_id', user.id, { httpOnly: true });
        res.json({ success: true, user: user });
    });
});

// Получение текущего пользователя
app.get('/api/me', checkAuth, (req, res) => {
    db.get(`SELECT id, username, avatar FROM users WHERE id = ?`, [req.userId], (err, row) => {
        res.json(row);
    });
});

// Обновление аватарки
app.post('/api/update-avatar', checkAuth, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.json({ success: false });
    const newAvatar = `/uploads/${req.file.filename}`;
    db.run(`UPDATE users SET avatar = ? WHERE id = ?`, [newAvatar, req.userId], (err) => {
        res.json({ success: true, avatar: newAvatar });
    });
});

// Загрузка видео
app.post('/api/upload', checkAuth, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
    const { title, description } = req.body;
    
    // Проверка наличия файлов
    if (!req.files || !req.files['video'] || !req.files['thumbnail']) {
        return res.status(400).json({ success: false, message: "Отсутствует видео или обложка." });
    }

    const videoFile = req.files['video'][0].filename;
    const thumbFile = req.files['thumbnail'][0].filename;

    db.run(`INSERT INTO videos (author_id, title, description, filename, thumbnail) VALUES (?, ?, ?, ?, ?)`,
        [req.userId, title, description, `/uploads/${videoFile}`, `/uploads/${thumbFile}`],
        function(err) {
            if(err) {
                console.error("DB Error on upload:", err);
                return res.status(500).json({success: false, message: "Ошибка базы данных при сохранении видео."});
            }
            // Уведомляем всех через Socket.io о новом видео
            io.emit('new_video', { id: this.lastID, title, thumbnail: `/uploads/${thumbFile}` });
            res.json({ success: true });
        }
    );
});

// Получение видео (лента)
app.get('/api/videos', (req, res) => {
    db.all(`SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id 
            FROM videos v JOIN users u ON v.author_id = u.id 
            ORDER BY v.created_at DESC`, [], (err, rows) => {
        res.json(rows);
    });
});

// Данные одного видео
app.get('/api/video/:id', (req, res) => {
    const videoId = req.params.id;
    
    // Считаем просмотр (без проверки уникальности, просто +1)
    db.run(`UPDATE videos SET views = views + 1 WHERE id = ?`, [videoId]);
    
    // Получаем данные
    const query = `
        SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes
        FROM videos v 
        JOIN users u ON v.author_id = u.id
        WHERE v.id = ?
    `;
    
    db.get(query, [videoId], (err, video) => {
        if(err || !video) return res.status(404).json({error: "Video not found"});
        
        // Получаем комментарии
        db.all(`SELECT c.*, u.username, u.avatar FROM comments c 
                JOIN users u ON c.user_id = u.id 
                WHERE video_id = ? ORDER BY c.created_at DESC`, [videoId], (err, comments) => {
            res.json({ video, comments });
            
            // Обновляем счетчик просмотров в реальном времени у всех пользователей
            io.emit('update_view_count', { videoId, views: video.views + 1 });
        });
    });
});

// --- URL Routing для SPA ---
// Отдаем index.html для всех кастомных роутов, фронтенд обрабатывает их через JS (History API)
app.get('/:channelName/:channelId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/watch/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SOCKET.IO REALTIME ---
io.on('connection', (socket) => {
    // Обработка Лайков/Дизлайков
    socket.on('vote', async (data) => {
        const { videoId, type, userId } = data;
        
        db.get(`SELECT type FROM votes WHERE user_id = ? AND video_id = ?`, [userId, videoId], (err, row) => {
            if (row) {
                if (row.type === type) {
                    // Если голос тот же — удаляем (отмена голоса)
                    db.run(`DELETE FROM votes WHERE user_id = ? AND video_id = ?`, [userId, videoId]);
                } else {
                    // Если голос другой — обновляем (смена лайка на дизлайк и наоборот)
                    db.run(`UPDATE votes SET type = ? WHERE user_id = ? AND video_id = ?`, [type, userId, videoId]);
                }
            } else {
                // Новый голос
                db.run(`INSERT INTO votes (user_id, video_id, type) VALUES (?, ?, ?)`, [userId, videoId, type]);
            }

            // Отправляем обновленные счетчики всем клиентам
            setTimeout(() => {
                 db.get(`SELECT 
                    (SELECT COUNT(*) FROM votes WHERE video_id = ? AND type = 'like') as likes,
                    (SELECT COUNT(*) FROM votes WHERE video_id = ? AND type = 'dislike') as dislikes
                 `, [videoId, videoId], (err, stats) => {
                     io.emit('update_votes', { videoId, ...stats });
                 });
            }, 50); // Небольшая задержка, чтобы БД успела обновиться
        });
    });

    // Обработка Комментариев
    socket.on('send_comment', (data) => {
        const { videoId, userId, text } = data;
        
        db.run(`INSERT INTO comments (user_id, video_id, text) VALUES (?, ?, ?)`, [userId, videoId, text], function() {
            // Получаем инфо о юзере для отображения
            db.get(`SELECT username, avatar FROM users WHERE id = ?`, [userId], (err, user) => {
                if (err || !user) return;
                
                // Отправляем новый комментарий всем
                io.emit('new_comment', { 
                    videoId, 
                    comment: { 
                        id: this.lastID, 
                        text, 
                        username: user.username, 
                        avatar: user.avatar, 
                        created_at: new Date().toISOString() // Отправляем в ISO для правильного отображения времени
                    } 
                });
            });
        });
    });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));