// CORREÇÃO: Definir MAP_WIDTH e MAP_HEIGHT, ou carregar do servidor se for dinâmico.
const MAP_WIDTH = 10;
const MAP_HEIGHT = 10;
const TILE_SIZE = 64; // Tamanho de cada célula do grid em pixels

let socket;
let currentPlayerData = null;
let otherPlayers = {}; // Para armazenar outros jogadores conectados
let globalItemDefinitions = {}; // Recebido do servidor
let globalWeaponStats = {}; // Recebido do servidor

const gameCanvas = document.getElementById('gameCanvas');
const ctx = gameCanvas.getContext('2d');
const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChatButton = document.getElementById('sendChat');
const registerForm = document.getElementById('registerForm');
const loginForm = document.getElementById('loginForm');
const registerButton = document.getElementById('registerButton');
const loginButton = document.getElementById('loginButton');
const toggleToLoginButton = document.getElementById('toggleToLogin'); // NOVO
const toggleToRegisterButton = document.getElementById('toggleToRegister'); // NOVO
const authContainer = document.getElementById('authContainer');
const gameContainer = document.getElementById('gameContainer');
const inventoryContainer = document.getElementById('inventoryContainer');
const hotbarContainer = document.getElementById('hotbar');
const inventoryButton = document.getElementById('inventoryButton'); // Botão de inventário (se tiver)
const usernameDisplay = document.getElementById('usernameDisplay'); // Para mostrar o nome de usuário logado
const healthBar = document.getElementById('healthBar'); // Barra de vida
const attackButton = document.getElementById('attackButton'); // Botão de ataque

let inventoryVisible = false;
const INVENTORY_SIZE = 20; // Tamanho fixo do inventário
const HOTBAR_SIZE = 5; // Tamanho da hotbar

// Mapas para armazenar imagens
const playerImage = new Image();
playerImage.src = 'assets/player.png'; // Caminho para a imagem do jogador
const otherPlayerImage = new Image(); // Imagem para outros jogadores
otherPlayerImage.src = 'assets/other_player.png'; // Assumindo uma imagem diferente
const weaponImage = new Image(); // Imagem genérica para armas
weaponImage.src = 'assets/weapons/espada_de_madeira.png'; // Exemplo, ajuste conforme necessário


// --- 1. Funções de UI/HTML ---
function showAuthScreen() {
    authContainer.style.display = 'block';
    gameContainer.style.display = 'none';
    inventoryContainer.style.display = 'none'; // Esconde inventário
    // Sempre começa no registro por padrão
    document.getElementById('registerSection').style.display = 'block';
    document.getElementById('loginSection').style.display = 'none';
}

function showGameScreen() {
    authContainer.style.display = 'none';
    gameContainer.style.display = 'block';
    // inventoryContainer.style.display = 'block'; // Mostra o inventário se quiser que ele esteja visível por padrão
    drawGame(); // Desenha o mapa e o jogador uma vez
}

