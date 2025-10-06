import { database } from './firebase-config.js';
console.log('✅ Database импортирован:', database);
import { 
    ref, 
    push, 
    onValue, 
    serverTimestamp,
    onDisconnect,
    set,
    remove,
    get,
    update,
    off
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

let currentUser = null;
let currentChatUser = null;
let messagesListener = null;
let selectedAvatar = 1;
let selectedAvatarImage = null;
let isDeveloper = false;
let currentReply = null;
let selectedMessage = null;
let activeChats = {};
let isEditing = false;
let existingMessages = new Set();
let blockedUsers = new Set();
let userIP = null;
let contextMenuTarget = null;
let longPressTimer = null;
let currentView = 'chats';

fetch('https://api.ipify.org?format=json')
    .then(response => response.json())
    .then(data => {
        userIP = data.ip;
    })
    .catch(() => {
        userIP = 'Unknown';
    });

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(registration => {
                console.log('✅ SW registered:', registration);
            })
            .catch(error => {
                console.log('❌ SW registration failed:', error);
            });
    });
}

function showNotification(title, message, buttons = []) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customNotification');
        const titleEl = document.getElementById('notificationTitle');
        const messageEl = document.getElementById('notificationMessage');
        const buttonsEl = document.getElementById('notificationButtons');
        
        titleEl.textContent = title;
        messageEl.textContent = message;
        buttonsEl.innerHTML = '';
        
        buttons.forEach(btn => {
            const button = document.createElement('button');
            button.className = `notification-btn notification-btn-${btn.type || 'secondary'}`;
            button.textContent = btn.text;
            button.onclick = () => {
                modal.classList.remove('show');
                const result = btn.onClick ? btn.onClick() : true;
                resolve(result);
            };
            buttonsEl.appendChild(button);
        });
        
        modal.classList.add('show');
    });
}

function customAlert(message) {
    return showNotification('Уведомление', message, [
        { text: 'OK', type: 'primary', onClick: () => true }
    ]);
}


function customConfirm(message) {
    return showNotification('Подтверждение', message, [
        { text: 'Отмена', type: 'secondary', onClick: () => false },
        { text: 'OK', type: 'danger', onClick: () => true }
    ]);
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    checkExistingUser();
    setupEventListeners();
    setupMobileNav();
    setupChatContextMenu();
    setupSettings();
    handleViewportChange();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportChange);
    }
});



function checkExistingUser() {
    console.log('🔍 Шаг 1: Проверка существующего пользователя...');
    const savedUser = localStorage.getItem('waveUser');
    
    if (savedUser) {
        console.log('✅ Найден сохраненный пользователь:', savedUser);
        currentUser = JSON.parse(savedUser);
        isDeveloper = currentUser.isDeveloper || false;
        
        console.log('🔍 Шаг 2: Проверка пользователя в Firebase...');
        get(ref(database, `users/${currentUser.id}`))
            .then(snapshot => {
                if (snapshot.exists()) {
                    console.log('✅ Пользователь найден в Firebase:', snapshot.val());
                    document.getElementById('loginModal').classList.add('hidden');
                    updateUserUI();
                    console.log('🔍 Шаг 3: Инициализация приложения...');
                    initApp();
                } else {
                    console.error('❌ Пользователь не найден в Firebase');
                    localStorage.removeItem('waveUser');
                    currentUser = null;
                }
            })
            .catch(error => {
                console.error('❌ Ошибка проверки Firebase:', error);
                customAlert('Ошибка подключения к Firebase: ' + error.message);
            });
    } else {
        console.log('ℹ️ Сохраненный пользователь не найден');
    }
}

function setupEventListeners() {
    document.getElementById('loginTab').addEventListener('click', () => {
        document.getElementById('loginTab').classList.add('active');
        document.getElementById('registerTab').classList.remove('active');
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
    });
    
    document.getElementById('registerTab').addEventListener('click', () => {
        document.getElementById('registerTab').classList.add('active');
        document.getElementById('loginTab').classList.remove('active');
        document.getElementById('registerForm').style.display = 'block';
        document.getElementById('loginForm').style.display = 'none';
    });

    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('registerBtn').addEventListener('click', register);

    document.getElementById('registerUsername').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^a-zA-Z0-9]/g, '');
    });

    document.getElementById('loginPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });
    document.getElementById('registerPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') register();
    });

    document.getElementById('currentUserInfo').addEventListener('click', () => openProfile(currentUser.id));
    document.getElementById('profileAvatar').addEventListener('click', (e) => {
        e.preventDefault();
    });
    document.getElementById('avatarUpload').addEventListener('change', uploadAvatar);
    document.getElementById('editProfileBtn').addEventListener('click', editProfile);
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('closeProfileBtn').addEventListener('click', closeProfile);
    document.getElementById('closeProfileModalBtn').addEventListener('click', closeProfile);
    document.getElementById('messageUserBtn').addEventListener('click', startChatFromProfile);
    document.getElementById('kickUserBtn').addEventListener('click', kickUser);
    document.getElementById('blockUserBtn').addEventListener('click', toggleBlockUser);
    document.getElementById('changeUsernameBtn').addEventListener('click', showUsernameChange);
    document.getElementById('saveUsernameBtn').addEventListener('click', saveUsername);
    document.getElementById('cancelUsernameBtn').addEventListener('click', hideUsernameChange);
    document.getElementById('logoutProfileBtn').addEventListener('click', logout);
    document.getElementById('deleteAccountBtn').addEventListener('click', deleteAccount);

    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('messageInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    document.getElementById('messageInput').addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 100) + 'px';
    });

    document.getElementById('mediaUpload').addEventListener('change', handleMediaUpload);

    document.getElementById('cancelReplyBtn').addEventListener('click', cancelReply);
    document.getElementById('replyMessageBtn').addEventListener('click', replyToMessage);
    document.getElementById('copyMessageBtn').addEventListener('click', copyMessage);
    document.getElementById('deleteMessageBtn').addEventListener('click', deleteMessage);

    document.getElementById('menuToggleBtn').addEventListener('click', toggleSidebar);
    
    document.getElementById('chatOptionsBtn').addEventListener('click', toggleChatOptionsMenu);
    document.getElementById('clearChatMenuBtn').addEventListener('click', () => {
        hideChatOptionsMenu();
        clearCurrentChat();
    });
    document.getElementById('chatUserInfo').addEventListener('click', () => {
        if (currentChatUser) openProfile(currentChatUser.id);
    });

    document.getElementById('searchInput').addEventListener('input', searchUsers);

    document.getElementById('imageViewer').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeImageViewer();
    });
    document.getElementById('closeImageViewerBtn').addEventListener('click', closeImageViewer);

    document.addEventListener('click', hideMessageMenu);
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.chat-options-menu') && !e.target.closest('#chatOptionsBtn')) {
            hideChatOptionsMenu();
        }
    });
}

