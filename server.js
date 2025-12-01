const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Pool } = require('pg'); // PostgreSQL
const multer = require('multer');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// --- КОНФИГУРАЦИЯ ---
const PORT = process.env.PORT || 3000;
const UPLOADS_PATH = path.join(__dirname, 'uploads');
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 дней

// --- СОЗДАНИЕ ПАПОК ---
[UPLOADS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ POSTGRESQL ---
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
    console.error("ОШИБКА: Переменная окружения DATABASE_URL не установлена.");
    // В продакшене лучше выйти, если база данных недоступна
}

const pool = new Pool({
    connectionString: DB_URL,
    // Если вы используете Render, вам может понадобиться SSL
    // ssl: { rejectUnauthorized: false } 
});

// --- АСИНХРОННЫЕ ОБЕРТКИ ДЛЯ ЗАПРОСОВ ---
// Это позволяет использовать привычные db.run, db.get, db.all, но с await
const db = {
    run: async (sql, params) => {
        const result = await pool.query(sql, params);
        return { 
            lastID: result.rows[0] ? result.rows[0].id : null, 
            changes: result.rowCount 
        };
    },
    get: async (sql, params) => {
        const result = await pool.query(sql, params);
        return result.rows[0];
    },
    all: async (sql, params) => {
        const result = await pool.query(sql, params);
        return result.rows;
    },
};

// --- ИНИЦИАЛИЗАЦИЯ/МИГРАЦИЯ БАЗЫ ДАННЫХ POSTGRESQL ---
const initializeDatabase = async () => {
    try {
        console.log("Инициализация/проверка таблиц PostgreSQL...");

        // 1. users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT DEFAULT '/img/default_avatar.svg',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 2. videos
        await pool.query(`
            CREATE TABLE IF NOT EXISTS videos (
                id SERIAL PRIMARY KEY,
                author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                title TEXT,
                description TEXT,
                filename TEXT,
                thumbnail TEXT,
                views INTEGER DEFAULT 0,
                is_18_plus INTEGER DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // 3. votes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS votes (
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                type TEXT,
                PRIMARY KEY (user_id, video_id)
            );
        `);
        // 4. subscriptions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                subscriber_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                channel_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (subscriber_id, channel_id)
            );
        `);
        // 5. comments
        await pool.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
                text TEXT,
                parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("✅ База данных PostgreSQL готова.");

    } catch (err) {
        console.error("ОШИБКА ИНИЦИАЛИЗАЦИИ БАЗЫ ДАННЫХ:", err.message);
    }
};

initializeDatabase();

// --- ФУНКЦИИ УПРАВЛЕНИЯ (Установка аккаунтов) ---
const setupInitialAccount = async () => {
    const adminUsername = 'Admin_18Plus';
    const newUsername = 'Today_Idk_New';
    
    const adminPassword = await bcrypt.hash('V_e_r_y_S_e_c_r_e_t_A_d_m_i_n_P_a_s_s_!', 10);
    const newAccountPassword = await bcrypt.hash('S_l_o_z_h_n_y_P_a_r_o_l_2_0_2_5!', 10);
    
    const accountsToCreate = [
        { username: newUsername, password: newAccountPassword, avatar: '/img/photo_2025-10-14_16-53-12.jpg' },
        { username: adminUsername, password: adminPassword, avatar: '/img/default_admin.svg' }
    ];

    for (const acc of accountsToCreate) {
        try {
            const existing = await db.get(`SELECT id FROM users WHERE username = $1`, [acc.username]);
            if (!existing) {
                await pool.query(`
                    INSERT INTO users (username, password, avatar) VALUES ($1, $2, $3)
                `, [acc.username, acc.password, acc.avatar]);
                console.log(`Создан аккаунт: ${acc.username}`);
            }
        } catch (e) {
            console.error(`Ошибка при создании ${acc.username}:`, e.message);
        }
    }
};

setupInitialAccount();

// --- MIDDLEWARE ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_PATH));

// --- MULTER (Локальная загрузка файлов) ---
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

// --- ПРОВЕРКА АВТОРИЗАЦИИ И АДМИН ПРАВ ---
const checkAuth = async (req, res, next) => {
    if (!req.cookies.user_id) return res.status(401).json({ error: 'Нужна авторизация' });
    
    try {
        const user = await db.get(`SELECT id, username, avatar FROM users WHERE id = $1`, [req.cookies.user_id]);
        if (!user) return res.status(401).json({ error: 'Недействительная сессия' });
        req.user = user;
        req.userId = user.id;
        next();
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при авторизации' });
    }
};

const checkAdminMiddleware = (req, res, next) => {
    if (!req.user || (req.user.username !== 'Today_Idk_New' && req.user.username !== 'Admin_18Plus')) {
        return res.status(403).json({ success: false, message: 'Доступ запрещен. Требуются права администратора.' });
    }
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

        const result = await pool.query(`
            INSERT INTO users (username, password, avatar) VALUES ($1, $2, $3) RETURNING id
        `, [username, hash, avatar]);
        
        const userId = result.rows[0].id;
        res.cookie('user_id', userId, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true, user_id: userId });
        
    } catch (e) {
        if(req.file) fs.unlink(req.file.path, ()=>{});
        const message = e.message.includes('unique constraint') ? "Имя пользователя занято" : e.message;
        res.json({ success: false, message: message });
    }
});

// 2. Вход (Логин)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) return res.json({ success: false, message: "Заполните поля" });

    try {
        const user = await db.get(`SELECT id, password FROM users WHERE username = $1`, [username]);
        if (!user) return res.json({ success: false, message: "Неверное имя пользователя или пароль" });
        
        const match = await bcrypt.compare(password, user.password);
        
        if (!match) return res.json({ success: false, message: "Неверное имя пользователя или пароль" });

        res.cookie('user_id', user.id, { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true, user_id: user.id });
    } catch (e) {
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

// 3. Выход (Logout)
app.get('/api/logout', (req, res) => {
    res.clearCookie('user_id');
    res.json({ success: true });
});

// 4. Получение данных текущего пользователя
app.get('/api/me', checkAuth, (req, res) => {
    res.json(req.user);
});

// 5. Загрузка видео
app.post('/api/upload', checkAuth, upload.fields([{ name: 'video' }, { name: 'thumbnail' }]), async (req, res) => {
    if (!req.files?.video || !req.files?.thumbnail) return res.status(400).json({ success: false, message: 'Нет файлов' });
    
    const { title, description, is_18_plus } = req.body;
    const isAdult = is_18_plus === 'on' ? 1 : 0; 
    const vidPath = `/uploads/${req.files.video[0].filename}`;
    const thumbPath = `/uploads/${req.files.thumbnail[0].filename}`;

    try {
        const result = await pool.query(`
            INSERT INTO videos (author_id, title, description, filename, thumbnail, is_18_plus) 
            VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [req.userId, title, description, vidPath, thumbPath, isAdult]);
        
        const videoId = result.rows[0].id;
        io.emit('new_video', { id: videoId, title, thumbnail: thumbPath });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({success: false, message: "Ошибка записи в базу данных"});
    }
});

