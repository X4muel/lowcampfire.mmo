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
const playerHealthBar = document.getElementById('player-health-bar'); // NOVO: Barra de vida do jogador
const inventoryMenu = document.getElementById('inventory-menu');
const closeInventoryButton = document.getElementById('closeInventoryButton');
const inventoryGrid = document.getElementById('inventory-grid');
const hotbar = document.getElementById('hotbar');

const gameMap = document.getElementById('game-map');
const equippedItemDisplay = document.getElementById('equipped-item-display');
const equippedItemImage = document.getElementById('equipped-item-image');
const equippedItemName = document.getElementById('equipped-item-name');
const equippedWeaponSprite = document.getElementById('equipped-weapon-sprite'); // NOVO: Sprite da arma

// --- 2. Variáveis de Estado Global (Cliente) ---
let currentAuthModeIsLogin = false;
let localPlayer = { // Informações do jogador logado localmente
    id: null,
    username: null,
    x_pos: 0,
    y_pos: 0,
    life: 10,
    life_max: 10,
    inventory: [],
    equippedItem: null
};
let clientItemDefinitions = {};
let clientWeaponStats = {};
let otherPlayers = {}; // { playerId: { username, x_pos, y_pos, life, life_max, elementDOM }, ... }

// --- Variáveis do Mapa ---
const MAP_WIDTH = 10;
const MAP_HEIGHT = 10;
const TILE_SIZE = 32;

// --- Estado do Mouse para rotação da arma ---
let mouseX = 0;
let mouseY = 0;

// --- 3. Inicialização do Socket.io ---
const socket = io("https://lowcampfire-mmo.onrender.com");

