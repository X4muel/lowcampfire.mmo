require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises; // Para ler o weapon_stats.json

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Permitir todas as origens para desenvolvimento. Em produção, restrinja à sua URL do Render.
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('ERRO: Variáveis de ambiente SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidas. Verifique seu arquivo .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false
    }
});

let globalItemDefinitions = {}; // Todos os itens do banco de dados (tabela 'items')
let globalWeaponStats = {}; // Carregado do weapon_stats.json

async function loadGlobalItemDefinitions() {
    try {
        const { data, error } = await supabase.from('items').select('*');
        if (error) throw error;
        globalItemDefinitions = data.reduce((acc, item) => {
            acc[item.id] = item;
            return acc;
        }, {});
        console.log('Definições de itens carregadas:', Object.keys(globalItemDefinitions).length);
    } catch (err) {
        console.error('Erro ao carregar definições de itens:', err.message);
    }
}

async function loadWeaponStats() {
    try {
        const data = await fs.readFile(path.join(__dirname, 'weapon_stats.json'), 'utf8');
        globalWeaponStats = JSON.parse(data);
        console.log('Estatísticas de armas carregadas.');
    } catch (err) {
        console.error('Erro ao carregar weapon_stats.json:', err.message);
    }
}

// Carregar definições de itens e estatísticas de armas ao iniciar o servidor
Promise.all([loadGlobalItemDefinitions(), loadWeaponStats()]).then(() => {
    console.log('Dados de jogo iniciais carregados.');
}).catch(err => {
    console.error('Falha ao carregar dados de jogo iniciais:', err);
});

// --- NOVO: MIDDLEWARE PARA DEFINIR CONTENT SECURITY POLICY (CSP) ---
app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        `default-src 'self' blob:; ` + // 'self' para a origem do seu site, 'blob:' para URLs blob
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.socket.io https://lowcampfire-mmo.onrender.com; ` + // 'unsafe-inline' e 'unsafe-eval' são necessários para alguns scripts gerados em tempo de execução (evite em produção se possível)
        `connect-src 'self' ws: wss: https://lowcampfire-mmo.onrender.com; ` + // Para WebSockets (Socket.IO)
        `img-src 'self' data: https://lowcampfire-mmo.onrender.com https://i.imgur.com; ` + // Permite imagens de 'self', data URIs e Imgur
        `style-src 'self' 'unsafe-inline' https://lowcampfire-mmo.onrender.com; ` + // 'unsafe-inline' para estilos inline
        `font-src 'self' https://lowcampfire-mmo.onrender.com;` // Para fontes, se houver
    );
    next();
});
// --- FIM DO BLOCO CSP ---

// Servir arquivos estáticos (HTML, CSS, JS do cliente)
app.use(express.static(path.join(__dirname, 'client')));

// Estado do jogo no servidor
const connectedPlayers = {}; // { socket.id: { playerId, username, x_pos, y_pos, color, health, maxHealth, inventory, hotbar, equippedItemId, ... } }
const MAX_MAP_X = 99; // 0-indexed, MAP_WIDTH - 1
const MAX_MAP_Y = 99; // 0-indexed, MAP_HEIGHT - 1

// Função para obter item por ID
function getItemById(itemId) {
    return globalItemDefinitions[itemId] || null;
}

// Função para adicionar item ao inventário
async function addItemToInventory(playerId, itemId, quantity = 1) {
    const player = Object.values(connectedPlayers).find(p => p.playerId === playerId);
    if (!player) return false;

    const itemToAdd = getItemById(itemId);
    if (!itemToAdd) {
        console.warn(`Item ID ${itemId} não encontrado para adicionar ao inventário.`);
        return false;
    }

    const existingItemIndex = player.inventory.findIndex(
        invItem => invItem.id === itemId && (itemToAdd.max_stack === -1 || invItem.quantity < itemToAdd.max_stack)
    );

    if (existingItemIndex !== -1) {
        player.inventory[existingItemIndex].quantity += quantity;
    } else {
        // Se não encontrar ou o stack estiver cheio, adiciona um novo slot
        player.inventory.push({ ...itemToAdd, quantity: quantity });
    }

    // Ordenar inventário (opcional, para manter organizado)
    player.inventory.sort((a, b) => a.id - b.id);

    // Salvar no DB
    const { error } = await supabase.from('players')
        .update({ inventory: player.inventory })
        .eq('id', player.playerId);

    if (error) {
        console.error('Erro ao salvar inventário:', error.message);
        return false;
    }
    return true;
}

