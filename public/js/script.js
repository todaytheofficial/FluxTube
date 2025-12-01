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
        const loginForm = document.getElementById('loginForm');
        if (loginForm) loginForm.onsubmit = app.login;

        const registerForm = document.getElementById('registerForm');
        if (registerForm) registerForm.onsubmit = app.register;
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
        document.getElementById('appContent').style.display = 'block';

        const path = window.location.pathname;
        const appContent = document.getElementById('appContent');

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
            appContent.style.display = 'none';
        } else if (path === '/register') {
            const registerPage = document.getElementById('registerPage');
            if (registerPage) registerPage.style.display = 'flex';
            appContent.style.display = 'none';
        } else if (path === '/admin') {
            app.loadAdminPanel();
        } else {
            app.load404();
        }
        window.scrollTo(0, 0);
    },

    // --- СТРАНИЦЫ И КОНТЕНТ ---

    // ... (loadFeed, loadUploadPage, uploadVideo, loadChannel, loadAdminPanel, load404 - без изменений)
    
    // 4. Страница Просмотра Видео (обновлена для реплаев)
    loadVideo: async (videoId) => {
        history.pushState(null, '', `/video/${videoId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/video/${videoId}`);
        const data = await res.json();
        
        if (data.error) return main.innerHTML = '<h2>Видео не найдено</h2>';

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
                        <button onclick="app.vote(${v.id}, 'like')" class="vote-btn">👍 <span id="likesCount">${v.likes}</span></button>
                        <button onclick="app.vote(${v.id}, 'dislike')" class="vote-btn">👎 <span id="dislikesCount">${v.dislikes}</span></button>
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

    // --- ФУНКЦИИ ВЗАИМОДЕЙСТВИЯ (SUBS, LIKES, COMMENTS, ADMIN) ---
    
    // ... (vote, sub, deleteVideo, adminAction, toggle18Plus - без изменений, кроме loadMe/router)
    
    // Добавление комментария или ответа (Обновлено)
    addComment: (e, videoId) => {
        e.preventDefault();
        const form = e.target;
        const text = form.commentText.value;
        // Получаем ID родительского комментария, если установлен режим ответа
        const parentId = form.dataset.parentId ? parseInt(form.dataset.parentId) : null; 

        if (!text.trim()) return;

        // Отправляем parentId через сокет
        app.socket.emit('comment', { userId: app.user.id, videoId, text, parentId }); 
        
        // Сброс формы и режима ответа
        form.commentText.value = '';
        app.cancelReply(); 
    },
    
    // Установка режима ответа на комментарий (Новая функция)
    prepareReply: (button) => {
        const username = button.dataset.username;
        const parentId = button.dataset.commentId;
        const formSection = document.getElementById('commentFormSection');
        const form = document.getElementById('commentForm');
        const textarea = document.getElementById('commentText');

        if (!form || !textarea) return;
        
        // Сброс предыдущего режима ответа
        app.cancelReply();

        // Добавляем информацию о том, кому отвечаем
        const replyInfo = document.createElement('p');
        replyInfo.className = 'reply-info';
        replyInfo.innerHTML = `Ответ пользователю <strong>@${username}</strong>. <span style="cursor: pointer; color: var(--main-color);" onclick="app.cancelReply()">Отмена</span>`;
        formSection.prepend(replyInfo);
        
        // Устанавливаем parent_id в data-атрибут формы
        form.dataset.parentId = parentId;
        
        // Фокусируемся на поле ввода и добавляем упоминание
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

    // ... (handleUpdateVotes, handleNewVideo, handleUpdateView, handleUpdate18PlusStatus - без изменений)

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
                            <small>${new Date().toLocaleDateString()}</small>
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
                    // Добавляем ответ в начало списка ответов
                    repliesList.insertAdjacentHTML('beforeend', newCommentHtml);
                }
            } else {
                // Это корневой комментарий, добавляем его в основной список
                const list = document.getElementById('commentsList');
                if (list) {
                     list.insertAdjacentHTML('afterbegin', newCommentHtml);
                }
            }
        }
    },
};

document.addEventListener('DOMContentLoaded', app.init);