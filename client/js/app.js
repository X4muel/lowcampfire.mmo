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
const playerHealthBar = document.getElementById('player-health-bar');
const inventoryMenu = document.getElementById('inventory-menu');
const closeInventoryButton = document.getElementById('closeInventoryButton');
const inventoryGrid = document.getElementById('inventory-grid');
const hotbar = document.getElementById('hotbar');

const gameMap = document.getElementById('game-map');
const equippedItemDisplay = document.getElementById('equipped-item-display');
const equippedItemImage = document.getElementById('equipped-item-image');
const equippedItemName = document.getElementById('equipped-item-name');

// --- 2. Conexão Socket.io ---
const socket = io();

// --- 3. Variáveis de Estado do Cliente ---
let isLoginMode = false;
let localPlayer = {};
let connectedPlayers = {}; // Mapeia playerId para o elemento DOM do jogador
const MAP_WIDTH = 100; // Exemplo de largura do mapa (em "unidades" de jogo)
const MAP_HEIGHT = 100; // Exemplo de altura do mapa (em "unidades" de jogo)
const TILE_SIZE = 30; // Tamanho de cada "unidade" no mapa em pixels (playerCube width/height)

let inventory = []; // Array de itens no inventário
let hotbarItems = Array(5).fill(null); // 5 slots na hotbar
let equippedItem = null; // Item atualmente equipado
let selectedHotbarSlot = 0; // Slot da hotbar selecionado (0-indexed)

const movementKeys = {
    'w': false,
    'a': false,
    's': false,
    'd': false,
    'ArrowUp': false,
    'ArrowDown': false,
    'ArrowLeft': false,
    'ArrowRight': false
};

// --- 4. Funções de UI/UX ---

function showAuth() {
    authContainer.style.display = 'flex';
    gameContainer.style.display = 'none';
}

function showGame() {
    authContainer.style.display = 'none';
    gameContainer.style.display = 'block'; // Usar 'block' para o game-container
}

function displayMessage(message, isSystem = false) {
    const p = document.createElement('p');
    p.textContent = message;
    if (isSystem) {
        p.style.color = '#00bcd4'; // Cor para mensagens do sistema
    }
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll
}

function updatePlayerPosition(player) {
    const playerDiv = connectedPlayers[player.playerId];
    if (playerDiv) {
        playerDiv.style.left = `${player.x_pos * TILE_SIZE}px`;
        playerDiv.style.top = `${player.y_pos * TILE_SIZE}px`;

        // Atualizar barra de vida
        const healthBarFill = playerDiv.querySelector('.player-health-bar-fill');
        if (healthBarFill) {
            const healthPercentage = (player.health / player.maxHealth) * 100;
            healthBarFill.style.width = `${healthPercentage}%`;
        }
    }
}

function updateLocalPlayerUI() {
    if (localPlayer.x_pos !== undefined && localPlayer.y_pos !== undefined) {
        playerCube.style.left = `${localPlayer.x_pos * TILE_SIZE}px`;
        playerCube.style.top = `${localPlayer.y_pos * TILE_SIZE}px`;

        // Atualizar barra de vida do próprio jogador
        const healthBarFill = playerHealthBar.querySelector('.player-health-bar-fill');
        if (healthBarFill) {
            const healthPercentage = (localPlayer.health / localPlayer.maxHealth) * 100;
            healthBarFill.style.width = `${healthPercentage}%`;
        }
    }
}

function renderInventory() {
    inventoryGrid.innerHTML = ''; // Limpa o grid
    inventory.forEach((item, index) => {
        const slot = document.createElement('div');
        slot.classList.add('inventory-slot');
        slot.dataset.slotIndex = index;

        if (item) {
            slot.classList.add('has-item');
            const img = document.createElement('img');
            img.src = item.image_url || 'https://via.placeholder.com/32'; // Placeholder se não tiver imagem
            img.alt = item.name;
            slot.appendChild(img);

            if (item.quantity > 1) {
                const quantitySpan = document.createElement('span');
                quantitySpan.classList.add('item-quantity');
                quantitySpan.textContent = item.quantity;
                slot.appendChild(quantitySpan);
            }
        }
        inventoryGrid.appendChild(slot);
    });
}