// 6. Получение ленты видео
app.get('/api/videos', async (req, res) => {
    try {
        const rows = await db.all(`
            SELECT v.*, u.username, u.avatar as author_avatar 
            FROM videos v JOIN users u ON v.author_id = u.id 
            ORDER BY v.created_at DESC
        `, []);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 7. Получение одного видео (С комментариями, включая реплаи)
app.get('/api/video/:id', async (req, res) => {
    const videoId = req.params.id;
    const userId = req.cookies.user_id || 0;
    const viewCookie = `viewed_${videoId}`;
    
    // Защита от накрутки просмотров
    if (!req.cookies[viewCookie]) {
        try {
            // Используем RETURNING views для получения обновленного количества
            const updateResult = await db.get(`
                UPDATE videos SET views = views + 1 
                WHERE id = $1 RETURNING views
            `, [videoId]);
            
            res.cookie(viewCookie, '1', { maxAge: 3600000, httpOnly: true }); 
            
            // Если обновление прошло успешно, получаем обновленные просмотры
            if (updateResult) {
                io.emit('update_view', { id: videoId, views: updateResult.views });
            }
        } catch (e) {
            console.error("Ошибка обновления просмотров:", e.message);
        }
    }

    const videoQuery = `
        SELECT v.*, u.username, u.avatar as author_avatar, u.id as author_id,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM votes WHERE video_id = v.id AND type = 'dislike') as dislikes,
        (SELECT COUNT(*) FROM subscriptions WHERE channel_id = u.id) as subs,
        (SELECT COUNT(*) FROM subscriptions WHERE subscriber_id = $1 AND channel_id = u.id) as is_sub
        FROM videos v JOIN users u ON v.author_id = u.id WHERE v.id = $2`;

    try {
        const video = await db.get(videoQuery, [userId, videoId]);
        if (!video) return res.status(404).json({error: "Not found"});
        
        // Получаем все комментарии для видео (включая реплаи)
        const rawComments = await db.all(`
            SELECT c.*, u.username, u.avatar 
            FROM comments c JOIN users u ON c.user_id = u.id 
            WHERE video_id = $1 
            ORDER BY c.created_at ASC
        `, [videoId]);
        
        // Группировка комментариев по parent_id
        const commentsMap = {};
        const rootComments = [];
        
        rawComments.forEach(c => {
            c.replies = [];
            commentsMap[c.id] = c;
            
            if (c.parent_id) {
                if (commentsMap[c.parent_id]) {
                    commentsMap[c.parent_id].replies.push(c);
                }
            } else {
                rootComments.push(c);
            }
        });

        rootComments.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json({ video, comments: rootComments });
        
    } catch (e) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 8. Данные канала (Профиль пользователя)
app.get('/api/user/:id', async (req, res) => {
    const channelId = req.params.id;
    const userId = req.cookies.user_id || 0;
    
    try {
        const user = await db.get(`SELECT id, username, avatar FROM users WHERE id = $1`, [channelId]);
        if (!user) return res.status(404).json({ user: null });
        
        const videos = await db.all(`
            SELECT id, title, thumbnail, views, is_18_plus 
            FROM videos 
            WHERE author_id = $1 
            ORDER BY created_at DESC
        `, [channelId]);
        
        const subsCount = await db.get(`SELECT COUNT(*) as subs FROM subscriptions WHERE channel_id = $1`, [channelId]);
        const isSubscribed = await db.get(`
            SELECT COUNT(*) as is_sub 
            FROM subscriptions 
            WHERE subscriber_id = $1 AND channel_id = $2
        `, [userId, channelId]);

        res.json({ 
            user, 
            videos: videos || [],
            subs: subsCount.subs || 0, 
            is_sub: isSubscribed.is_sub > 0
        });
    } catch (e) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 9. Подписка/Отписка
app.post('/api/subscribe', checkAuth, async (req, res) => {
    const { channelId } = req.body;

    try {
        const row = await db.get(`
            SELECT * FROM subscriptions 
            WHERE subscriber_id = $1 AND channel_id = $2
        `, [req.userId, channelId]);
        
        if (row) {
            await db.run(`
                DELETE FROM subscriptions 
                WHERE subscriber_id = $1 AND channel_id = $2
            `, [req.userId, channelId]);
            res.json({ success: true, subscribed: false });
        } else {
            await db.run(`
                INSERT INTO subscriptions (subscriber_id, channel_id) 
                VALUES ($1, $2)
            `, [req.userId, channelId]);
            res.json({ success: true, subscribed: true });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

// 10. Удаление видео (Только для автора)
app.delete('/api/video/:id', checkAuth, async (req, res) => {
    const videoId = req.params.id;
    const userId = req.userId;

    try {
        const video = await db.get(`SELECT filename, thumbnail, author_id FROM videos WHERE id = $1`, [videoId]);
        if (!video) return res.status(404).json({ success: false, message: "Видео не найдено" });
        
        if (video.author_id != userId) {
            return res.status(403).json({ success: false, message: "Вы не автор этого видео" });
        }

        const deleteResult = await db.run(`DELETE FROM videos WHERE id = $1 AND author_id = $2`, [videoId, userId]);
        if (deleteResult.changes === 0) {
             return res.status(500).json({ success: false, message: "Не удалось удалить видео из БД" });
        }

        const filesToDelete = [video.filename, video.thumbnail];
        filesToDelete.forEach(filePath => {
            const fullPath = path.join(__dirname, filePath.replace('/uploads/', 'uploads/'));
            fs.unlink(fullPath, (e) => {
                if (e) console.error(`Ошибка при удалении файла ${filePath}:`, e.message);
            });
        });

        res.json({ success: true, message: "Видео удалено" });
    } catch (e) {
         res.status(500).json({ success: false, message: "Ошибка БД" });
    }
});

// 11. Переключение статуса 18+ (Только для Admin_18Plus)
app.post('/api/video/toggle_18plus/:id', checkAuth, checkAdminMiddleware, async (req, res) => {
    const videoId = req.params.id;
    
    if (req.user.username !== 'Admin_18Plus') {
        return res.status(403).json({ success: false, message: "Только Admin_18Plus может это делать" });
    }
    
    try {
        const video = await db.get(`SELECT is_18_plus FROM videos WHERE id = $1`, [videoId]);
        if (!video) return res.status(404).json({ success: false, message: "Видео не найдено" });
        
        const newState = video.is_18_plus === 1 ? 0 : 1;
        
        await db.run(`UPDATE videos SET is_18_plus = $1 WHERE id = $2`, [newState, videoId]);
        
        res.json({ success: true, is_18_plus: newState });
        io.emit('update_18plus_status', { videoId: videoId, is_18_plus: newState });
    } catch (e) {
        res.status(500).json({ success: false, message: "Ошибка обновления БД" });
    }
});

// 12. Административное удаление пользователя (Block)
app.post('/api/admin/block', checkAuth, checkAdminMiddleware, async (req, res) => {
    const { userId } = req.body;
    const targetUserId = parseInt(userId);

    if (isNaN(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ success: false, message: 'Неверный ID пользователя.' });
    }
    
    if (targetUserId === req.userId) {
        return res.status(403).json({ success: false, message: 'Нельзя удалить собственный аккаунт через эту панель.' });
    }

    try {
        // Каскадное удаление (CASCADE) должно работать в PG, 
        // но также удаляем явным образом для надежности
        await db.run('DELETE FROM users WHERE id = $1', [targetUserId]);

        return res.json({ 
            success: true, 
            message: `Пользователь ID ${targetUserId} и все связанные данные удалены.` 
        });
        
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Ошибка сервера при блокировке.' });
    }
});

// 13. Административная накрутка подписчиков (GiveSubs)
app.post('/api/admin/givesubs', checkAuth, checkAdminMiddleware, async (req, res) => {
    const { channelId, count } = req.body;
    
    const parsedChannelId = parseInt(channelId);
    const parsedCount = parseInt(count);

    if (isNaN(parsedChannelId) || parsedChannelId <= 0 || isNaN(parsedCount) || parsedCount < 1 || parsedCount > 100) {
        return res.status(400).json({ success: false, message: 'Неверные параметры ID канала или количества (1-100).' });
    }
    
    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); // Начало транзакции
            for (let i = 1; i <= parsedCount; i++) {
                // Используем отрицательные ID для фиктивных подписчиков
                const fakeSubscriberId = -1 * (Date.now() + i + parsedChannelId); 
                
                await client.query(`
                    INSERT INTO subscriptions (subscriber_id, channel_id) VALUES ($1, $2)
                    ON CONFLICT (subscriber_id, channel_id) DO NOTHING
                `, [fakeSubscriberId, parsedChannelId]);
            }
            await client.query('COMMIT'); // Фиксация транзакции
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
        
        return res.json({ 
            success: true, 
            message: `Успешно накручено ${parsedCount} фиктивных подписчиков для канала ID ${parsedChannelId}.` 
        });
        
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Ошибка сервера при накрутке подписок.' });
    }
});


// --- SOCKET.IO ---
io.on('connection', (socket) => {
    
    // Голосование (лайк/дизлайк)
    socket.on('vote', async (data) => {
        try {
            // Сначала удаляем старый голос
            await db.run(`DELETE FROM votes WHERE user_id = $1 AND video_id = $2`, [data.userId, data.videoId]);
            // Вставляем новый
            await db.run(`INSERT INTO votes (user_id, video_id, type) VALUES ($1, $2, $3)`, [data.userId, data.videoId, data.type]);
            io.emit('update_votes', { videoId: data.videoId }); 
        } catch (e) {
             console.error('Socket vote error:', e.message);
        }
    });
    
    // Добавление комментария или ответа
    socket.on('comment', async (data) => {
        const parentId = data.parentId || null; 
        
        try {
            const result = await pool.query(`
                INSERT INTO comments (user_id, video_id, text, parent_id) 
                VALUES ($1, $2, $3, $4) RETURNING id, created_at
            `, [data.userId, data.videoId, data.text, parentId]);
            
            const newCommentId = result.rows[0].id;
            const createdAt = result.rows[0].created_at;

            const user = await db.get(`SELECT username, avatar FROM users WHERE id = $1`, [data.userId]);
            
            const newComment = { 
                ...data, 
                id: newCommentId, 
                username: user.username, 
                avatar: user.avatar, 
                created_at: createdAt, 
                parent_id: parentId 
            };
            io.emit('new_comment', { videoId: data.videoId, comment: newComment });
        } catch (e) {
            console.error('Socket comment error:', e.message);
        }
    });
});

// SPA Routing (Все остальные GET запросы направляем на index.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log(`FluxTube running on port ${PORT}`));