// --- 4. Funções de UI ---
function appendMessage(msg, type = 'chat') { // Adicionado 'type' para diferenciar mensagens
    const p = document.createElement('p');
    p.textContent = msg;
    if (type === 'server') {
        p.classList.add('server-message');
    } else if (type === 'chat') {
        p.classList.add('chat-message');
    }
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showGameUI() {
    console.log("Showing Game UI.");
    authContainer.style.display = 'none';
    gameContainer.style.display = 'flex';
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
        updateInventoryDisplay();
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

function updateInventoryDisplay() {
    // Limpa hotbar e inventário
    [...hotbar.children, ...inventoryGrid.children].forEach(slot => {
        slot.innerHTML = '';
        slot.classList.remove('has-item', 'selected-slot');
        slot.onclick = null; // Limpa event listener
    });

    // Preenche hotbar
    for (let i = 0; i < 5; i++) {
        const slotDiv = hotbar.children[i];
        const itemInSlot = localPlayer.inventory[i];
        if (itemInSlot && clientItemDefinitions[itemInSlot.item_id]) {
            const itemDef = clientItemDefinitions[itemInSlot.item_id];
            slotDiv.classList.add('has-item');
            slotDiv.innerHTML = `<img src="${itemDef.icon_url}" alt="${itemDef.name}">`;
            if (itemDef.max_stack > 1 || itemInSlot.quantity > 1) {
                slotDiv.innerHTML += `<span class="item-quantity">${itemInSlot.quantity}</span>`;
            }
            slotDiv.onclick = () => equipItem(i); // Adiciona evento de clique para equipar
            if (localPlayer.equippedItem === itemInSlot.item_id) {
                slotDiv.classList.add('selected-slot');
            }
        }
    }

    // Preenche o grid do inventário
    for (let i = 0; i < localPlayer.inventory.length; i++) {
        const slotDiv = inventoryGrid.children[i];
        if (slotDiv) {
            const itemInSlot = localPlayer.inventory[i];
            if (itemInSlot && clientItemDefinitions[itemInSlot.item_id]) {
                const itemDef = clientItemDefinitions[itemInSlot.item_id];
                slotDiv.classList.add('has-item');
                slotDiv.innerHTML = `<img src="${itemDef.icon_url}" alt="${itemDef.name}">`;
                if (itemDef.max_stack > 1 || itemInSlot.quantity > 1) {
                    slotDiv.innerHTML += `<span class="item-quantity">${itemInSlot.quantity}</span>`;
                }
                slotDiv.onclick = () => equipItem(i); // Adiciona evento de clique para equipar
                if (localPlayer.equippedItem === itemInSlot.item_id) {
                    slotDiv.classList.add('selected-slot');
                }
            }
        }
    }
}

function updateEquippedItemDisplay() {
    if (localPlayer.equippedItem && clientItemDefinitions[localPlayer.equippedItem]) {
        const itemDef = clientItemDefinitions[localPlayer.equippedItem];
        equippedItemImage.src = itemDef.icon_url;
        equippedItemImage.style.display = 'block';
        equippedItemName.textContent = itemDef.name;
        // Atualiza o sprite da arma em jogo
        equippedWeaponSprite.src = itemDef.icon_url; // Assumindo que o icon_url serve como sprite
        equippedWeaponSprite.style.display = 'block';
        // Posicionar a arma no jogador
        const playerRect = playerCube.getBoundingClientRect();
        equippedWeaponSprite.style.left = `${playerRect.left + playerRect.width / 2}px`;
        equippedWeaponSprite.style.top = `${playerRect.top + playerRect.height / 2}px`;

        updateWeaponRotation(); // Rotaciona a arma com base no mouse
    } else {
        equippedItemImage.src = '';
        equippedItemImage.style.display = 'none';
        equippedItemName.textContent = '';
        equippedWeaponSprite.src = '';
        equippedWeaponSprite.style.display = 'none';
    }
}

// NOVO: Função para rotacionar a arma
function updateWeaponRotation() {
    if (equippedWeaponSprite.style.display === 'block' && localPlayer.id) {
        const playerRect = playerCube.getBoundingClientRect();
        const playerCenterX = playerRect.left + playerRect.width / 2;
        const playerCenterY = playerRect.top + playerRect.height / 2;

        const angleRad = Math.atan2(mouseY - playerCenterY, mouseX - playerCenterX);
        const angleDeg = angleRad * (180 / Math.PI);

        // Ajusta a posição para a arma ficar ao redor do player
        const radius = TILE_SIZE / 2; // Distância do centro do player
        equippedWeaponSprite.style.left = `${playerCenterX + radius * Math.cos(angleRad) - equippedWeaponSprite.offsetWidth / 2}px`;
        equippedWeaponSprite.style.top = `${playerCenterY + radius * Math.sin(angleRad) - equippedWeaponSprite.offsetHeight / 2}px`;

        equippedWeaponSprite.style.transform = `rotate(${angleDeg}deg)`;
    }
}


function createMap() {
    gameMap.style.gridTemplateColumns = `repeat(${MAP_WIDTH}, ${TILE_SIZE}px)`;
    gameMap.style.width = `${MAP_WIDTH * TILE_SIZE}px`;
    gameMap.style.height = `${MAP_HEIGHT * TILE_SIZE}px`;

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const cell = document.createElement('div');
            cell.classList.add('map-cell');
            cell.style.backgroundImage = `url('/assets/tiles/grass.png')`;
            gameMap.appendChild(cell);
        }
    }
    updatePlayerPositionOnMap();
}

function updatePlayerPositionOnMap() {
    playerCube.style.left = `${localPlayer.x_pos * TILE_SIZE + (TILE_SIZE - playerCube.offsetWidth) / 2}px`;
    playerCube.style.top = `${localPlayer.y_pos * TILE_SIZE + (TILE_SIZE - playerCube.offsetHeight) / 2}px`;
    updateEquippedItemDisplay(); // Atualiza a posição da arma com o player
}

function updatePlayerHealthDisplay() {
    const healthPercentage = (localPlayer.life / localPlayer.life_max) * 100;
    playerHealthBar.style.width = `${healthPercentage}%`;
    playerHealthBar.textContent = `${localPlayer.life}/${localPlayer.life_max}`;
    playerHealthBar.style.backgroundColor = healthPercentage > 50 ? 'green' : (healthPercentage > 20 ? 'orange' : 'red');
}

// NOVO: Funções para outros jogadores
function addOtherPlayerToMap(playerData) {
    if (otherPlayers[playerData.playerId]) {
        console.warn(`Jogador ${playerData.username} já existe no mapa.`);
        return;
    }
    const otherPlayerDiv = document.createElement('div');
    otherPlayerDiv.classList.add('other-player-cube');
    otherPlayerDiv.style.backgroundColor = getRandomColor(); // Cor aleatória para diferenciar
    otherPlayerDiv.style.left = `${playerData.x_pos * TILE_SIZE + (TILE_SIZE - otherPlayerDiv.offsetWidth) / 2}px`;
    otherPlayerDiv.style.top = `${playerData.y_pos * TILE_SIZE + (TILE_SIZE - otherPlayerDiv.offsetHeight) / 2}px`;
    otherPlayerDiv.textContent = playerData.username; // Adiciona o nome
    gameMap.appendChild(otherPlayerDiv);

    otherPlayers[playerData.playerId] = {
        ...playerData,
        element: otherPlayerDiv
    };
    console.log(`Adicionado outro jogador: ${playerData.username}`);
}

