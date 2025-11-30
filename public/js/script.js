// public/js/script.js

// Инициализация объекта, который будет содержать всю логику приложения
const app = {
    
    // Переменные состояния
    user: null, 
    currentVideo: null,
    
    // Объект для взаимодействия с Socket.io (предполагает, что socket.io.js загружен)
    socket: io(), 

    // ------------------------------------
    // 1. ИНИЦИАЛИЗАЦИЯ И УПРАВЛЕНИЕ СТРАНИЦЕЙ
    // ------------------------------------

    init: () => {
        app.checkUserStatus();
        app.setupSocketListeners();
        // В зависимости от URL, загружаем контент
        app.route(); 
        
        // Настройка прослушивания событий модальных окон
        document.getElementById('authForm').onsubmit = app.handleAuthSubmit;
        document.getElementById('uploadForm').onsubmit = app.handleUploadSubmit;
    },

    route: () => {
        const path = window.location.pathname.split('/').filter(p => p);
        if (path.length === 0) {
            app.loadFeed();
        } else if (path[0] === 'watch' && path[1]) {
            app.loadVideoPage(path[1]);
        } else if (path.length === 2 && path[0] !== 'api' && path[1]) {
            // Предполагаем, что это /username/userId
            app.loadChannelPage(path[1]);
        } else {
            app.loadFeed(); // Fallback на ленту
        }
    },

    // ------------------------------------
    // 2. АВТОРИЗАЦИЯ И МОДАЛЬНЫЕ ОКНА
    // ------------------------------------
    
    checkUserStatus: async () => {
        const response = await fetch('/api/me');
        if (response.ok) {
            app.user = await response.json();
        } else {
            app.user = null;
        }
        app.renderUserMenu();
    },

    renderUserMenu: () => {
        const menu = document.getElementById('userMenu');
        menu.innerHTML = ''; // Очистка
        
        if (app.user) {
            menu.innerHTML = `
                <button onclick="app.showModal('upload')">Загрузить</button>
                <img src="${app.user.avatar}" onclick="app.loadChannelPage(${app.user.id})" alt="${app.user.username}">
            `;
        } else {
            menu.innerHTML = `<button onclick="app.showModal('login')">Войти</button>`;
        }
    },

    showModal: (type) => {
        const overlay = document.getElementById('modalOverlay');
        const authModal = document.getElementById('authModal');
        const uploadModal = document.getElementById('uploadModal');

        overlay.classList.remove('hidden');
        authModal.classList.add('hidden');
        uploadModal.classList.add('hidden');

        if (type === 'login' || type === 'register') {
            authModal.classList.remove('hidden');
            app.toggleAuthMode(type === 'register');
        } else if (type === 'upload') {
            uploadModal.classList.remove('hidden');
        }
    },

    closeModal: () => {
        document.getElementById('modalOverlay').classList.add('hidden');
        // Сброс форм
        document.getElementById('authForm').reset();
        document.getElementById('uploadForm').reset();
    },

    toggleAuthMode: (isRegister = null) => {
        const authModal = document.getElementById('authModal');
        const regFields = document.getElementById('regFields');
        const modalTitle = document.getElementById('modalTitle');
        const submitBtn = authModal.querySelector('button[type="submit"]');
        const toggleLink = document.getElementById('toggleAuth');
        
        const isCurrentlyRegister = regFields.classList.contains('active');
        const shouldBeRegister = isRegister !== null ? isRegister : !isCurrentlyRegister;

        if (shouldBeRegister) {
            regFields.classList.add('active');
            regFields.classList.remove('hidden');
            modalTitle.textContent = 'Регистрация';
            submitBtn.textContent = 'Создать аккаунт';
            toggleLink.innerHTML = 'Уже есть аккаунт? Войти';
        } else {
            regFields.classList.remove('active');
            regFields.classList.add('hidden');
            modalTitle.textContent = 'Вход';
            submitBtn.textContent = 'Продолжить';
            toggleLink.innerHTML = 'Нет аккаунта? Создать';
        }
    },

    handleAuthSubmit: async (e) => {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const isRegister = document.getElementById('regFields').classList.contains('active');
        const endpoint = isRegister ? '/api/register' : '/api/login';

        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData, // FormData работает с multipart/form-data
        });
        const result = await response.json();

        if (result.success) {
            await app.checkUserStatus(); // Обновляем app.user
            app.closeModal();
            app.loadFeed(); 
        } else {
            alert(result.message || "Ошибка авторизации/регистрации.");
        }
    },

    handleUploadSubmit: async (e) => {
        e.preventDefault();
        if (!app.user) return alert("Пожалуйста, войдите, чтобы загрузить видео.");

        const form = e.target;
        const formData = new FormData(form);
        
        // Проверка на наличие файлов (необходимо, потому что Multer требует их)
        const videoFile = formData.get('video');
        const thumbnailFile = formData.get('thumbnail');

        if (!videoFile || !thumbnailFile || videoFile.size === 0 || thumbnailFile.size === 0) {
            return alert("Пожалуйста, выберите видео и обложку.");
        }

        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (result.success) {
            alert("Видео успешно опубликовано!");
            app.closeModal();
            form.reset();
            app.loadFeed(); // Обновляем ленту
        } else {
            alert(result.message || "Ошибка при загрузке видео.");
        }
    },

    // ------------------------------------
    // 3. РЕНДЕРИНГ КОНТЕНТА
    // ------------------------------------
    
    // Рендер главной ленты
    loadFeed: async () => {
        window.history.pushState({}, '', '/');
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка ленты...</h2>';

        const response = await fetch('/api/videos');
        const videos = await response.json();
        
        let html = '<div class="video-grid">';
        
        if (videos.length === 0) {
            html = '<h2 style="text-align: center; color: var(--text-muted); padding: 50px;">Видео пока нет. Станьте первым!</h2>';
        } else {
            videos.forEach(v => {
                html += `
                    <div class="video-card" onclick="app.loadVideoPage(${v.id})">
                        <img class="thumb" src="${v.thumbnail}" alt="${v.title}">
                        <div class="info">
                            <img class="info-avatar" src="${v.author_avatar}" alt="${v.username}">
                            <div class="meta">
                                <h3>${v.title}</h3>
                                <p>${v.username} • ${app.formatViews(v.views)} • ${app.timeAgo(v.created_at)}</p>
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }

        content.innerHTML = html;
    },

    // Рендер страницы просмотра видео
    loadVideoPage: async (videoId) => {
        window.history.pushState({}, '', `/watch/${videoId}`);
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка видео...</h2>';
        app.currentVideo = videoId; // Устанавливаем текущее видео

        const response = await fetch(`/api/video/${videoId}`);
        if (!response.ok) {
            content.innerHTML = '<h2>Видео не найдено (404)</h2>';
            return;
        }
        
        const data = await response.json();
        const video = data.video;
        const comments = data.comments;

        let html = `
            <div class="player-container">
                <div class="video-stage">
                    <div class="video-wrapper">
                        <video id="videoPlayer" width="100%" controls autoplay>
                            <source src="${video.filename}" type="video/mp4">
                            Ваш браузер не поддерживает HTML5 видео.
                        </video>
                    </div>
                    
                    <div class="video-details">
                        <h1>${video.title}</h1>
                        <div class="video-stats">
                            <span id="viewCount">${app.formatViews(video.views)} просмотров</span>
                            <div class="actions">
                                <button id="likeBtn" onclick="app.handleVote(${video.id}, 'like')" data-count="${video.likes}">👍 ${video.likes}</button>
                                <button id="dislikeBtn" onclick="app.handleVote(${video.id}, 'dislike')" data-count="${video.dislikes}">👎 ${video.dislikes}</button>
                            </div>
                        </div>
                        <hr>
                        <div class="channel-info">
                            <img src="${video.author_avatar}" onclick="app.loadChannelPage(${video.author_id})" alt="${video.username}" class="info-avatar">
                            <div>
                                <h3 onclick="app.loadChannelPage(${video.author_id})">${video.username}</h3>
                                <p style="color:var(--text-muted); font-size: 0.9rem;">Опубликовано: ${app.timeAgo(video.created_at)}</p>
                            </div>
                        </div>
                        <p>${video.description}</p>
                    </div>
                    <div class="comments-list" id="commentsList">
                        </div>
                </div>
                
                <div class="comments-section">
                    <h3>Комментарии (<span id="commentCount">${comments.length}</span>)</h3>
                    ${app.user ? `
                        <form id="commentForm" onsubmit="app.handleCommentSubmit(event, ${video.id}); return false;">
                            <input type="text" id="commentText" placeholder="Напишите комментарий..." required>
                            <button type="submit">Отправить</button>
                        </form>
                        <hr>` : `<p style="text-align:center; color: var(--text-muted);">Войдите, чтобы комментировать.</p>`
                    }
                    <div id="commentsContainer">
                        ${app.renderComments(comments)}
                    </div>
                </div>
            </div>
        `;
        content.innerHTML = html;
        // Здесь можно было бы добавить логику для проверки, голосовал ли текущий пользователь
    },
    
    // Рендер страницы канала
    loadChannelPage: async (userId) => {
        window.history.pushState({}, '', `/channel/user-${userId}`);
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка канала...</h2>';
        
        // В рамках MVP:
        content.innerHTML = `
            <div class="channel-header">
                <img src="/img/default_avatar.svg" class="channel-big-avatar" alt="Канал">
                <div>
                    <h1>Канал #${userId}</h1>
                    <p>Здесь будут все видео пользователя, подписки и статистика.</p>
                    <p>Возвращаемся на <span onclick="app.loadFeed()" style="color:var(--primary); cursor:pointer;">главную ленту</span>.</p>
                </div>
            </div>
        `;
    },

    // ------------------------------------
    // 4. SOCKET.IO И РЕАЛЬНОЕ ВРЕМЯ
    // ------------------------------------

    setupSocketListeners: () => {
        app.socket.on('new_video', (data) => {
            if (window.location.pathname === '/') {
                console.log('Новое видео: ', data.title);
                // Для динамического обновления ленты
                // app.loadFeed(); 
            }
        });

        app.socket.on('update_votes', (data) => {
            if (data.videoId == app.currentVideo) {
                document.getElementById('likeBtn').textContent = `👍 ${data.likes}`;
                document.getElementById('dislikeBtn').textContent = `👎 ${data.dislikes}`;
                document.getElementById('likeBtn').dataset.count = data.likes;
                document.getElementById('dislikeBtn').dataset.count = data.dislikes;
            }
        });

        app.socket.on('new_comment', (data) => {
            if (data.videoId == app.currentVideo) {
                const container = document.getElementById('commentsContainer');
                // Добавляем новый комментарий в начало
                container.insertAdjacentHTML('afterbegin', app.renderSingleComment(data.comment));
                
                // Обновляем счетчик
                const countElem = document.getElementById('commentCount');
                countElem.textContent = parseInt(countElem.textContent) + 1;
            }
        });
        
        app.socket.on('update_view_count', (data) => {
            if (data.videoId == app.currentVideo) {
                document.getElementById('viewCount').textContent = `${app.formatViews(data.views)} просмотров`;
            }
        });
    },

    handleVote: (videoId, type) => {
        if (!app.user) return app.showModal('login');
        
        app.socket.emit('vote', {
            videoId: videoId,
            type: type,
            userId: app.user.id
        });
    },

    handleCommentSubmit: (e, videoId) => {
        e.preventDefault();
        if (!app.user) return app.showModal('login');

        const text = document.getElementById('commentText').value;
        if (!text) return;
        
        app.socket.emit('send_comment', {
            videoId: videoId,
            userId: app.user.id,
            text: text
        });

        document.getElementById('commentText').value = ''; // Очистка поля
    },

    // ------------------------------------
    // 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И РЕНДЕР-ХЕЛПЕРЫ
    // ------------------------------------

    formatViews: (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
        return num;
    },

    timeAgo: (dateStr) => {
        // Fix для правильной обработки UTC времени из SQLite
        const dateV = new Date(dateStr.replace(' ', 'T') + 'Z'); 
        const now = new Date();
        const diff = (now - dateV) / 1000;

        if (diff < 0) return 'только что';
        if(diff < 60) return 'только что';
        if(diff < 3600) return Math.floor(diff/60) + ' мин. назад';
        if(diff < 86400) return Math.floor(diff/3600) + ' ч. назад';
        if(diff < 604800) return Math.floor(diff/86400) + ' дн. назад';
        return dateV.toLocaleDateString(); // Дата, если больше недели
    },
    
    renderSingleComment: (comment) => {
        return `
            <div class="comment">
                <img class="comment-avatar" src="${comment.avatar}" alt="${comment.username}">
                <div>
                    <p><strong>${comment.username}</strong> <span style="font-size: 0.8rem; color: var(--text-muted);">${app.timeAgo(comment.created_at)}</span></p>
                    <p>${comment.text}</p>
                </div>
            </div>
        `;
    },

    renderComments: (comments) => {
        return comments.map(app.renderSingleComment).join('');
    },
    
    // ------------------------------------
}; // <-- Обязательно закрывайте объект app здесь!

// --- Инициализация при загрузке страницы (запуск приложения) ---
document.addEventListener('DOMContentLoaded', () => {
    app.init(); 
});