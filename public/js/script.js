const socket = io();
let currentUser = null;
const formData = new FormData(form);


const app = {
    init: () => {
        app.checkSession();
        // Проверка URL при загрузке (роутинг)
        const path = window.location.pathname;
        if (path.startsWith('/watch/')) {
            app.loadVideo(path.split('/').pop());
        } else if (path.length > 1 && path.includes('/')) {
            // Формат /Name/ID
            const parts = path.split('/');
            if(parts.length >= 3) app.loadChannel(parts[2]); // ID
        } else {
            app.loadFeed();
        }
        
        // Слушаем сокеты
        app.setupSockets();
    },

    setupSockets: () => {
        socket.on('new_video', (vid) => {
            // Если мы в ленте - добавить видео динамически
            const grid = document.querySelector('.video-grid');
            if(grid) {
                // В реальном приложении лучше создать элемент через DOM API
                app.loadFeed(); 
            }
        });

        socket.on('update_votes', ({ videoId, likes, dislikes }) => {
            const lBtn = document.getElementById('likeBtn');
            const dBtn = document.getElementById('dislikeBtn');
            if(lBtn && lBtn.dataset.vid == videoId) {
                lBtn.innerHTML = `👍 ${likes}`;
                dBtn.innerHTML = `👎 ${dislikes}`;
            }
        });
        
        socket.on('update_view_count', ({videoId, views}) => {
             const vCount = document.getElementById('viewCount');
             if(vCount && vCount.dataset.vid == videoId) vCount.innerText = `${views} просмотров`;
        });

        socket.on('new_comment', ({videoId, comment}) => {
            const list = document.getElementById('commentsList');
            // Проверяем, открыто ли сейчас это видео
            const currentVidId = document.querySelector('.video-wrapper video')?.dataset.id;
            if(list && currentVidId == videoId) {
                list.insertAdjacentHTML('afterbegin', `
                    <div class="comment">
                        <img src="${comment.avatar}" class="comment-avatar">
                        <div>
                            <b>${comment.username}</b> <small>${app.timeAgo(comment.created_at)}</small>
                            <p>${comment.text}</p>
                        </div>
                    </div>
                `);
            }
        });
    },

    checkSession: async () => {
        const res = await fetch('/api/me');
        const data = await res.json();
        if (data.id) {
            currentUser = data;
            document.getElementById('userMenu').innerHTML = `
                <div style="display:flex; gap:10px; align-items:center;">
                    <button onclick="app.showModal('upload')">Загрузить</button>
                    <img src="${data.avatar}" onclick="app.loadChannel(${data.id})">
                </div>
            `;
        }
    },

    // --- Рендеринг страниц (SPA) ---
    
    loadFeed: async () => {
        window.history.pushState({}, '', '/');
        const res = await fetch('/api/videos');
        const videos = await res.json();
        
        const html = `
            <div class="video-grid">
                ${videos.map(v => `
                    <div class="video-card" onclick="app.loadVideo(${v.id})">
                        <img src="${v.thumbnail}" class="thumb">
                        <div class="info">
                            <img src="${v.author_avatar}" class="info-avatar">
                            <div class="meta">
                                <h3>${v.title}</h3>
                                <p>${v.username} • ${v.views} просмотров</p>
                                <p>${app.timeAgo(v.created_at)}</p>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        document.getElementById('appContent').innerHTML = html;
    },

    loadVideo: async (id) => {
        window.history.pushState({}, '', `/watch/${id}`);
        const res = await fetch(`/api/video/${id}`);
        const { video, comments } = await res.json();

        const html = `
            <div class="player-container">
                <div class="video-stage">
                    <div class="video-wrapper">
                        <video src="${video.filename}" controls autoplay data-id="${video.id}"></video>
                    </div>
                    <h1>${video.title}</h1>
                    <div class="video-stats">
                        <div id="viewCount" data-vid="${video.id}">${video.views} просмотров</div>
                        <div class="actions">
                            <button id="likeBtn" data-vid="${video.id}" onclick="app.vote(${video.id}, 'like')">👍 ${video.likes}</button>
                            <button id="dislikeBtn" data-vid="${video.id}" onclick="app.vote(${video.id}, 'dislike')">👎 ${video.dislikes}</button>
                        </div>
                    </div>
                    <hr style="border-color:var(--glass)">
                    <div style="display:flex; gap:10px; align-items:center; cursor:pointer" onclick="app.loadChannel(${video.author_id}, '${video.username}')">
                        <img src="${video.author_avatar}" style="width:50px; height:50px; border-radius:50%">
                        <h3>${video.username}</h3>
                    </div>
                    <p>${video.description || ''}</p>
                </div>
                
                <div class="comments-section">
                    <h3>Комментарии</h3>
                    ${currentUser ? `
                        <div style="display:flex; gap:5px;">
                            <input id="commentInput" type="text" placeholder="Написать...">
                            <button onclick="app.sendComment(${video.id})">></button>
                        </div>
                    ` : '<p>Войдите, чтобы комментировать</p>'}
                    <div id="commentsList" style="margin-top:20px;">
                        ${comments.map(c => `
                            <div class="comment">
                                <img src="${c.avatar}" class="comment-avatar">
                                <div>
                                    <b>${c.username}</b> <small>${app.timeAgo(c.created_at)}</small>
                                    <p>${c.text}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        document.getElementById('appContent').innerHTML = html;
    },

    loadChannel: async (id, name = 'User') => {
        // Формируем URL /Name/ID
        window.history.pushState({}, '', `/${name}/${id}`);
        
        // В реальном проекте нужен API endpoint /api/channel/:id для получения видео юзера
        // Тут отфильтруем просто все видео (упрощение)
        const res = await fetch('/api/videos');
        const allVideos = await res.json();
        const userVideos = allVideos.filter(v => v.author_id == id);
        
        // Если это наш канал, покажем кнопку смены аватарки
        const isMe = currentUser && currentUser.id == id;
        
        let headerHtml = `
            <div class="channel-header">
                <div style="position:relative">
                    <img src="${userVideos[0]?.author_avatar || '/img/default_avatar.svg'}" class="channel-big-avatar">
                    ${isMe ? `<button onclick="document.getElementById('newAv').click()" style="position:absolute; bottom:0; right:0; font-size:0.8rem">📷</button>
                              <input type="file" id="newAv" hidden onchange="app.changeAvatar(this)">` : ''}
                </div>
                <div>
                    <h1>${userVideos[0]?.username || name}</h1>
                    <p>${userVideos.length} видео</p>
                </div>
            </div>
        `;

        let gridHtml = `<div class="video-grid">
            ${userVideos.map(v => `
                 <div class="video-card" onclick="app.loadVideo(${v.id})">
                    <img src="${v.thumbnail}" class="thumb">
                    <div class="info">
                        <div class="meta">
                            <h3>${v.title}</h3>
                            <p>${v.views} просмотров • ${app.timeAgo(v.created_at)}</p>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>`;

        document.getElementById('appContent').innerHTML = headerHtml + gridHtml;
    },

    // --- Действия ---
    vote: (vid, type) => {
        if(!currentUser) return app.showModal('login');
        socket.emit('vote', { videoId: vid, type, userId: currentUser.id });
    },

    sendComment: (vid) => {
        const input = document.getElementById('commentInput');
        if(!input.value) return;
        socket.emit('send_comment', { videoId: vid, userId: currentUser.id, text: input.value });
        input.value = '';
    },

    changeAvatar: async (input) => {
        const formData = new FormData();
        formData.append('avatar', input.files[0]);
        await fetch('/api/update-avatar', { method: 'POST', body: formData });
        window.location.reload();
    },

timeAgo: (dateStr) => {
    // 1. Превращаем формат SQLite "2023-11-30 12:00:00" в ISO "2023-11-30T12:00:00.000Z"
    // Буква 'Z' в конце говорит браузеру, что это время UTC
    const dateV = new Date(dateStr.replace(' ', 'T') + 'Z');
    
    // 2. Получаем текущее время
    const now = new Date();
    
    // 3. Считаем разницу в секундах
    const diff = (now - dateV) / 1000;

    // Защита от отрицательных чисел (если время на сервере чуть спешит)
    if (diff < 0) return 'только что';

    if(diff < 60) return 'только что';
    if(diff < 3600) return Math.floor(diff/60) + ' мин. назад';
    if(diff < 86400) return Math.floor(diff/3600) + ' ч. назад';
    return Math.floor(diff/86400) + ' дн. назад';
},

    showModal: (type) => {
        document.getElementById('modalOverlay').classList.remove('hidden');
        if(type === 'login') {
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
        const isReg = document.getElementById('regFields').classList.toggle('hidden');
        document.getElementById('modalTitle').innerText = isReg ? 'Вход' : 'Регистрация';
        // Логику переключения action формы можно добавить здесь
    }
};

// Обработка форм
document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();
    const isRegister = !document.getElementById('regFields').classList.contains('hidden');
    const endpoint = isRegister ? '/api/register' : '/api/login';
    const body = new FormData(e.target);
    
    // Fetch для FormData автоматически ставит нужные заголовки, 
    // но для JSON (login) нужно иначе. Для упрощения отправляем FormData везде (multer разберет)
    // но для json endpoint в express нужен body parser. 
    // Проще: для регистрации FormData, для логина JSON
    
    let res;
    if(isRegister) {
        res = await fetch(endpoint, { method: 'POST', body: body });
    } else {
        const data = Object.fromEntries(body.entries());
        res = await fetch(endpoint, { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data) 
        });
    }
    
    const json = await res.json();
    if(json.success) window.location.reload();
    else alert(json.message);
};

document.getElementById('uploadForm').onsubmit = async (e) => {
    e.preventDefault();
    const body = new FormData(e.target);
    fetch('/api/upload', { method: 'POST', body: formData})
    const json = await res.json();
    if(json.success) {
        app.closeModal();
        app.loadFeed();
    }
};

app.init();