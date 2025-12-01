const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose'); // Использование Mongoose для MongoDB
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
const MONGO_URI = process.env.MONGO_URI; // ОБЯЗАТЕЛЬНО: Строка подключения к MongoDB Atlas
const UPLOADS_PATH = path.join(__dirname, 'uploads');
const COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 дней

// --- СОЗДАНИЕ ПАПОК ---
[UPLOADS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- ПОДКЛЮЧЕНИЕ К MONGODB ---
const connectDB = async () => {
    if (!MONGO_URI) {
        console.error("ОШИБКА: Переменная окружения MONGO_URI не установлена. База данных не подключена.");
        // В продакшене лучше process.exit(1);
        return;
    }
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ MongoDB подключен успешно.");
    } catch (err) {
        console.error("ОШИБКА ПОДКЛЮЧЕНИЯ К MONGODB:", err.message);
    }
};

connectDB();

// --- СХЕМЫ И МОДЕЛИ MONGOOSE ---

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '/img/default_avatar.svg' },
    createdAt: { type: Date, default: Date.now }
});

const videoSchema = new mongoose.Schema({
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: String,
    description: String,
    filename: String, // Локальный путь к видеофайлу (для S3/Cloudinary нужно изменить)
    thumbnail: String, // Локальный путь к обложке
    views: { type: Number, default: 0 },
    is18Plus: { type: Number, default: 0 }, // 0 или 1
    createdAt: { type: Date, default: Date.now }
});

const voteSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
    type: { type: String, enum: ['like', 'dislike'], required: true }
}, { unique: true }); // Mongoose не поддерживает compound unique key в схеме, используем .index()

voteSchema.index({ userId: 1, videoId: 1 }, { unique: true });

const subscriptionSchema = new mongoose.Schema({
    subscriberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});

subscriptionSchema.index({ subscriberId: 1, channelId: 1 }, { unique: true });

const commentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
    text: String,
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Video = mongoose.model('Video', videoSchema);
const Vote = mongoose.model('Vote', voteSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Comment = mongoose.model('Comment', commentSchema);

// --- ФУНКЦИИ УПРАВЛЕНИЯ (Установка аккаунтов) ---
const setupInitialAccount = async () => {
    if (mongoose.connection.readyState !== 1) return; // Не запускаем, если нет подключения

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
            const existing = await User.findOne({ username: acc.username });
            if (!existing) {
                await User.create(acc);
                console.log(`Создан аккаунт: ${acc.username}`);
            }
        } catch (e) {
            console.error(`Ошибка при создании ${acc.username}:`, e.message);
        }
    }
};

mongoose.connection.on('connected', setupInitialAccount); // Запуск после подключения к БД

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
        const user = await User.findById(req.cookies.user_id).select('id username avatar');
        if (!user) return res.status(401).json({ error: 'Недействительная сессия' });
        req.user = user.toObject();
        req.userId = user._id;
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

        const newUser = await User.create({ username, password: hash, avatar });
        
        res.cookie('user_id', newUser._id.toString(), { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true, user_id: newUser._id.toString() });
        
    } catch (e) {
        if(req.file) fs.unlink(req.file.path, ()=>{});
        const message = e.code === 11000 ? "Имя пользователя занято" : e.message;
        res.json({ success: false, message: message });
    }
});

// 2. Вход (Логин)
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) return res.json({ success: false, message: "Заполните поля" });

    try {
        const user = await User.findOne({ username });
        if (!user) return res.json({ success: false, message: "Неверное имя пользователя или пароль" });
        
        const match = await bcrypt.compare(password, user.password);
        
        if (!match) return res.json({ success: false, message: "Неверное имя пользователя или пароль" });

        res.cookie('user_id', user._id.toString(), { httpOnly: true, maxAge: COOKIE_MAX_AGE });
        res.json({ success: true, user_id: user._id.toString() });
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
        const newVideo = await Video.create({
            authorId: req.userId,
            title,
            description,
            filename: vidPath,
            thumbnail: thumbPath,
            is18Plus: isAdult
        });
        
        io.emit('new_video', { id: newVideo._id.toString(), title, thumbnail: thumbPath });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({success: false, message: "Ошибка записи в базу данных"});
    }
});