function renderHotbar() {
    hotbar.innerHTML = '';
    hotbarItems.forEach((item, index) => {
        const slot = document.createElement('div');
        slot.classList.add('hotbar-slot');
        slot.dataset.slotIndex = index;

        if (index === selectedHotbarSlot) {
            slot.classList.add('selected');
        }

        const slotNumber = document.createElement('span');
        slotNumber.classList.add('hotbar-slot-number');
        slotNumber.textContent = index + 1; // 1-indexed number
        slot.appendChild(slotNumber);


        if (item) {
            slot.classList.add('has-item');
            const img = document.createElement('img');
            img.src = item.image_url || 'https://via.placeholder.com/32';
            img.alt = item.name;
            slot.appendChild(img);

            if (item.quantity > 1) {
                const quantitySpan = document.createElement('span');
                quantitySpan.classList.add('item-quantity');
                quantitySpan.textContent = item.quantity;
                slot.appendChild(quantitySpan);
            }
        }
        hotbar.appendChild(slot);
    });
    updateEquippedItemDisplay();
}

function updateEquippedItemDisplay() {
    if (equippedItem) {
        equippedItemImage.src = equippedItem.image_url || 'https://via.placeholder.com/32';
        equippedItemImage.style.display = 'block';
        equippedItemName.textContent = equippedItem.name;
    } else {
        equippedItemImage.style.display = 'none';
        equippedItemName.textContent = 'Nenhum item equipado';
    }
}

function equipItem(slotIndex) {
    if (slotIndex >= 0 && slotIndex < hotbarItems.length) {
        selectedHotbarSlot = slotIndex;
        equippedItem = hotbarItems[slotIndex];
        renderHotbar(); // Re-renderiza a hotbar para atualizar a seleção
        updateEquippedItemDisplay();
        socket.emit('equipItem', equippedItem ? equippedItem.id : null); // Informa o servidor sobre o item equipado
        displayMessage(`Item equipado: ${equippedItem ? equippedItem.name : 'Nenhum'}`);
    }
}

// --- 5. Event Listeners ---

// Autenticação
switchAuthLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLoginMode = !isLoginMode;
    authTitle.textContent = isLoginMode ? 'Login' : 'Registrar';
    authButton.textContent = isLoginMode ? 'Entrar' : 'Registrar';
    emailInput.style.display = isLoginMode ? 'none' : 'block'; // Esconde email no login
    authError.textContent = ''; // Limpa erros
});

authButton.addEventListener('click', () => {
    const username = usernameInput.value;
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!username || !password) {
        authError.textContent = 'Nome de usuário e senha são obrigatórios.';
        return;
    }

    if (!isLoginMode && !email) {
        authError.textContent = 'Email é obrigatório para registro.';
        return;
    }

    if (isLoginMode) {
        socket.emit('login', { username, password });
    } else {
        socket.emit('register', { username, email, password });
    }
});

// Chat
sendButton.addEventListener('click', () => {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('chatMessage', message);
        messageInput.value = '';
    }
});

messageInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendButton.click();
    }
});

// Inventário
closeInventoryButton.addEventListener('click', () => {
    inventoryMenu.style.display = 'none';
});

// Lógica de Drag and Drop para Inventário/Hotbar
let draggedItem = null;
let draggedItemSourceSlot = null;
let draggedItemSourceType = null; // 'inventory' or 'hotbar'

inventoryGrid.addEventListener('dragstart', (e) => {
    const slot = e.target.closest('.inventory-slot');
    if (slot && slot.classList.contains('has-item')) {
        draggedItemSourceSlot = parseInt(slot.dataset.slotIndex);
        draggedItemSourceType = 'inventory';
        draggedItem = inventory[draggedItemSourceSlot];
        e.dataTransfer.setData('text/plain', JSON.stringify(draggedItem)); // Data para arrastar
        e.dataTransfer.effectAllowed = 'move';
    }
});

