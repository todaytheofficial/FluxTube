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

// --- КОНФИГУРАЦИЯ ---
const PORT = 3000;
const DB_PATH = './database/video_hosting.db';
const UPLOADS_PATH = path.join(__dirname, 'uploads');
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 дней

// --- СОЗДАНИЕ ПАПОК ---
[path.dirname(DB_PATH), UPLOADS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- MIDDLEWARE (Порядок важен!) ---
app.use(express.json({ limit: '50mb' })); // Для JSON тела (логин, подписки)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_PATH));

// --- БАЗА ДАННЫХ ---
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, avatar TEXT DEFAULT '/img/default_avatar.svg', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS videos (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT, description TEXT, filename TEXT, thumbnail TEXT, views INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(author_id) REFERENCES users(id))`);
    db.run(`CREATE TABLE IF NOT EXISTS votes (user_id INTEGER, video_id INTEGER, type TEXT, PRIMARY KEY (user_id, video_id))`);
    db.run(`CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY, user_id INTEGER, video_id INTEGER, text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS subscriptions (subscriber_id INTEGER, channel_id INTEGER, PRIMARY KEY (subscriber_id, channel_id))`);
});

// --- MULTER (Загрузка файлов с очисткой имен) ---
// Функция удаляет кириллицу и спецсимволы, оставляя безопасное имя
const sanitizeFilename = (filename) => {
    return filename.replace(/[^a-zA-Z0-9.\-]/g, '_').replace(/_+/g, '_');
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_PATH),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = sanitizeFilename(path.basename(file.originalname, ext));
        cb(null, Date.now() + '-' + name + ext);
    }
});
const upload = multer({ storage });

// --- ПРОВЕРКА АВТОРИЗАЦИИ ---
const checkAuth = (req, res, next) => {
    if (!req.cookies.user_id) return res.status(401).json({ error: 'Нужна авторизация' });
    req.userId = req.cookies.user_id;
    next();
};

// --- API РОУТЫ ---

// 1. Регистрация
app.post('/api/register', upload.single('avatar'), async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) throw new Error("Заполните поля");
        
        const avatar = req.file ? `/uploads/${req.file.filename}` : '/img/default_avatar.svg';
        const hash = await bcrypt.hash(password, 10);

        db.run(`INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)`, [username, hash, avatar], function(err) {
            if (err) return res.json({ success: false, message: "Имя пользователя занято" });
            res.cookie('user_id', this.lastID, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
            res.json({ success: true, user_id: this.lastID });
        });
    } catch (e) {
        if(req.file) fs.unlink(req.file.path, ()=>{});
        res.json({ success: false, message: e.message });
    }
});

// 2. Вход
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false, message: "Неверные данные" });
        }
        res.cookie('user_id', user.id, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true });
    });
});

// 3. Выход (Logout)
app.get('/api/logout', (req, res) => {
    res.clearCookie('user_id');
    res.json({ success: true });
});

// 4. Текущий пользователь
app.get('/api/me', checkAuth, (req, res) => {
    db.get(`SELECT id, username, avatar FROM users WHERE id = ?`, [req.userId], (err, row) => res.json(row));
});

// 5. Загрузка видео
app.post('/api/upload', checkAuth, upload.fields([{ name: 'video' }, { name: 'thumbnail' }]), (req, res) => {
    if (!req.files?.video || !req.files?.thumbnail) return res.status(400).json({ success: false, message: 'Нет файлов' });
    
    const { title, description } = req.body;
    const vidPath = `/uploads/${req.files.video[0].filename}`;
    const thumbPath = `/uploads/${req.files.thumbnail[0].filename}`;

    db.run(`INSERT INTO videos (author_id, title, description, filename, thumbnail) VALUES (?, ?, ?, ?, ?)`, 
        [req.userId, title, description, vidPath, thumbPath], function(err) {
            if(err) return res.status(500).json({success: false});
            io.emit('new_video', { id: this.lastID, title, thumbnail: thumbPath });
            res.json({ success: true });
    });
});

// 6. Получение ленты видео
app.get('/api/videos', (req, res) => {
    db.all(`SELECT v.*, u.username, u.avatar as author_avatar FROM videos v JOIN users u ON v.author_id = u.id ORDER BY v.created_at DESC`, [], (err, rows) => res.json(rows));
});

// 7. Получение одного видео (С защитой от накрутки)
app.get('/api/video/:id', (req, res) => {
    const videoId = req.params.id;
    const userId = req.cookies.user_id || 0;
    const viewCookie = `viewed_${videoId}`;
    
    // Если куки просмотра нет, засчитываем просмотр
    if (!req.cookies[viewCookie]) {
        db.run(`UPDATE videos SET views = views + 1 WHERE id = ?`, [videoId]);
        res.cookie(viewCookie, '1', { maxAge: 3600000, httpOnly: true }); // 1 час
    }

    const query = `
        SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes,
        (SELECT COUNT(*) FROM subscriptions WHERE channel_id = u.id) as subs,
        (SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = ? AND channel_id = u.id) as is_sub
        FROM videos v JOIN users u ON v.author_id = u.id WHERE v.id = ?`;

    db.get(query, [userId, videoId], (err, video) => {
        if (!video) return res.status(404).json({error: "Not found"});
        db.all(`SELECT c.*, u.username, u.avatar FROM comments c JOIN users u ON c.user_id = u.id WHERE video_id = ? ORDER BY c.created_at DESC`, [videoId], (err, comments) => {
            res.json({ video, comments });
            // Обновляем сокет, только если просмотр был засчитан реально
            if (!req.cookies[viewCookie]) {
                io.emit('update_view', { id: videoId, views: video.views + 1 });
            }
        });
    });
});

// 8. Данные канала (Профиль пользователя)
app.get('/api/user/:id', (req, res) => {
    const channelId = req.params.id;
    const userId = req.cookies.user_id || 0;
    
    db.get(`SELECT id, username, avatar FROM users WHERE id = ?`, [channelId], (err, user) => {
        if (!user) return res.status(404).json({ user: null });
        
        db.all(`SELECT id, title, thumbnail, views FROM videos WHERE author_id = ? ORDER BY created_at DESC`, [channelId], (err, videos) => {
            db.get(`SELECT COUNT(*) as subs FROM subscriptions WHERE channel_id = ?`, [channelId], (err, sc) => {
                db.get(`SELECT COUNT(*) as is_sub FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`, [userId, channelId], (err, isSub) => {
                    res.json({ user, videos, subs: sc.subs, is_sub: isSub.is_sub > 0 });
                });
            });
        });
    });
});

// 9. Подписка
app.post('/api/subscribe', checkAuth, (req, res) => {
    const { channelId } = req.body;
    if (req.userId == channelId) return res.json({ success: false, message: "Нельзя подписаться на себя" });

    db.get(`SELECT * FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`, [req.userId, channelId], (err, row) => {
        if (row) {
            db.run(`DELETE FROM subscriptions WHERE subscriber_id = ? AND channel_id = ?`, [req.userId, channelId]);
            res.json({ success: true, subscribed: false });
        } else {
            db.run(`INSERT INTO subscriptions VALUES (?, ?)`, [req.userId, channelId]);
            res.json({ success: true, subscribed: true });
        }
    });
});

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('vote', (data) => {
        db.run(`DELETE FROM votes WHERE user_id = ? AND video_id = ?`, [data.userId, data.videoId], () => {
            db.run(`INSERT INTO votes (user_id, video_id, type) VALUES (?, ?, ?)`, [data.userId, data.videoId, data.type], () => {
                // В реальном проекте тут нужен пересчет лайков из БД
                io.emit('update_votes', { videoId: data.videoId }); 
            });
        });
    });
    
    socket.on('comment', (data) => {
        db.run(`INSERT INTO comments (user_id, video_id, text) VALUES (?, ?, ?)`, [data.userId, data.videoId, data.text], function() {
            db.get(`SELECT username, avatar FROM users WHERE id = ?`, [data.userId], (err, u) => {
                io.emit('new_comment', { videoId: data.videoId, comment: { ...data, id: this.lastID, username: u.username, avatar: u.avatar, created_at: new Date() }});
            });
        });
    });
});

app.get('', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`FluxTube running on port ${PORT}`));