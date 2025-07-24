// client/js/app.js

import { getRandomColor } from './utils.js';

// --- 1. Referências aos Elementos DOM ---
const authContainer = document.getElementById('auth-container');
const gameContainer = document.getElementById('game-container');
const authTitle = document.getElementById('auth-title');
const usernameInput = document.getElementById('usernameInput');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const authButton = document.getElementById('authButton');
const authError = document.getElementById('auth-error');
const switchAuthLink = document.getElementById('switch-auth');

const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

const playerCube = document.getElementById('player-cube');
const inventoryMenu = document.getElementById('inventory-menu');
const closeInventoryButton = document.getElementById('closeInventoryButton');
const inventoryGrid = document.getElementById('inventory-grid');
const hotbar = document.getElementById('hotbar');

const gameMap = document.getElementById('game-map'); // Novo: Elemento do mapa
const equippedItemDisplay = document.getElementById('equipped-item-display'); // Novo
const equippedItemImage = document.getElementById('equipped-item-image');     // Novo
const equippedItemName = document.getElementById('equipped-item-name');       // Novo

// --- 2. Variáveis de Estado Global (Cliente) ---
let currentAuthModeIsLogin = false; // false = Registrar, true = Login
let loggedInPlayerId = null;
let clientItemDefinitions = {}; // Definições de itens recebidas do servidor
let clientWeaponStats = {};    // Estatísticas de armas carregadas localmente
let playerInventory = [];      // Inventário do jogador (simplificado por enquanto)
let equippedItemId = null;     // ID do item que o jogador está segurando

// --- Variáveis do Mapa ---
const MAP_WIDTH = 10; // Células
const MAP_HEIGHT = 10; // Células
const TILE_SIZE = 32; // Pixels
let playerMapX = 0;
let playerMapY = 0;

// --- 3. Inicialização do Socket.io ---
const socket = io("http://localhost:3000");

// --- 4. Funções de UI ---
function appendMessage(msg) {
    console.log("appendMessage:", msg);
    const p = document.createElement('p');
    p.textContent = msg;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showGameUI() {
    console.log("Showing Game UI.");
    authContainer.style.display = 'none';
    gameContainer.style.display = 'flex'; // Use flex para o game-container
}

function showAuthUI() {
    console.log("Showing Auth UI.");
    authContainer.style.display = 'block';
    gameContainer.style.display = 'none';
    updateAuthFormUI();
}

function toggleInventoryMenu() {
    console.log("Toggling Inventory Menu.");
    if (inventoryMenu.style.display === 'none' || inventoryMenu.style.display === '') {
        inventoryMenu.style.display = 'block';
        updateInventoryDisplay(); // Atualiza o display ao abrir
    } else {
        inventoryMenu.style.display = 'none';
    }
}

function setAuthMode(isLogin) {
    console.log("Setting Auth Mode to:", isLogin ? "Login" : "Register");
    currentAuthModeIsLogin = isLogin;
    updateAuthFormUI();
}

function updateAuthFormUI() {
    authTitle.textContent = currentAuthModeIsLogin ? 'Login' : 'Registrar';
    authButton.textContent = currentAuthModeIsLogin ? 'Entrar' : 'Registrar';
    usernameInput.style.display = currentAuthModeIsLogin ? 'none' : 'block';
    switchAuthLink.textContent = currentAuthModeIsLogin ? 'Não tem conta? Fazer Registro' : 'Já tem conta? Fazer Login';
    authError.textContent = '';
    emailInput.value = '';
    passwordInput.value = '';
    usernameInput.value = '';
}

// NOVO: Funções para atualizar o inventário e hotbar
function updateInventoryDisplay() {
    // Limpa todos os slots primeiro
    [...inventoryGrid.children, ...hotbar.children].forEach(slot => {
        slot.innerHTML = '';
        slot.classList.remove('has-item');
    });

    // Preenche a hotbar (primeiros 5 slots do inventário)
    for (let i = 0; i < 5; i++) {
        const slotDiv = hotbar.children[i];
        const itemInSlot = playerInventory[i];
        if (itemInSlot && clientItemDefinitions[itemInSlot.item_id]) {
            const itemDef = clientItemDefinitions[itemInSlot.item_id];
            slotDiv.classList.add('has-item');
            slotDiv.innerHTML = `<img src="${itemDef.icon_url}" alt="${itemDef.name}">`;
            if (itemDef.max_stack > 1 || itemInSlot.quantity > 1) { // Só mostra quantidade se for empilhável ou > 1
                slotDiv.innerHTML += `<span class="item-quantity">${itemInSlot.quantity}</span>`;
            }
        }
    }

    // Preenche o grid do inventário
    for (let i = 0; i < playerInventory.length; i++) {
        const slotDiv = inventoryGrid.children[i]; // Pegar o slot correspondente no inventário
        if (slotDiv) { // Certifica-se de que o slot existe
            const itemInSlot = playerInventory[i];
            if (itemInSlot && clientItemDefinitions[itemInSlot.item_id]) {
                const itemDef = clientItemDefinitions[itemInSlot.item_id];
                slotDiv.classList.add('has-item');
                slotDiv.innerHTML = `<img src="${itemDef.icon_url}" alt="${itemDef.name}">`;
                if (itemDef.max_stack > 1 || itemInSlot.quantity > 1) {
                    slotDiv.innerHTML += `<span class="item-quantity">${itemInSlot.quantity}</span>`;
                }
            }
        }
    }
}

// NOVO: Função para atualizar o item equipado
function updateEquippedItemDisplay() {
    if (equippedItemId && clientItemDefinitions[equippedItemId]) {
        const itemDef = clientItemDefinitions[equippedItemId];
        equippedItemImage.src = itemDef.icon_url;
        equippedItemImage.style.display = 'block';
        equippedItemName.textContent = itemDef.name;
    } else {
        equippedItemImage.src = '';
        equippedItemImage.style.display = 'none';
        equippedItemName.textContent = '';
    }
}

// NOVO: Funções do Mapa
function createMap() {
    gameMap.style.gridTemplateColumns = `repeat(${MAP_WIDTH}, ${TILE_SIZE}px)`;
    gameMap.style.width = `${MAP_WIDTH * TILE_SIZE}px`;
    gameMap.style.height = `${MAP_HEIGHT * TILE_SIZE}px`;

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const cell = document.createElement('div');
            cell.classList.add('map-cell');
            // Exemplo: usar uma imagem de grama de seus assets
            cell.style.backgroundImage = `url('/assets/tiles/grass.png')`;
            gameMap.appendChild(cell);
        }
    }
    updatePlayerPositionOnMap();
}

