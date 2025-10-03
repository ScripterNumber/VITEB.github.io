import { database } from './firebase-config.js';
import { 
    ref, 
    push, 
    onValue, 
    serverTimestamp,
    onDisconnect,
    set,
    remove,
    get,
    update
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

document.addEventListener('DOMContentLoaded', () => {
    checkExistingUser();
    setupEventListeners();
});

function checkExistingUser() {
    const savedUser = localStorage.getItem('waveUser');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        isDeveloper = currentUser.isDeveloper || false;
        document.getElementById('loginModal').classList.add('hidden');
        updateUserUI();
        initApp();
    }
}

function setupEventListeners() {
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('loginInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') login();
    });

    document.getElementById('currentUserInfo').addEventListener('click', () => openProfile(currentUser.id));
    document.getElementById('profileAvatar').addEventListener('click', toggleAvatarSelector);
    document.getElementById('avatarUpload').addEventListener('change', uploadAvatar);
    document.getElementById('editProfileBtn').addEventListener('click', editProfile);
    document.getElementById('saveProfileBtn').addEventListener('click', saveProfile);
    document.getElementById('closeProfileBtn').addEventListener('click', closeProfile);
    document.getElementById('closeProfileModalBtn').addEventListener('click', closeProfile);
    document.getElementById('messageUserBtn').addEventListener('click', startChatFromProfile);
    document.getElementById('kickUserBtn').addEventListener('click', kickUser);

    document.querySelectorAll('.avatar-option').forEach(option => {
        option.addEventListener('click', () => {
            if (isEditing) selectAvatar(parseInt(option.dataset.gradient));
        });
    });

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
    document.getElementById('backToChatBtn').addEventListener('click', closeSidebar);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('clearChatBtn').addEventListener('click', clearCurrentChat);
    document.getElementById('chatUserInfo').addEventListener('click', () => {
        if (currentChatUser) openProfile(currentChatUser.id);
    });

    document.getElementById('searchInput').addEventListener('input', searchUsers);

    document.getElementById('imageViewer').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeImageViewer();
    });
    document.getElementById('closeImageViewerBtn').addEventListener('click', closeImageViewer);

    document.addEventListener('click', hideMessageMenu);
}