function removeOtherPlayerFromMap(playerId) {
    if (otherPlayers[playerId]) {
        gameMap.removeChild(otherPlayers[playerId].element);
        delete otherPlayers[playerId];
        console.log(`Removido jogador: ${playerId}`);
    }
}

function updateOtherPlayerPositionOnMap(playerId, x, y) {
    if (otherPlayers[playerId]) {
        otherPlayers[playerId].x_pos = x;
        otherPlayers[playerId].y_pos = y;
        otherPlayers[playerId].element.style.left = `${x * TILE_SIZE + (TILE_SIZE - otherPlayers[playerId].element.offsetWidth) / 2}px`;
        otherPlayers[playerId].element.style.top = `${y * TILE_SIZE + (TILE_SIZE - otherPlayers[playerId].element.offsetHeight) / 2}px`;
    }
}

function updateOtherPlayerHealthDisplay(playerId, life, life_max) {
    if (otherPlayers[playerId]) {
        otherPlayers[playerId].life = life;
        otherPlayers[playerId].life_max = life_max;
        // Você pode adicionar uma barra de vida para outros jogadores aqui se quiser.
        // Por enquanto, apenas atualiza os dados internos.
        console.log(`Vida de ${otherPlayers[playerId].username} atualizada: ${life}/${life_max}`);
    }
}


// --- 5. Funções de Carregamento de Dados (Local) ---
async function loadWeaponStats() {
    console.log("Loading weapon stats...");
    try {
        // Agora, o weapon_stats é enviado pelo servidor no evento globalWeaponStats
        // Então não precisamos mais carregar localmente.
        // Manteremos a função vazia por enquanto para evitar erros.
    } catch (error) {
        console.error('Erro ao carregar weapon_stats.json (localmente):', error);
    }
}

// --- 6. Comunicação com o Servidor (Socket.io e Fetch) ---
// Socket.io Event Listeners
socket.on('connect', () => {
    appendMessage('Conectado ao servidor Socket.io.', 'server');
    console.log('Conectado ao servidor Socket.io!');
});

socket.on('globalItemDefinitions', (definitions) => {
    clientItemDefinitions = definitions;
    console.log('Definições de itens recebidas do servidor:', clientItemDefinitions);
    // appendMessage('Definições de itens carregadas!', 'server'); // Removido: excesso de mensagens
});

socket.on('globalWeaponStats', (stats) => { // NOVO: Recebe weapon_stats do servidor
    clientWeaponStats = stats;
    console.log('Estatísticas de armas recebidas do servidor:', clientWeaponStats);
    appendMessage('Estatísticas de armas carregadas!', 'server');
});

socket.on('serverMessage', (data) => { // NOVO: Evento específico para mensagens do servidor
    appendMessage('Servidor: ' + data, 'server');
});

socket.on('chatMessage', (data) => { // NOVO: Evento para mensagens de chat de outros jogadores
    appendMessage(`[${data.sender}]: ${data.text}`, 'chat');
});

socket.on('playerStateUpdate', (playerData) => { // NOVO: Recebe o estado completo do jogador logado
    localPlayer.id = playerData.playerId;
    localPlayer.username = playerData.username;
    localPlayer.x_pos = playerData.x_pos;
    localPlayer.y_pos = playerData.y_pos;
    localPlayer.life = playerData.life;
    localPlayer.life_max = playerData.life_max;
    localPlayer.inventory = playerData.inventory;
    localPlayer.equippedItem = playerData.equippedItem; // Pode vir nulo

    updatePlayerPositionOnMap();
    updatePlayerHealthDisplay();
    updateInventoryDisplay();
    updateEquippedItemDisplay();
    appendMessage(`Bem-vindo, ${localPlayer.username}!`, 'server');
});

socket.on('currentPlayers', (playersData) => { // NOVO: Recebe lista de jogadores já conectados
    console.log('Recebida lista de jogadores atuais:', playersData);
    playersData.forEach(player => {
        if (player.playerId !== localPlayer.id) { // Não adiciona o próprio jogador
            addOtherPlayerToMap(player);
        }
    });
});