function appendMessage(sender, text, type = 'chat') {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${sender}:</strong> ${text}`;
    if (type === 'server') {
        p.style.color = 'yellow';
    }
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// --- 2. Autenticação (Login/Registro) ---
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    try {
        const response = await fetch('/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username })
        });
        const data = await response.json();
        if (response.ok) {
            appendMessage('Servidor', data.message, 'server');
            // Após registro bem-sucedido, muda para a tela de login
            document.getElementById('registerSection').style.display = 'none';
            document.getElementById('loginSection').style.display = 'block';
        } else {
            appendMessage('Servidor', `Erro de registro: ${data.error}`, 'server');
        }
    } catch (error) {
        appendMessage('Servidor', 'Erro de conexão com o servidor.', 'server');
        console.error('Erro de registro:', error);
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const response = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (response.ok) {
            appendMessage('Servidor', data.message, 'server');
            currentPlayerData = {
                playerId: data.user.id,
                username: data.player.username,
                x_pos: data.player.x_pos,
                y_pos: data.player.y_pos,
                life: data.player.life,
                life_max: data.player.life_max,
                inventory: [], // Será carregado via socket
                equippedItem: data.player.equipped_item_id // Carrega item equipado do perfil
            };
            usernameDisplay.textContent = `Bem-vindo, ${currentPlayerData.username}!`;
            updateHealthBar();
            showGameScreen();
            socket.emit('playerLoggedIn', currentPlayerData.playerId); // Informa ao servidor que o jogador logou
        } else {
            appendMessage('Servidor', `Erro de login: ${data.error}`, 'server');
        }
    } catch (error) {
        appendMessage('Servidor', 'Erro de conexão com o servidor.', 'server');
        console.error('Erro de login:', error);
    }
});

// CORREÇÃO: Adiciona event listeners para alternar entre login e registro
toggleToLoginButton.addEventListener('click', () => {
    document.getElementById('registerSection').style.display = 'none';
    document.getElementById('loginSection').style.display = 'block';
});

toggleToRegisterButton.addEventListener('click', () => {
    document.getElementById('registerSection').style.display = 'block';
    document.getElementById('loginSection').style.display = 'none';
});

// --- 3. Inicialização do Socket.io ---
function initializeSocket() {
    // CORREÇÃO: Usar a URL do Render para o deploy
    // Em desenvolvimento local, use "http://localhost:3000"
    socket = io("https://lowcampfire-mmo.onrender.com");

    socket.on('connect', () => {
        appendMessage('Servidor', 'Conectado ao servidor Socket.io.', 'server');
        if (currentPlayerData) { // Se já logado, informa o servidor
            socket.emit('playerLoggedIn', currentPlayerData.playerId);
        }
    });

    socket.on('disconnect', () => {
        appendMessage('Servidor', 'Desconectado do servidor.', 'server');
    });

    socket.on('serverMessage', (message) => {
        appendMessage('Servidor', message, 'server');
    });

    socket.on('chatMessage', (data) => {
        appendMessage(data.sender, data.text);
    });

    socket.on('globalItemDefinitions', (definitions) => {
        globalItemDefinitions = definitions;
        appendMessage('Servidor', 'Definições de itens carregadas!', 'server');
    });

    socket.on('globalWeaponStats', (stats) => {
        globalWeaponStats = stats;
        appendMessage('Servidor', 'Definições de armas carregadas!', 'server');
    });

    socket.on('playerStateUpdate', (playerState) => {
        if (currentPlayerData && currentPlayerData.playerId === playerState.playerId) {
            currentPlayerData.x_pos = playerState.x_pos;
            currentPlayerData.y_pos = playerState.y_pos;
            currentPlayerData.life = playerState.life;
            currentPlayerData.life_max = playerState.life_max;
            currentPlayerData.equippedItem = playerState.equippedItem; // Atualiza item equipado
            updateHealthBar();
            drawGame(); // Redesenha para mostrar a nova posição e status
        }
    });

    socket.on('playerInventoryUpdate', (inventory) => {
        if (currentPlayerData) {
            currentPlayerData.inventory = inventory;
            renderInventory();
            renderHotbar();
            appendMessage('Servidor', 'Inventário atualizado.', 'server');
        }
    });

    socket.on('playerHealthUpdate', (data) => {
        if (currentPlayerData && currentPlayerData.playerId === data.playerId) {
            currentPlayerData.life = data.life;
            updateHealthBar();
        } else if (otherPlayers[data.playerId]) {
            otherPlayers[data.playerId].life = data.life;
        }
        drawGame(); // Redesenha para atualizar visualmente a vida de players
    });

    socket.on('playerRespawn', (data) => {
        if (currentPlayerData && currentPlayerData.playerId === data.playerId) { // Se for o player local
            currentPlayerData.x_pos = data.x;
            currentPlayerData.y_pos = data.y;
            currentPlayerData.life = data.life; // Vida completa
            updateHealthBar();
            appendMessage('Servidor', 'Você reapareceu!', 'server');
        } else if (otherPlayers[data.playerId]) { // Se for outro player
            otherPlayers[data.playerId].x_pos = data.x;
            otherPlayers[data.playerId].y_pos = data.y;
            otherPlayers[data.playerId].life = data.life; // Vida completa
        }
        drawGame();
    });

    // Eventos multiplayer
    socket.on('currentPlayers', (players) => {
        otherPlayers = {};
        players.forEach(p => {
            otherPlayers[p.playerId] = p;
        });
        appendMessage('Servidor', `Carregados ${Object.keys(otherPlayers).length} outros jogadores.`, 'server');
        drawGame();
    });

    socket.on('playerConnected', (playerInfo) => {
        if (playerInfo.playerId !== currentPlayerData.playerId) {
            otherPlayers[playerInfo.playerId] = playerInfo;
            appendMessage('Servidor', `${playerInfo.username} conectou.`, 'server');
            drawGame();
        }
    });

    socket.on('playerDisconnected', (playerId) => {
        if (otherPlayers[playerId]) {
            appendMessage('Servidor', `${otherPlayers[playerId].username} desconectou.`, 'server');
            delete otherPlayers[playerId];
            drawGame();
        }
    });

    socket.on('playerMoved', (data) => {
        if (otherPlayers[data.playerId]) {
            otherPlayers[data.playerId].x_pos = data.x;
            otherPlayers[data.playerId].y_pos = data.y;
            drawGame();
        }
    });

    socket.on('playerEquippedItem', (data) => {
        if (otherPlayers[data.playerId]) {
            otherPlayers[data.playerId].equippedItem = data.equippedItemId;
            drawGame(); // Redesenha para mostrar a arma equipada de outros
        }
    });

    socket.on('equippedItemUpdate', (itemId) => {
        if (currentPlayerData) {
            currentPlayerData.equippedItem = itemId;
            renderHotbar(); // Atualiza a hotbar para mostrar o item equipado
            drawGame(); // Redesenha para atualizar visual do player
        }
    });

    socket.on('playerDied', (data) => {
        const deceasedPlayer = otherPlayers[data.playerId] || (currentPlayerData.playerId === data.playerId ? currentPlayerData : null);
        const killerPlayer = otherPlayers[data.killerId] || (currentPlayerData.playerId === data.killerId ? currentPlayerData : null);

        if (deceasedPlayer && killerPlayer) {
            appendMessage('Servidor', `${deceasedPlayer.username} foi derrotado por ${killerPlayer.username}!`, 'server');
        } else if (deceasedPlayer) {
            appendMessage('Servidor', `${deceasedPlayer.username} foi derrotado!`, 'server');
        }
    });
}

// --- 4. Movimento e Desenho do Jogo ---
let keysPressed = {}; // Para gerenciar múltiplos botões pressionados

document.addEventListener('keydown', (e) => {
    keysPressed[e.key] = true;
    handleMovement(); // Chama a função de movimento no keydown
});

document.addEventListener('keyup', (e) => {
    delete keysPressed[e.key];
});

function handleMovement() {
    if (!currentPlayerData) return;

    let moved = false;
    let newX = currentPlayerData.x_pos;
    let newY = currentPlayerData.y_pos;

    if (keysPressed['w'] || keysPressed['W'] || keysPressed['ArrowUp']) {
        newY--;
        moved = true;
    }
    if (keysPressed['s'] || keysPressed['S'] || keysPressed['ArrowDown']) {
        newY++;
        moved = true;
    }
    if (keysPressed['a'] || keysPressed['A'] || keysPressed['ArrowLeft']) {
        newX--;
        moved = true;
    }
    if (keysPressed['d'] || keysPressed['D'] || keysPressed['ArrowRight']) {
        newX++;
        moved = true;
    }

    // Garante que o jogador permaneça dentro dos limites do mapa
    newX = Math.max(0, Math.min(MAP_WIDTH - 1, newX));
    newY = Math.max(0, Math.min(MAP_HEIGHT - 1, newY));

    if (moved && (newX !== currentPlayerData.x_pos || newY !== currentPlayerData.y_pos)) {
        currentPlayerData.x_pos = newX;
        currentPlayerData.y_pos = newY;
        socket.emit('playerMovement', { playerId: currentPlayerData.playerId, x: currentPlayerData.x_pos, y: currentPlayerData.y_pos });
        drawGame(); // Redesenha imediatamente para feedback visual
    }
}

// CORREÇÃO: Loop de jogo para movimento contínuo e atualizações visuais
function gameLoop() {
    handleMovement(); // Verifica e envia movimento se teclas estiverem pressionadas
    // drawGame(); // Já é chamado por handleMovement ou por eventos de socket
    requestAnimationFrame(gameLoop);
}


function drawGame() {
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

    // Desenha o grid
    for (let x = 0; x < MAP_WIDTH; x++) {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
    }

    // Desenha outros jogadores
    for (const playerId in otherPlayers) {
        const player = otherPlayers[playerId];
        ctx.fillStyle = 'blue'; // Outros jogadores em azul
        ctx.drawImage(otherPlayerImage, player.x_pos * TILE_SIZE, player.y_pos * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Desenha nome de usuário dos outros players
        ctx.font = '12px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(player.username, player.x_pos * TILE_SIZE + TILE_SIZE / 2, player.y_pos * TILE_SIZE - 5);

        // Desenha barra de vida para outros jogadores (simples)
        const healthBarWidth = TILE_SIZE * (player.life / player.life_max);
        ctx.fillStyle = 'red';
        ctx.fillRect(player.x_pos * TILE_SIZE, player.y_pos * TILE_SIZE - 20, TILE_SIZE, 5);
        ctx.fillStyle = 'green';
        ctx.fillRect(player.x_pos * TILE_SIZE, player.y_pos * TILE_SIZE - 20, healthBarWidth, 5);

        // Desenha item equipado de outros players (se houver e for arma)
        if (player.equippedItem && globalItemDefinitions[player.equippedItem] && globalItemDefinitions[player.equippedItem].type === 'weapon') {
            ctx.drawImage(weaponImage, player.x_pos * TILE_SIZE + TILE_SIZE / 2 + 10, player.y_pos * TILE_SIZE + TILE_SIZE / 2 + 10, TILE_SIZE / 2, TILE_SIZE / 2);
        }
    }

    // Desenha o jogador atual (sempre por cima)
    if (currentPlayerData) {
        ctx.fillStyle = 'red'; // Jogador atual em vermelho
        ctx.drawImage(playerImage, currentPlayerData.x_pos * TILE_SIZE, currentPlayerData.y_pos * TILE_SIZE, TILE_SIZE, TILE_SIZE);

        // Desenha o nome do usuário
        ctx.font = '14px Arial';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(currentPlayerData.username, currentPlayerData.x_pos * TILE_SIZE + TILE_SIZE / 2, currentPlayerData.y_pos * TILE_SIZE - 15);

        // Desenha o item equipado (se houver e for arma)
        if (currentPlayerData.equippedItem && globalItemDefinitions[currentPlayerData.equippedItem] && globalItemDefinitions[currentPlayerData.equippedItem].type === 'weapon') {
            ctx.drawImage(weaponImage, currentPlayerData.x_pos * TILE_SIZE + TILE_SIZE / 2 + 10, currentPlayerData.y_pos * TILE_SIZE + TILE_SIZE / 2 + 10, TILE_SIZE / 2, TILE_SIZE / 2);
        }
    }
}

function updateHealthBar() {
    if (currentPlayerData) {
        const percentage = (currentPlayerData.life / currentPlayerData.life_max) * 100;
        healthBar.style.width = `${percentage}%`;
        healthBar.textContent = `${currentPlayerData.life}/${currentPlayerData.life_max}`;
        healthBar.style.backgroundColor = percentage > 50 ? 'green' : percentage > 20 ? 'orange' : 'red';
    }
}


// --- 5. Inventário e Hotbar ---
function toggleInventory() {
    inventoryVisible = !inventoryVisible;
    inventoryContainer.style.display = inventoryVisible ? 'block' : 'none';
}

function renderInventory() {
    const inventoryGrid = document.getElementById('inventoryGrid');
    inventoryGrid.innerHTML = ''; // Limpa o grid

    for (let i = 0; i < INVENTORY_SIZE; i++) {
        const slot = document.createElement('div');
        slot.classList.add('inventory-slot');

        const itemInSlot = currentPlayerData.inventory[i];

        if (itemInSlot && globalItemDefinitions[itemInSlot.item_id]) {
            const itemDef = globalItemDefinitions[itemInSlot.item_id];
            const itemImg = document.createElement('img');
            itemImg.src = `assets/${itemDef.image_path}`; // Assumindo 'image_path' no itemDef
            itemImg.alt = itemDef.name;
            itemImg.title = `${itemDef.name} (x${itemInSlot.quantity})\n${itemDef.description}`;
            slot.appendChild(itemImg);

            const quantitySpan = document.createElement('span');
            quantitySpan.classList.add('item-quantity');
            quantitySpan.textContent = itemInSlot.quantity;
            slot.appendChild(quantitySpan);

            slot.addEventListener('click', () => {
                socket.emit('equipItem', i); // Envia o índice do slot para equipar
            });
        }
        inventoryGrid.appendChild(slot);
    }
}

function renderHotbar() {
    hotbarContainer.innerHTML = ''; // Limpa a hotbar

    for (let i = 0; i < HOTBAR_SIZE; i++) {
        const slot = document.createElement('div');
        slot.classList.add('hotbar-slot');

        const itemInSlot = currentPlayerData.inventory[i]; // Hotbar mostra os primeiros X slots do inventário

        if (itemInSlot && globalItemDefinitions[itemInSlot.item_id]) {
            const itemDef = globalItemDefinitions[itemInSlot.item_id];
            const itemImg = document.createElement('img');
            itemImg.src = `assets/${itemDef.image_path}`;
            itemImg.alt = itemDef.name;
            itemImg.title = `${itemDef.name} (x${itemInSlot.quantity})`;
            slot.appendChild(itemImg);

            const quantitySpan = document.createElement('span');
            quantitySpan.classList.add('item-quantity');
            quantitySpan.textContent = itemInSlot.quantity;
            slot.appendChild(quantitySpan);

            // Adiciona borda de equipado
            if (currentPlayerData.equippedItem === itemDef.id) {
                slot.classList.add('equipped');
            }
        }
        slot.addEventListener('click', () => {
            socket.emit('equipItem', i); // Envia o índice do slot para equipar/desequipar
        });
        hotbarContainer.appendChild(slot);
    }
}

// --- 6. Interação com o Chat e Comandos ---
sendChatButton.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        if (message.startsWith('/')) {
            socket.emit('chatCommand', message);
        } else {
            socket.emit('chatMessage', message);
        }
        chatInput.value = '';
    }
});

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendChatButton.click();
    }
});

// --- 7. Lógica de Combate ---
// CORREÇÃO: Ataque automático ao clicar ou segurar, ou um botão de ataque
attackButton.addEventListener('click', () => {
    if (!currentPlayerData || !currentPlayerData.equippedItem) {
        appendMessage('Servidor', 'Você precisa equipar uma arma para atacar!', 'server');
        return;
    }
    // CORREÇÃO: Implementar lógica de seleção de alvo ou atacar o mais próximo
    // Por simplicidade, vamos atacar o player mais próximo visível.
    const targets = Object.values(otherPlayers).filter(p => p.life > 0);
    if (targets.length === 0) {
        appendMessage('Servidor', 'Nenhum alvo válido por perto.', 'server');
        return;
    }

    // Encontra o alvo mais próximo
    let closestTarget = null;
    let minDistance = Infinity;
    for (const target of targets) {
        const distance = Math.sqrt(
            Math.pow(currentPlayerData.x_pos - target.x_pos, 2) +
            Math.pow(currentPlayerData.y_pos - target.y_pos, 2)
        );
        if (distance < minDistance) {
            minDistance = distance;
            closestTarget = target;
        }
    }

    if (closestTarget) {
        socket.emit('playerAttack', closestTarget.playerId);
        appendMessage('Você', `Atacando ${closestTarget.username}...`, 'chat');
    } else {
        appendMessage('Servidor', 'Nenhum alvo válido por perto.', 'server');
    }
});


// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    showAuthScreen();
    initializeSocket();
    requestAnimationFrame(gameLoop); // Inicia o loop do jogo
});