function backToChats() {
    if (window.innerWidth <= 768) {
        const welcomeScreen = document.getElementById('welcomeScreen');
        const chatHeader = document.getElementById('chatHeader');
        const messagesContainer = document.getElementById('messagesContainer');
        const messageInputContainer = document.getElementById('messageInputContainer');
        

        chatHeader.classList.remove('view-visible');
        messagesContainer.classList.remove('view-visible');
        messageInputContainer.classList.remove('view-visible');
        

        welcomeScreen.classList.remove('view-hidden');
        

        document.getElementById('sidebar').classList.remove('hidden');
        document.getElementById('chatArea').classList.remove('active');
        document.getElementById('mobileNav').classList.remove('in-chat');
        
        const toggleBtn = document.getElementById('mobileNavToggle');
        if (toggleBtn) {
            toggleBtn.classList.remove('in-chat');
        }
        
        currentChatUser = null;
        
        if (messagesListener) {
            messagesListener();
            messagesListener = null;
        }
        
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.blur();
        }
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem('waveTheme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
    } else if (!savedTheme) {
        localStorage.setItem('waveTheme', 'light');
    }
}

function setupSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const themeToggle = document.getElementById('themeToggle');
    
    if (!settingsBtn || !settingsModal || !closeSettingsBtn || !themeToggle) {
        return;
    }
    
    const savedTheme = localStorage.getItem('waveTheme');
    if (savedTheme === 'dark') {
        themeToggle.checked = true;
    }
    
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });
    
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });
    
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.add('hidden');
        }
    });
    
    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            document.body.classList.add('dark-theme');
            localStorage.setItem('waveTheme', 'dark');
        } else {
            document.body.classList.remove('dark-theme');
            localStorage.setItem('waveTheme', 'light');
        }
    });
}

function handleViewportChange() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

function setupMobileNav() {
    if (window.innerWidth <= 768) {
        const mobileNav = document.getElementById('mobileNav');
        const toggleBtn = document.getElementById('mobileNavToggle');


        const updateNavVisibility = (snapshot) => {
            const chats = snapshot.val() || {};
            const hasChats = Object.keys(chats).length > 0;

            if (hasChats && !currentChatUser) {
                mobileNav.classList.add('show');
                toggleBtn.style.display = 'flex';
            } else if (!hasChats) {
                mobileNav.classList.remove('show');
                toggleBtn.style.display = 'none';
            }
        };


        if (currentUser) {
            const chatsRef = ref(database, `userChats/${currentUser.id}`);
            onValue(chatsRef, updateNavVisibility);
        }
        

        const savedNavState = localStorage.getItem('mobileNavVisible');
        
        if (savedNavState === 'false') {
            mobileNav.classList.add('hidden');
            toggleBtn.classList.add('nav-hidden');
            toggleBtn.classList.remove('nav-visible');
        } else {
            mobileNav.classList.remove('hidden');
            toggleBtn.classList.remove('nav-hidden');
            toggleBtn.classList.add('nav-visible');
        }


        toggleBtn.addEventListener('click', () => {
            const isHidden = mobileNav.classList.toggle('hidden');
            toggleBtn.classList.toggle('nav-hidden');
            toggleBtn.classList.toggle('nav-visible');
            localStorage.setItem('mobileNavVisible', isHidden ? 'false' : 'true');
        });
        

        document.getElementById('navChats').addEventListener('click', () => {
            if (currentChatUser) {
                backToChats();
            }
            showMobileView('chats');
        });
        
        document.getElementById('navSearch').addEventListener('click', () => {
            if (currentChatUser) {
                backToChats();
            }
            showMobileView('search');
        });
        
        document.getElementById('navProfile').addEventListener('click', () => {
            openProfile(currentUser.id);
        });
    }
}

function showMobileView(view) {
    currentView = view;
    
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (view === 'chats') {
        document.getElementById('navChats').classList.add('active');
        document.getElementById('searchContainer').classList.remove('active');
        document.getElementById('chatsList').classList.remove('hidden');
    } else if (view === 'search') {
        document.getElementById('navSearch').classList.add('active');
        document.getElementById('searchContainer').classList.add('active');
        document.getElementById('chatsList').classList.add('hidden');
    }
}

function setupChatContextMenu() {
    document.addEventListener('contextmenu', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            e.preventDefault();
            showChatContextMenu(e.pageX, e.pageY, chatItem);
        }
    });

    document.addEventListener('touchstart', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            longPressTimer = setTimeout(() => {
                const touch = e.touches[0];
                showChatContextMenu(touch.pageX, touch.pageY, chatItem);
                e.preventDefault();
            }, 500);
        }
    });
    
    document.addEventListener('touchend', () => {
        clearTimeout(longPressTimer);
    });
    
    document.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer);
    });

    document.getElementById('deleteChatBtn').addEventListener('click', deleteChat);
    document.getElementById('viewProfileBtn').addEventListener('click', viewChatProfile);
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.chat-context-menu')) {
            document.getElementById('chatContextMenu').classList.remove('show');
        }
    });
}

function showChatContextMenu(x, y, chatItem) {
    const menu = document.getElementById('chatContextMenu');
    contextMenuTarget = chatItem;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }
    
    menu.classList.add('show');
}

async function deleteChat() {
    if (!contextMenuTarget) return;
    
    const userId = contextMenuTarget.dataset.userId;
    if (!userId) return;
    
    const confirmed = await customConfirm('Удалить этот чат?');
    
    if (confirmed) {
        try {
            const chatRef = ref(database, `userChats/${currentUser.id}/${userId}`);
            await remove(chatRef);
            
            if (currentChatUser && currentChatUser.id === userId) {
                currentChatUser = null;
                document.getElementById('welcomeScreen').classList.remove('view-hidden');
                document.getElementById('chatHeader').classList.remove('view-visible');
                document.getElementById('messagesContainer').classList.remove('view-visible');
                document.getElementById('messageInputContainer').classList.remove('view-visible');
            }
        } catch (error) {
            console.error('Error deleting chat:', error);
        }
    }
    
    document.getElementById('chatContextMenu').classList.remove('show');
}

function viewChatProfile() {
    if (!contextMenuTarget) return;
    
    const userId = contextMenuTarget.dataset.userId;
    if (userId) {
        openProfile(userId);
    }
    
    document.getElementById('chatContextMenu').classList.remove('show');
}