socket.on('playerConnected', (playerData) => { // NOVO: Evento quando um novo jogador entra
    if (playerData.playerId !== localPlayer.id) {
        appendMessage(`${playerData.username} entrou no jogo.`, 'server');
        addOtherPlayerToMap(playerData);
    }
});

socket.on('playerDisconnected', (playerId) => { // NOVO: Evento quando um jogador sai
    if (otherPlayers[playerId]) {
        appendMessage(`${otherPlayers[playerId].username} saiu do jogo.`, 'server');
        removeOtherPlayerFromMap(playerId);
    }
});

socket.on('playerMoved', (data) => { // NOVO: Recebe movimento de outros jogadores
    if (data.playerId !== localPlayer.id) {
        updateOtherPlayerPositionOnMap(data.playerId, data.x, data.y);
    }
});

socket.on('playerInventoryUpdate', (inventoryData) => {
    console.log('Inventário do jogador atualizado recebido:', inventoryData);
    localPlayer.inventory = inventoryData;
    updateInventoryDisplay();
    // Se o item equipado anterior não estiver mais no inventário, desequipa.
    if (localPlayer.equippedItem && !localPlayer.inventory.some(item => item.item_id === localPlayer.equippedItem)) {
        localPlayer.equippedItem = null;
    }
    // Equipa o primeiro item como padrão se nada estiver equipado e inventário não vazio
    if (localPlayer.inventory.length > 0 && !localPlayer.equippedItem) {
        localPlayer.equippedItem = localPlayer.inventory[0].item_id;
    }
    updateEquippedItemDisplay(); // Atualiza a UI do item equipado
});

socket.on('equippedItemUpdate', (itemId) => { // NOVO: Seu próprio item equipado mudou
    localPlayer.equippedItem = itemId;
    updateEquippedItemDisplay();
    updateInventoryDisplay(); // Atualiza a hotbar/inventário para mostrar o slot selecionado
});

socket.on('playerEquippedItem', (data) => { // NOVO: Outro jogador equipou item
    if (otherPlayers[data.playerId] && clientItemDefinitions[data.equippedItemId]) {
        otherPlayers[data.playerId].equippedItem = data.equippedItemId;
        // TODO: Renderizar arma em outros jogadores (futuro)
    }
});

socket.on('playerHealthUpdate', (data) => { // NOVO: Atualização de vida (seu ou de outro)
    if (data.playerId === localPlayer.id) {
        localPlayer.life = data.life;
        localPlayer.life_max = data.life_max;
        updatePlayerHealthDisplay();
        appendMessage(`Sua vida: ${localPlayer.life}/${localPlayer.life_max}`, 'server');
    } else {
        updateOtherPlayerHealthDisplay(data.playerId, data.life, data.life_max);
    }
});

socket.on('playerDied', (data) => { // NOVO: Mensagem de morte
    const killer = otherPlayers[data.killerId] ? otherPlayers[data.killerId].username : 'Um jogador';
    if (data.playerId === localPlayer.id) {
        appendMessage(`Você morreu para ${killer}!`, 'server');
    } else if (otherPlayers[data.playerId]) {
        appendMessage(`${otherPlayers[data.playerId].username} morreu para ${killer}!`, 'server');
    }
    // Lógica para esconder o jogador morto se ele não for o localPlayer,
    // ou mostrar tela de morte para o localPlayer.
});

socket.on('playerRespawn', (data) => { // NOVO: Respawn (para o próprio jogador)
    if (localPlayer.id) {
        localPlayer.x_pos = data.x;
        localPlayer.y_pos = data.y;
        updatePlayerPositionOnMap();
        appendMessage('Você renasceu!', 'server');
    }
});


socket.on('disconnect', () => {
    appendMessage('Você foi desconectado do servidor.', 'server');
    console.log('Desconectado do servidor Socket.io.');
    showAuthUI();
    // Resetar estado local do jogador
    localPlayer = { id: null, username: null, x_pos: 0, y_pos: 0, life: 10, life_max: 10, inventory: [], equippedItem: null };
    otherPlayers = {}; // Limpa outros jogadores
    // Limpa divs de outros jogadores
    document.querySelectorAll('.other-player-cube').forEach(el => el.remove());
    updateEquippedItemDisplay();
    updateInventoryDisplay();
    updatePlayerHealthDisplay(); // Reseta a barra de vida visualmente
});