async function login() {
    const input = document.getElementById('loginInput');
    const name = input.value.trim();
    const errorDiv = document.getElementById('loginError');
    
    if (!name) {
        errorDiv.textContent = 'Пожалуйста, введите ваше имя';
        errorDiv.style.display = 'block';
        return;
    }

    if (name.length < 2) {
        errorDiv.textContent = 'Имя должно содержать минимум 2 символа';
        errorDiv.style.display = 'block';
        return;
    }

    try {
        const usersRef = ref(database, 'users');
        const snapshot = await get(usersRef);
        const users = snapshot.val() || {};
        
        const nameExists = Object.values(users).some(user => 
            user.name && user.name.toLowerCase() === name.toLowerCase() && user.online
        );

        if (nameExists) {
            errorDiv.textContent = 'Это имя уже занято!';
            errorDiv.style.display = 'block';
            return;
        }

        errorDiv.style.display = 'none';
        isDeveloper = name === 'Developer';

        const userId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        currentUser = {
            id: userId,
            name: name,
            avatar: 1,
            avatarImage: null,
            bio: '',
            joinedAt: Date.now(),
            isDeveloper: isDeveloper
        };

        localStorage.setItem('waveUser', JSON.stringify(currentUser));

        const userRef = ref(database, `users/${userId}`);
        await set(userRef, {
            name: name,
            avatar: 1,
            avatarImage: null,
            bio: '',
            online: true,
            isDeveloper: isDeveloper,
            lastSeen: serverTimestamp()
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
        errorDiv.textContent = 'Ошибка входа. Попробуйте еще раз.';
        errorDiv.style.display = 'block';
    }
}

function updateUserUI() {
    if (!currentUser) return;
    
    document.getElementById('currentUserName').textContent = currentUser.name;
    const avatar = document.getElementById('currentUserAvatar');
    
    if (currentUser.avatarImage) {
        avatar.innerHTML = `<img src="${currentUser.avatarImage}" alt="">`;
        avatar.className = 'user-avatar';
    } else {
        const avatarText = document.getElementById('currentUserAvatarText');
        avatarText.textContent = currentUser.name.charAt(0).toUpperCase();
        avatar.className = `user-avatar avatar-gradient-${currentUser.avatar || 1}`;
    }
}

function initApp() {
    loadChats();
    setupOnlineStatus();
}

async function setupOnlineStatus() {
    const userRef = ref(database, `users/${currentUser.id}`);
    
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
    const chatsRef = ref(database, `userChats/${currentUser.id}`);
    
    onValue(chatsRef, async (snapshot) => {
        const chats = snapshot.val() || {};
        const container = document.getElementById('chatsContainer');
        container.innerHTML = '';
        
        const chatArray = [];
        
        for (const [userId, chatData] of Object.entries(chats)) {
            const userRef = ref(database, `users/${userId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val();
            
            if (userData) {
                chatArray.push({
                    userId,
                    userData,
                    lastMessage: chatData.lastMessage || '',
                    lastMessageTime: chatData.lastMessageTime || 0,
                    unread: chatData.unread || 0
                });
            }
        }
        
        chatArray.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
        
        chatArray.forEach(chat => {
            const chatItem = createChatItem(chat);
            container.appendChild(chatItem);
        });
    });
}

function createChatItem(chat) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    if (currentChatUser && currentChatUser.id === chat.userId) {
        div.classList.add('active');
    }
    
    let avatarHtml;
    if (chat.userData.avatarImage) {
        avatarHtml = `<img src="${chat.userData.avatarImage}" alt="">`;
    } else {
        avatarHtml = chat.userData.name.charAt(0).toUpperCase();
    }
    
    const time = chat.lastMessageTime ? formatTime(chat.lastMessageTime) : '';
    const unreadHtml = chat.unread > 0 ? `<div class="chat-item-unread">${chat.unread}</div>` : '';
    
    div.innerHTML = `
        <div class="chat-item-avatar avatar-gradient-${chat.userData.avatar || 1}">
            ${avatarHtml}
        </div>
        <div class="chat-item-info">
            <div class="chat-item-name">${chat.userData.name}${chat.userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : ''}</div>
            <div class="chat-item-last-message">${chat.lastMessage}</div>
        </div>
        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
            <div class="chat-item-time">${time}</div>
            ${unreadHtml}
        </div>
    `;
    
    div.addEventListener('click', () => openChat(chat.userId, chat.userData));
    
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
        if (userId !== currentUser.id && userData.name.toLowerCase().includes(searchTerm)) {
            const resultItem = document.createElement('div');
            resultItem.className = 'search-result-item';
            
            let avatarHtml;
            if (userData.avatarImage) {
                avatarHtml = `<img src="${userData.avatarImage}" alt="">`;
            } else {
                avatarHtml = userData.name.charAt(0).toUpperCase();
            }
            
            resultItem.innerHTML = `
                <div class="chat-item-avatar avatar-gradient-${userData.avatar || 1}" style="width: 35px; height: 35px; font-size: 14px;">
                    ${avatarHtml}
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${userData.name}${userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : ''}</div>
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
    });
}

async function openChat(userId, userData) {
    currentChatUser = { id: userId, ...userData };
    
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('chatHeader').style.display = 'flex';
    document.getElementById('messagesContainer').style.display = 'flex';
    document.getElementById('messageInputContainer').style.display = 'block';
    
    const chatAvatar = document.getElementById('chatUserAvatar');
    if (userData.avatarImage) {
        chatAvatar.innerHTML = `<img src="${userData.avatarImage}" alt="">`;
        chatAvatar.className = 'chat-user-avatar';
    } else {
        chatAvatar.innerHTML = userData.name.charAt(0).toUpperCase();
        chatAvatar.className = `chat-user-avatar avatar-gradient-${userData.avatar || 1}`;
    }
    
    document.getElementById('chatUserName').innerHTML = userData.name + (userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : '');
    
    const lastSeen = userData.online ? 'В сети' : (userData.lastSeen ? `Был(а) ${formatLastSeen(userData.lastSeen)}` : 'Не в сети');
    document.getElementById('chatUserStatus').textContent = lastSeen;
    
    await markAsRead(userId);
    
    loadMessages(userId);
    
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    
    if (window.innerWidth <= 768) {
        closeSidebar();
    }
}

async function markAsRead(userId) {
    const chatRef = ref(database, `userChats/${currentUser.id}/${userId}`);
    await update(chatRef, { unread: 0 });
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
        container.innerHTML = '';
        
        const sortedMessages = Object.entries(messages).sort((a, b) => {
            return (a[1].timestamp || 0) - (b[1].timestamp || 0);
        });
        
        sortedMessages.forEach(([msgId, msg]) => {
            displayMessage(msg, msgId);
        });
        
        scrollToBottom();
    });
}

function displayMessage(msg, msgId) {
    const container = document.getElementById('messagesContainer');
    
    if (msg.type === 'system') {
        const systemMsg = document.createElement('div');
        systemMsg.className = 'system-message';
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
    
    try {
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
        
        await push(messagesRef, messageData);
        
        const userChatRef = ref(database, `userChats/${currentUser.id}/${currentChatUser.id}`);
        await update(userChatRef, {
            lastMessage: text,
            lastMessageTime: Date.now()
        });
        
        const otherUserChatRef = ref(database, `userChats/${currentChatUser.id}/${currentUser.id}`);
        const otherChatSnapshot = await get(otherUserChatRef);
        const otherChatData = otherChatSnapshot.val() || {};
        
        await update(otherUserChatRef, {
            lastMessage: text,
            lastMessageTime: Date.now(),
            unread: (otherChatData.unread || 0) + 1
        });
        
        input.value = '';
        input.style.height = 'auto';
    } catch (error) {
        console.error('Error sending message:', error);
    }
}

async function handleMediaUpload(event) {
    const file = event.target.files[0];
    if (!file || !currentChatUser) return;
    
    if (file.size > 10 * 1024 * 1024) {
        alert('Файл слишком большой. Максимальный размер: 10MB');
        return;
    }
    
    if (!file.type.startsWith('image/')) {
        alert('Поддерживаются только изображения');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxSize = 1200;
            
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
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    
    event.target.value = '';
}

async function updateLastMessage(text) {
    const userChatRef = ref(database, `userChats/${currentUser.id}/${currentChatUser.id}`);
    await update(userChatRef, {
        lastMessage: text,
        lastMessageTime: Date.now()
    });
    
    const otherUserChatRef = ref(database, `userChats/${currentChatUser.id}/${currentUser.id}`);
    const otherChatSnapshot = await get(otherUserChatRef);
    const otherChatData = otherChatSnapshot.val() || {};
    
    await update(otherUserChatRef, {
        lastMessage: text,
        lastMessageTime: Date.now(),
        unread: (otherChatData.unread || 0) + 1
    });
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
            avatar.innerHTML = `<span id="profileAvatarText">${userData.name.charAt(0).toUpperCase()}</span>`;
            avatar.className = `profile-avatar-large avatar-gradient-${userData.avatar || 1}`;
        }
        
        document.getElementById('profileName').innerHTML = userData.name + (userData.isDeveloper ? ' <span class="developer-badge">DEV</span>' : '');
        document.getElementById('profileStatus').textContent = userData.online ? 'В сети' : 'Не в сети';
        
        const lastSeenDiv = document.getElementById('profileLastSeen');
        if (!userData.online && userData.lastSeen) {
            lastSeenDiv.textContent = `Был(а) ${formatLastSeen(userData.lastSeen)}`;
            lastSeenDiv.style.display = 'block';
        } else {
            lastSeenDiv.style.display = 'none';
        }
        
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
        document.getElementById('avatarSelector').classList.remove('show');
        document.getElementById('editProfileBtn').style.display = isOwnProfile ? 'block' : 'none';
        document.getElementById('saveProfileBtn').style.display = 'none';
        document.getElementById('messageUserBtn').style.display = !isOwnProfile ? 'block' : 'none';
        document.getElementById('kickUserBtn').style.display = (isDeveloper && !isOwnProfile) ? 'block' : 'none';
        
        modal.dataset.userId = userId;
        modal.classList.add('show');
        isEditing = false;
        
    } catch (error) {
        console.error('Error opening profile:', error);
    }
}

function editProfile() {
    isEditing = true;
    
    document.getElementById('uploadLabel').style.display = 'block';
    document.getElementById('avatarSelector').classList.add('show');
    
    const bioDiv = document.getElementById('profileBio');
    const bioInput = document.getElementById('bioInput');
    bioInput.value = currentUser.bio || '';
    bioDiv.style.display = 'none';
    bioInput.style.display = 'block';
    
    document.getElementById('editProfileBtn').style.display = 'none';
    document.getElementById('saveProfileBtn').style.display = 'block';
}

function toggleAvatarSelector() {
    if (isEditing) {
        const selector = document.getElementById('avatarSelector');
        selector.classList.toggle('show');
    }
}

function selectAvatar(avatarNum) {
    if (!isEditing) return;
    
    selectedAvatar = avatarNum;
    selectedAvatarImage = null;
    const avatar = document.getElementById('profileAvatar');
    const text = document.getElementById('profileName').textContent;
    avatar.innerHTML = `<span id="profileAvatarText">${text.charAt(0).toUpperCase()}</span>`;
    avatar.className = `profile-avatar-large avatar-gradient-${avatarNum}`;
}

function uploadAvatar(event) {
    if (!isEditing) return;
    
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('Файл слишком большой. Максимальный размер: 5MB');
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
        
        if (selectedAvatar) {
            currentUser.avatar = selectedAvatar;
        }
        if (selectedAvatarImage) {
            currentUser.avatarImage = selectedAvatarImage;
        }
        
        const userRef = ref(database, `users/${currentUser.id}`);
        await update(userRef, {
            avatar: currentUser.avatar,
            avatarImage: currentUser.avatarImage,
            bio: currentUser.bio
        });
        
        localStorage.setItem('waveUser', JSON.stringify(currentUser));
        updateUserUI();
        
        document.getElementById('profileBio').textContent = currentUser.bio || 'Нажмите "Редактировать", чтобы добавить описание';
        document.getElementById('profileBio').style.display = 'block';
        bioInput.style.display = 'none';
        
        document.getElementById('uploadLabel').style.display = 'none';
        document.getElementById('avatarSelector').classList.remove('show');
        document.getElementById('editProfileBtn').style.display = 'block';
        document.getElementById('saveProfileBtn').style.display = 'none';
        
        isEditing = false;
        selectedAvatar = null;
        selectedAvatarImage = null;
        
    } catch (error) {
        console.error('Error saving profile:', error);
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
    
    if (confirm('Вы уверены, что хотите кикнуть этого пользователя?')) {
        try {
            const userRef = ref(database, `users/${userId}`);
            await remove(userRef);
            
            closeProfile();
            
            if (currentChatUser && currentChatUser.id === userId) {
                currentChatUser = null;
                document.getElementById('welcomeScreen').style.display = 'flex';
                document.getElementById('chatHeader').style.display = 'none';
                document.getElementById('messagesContainer').style.display = 'none';
                document.getElementById('messageInputContainer').style.display = 'none';
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
    
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    menu.classList.add('show');
    
    event.stopPropagation();
}

function hideMessageMenu() {
    document.getElementById('messageMenu').classList.remove('show');
}

function copyMessage() {
    if (selectedMessage) {
        navigator.clipboard.writeText(selectedMessage.text);
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
    document.getElementById('sidebar').classList.toggle('open');
}

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
}

async function clearCurrentChat() {
    if (!currentChatUser) return;
    
    if (confirm('Удалить все сообщения в этом чате?')) {
        const chatId = getChatId(currentUser.id, currentChatUser.id);
        const messagesRef = ref(database, `messages/${chatId}`);
        await remove(messagesRef);
    }
}

async function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
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