function updatePlayerPositionOnMap() {
    // Posiciona o player-cube dentro do game-map
    playerCube.style.left = `${playerMapX * TILE_SIZE + (TILE_SIZE - playerCube.offsetWidth) / 2}px`;
    playerCube.style.top = `${playerMapY * TILE_SIZE + (TILE_SIZE - playerCube.offsetHeight) / 2}px`;
}

// --- 5. Funções de Carregamento de Dados (Local) ---
async function loadWeaponStats() {
    console.log("Loading weapon stats...");
    try {
        const response = await fetch('/data/weapon_stats.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        clientWeaponStats = await response.json();
        console.log('Definições de estatísticas de armas carregadas:', clientWeaponStats);
    } catch (error) {
        console.error('Erro ao carregar weapon_stats.json:', error);
    }
}

// --- 6. Comunicação com o Servidor (Socket.io e Fetch) ---
// Socket.io Event Listeners
socket.on('connect', () => {
    appendMessage('Conectado ao servidor Socket.io.');
    console.log('Conectado ao servidor Socket.io!');
});

socket.on('globalItemDefinitions', (definitions) => {
    clientItemDefinitions = definitions;
    console.log('Definições de itens recebidas do servidor:', clientItemDefinitions);
    appendMessage('Definições de itens carregadas!');
});

socket.on('mensagemDoServidor', (data) => {
    appendMessage('Servidor: ' + data);
});

// NOVO: Receber atualização de inventário do servidor
socket.on('playerInventoryUpdate', (inventoryData) => {
    console.log('Inventário do jogador atualizado recebido:', inventoryData);
    playerInventory = inventoryData;
    updateInventoryDisplay(); // Atualiza a UI do inventário
    // TODO: Adicionar lógica para equipar item padrão ou o último equipado
    if (playerInventory.length > 0 && !equippedItemId) {
        // Equipa o primeiro item como padrão se nada estiver equipado
        equippedItemId = playerInventory[0].item_id;
        updateEquippedItemDisplay();
    }
});

socket.on('disconnect', () => {
    appendMessage('Você foi desconectado do servidor.');
    console.log('Desconectado do servidor Socket.io.');
    showAuthUI();
    loggedInPlayerId = null;
    playerInventory = []; // Limpa o inventário
    equippedItemId = null; // Limpa o item equipado
    updateEquippedItemDisplay();
    updateInventoryDisplay();
});

socket.on('connect_error', (err) => {
    console.error('Erro de conexão do Socket.io:', err.message);
    appendMessage('Erro de conexão ao servidor.');
});

// Lógica de Autenticação (Fetch HTTP)
authButton.addEventListener('click', async () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    const username = usernameInput.value;
    authError.textContent = '';

    const currentMode = currentAuthModeIsLogin;

    let url = '';
    let body = {};

    if (currentMode) { // Modo Login
        url = '/auth/login';
        body = { email, password };
    } else { // Modo Registrar
        if (!username.trim()) {
            authError.textContent = 'Nome de usuário é obrigatório para registro.';
            return;
        }
        url = '/auth/signup';
        body = { email, password, username };
    }

    console.log(`Attempting ${currentMode ? 'login' : 'signup'} to ${url} with body:`, body);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        console.log("Auth response data:", data);

        if (response.ok) {
            appendMessage(data.message);
            if (currentMode) { // Se o login foi bem-sucedido
                loggedInPlayerId = data.user.id;
                socket.emit('playerLoggedIn', loggedInPlayerId); // Envia ID para o servidor
                playerCube.style.backgroundColor = getRandomColor();
                showGameUI(); // Mostra a interface do jogo
                // NOVO: Ao logar, solicite o inventário do jogador
                socket.emit('requestPlayerInventory', loggedInPlayerId);
            } else { // Se o registro foi bem-sucedido
                appendMessage('Registro concluído. Agora, faça login com sua nova conta.');
                setAuthMode(true);
            }
        } else {
            authError.textContent = data.error || 'Erro desconhecido durante autenticação.';
        }
    } catch (error) {
        console.error('Erro de rede ou servidor durante autenticação:', error);
        authError.textContent = 'Erro de conexão com o servidor.';
    }
});