socket.on('connect_error', (err) => {
    console.error('Erro de conexão do Socket.io:', err.message);
    appendMessage('Erro de conexão ao servidor.', 'server');
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
            appendMessage(data.message, 'server');
            if (currentMode) { // Se o login foi bem-sucedido
                // O estado completo do jogador será recebido via 'playerStateUpdate' do Socket.io
                showGameUI(); // Mostra a interface do jogo
                socket.emit('playerLoggedIn', data.user.id); // Envia ID para o servidor para que ele possa enviar o playerStateUpdate
            } else { // Se o registro foi bem-sucedido
                appendMessage('Registro concluído. Agora, faça login com sua nova conta.', 'server');
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
        if (!localPlayer.id) {
            appendMessage('Você precisa estar logado para usar o chat ou comandos.', 'server');
            messageInput.value = '';
            return;
        }

        if (message.startsWith('/')) {
            socket.emit('chatCommand', message);
        } else {
            socket.emit('chatMessage', message); // NOVO: Evento para mensagens de chat normais
            appendMessage(`Você: ${message}`, 'chat'); // Adiciona a própria mensagem instantaneamente no chat
        }
        messageInput.value = '';
    }
});

// NOVO: Função para equipar item (chamada pelo clique nos slots)
function equipItem(slotIndex) {
    if (localPlayer.inventory && localPlayer.inventory.length > slotIndex) {
        const itemToEquip = localPlayer.inventory[slotIndex];
        socket.emit('equipItem', slotIndex); // Envia o índice do slot para o servidor
    } else {
        socket.emit('equipItem', null); // Desequipar
    }
}

// NOVO: Lógica de Ataque (Clique do mouse)
gameMap.addEventListener('mousedown', (event) => {
    if (localPlayer.equippedItem && event.button === 0) { // Botão esquerdo do mouse
        const mapRect = gameMap.getBoundingClientRect();
        const clickX = event.clientX - mapRect.left;
        const clickY = event.clientY - mapRect.top;

        // Converter coordenadas do clique para coordenadas do mapa em células
        const clickedCellX = Math.floor(clickX / TILE_SIZE);
        const clickedCellY = Math.floor(clickY / TILE_SIZE);

        // Encontrar qual jogador (se houver) está na célula clicada
        let targetPlayerId = null;
        if (clickedCellX === localPlayer.x_pos && clickedCellY === localPlayer.y_pos) {
            // Clicou em si mesmo, pode ser um ataque para debug ou cura
            // targetPlayerId = localPlayer.id; // Descomente para se atacar
        } else {
            for (const id in otherPlayers) {
                if (otherPlayers[id].x_pos === clickedCellX && otherPlayers[id].y_pos === clickedCellY) {
                    targetPlayerId = id;
                    break;
                }
            }
        }

        if (targetPlayerId) {
            socket.emit('playerAttack', targetPlayerId);
        } else {
            appendMessage('Nenhum alvo válido encontrado na posição clicada.', 'server');
        }
    }
});


// --- 7. Inicialização da Aplicação (DOMContentLoaded) ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Content Loaded. Initializing app...");
    showAuthUI();
    // loadWeaponStats(); // Não é mais necessário, será recebido do servidor
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

    // Event listener para o movimento do mouse para rotação da arma
    document.addEventListener('mousemove', (event) => {
        mouseX = event.clientX;
        mouseY = event.clientY;
        updateWeaponRotation();
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

    // Seleção de Hotbar (teclas 1-5)
    if (!isNaN(parseInt(event.key)) && parseInt(event.key) >= 1 && parseInt(event.key) <= 5) {
        const slotIndex = parseInt(event.key) - 1; // 0-indexed
        equipItem(slotIndex); // Equipar o item do slot da hotbar
    }

    // Movimento do Jogador (WASD ou Setas)
    let newPlayerX = localPlayer.x_pos;
    let newPlayerY = localPlayer.y_pos;

    if (document.activeElement === messageInput) { // Não move se o chat estiver focado
        return;
    }

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

    if (newPlayerX !== localPlayer.x_pos || newPlayerY !== localPlayer.y_pos) {
        localPlayer.x_pos = newPlayerX;
        localPlayer.y_pos = newPlayerY;
        updatePlayerPositionOnMap();
        socket.emit('playerMovement', { x: localPlayer.x_pos, y: localPlayer.y_pos, playerId: localPlayer.id });
    }
});