hotbar.addEventListener('dragstart', (e) => {
    const slot = e.target.closest('.hotbar-slot');
    if (slot && slot.classList.contains('has-item')) {
        draggedItemSourceSlot = parseInt(slot.dataset.slotIndex);
        draggedItemSourceType = 'hotbar';
        draggedItem = hotbarItems[draggedItemSourceSlot];
        e.dataTransfer.setData('text/plain', JSON.stringify(draggedItem));
        e.dataTransfer.effectAllowed = 'move';
    }
});

function handleDrop(e, targetSlotIndex, targetType) {
    e.preventDefault();
    const targetSlot = e.target.closest('.inventory-slot') || e.target.closest('.hotbar-slot');
    if (!targetSlot) return;

    // Se o drop for no mesmo slot de origem, não faz nada
    if (draggedItemSourceSlot === targetSlotIndex && draggedItemSourceType === targetType) {
        return;
    }

    socket.emit('moveItem', {
        fromType: draggedItemSourceType,
        fromIndex: draggedItemSourceSlot,
        toType: targetType,
        toIndex: targetSlotIndex
    });

    draggedItem = null;
    draggedItemSourceSlot = null;
    draggedItemSourceType = null;
}

inventoryGrid.addEventListener('drop', (e) => {
    const slot = e.target.closest('.inventory-slot');
    if (slot) {
        handleDrop(e, parseInt(slot.dataset.slotIndex), 'inventory');
    }
});

inventoryGrid.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
});

hotbar.addEventListener('drop', (e) => {
    const slot = e.target.closest('.hotbar-slot');
    if (slot) {
        handleDrop(e, parseInt(slot.dataset.slotIndex), 'hotbar');
    }
});

hotbar.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
});

// Hotbar por clique
hotbar.addEventListener('click', (e) => {
    const slot = e.target.closest('.hotbar-slot');
    if (slot) {
        const slotIndex = parseInt(slot.dataset.slotIndex);
        equipItem(slotIndex);
    }
});

// --- 6. Movimentação Contínua e Ações do Jogador ---
// Estado das teclas de movimento
const pressedKeys = {};

document.addEventListener('keydown', (event) => {
    if (document.activeElement === messageInput) { // Não processa movimento se o chat estiver focado
        return;
    }

    // Abre/fecha inventário com 'i'
    if (event.key.toLowerCase() === 'i') {
        inventoryMenu.style.display = inventoryMenu.style.display === 'block' ? 'none' : 'block';
        if (inventoryMenu.style.display === 'block') {
            renderInventory(); // Renderiza o inventário ao abrir
        }
        return; // Não impede outras ações
    }

    // Seleção de Hotbar (teclas 1-5)
    if (!isNaN(parseInt(event.key)) && parseInt(event.key) >= 1 && parseInt(event.key) <= 5) {
        const slotIndex = parseInt(event.key) - 1; // 0-indexed
        equipItem(slotIndex); // Equipar o item do slot da hotbar
    }

    // Movimento do Jogador (WASD ou Setas)
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (!pressedKeys[key]) {
            pressedKeys[key] = true;
            socket.emit('playerMovement', {
                up: pressedKeys['w'] || pressedKeys['arrowup'],
                down: pressedKeys['s'] || pressedKeys['arrowdown'],
                left: pressedKeys['a'] || pressedKeys['arrowleft'],
                right: pressedKeys['d'] || pressedKeys['arrowright']
            });
        }
    }
});

document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        if (pressedKeys[key]) {
            pressedKeys[key] = false;
            socket.emit('playerMovement', {
                up: pressedKeys['w'] || pressedKeys['arrowup'],
                down: pressedKeys['s'] || pressedKeys['arrowdown'],
                left: pressedKeys['a'] || pressedKeys['arrowleft'],
                right: pressedKeys['d'] || pressedKeys['arrowright']
            });
        }
    }
});