function hashPassword(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        const char = password.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString();
}

async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorDiv = document.getElementById('loginError');
    
    if (!username || !password) {
        errorDiv.textContent = 'Заполните все поля';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);
        const users = snapshot.val() || {};
        
        let userFound = null;
        for (const [userId, userData] of Object.entries(users)) {
            if (userData.username === username && userData.password === hashPassword(password)) {
                userFound = { id: userId, ...userData };
                break;
            }
        }
        
        if (!userFound) {
            errorDiv.textContent = 'Неверный username или пароль';
            errorDiv.style.display = 'block';
            return;
        }
        
        currentUser = userFound;
        isDeveloper = currentUser.isDeveloper || false;
        
        localStorage.setItem('waveUser', JSON.stringify(currentUser));

        const userRef = ref(database, `users/${currentUser.id}`);
        await update(userRef, {
            online: true,
            lastSeen: serverTimestamp(),
            ip: userIP || 'Unknown'
        });
        
        onDisconnect(userRef).update({
            online: false,
            lastSeen: serverTimestamp()
        });
        
        document.getElementById('loginModal').classList.add('hidden');
        updateUserUI();
        initApp();
        
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'Ошибка входа';
        errorDiv.style.display = 'block';
    }
}

async function register() {
    const name = document.getElementById('registerName').value.trim();
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorDiv = document.getElementById('registerError');
    
    if (!name || !username || !password) {
        errorDiv.textContent = 'Заполните все поля';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (name.length < 2) {
        errorDiv.textContent = 'Имя должно содержать минимум 2 символа';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (username.length < 3) {
        errorDiv.textContent = 'Username должен содержать минимум 3 символа';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (!/^[a-zA-Z0-9]+$/.test(username)) {
        errorDiv.textContent = 'Username может содержать только английские буквы и цифры';
        errorDiv.style.display = 'block';
        return;
    }

    if (password.length < 3) {
        errorDiv.textContent = 'Пароль должен содержать минимум 3 символа';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);
        const users = snapshot.val() || {};
        
        const usernameExists = Object.values(users).some(user => 
            user.username && user.username.toLowerCase() === username.toLowerCase()
        );
        
        if (usernameExists) {
            errorDiv.textContent = 'Этот username уже занят';
            errorDiv.style.display = 'block';
            return;
        }
        
        errorDiv.style.display = 'none';
        isDeveloper = username === 'Developer';
        
        const userId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        currentUser = {
            id: userId,
            username: username,
            name: name,
            avatar: 1,
            avatarImage: null,
            bio: '',
            joinedAt: Date.now(),
            isDeveloper: isDeveloper,
            password: hashPassword(password),
            blockedUsers: []
        };
        
        localStorage.setItem('waveUser', JSON.stringify(currentUser));
        
        const userRef = ref(database, `users/${userId}`);
        await set(userRef, {
            username: username,
            name: name,
            avatar: 1,
            avatarImage: null,
            bio: '',
            online: true,
            isDeveloper: isDeveloper,
            lastSeen: serverTimestamp(),
            ip: userIP || 'Unknown',
            password: hashPassword(password),
            blockedUsers: {}
        });
        
        onDisconnect(userRef).update({
            online: false,
            lastSeen: serverTimestamp()
        });
        
        document.getElementById('loginModal').classList.add('hidden');
        updateUserUI();
        initApp();
        
    } catch (error) {
        console.error('Register error:', error);
        errorDiv.textContent = 'Ошибка регистрации';
        errorDiv.style.display = 'block';
    }
}

function updateUserUI() {
    if (!currentUser) return;
    
    document.getElementById('currentUserName').textContent = currentUser.name || 'User';
    const avatar = document.getElementById('currentUserAvatar');
    
    if (currentUser.avatarImage) {
        avatar.innerHTML = `<img src="${currentUser.avatarImage}" alt="">`;
        avatar.className = 'user-avatar';
    } else {
        const avatarText = document.getElementById('currentUserAvatarText');
        avatarText.textContent = (currentUser.name || 'U').charAt(0).toUpperCase();
        avatar.className = `user-avatar avatar-gradient-${currentUser.avatar || 1}`;
    }
}

function initApp() {
    console.log('🚀 Инициализация приложения');
    console.log('👤 Текущий пользователь:', currentUser);
    console.log('🔗 Database объект:', database);
    
    if (!currentUser) {
        console.error('❌ currentUser не определен!');
        return;
    }
    
    if (!database) {
        console.error('❌ database не определен!');
        customAlert('Ошибка: Firebase Database не инициализирована');
        return;
    }
    
    setupOnlineStatus();
    loadBlockedUsers();
    loadChats();
}

async function loadBlockedUsers() {
    const userRef = ref(database, `users/${currentUser.id}/blockedUsers`);
    onValue(userRef, (snapshot) => {
        const blocked = snapshot.val() || {};
        blockedUsers = new Set(Object.keys(blocked));
    });
}

async function setupOnlineStatus() {
    const userRef = ref(database, `users/${currentUser.id}`);
    
    await update(userRef, {
        online: true,
        lastSeen: serverTimestamp(),
        ip: userIP || 'Unknown'
    });
    
    window.addEventListener('beforeunload', async () => {
        await update(userRef, {
            online: false,
            lastSeen: serverTimestamp()
        });
    });
    
    setInterval(async () => {
        await update(userRef, {
            online: true,
            lastSeen: serverTimestamp()
        });
    }, 30000);
}

async function loadChats() {
    console.log('📱 === НАЧАЛО loadChats() ===');
    console.log('👤 currentUser:', currentUser);
    console.log('🔗 database:', database);
    
    if (!currentUser || !currentUser.id) {
        console.error('❌ Нет currentUser или currentUser.id');
        return;
    }
    
    const container = document.getElementById('chatsContainer');
    if (!container) {
        console.error('❌ Элемент chatsContainer не найден!');
        return;
    }
    
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">⏳ Загрузка чатов...</div>';
    
    const chatsRef = ref(database, `userChats/${currentUser.id}`);
    console.log('📍 Путь к чатам:', `userChats/${currentUser.id}`);
    

    if (window.chatsListener) {
        console.log('🔄 Отписка от предыдущего listener');
        window.chatsListener();
    }
    

    try {
        console.log('🔍 Попытка получить чаты через get()...');
        const snapshot = await get(chatsRef);
        console.log('📊 Snapshot exists:', snapshot.exists());
        console.log('📊 Snapshot val:', snapshot.val());
        
        if (!snapshot.exists()) {
            console.log('ℹ️ Нет чатов в базе данных');
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Нет чатов. Найдите пользователей через поиск!</div>';
            

            window.chatsListener = onValue(chatsRef, handleChatsUpdate, handleChatsError);
            return;
        }
        

        window.chatsListener = onValue(chatsRef, handleChatsUpdate, handleChatsError);
        
    } catch (error) {
        console.error('❌ Ошибка при загрузке чатов:', error);
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">❌ Ошибка: ${error.message}</div>`;
    }
}

async function handleChatsUpdate(snapshot) {
    console.log('🔔 handleChatsUpdate вызван');
    console.log('📊 Данные snapshot:', snapshot.val());
    
    const chats = snapshot.val();
    const container = document.getElementById('chatsContainer');
    
    if (!chats || Object.keys(chats).length === 0) {
        console.log('ℹ️ Чаты пусты');
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Нет чатов. Найдите пользователей через поиск!</div>';
        return;
    }
    
    console.log('📝 Количество чатов:', Object.keys(chats).length);
    
    try {
        const chatPromises = Object.entries(chats).map(async ([userId, chatData]) => {
            console.log(`👤 Загрузка пользователя ${userId}...`);
            
            if (blockedUsers.has(userId)) {
                console.log(`🚫 Пользователь ${userId} заблокирован, пропускаем`);
                return null;
            }
            
            try {
                const userRef = ref(database, `users/${userId}`);
                const userSnapshot = await get(userRef);
                
                if (!userSnapshot.exists()) {
                    console.log(`⚠️ Пользователь ${userId} не существует в базе`);
                    return null;
                }
                
                const userData = userSnapshot.val();
                console.log(`✅ Пользователь ${userId} загружен:`, userData);
                
                return {
                    userId,
                    userData,
                    lastMessage: chatData.lastMessage || '',
                    lastMessageTime: chatData.lastMessageTime || 0,
                    lastMessageSender: chatData.lastMessageSender || '',
                    unread: chatData.unread || 0
                };
            } catch (error) {
                console.error(`❌ Ошибка загрузки пользователя ${userId}:`, error);
                return null;
            }
        });
        
        const results = await Promise.all(chatPromises);
        const validChats = results.filter(chat => chat !== null);
        
        console.log('✅ Валидные чаты:', validChats);
        console.log('📊 Количество валидных чатов:', validChats.length);
        
        if (validChats.length === 0) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Нет активных чатов</div>';
            return;
        }
        
        // Сортируем по времени последнего сообщения
        const sortedChats = validChats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        
        // Очищаем контейнер
        container.innerHTML = '';
        
        // Создаем элементы чатов
        sortedChats.forEach((chat, index) => {
            console.log(`🎨 Создание чата #${index + 1}:`, chat);
            const chatItem = createChatItem(chat);
            container.appendChild(chatItem);
        });
        
        console.log('✅ Все чаты отображены');
        
    } catch (error) {
        console.error('❌ Ошибка обработки чатов:', error);
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Ошибка: ${error.message}</div>`;
    }
}

// Обработчик ошибок для onValue
function handleChatsError(error) {
    console.error('❌ Firebase onValue ошибка:', error);
    const container = document.getElementById('chatsContainer');
    if (container) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">
            ❌ Ошибка подключения к Firebase:<br>
            ${error.message}<br>
            <small>Проверьте настройки Firebase</small>
        </div>`;
    }
    customAlert('Ошибка Firebase: ' + error.message);
}

function createChatItem(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.dataset.userId = chat.userId;
    
    if (currentChatUser && currentChatUser.id === chat.userId) {
        div.classList.add('active');
    }
    
    let avatarHtml;
    if (chat.userData.avatarImage) {
        avatarHtml = `<img src="${chat.userData.avatarImage}" alt="">`;
    } else {
        avatarHtml = (chat.userData.name || 'U').charAt(0).toUpperCase();
    }
    
    const time = chat.lastMessageTime ? formatTime(chat.lastMessageTime) : '';
    const unreadHtml = chat.unread > 0 ? `<div class="chat-item-unread">${chat.unread}</div>` : '';

    let lastMessageDisplay = chat.lastMessage;
    if (chat.lastMessageSender === currentUser.id) {
        lastMessageDisplay = `Вы: ${chat.lastMessage}`;
    }
    
    div.innerHTML = `
        <div class="chat-item-avatar avatar-gradient-${chat.userData.avatar || 1}">
            ${avatarHtml}
        </div>
        <div class="chat-item-info">
            <div class="chat-item-name">${chat.userData.name || 'User'}${chat.userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : ''}</div>
            <div class="chat-item-last-message">${lastMessageDisplay || ''}</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
            <div class="chat-item-time">${time}</div>
            ${unreadHtml}
        </div>
    `;
    
    div.addEventListener('click', () => {
        openChat(chat.userId, chat.userData);
        if (window.innerWidth <= 768) {
            document.getElementById('sidebar').classList.add('hidden');
            document.getElementById('chatArea').classList.add('active');
        }
    });
    
    return div;
}

async function searchUsers() {
    const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
    const resultsDiv = document.getElementById('searchResults');
    
    if (!searchTerm) {
        resultsDiv.innerHTML = '';
        return;
    }
    
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    const users = snapshot.val() || {};
    
    resultsDiv.innerHTML = '';
    
    Object.entries(users).forEach(([userId, userData]) => {
        if (userId !== currentUser.id && userData && !blockedUsers.has(userId)) {
            const usernameMatch = userData.username && userData.username.toLowerCase().includes(searchTerm);
            const nameMatch = userData.name && userData.name.toLowerCase().includes(searchTerm);
            
            if (usernameMatch || nameMatch) {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';
                
                let avatarHtml;
                if (userData.avatarImage) {
                    avatarHtml = `<img src="${userData.avatarImage}" alt="">`;
                } else {
                    avatarHtml = (userData.name || '?').charAt(0).toUpperCase();
                }
                
                resultItem.innerHTML = `
                    <div class="chat-item-avatar avatar-gradient-${userData.avatar || 1}" style="width: 35px; height: 35px; font-size: 14px;">
                        ${avatarHtml}
                    </div>
                    <div style="flex: 1;">
                        <div style="font-weight: 600;">${userData.name || 'Unknown'}${userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : ''}</div>
                        ${userData.username ? `<div style="font-size: 11px; color: var(--text-secondary);">@${userData.username}</div>` : ''}
                        <div style="font-size: 12px; color: var(--text-secondary);">${userData.online ? 'В сети' : 'Не в сети'}</div>
                    </div>
                `;
                
                resultItem.addEventListener('click', () => {
                    openChat(userId, userData);
                    document.getElementById('searchInput').value = '';
                    resultsDiv.innerHTML = '';
                });
                
                resultsDiv.appendChild(resultItem);
            }
        }
    });
}

async function openChat(userId, userData) {
    console.log('💬 Открытие чата с:', userData.name);
    
    if (blockedUsers.has(userId)) {
        await customAlert('Этот пользователь заблокирован');
        return;
    }
    
    currentChatUser = { id: userId, ...userData };
    
    existingMessages.clear();
    const container = document.getElementById('messagesContainer');
    container.innerHTML = '';

    const welcomeScreen = document.getElementById('welcomeScreen');
    const chatHeader = document.getElementById('chatHeader');
    const messagesContainer = document.getElementById('messagesContainer');
    const messageInputContainer = document.getElementById('messageInputContainer');
    
    welcomeScreen.classList.add('view-hidden');
    chatHeader.classList.add('view-visible');
    messagesContainer.classList.add('view-visible');
    messageInputContainer.classList.add('view-visible');
    
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('hidden');
        document.getElementById('chatArea').classList.add('active');
        

        const mobileNav = document.getElementById('mobileNav');
        const toggleBtn = document.getElementById('mobileNavToggle');
        
        mobileNav.classList.add('in-chat');
        if (toggleBtn) {
            toggleBtn.classList.add('in-chat');
        }
    } else {
        setTimeout(() => {
            document.getElementById('messageInput').focus();
        }, 100);
    }
    
    const chatAvatar = document.getElementById('chatUserAvatar');
    if (userData.avatarImage) {
        chatAvatar.innerHTML = `<img src="${userData.avatarImage}" alt="">`;
        chatAvatar.className = 'chat-user-avatar';
    } else {
        chatAvatar.innerHTML = (userData.name || 'U').charAt(0).toUpperCase();
        chatAvatar.className = `chat-user-avatar avatar-gradient-${userData.avatar || 1}`;
    }
    
    document.getElementById('chatUserName').innerHTML = (userData.name || 'User') + (userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : '');
    
    const statusRef = ref(database, `users/${userId}`);
    onValue(statusRef, (snapshot) => {
        const user = snapshot.val();
        if (user) {
            const lastSeen = user.online ? 'В сети' : (user.lastSeen ? `Был(а) ${formatLastSeen(user.lastSeen)}` : 'Не в сети');
            document.getElementById('chatUserStatus').textContent = lastSeen;
        }
    });
    
    await markAsRead(userId);
    
    console.log('🔍 Загружаем сообщения...');
    loadMessages(userId);
    
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeChat = document.querySelector(`[data-user-id="${userId}"]`);
    if (activeChat) activeChat.classList.add('active');
}

