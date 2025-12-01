const app = {
    user: null, // Глобальный объект для хранения данных о текущем пользователе
    socket: null, // WebSocket соединение

    init: () => {
        // Инициализация Socket.IO
        app.socket = io();
        
        // Настройка обработчиков событий Socket.IO
        app.socket.on('update_votes', app.handleUpdateVotes);
        app.socket.on('new_comment', app.handleNewComment);
        app.socket.on('new_video', app.handleNewVideo);
        app.socket.on('update_view', app.handleUpdateView);
        app.socket.on('update_18plus_status', app.handleUpdate18PlusStatus);
        
        // Загрузка данных пользователя и начальная маршрутизация
        app.loadMe().then(app.router);
        
        // Обработка истории браузера для навигации
        window.onpopstate = app.router;

        // Настройка обработчиков форм
        document.getElementById('loginForm').onsubmit = app.login;
        document.getElementById('registerForm').onsubmit = app.register;
        // Убедимся, что uploadForm существует на странице загрузки, когда она загружена
        // document.getElementById('uploadForm').onsubmit = app.uploadVideo; // Лучше привязать в loadUploadPage
    },
    
    // --- ОСНОВНЫЕ ФУНКЦИИ АВТОРИЗАЦИИ И ЗАГРУЗКИ ---

    loadMe: async () => {
        const res = await fetch('/api/me');
        const loginSection = document.getElementById('loginSection');
        const uploadBtn = document.getElementById('uploadBtn');
        const userMenu = document.getElementById('userMenu');
        const adminPanelBtn = document.getElementById('adminPanelBtn');

        if (res.ok) {
            app.user = await res.json();
            
            loginSection.style.display = 'none';
            userMenu.style.display = 'flex';
            uploadBtn.style.display = 'inline-block';
            document.getElementById('usernameDisplay').textContent = app.user.username;
            document.getElementById('userAvatar').src = app.user.avatar;
            
            // Проверка прав Today_Idk_New и Admin_18Plus для кнопки Admin Panel
            if (app.user.username === 'Today_Idk_New' || app.user.username === 'Admin_18Plus') {
                adminPanelBtn.style.display = 'block';
            } else {
                adminPanelBtn.style.display = 'none';
            }

        } else {
            app.user = null;
            loginSection.style.display = 'block';
            userMenu.style.display = 'none';
            uploadBtn.style.display = 'none';
            adminPanelBtn.style.display = 'none';
        }
    },

    login: async (e) => {
        e.preventDefault();
        const form = e.target;
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: form.username.value,
                password: form.password.value
            })
        });
        const data = await res.json();
        if (data.success) {
            app.loadMe().then(() => {
                document.getElementById('loginPage').style.display = 'none';
                app.router();
            });
        } else {
            alert(data.message);
        }
    },

    register: async (e) => {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);

        const res = await fetch('/api/register', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            app.loadMe().then(() => {
                document.getElementById('registerPage').style.display = 'none';
                app.router();
            });
        } else {
            alert(data.message);
        }
    },

    logout: async () => {
        await fetch('/api/logout');
        app.user = null;
        document.getElementById('userMenu').style.display = 'none';
        document.getElementById('loginSection').style.display = 'block';
        document.getElementById('uploadBtn').style.display = 'none';
        document.getElementById('adminPanelBtn').style.display = 'none';
        app.router();
    },

    // --- МАРШРУТИЗАЦИЯ ---

    router: (url) => {
        if (typeof url === 'string') {
            window.history.pushState(null, '', url);
        }
        
        // Скрытие всех страниц
        document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
        document.getElementById('appContent').style.display = 'block';

        const path = window.location.pathname;

        if (path === '/' || path === '/home') {
            app.loadFeed();
        } else if (path.startsWith('/video/')) {
            const videoId = path.split('/')[2];
            app.loadVideo(videoId);
        } else if (path.startsWith('/channel/')) {
            const userId = path.split('/')[2];
            app.loadChannel(userId);
        } else if (path === '/upload') {
            app.loadUploadPage();
        } else if (path === '/login') {
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('appContent').style.display = 'none';
        } else if (path === '/register') {
            document.getElementById('registerPage').style.display = 'flex';
            document.getElementById('appContent').style.display = 'none';
        } else if (path === '/admin') {
            app.loadAdminPanel();
        } else {
            app.load404();
        }
        window.scrollTo(0, 0);
    },

    // --- СТРАНИЦЫ И КОНТЕНТ ---

    // 1. Лента Видео
    loadFeed: async () => {
        history.pushState(null, '', '/');
        const main = document.getElementById('appContent');
        main.innerHTML = '<h2>Главная</h2><div class="loading-spinner"></div>';
        
        const res = await fetch('/api/videos');
        const videos = await res.json();

        main.innerHTML = `
            <h2>Главная</h2>
            <div class="video-grid">
                ${videos.map(v => `
                    <div class="video-card" onclick="app.router('/video/${v.id}')">
                        <img class="thumb" src="${v.thumbnail}">
                        ${v.is_18_plus ? '<span class="age-warning">🔞 18+</span>' : ''}
                        <div class="info">
                            <img class="avatar" src="${v.author_avatar}" onclick="event.stopPropagation(); app.router('/channel/${v.author_id}')">
                            <div>
                                <h3>${v.title}</h3>
                                <p>${v.username}</p>
                                <p>${v.views} просмотров</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    // 2. Страница Загрузки
    loadUploadPage: () => {
        if (!app.user) return app.router('/login');
        history.pushState(null, '', '/upload');
        // Предполагается, что на странице есть скрытый div#uploadPage
        const uploadPageContent = document.getElementById('uploadPage');
        if (uploadPageContent) {
            document.getElementById('appContent').innerHTML = uploadPageContent.innerHTML;
            
            // Важно: перепривязка обработчика после вставки HTML
            const form = document.getElementById('uploadFormContent');
            if (form) {
                form.onsubmit = app.uploadVideo;
            } else {
                 document.getElementById('appContent').innerHTML = '<h2>Ошибка загрузки: Не найдена форма загрузки (uploadFormContent).</h2>';
            }
            
        } else {
            document.getElementById('appContent').innerHTML = '<h2>Ошибка: Не найден шаблон страницы загрузки.</h2>';
        }
    },

    uploadVideo: async (e) => {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);

        document.getElementById('uploadStatus').textContent = 'Загрузка...';
        
        const res = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('uploadStatus').textContent = 'Видео успешно загружено!';
            form.reset();
            setTimeout(() => app.router('/'), 1000);
        } else {
            document.getElementById('uploadStatus').textContent = `Ошибка загрузки: ${data.message || 'Неизвестная ошибка'}`;
        }
    },

    // 3. Страница Канала
    loadChannel: async (authorId) => {
        history.pushState(null, '', `/channel/${authorId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/user/${authorId}`);
        
        if(!res.ok) {
            const errorData = await res.json().catch(() => ({ error: "Неизвестная ошибка" }));
            return main.innerHTML = `<h2>Ошибка загрузки канала: ${res.status}</h2><p>${errorData.error || 'Произошла ошибка сервера.'}</p>`;
        }
        
        const data = await res.json();
        const videos = data.videos || [];

        const isMyChannel = app.user && app.user.id == authorId;
        const isAdmin18Plus = app.user && app.user.username === 'Admin_18Plus';

        main.innerHTML = `
            <div class="channel-page">
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:40px; text-align:center">
                    <img style="width:100px; height:100px; border-radius:50%; object-fit:cover; margin-bottom:10px" src="${data.user.avatar}">
                    <h1>${data.user.username}</h1>
                    <p id="subsCountDisplay" style="color:var(--text-muted)">${data.subs} подписчиков</p>
                    ${app.user && app.user.id != authorId ? 
                        `<button class="subscribe-btn ${data.is_sub ? 'subscribed' : ''}" id="subBtn" 
                        onclick="app.sub(${data.user.id})">
                        ${data.is_sub ? 'Вы подписаны' : 'Подписаться'}
                        </button>` : ''}
                    ${isMyChannel ? 
                         `<p style="color:var(--text-muted); margin-top:10px;">Это ваш канал.</p>` : ''}
                </div>
                
                <h3>Видео канала</h3>
                <div class="video-grid">
                    ${videos.length ? videos.map(v => `
                        <div class="video-card" onclick="app.router('/video/${v.id}')">
                            <img class="thumb" src="${v.thumbnail}">
                            ${v.is_18_plus ? '<span class="age-warning">🔞 18+</span>' : ''}
                            <div class="info">
                                <div>
                                    <h3>${v.title}</h3>
                                    <p>${v.views} просмотров</p>
                                </div>
                                ${isMyChannel ? `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteVideo(${v.id})">❌</button>` : ''}
                                ${isAdmin18Plus ? 
                                    `<button class="admin-toggle-18-btn" data-video-id="${v.id}" 
                                    onclick="event.stopPropagation(); app.toggle18Plus(${v.id})">
                                    ${v.is_18_plus ? 'Снять 🔞' : 'Поставить 🔞'}
                                    </button>` : ''}
                            </div>
                        </div>
                    `).join('') : '<p>Видео пока нет</p>'}
                </div>
            </div>
        `;
    },

    // 4. Страница Просмотра Видео
    loadVideo: async (videoId) => {
        history.pushState(null, '', `/video/${videoId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/video/${videoId}`);
        const data = await res.json();
        
        if (data.error) return main.innerHTML = '<h2>Видео не найдено</h2>';

        const v = data.video;
        const isAdmin18Plus = app.user && app.user.username === 'Admin_18Plus';
        
        main.innerHTML = `
            <div class="video-page">
                <video id="mainVideoPlayer" controls autoplay src="${v.filename}"></video>
                <h1 id="videoTitle">${v.title}</h1>
                <div class="video-meta">
                    <p id="videoViews">${v.views} просмотров</p>
                    <div class="votes-controls">
                        <button onclick="app.vote(${v.id}, 'like')" class="vote-btn">👍 <span id="likesCount">${v.likes}</span></button>
                        <button onclick="app.vote(${v.id}, 'dislike')" class="vote-btn">👎 <span id="dislikesCount">${v.dislikes}</span></button>
                    </div>
                </div>
                <div class="video-channel-info">
                    <img class="avatar" src="${v.author_avatar}" onclick="app.router('/channel/${v.author_id}')">
                    <div class="channel-details">
                        <h3 onclick="app.router('/channel/${v.author_id}')">${v.username}</h3>
                        <p>${v.subs} подписчиков</p>
                    </div>
                    ${app.user && app.user.id != v.author_id ? 
                        `<button class="subscribe-btn ${v.is_sub > 0 ? 'subscribed' : ''}" 
                        onclick="app.sub(${v.author_id})">
                        ${v.is_sub > 0 ? 'Вы подписаны' : 'Подписаться'}
                        </button>` : ''}
                    
                    ${isAdmin18Plus ? 
                        `<button class="admin-toggle-18-btn" data-video-id="${v.id}" 
                        onclick="app.toggle18Plus(${v.id})">
                        ${v.is_18_plus ? 'Снять 🔞' : 'Поставить 🔞'}
                        </button>` : ''}
                </div>
                <div class="description-box">
                    <h4>Описание:</h4>
                    <p>${v.description}</p>
                </div>
                <hr>

                <h3>Комментарии (${data.comments.length})</h3>
                <div id="commentFormSection">
                    ${app.user ? `
                        <form id="commentForm" onsubmit="app.addComment(event, ${v.id})">
                            <textarea id="commentText" placeholder="Добавить комментарий..." required></textarea>
                            <button type="submit">Отправить</button>
                        </form>
                    ` : '<p><a onclick="app.router(\'/login\')">Войдите</a>, чтобы оставлять комментарии.</p>'}
                </div>
                
                <div id="commentsList">
                    ${data.comments.map(c => `
                        <div class="comment">
                            <img class="avatar" src="${c.avatar}">
                            <div>
                                <p><strong>${c.username}</strong> <small>${new Date(c.created_at).toLocaleDateString()}</small></p>
                                <p>${c.text}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    },
    
    // 5. Админ-панель
    loadAdminPanel: () => {
        if (!app.user || (app.user.username !== 'Today_Idk_New' && app.user.username !== 'Admin_18Plus')) {
            return document.getElementById('appContent').innerHTML = '<h2>Доступ запрещен.</h2>';
        }
        
        history.pushState(null, '', '/admin');
        const main = document.getElementById('appContent');
        main.innerHTML = `
            <div class="admin-panel" style="max-width:600px; margin: 0 auto; padding: 20px;">
                <h2>Административная Панель</h2>
                <p>Вы вошли как: ${app.user.username}</p>
                <hr>

                <h3>Блокировка Пользователя (Block UserID)</h3>
                <div class="form-group">
                    <input type="number" id="blockUserId" placeholder="Введите User ID для блокировки">
                    <button onclick="app.adminAction('block')">Заблокировать</button>
                </div>
                
                <h3 style="margin-top: 30px;">Накрутка Подписчиков (GiveSubs)</h3>
                <div class="form-group">
                    <input type="number" id="subsChannelId" placeholder="ID канала">
                    <input type="number" id="subsCount" placeholder="Кол-во (1-100)">
                    <button onclick="app.adminAction('givesubs')">Накрутить</button>
                </div>
                
                <p id="adminStatus" style="margin-top: 20px; color: green;"></p>
            </div>
        `;
    },

    // 6. 404 Страница
    load404: () => {
        document.getElementById('appContent').innerHTML = '<h2>404 - Страница не найдена</h2>';
    },

    // --- ФУНКЦИИ ВЗАИМОДЕЙСТВИЯ (SUBS, LIKES, COMMENTS, ADMIN) ---

    // Голосование (лайк/дизлайк)
    vote: (videoId, type) => {
        if (!app.user) return app.router('/login');
        app.socket.emit('vote', { userId: app.user.id, videoId, type });
    },

    // Добавление комментария
    addComment: (e, videoId) => {
        e.preventDefault();
        const text = document.getElementById('commentText').value;
        if (!text.trim()) return;

        app.socket.emit('comment', { userId: app.user.id, videoId, text });
        document.getElementById('commentText').value = '';
    },

    // Подписка/Отписка
    sub: async (channelId) => {
        if (!app.user) return app.router('/login');

        const res = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId })
        });
        const data = await res.json();

        if (data.success) {
            const btn = document.getElementById('subBtn');
            if (btn) {
                 btn.textContent = data.subscribed ? 'Вы подписаны' : 'Подписаться';
                 btn.classList.toggle('subscribed', data.subscribed);
            }
            // Перезагрузка данных, чтобы обновить счетчик подписчиков
            // Не оптимально, но просто для обновления счетчика:
            app.router(window.location.pathname); 
        }
    },
    
    // Удаление видео (для автора)
    deleteVideo: async (videoId) => {
        if (!confirm('Вы уверены, что хотите удалить это видео?')) return;
        
        const res = await fetch(`/api/video/${videoId}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            alert(data.message);
            app.router('/'); // Вернуться на главную
        } else {
            alert(data.message);
        }
    },

    // Административная команда (Block/GiveSubs)
    adminAction: async (action) => {
        const statusEl = document.getElementById('adminStatus');
        statusEl.textContent = 'Обработка...';
        statusEl.style.color = 'orange';
        let url = '';
        let body = {};
        
        if (action === 'block') {
            const userId = document.getElementById('blockUserId').value;
            if (!userId) return statusEl.textContent = 'Введите ID пользователя!';
            if (!confirm(`Вы уверены, что хотите ЗАБЛОКИРОВАТЬ (удалить) пользователя ID ${userId}?`)) return statusEl.textContent = '';
            url = '/api/admin/block';
            body = { userId: userId };
        } else if (action === 'givesubs') {
            const channelId = document.getElementById('subsChannelId').value;
            const count = document.getElementById('subsCount').value;
            if (!channelId || !count) return statusEl.textContent = 'Введите ID канала и количество!';
            url = '/api/admin/givesubs';
            body = { channelId: channelId, count: count };
        } else {
            return statusEl.textContent = 'Неверное действие.';
        }
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await res.json();
        
        if (data.success) {
            statusEl.textContent = `✅ Успех: ${data.message}`;
            statusEl.style.color = 'green';
            // Если мы накручиваем подписки на текущем канале, обновим данные:
            if (action === 'givesubs' && window.location.pathname.startsWith(`/channel/${body.channelId}`)) {
                 app.router(window.location.pathname);
            }
        } else {
            statusEl.textContent = `❌ Ошибка: ${data.message || 'Неизвестная ошибка.'}`;
            statusEl.style.color = 'red';
        }
    },

    // Переключение статуса 18+ (для Admin_18Plus)
    toggle18Plus: async (videoId) => {
        if (!app.user) return app.router('/login');
        
        const res = await fetch(`/api/video/toggle_18plus/${videoId}`, { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            const statusText = data.is_18_plus ? '🔞' : '✓';
            alert(`Статус видео изменен: ${statusText}`);
            // Обновление страницы для отображения изменений
            app.router(window.location.pathname); 
        } else {
            alert(`Ошибка: ${data.message}`);
        }
    },

    // --- SOCKET.IO ОБРАБОТЧИКИ ---

    handleUpdateVotes: async (data) => {
        // Обновление лайков/дизлайков на странице просмотра видео
        if (window.location.pathname === `/video/${data.videoId}`) {
            const res = await fetch(`/api/video/${data.videoId}`);
            const updatedData = await res.json();
            if (updatedData && updatedData.video) {
                document.getElementById('likesCount').textContent = updatedData.video.likes;
                document.getElementById('dislikesCount').textContent = updatedData.video.dislikes;
            }
        }
    },

    handleNewComment: (data) => {
        // Добавление нового комментария в реальном времени
        if (window.location.pathname === `/video/${data.videoId}`) {
            const list = document.getElementById('commentsList');
            if (list) {
                 const newCommentHtml = `
                    <div class="comment">
                        <img class="avatar" src="${data.comment.avatar}">
                        <div>
                            <p><strong>${data.comment.username}</strong> <small>${new Date().toLocaleDateString()}</small></p>
                            <p>${data.comment.text}</p>
                        </div>
                    </div>
                `;
                list.insertAdjacentHTML('afterbegin', newCommentHtml);
            }
        }
    },

    handleNewVideo: (data) => {
        // Уведомление о новом видео (для будущей реализации уведомлений)
        console.log(`Новое видео опубликовано: ${data.title}`);
    },
    
    handleUpdateView: (data) => {
        // Обновление счетчика просмотров в реальном времени
        const viewsEl = document.getElementById('videoViews');
        if (viewsEl) {
            viewsEl.textContent = `${data.views} просмотров`;
        }
    },

    handleUpdate18PlusStatus: (data) => {
        // Логика для обновления элементов 18+ без полной перезагрузки (например, значок 🔞 на карточке)
        console.log(`Видео ${data.videoId} изменило статус 18+: ${data.is_18_plus}`);
        // В текущей реализации мы полагаемся на app.router() при успешном вызове toggle18Plus
    }
};

document.addEventListener('DOMContentLoaded', app.init);