// Scroll do mouse para hotbar
window.addEventListener('wheel', (event) => {
    if (inventoryMenu.style.display === 'block') return; // Não troca se o inventário estiver aberto

    let newSlot = selectedHotbarSlot;
    if (event.deltaY < 0) { // Scroll para cima
        newSlot = (selectedHotbarSlot - 1 + hotbarItems.length) % hotbarItems.length;
    } else { // Scroll para baixo
        newSlot = (selectedHotbarSlot + 1) % hotbarItems.length;
    }
    equipItem(newSlot);
    event.preventDefault(); // Evita scroll da página
}, { passive: false }); // Passive: false para permitir preventDefault

// --- 7. Eventos do Socket.io ---

socket.on('connect', () => {
    console.log('Conectado ao servidor Socket.io');
    showAuth(); // Mostra a tela de autenticação ao conectar
});

socket.on('authSuccess', (playerData) => {
    displayMessage(`Bem-vindo, ${playerData.username}!`, true);
    localPlayer = playerData;
    playerCube.style.backgroundColor = localPlayer.color || getRandomColor(); // Define a cor do seu player
    playerCube.textContent = localPlayer.username.substring(0, 2).toUpperCase(); // Iniciais do nome
    showGame();
    updateLocalPlayerUI(); // Posiciona o player na primeira vez

    // Renderiza inventário e hotbar iniciais
    inventory = playerData.inventory || [];
    hotbarItems = playerData.hotbar || Array(5).fill(null);
    equippedItem = hotbarItems[selectedHotbarSlot]; // Equipar o item inicial
    renderInventory();
    renderHotbar();
});

socket.on('authError', (message) => {
    authError.textContent = message;
});

socket.on('serverMessage', (message) => {
    displayMessage(`[Sistema] ${message}`, true);
});

socket.on('chatMessage', (data) => {
    const { username, message, playerId } = data;
    if (playerId === localPlayer.playerId) {
        displayMessage(`[Você] ${message}`);
    } else {
        displayMessage(`[${username}] ${message}`);
    }
});

socket.on('playerMoved', (playerData) => {
    // Se for o próprio jogador, a UI já foi atualizada localmente, mas ajusta para consistência do servidor
    if (playerData.playerId === localPlayer.playerId) {
        localPlayer.x_pos = playerData.x;
        localPlayer.y_pos = playerData.y;
        updateLocalPlayerUI();
    } else {
        const otherPlayerDiv = connectedPlayers[playerData.playerId];
        if (otherPlayerDiv) {
            otherPlayerDiv.style.left = `${playerData.x * TILE_SIZE}px`;
            otherPlayerDiv.style.top = `${playerData.y * TILE_SIZE}px`;
        }
    }
});

socket.on('playerConnected', (playerData) => {
    if (playerData.playerId === localPlayer.playerId) return; // Não adiciona o próprio player
    displayMessage(`${playerData.username} entrou no jogo.`, true);

    // Cria o elemento visual para o novo jogador
    const otherPlayerDiv = document.createElement('div');
    otherPlayerDiv.classList.add('player-cube');
    otherPlayerDiv.id = `player-${playerData.playerId}`;
    otherPlayerDiv.style.backgroundColor = playerData.color || getRandomColor();
    otherPlayerDiv.style.left = `${playerData.x_pos * TILE_SIZE}px`;
    otherPlayerDiv.style.top = `${playerData.y_pos * TILE_SIZE}px`;
    otherPlayerDiv.textContent = playerData.username.substring(0, 2).toUpperCase();

    // Adiciona barra de vida ao jogador
    const healthBarDiv = document.createElement('div');
    healthBarDiv.classList.add('player-health-bar');
    const healthBarFillDiv = document.createElement('div');
    healthBarFillDiv.classList.add('player-health-bar-fill');
    healthBarDiv.appendChild(healthBarFillDiv);
    otherPlayerDiv.appendChild(healthBarDiv);

    gameMap.appendChild(otherPlayerDiv);
    connectedPlayers[playerData.playerId] = otherPlayerDiv;
    updatePlayerPosition(playerData); // Garante que a posição inicial esteja correta
});

socket.on('playerDisconnected', (playerId) => {
    const playerDiv = connectedPlayers[playerId];
    if (playerDiv) {
        displayMessage(`${playerDiv.textContent} saiu do jogo.`, true); // Usa o texto do player div (iniciais)
        playerDiv.remove();
        delete connectedPlayers[playerId];
    }
});

