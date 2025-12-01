const app = {
    user: null,
    socket: io(),

    init: () => {
        app.checkUser();
        app.setupSocket();
        
        // Обработка кнопок "Назад/Вперед" в браузере
        window.onpopstate = app.router;
        
        // Инициализация форм
        document.getElementById('authForm').onsubmit = app.handleAuth;
        document.getElementById('uploadForm').onsubmit = app.handleUpload;
        
        // Загрузка начальной страницы
        app.router();
        
        // Закрытие меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#userMenu')) app.closeUserMenu();
        });
    },

    router: () => {
        const path = location.pathname;
        if (path === '/' || path === '') app.loadFeed();
        else if (path.startsWith('/watch/')) app.loadVideo(path.split('/').pop());
        else if (path.startsWith('/channel/')) app.loadChannel(path.split('/').pop());
    },

    // --- Авторизация ---
    checkUser: async () => {
        try {
            const res = await fetch('/api/me');
            if (res.ok) app.user = await res.json();
        } catch(e) {}
        app.renderMenu();
    },

    renderMenu: () => {
        const menu = document.getElementById('userMenu');
        if (app.user) {
            menu.innerHTML = `
                <button class="btn-primary" onclick="app.showModal('upload')">+ Видео</button>
                <div style="position:relative">
                    <img class="user-avatar-mini" src="${app.user.avatar}" onclick="app.showUserMenu()">
                    <div id="userPopupMenu" class="user-popup hidden">
                        <a href="#" onclick="app.loadChannel(${app.user.id}); return false;">Мой канал</a>
                        <a href="#" onclick="app.logout(); return false;" style="color:var(--secondary)">Выйти</a>
                    </div>
                </div>
            `;
        } else {
            menu.innerHTML = `<button class="btn-primary" onclick="app.showModal('login')">Войти</button>`;
        }
    },

    showUserMenu: () => {
        document.getElementById('userPopupMenu').classList.toggle('hidden');
    },
    
    closeUserMenu: () => {
        document.getElementById('userPopupMenu')?.classList.add('hidden');
    },

    logout: async () => {
        await fetch('/api/logout');
        location.reload();
    },

    // --- Загрузка страниц ---

    // 1. Лента
    loadFeed: async () => {
        history.pushState(null, '', '/');
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch('/api/videos');
        const videos = await res.json();
        
        main.innerHTML = `<div class="video-grid">
            ${videos.map(v => `
                <div class="video-card" onclick="app.loadVideo(${v.id})">
                    <img class="thumb" src="${v.thumbnail}">
                    <div class="info">
                        <img class="avatar" src="${v.author_avatar}" onclick="event.stopPropagation(); app.loadChannel(${v.author_id})">
                        <div>
                            <h3>${v.title}</h3>
                            <p>${v.username} • ${v.views} просмотров</p>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>`;
    },

    // 2. Видео плеер
    loadVideo: async (id) => {
        history.pushState(null, '', `/watch/${id}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/video/${id}`);
        if(!res.ok) return main.innerHTML = '<h2>Видео не найдено</h2>';
        
        const { video, comments } = await res.json();

        main.innerHTML = `
            <div class="player-container">
                <div class="video-stage">
                    <div class="video-frame">
                        <video controls autoplay src="${video.filename}"></video>
                    </div>
                    <div class="video-meta">
                        <h1>${video.title}</h1>
                        <div class="video-actions">
                            <span>${video.views} просмотров • ${new Date(video.created_at).toLocaleDateString()}</span>
                            <div style="display:flex; gap:10px">
                                <button class="btn-action" onclick="app.vote(${video.id}, 'like')">👍 ${video.likes}</button>
                                <button class="btn-action" onclick="app.vote(${video.id}, 'dislike')">👎 ${video.dislikes}</button>
                            </div>
                        </div>
                        <div class="channel-row">
                            <div class="channel-info" onclick="app.loadChannel(${video.author_id})">
                                <img class="channel-avatar" src="${video.author_avatar}">
                                <div>
                                    <h3>${video.username}</h3>
                                    <small>${video.subs} подписчиков</small>
                                </div>
                            </div>
                            ${app.user && app.user.id != video.author_id ? 
                                `<button class="subscribe-btn ${video.is_sub ? 'subscribed' : ''}" 
                                onclick="app.sub(${video.author_id})">
                                ${video.is_sub ? 'Вы подписаны' : 'Подписаться'}
                                </button>` : ''}
                        </div>
                        <p style="margin-top:20px; color:var(--text-muted)">${video.description}</p>
                    </div>
                    
                    <div class="comments-list">
                        <h3>Комментарии</h3>
                        ${app.user ? `
                            <div class="comment-input-area">
                                <input id="commentInp" placeholder="Оставьте комментарий...">
                                <button class="btn-primary" onclick="app.sendComment(${video.id})">Send</button>
                            </div>` : '<p>Войдите, чтобы комментировать</p>'}
                        <div id="cList">
                            ${comments.map(c => `
                                <div class="comment">
                                    <img class="user-avatar-mini" src="${c.avatar}" onclick="app.loadChannel(${c.user_id})">
                                    <div>
                                        <strong>${c.username}</strong>
                                        <p>${c.text}</p>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    // 3. Страница канала
    loadChannel: async (authorId) => {
        history.pushState(null, '', `/channel/${authorId}`);
        const main = document.getElementById('appContent');
        main.innerHTML = '<div class="loading-spinner"></div>';
        
        const res = await fetch(`/api/user/${authorId}`);
        if(!res.ok) return main.innerHTML = '<h2>Канал не найден</h2>';
        const data = await res.json();

        main.innerHTML = `
            <div class="channel-page">
                <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:40px; text-align:center">
                    <img style="width:100px; height:100px; border-radius:50%; object-fit:cover; margin-bottom:10px" src="${data.user.avatar}">
                    <h1>${data.user.username}</h1>
                    <p style="color:var(--text-muted)">${data.subs} подписчиков</p>
                    ${app.user && app.user.id != authorId ? 
                        `<button class="subscribe-btn ${data.is_sub ? 'subscribed' : ''}" 
                        onclick="app.sub(${data.user.id})">
                        ${data.is_sub ? 'Вы подписаны' : 'Подписаться'}
                        </button>` : ''}
                </div>
                
                <h3>Видео канала</h3>
                <div class="video-grid">
                    ${data.videos.length ? data.videos.map(v => `
                        <div class="video-card" onclick="app.loadVideo(${v.id})">
                            <img class="thumb" src="${v.thumbnail}">
                            <div class="info">
                                <div>
                                    <h3>${v.title}</h3>
                                    <p>${v.views} просмотров</p>
                                </div>
                            </div>
                        </div>
                    `).join('') : '<p>Видео пока нет</p>'}
                </div>
            </div>
        `;
    },

    // --- Обработчики форм ---

    handleAuth: async (e) => {
        e.preventDefault();
        const isReg = !document.getElementById('regFields').classList.contains('hidden');
        const formData = new FormData(e.target);
        
        let opts = {};
        if (isReg) {
            // Регистрация (FormData для файла)
            opts = { method: 'POST', body: formData };
        } else {
            // Вход (JSON)
            const data = Object.fromEntries(formData.entries());
            opts = { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) };
        }

        const res = await fetch(isReg ? '/api/register' : '/api/login', opts);
        const json = await res.json();
        
        if (json.success) location.reload();
        else alert(json.message);
    },

    handleUpload: async (e) => {
        e.preventDefault();
        const res = await fetch('/api/upload', { method: 'POST', body: new FormData(e.target) });
        const json = await res.json();
        if (json.success) {
            app.closeModal();
            app.loadFeed();
        } else {
            alert('Ошибка загрузки');
        }
    },

    sub: async (id) => {
        if(!app.user) return app.showModal('login');
        const res = await fetch('/api/subscribe', { 
            method: 'POST', 
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ channelId: id })
        });
        if((await res.json()).success) {
            // Перезагружаем текущую страницу канала или видео
            const path = location.pathname;
            if (path.startsWith('/channel/')) app.loadChannel(id);
            else if (path.startsWith('/watch/')) app.loadVideo(path.split('/').pop());
        }
    },

    vote: (vid, type) => {
        if(!app.user) return app.showModal('login');
        app.socket.emit('vote', { videoId: vid, userId: app.user.id, type });
    },

    sendComment: (vid) => {
        const txt = document.getElementById('commentInp').value;
        if(txt) app.socket.emit('comment', { videoId: vid, userId: app.user.id, text: txt });
        document.getElementById('commentInp').value = '';
    },

    // --- Утилиты UI ---
    showModal: (type) => {
        document.getElementById('modalOverlay').classList.remove('hidden');
        if (type === 'login') {
            document.getElementById('authModal').classList.remove('hidden');
            document.getElementById('uploadModal').classList.add('hidden');
        } else {
            document.getElementById('authModal').classList.add('hidden');
            document.getElementById('uploadModal').classList.remove('hidden');
        }
    },
    closeModal: () => {
        document.getElementById('modalOverlay').classList.add('hidden');
    },
    toggleAuthMode: () => {
        const fields = document.getElementById('regFields');
        const title = document.getElementById('modalTitle');
        const link = document.getElementById('toggleAuth');
        
        if (fields.classList.contains('hidden')) {
            fields.classList.remove('hidden');
            title.innerText = "Регистрация";
            link.innerText = "Уже есть аккаунт? Войти";
        } else {
            fields.classList.add('hidden');
            title.innerText = "Вход в систему";
            link.innerText = "Нет аккаунта? Зарегистрироваться";
        }
    },
    
    setupSocket: () => {
        app.socket.on('new_comment', data => {
            const list = document.getElementById('cList');
            if(list) list.innerHTML = `
                <div class="comment">
                    <img class="user-avatar-mini" src="${data.comment.avatar}">
                    <div><strong>${data.comment.username}</strong><p>${data.comment.text}</p></div>
                </div>` + list.innerHTML;
        });
    }
};

document.addEventListener('DOMContentLoaded', app.init);