async function markAsRead(userId) {
    const chatRef = ref(database, `userChats/${currentUser.id}/${userId}`);
    await update(chatRef, { unread: 0 }).catch(() => {});
}

function loadMessages(userId) {
    if (messagesListener) {
        messagesListener();
    }
    
    const chatId = getChatId(currentUser.id, userId);
    const messagesRef = ref(database, `messages/${chatId}`);
    
    messagesListener = onValue(messagesRef, (snapshot) => {
        const messages = snapshot.val() || {};
        const container = document.getElementById('messagesContainer');
        
        const sortedMessages = Object.entries(messages).sort((a, b) => {
            return (a[1].timestamp || 0) - (b[1].timestamp || 0);
        });
        
        sortedMessages.forEach(([msgId, msg]) => {
            if (!existingMessages.has(msgId)) {
                displayMessage(msg, msgId);
                existingMessages.add(msgId);
            }
        });
        
        const currentMessageIds = new Set(Object.keys(messages));
        existingMessages.forEach(msgId => {
            if (!currentMessageIds.has(msgId)) {
                const msgElement = document.querySelector(`[data-message-id="${msgId}"]`);
                if (msgElement) {
                    msgElement.remove();
                    existingMessages.delete(msgId);
                }
            }
        });
        
        scrollToBottom();
    });
}

