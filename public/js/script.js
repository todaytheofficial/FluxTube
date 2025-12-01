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
        // Добавляем прослушивание события popstate для корректной навигации браузера
        window.addEventListener('popstate', app.route); 
        
        app.checkUserStatus();
        app.setupSocketListeners();
        // app.route() вызывается после checkUserStatus для уверенности, что user загружен
        
        // Настройка прослушивания событий модальных окон
        document.getElementById('authForm').onsubmit = app.handleAuthSubmit;
        document.getElementById('uploadForm').onsubmit = app.handleUploadSubmit;
    },

    route: () => {
        const path = window.location.pathname.split('/').filter(p => p);
        if (path.length === 0 || path[0] === 'index.html') {
            app.loadFeed();
        } else if (path[0] === 'watch' && path[1]) {
            app.loadVideoPage(path[1]);
        } else if (path[0] === 'channel' && path[1]) {
            app.loadChannelPage(path[1]);
        } else {
            app.loadFeed(); // Fallback на ленту
        }
    },
    
    // Обновление истории браузера
    navigate: (path) => {
        window.history.pushState({}, '', path);
        app.route();
    },

    // ------------------------------------
    // 2. АВТОРИЗАЦИЯ И МОДАЛЬНЫЕ ОКНА
    // ------------------------------------
    
    checkUserStatus: async () => {
        const response = await fetch('/api/me');
        // Возвращает null, если не авторизован
        app.user = await response.json(); 
        app.renderUserMenu();
        // Теперь вызываем роутинг, чтобы страница загрузилась, когда user готов
        app.route();
    },

    renderUserMenu: () => {
        const menu = document.getElementById('userMenu');
        menu.innerHTML = ''; 
        
        if (app.user) {
            menu.innerHTML = `
                <button class="icon-btn" onclick="app.showModal('upload')">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--primary)">
                        <path d="M19 12h-6v6h-2v-6H5v-2h6V4h2v6h6z"/>
                    </svg>
                </button>
                <img src="${app.user.avatar}" onclick="app.navigate('/channel/${app.user.id}')" alt="${app.user.username}" class="user-avatar">
                <button class="icon-btn" onclick="app.handleLogout()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--text-muted)">
                         <path d="M17 7l-1.41 1.41L18.17 11H9v2h9.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                    </svg>
                </button>
            `;
        } else {
            menu.innerHTML = `<button onclick="app.showModal('login')">Войти</button>`;
        }
    },

    showModal: (type) => {
        const overlay = document.getElementById('modalOverlay');
        const authModal = document.getElementById('authModal');
        const uploadModal = document.getElementById('uploadModal');
        
        // Сброс форм
        document.getElementById('authForm').reset();
        document.getElementById('uploadForm').reset();
        
        overlay.classList.remove('hidden');
        authModal.classList.add('hidden');
        uploadModal.classList.add('hidden');

        if (type === 'login' || type === 'register') {
            authModal.classList.remove('hidden');
            app.toggleAuthMode(type === 'register');
        } else if (type === 'upload') {
            if (!app.user) return app.showModal('login');
            uploadModal.classList.remove('hidden');
        }
    },

    closeModal: () => {
        document.getElementById('modalOverlay').classList.add('hidden');
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
        
        // Для входа, если это не регистрация, отправляем JSON
        let bodyContent = formData;
        let headers = {};
        if (!isRegister) {
            bodyContent = JSON.stringify(Object.fromEntries(formData.entries()));
            headers['Content-Type'] = 'application/json';
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: bodyContent, 
                headers: headers
            });
            const result = await response.json();

            if (result.success) {
                app.user = isRegister ? 
                    { id: result.user_id, username: formData.get('username'), avatar: result.avatar || '/img/default_avatar.svg' } : 
                    result.user;
                app.closeModal();
                app.renderUserMenu(); 
                app.loadFeed(); 
            } else {
                alert(result.message || "Ошибка авторизации/регистрации.");
            }
        } catch (error) {
            alert("Сетевая ошибка. Проверьте соединение.");
        }
    },
    
    handleLogout: async () => {
        const response = await fetch('/api/logout', { method: 'POST' });
        if (response.ok) {
            app.user = null;
            app.renderUserMenu();
            app.loadFeed();
        }
    },

    handleUploadSubmit: async (e) => {
        e.preventDefault();
        if (!app.user) return alert("Пожалуйста, войдите, чтобы загрузить видео.");

        const form = e.target;
        const formData = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        
        const videoFile = formData.get('video');
        const thumbnailFile = formData.get('thumbnail');

        if (!formData.get('title') || !videoFile || !thumbnailFile || videoFile.size === 0 || thumbnailFile.size === 0) {
            return alert("Пожалуйста, заполните название, выберите видео и обложку.");
        }
        
        submitBtn.textContent = 'Загрузка...';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (result.success) {
                alert("Видео успешно опубликовано!");
                app.closeModal();
                form.reset();
                app.loadFeed(); 
            } else {
                alert(result.message || "Ошибка при загрузке видео.");
            }
        } catch (error) {
            alert("Сетевая ошибка при загрузке.");
        } finally {
            submitBtn.textContent = 'Опубликовать';
            submitBtn.disabled = false;
        }
    },
    
    // Обработка подписки
    handleSubscribe: async (channelId, isSubscribed) => {
        if (!app.user) return app.showModal('login');

        const response = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: channelId }),
        });
        const result = await response.json();

        if (result.success) {
            const btn = document.getElementById('subscribeBtn');
            const countElem = document.querySelector('.subscriber-count');
            
            // Обновляем счетчик
            let currentCountText = countElem.textContent.split(' ')[0].replace(/[^0-9K M]/g, '');
            let currentCount;
            if (currentCountText.includes('M')) currentCount = parseFloat(currentCountText) * 1000000;
            else if (currentCountText.includes('K')) currentCount = parseFloat(currentCountText) * 1000;
            else currentCount = parseInt(currentCountText) || 0;
            
            const newCount = currentCount + (result.is_subscribed ? 1 : -1);
            
            countElem.textContent = `${app.formatViews(newCount)} подписчиков`;

            if (result.is_subscribed) {
                btn.classList.add('subscribed');
                btn.textContent = '✔️ Подписка оформлена';
            } else {
                btn.classList.remove('subscribed');
                btn.textContent = 'Подписаться';
            }
            // Обновляем onclick на текущем элементе
            btn.setAttribute('onclick', `app.handleSubscribe(${channelId}, ${result.is_subscribed})`);
            
        } else {
            alert(result.message || "Ошибка при выполнении операции подписки.");
        }
    },

    // ------------------------------------
    // 3. РЕНДЕРИНГ КОНТЕНТА
    // ------------------------------------
    
    // Рендер главной ленты
    loadFeed: async () => {
        app.navigate('/');
        app.currentVideo = null;
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка ленты...</h2>';

        try {
            const response = await fetch('/api/videos');
            const videos = await response.json();
            
            let html = '<div class="video-grid">';
            
            if (videos.length === 0) {
                html = '<h2 style="text-align: center; color: var(--text-muted); padding: 50px;">Видео пока нет. Станьте первым!</h2>';
            } else {
                videos.forEach(v => {
                    html += `
                        <div class="video-card" onclick="app.navigate('/watch/${v.id}')">
                            <img class="thumb" src="${v.thumbnail}" alt="${v.title}">
                            <div class="info">
                                <img class="info-avatar" src="${v.author_avatar}" onclick="event.stopPropagation(); app.navigate('/channel/${v.author_id}')" alt="${v.username}">
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
        } catch (error) {
            content.innerHTML = '<h2>Ошибка загрузки ленты.</h2>';
        }
    },

    // Рендер страницы просмотра видео
    loadVideoPage: async (videoId) => {
        app.navigate(`/watch/${videoId}`);
        app.currentVideo = videoId; 
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка видео...</h2>';
        
        try {
            const response = await fetch(`/api/video/${videoId}`);
            if (!response.ok) {
                content.innerHTML = '<h2>Видео не найдено (404)</h2>';
                return;
            }
            
            const data = await response.json();
            const video = data.video;
            const comments = data.comments;
            
            // Определяем класс для кнопок лайков/дизлайков
            const userVote = video.user_vote_type || 'none';
            
            let html = `
                <div class="video-page-container">
                    <div class="video-stage">
                        <div class="video-wrapper">
                            <video id="videoPlayer" width="100%" controls autoplay poster="${video.thumbnail}">
                                <source src="${video.filename}" type="video/mp4">
                                Ваш браузер не поддерживает HTML5 видео.
                            </video>
                        </div>
                        
                        <div class="video-details">
                            <h1>${video.title}</h1>
                            <div class="video-stats">
                                <span id="viewCount">${app.formatViews(video.views + 1)} просмотров</span>
                                <div class="actions">
                                    <button id="likeBtn" 
                                        onclick="app.handleVote(${video.id}, 'like')" 
                                        class="${userVote === 'like' ? 'voted' : ''}" 
                                        data-count="${video.likes}">👍 ${video.likes}</button>
                                    <button id="dislikeBtn" 
                                        onclick="app.handleVote(${video.id}, 'dislike')" 
                                        class="${userVote === 'dislike' ? 'voted' : ''}" 
                                        data-count="${video.dislikes}">👎 ${video.dislikes}</button>
                                </div>
                            </div>
                            <hr>
                            <div class="channel-info">
                                <img src="${video.author_avatar}" onclick="app.navigate('/channel/${video.author_id}')" alt="${video.username}" class="info-avatar">
                                <div>
                                    <h3 onclick="app.navigate('/channel/${video.author_id}')">${video.username}</h3>
                                    <p class="subscriber-count">${app.formatViews(video.subscriber_count)} подписчиков</p>
                                </div>
                                ${app.user && app.user.id != video.author_id ? 
                                    `<button 
                                        id="subscribeBtn" 
                                        class="subscribe-btn ${video.is_subscribed > 0 ? 'subscribed' : ''}" 
                                        onclick="app.handleSubscribe(${video.author_id}, ${video.is_subscribed > 0})"
                                    >
                                        ${video.is_subscribed > 0 ? '✔️ Подписка оформлена' : 'Подписаться'}
                                    </button>` 
                                    : ''
                                }
                            </div>
                            <div class="video-description-box">
                                <p>${video.description.replace(/\n/g, '<br>')}</p>
                            </div>
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
        } catch (error) {
            console.error(error);
            content.innerHTML = '<h2>Ошибка загрузки видео.</h2>';
        }
    },
    
    // Рендер страницы канала
    loadChannelPage: async (userId) => {
        app.navigate(`/channel/${userId}`);
        app.currentVideo = null;
        const content = document.getElementById('appContent');
        content.innerHTML = '<h2>Загрузка канала...</h2>';

        try {
            const response = await fetch(`/api/channel/${userId}`);
            if (!response.ok) {
                content.innerHTML = '<h2>Канал не найден (404)</h2>';
                return;
            }
            
            const data = await response.json();
            const channel = data.channel;
            const videos = data.videos;

            let html = `
                <div class="channel-page-container">
                    <div class="channel-header">
                        <img src="${channel.avatar}" class="channel-big-avatar" alt="${channel.username}">
                        <div class="channel-meta">
                            <h1>${channel.username}</h1>
                            <p class="subscriber-count">${app.formatViews(channel.subscriber_count)} подписчиков</p>
                            
                            ${app.user && app.user.id != channel.id ? 
                                `<button 
                                    id="subscribeBtn" 
                                    class="subscribe-btn ${channel.is_subscribed > 0 ? 'subscribed' : ''}" 
                                    onclick="app.handleSubscribe(${channel.id}, ${channel.is_subscribed > 0})"
                                >
                                    ${channel.is_subscribed > 0 ? '✔️ Подписка оформлена' : 'Подписаться'}
                                </button>` 
                                : ''
                            }
                        </div>
                    </div>

                    <hr class="channel-separator">

                    <div class="channel-videos">
                        <h3>Видео канала (${videos.length})</h3>
                        <div class="video-grid">
                            ${videos.length > 0 ? videos.map(v => `
                                <div class="video-card" onclick="app.navigate('/watch/${v.id}')">
                                    <img class="thumb" src="${v.thumbnail}" alt="${v.title}">
                                    <div class="info">
                                        <img class="info-avatar" src="${channel.avatar}" alt="${channel.username}"> 
                                        <div class="meta">
                                            <h3>${v.title}</h3>
                                            <p>${channel.username} • ${app.formatViews(v.views)} • ${app.timeAgo(v.created_at)}</p>
                                        </div>
                                    </div>
                                </div>
                            `).join('') : '<p style="color: var(--text-muted);">На этом канале пока нет видео.</p>'}
                        </div>
                    </div>
                </div>
            `;
            content.innerHTML = html;
        } catch (error) {
            content.innerHTML = '<h2>Ошибка загрузки канала.</h2>';
        }
    },

    renderComments: (comments) => {
        if (comments.length === 0) return '<p style="text-align: center; color: var(--text-muted);">Комментариев пока нет.</p>';
        return comments.map(app.renderSingleComment).join('');
    },
    
    // ------------------------------------
    // 4. SOCKET.IO И РЕАЛЬНОЕ ВРЕМЯ
    // ------------------------------------

    setupSocketListeners: () => {
        app.socket.on('new_video', (data) => {
             // Если на главной странице, перезагружаем ленту или добавляем элемент
             if (window.location.pathname === '/') app.loadFeed();
        });

        app.socket.on('update_votes', (data) => {
            if (data.videoId == app.currentVideo) {
                const likeBtn = document.getElementById('likeBtn');
                const dislikeBtn = document.getElementById('dislikeBtn');
                
                if(likeBtn) {
                    likeBtn.textContent = `👍 ${data.likes}`;
                    likeBtn.dataset.count = data.likes;
                }
                if(dislikeBtn) {
                    dislikeBtn.textContent = `👎 ${data.dislikes}`;
                    dislikeBtn.dataset.count = data.dislikes;
                }
            }
        });
        
        // Обновление статуса голосования только для текущего пользователя
        app.socket.on('my_vote_status', (data) => {
            if (data.videoId == app.currentVideo) {
                const likeBtn = document.getElementById('likeBtn');
                const dislikeBtn = document.getElementById('dislikeBtn');
                
                if (likeBtn) likeBtn.classList.remove('voted');
                if (dislikeBtn) dislikeBtn.classList.remove('voted');
                
                if (data.type === 'like') likeBtn.classList.add('voted');
                else if (data.type === 'dislike') dislikeBtn.classList.add('voted');
            }
        });

        app.socket.on('new_comment', (data) => {
            if (data.videoId == app.currentVideo) {
                const container = document.getElementById('commentsContainer');
                container.insertAdjacentHTML('afterbegin', app.renderSingleComment(data.comment));
                
                const countElem = document.getElementById('commentCount');
                countElem.textContent = parseInt(countElem.textContent) + 1;
            }
        });
        
        app.socket.on('update_view_count', (data) => {
            if (data.videoId == app.currentVideo) {
                const viewCountElem = document.getElementById('viewCount');
                if (viewCountElem) {
                    viewCountElem.textContent = `${app.formatViews(data.views)} просмотров`;
                }
            }
        });
    },

    handleVote: (videoId, type) => {
        if (!app.user) return app.showModal('login');
        
        // Отправляем запрос через сокет
        app.socket.emit('vote', {
            videoId: videoId,
            type: type,
            userId: app.user.id
        });
    },

    handleCommentSubmit: (e, videoId) => {
        e.preventDefault();
        if (!app.user) return app.showModal('login');

        const commentInput = document.getElementById('commentText');
        const text = commentInput.value.trim();
        if (!text) return;
        
        // Отправляем комментарий через сокет
        app.socket.emit('send_comment', {
            videoId: videoId,
            userId: app.user.id,
            text: text
        });

        commentInput.value = ''; // Очищаем поле ввода
    },

    // ------------------------------------
    // 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ И РЕНДЕР-ХЕЛПЕРЫ
    // ------------------------------------

    formatViews: (num) => {
        num = parseInt(num) || 0;
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
    },

    timeAgo: (dateStr) => {
        const dateV = new Date(dateStr.replace(' ', 'T') + 'Z'); 
        const now = new Date();
        const diff = (now - dateV) / 1000;

        if (diff < 60) return 'только что';
        if(diff < 3600) return Math.floor(diff/60) + ' мин. назад';
        if(diff < 86400) return Math.floor(diff/3600) + ' ч. назад';
        if(diff < 604800) return Math.floor(diff/86400) + ' дн. назад';
        if(diff < 31536000) return Math.floor(diff/2592000) + ' мес. назад';
        return dateV.toLocaleDateString('ru-RU'); 
    },
    
    renderSingleComment: (comment) => {
        // ЗАВЕРШЕНИЕ РЕНДЕРА КОММЕНТАРИЯ
        return `
            <div class="comment">
                <img class="comment-avatar" src="${comment.avatar}" alt="${comment.username}">
                <div>
                    <p><strong>${comment.username}</strong> <span style="font-size: 0.8rem; color: var(--text-muted);">${app.timeAgo(comment.created_at)}</span></p>
                    <p class="comment-text">${comment.text.replace(/\n/g, '<br>')}</p>
                </div>
            </div>
        `;
    }
};

// Запускаем приложение
document.addEventListener('DOMContentLoaded', () => app.init());