// Lógica de Chat e Comandos (Socket.io)
sendButton.addEventListener('click', () => {
    const message = messageInput.value;
    if (message.trim() !== '') {
        if (message.startsWith('/') && !loggedInPlayerId) {
            appendMessage('Você precisa estar logado para usar comandos.');
            messageInput.value = '';
            return;
        }

        if (message.startsWith('/')) {
            socket.emit('chatCommand', message);
        } else {
            socket.emit('mensagemDoCliente', message);
        }
        appendMessage('Você: ' + message);
        messageInput.value = '';
    }
});

// --- 7. Inicialização da Aplicação (DOMContentLoaded) ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing app...");
    showAuthUI();
    loadWeaponStats();
    createMap(); // Cria o mapa inicial

    // Configurar Event Listeners do DOM
    switchAuthLink.addEventListener('click', (event) => {
        event.preventDefault();
        setAuthMode(!currentAuthModeIsLogin);
    });

    closeInventoryButton.addEventListener('click', () => {
        toggleInventoryMenu();
    });

    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendButton.click();
        }
    });
});

// --- 8. Atalhos de Teclado e Movimento ---
document.addEventListener('keydown', (event) => {
    // Atalho para focar/desfocar o chat com ';'
    if (event.key === ';') {
        event.preventDefault();
        if (messageInput) {
            if (document.activeElement === messageInput) {
                messageInput.blur();
            } else {
                messageInput.focus();
            }
        }
    }

    // Atalho para abrir/fechar inventário com 'Esc'
    if (event.key === 'Escape') {
        toggleInventoryMenu();
        if (document.activeElement === messageInput) {
            messageInput.blur();
        }
    }

    // Movimento do Jogador (WASD ou Setas)
    let newPlayerX = playerMapX;
    let newPlayerY = playerMapY;

    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
        newPlayerY--;
    } else if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
        newPlayerY++;
    } else if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        newPlayerX--;
    } else if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        newPlayerX++;
    }

    // Limita o movimento dentro dos limites do mapa
    newPlayerX = Math.max(0, Math.min(MAP_WIDTH - 1, newPlayerX));
    newPlayerY = Math.max(0, Math.min(MAP_HEIGHT - 1, newPlayerY));

    if (newPlayerX !== playerMapX || newPlayerY !== playerMapY) {
        playerMapX = newPlayerX;
        playerMapY = newPlayerY;
        updatePlayerPositionOnMap();
        // TODO: Enviar nova posição para o servidor
        socket.emit('playerMovement', { x: playerMapX, y: playerMapY, playerId: loggedInPlayerId });
    }
});
