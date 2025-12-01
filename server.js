// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- НАСТРОЙКА ПУТЕЙ И ПЕРЕМЕННЫХ ---
const PORT = 3000;
const DB_PATH = './database/video_hosting.db';
const UPLOADS_PATH = path.join(__dirname, 'uploads');
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 дней

// --- НАСТРОЙКА Express и ЛИМИТОВ ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// --- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ ПАПОК ---
const dbDir = path.dirname(DB_PATH);
['database', 'uploads'].forEach(dir => {
    const fullPath = (dir === 'database') ? dbDir : UPLOADS_PATH;
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        console.log(`Папка ${dir} создана.`);
    }
});

// 1. Обслуживание статических файлов из public
app.use(express.static('public'));

// 2. Обслуживание загруженных файлов по URL /uploads
app.use('/uploads', express.static(UPLOADS_PATH)); 


// --- БАЗА ДАННЫХ (SQLite) ---
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    // Пользователи (структура таблицы уже была верной)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT DEFAULT '/img/default_avatar.svg',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Видео (структура таблицы уже была верной)
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

    // Лайки/Дизлайки (структура таблицы уже была верной)
    db.run(`CREATE TABLE IF NOT EXISTS votes (
        user_id INTEGER,
        video_id INTEGER,
        type TEXT, -- 'like' или 'dislike'
        PRIMARY KEY (user_id, video_id)
    )`);

    // Комментарии (структура таблицы уже была верной)
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        video_id INTEGER,
        text TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Подписки (структура таблицы уже была верной)
    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
        subscriber_id INTEGER,
        channel_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (subscriber_id, channel_id),
        FOREIGN KEY(subscriber_id) REFERENCES users(id),
        FOREIGN KEY(channel_id) REFERENCES users(id)
    )`);
});

// --- НАСТРОЙКА MULTER ДЛЯ ЗАГРУЗКИ ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s/g, '_')) // Замена пробелов
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
    
    if(!username || !password) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.json({success: false, message: "Заполните поля"});
    }

    const hash = await bcrypt.hash(password, 10);
    
    db.run(`INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)`, 
        [username, hash, avatar], 
        function(err) {
            if (err) {
                if (req.file) fs.unlink(req.file.path, () => {});
                // Код 19 - UNIQUE constraint failed
                if (err.errno === 19) {
                     return res.json({ success: false, message: "Пользователь с таким именем уже существует" });
                }
                console.error('Ошибка БД при регистрации:', err);
                return res.status(500).json({ success: false, message: "Ошибка сервера" });
            }
            res.cookie('user_id', this.lastID, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
            res.json({ success: true, user_id: this.lastID, avatar, username });
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
        res.cookie('user_id', user.id, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true, user: { id: user.id, username: user.username, avatar: user.avatar } });
    });
});

// Выход
app.post('/api/logout', (req, res) => {
    res.clearCookie('user_id', { path: '/' });
    res.json({ success: true });
});

// Подписка/Отписка
app.post('/api/subscribe', checkAuth, (req, res) => {
    const { channelId } = req.body;
    const subscriberId = req.userId;

    if (parseInt(subscriberId) === parseInt(channelId)) {
        return res.json({ success: false, message: "Нельзя подписаться на себя." });
    }

    db.get(`SELECT * FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`, 
        [subscriberId, channelId], 
        (err, row) => {
            if (row) {
                // Отписка
                db.run(`DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`, 
                    [subscriberId, channelId], 
                    () => res.json({ success: true, is_subscribed: false })
                );
            } else {
                // Подписка
                db.run(`INSERT INTO subscriptions (subscriber_id, channel_id) VALUES (?, ?)`, 
                    [subscriberId, channelId], 
                    () => res.json({ success: true, is_subscribed: true })
                );
            }
        }
    );
});


// Получение текущего пользователя
app.get('/api/me', (req, res) => {
    const userId = req.cookies.user_id;
    if (!userId) return res.json(null);
    db.get(`SELECT id, username, avatar FROM users WHERE id = ?`, [userId], (err, row) => {
        res.json(row || null);
    });
});


// Загрузка видео
app.post('/api/upload', checkAuth, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
    const { title, description } = req.body;
    
    if (!req.files || !req.files['video'] || !req.files['thumbnail'] || !title) {
        // Удаляем загруженные файлы, если произошла ошибка
        if (req.files && req.files['video']) fs.unlink(req.files['video'][0].path, () => {});
        if (req.files && req.files['thumbnail']) fs.unlink(req.files['thumbnail'][0].path, () => {});
        return res.status(400).json({ success: false, message: "Заголовок, видео и обложка обязательны." });
    }

    const videoFile = req.files['video'][0].filename;
    const thumbFile = req.files['thumbnail'][0].filename;

    db.run(`INSERT INTO videos (author_id, title, description, filename, thumbnail) VALUES (?, ?, ?, ?, ?)`,
        [req.userId, title, description, `/uploads/${videoFile}`, `/uploads/${thumbFile}`],
        function(err) {
            if(err) {
                fs.unlink(path.join(UPLOADS_PATH, videoFile), () => {});
                fs.unlink(path.join(UPLOADS_PATH, thumbFile), () => {});
                console.error('Ошибка БД при сохранении видео:', err);
                return res.status(500).json({success: false, message: "Ошибка базы данных при сохранении видео."});
            }
            
            // Отправляем уведомление о новом видео
            db.get(`SELECT username, avatar FROM users WHERE id = ?`, [req.userId], (err, user) => {
                 io.emit('new_video', { 
                    id: this.lastID, 
                    title, 
                    thumbnail: `/uploads/${thumbFile}`,
                    username: user.username,
                    author_avatar: user.avatar,
                    views: 0,
                    created_at: new Date().toISOString()
                 });
            });

            res.json({ success: true });
        }
    );
});

// Получение видео (лента)
app.get('/api/videos', (req, res) => {
    const query = `
        SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes
        FROM videos v JOIN users u ON v.author_id = u.id 
        ORDER BY v.created_at DESC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Ошибка получения видео:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.json(rows);
    });
});