function displayMessage(msg, msgId) {
    const container = document.getElementById('messagesContainer');
    
    if (msg.type === 'system') {
        const systemMsg = document.createElement('div');
        systemMsg.className = 'system-message';
        systemMsg.dataset.messageId = msgId;
        systemMsg.textContent = msg.text;
        container.appendChild(systemMsg);
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.dataset.messageId = msgId;
    
    if (msg.userId === currentUser.id) {
        messageDiv.classList.add('own');
    }
    
    let avatarHtml;
    if (msg.userAvatar && msg.userAvatar.includes('data:image')) {
        avatarHtml = `<img src="${msg.userAvatar}" alt="">`;
    } else {
        avatarHtml = msg.userName ? msg.userName.charAt(0).toUpperCase() : '?';
    }
    
    let replyHtml = '';
    if (msg.replyTo) {
        replyHtml = `
            <div class="message-reply">
                <div class="message-reply-author">${msg.replyTo.author}</div>
                <div class="message-reply-text">${msg.replyTo.text}</div>
            </div>
        `;
    }
    
    let imageHtml = '';
    if (msg.image) {
        imageHtml = `<img class="message-image" src="${msg.image}" onclick="openImageViewer('${msg.image}')" alt="">`;
    }
    
    const time = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    
    messageDiv.innerHTML = `
        <div class="message-avatar avatar-gradient-${msg.userAvatarGradient || 1}" onclick="openProfile('${msg.userId}')">
            ${avatarHtml}
        </div>
        <div class="message-content">
            <div class="message-author">${msg.userName || 'Unknown'}${msg.isDeveloper ? ' <span class="developer-badge">DEV</span>' : ''}</div>
            <div class="message-bubble" oncontextmenu="showMessageMenu(event, '${msgId}', '${msg.userName}', '${escapeHtml(msg.text)}', ${msg.userId === currentUser.id})">
                ${replyHtml}
                <div class="message-text">${escapeHtml(msg.text)}</div>
                ${imageHtml}
                <div class="message-time">${time}</div>
            </div>
        </div>
    `;
    
    container.appendChild(messageDiv);
}

async function sendMessage() {
    if (!currentChatUser) return;
    
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    
    if (!text && !currentReply) return;

    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn.disabled) return;
    sendBtn.disabled = true;
    
    const chatId = getChatId(currentUser.id, currentChatUser.id);
    const messagesRef = ref(database, `messages/${chatId}`);
    
    const messageData = {
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatarGradient: currentUser.avatar,
        userAvatar: currentUser.avatarImage || null,
        text: text,
        timestamp: Date.now(),
        isDeveloper: currentUser.isDeveloper || false
    };
    
    if (currentReply) {
        messageData.replyTo = currentReply;
        cancelReply();
    }
    
    try {
        await push(messagesRef, messageData);
        
        input.value = '';
        input.style.height = 'auto';
        
        if (window.innerWidth > 768) {
            input.focus();
        }

        const userChatRef = ref(database, `userChats/${currentUser.id}/${currentChatUser.id}`);
        const otherUserChatRef = ref(database, `userChats/${currentChatUser.id}/${currentUser.id}`);

        set(userChatRef, {
            lastMessage: text,
            lastMessageTime: Date.now(),
            lastMessageSender: currentUser.id,
            unread: 0
        }).catch(err => console.error('Error updating user chat:', err));

        get(otherUserChatRef).then(otherSnapshot => {
            const unreadCount = otherSnapshot.exists() ? (otherSnapshot.val().unread || 0) + 1 : 1;
            set(otherUserChatRef, {
                lastMessage: text,
                lastMessageTime: Date.now(),
                lastMessageSender: currentUser.id,
                unread: unreadCount
            }).catch(err => console.error('Error updating other user chat:', err));
        }).catch(err => console.error('Error getting other user chat:', err));
    } catch (error) {
        console.error('Error sending message:', error);
        customAlert('Ошибка отправки сообщения. Попробуйте еще раз.');
    } finally {
        sendBtn.disabled = false;
    }
}