// Função para remover item do inventário
async function removeItemFromInventory(playerId, itemId, quantity = 1) {
    const player = Object.values(connectedPlayers).find(p => p.playerId === playerId);
    if (!player) return false;

    const itemIndex = player.inventory.findIndex(item => item.id === itemId);
    if (itemIndex === -1) return false; // Item não encontrado

    if (player.inventory[itemIndex].quantity > quantity) {
        player.inventory[itemIndex].quantity -= quantity;
    } else {
        player.inventory.splice(itemIndex, 1); // Remove o item se a quantidade for menor ou igual
    }

    // Salvar no DB
    const { error } = await supabase.from('players')
        .update({ inventory: player.inventory })
        .eq('id', player.playerId);

    if (error) {
        console.error('Erro ao salvar inventário após remoção:', error.message);
        return false;
    }
    return true;
}

io.on('connection', (socket) => {
    console.log('Um jogador conectou:', socket.id);

    socket.on('register', async ({ username, email, password }) => {
        try {
            // 1. Verificar se o usuário já existe
            const { data: existingUsers, error: fetchError } = await supabase
                .from('players')
                .select('id')
                .or(`username.eq.${username},email.eq.${email}`);

            if (fetchError) throw fetchError;

            if (existingUsers && existingUsers.length > 0) {
                socket.emit('authError', 'Nome de usuário ou email já em uso.');
                return;
            }

            // 2. Criar o usuário no Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email: email,
                password: password,
            });

            if (authError) {
                console.error('Erro de autenticação no registro:', authError.message);
                socket.emit('authError', `Erro ao registrar: ${authError.message}`);
                return;
            }

            const userId = authData.user.id;

            // 3. Inserir os dados do jogador na tabela 'players'
            // Inventário inicial (ex: Pedra e Espada de Madeira)
            const initialInventory = [
                { id: 1, name: "Pedra", quantity: 5, image_url: "https://i.imgur.com/your_stone_image.png", max_stack: 10, type: "throwable" }, // ID 1 para Pedra
                { id: 2, name: "Espada de Madeira", quantity: 1, image_url: "https://i.imgur.com/your_wood_sword_image.png", max_stack: 1, type: "melee" } // ID 2 para Espada
            ];
            const initialHotbar = [
                { id: 2, name: "Espada de Madeira", quantity: 1, image_url: "https://i.imgur.com/your_wood_sword_image.png", max_stack: 1, type: "melee" },
                { id: 1, name: "Pedra", quantity: 5, image_url: "https://i.imgur.com/your_stone_image.png", max_stack: 10, type: "throwable" },
                null, null, null
            ];


            const { data: playerInsertData, error: playerError } = await supabase
                .from('players')
                .insert([
                    {
                        id: userId,
                        username: username,
                        email: email,
                        x_pos: Math.floor(Math.random() * MAX_MAP_X),
                        y_pos: Math.floor(Math.random() * MAX_MAP_Y),
                        health: 100,
                        maxHealth: 100,
                        color: `#${Math.floor(Math.random() * 16777215).toString(16)}`,
                        inventory: initialInventory,
                        hotbar: initialHotbar,
                        equipped_item_id: initialHotbar[0] ? initialHotbar[0].id : null // Equipar o primeiro item da hotbar
                    }
                ]);

            if (playerError) {
                console.error('Erro ao inserir jogador no DB:', playerError.message);
                // Se falhar a inserção do player, podemos considerar deletar o usuário do auth também
                await supabase.auth.admin.deleteUser(userId); // Reverter
                socket.emit('authError', `Erro ao salvar dados do jogador: ${playerError.message}`);
                return;
            }

            // Registro bem-sucedido, agora faça o login automático ou direcione para a tela de login
            // Para simplificar, vamos logar automaticamente e enviar os dados do jogador
            console.log(`Novo jogador registrado e logado: ${username}`);

            const newPlayer = {
                playerId: userId,
                username: username,
                x_pos: playerInsertData[0].x_pos,
                y_pos: playerInsertData[0].y_pos,
                health: playerInsertData[0].health,
                maxHealth: playerInsertData[0].maxHealth,
                color: playerInsertData[0].color,
                inventory: playerInsertData[0].inventory,
                hotbar: playerInsertData[0].hotbar,
                equipped_item_id: playerInsertData[0].equipped_item_id,
                socketId: socket.id
            };
            connectedPlayers[socket.id] = newPlayer;

            socket.emit('authSuccess', newPlayer);
            socket.broadcast.emit('playerConnected', newPlayer); // Notifica outros clientes
            socket.emit('allConnectedPlayers', Object.values(connectedPlayers)); // Envia a lista de players para o novo cliente

        } catch (error) {
            console.error('Erro no registro:', error.message);
            socket.emit('authError', `Erro interno ao registrar: ${error.message}`);
        }
    });

    socket.on('login', async ({ username, password }) => {
        try {
            // 1. Buscar o email associado ao username na tabela 'players'
            const { data: playerSearch, error: searchError } = await supabase
                .from('players')
                .select('email, id, username, x_pos, y_pos, health, maxHealth, color, inventory, hotbar, equipped_item_id')
                .eq('username', username)
                .single(); // Espera apenas um resultado

            if (searchError) {
                console.error('Erro ao buscar jogador para login:', searchError.message);
                socket.emit('authError', 'Usuário não encontrado ou erro no servidor.');
                return;
            }

            if (!playerSearch) {
                socket.emit('authError', 'Usuário não encontrado.');
                return;
            }

            const email = playerSearch.email;

            // 2. Realizar o login com email e senha no Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (authError) {
                console.error('Erro de autenticação no login:', authError.message);
                socket.emit('authError', 'Credenciais inválidas.');
                return;
            }

            // Login bem-sucedido
            const existingPlayer = {
                playerId: playerSearch.id,
                username: playerSearch.username,
                x_pos: playerSearch.x_pos,
                y_pos: playerSearch.y_pos,
                health: playerSearch.health,
                maxHealth: playerSearch.maxHealth,
                color: playerSearch.color,
                inventory: playerSearch.inventory || [],
                hotbar: playerSearch.hotbar || Array(5).fill(null),
                equipped_item_id: playerSearch.equipped_item_id,
                socketId: socket.id
            };

            // Se o jogador já estiver conectado com outro socket, desconecta o socket antigo
            for (const sockId in connectedPlayers) {
                if (connectedPlayers[sockId].playerId === existingPlayer.playerId) {
                    console.log(`Jogador ${existingPlayer.username} já conectado. Desconectando socket antigo: ${sockId}`);
                    io.sockets.sockets.get(sockId)?.disconnect(true);
                    delete connectedPlayers[sockId];
                    break;
                }
            }

            connectedPlayers[socket.id] = existingPlayer;

            console.log(`Jogador ${username} logado.`);
            socket.emit('authSuccess', existingPlayer);
            socket.broadcast.emit('playerConnected', existingPlayer); // Notifica outros clientes
            socket.emit('allConnectedPlayers', Object.values(connectedPlayers)); // Envia a lista de players para o novo cliente

            // Se o player tinha um item equipado, re-equipa
            if (existingPlayer.equipped_item_id) {
                const equippedItemDef = getItemById(existingPlayer.equipped_item_id);
                if (equippedItemDef) {
                    socket.emit('itemEquipped', equippedItemDef);
                }
            }

        } catch (error) {
            console.error('Erro no login:', error.message);
            socket.emit('authError', `Erro interno ao fazer login: ${error.message}`);
        }
    });

    socket.on('chatMessage', (message) => {
        const player = connectedPlayers[socket.id];
        if (player) {
            io.emit('chatMessage', { username: player.username, message: message, playerId: player.playerId });
        }
    });

    let movementInterval; // Para controlar o intervalo de movimento contínuo
    socket.on('playerMovement', (keysPressed) => {
        const player = connectedPlayers[socket.id];
        if (!player) return;

        const MOVEMENT_SPEED = 1; // Velocidade de movimento (blocos por tick)
        let newPlayerX = player.x_pos;
        let newPlayerY = player.y_pos;

        // Calcula a nova posição baseada nas teclas pressionadas
        if (keysPressed.up) newPlayerY -= MOVEMENT_SPEED;
        if (keysPressed.down) newPlayerY += MOVEMENT_SPEED;
        if (keysPressed.left) newPlayerX -= MOVEMENT_SPEED;
        if (keysPressed.right) newPlayerX += MOVEMENT_SPEED;

        // Limita o movimento dentro dos limites do mapa
        newPlayerX = Math.max(0, Math.min(MAX_MAP_X, newPlayerX));
        newPlayerY = Math.max(0, Math.min(MAX_MAP_Y, newPlayerY));

        // Se a posição mudou, atualiza e emite
        if (newPlayerX !== player.x_pos || newPlayerY !== player.y_pos) {
            player.x_pos = newPlayerX;
            player.y_pos = newPlayerY;

            // Enviar a nova posição para o próprio jogador e para os outros
            socket.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos });
            socket.broadcast.emit('playerMoved', { playerId: player.playerId, x: player.x_pos, y: player.y_pos });

            // Atualizar no DB (opcional: fazer isso menos frequentemente ou em batch)
            // Para protótipo, pode ser ok a cada movimento
            supabase.from('players').update({ x_pos: player.x_pos, y_pos: player.y_pos }).eq('id', player.playerId)
                .then(({ error }) => {
                    if (error) console.error('Erro ao salvar posição:', error.message);
                });
        }
    });

    socket.on('equipItem', async (itemId) => {
        const player = connectedPlayers[socket.id];
        if (!player) return;

        let equippedItem = null;
        if (itemId) {
            equippedItem = getItemById(itemId);
            if (!equippedItem) {
                console.warn(`Item ID ${itemId} não encontrado para equipar.`);
                return;
            }
        }
        player.equipped_item_id = itemId;
        socket.emit('itemEquipped', equippedItem);

        // Salvar no DB
        const { error } = await supabase.from('players')
            .update({ equipped_item_id: itemId })
            .eq('id', player.playerId);
        if (error) console.error('Erro ao salvar item equipado:', error.message);
    });

    socket.on('moveItem', async ({ fromType, fromIndex, toType, toIndex }) => {
        const player = connectedPlayers[socket.id];
        if (!player) return;

        let sourceArray = fromType === 'inventory' ? player.inventory : player.hotbar;
        let targetArray = toType === 'inventory' ? player.inventory : player.hotbar;

        const itemToMove = sourceArray[fromIndex];
        const targetItem = targetArray[toIndex];

        // Lógica básica de troca/stack
        if (!itemToMove) return; // Não há item para mover

        if (targetItem && itemToMove.id === targetItem.id && itemToMove.max_stack !== 1) {
            // Tenta empilhar
            const canStack = itemToMove.max_stack - targetItem.quantity;
            if (canStack >= itemToMove.quantity) {
                targetItem.quantity += itemToMove.quantity;
                sourceArray[fromIndex] = null; // Remove do slot de origem
            } else if (canStack > 0) {
                itemToMove.quantity -= canStack;
                targetItem.quantity += canStack;
                // O item restante no slot de origem é o que sobrou
                sourceArray[fromIndex] = { ...itemToMove }; // Atualiza o objeto para garantir reatividade
            } else {
                // Não pode empilhar mais, faz a troca
                sourceArray[fromIndex] = targetItem;
                targetArray[toIndex] = itemToMove;
            }
        } else {
            // Troca direta ou move para slot vazio
            sourceArray[fromIndex] = targetItem;
            targetArray[toIndex] = itemToMove;
        }

        // Atualiza inventário e hotbar para o cliente
        socket.emit('inventoryUpdate', player.inventory);
        socket.emit('hotbarUpdate', player.hotbar);

        // Salvar no DB
        const { error: invError } = await supabase.from('players')
            .update({ inventory: player.inventory, hotbar: player.hotbar })
            .eq('id', player.playerId);

        if (invError) {
            console.error('Erro ao salvar inventário/hotbar após mover item:', invError.message);
        }

        // Se o item equipado mudou de slot, atualiza o item equipado
        // Precisa verificar se o item equipado atual ainda está em um slot da hotbar ou se foi movido
        // Ou se o item que foi movido para o slot selecionado agora é o item equipado
        if (selectedHotbarSlot !== undefined && player.hotbar[selectedHotbarSlot] && player.hotbar[selectedHotbarSlot].id !== player.equipped_item_id) {
            player.equipped_item_id = player.hotbar[selectedHotbarSlot].id;
            const equippedItemDef = getItemById(player.equipped_item_id);
            socket.emit('itemEquipped', equippedItemDef);
            const { error: equipError } = await supabase.from('players')
                .update({ equipped_item_id: player.equipped_item_id })
                .eq('id', player.playerId);
            if (equipError) console.error('Erro ao salvar item equipado após movimentação:', equipError.message);
        } else if (selectedHotbarSlot !== undefined && !player.hotbar[selectedHotbarSlot]) {
            // Se o slot selecionado ficou vazio
            player.equipped_item_id = null;
            socket.emit('itemEquipped', null);
            const { error: equipError } = await supabase.from('players')
                .update({ equipped_item_id: null })
                .eq('id', player.playerId);
            if (equipError) console.error('Erro ao salvar item equipado como null após movimentação:', equipError.message);
        }
    });

    socket.on('disconnect', () => {
        console.log('Um jogador desconectou:', socket.id);
        const player = connectedPlayers[socket.id];
        if (player) {
            console.log(`Removendo Player ID ${player.playerId} (${player.username}) do socket ${socket.id}.`);
            delete connectedPlayers[socket.id];
            // Notificar outros clientes que este jogador desconectou
            io.emit('playerDisconnected', player.playerId);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