// Данные одного видео (с подписчиками и статусом подписки)
app.get('/api/video/:id', (req, res) => {
    const videoId = req.params.id;
    const currentUserId = req.cookies.user_id || 0; 
    
    // Увеличиваем просмотры
    db.run(`UPDATE videos SET views = views + 1 WHERE id = ?`, [videoId], function(err) {
        // Логика просмотра должна работать, даже если счетчик не обновился
    });
    
    const query = `
        SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes,
        (SELECT COUNT(*) FROM subscriptions WHERE channel_id = u.id) as subscriber_count,
        (SELECT type FROM votes WHERE user_id = ? AND video_id = v.id) as user_vote_type,
        (SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = ? AND channel_id = u.id) as is_subscribed
        FROM videos v 
        JOIN users u ON v.author_id = u.id
        WHERE v.id = ?
    `;
    
    db.get(query, [currentUserId, currentUserId, videoId], (err, video) => {
        if(err || !video) return res.status(404).json({error: "Video not found"});
        
        // Отправляем обновление счетчика просмотров в реальном времени
        io.emit('update_view_count', { videoId, views: video.views + 1 });
        
        db.all(`SELECT c.*, u.username, u.avatar FROM comments c 
                JOIN users u ON c.user_id = u.id 
                WHERE video_id = ? ORDER BY c.created_at DESC`, [videoId], (err, comments) => {
            res.json({ video, comments });
        });
    });
});

// Данные канала (для страницы канала)
app.get('/api/channel/:id', (req, res) => {
    const channelId = req.params.id;
    const currentUserId = req.cookies.user_id || 0;

    const channelQuery = `
        SELECT id, username, avatar, created_at,
        (SELECT COUNT(*) FROM subscriptions WHERE channel_id = id) as subscriber_count,
        (SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = ? AND channel_id = id) as is_subscribed
        FROM users WHERE id = ?
    `;

    db.get(channelQuery, [currentUserId, channelId], (err, channel) => {
        if (err || !channel) return res.status(404).json({ error: "Channel not found" });

        // Получаем видео этого канала
        const videosQuery = `
            SELECT v.*, 
            (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
            (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes
            FROM videos v 
            WHERE author_id = ? 
            ORDER BY created_at DESC`;
        
        db.all(videosQuery, [channelId], (err, videos) => {
            res.json({ channel, videos });
        });
    });
});


// --- URL Routing для SPA (Single Page Application) ---
// Все маршруты, которые не являются API, возвращают index.html
app.get(['/channel/:id', '/watch/:id', '/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- SOCKET.IO REALTIME ---
io.on('connection', (socket) => {
    console.log('Пользователь подключился к сокету.');
    
    // ... (Обработчики 'vote' и 'send_comment' остаются без изменений)
    socket.on('vote', async (data) => {
        const { videoId, type, userId } = data;
        
        db.get(`SELECT type FROM votes WHERE user_id = ? AND video_id = ?`, [userId, videoId], (err, row) => {
            let action = 'none'; // 'add', 'remove', 'change'
            if (row) {
                if (row.type === type) {
                    db.run(`DELETE FROM votes WHERE user_id = ? AND video_id = ?`, [userId, videoId]);
                    action = 'remove';
                } else {
                    db.run(`UPDATE votes SET type = ? WHERE user_id = ? AND video_id = ?`, [type, userId, videoId]);
                    action = 'change';
                }
            } else {
                db.run(`INSERT INTO votes (user_id, video_id, type) VALUES (?, ?, ?)`, [userId, videoId, type]);
                action = 'add';
            }

            // Отправляем обновленные счетчики и статус голосования пользователю
            setTimeout(() => {
                 db.get(`SELECT 
                     (SELECT COUNT(*) FROM votes WHERE video_id = ? AND type = 'like') as likes,
                     (SELECT COUNT(*) FROM votes WHERE video_id = ? AND type = 'dislike') as dislikes
                   `, [videoId, videoId], (err, stats) => {
                       // Отправляем всем клиентам обновленные счетчики
                       io.emit('update_votes', { videoId, ...stats });
                       // Отправляем только голосующему пользователю его новый статус
                       socket.emit('my_vote_status', { videoId, type: action === 'remove' ? 'none' : type });
                   });
            }, 50); 
        });
    });

    socket.on('send_comment', (data) => {
        const { videoId, userId, text } = data;
        
        if (!text || !userId || !videoId) return;

        db.run(`INSERT INTO comments (user_id, video_id, text) VALUES (?, ?, ?)`, [userId, videoId, text], function() {
            db.get(`SELECT username, avatar FROM users WHERE id = ?`, [userId], (err, user) => {
                if (err || !user) return;
                
                io.emit('new_comment', { 
                    videoId, 
                    comment: { 
                        id: this.lastID, 
                        text, 
                        username: user.username, 
                        avatar: user.avatar, 
                        created_at: new Date().toISOString() 
                    } 
                });
            });
        });
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился от сокета.');
    });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));