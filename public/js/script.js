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

        // Настройка обработчиков форм (если они статичны в index.html)
        // Если формы загружаются динамически, обработчики нужно назначать после рендеринга страницы.
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
            
            if (loginSection) loginSection.style.display = 'none';
            if (userMenu) userMenu.style.display = 'flex';
            if (uploadBtn) uploadBtn.style.display = 'inline-block';
            
            document.getElementById('usernameDisplay').textContent = app.user.username;
            document.getElementById('userAvatar').src = app.user.avatar;
            
            if (adminPanelBtn) {
                if (app.user.username === 'Today_Idk_New' || app.user.username === 'Admin_18Plus') {
                    adminPanelBtn.style.display = 'inline-block';
                } else {
                    adminPanelBtn.style.display = 'none';
                }
            }
        } else {
            app.user = null;
            if (loginSection) loginSection.style.display = 'flex';
            if (userMenu) userMenu.style.display = 'none';
            if (uploadBtn) uploadBtn.style.display = 'none';
            if (adminPanelBtn) adminPanelBtn.style.display = 'none';
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
                const loginPage = document.getElementById('loginPage');
                if (loginPage) loginPage.style.display = 'none';
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
                const registerPage = document.getElementById('registerPage');
                if (registerPage) registerPage.style.display = 'none';
                app.router();
            });
        } else {
            alert(data.message);
        }
    },

    logout: async () => {
        await fetch('/api/logout');
        app.user = null;
        const userMenu = document.getElementById('userMenu');
        const loginSection = document.getElementById('loginSection');
        const uploadBtn = document.getElementById('uploadBtn');
        const adminPanelBtn = document.getElementById('adminPanelBtn');
        
        if (userMenu) userMenu.style.display = 'none';
        if (loginSection) loginSection.style.display = 'flex';
        if (uploadBtn) uploadBtn.style.display = 'none';
        if (adminPanelBtn) adminPanelBtn.style.display = 'none';
        
        app.router();
    },

    // --- МАРШРУТИЗАЦИЯ ---

    router: (url) => {
        if (typeof url === 'string') {
            window.history.pushState(null, '', url);
        }
        
        document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
        const appContent = document.getElementById('appContent');
        if (appContent) appContent.style.display = 'block';

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
            const loginPage = document.getElementById('loginPage');
            if (loginPage) loginPage.style.display = 'flex';
            if (appContent) appContent.style.display = 'none';
        } else if (path === '/register') {
            const registerPage = document.getElementById('registerPage');
            if (registerPage) registerPage.style.display = 'flex';
            if (appContent) appContent.style.display = 'none';
        } else if (path === '/admin') {
            app.loadAdminPanel();
        } else {
            app.load404();
        }
        window.scrollTo(0, 0);
    },

    // --- СТРАНИЦЫ И КОНТЕНТ ---

    // 1. Загрузка Ленты Видео (Feed)
    loadFeed: async () => {
        history.pushState(null, '', '/');
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        try {
            const res = await fetch('/api/videos');
            const videos = await res.json();
            
            main.innerHTML = `
                <h2>Последние видео</h2>
                <div class="video-grid">
                    ${videos.map(v => `
                        <div class="video-card" onclick="app.router('/video/${v.id}')">
                            <img src="${v.thumbnail}" alt="${v.title}">
                            ${v.is_18_plus ? '<span class="adult-tag">🔞 18+</span>' : ''}
                            <div class="card-info">
                                <h4>${v.title}</h4>
                                <p>${v.views} просмотров</p>
                                <div class="card-author" onclick="event.stopPropagation(); app.router('/channel/${v.author_id}')">
                                    <img class="avatar" src="${v.author_avatar}">
                                    <span>${v.username}</span>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (e) {
            main.innerHTML = '<h2>Ошибка загрузки ленты.</h2>';
            console.error(e);
        }
    },

    // 2. Страница Загрузки
    loadUploadPage: () => {
        if (!app.user) return app.router('/login');
        history.pushState(null, '', '/upload');
        const main = document.getElementById('appContent');

        main.innerHTML = `
            <h2>Загрузка нового видео</h2>
            <form id="uploadForm" onsubmit="app.uploadVideo(event)">
                <input type="text" name="title" placeholder="Название видео" required>
                <textarea name="description" placeholder="Описание"></textarea>
                
                <label for="videoFile">Файл видео (.mp4, .mov):</label>
                <input type="file" name="video" id="videoFile" accept="video/*" required>
                
                <label for="thumbnailFile">Обложка видео (.jpg, .png):</label>
                <input type="file" name="thumbnail" id="thumbnailFile" accept="image/*" required>
                
                <label>
                    <input type="checkbox" name="is_18_plus"> Видео 18+ (для взрослых)
                </label>
                
                <button type="submit">Загрузить</button>
            </form>
            <p id="uploadMessage"></p>
        `;
    },

    uploadVideo: async (e) => {
        e.preventDefault();
        const form = e.target;
        const messageElement = document.getElementById('uploadMessage');
        messageElement.textContent = 'Загрузка... Подождите.';

        const formData = new FormData(form);
        
        try {
            const res = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            
            if (data.success) {
                messageElement.textContent = 'Видео успешно загружено!';
                form.reset();
                setTimeout(() => app.router('/'), 2000);
            } else {
                messageElement.textContent = `Ошибка: ${data.message || 'Не удалось загрузить видео.'}`;
            }
        } catch (error) {
            messageElement.textContent = 'Ошибка сети или сервера.';
            console.error('Upload error:', error);
        }
    },

    // 3. Страница Канала
    loadChannel: async (userId) => {
        history.pushState(null, '', `/channel/${userId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';

        const res = await fetch(`/api/user/${userId}`);
        const data = await res.json();

        if (!data.user) return main.innerHTML = '<h2>Пользователь не найден</h2>';

        const u = data.user;
        const videos = data.videos || [];
        const isMyChannel = app.user && app.user.id == u.id;
        
        main.innerHTML = `
            <div class="channel-header">
                <img class="avatar large-avatar" src="${u.avatar}">
                <h1>${u.username}</h1>
                <p>${data.subs} подписчиков</p>
                
                ${app.user && !isMyChannel ? 
                    `<button class="subscribe-btn ${data.is_sub ? 'subscribed' : ''}" 
                    onclick="app.sub(${u.id})">
                    ${data.is_sub ? 'Вы подписаны' : 'Подписаться'}
                    </button>` : ''}
            </div>
            
            <hr>
            
            <h2>Видео (${videos.length})</h2>
            <div class="video-grid">
                ${videos.map(v => `
                    <div class="video-card" onclick="app.router('/video/${v.id}')">
                        <img src="${v.thumbnail}" alt="${v.title}">
                        ${v.is_18_plus ? '<span class="adult-tag">🔞 18+</span>' : ''}
                        <div class="card-info">
                            <h4>${v.title}</h4>
                            <p>${v.views} просмотров</p>
                            ${isMyChannel ? `<button class="delete-btn" onclick="event.stopPropagation(); app.deleteVideo(${v.id})">Удалить</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    },

    // 4. Страница Просмотра Видео
    loadVideo: async (videoId) => {
        history.pushState(null, '', `/video/${videoId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/video/${videoId}`);
        if (!res.ok) return main.innerHTML = '<h2>Видео не найдено (404)</h2>';
        
        const data = await res.json();
        const v = data.video;
        const isAdmin18Plus = app.user && app.user.username === 'Admin_18Plus';
        
        // Вспомогательная функция для рендеринга комментария и его ответов
        const renderComment = (c) => `
            <div class="comment ${c.parent_id ? 'reply' : ''}" data-comment-id="${c.id}">
                <img class="avatar" src="${c.avatar}" onclick="app.router('/channel/${c.user_id}')" style="cursor: pointer;">
                <div>
                    <p>
                        <strong onclick="app.router('/channel/${c.user_id}')" style="cursor: pointer;">${c.username}</strong> 
                        <small>${new Date(c.created_at).toLocaleDateString()}</small>
                        ${app.user ? `<span class="reply-btn" data-username="${c.username}" data-comment-id="${c.id}" onclick="app.prepareReply(this)">Ответить</span>` : ''}
                    </p>
                    <p>${c.text}</p>
                    <div class="replies-list" data-parent-id="${c.id}">
                        ${c.replies && c.replies.length > 0 ? c.replies.map(renderComment).join('') : ''}
                    </div>
                </div>
            </div>
        `;
        
        main.innerHTML = `
            <div class="video-page">
                <video id="mainVideoPlayer" controls autoplay src="${v.filename}"></video>
                <h1 id="videoTitle">${v.title}</h1>
                <div class="video-meta">
                    <p id="videoViews">${v.views} просмотров</p>
                    <div class="votes-controls">
                        ${app.user ? `<button onclick="app.vote(${v.id}, 'like')" class="vote-btn">` : '<button disabled class="vote-btn no-auth">'}
                        👍 <span id="likesCount">${v.likes}</span></button>
                        ${app.user ? `<button onclick="app.vote(${v.id}, 'dislike')" class="vote-btn">` : '<button disabled class="vote-btn no-auth">'}
                        👎 <span id="dislikesCount">${v.dislikes}</span></button>
                    </div>
                </div>
                <div class="video-channel-info">
                    <img class="avatar" src="${v.author_avatar}" onclick="app.router('/channel/${v.author_id}')" style="cursor: pointer;">
                    <div class="channel-details">
                        <h3 onclick="app.router('/channel/${v.author_id}')" style="cursor: pointer;">${v.username}</h3>
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
                    ${data.comments.map(renderComment).join('')}
                </div>
            </div>
        `;
    },

    // 5. Страница Админ-панели
    loadAdminPanel: () => {
        if (!app.user || (app.user.username !== 'Today_Idk_New' && app.user.username !== 'Admin_18Plus')) {
             return app.router('/404');
        }
        history.pushState(null, '', '/admin');
        const main = document.getElementById('appContent');
        
        main.innerHTML = `
            <h2>Административная панель</h2>
            <p>Добро пожаловать, ${app.user.username}.</p>
            <hr>
            
            <h3>Блокировка/Удаление пользователя</h3>
            <form id="adminBlockForm" onsubmit="app.adminAction(event, 'block')">
                <input type="number" name="userId" placeholder="ID Пользователя для удаления" required>
                <button type="submit" class="delete-btn">Удалить Пользователя</button>
                <p class="message" id="adminBlockMessage"></p>
            </form>
            
            <hr>

            <h3>Накрутка подписчиков</h3>
            <form id="adminSubsForm" onsubmit="app.adminAction(event, 'givesubs')">
                <input type="number" name="channelId" placeholder="ID Канала" required>
                <input type="number" name="count" placeholder="Количество (1-100)" required min="1" max="100">
                <button type="submit">Накрутить</button>
                <p class="message" id="adminSubsMessage"></p>
            </form>
        `;
    },

    // 6. Страница 404
    load404: () => {
        history.pushState(null, '', '/404');
        const main = document.getElementById('appContent');
        main.innerHTML = '<h2>404 - Страница не найдена</h2><p>Вернуться на <a onclick="app.router(\'/\')">главную</a>.</p>';
    },
    
    // --- ФУНКЦИИ ВЗАИМОДЕЙСТВИЯ (SUBS, LIKES, COMMENTS, ADMIN) ---

    // Голосование
    vote: (videoId, type) => {
        if (!app.user) return app.router('/login');
        app.socket.emit('vote', { userId: app.user.id, videoId, type });
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
            const btn = document.querySelector('.subscribe-btn');
            if (btn) {
                btn.textContent = data.subscribed ? 'Вы подписаны' : 'Подписаться';
                btn.classList.toggle('subscribed', data.subscribed);
            }
        }
    },
    
    // Удаление видео
    deleteVideo: async (videoId) => {
        if (!confirm('Вы уверены, что хотите удалить это видео?')) return;
        
        const res = await fetch(`/api/video/${videoId}`, { method: 'DELETE' });
        const data = await res.json();
        
        if (data.success) {
            alert('Видео удалено.');
            app.router('/channel/' + app.user.id);
        } else {
            alert(`Ошибка: ${data.message}`);
        }
    },

    // Административные действия (Block, GiveSubs)
    adminAction: async (e, action) => {
        e.preventDefault();
        const form = e.target;
        const messageElement = document.getElementById(`admin${action.charAt(0).toUpperCase() + action.slice(1)}Message`);
        messageElement.textContent = 'Обработка...';

        const formData = new FormData(form);
        const body = Object.fromEntries(formData.entries());

        try {
            const res = await fetch(`/api/admin/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                messageElement.textContent = `Успех: ${data.message}`;
                form.reset();
            } else {
                messageElement.textContent = `Ошибка: ${data.message}`;
            }
        } catch (error) {
            messageElement.textContent = `Ошибка сети/сервера: ${error.message}`;
        }
    },
    
    // Переключение статуса 18+ (Admin_18Plus)
    toggle18Plus: async (videoId) => {
        const res = await fetch(`/api/video/toggle_18plus/${videoId}`, { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
            const btn = document.querySelector('.admin-toggle-18-btn');
            if (btn) {
                btn.textContent = data.is_18_plus ? 'Снять 🔞' : 'Поставить 🔞';
            }
        } else {
            alert(`Ошибка: ${data.message}`);
        }
    },

    // Добавление комментария или ответа (Обновлено)
    addComment: (e, videoId) => {
        e.preventDefault();
        const form = document.getElementById('commentForm');
        const text = form.commentText.value;
        const parentId = form.dataset.parentId ? parseInt(form.dataset.parentId) : null; 

        if (!text.trim()) return;

        app.socket.emit('comment', { userId: app.user.id, videoId, text, parentId }); 
        
        app.cancelReply(); 
    },
    
    // Установка режима ответа на комментарий (Новая функция)
    prepareReply: (button) => {
        if (!app.user) return app.router('/login');
        
        const username = button.dataset.username;
        const parentId = button.dataset.commentId;
        const formSection = document.getElementById('commentFormSection');
        const form = document.getElementById('commentForm');
        const textarea = document.getElementById('commentText');

        if (!form || !textarea) return;
        
        app.cancelReply();

        // Добавляем информацию о том, кому отвечаем
        const replyInfo = document.createElement('p');
        replyInfo.className = 'reply-info';
        replyInfo.innerHTML = `Ответ пользователю <strong>@${username}</strong>. <span style="cursor: pointer; color: var(--main-color);" onclick="app.cancelReply()">Отмена</span>`;
        formSection.prepend(replyInfo);
        
        form.dataset.parentId = parentId;
        
        textarea.value = `@${username} `;
        textarea.focus();
    },

    // Отмена режима ответа (Новая функция)
    cancelReply: () => {
        const formSection = document.getElementById('commentFormSection');
        const form = document.getElementById('commentForm');
        const textarea = document.getElementById('commentText');
        
        const replyInfo = formSection.querySelector('.reply-info');
        if(replyInfo) replyInfo.remove();
        
        if(form) delete form.dataset.parentId;
        if(textarea) {
            textarea.value = '';
            textarea.placeholder = 'Добавить комментарий...';
        }
    },


    // --- SOCKET.IO ОБРАБОТЧИКИ ---

    handleUpdateVotes: (data) => {
        if (window.location.pathname === `/video/${data.videoId}`) {
            // Обновляем счетчики, снова запрашивая данные (менее эффективно, но проще)
            app.loadVideo(data.videoId); 
        }
    },

    handleNewVideo: (data) => {
        // Здесь можно реализовать уведомление о новом видео
        // console.log(`New video uploaded: ${data.title}`);
    },

    handleUpdateView: (data) => {
        if (window.location.pathname === `/video/${data.videoId}`) {
            const viewElement = document.getElementById('videoViews');
            if (viewElement) {
                viewElement.textContent = `${data.views} просмотров`;
            }
        }
    },

    handleUpdate18PlusStatus: (data) => {
        if (window.location.pathname === `/video/${data.videoId}`) {
            const btn = document.querySelector('.admin-toggle-18-btn');
            if (btn) {
                btn.textContent = data.is_18_plus ? 'Снять 🔞' : 'Поставить 🔞';
            }
        }
    },

    // Обработка нового комментария/ответа (Обновлено)
    handleNewComment: (data) => {
        if (window.location.pathname === `/video/${data.videoId}`) {
            const c = data.comment;
            const newCommentHtml = `
                <div class="comment ${c.parent_id ? 'reply' : ''}" data-comment-id="${c.id}">
                    <img class="avatar" src="${c.avatar}" onclick="app.router('/channel/${c.user_id}')" style="cursor: pointer;">
                    <div>
                        <p>
                            <strong onclick="app.router('/channel/${c.user_id}')" style="cursor: pointer;">${c.username}</strong> 
                            <small>${new Date(c.created_at).toLocaleDateString()}</small>
                            ${app.user ? `<span class="reply-btn" data-username="${c.username}" data-comment-id="${c.id}" onclick="app.prepareReply(this)">Ответить</span>` : ''}
                        </p>
                        <p>${c.text}</p>
                        <div class="replies-list" data-parent-id="${c.id}"></div>
                    </div>
                </div>
            `;

            if (c.parent_id) {
                // Если это ответ, ищем контейнер ответов родителя
                const repliesList = document.querySelector(`.replies-list[data-parent-id="${c.parent_id}"]`);
                if (repliesList) {
                    // Добавляем ответ в конец списка ответов
                    repliesList.insertAdjacentHTML('beforeend', newCommentHtml);
                }
            } else {
                // Это корневой комментарий, добавляем его в начало основного списка
                const list = document.getElementById('commentsList');
                if (list) {
                     list.insertAdjacentHTML('afterbegin', newCommentHtml);
                }
            }
        }
    },
};

document.addEventListener('DOMContentLoaded', app.init);