// 6. Получение ленты видео
app.get('/api/videos', async (req, res) => {
    try {
        // Используем populate для подтягивания данных автора
        const videos = await Video.find({})
            .sort({ createdAt: -1 })
            .populate('authorId', 'username avatar'); // Включаем username и avatar автора
            
        // Форматируем результат для соответствия старому API
        const formattedVideos = videos.map(v => ({
            ...v.toObject(),
            id: v._id.toString(),
            author_id: v.authorId._id.toString(),
            username: v.authorId.username,
            author_avatar: v.authorId.avatar,
            is_18_plus: v.is18Plus // Соответствие старому имени ключа
        }));

        res.json(formattedVideos);
    } catch (e) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 7. Получение одного видео (С комментариями, включая реплаи)
app.get('/api/video/:id', async (req, res) => {
    const videoId = req.params.id;
    const userId = req.cookies.user_id || null;
    const viewCookie = `viewed_${videoId}`;
    
    try {
        // 1. Обновление просмотров
        if (!req.cookies[viewCookie]) {
            const updatedVideo = await Video.findByIdAndUpdate(
                videoId,
                { $inc: { views: 1 } },
                { new: true, select: 'views' }
            );
            res.cookie(viewCookie, '1', { maxAge: 3600000, httpOnly: true }); 
            if (updatedVideo) {
                io.emit('update_view', { id: videoId, views: updatedVideo.views });
            }
        }
        
        // 2. Получение данных видео с агрегацией (лайки, подписки)
        const videoAggregation = await Video.aggregate([
            { $match: { _id: new mongoose.Types.ObjectId(videoId) } },
            { $lookup: { from: 'users', localField: 'authorId', foreignField: '_id', as: 'author' } },
            { $unwind: '$author' },
            { $lookup: { from: 'votes', localField: '_id', foreignField: 'videoId', as: 'votes' } },
            { $lookup: { from: 'subscriptions', localField: 'authorId', foreignField: 'channelId', as: 'subscriptions' } },
            { $addFields: {
                likes: { $size: { $filter: { input: '$votes', as: 'vote', cond: { $eq: ['$$vote.type', 'like'] } } } },
                dislikes: { $size: { $filter: { input: '$votes', as: 'vote', cond: { $eq: ['$$vote.type', 'dislike'] } } } },
                subs: { $size: '$subscriptions' },
                is_sub: { 
                    $size: { 
                        $filter: { 
                            input: '$subscriptions', 
                            as: 'sub', 
                            cond: { $eq: ['$$sub.subscriberId', new mongoose.Types.ObjectId(userId)] } 
                        } 
                    } 
                }
            }},
            { $project: {
                _id: 0, 
                id: '$_id', 
                author_id: '$authorId',
                title: 1, 
                description: 1, 
                filename: 1, 
                thumbnail: 1, 
                views: 1, 
                is_18_plus: '$is18Plus', // Переименование
                created_at: '$createdAt', 
                username: '$author.username', 
                author_avatar: '$author.avatar', 
                likes: 1, 
                dislikes: 1, 
                subs: 1, 
                is_sub: { $gt: ['$is_sub', 0] }
            }}
        ]);

        const video = videoAggregation[0];
        if (!video) return res.status(404).json({error: "Not found"});

        // 3. Получение комментариев
        const rawComments = await Comment.find({ videoId })
            .sort({ createdAt: 1 })
            .populate('userId', 'username avatar')
            .lean(); // .lean() для более быстрой работы с объектами

        // 4. Группировка комментариев (аналогично SQL-версии)
        const commentsMap = {};
        const rootComments = [];
        
        rawComments.forEach(c => {
            c.replies = [];
            c.id = c._id.toString(); // Форматирование ID
            c.username = c.userId.username;
            c.avatar = c.userId.avatar;
            delete c._id;
            delete c.userId;

            commentsMap[c.id] = c;
            
            if (c.parentId) {
                const parentIdStr = c.parentId.toString();
                if (commentsMap[parentIdStr]) {
                    commentsMap[parentIdStr].replies.push(c);
                }
            } else {
                rootComments.push(c);
            }
        });

        rootComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ video, comments: rootComments });
        
    } catch (e) {
        console.error("Video fetch error:", e);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 8. Данные канала (Профиль пользователя)
app.get('/api/user/:id', async (req, res) => {
    const channelId = req.params.id;
    const userId = req.cookies.user_id || null;
    
    try {
        const user = await User.findById(channelId).select('id username avatar');
        if (!user) return res.status(404).json({ user: null });
        
        const videos = await Video.find({ authorId: channelId })
            .select('id title thumbnail views is18Plus')
            .sort({ createdAt: -1 })
            .lean(); 

        const subsCount = await Subscription.countDocuments({ channelId });
        
        let isSubscribed = false;
        if (userId) {
            const sub = await Subscription.findOne({ 
                subscriberId: userId, 
                channelId 
            });
            isSubscribed = !!sub;
        }

        res.json({ 
            user: user.toObject(), 
            videos: videos.map(v => ({...v, id: v._id.toString(), is_18_plus: v.is18Plus})),
            subs: subsCount, 
            is_sub: isSubscribed
        });
    } catch (e) {
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// 9. Подписка/Отписка
app.post('/api/subscribe', checkAuth, async (req, res) => {
    const { channelId } = req.body;
    const subscriberId = req.userId;

    try {
        const query = { subscriberId, channelId };
        const row = await Subscription.findOne(query);
        
        if (row) {
            await Subscription.deleteOne(query);
            res.json({ success: true, subscribed: false });
        } else {
            await Subscription.create(query);
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
        const video = await Video.findById(videoId).lean();
        if (!video) return res.status(404).json({ success: false, message: "Видео не найдено" });
        
        if (video.authorId.toString() !== userId.toString()) {
            return res.status(403).json({ success: false, message: "Вы не автор этого видео" });
        }

        const deleteResult = await Video.deleteOne({ _id: videoId, authorId: userId });
        if (deleteResult.deletedCount === 0) {
             return res.status(500).json({ success: false, message: "Не удалось удалить видео из БД" });
        }

        const filesToDelete = [video.filename, video.thumbnail];
        filesToDelete.forEach(filePath => {
            const fullPath = path.join(__dirname, filePath.replace('/uploads/', 'uploads/'));
            fs.unlink(fullPath, (e) => {
                if (e) console.error(`Ошибка при удалении файла ${filePath}:`, e.message);
            });
        });

        // Удаляем связанные данные (голоса, комментарии)
        await Vote.deleteMany({ videoId });
        await Comment.deleteMany({ videoId });

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
        const video = await Video.findById(videoId).select('is18Plus');
        if (!video) return res.status(404).json({ success: false, message: "Видео не найдено" });
        
        const newState = video.is18Plus === 1 ? 0 : 1;
        
        const updated = await Video.findByIdAndUpdate(videoId, { is18Plus: newState }, { new: true });
        
        res.json({ success: true, is_18_plus: newState });
        io.emit('update_18plus_status', { videoId: videoId, is_18_plus: newState });
    } catch (e) {
        res.status(500).json({ success: false, message: "Ошибка обновления БД" });
    }
});

// 12. Административное удаление пользователя (Block)
app.post('/api/admin/block', checkAuth, checkAdminMiddleware, async (req, res) => {
    const { userId } = req.body;
    const targetUserId = userId; // В MongoDB ID - это строка

    if (!targetUserId || targetUserId === req.userId.toString()) {
        return res.status(403).json({ success: false, message: 'Нельзя удалить собственный аккаунт.' });
    }

    try {
        // Находим все видео пользователя для удаления файлов
        const userVideos = await Video.find({ authorId: targetUserId }).lean();
        
        // Удаляем файлы
        userVideos.forEach(video => {
            const filesToDelete = [video.filename, video.thumbnail];
            filesToDelete.forEach(filePath => {
                const fullPath = path.join(__dirname, filePath.replace('/uploads/', 'uploads/'));
                fs.unlink(fullPath, (e) => {
                    if (e) console.error(`Ошибка при удалении файла ${filePath}:`, e.message);
                });
            });
        });
        
        // Удаляем связанные данные
        await Video.deleteMany({ authorId: targetUserId });
        await Subscription.deleteMany({ $or: [{ subscriberId: targetUserId }, { channelId: targetUserId }] });
        await Vote.deleteMany({ $or: [{ userId: targetUserId }, { videoId: { $in: userVideos.map(v => v._id) } }] });
        await Comment.deleteMany({ $or: [{ userId: targetUserId }, { videoId: { $in: userVideos.map(v => v._id) } }] });
        
        // Удаляем пользователя
        await User.findByIdAndDelete(targetUserId);

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
    
    const parsedCount = parseInt(count);

    if (!channelId || isNaN(parsedCount) || parsedCount < 1 || parsedCount > 100) {
        return res.status(400).json({ success: false, message: 'Неверные параметры ID канала или количества (1-100).' });
    }
    
    try {
        const bulkOps = [];
        for (let i = 1; i <= parsedCount; i++) {
            // Используем отрицательный псевдо-ID для фиктивных подписчиков
            const fakeSubscriberId = new mongoose.Types.ObjectId(String(Date.now() + i + Math.random()).slice(-12).padStart(24, '0'));
            
            bulkOps.push({
                updateOne: {
                    filter: { subscriberId: fakeSubscriberId, channelId },
                    update: { $setOnInsert: { subscriberId: fakeSubscriberId, channelId } },
                    upsert: true
                }
            });
        }
        
        await Subscription.bulkWrite(bulkOps);
        
        return res.json({ 
            success: true, 
            message: `Успешно накручено ${parsedCount} фиктивных подписчиков для канала ID ${channelId}.` 
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
            const { userId, videoId, type } = data;
            
            // 1. Удаляем старый голос (если есть)
            await Vote.deleteOne({ userId, videoId });

            // 2. Вставляем новый голос
            await Vote.create({ userId, videoId, type });
            
            io.emit('update_votes', { videoId }); 
        } catch (e) {
             console.error('Socket vote error:', e.message);
        }
    });
    
    // Добавление комментария или ответа
    socket.on('comment', async (data) => {
        const parentId = data.parentId || null; 
        
        try {
            const newComment = await Comment.create({
                userId: data.userId, 
                videoId: data.videoId, 
                text: data.text, 
                parentId
            });
            
            const user = await User.findById(data.userId).select('username avatar');
            
            const commentToSend = { 
                ...data, 
                id: newComment._id.toString(), 
                username: user.username, 
                avatar: user.avatar, 
                created_at: newComment.createdAt, 
                parent_id: parentId // Может быть null
            };
            
            io.emit('new_comment', { videoId: data.videoId, comment: commentToSend });
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