async function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentChatUser) return;
    
    if (file.size > 10 * 1024 * 1024) {
        customAlert('Файл слишком большой. Максимальный размер: 10MB');
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        customAlert('Поддерживаются только изображения');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxSize = 800;
            
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            
            try {
                const chatId = getChatId(currentUser.id, currentChatUser.id);
                const messagesRef = ref(database, `messages/${chatId}`);
                
                await push(messagesRef, {
                    userId: currentUser.id,
                    userName: currentUser.name,
                    userAvatarGradient: currentUser.avatar,
                    userAvatar: currentUser.avatarImage || null,
                    text: '📷 Изображение',
                    image: dataUrl,
                    timestamp: Date.now(),
                    isDeveloper: currentUser.isDeveloper || false
                });
                
                await updateLastMessage('📷 Изображение');
            } catch (error) {
                console.error('Error uploading image:', error);
                customAlert('Ошибка загрузки изображения');
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    event.target.value = '';
}

async function updateLastMessage(text) {
    try {
        const userChatData = {
            lastMessage: text,
            lastMessageTime: Date.now(),
            lastMessageSender: currentUser.id,
            unread: 0
        };
        
        const otherUserChatData = {
            lastMessage: text,
            lastMessageTime: Date.now(),
            lastMessageSender: currentUser.id,
            unread: 1
        };

        const otherUserChatRef = ref(database, `userChats/${currentChatUser.id}/${currentUser.id}`);
        try {
            const snapshot = await get(otherUserChatRef);
            if (snapshot.exists()) {
                const data = snapshot.val();
                otherUserChatData.unread = (data.unread || 0) + 1;
            }
        } catch (e) {}

        const userChatRef = ref(database, `userChats/${currentUser.id}/${currentChatUser.id}`);
        await set(userChatRef, userChatData);
        await set(otherUserChatRef, otherUserChatData);
    } catch (error) {
        console.error('Error updating last message:', error);
    }
}

async function openProfile(userId) {
    const modal = document.getElementById('profileModal');
    const isOwnProfile = userId === currentUser.id;
    
    try {
        let userData;
        
        if (isOwnProfile) {
            userData = currentUser;
        } else {
            const userRef = ref(database, `users/${userId}`);
            const snapshot = await get(userRef);
            userData = snapshot.val();
            if (!userData) return;
            userData.id = userId;
        }
        
        const avatar = document.getElementById('profileAvatar');
        if (userData.avatarImage) {
            avatar.innerHTML = `<img src="${userData.avatarImage}" alt="">`;
            avatar.className = 'profile-avatar-large';
        } else {
            avatar.innerHTML = `<span id="profileAvatarText">${(userData.name || 'U').charAt(0).toUpperCase()}</span>`;
            avatar.className = `profile-avatar-large avatar-gradient-${userData.avatar || 1}`;
        }
        
        document.getElementById('profileName').innerHTML = (userData.name || 'User') + (userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : '');
        
        const usernameDiv = document.getElementById('profileUsername');
        if (userData.username) {
            usernameDiv.textContent = `@${userData.username}`;
            usernameDiv.style.display = 'block';
        } else {
            usernameDiv.style.display = 'none';
        }

        const statusRef = ref(database, `users/${userId}`);
        onValue(statusRef, (snapshot) => {
            const user = snapshot.val();
            if (user) {
                document.getElementById('profileStatus').textContent = user.online ? 'В сети' : 'Не в сети';
                
                const lastSeenDiv = document.getElementById('profileLastSeen');
                if (!user.online && user.lastSeen) {
                    lastSeenDiv.textContent = `Был(а) ${formatLastSeen(user.lastSeen)}`;
                    lastSeenDiv.style.display = 'block';
                } else {
                    lastSeenDiv.style.display = 'none';
                }

                const ipDiv = document.getElementById('profileIp');
                if (isDeveloper && !isOwnProfile && user.ip) {
                    ipDiv.textContent = `IP: ${user.ip}`;
                    ipDiv.style.display = 'block';
                } else {
                    ipDiv.style.display = 'none';
                }
            }
        });
        
        const bioDiv = document.getElementById('profileBio');
        const bioInput = document.getElementById('bioInput');
        
        if (userData.bio) {
            bioDiv.textContent = userData.bio;
            bioDiv.style.display = 'block';
        } else {
            bioDiv.textContent = isOwnProfile ? 'Нажмите "Редактировать", чтобы добавить описание' : 'Описание отсутствует';
            bioDiv.style.display = 'block';
        }
        bioInput.style.display = 'none';
        
        document.getElementById('uploadLabel').style.display = 'none';
        document.getElementById('avatarSelector').style.display = 'none';
        document.getElementById('editProfileBtn').style.display = isOwnProfile ? 'block' : 'none';
        document.getElementById('changeUsernameBtn').style.display = isOwnProfile ? 'block' : 'none';
        document.getElementById('saveProfileBtn').style.display = 'none';
        document.getElementById('messageUserBtn').style.display = !isOwnProfile ? 'block' : 'none';
        document.getElementById('logoutProfileBtn').style.display = isOwnProfile ? 'block' : 'none';
        document.getElementById('deleteAccountBtn').style.display = isOwnProfile ? 'block' : 'none';

        const blockBtn = document.getElementById('blockUserBtn');
        if (!isOwnProfile) {
            blockBtn.style.display = 'block';
            blockBtn.textContent = blockedUsers.has(userId) ? '✅ Разблокировать' : '🚫 Заблокировать';
            blockBtn.className = blockedUsers.has(userId) ? 'btn-profile btn-unblock' : 'btn-profile btn-block';
        } else {
            blockBtn.style.display = 'none';
        }
        
        document.getElementById('kickUserBtn').style.display = (isDeveloper && !isOwnProfile) ? 'block' : 'none';
        
        document.getElementById('usernameChangeContainer').style.display = 'none';
        
        modal.dataset.userId = userId;
        modal.classList.add('show');
        isEditing = false;
        
    } catch (error) {
        console.error('Error opening profile:', error);
    }
}

async function deleteAccount() {
    const confirmed = await customConfirm('Вы уверены, что хотите удалить свой аккаунт? Это действие необратимо!');
    
    if (confirmed) {
        try {
            const userRef = ref(database, `users/${currentUser.id}`);
            await remove(userRef);

            const userChatsRef = ref(database, `userChats/${currentUser.id}`);
            await remove(userChatsRef);
            
            localStorage.removeItem('waveUser');
            location.reload();
        } catch (error) {
            console.error('Error deleting account:', error);
            await customAlert('Ошибка удаления аккаунта');
        }
    }
}

function showUsernameChange() {
    document.getElementById('usernameChangeContainer').style.display = 'block';
    document.getElementById('newUsernameInput').value = currentUser.username;
    document.getElementById('changeUsernameBtn').style.display = 'none';
}

function hideUsernameChange() {
    document.getElementById('usernameChangeContainer').style.display = 'none';
    document.getElementById('changeUsernameBtn').style.display = 'block';
}

async function saveUsername() {
    const newUsername = document.getElementById('newUsernameInput').value.trim();
    const errorDiv = document.getElementById('usernameError');
    
    if (!newUsername) {
        errorDiv.textContent = 'Username не может быть пустым';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (!/^[a-zA-Z0-9]+$/.test(newUsername)) {
        errorDiv.textContent = 'Username может содержать только английские буквы и цифры';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (newUsername.length < 3) {
        errorDiv.textContent = 'Username должен содержать минимум 3 символа';
        errorDiv.style.display = 'block';
        return;
    }
    
    if (newUsername === currentUser.username) {
        hideUsernameChange();
        return;
    }

    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);
    const users = snapshot.val() || {};
    
    const isAvailable = !Object.entries(users).some(([userId, userData]) => 
        userId !== currentUser.id && 
        userData.username && 
        userData.username.toLowerCase() === newUsername.toLowerCase()
    );
    
    if (!isAvailable) {
        errorDiv.textContent = 'Этот username уже занят';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        currentUser.username = newUsername;
        
        const userRef = ref(database, `users/${currentUser.id}`);
        await update(userRef, {
            username: newUsername
        });
        
        localStorage.setItem('waveUser', JSON.stringify(currentUser));
        
        document.getElementById('profileUsername').textContent = `@${newUsername}`;
        
        errorDiv.style.display = 'none';
        hideUsernameChange();
        
    } catch (error) {
        console.error('Error saving username:', error);
        errorDiv.textContent = 'Ошибка сохранения username';
        errorDiv.style.display = 'block';
    }
}

async function toggleBlockUser() {
    const userId = document.getElementById('profileModal').dataset.userId;
    if (!userId) return;
    
    const isBlocked = blockedUsers.has(userId);
    
    if (isBlocked) {
        const blockRef = ref(database, `users/${currentUser.id}/blockedUsers/${userId}`);
        await remove(blockRef);
        blockedUsers.delete(userId);
        customAlert('Пользователь разблокирован');
    } else {
        const blockRef = ref(database, `users/${currentUser.id}/blockedUsers/${userId}`);
        await set(blockRef, true);
        blockedUsers.add(userId);
        customAlert('Пользователь заблокирован');
    }

    const blockBtn = document.getElementById('blockUserBtn');
    blockBtn.textContent = isBlocked ? '🚫 Заблокировать' : '✅ Разблокировать';
    blockBtn.className = isBlocked ? 'btn-profile btn-block' : 'btn-profile btn-unblock';

    loadChats();

    if (!isBlocked && currentChatUser && currentChatUser.id === userId) {
        currentChatUser = null;
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('chatHeader').style.display = 'none';
        document.getElementById('messagesContainer').style.display = 'none';
        document.getElementById('messageInputContainer').style.display = 'none';
    }
}

function editProfile() {
    isEditing = true;
    
    document.getElementById('uploadLabel').style.display = 'block';
    
    const bioDiv = document.getElementById('profileBio');
    const bioInput = document.getElementById('bioInput');
    bioInput.value = currentUser.bio || '';
    bioDiv.style.display = 'none';
    bioInput.style.display = 'block';
    
    document.getElementById('editProfileBtn').style.display = 'none';
    document.getElementById('saveProfileBtn').style.display = 'block';
    document.getElementById('changeUsernameBtn').style.display = 'none';
}

function toggleAvatarSelector() {
    return false;
}

function selectAvatar(avatarNum) {
    return false;
}

function uploadAvatar(event) {
    if (!isEditing) return;
    
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        customAlert('Файл слишком большой. Максимальный размер: 5MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxSize = 200;
            
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            selectedAvatarImage = dataUrl;
            
            const avatar = document.getElementById('profileAvatar');
            avatar.innerHTML = `<img src="${dataUrl}" alt="">`;
            avatar.className = 'profile-avatar-large';
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function saveProfile() {
    try {
        const bioInput = document.getElementById('bioInput');
        currentUser.bio = bioInput.value.trim();
        
        if (selectedAvatarImage !== null) {
            currentUser.avatarImage = selectedAvatarImage;
        }

        const updateData = {
            avatar: currentUser.avatar,
            bio: currentUser.bio
        };

        if (currentUser.avatarImage !== undefined) {
            updateData.avatarImage = currentUser.avatarImage || null;
        }
        
        const userRef = ref(database, `users/${currentUser.id}`);
        await update(userRef, updateData);
        
        localStorage.setItem('waveUser', JSON.stringify(currentUser));
        updateUserUI();
        
        document.getElementById('profileBio').textContent = currentUser.bio || 'Нажмите "Редактировать", чтобы добавить описание';
        document.getElementById('profileBio').style.display = 'block';
        bioInput.style.display = 'none';
        
        document.getElementById('uploadLabel').style.display = 'none';
        document.getElementById('editProfileBtn').style.display = 'block';
        document.getElementById('changeUsernameBtn').style.display = 'block';
        document.getElementById('saveProfileBtn').style.display = 'none';
        
        isEditing = false;
        selectedAvatar = null;
        selectedAvatarImage = null;
        
    } catch (error) {
        console.error('Error saving profile:', error);
        customAlert('Ошибка сохранения профиля. Попробуйте еще раз.');
    }
}

function closeProfile() {
    document.getElementById('profileModal').classList.remove('show');
    isEditing = false;
    selectedAvatar = null;
    selectedAvatarImage = null;
}

function startChatFromProfile() {
    const userId = document.getElementById('profileModal').dataset.userId;
    if (!userId) return;
    
    closeProfile();
    
    get(ref(database, `users/${userId}`)).then(snapshot => {
        const userData = snapshot.val();
        if (userData) {
            openChat(userId, userData);
        }
    });
}

async function kickUser() {
    const userId = document.getElementById('profileModal').dataset.userId;
    if (!userId || !isDeveloper) return;
    
    const confirmed = await customConfirm('Вы уверены, что хотите кикнуть этого пользователя?');
    
    if (confirmed) {
        try {
            const userRef = ref(database, `users/${userId}`);
            await remove(userRef);
            
            closeProfile();
            
            if (currentChatUser && currentChatUser.id === userId) {
                currentChatUser = null;
                document.getElementById('welcomeScreen').classList.remove('view-hidden');
                document.getElementById('chatHeader').classList.remove('view-visible');
                document.getElementById('messagesContainer').classList.remove('view-visible');
                document.getElementById('messageInputContainer').classList.remove('view-visible');
            }
            
        } catch (error) {
            console.error('Error kicking user:', error);
        }
    }
}

window.showMessageMenu = function(event, msgId, author, text, isOwn) {
    event.preventDefault();
    const menu = document.getElementById('messageMenu');
    
    selectedMessage = {
        id: msgId,
        author: author,
        text: text
    };
    
    document.getElementById('deleteMessageBtn').style.display = (isOwn || isDeveloper) ? 'flex' : 'none';
    
    const menuHeight = 150;
    const menuWidth = 150;
    
    let top = event.pageY;
    let left = event.pageX;
    
    if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
    }
    
    if (top + menuHeight > window.innerHeight) {
        top = window.innerHeight - menuHeight - 10;
    }
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.classList.add('show');
    
    event.stopPropagation();
}

function hideMessageMenu() {
    document.getElementById('messageMenu').classList.remove('show');
}

function toggleChatOptionsMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('chatOptionsMenu');
    
    if (menu.classList.contains('show')) {
        hideChatOptionsMenu();
    } else {
        const button = e.currentTarget;
        const rect = button.getBoundingClientRect();
        
        menu.style.top = (rect.bottom + 5) + 'px';
        menu.style.right = '10px';
        menu.classList.add('show');
    }
}

function hideChatOptionsMenu() {
    document.getElementById('chatOptionsMenu').classList.remove('show');
}

function copyMessage() {
    if (selectedMessage) {
        navigator.clipboard.writeText(selectedMessage.text).then(() => {
            console.log('Текст скопирован');
        }).catch(err => {
            console.error('Ошибка копирования:', err);
        });
    }
    hideMessageMenu();
}

function replyToMessage() {
    if (selectedMessage) {
        currentReply = {
            author: selectedMessage.author,
            text: selectedMessage.text
        };
        
        document.getElementById('replyToName').textContent = selectedMessage.author;
        document.getElementById('replyText').textContent = selectedMessage.text;
        document.getElementById('replyContainer').classList.add('show');
        document.getElementById('messageInput').focus();
    }
    hideMessageMenu();
}

async function deleteMessage() {
    if (selectedMessage && currentChatUser) {
        const chatId = getChatId(currentUser.id, currentChatUser.id);
        const messageRef = ref(database, `messages/${chatId}/${selectedMessage.id}`);
        await remove(messageRef);
    }
    hideMessageMenu();
}

function cancelReply() {
    currentReply = null;
    document.getElementById('replyContainer').classList.remove('show');
}

window.openImageViewer = function(imageSrc) {
    document.getElementById('viewerImage').src = imageSrc;
    document.getElementById('imageViewer').classList.add('show');
}

function closeImageViewer() {
    document.getElementById('imageViewer').classList.remove('show');
}

function toggleSidebar() {
    if (window.innerWidth <= 768) {
        backToChats();
    } else {
        document.getElementById('sidebar').classList.toggle('open');
    }
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
}

async function clearCurrentChat() {
    if (!currentChatUser) return;
    
    const confirmed = await customConfirm('Удалить все сообщения в этом чате?');
    
    if (confirmed) {
        try {
            const chatId = getChatId(currentUser.id, currentChatUser.id);
            const messagesRef = ref(database, `messages/${chatId}`);
            await remove(messagesRef);
            
            const userChatRef = ref(database, `userChats/${currentUser.id}/${currentChatUser.id}`);
            const otherUserChatRef = ref(database, `userChats/${currentChatUser.id}/${currentUser.id}`);
            
            await update(userChatRef, {
                lastMessage: '',
                lastMessageTime: Date.now(),
                lastMessageSender: '',
                unread: 0
            });
            
            await update(otherUserChatRef, {
                lastMessage: '',
                lastMessageTime: Date.now(),
                lastMessageSender: '',
                unread: 0
            });
            
            existingMessages.clear();
            document.getElementById('messagesContainer').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">Чат очищен</div>';
            
            await customAlert('Чат успешно очищен!');
        } catch (error) {
            console.error('Ошибка очистки чата:', error);
            await customAlert('Ошибка при очистке чата');
        }
    }
}

async function logout() {
    const confirmed = await customConfirm('Вы уверены, что хотите выйти?');
    
    if (confirmed) {
        try {
            if (currentUser) {
                const userRef = ref(database, `users/${currentUser.id}`);
                await update(userRef, {
                    online: false,
                    lastSeen: serverTimestamp()
                });
            }
            
            localStorage.removeItem('waveUser');
            location.reload();
        } catch (error) {
            console.error('Error logging out:', error);
            localStorage.removeItem('waveUser');
            location.reload();
        }
    }
}

function getChatId(userId1, userId2) {
    return userId1 < userId2 ? `${userId1}_${userId2}` : `${userId2}_${userId1}`;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 86400000) {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else if (diff < 172800000) {
        return 'Вчера';
    } else {
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
}

function formatLastSeen(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    
    if (diff < 60) return 'только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин. назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч. назад`;
    if (diff < 172800) return 'вчера';
    
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}