socket.on('allConnectedPlayers', (players) => {
    // Remove todos os players existentes antes de adicionar os novos para evitar duplicatas
    Object.values(connectedPlayers).forEach(playerDiv => playerDiv.remove());
    connectedPlayers = {}; // Limpa o objeto

    players.forEach(playerData => {
        if (playerData.playerId === localPlayer.playerId) {
            localPlayer = { ...localPlayer, ...playerData }; // Atualiza dados do player local
            updateLocalPlayerUI();
            return;
        }

        const otherPlayerDiv = document.createElement('div');
        otherPlayerDiv.classList.add('player-cube');
        otherPlayerDiv.id = `player-${playerData.playerId}`;
        otherPlayerDiv.style.backgroundColor = playerData.color || getRandomColor();
        otherPlayerDiv.style.left = `${playerData.x_pos * TILE_SIZE}px`;
        otherPlayerDiv.style.top = `${playerData.y_pos * TILE_SIZE}px`;
        otherPlayerDiv.textContent = playerData.username.substring(0, 2).toUpperCase();

        // Adiciona barra de vida
        const healthBarDiv = document.createElement('div');
        healthBarDiv.classList.add('player-health-bar');
        const healthBarFillDiv = document.createElement('div');
        healthBarFillDiv.classList.add('player-health-bar-fill');
        healthBarDiv.appendChild(healthBarFillDiv);
        otherPlayerDiv.appendChild(healthBarDiv);

        gameMap.appendChild(otherPlayerDiv);
        connectedPlayers[playerData.playerId] = otherPlayerDiv;
        updatePlayerPosition(playerData);
    });
});

socket.on('playerHealthUpdate', (data) => {
    const { playerId, health, maxHealth } = data;
    if (playerId === localPlayer.playerId) {
        localPlayer.health = health;
        localPlayer.maxHealth = maxHealth;
        updateLocalPlayerUI();
    } else {
        const playerDiv = connectedPlayers[playerId];
        if (playerDiv) {
            const healthBarFill = playerDiv.querySelector('.player-health-bar-fill');
            if (healthBarFill) {
                const healthPercentage = (health / maxHealth) * 100;
                healthBarFill.style.width = `${healthPercentage}%`;
            }
        }
    }
});

socket.on('inventoryUpdate', (newInventory) => {
    inventory = newInventory;
    renderInventory();
});

socket.on('hotbarUpdate', (newHotbar) => {
    hotbarItems = newHotbar;
    renderHotbar();
    equipItem(selectedHotbarSlot); // Re-equipa o item do slot atual caso ele tenha mudado
});

socket.on('itemEquipped', (item) => {
    equippedItem = item;
    updateEquippedItemDisplay();
});

socket.on('playerRespawn', ({ x, y }) => {
    localPlayer.x_pos = x;
    localPlayer.y_pos = y;
    updateLocalPlayerUI();
    displayMessage('Você renasceu!', true);
});


// --- 8. Loop de Atualização para Movimento Contínuo ---
let lastMovementEmitTime = 0;
const MOVEMENT_EMIT_INTERVAL = 100; // Emitir evento de movimento a cada 100ms

function gameLoop() {
    const now = Date.now();
    if (now - lastMovementEmitTime > MOVEMENT_EMIT_INTERVAL && (pressedKeys['w'] || pressedKeys['arrowup'] || pressedKeys['s'] || pressedKeys['arrowdown'] || pressedKeys['a'] || pressedKeys['arrowleft'] || pressedKeys['d'] || pressedKeys['arrowright'])) {
        socket.emit('playerMovement', {
            up: pressedKeys['w'] || pressedKeys['arrowup'],
            down: pressedKeys['s'] || pressedKeys['arrowdown'],
            left: pressedKeys['a'] || pressedKeys['arrowleft'],
            right: pressedKeys['d'] || pressedKeys['arrowright']
        });
        lastMovementEmitTime = now;
    }
    requestAnimationFrame(gameLoop);
}

gameLoop(); // Inicia o loop do jogo
